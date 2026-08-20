---
name: e2e-dashboard
description: Install real-time Playwright E2E test dashboard into any project. Streams live test progress via SSE with 25 features.
---

# E2E Dashboard Installer

## What Gets Installed

Three files wired into Playwright:

| File | Purpose |
|------|---------|
| `{reporters_dir}/progress-server.js` | Node HTTP server (port 7373) — receives events, serves SSE, spawns test runs |
| `{reporters_dir}/realtime-reporter.js` | Playwright custom reporter — POSTs events to server as tests run |
| `{tests_dir}/test-progress-dashboard.html` | Single-page dashboard served at `http://localhost:7373` |

**25 features**: live SSE stream · sidebar file filter · category tabs (auto-hidden when only one test category — E2E, Security, or Perf — is installed) · per-file/per-test run buttons · re-run failed · failures-only toggle · test name search · sort (default/failed-first/slowest) · describe-block nesting · flakiness badge (from run history) · ETA during run · screenshot thumbnails · Playwright Trace Viewer integration · copy error button · browser notifications · compact mode · keyboard shortcuts · auto-scroll to first failure · failure grouping by error pattern · video attachments · Markdown failure export · static CI-report mode · per-test run-history strip · inline spec source view + edit-and-save (writes back to disk via the same file whitelist /run uses) · browser selector (multi-select, auto-hidden when only one browser is configured) with grouped per-test results and a per-browser pass/fail summary strip.

**Security model**: the server binds to `127.0.0.1` only (never reachable off the local machine), locks CORS to its own origin (no wildcard), and requires an `X-Dashboard-Token` header — generated at startup and printed to the console — on every state-changing route (`/run`, `/stop`, `/open-trace`, `/filetests`). The served dashboard HTML has the token injected automatically; nothing to configure. Set `E2E_DASHBOARD_TOKEN` to pin a fixed token (e.g. for scripted use), and `E2E_DASHBOARD_PORT` to pin a starting port (auto-falls-back by +1 up to 10 times if it's taken, so multiple projects' dashboards can run concurrently).

---

## Phase 1 — Discovery

Before writing any files, find these values. Use `Glob` and `Read` to check the actual project.

| Value | How to find | Default |
|-------|-------------|---------|
| `project_root` | Directory containing `playwright.config.ts` or `playwright.config.js` | cwd |
| `e2e_dir` | Directory where `*.spec.ts` / `*.spec.js` files live | `{root}/tests/e2e` |
| `category_dirs` | Sibling directories of `e2e_dir`'s parent (`{root}/tests/*/`) that contain `*{spec_ext}` files — use Glob `tests/*/*.spec.ts` (or `.js`) | just `e2e` if none found — no behavior change for existing single-category projects |
| `browser_targets` | Playwright projects configured in `playwright.config.ts`'s `projects[]` array — ask the user directly (same as `category_dirs`) rather than parsing the TS config file | just `chromium` if the project only has one (or wasn't generated with multiple) — no behavior change for existing single-browser projects |
| `reporters_dir` | Where to place server + reporter | `{root}/tests/reporters` |
| `html_dest` | Where to place dashboard HTML | `{root}/tests/test-progress-dashboard.html` |
| `spec_ext` | File extension of test specs | `.spec.ts` |
| `config_file` | Full path to playwright config | `{root}/playwright.config.ts` |

Compute the template variables below from those paths.

### Template Variables

| Variable | Meaning | Example |
|----------|---------|---------|
| `ROOT_FROM_REPORTERS` | `path.join(__dirname, ...)` segments to reach `project_root` from `reporters_dir` | `'..', '..'` if reporters = `tests/reporters` |
| `E2E_PATH_FROM_ROOT` | Relative path (POSIX) from root to e2e dir | `tests/e2e` |
| `HTML_FROM_REPORTERS` | Relative path from reporters dir to HTML file | `'..', 'test-progress-dashboard.html'` |
| `SPEC_EXT` | Spec file extension | `.spec.ts` |
| `FILE_KEY_PREFIX` | Prefix used in file identity keys shown in UI | `tests/e2e` |
| `REPORTER_CONFIG_PATH` | Path in playwright.config reporter array, relative to config | `./tests/reporters/realtime-reporter.js` |

If Glob finds more than one populated `tests/<name>/` directory, confirm the full set with the user in the same discovery/confirmation message from Phase 1 — don't silently drop any of them. If only one is found (or the project is a first-time install with no test files yet), proceed with the single-category `e2e` default exactly as documented below — this is the common case and needs no extra confirmation.

**Ask the user in one message** to confirm these values (or auto-detect and proceed if they're unambiguous).

---

## Phase 2 — Read Templates

Read all three templates from the skill directory. Compute SKILL_DIR from this file's path:

```
SKILL_DIR = {directory containing this SKILL.md file}
            typically: ~/.claude/skills/e2e-dashboard
```

Read these paths:
- `{SKILL_DIR}/templates/progress-server.js`
- `{SKILL_DIR}/templates/realtime-reporter.js`
- `{SKILL_DIR}/templates/test-progress-dashboard.html`

---

## Phase 3 — Adapt progress-server.js

The template has `%%ADAPT_*%%` comment markers. Replace the **entire line** containing each marker with the correct value:

| Marker | Replace with |
|--------|-------------|
| `%%ADAPT_ROOT%%` | `const ROOT = path.join(__dirname, ROOT_FROM_REPORTERS);` |
| `%%ADAPT_HTML_PATH%%` | `const HTML_PATH = path.join(__dirname, HTML_FROM_REPORTERS);` |
| `%%ADAPT_CATEGORIES%%` | `const CATEGORIES = [ ... ];` — one object per detected category dir, see below |
| `%%ADAPT_BROWSERS%%` | `const BROWSERS = [ ... ];` — one object per detected `browser_targets` entry, see below |
| `%%ADAPT_SPEC_EXT%%` | `const SPEC_EXT = 'SPEC_EXT';` |

### Building the `CATEGORIES` array

Each detected `category_dirs` entry becomes one object in the array:

```js
{ key: 'e2e', label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'), prefix: 'tests/e2e' }
```

`dir` is built the same way `ROOT` is in `%%ADAPT_ROOT%%` — always `path.join(ROOT, 'tests', '<name>')`. `prefix` is always `tests/<name>` (POSIX, no leading/trailing slash).

| Detected dir name | `label` | `icon` |
|---|---|---|
| `e2e` | `E2E / Smoke` | `🧭` |
| `security` | `Security` | `🛡️` |
| `perf` | `Performance` | `⚡` |
| anything else | Title-cased dir name | `🧪` |

Example for a project with all three (replace the single-entry default line with this):

```js
const CATEGORIES = [
  { key: 'e2e',      label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'),      prefix: 'tests/e2e' },
  { key: 'security', label: 'Security',    icon: '🛡️', dir: path.join(ROOT, 'tests', 'security'), prefix: 'tests/security' },
  { key: 'perf',     label: 'Performance', icon: '⚡', dir: path.join(ROOT, 'tests', 'perf'),     prefix: 'tests/perf' },
];
```

For a single-category project, keep the shipped default (one `e2e` entry) unchanged — do not edit this line at all.

Example for a project where reporters are at `e2e/support/reporters/` (3 levels deep):
- `%%ADAPT_ROOT%%` → `const ROOT = path.join(__dirname, '..', '..', '..');`

### Building the `BROWSERS` array

Each detected `browser_targets` entry becomes one object:

```js
{ key: 'chromium', label: 'Chromium', icon: '🧭' }
```

`key` must exactly match that project's `name` in `playwright.config.ts`'s `projects[]` array — this is what gets passed as `--project=<key>` when the dashboard runs it. `key` must also be space-free — it becomes a literal `--project` CLI argument passed through a shell-mode spawn, and a value containing a space will be incorrectly split by the shell.

| Project name | `label` | `icon` |
|---|---|---|
| `chromium` | `Chromium` | `🧭` |
| `firefox` | `Firefox` | `🦊` |
| `webkit` | `WebKit` | `🧭` (Safari-style compass, no distinct emoji) |
| Mobile-profile projects (e.g. `mobile-chrome`, `mobile-safari`) | Title-cased display name (e.g. `Mobile Chrome`) — the `key` itself must stay the space-free project name, never the display label | `📱` |

Example for a project with all three desktop engines:

```js
const BROWSERS = [
  { key: 'chromium', label: 'Chromium', icon: '🧭' },
  { key: 'firefox',  label: 'Firefox',  icon: '🦊' },
  { key: 'webkit',   label: 'WebKit',   icon: '🧭' },
];
```

For a single-browser project, keep the shipped default (one `chromium` entry) unchanged.

### No-DB-seed adaptation

The template includes `SKIP_GLOBAL_SETUP` env-var support. If the target project has no global setup:

- Remove the `skipSeed` extraction from `/run` params
- Remove the `if (skipSeed) env.SKIP_GLOBAL_SETUP = 'true';` line
- Remove the "Skip DB seed" checkbox from the dashboard HTML (`id="skip-seed"` and its `<label>`)

Only do this if you confirm the project has no `globalSetup` in playwright.config.

---

## Phase 4 — Write Files

Write the three adapted files to their destinations. Create the reporters directory if it doesn't exist.

---

## Phase 5 — Update playwright.config

### Add reporter

In the `reporter` array, add:
```ts
['REPORTER_CONFIG_PATH'],
```

### Add launchOptions to `use` block

```ts
launchOptions: {
  slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10),
  args: process.env.PW_WIN_X != null ? [
    `--window-position=${process.env.PW_WIN_X},${process.env.PW_WIN_Y || '0'}`,
    `--window-size=${process.env.PW_WIN_W || '960'},${process.env.PW_WIN_H || '1080'}`,
    // Windows treats a newly-launched automated Chromium window as
    // "occluded" even though it's on top of nothing — Chrome then
    // throttles/backgrounds it, which shows up as opening minimized.
    '--disable-features=CalculateNativeWinOcclusion',
  ] : [],
},
```

If `launchOptions` already exists in `use`, merge by adding `slowMo` and the `args` array without removing existing properties.

---

## Phase 6 — npm Scripts

Suggest (don't auto-add unless user confirms) these additions to `package.json`:

```json
"dashboard": "node REPORTERS_DIR_RELATIVE/progress-server.js",
"test:watch": "node REPORTERS_DIR_RELATIVE/progress-server.js"
```

Replace `REPORTERS_DIR_RELATIVE` with the path relative to `package.json`.

---

## Phase 7 — Confirm

Report back:
1. Files created (full paths)
2. playwright.config changes (diff summary)
3. How to start: `node {reporters_dir}/progress-server.js` then visit `http://localhost:7373`
4. Any caveats (e.g. "removed SKIP_GLOBAL_SETUP since no globalSetup found")

---

## Common Pitfalls

| Problem | Fix |
|---------|-----|
| Port busy | No action needed — the server auto-tries the next 10 ports and logs which one it bound. Set `E2E_DASHBOARD_PORT` to pin a specific starting port. |
| 401 on every action | The dashboard page must be loaded from the *same* server that's running (`http://127.0.0.1:<port>/`) — opening the HTML file directly (`file://`) skips the token injection. |
| Tests not scanning in sidebar | Check each `CATEGORIES` entry's `dir` and the shared `SPEC_EXT` match actual file locations |
| File keys don't match sidebar | Each `CATEGORIES` entry's `prefix` in scanTestFiles() must produce the same paths that `testFile()` in realtime-reporter returns |
| Reporter not firing | Confirm the path in playwright.config exists and is relative to the config file location |
| Screenshots/traces not loading | The `/serve` endpoint only serves files inside `test-results/` — confirm `outputDir` in playwright.config points there |
| Category tabs not showing | By design when only one category dir has spec files — `GET /categories` returns a single entry and the tab row stays hidden. Add a second `tests/<category>/*.spec.ts` file (e.g. via `/playwright-setup` with Security-smoke or Perf-smoke selected) to see tabs appear. |
| Edits not saving | Check the console for a "Save failed" alert with the server's error message — usually a permissions issue on the file, or the file was deleted/moved after the panel loaded. |
| Saved content looks wrong after re-opening | The save is a full-file overwrite with no conflict detection — if the file was also edited outside the dashboard (IDE, git) between load and save, the dashboard's version wins. Re-open (📄 View source) before editing if you suspect the file changed elsewhere. |
| Browser dropdown not showing | By design when only one browser is configured — `GET /browsers` returns a single entry and the dropdown stays hidden. Configure a second browser target via `/playwright-setup` to see it appear. |
| Interactive-mode windows overlapping | Confirm `playwright.config.ts` was regenerated with the per-project `windowArgsForProject()` helper — an older single-project config only reads the legacy `PW_WIN_X` vars and positions every window identically. |
