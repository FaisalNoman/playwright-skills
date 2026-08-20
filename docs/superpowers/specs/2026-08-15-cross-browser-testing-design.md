# Cross-Browser Testing — Design Spec

**Status:** Design approved. Implementation plan and build deferred to a future session — see "Next Session" at the bottom.

## Problem

Both skills currently support exactly one Playwright project (Chromium only). There's no way to configure, select, or view results across multiple browser engines or device emulation profiles, and no way to see a per-browser pass/fail summary.

## Scope

- **Browsers/profiles covered:** the 3 Playwright engines (Chromium, Firefox, WebKit) plus mobile viewport emulation via Playwright's `devices` presets (e.g. Mobile Chrome / Pixel 5, Mobile Safari / iPhone 13). Not real installed browsers (Edge, real Safari) — that's a `channel`-based variant, explicitly out of scope for this round.
- **Selection point:** both. `playwright-setup`'s interview configures the static set of Playwright `projects[]` at generation time; the dashboard adds a runtime dropdown to run a subset of those configured projects per-run.
- **Live detail:** full live rows per browser, streamed via the existing SSE mechanism — not a post-run-only summary.
- **Interactive mode + multiple browsers:** allowed together. Selecting 2+ browsers with Interactive mode on opens multiple real windows, tiled across the screen. Only the first-launched window gets the `AttachThreadInput` foreground-force built earlier this session — the OS only grants true foreground to one window at a time, so forcing all of them would just fight each other.

## Architecture

**Chosen approach: extend the existing flat `state.tests{}` map with a composite key, don't restructure it.**

Three approaches were considered:

- **A (chosen) — flat map, composite key `${browser}::${id}`, group at render time.** The reporter tags every event with `browser` (read from `test.parent?.project()?.name`); the server keys `state.tests` by the composite key; the frontend groups rows sharing the same (file, describes, title) for display, browsers as nested sub-rows. This is additive — every existing feature built and reviewed this session (run-history, flakiness detection via `isFlaky`, static CI-report mode's `stateFromPlaywrightJson`, video/screenshot attachment rendering) already depends on the flat-map shape and keeps working unmodified; only the key format changes, and only for callers that need to be browser-aware.
- **B — nested state, pre-grouped by test at the server level.** Would match the UI shape 1:1 with no client-side grouping, but requires restructuring `applyEvent` and every consumer of `state.tests` (history, flakiness, CI-report). High blast radius against already-shipped, already-reviewed code for comparatively little benefit over A. Rejected.
- **C — run each browser as a separate sequential invocation, merge client-side at the end.** Lowest backend risk (no key-format change at all), but not actually parallel — contradicts the "full live rows, simultaneously" and "multiple windows side by side" decisions above. Rejected as inconsistent with agreed scope.

## Components

### `playwright-setup`
- Phase 2 interview gains a browser/device multi-select question (Chromium default-on; Firefox, WebKit, Mobile Chrome, Mobile Safari as additional picks), analogous to the existing Test Categories multi-select.
- Phase 4's `playwright.config.ts` template generates one `projects[]` entry per selection, using the matching `devices[...]` preset for device profiles.

### `e2e-dashboard` installer (`SKILL.md`)
- Reuses the exact `%%ADAPT_*%%`-marker pattern already established for `CATEGORIES`: Phase 1 discovery detects the configured `projects[]` (asked directly, same as `category_dirs`, not parsed out of `playwright.config.ts` at runtime), Phase 3 bakes a `BROWSERS` array into `progress-server.js` — one `{key, label, icon}` entry per detected project.

### `progress-server.js`
- New `GET /browsers` — same shape/tier as `GET /categories` (no token, read-only, returns only the configured list).
- `POST /run` gains an optional `browsers: string[]` param. Validated against the whitelist of configured `BROWSERS` (same discipline as `file`/category validation — reject unknown names with 400, never spawn on unvalidated input). Missing/empty → treated as "all configured browsers," never "run nothing."
- Spawns `npx playwright test [file] --project=X --project=Y ...` — one `--project` flag per selected browser (Playwright's CLI supports repeating the flag).
- `applyEvent` keys `state.tests` by `${browser}::${id}` instead of bare `id`. `state.suites[file].tests` becomes a flat list of these composite keys — no other structural change to `state`.
- **Window tiling for Interactive mode:** today's single shared `PW_WIN_X/Y/W/H` env-var set can't position N windows distinctly (every project's `launchOptions` would read the same value). Fix: the server computes a per-browser tile position (it already detects `SCREEN_W/SCREEN_H` at startup) and passes an indexed layout, e.g. `PW_WIN_LAYOUT='[{"x":0,"y":0,"w":960,"h":1080},{"x":960,"y":0,"w":960,"h":1080}]'`. Each project in the generated `playwright.config.ts` reads its own array slot by its fixed index in the `projects[]` array (`JSON.parse(process.env.PW_WIN_LAYOUT || '[]')[N]`).

### `realtime-reporter.js`
- Every posted event (`testBegin`, `testEnd`, `stepBegin`, `stepEnd`) gains a `browser` field, read from `test.parent?.project()?.name`.

### Dashboard HTML
- **Selector:** a compact dropdown in the header (`🌐 Browsers: N selected ▾`), expanding to a checklist. All configured browsers checked by default; selection persists to `localStorage` (same precedent as `e2e-compact`/`e2e-hint-dismissed`).
- **Result rows:** grouped — the test title is the parent row, one compact sub-row per browser underneath (`✓ Chromium — 340ms` / `✗ WebKit — timeout`), matching the picked mockup.
- **Browser summary strip:** a new small panel above the test list showing per-browser pass/fail counts at a glance (`🧭 Chromium: 12/12 | 🦊 Firefox: 11/12 | WebKit: 10/12`), visible whenever more than one browser ran.

## Data Flow (one run, end to end)

Dropdown selection (persisted) → `POST /run {file, browsers: ['chromium','firefox']}` → server validates `browsers` against the configured whitelist, computes the tile layout if Interactive mode → spawns `npx playwright test --project=chromium --project=firefox [--headed]` → `realtime-reporter.js` posts events tagged with `browser` → server applies to `state.tests['chromium::<id>']` / `state.tests['firefox::<id>']` → SSE broadcasts the updated state → frontend groups rows by (file, describes, title) across the composite keys, renders nested per-browser rows, updates the summary strip.

## Error Handling / Edge Cases

- Unknown browser name in the `browsers` param → 400, same whitelist discipline as every other user-facing input this session (`file`, `category`, `key`).
- Empty/omitted `browsers` → treated as "all configured," never silently "run nothing."
- A project that fails to launch (e.g. WebKit binaries not installed) → that browser's sub-row shows a distinct "launch failed" state, not an indefinite "running" spinner.
- Single-browser projects (today's default / existing installs) — `GET /browsers` returns exactly one entry, the dropdown auto-hides (same backward-compatibility pattern already used for category tabs and the external-checks tab), and the composite-key format collapses to effectively the same behavior as today since there's only one possible `browser` value.

## Testing

- `node:test` HTTP-level coverage mirroring the `CATEGORIES` precedent: a fixture project configured with 2+ browsers, a real spawned server, assertions for `GET /browsers`, `/run` rejecting an unknown browser name, and `applyEvent` correctly keying state by `${browser}::${id}` without cross-browser collision.
- Backward-compat assertion: a single-browser fixture project behaves identically to today (one entry from `/browsers`, dropdown hidden, no composite-key visible difference in behavior).
- Real headless-browser verification (established pattern from every UI feature this session): dropdown interaction, grouped multi-browser rows rendering correctly, summary strip counts matching actual run results.

## Explicitly Out of Scope

- Real installed/channel browsers (Edge, real Safari) — `devices`/engine-based only for this round.
- Per-row browser override (e.g. "run just this one test on just Firefox" bypassing the global dropdown selection) — the dropdown selection applies uniformly to Run All / per-file / per-test triggers for v1.
- Automatic detection of installed browser binaries — the configured `BROWSERS` list is whatever the user picked at `playwright-setup` time, not runtime-probed.

## Next Session

Per the brainstorming skill's process, this spec is written and self-reviewed; the remaining steps are:
1. You review this spec file and confirm/request changes.
2. Invoke `superpowers:writing-plans` to produce the task-by-task implementation plan.
3. Execute the plan (subagent-driven-development, matching this session's pattern: fresh implementer + reviewer per task, final whole-branch review, real browser verification before considering it done).
