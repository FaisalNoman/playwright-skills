---
name: e2e-dashboard
description: Install real-time Playwright E2E test dashboard into any project. Streams live test progress via SSE with 14 features.
---

# E2E Dashboard Installer

## What Gets Installed

Three files wired into Playwright:

| File | Purpose |
|------|---------|
| `{reporters_dir}/progress-server.js` | Node HTTP server (port 7373) — receives events, serves SSE, spawns test runs |
| `{reporters_dir}/realtime-reporter.js` | Playwright custom reporter — POSTs events to server as tests run |
| `{tests_dir}/test-progress-dashboard.html` | Single-page dashboard served at `http://localhost:7373` |

**14 features**: live SSE stream · sidebar file filter · per-file/per-test run buttons · re-run failed · failures-only toggle · test name search · sort (default/failed-first/slowest) · describe-block nesting · flakiness badge (from run history) · ETA during run · screenshot thumbnails · Playwright Trace Viewer integration · copy error button · browser notifications · compact mode · keyboard shortcuts · auto-scroll to first failure · failure grouping by error pattern.

---

## Phase 1 — Discovery

Before writing any files, find these values. Use `Glob` and `Read` to check the actual project.

| Value | How to find | Default |
|-------|-------------|---------|
| `project_root` | Directory containing `playwright.config.ts` or `playwright.config.js` | cwd |
| `e2e_dir` | Directory where `*.spec.ts` / `*.spec.js` files live | `{root}/tests/e2e` |
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
| `%%ADAPT_E2E_DIR%%` | `const E2E_DIR = path.join(ROOT, 'E2E_PATH_FROM_ROOT');` |
| `%%ADAPT_SPEC_EXT%%` | `const SPEC_EXT = 'SPEC_EXT';` |
| `%%ADAPT_FILE_PREFIX%%` | `.map(f => \`FILE_KEY_PREFIX/\${f}\`);` |

Example for a project where reporters are at `e2e/support/reporters/` (3 levels deep):
- `%%ADAPT_ROOT%%` → `const ROOT = path.join(__dirname, '..', '..', '..');`

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
| Port 7373 already in use | Tell user to change `PORT` constant in progress-server.js AND `const SERVER` in dashboard HTML |
| Tests not scanning in sidebar | Check `E2E_DIR` and `SPEC_EXT` match actual file locations |
| File keys don't match sidebar | `FILE_KEY_PREFIX` in scanTestFiles() must produce the same paths that `testFile()` in realtime-reporter returns |
| Reporter not firing | Confirm the path in playwright.config exists and is relative to the config file location |
| Screenshots/traces not loading | The `/serve` endpoint only serves files inside `test-results/` — confirm `outputDir` in playwright.config points there |
