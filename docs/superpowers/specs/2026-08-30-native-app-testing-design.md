# Native App Testing Support (mobile-app-testing extension) — Design Spec

**Status:** Design approved. See "Next Session" at the bottom.

## Problem

The `mobile-app-testing` skill (shipped in PR #5, still open/unmerged) integrates with tapflow to record and replay real-device test flows, but its SKILL.md, interview, and phase structure are all framed around "your web app" — even though nothing in the underlying implementation (tapflow's YAML flow format, its MCP tools, the JUnit adapter) is actually web-specific. A deep research pass (2026-08-30, 102 agents, 20 sources, 21 confirmed claims) comparing this skill's design against appetize.io and tapflow's own capabilities found:

- tapflow has a real, documented REST API for build management (`POST /api/v1/apps`, `POST /api/v1/builds`) — an "App Center" with a Backlog/In Progress/Done/Rejected status pipeline — that this skill has never surfaced.
- Native apps have testing needs with no web equivalent: installable builds, permission/onboarding dialogs, a device matrix limited to whatever's installed on the connected Mac agent (no cloud catalog like Appetize's).
- tapflow's `install_app` MCP tool has undocumented parameters — tapflow's own docs call the MCP server "experimental, rough edges." This is a real, current gap, not an assumption to design around.

## Scope

- **App type branch:** the interview explicitly asks "web app or native app?" up front. Web path is unchanged from what shipped in PR #5 — zero behavior change. Native path gains the additions below.
- **Build upload:** the skill actively performs the upload (not just documentation) — `POST /api/v1/apps` (idempotent, matched by `bundle_id_key`) then `POST /api/v1/builds` (multipart), using the real, verified REST shape.
- **Install wiring:** deliberately decoupled. The App Center upload is for build tracking/versioning only. It does not feed a parameter into `install_app` — that call stays exactly as it works today (call it, observe what it actually accepts, adapt), because `install_app`'s real parameter shape has never been confirmed against a live tapflow instance. This is stated explicitly in SKILL.md, not silently assumed.
- **Recording-phase guidance:** native-only system UI (permission dialogs, onboarding sheets) documented as an explicit, named flakiness source — tapflow's flow format has no conditional "if visible" step, so these get recorded as ordinary `tapOn`/`assertVisible` steps with a Common Pitfalls note about non-deterministic reappearance (OS-level permission grants often survive `clearState`, which only resets app data).
- **Device-matrix limits:** documented plainly in Prerequisites — tapflow is pinned to whatever simulators/emulators are installed on the connected Mac agent, no cloud device catalog.
- **Reframing:** SKILL.md's frontmatter, "What This Skill Does," and Prerequisites rewritten from "your web app" to "your app (web or native)."
- **Branch:** continues on `feat/mobile-app-testing-tapflow` (PR #5, still open) rather than a new branch — same feature area, same unmerged review unit.

## Architecture

```
Phase 1 — Discovery & Connectivity (existing, +1 question)
   │  relay_url, relay_token, app_id, flows_dir, dashboard_installed
   │  + app_type: web | native
   │
   ├─ app_type = web ──────────────────────────────────────────┐
   │                                                             │
   └─ app_type = native                                          │
        │                                                        │
        ▼                                                        │
   Phase 1b — Build Upload (NEW, native only)                    │
        GET /api/v1/apps (match by bundle_id_key)                │
        → found: reuse app_id | not found: POST /api/v1/apps     │
        POST /api/v1/builds (multipart: file, app_id, platform)  │
        → build id/version_name/build_number/status_label        │
        (tracking only — NOT wired into install_app)             │
        │                                                        │
        ▼                                                        ▼
   Phase 2 — Choose Journeys (existing, unchanged)
   Phase 3 — Record Each Journey (existing + native-only guidance:
              permission dialogs as ordinary tapOn/assertVisible,
              flagged as a flakiness source, not new syntax)
   Phase 4 — Wire Into e2e-dashboard (existing, unchanged)
   Phase 5 — Running Flows (existing, unchanged)
```

Two approaches were considered for the install_app/build-id question:

- **A (chosen) — decoupled.** Build upload and device install are two independent capabilities that happen to share a build file. `install_app`'s real signature is unverified (tapflow's own docs call it "experimental"), so nothing in this design assumes a parameter name that was never confirmed. The App Center upload still delivers real value on its own: build history, version tracking, visibility in tapflow's own dashboard.
- **B — assume build_id wiring, flag as unverified.** Would guess `install_app({ build_id: ... })` and document it as unverified pending Task 6. Rejected: a plausible-looking but unconfirmed API call in a SKILL.md that an agent will execute verbatim is worse than an honest gap — the earlier draft of the original mobile-app-testing spec made exactly this kind of unverified-API mistake once already this project (the custom flow-format/pixel-diff design, discarded after checking tapflow's real docs), and it's not worth repeating.

## Components

### `mobile-app-testing` SKILL.md — Phase 1 (modified)

Discovery table gains one row: `app_type` — "web app or native app?", asked directly, no default (required).

### `mobile-app-testing` SKILL.md — Phase 1b: Build Upload (new, native only)

1. Ask for the build file path (and platform, if not inferable from the file extension: `.app.zip`/`.tar.gz`/`.tgz` → iOS, `.apk` → Android).
2. `GET {relay_url}/api/v1/apps` with the existing Bearer token. Match an entry by `bundle_id_key` against the project's bundle ID / `applicationId` (from `app_id` gathered in Phase 1, or asked directly if ambiguous).
   - Match found → reuse its `id` as `app_id` for the next step.
   - No match → `POST {relay_url}/api/v1/apps` with `{ name, bundle_id_key, platform }` → use the returned `id`.
3. `POST {relay_url}/api/v1/builds` — multipart form: `file` (the build binary), `app_id`, `platform`, optionally `status`/`label`. Same Bearer auth.
   - Non-2xx response → stop, report the failure clearly (same fail-fast pattern as Phase 1's connectivity check). Do not proceed to recording with an unresolved build state.
4. Report the response (`id`, `version_name`, `build_number`, `status_label`, `uploaded_at`) to the user in one message.
5. Explicit note carried into the doc: this build id is **not** passed to `install_app` later — that stays independent, discovered live.

### `mobile-app-testing` SKILL.md — Phase 3 (Record) — additions

- New guidance paragraph: permission/onboarding dialogs get recorded as normal `tapOn`/`assertVisible` steps (same mechanism as any other element, via `query_ui_tree`). No new flow-YAML syntax — tapflow's schema has no conditional step type, and inventing one here would be unverified, unsupported syntax `tapflow flow run` wouldn't understand.
- New Common Pitfalls row: a recorded flow that fails inconsistently on replay because a permission dialog only appears sometimes (OS-level grants frequently outlive `clearState`, which resets app data, not OS consent state) — named as a real, unresolved flakiness source, not something this skill works around.

### `mobile-app-testing` SKILL.md — Prerequisites & framing — modified

- Frontmatter `description`, "What This Skill Does," and the Prerequisites list: "your web app" → "your app (web or native)" throughout.
- New Prerequisites bullet: device-matrix limits — tapflow tests against whatever simulators/emulators are booted on the connected Mac agent; there is no cloud device catalog, so multi-OS-version coverage means provisioning multiple local runtimes.

## Data Flow (one native-app Build Upload, end to end)

Interview asks `app_type` → user answers `native` → skill asks for build file path/platform → `GET /api/v1/apps` (Bearer token from Phase 1) → app found or created → `POST /api/v1/builds` (multipart) → response reported to user → flow proceeds to Phase 2 (Choose Journeys) exactly as the web path already does, with the build now tracked in tapflow's App Center for the team's visibility (not functionally required by anything downstream in this skill).

## Error Handling / Edge Cases

- Build upload non-2xx (bad file, >500MB, network, auth) → stop before Phase 2, same fail-fast convention as the existing Phase 1 connectivity check.
- Multiple `GET /api/v1/apps` entries matching one `bundle_id_key` → surface to the user for disambiguation rather than silently picking one (shouldn't happen given tapflow's own uniqueness assumptions, but not assumed away).
- `relay_token` handling, relay-unreachable fail-fast, and every other existing error-handling convention from the shipped skill carry over unchanged — this spec only adds the native-specific cases above.

## Testing

- No new runtime template code ships from this spec — everything is SKILL.md documentation/procedural instructions (the REST calls in Phase 1b are agent-executed via a documented sequence, same pattern as Phase 1's existing connectivity check, not a shipped Node script). There is nothing here for `node:test` to cover.
- Verification is manual, against a real tapflow instance: does `GET /api/v1/apps` + `POST /api/v1/builds` actually work as documented, does the idempotent app-matching behave correctly on a second upload for the same app, and (openly, per this spec's own scope) what `install_app` actually accepts once observed live. This folds into the existing skill's already-pending Task 6 (manual end-to-end verification) rather than creating a separate parallel verification task — Task 6 was never run, so this native-path verification becomes part of it.

## Explicitly Out of Scope

- Wiring the App Center build id into `install_app` — deliberately deferred until the real parameter shape is confirmed live (see Architecture, Approach A).
- Any new flow-YAML syntax for conditional/optional steps (e.g., "tap only if visible") — not something tapflow's format supports; not invented here.
- A device-matrix/parallel-execution feature (running one flow across multiple simulators automatically) — Prerequisites document the limitation; building tooling around it is future work, not this spec.
- CI wiring — unchanged from the existing skill's decision not to generate CI workflow files.
- Any change to the already-shipped `tapflow-report-adapter.js`, e2e-dashboard's `CATEGORIES`/`ext` support, or Phases 2/4/5 beyond the Phase 3 additions described above.

## Next Session

Per the brainstorming skill's process, this spec is written and self-reviewed; the remaining steps are:
1. You review this spec file and confirm/request changes.
2. Invoke `superpowers:writing-plans` to produce the task-by-task implementation plan.
3. Execute the plan.
