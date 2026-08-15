# Custom Categories & External Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps left by the multi-category-test-types plan: (Part A) let `playwright-setup` scaffold arbitrary user-named categories (e.g. "user-stories", "checkout-scenarios") in addition to the fixed E2E/Security/Perf set, and (Part B) let `e2e-dashboard` show a dedicated "External" tab for Load-test/Pentest tools (k6, ZAP, etc.) that aren't Playwright specs at all — with a "run scan" button and last-run summary, entirely separate from the live SSE test stream.

**Architecture:** Part A is docs-only: `playwright-setup`'s existing multi-select interview question already gets an "Other" free-text option from the `AskUserQuestion` tool for free — this part just teaches the agent what to do with a custom name (slugify it into `tests/<slug>/`, ask one follow-up about what it should verify, generate specs with the same style rules as E2E). No code changes, no new mechanism — it reuses the `testDir: './tests'` rule the prior plan already built for 2+ categories. Part B is new server + frontend surface in `e2e-dashboard`: an optional `tests/reporters/external-checks.json` config file (written by the installer at setup time, entirely opt-in — its absence is the default and preserves every existing install's behavior unchanged) lists `{key, label, icon, command}` entries; `progress-server.js` gains `GET /external` (status), `POST /external/run` (spawn, log to `test-results/external/<key>.log`), and `GET /external/log` (serve the raw log). The dashboard's existing category-tab row gains one more button — "🔌 External" — that swaps the main content pane to a small card list instead of the file/suite view, polled every 3s rather than pushed over SSE (external tools aren't Playwright, they don't speak the reporter protocol).

**Tech Stack:** Same as before — Node core only in `progress-server.js` (no new dependency), vanilla JS/CSS in the dashboard HTML, `node:test` for coverage, Markdown for both skills' `SKILL.md`. External tools (k6, ZAP, etc.) are the *user's own* CLI dependencies, installed and invoked entirely outside this repo — this plan never bundles or requires them.

## Global Constraints

- **No new npm dependencies** anywhere in `plugins/e2e-dashboard/` or added automatically to consumer projects by `playwright-setup`.
- **Zero-config backward compatibility is mandatory for Part B**: a project with no `tests/reporters/external-checks.json` must behave identically to today — `GET /external` returns `{checks: []}`, the "🔌 External" tab never appears, nothing else changes.
- **Security invariant for external commands:** the command string executed by `POST /external/run` is *always* sourced from `external-checks.json` — a file written once, at install time, by a human-supervised interview. The HTTP request body only ever supplies a `key`, which is validated against the config's known keys before anything spawns. No request ever supplies command text. This mirrors the existing `/run` route's whitelist-not-passthrough design.
- **No result parsing in v1.** `POST /external/run` captures raw stdout+stderr to a log file and reports only the process exit code (0 = pass, nonzero = fail) — it does not parse k6's JSON summary or ZAP's HTML report. Document this explicitly as a deliberate v1 scope cut, not an oversight.
- **Category convention for Part A:** a custom category name is slugified — lowercase, then every run of characters outside `a-z0-9` collapsed to a single `-`, leading/trailing `-` trimmed — before becoming `tests/<slug>/`. Custom categories use the *same* spec-file style rules as `tests/e2e/` (no special disclaimer — that's reserved for Security-smoke/Performance-smoke, which carry a false-confidence risk custom categories don't).
- **Existing CI workflow already covers this**: `.github/workflows/e2e-dashboard-tests.yml` globs `plugins/e2e-dashboard/**` and runs `node --test plugins/e2e-dashboard/tests/`, so a new test file under that directory is picked up automatically — no workflow change needed in this plan.
- Templates stay single-file-per-concern (`progress-server.js`, `realtime-reporter.js`, `test-progress-dashboard.html`) — do not split into a `lib/` folder.

---

## Part A — Custom categories in `playwright-setup`

### Task A1: Support arbitrary category names via "Other"

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md` — three insertion points, all in the same file: the "### Test Categories" section (Phase 2), immediately after the Performance-smoke spec-file section (Phase 4), and the "Categories scaffolded" block (Phase 5). Locate each by searching for the heading/text shown below — this file has been edited by several prior tasks, so line numbers drift; anchor on content, not position.

**Interfaces:**
- Consumes: nothing new — reuses the existing `testDir: './tests'` rule for 2+ categories (already documented, no change needed) and the existing Phase 4 spec-file style rules (selector priority, DO NOT list) that `tests/e2e/` specs already follow.
- Produces: no new interface — this is guidance for the SKILL.md's own future execution, not a code contract.

- [ ] **Step 1: Add the "Custom categories" subsection to Phase 2**

Find the existing `### Test Categories` section (it ends with the sentence "Selecting more than one category changes `playwright.config.ts`'s `testDir` in Phase 4 and adds the corresponding spec-file sections to the Phase 3 plan and Phase 4 implementation."). Insert immediately after it:

```markdown
### Custom categories (via "Other")

The `AskUserQuestion` tool always offers an "Other" option alongside the listed choices, letting the user type a free-text category name (e.g. "user-stories", "checkout-scenarios", "penetration"). Support this:

- Each custom name becomes its own category, slugified for the folder path: lowercase, then collapse every run of characters outside `a-z0-9` into a single `-`, trim leading/trailing `-` (e.g. "Checkout Scenarios" → `tests/checkout-scenarios/`).
- If the user names one or more custom categories, ask ONE short follow-up in the SAME interview message (don't round-trip separately): "For [category name], what should these tests verify?" — one line is enough; this becomes the theme for that category's spec files.
- Custom categories are NOT a new "type" of check like Security/Perf — they're an organizational grouping of ordinary E2E-style tests. Generate them with the exact same content rules as `tests/e2e/` (Phase 4's spec-file style rules below: selector priority, DO NOT list, happy path + one failure/validation path per flow) — just scoped to the user's stated theme and written to their own folder instead of `tests/e2e/`. No special header-comment disclaimer is needed (that's only required for Security-smoke/Performance-smoke, which carry a false-confidence risk custom categories don't).
- `testDir` handling needs no new logic — the existing "2+ categories → `./tests`" rule already covers any number of categories, fixed or custom.
```

- [ ] **Step 2: Add the custom-category spec-file section to Phase 4**

Find the end of the existing `#### Performance-smoke spec files (only if selected in Phase 2)` section (it ends with the sentence "Add one `test()` per critical page from the Phase 2 'Critical flows' answer, not just the home page — reuse `BUDGET_MS` unless the user gave a different budget for a specific page."). Insert immediately after it:

```markdown
#### Custom category spec files (only if the user named one or more via "Other" in Phase 2)

Write to `tests/<slug>/*.spec.ts` using the exact same style rules as the `tests/e2e/` specs above (selector priority, DO NOT list, happy path + one failure/validation path per flow). Scope the content to the user's one-line answer for what that category should verify — e.g. a "checkout-scenarios" category answered "the full buy flow across all payment methods" gets one spec file per payment method under `tests/checkout-scenarios/`, following the same `test.describe()`/`test.beforeEach()` structure as any E2E file. No special header-comment disclaimer is required for custom categories.
```

- [ ] **Step 3: Extend the Phase 5 "Categories scaffolded" report**

Find the existing block:

```markdown
### Categories scaffolded
- E2E / Smoke: N tests
- Security-smoke: N tests (smoke-level only — not a penetration test)   ← only if selected
- Performance-smoke: N tests (smoke-level only — not a load test)      ← only if selected
```

Replace it with:

```markdown
### Categories scaffolded
- E2E / Smoke: N tests
- Security-smoke: N tests (smoke-level only — not a penetration test)   ← only if selected
- Performance-smoke: N tests (smoke-level only — not a load test)      ← only if selected
- <Custom category name>: N tests                                       ← one line per custom category, only if any were named
```

- [ ] **Step 4: Verify by reading the file back**

Read the full `Phase 2`, `Phase 4`, and `Phase 5` sections of `plugins/playwright-setup/skills/playwright-setup/SKILL.md` and confirm: the new subsection reads naturally after the existing Test Categories text, the new Phase 4 section sits between Performance-smoke and the `.env.test` section, the Phase 5 block still renders as a single fenced code block with no broken Markdown.

- [ ] **Step 5: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): support arbitrary custom test categories via Other"
```

---

## Part B — External checks tab in `e2e-dashboard`

### Task B1: Server — external-checks config, `GET /external`, `POST /external/run`, `GET /external/log`

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `loadExternalChecks(): Array<{key, label, icon, command}>` — reads and parses `tests/reporters/external-checks.json`, returns `[]` on any read/parse failure (missing file = default, zero-config case).
- Produces: `GET /external` → `{ checks: [{key, label, icon, status, startTime, endTime, exitCode}, ...] }` — no auth token (read-only, same tier as `/files`/`/history`).
- Produces: `POST /external/run` (body `{key}`) → 400 if `key` isn't in the config, 409 if that check is already running, 200 + spawns otherwise. Requires `X-Dashboard-Token` (state-changing).
- Produces: `GET /external/log?key=<key>` → raw text of that check's captured stdout+stderr, 400 if `key` isn't in the config, 404 if it hasn't run yet. No auth token (read-only, same tier as `/serve`).
- Produces: module exports gain `loadExternalChecks`.

- [ ] **Step 1: Add the config loader, state, and constants**

Insert immediately after the existing `const pendingRuns = new Map(); ... let runCounter = 0;` block (search for `let   runCounter          = 0;`):

```js
const EXTERNAL_CONFIG_FILE = path.join(ROOT, 'tests', 'reporters', 'external-checks.json');
const EXTERNAL_LOG_DIR     = path.join(ROOT, 'test-results', 'external');
const externalRuns         = {}; // key -> { status: 'idle'|'running'|'done', startTime, endTime, exitCode }

function loadExternalChecks() {
  try {
    const json = JSON.parse(fs.readFileSync(EXTERNAL_CONFIG_FILE, 'utf8'));
    return Array.isArray(json.checks) ? json.checks : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Add `GET /external`**

Insert immediately after the existing `GET /categories` route (search for `if (req.method === 'GET' && req.url === '/categories')`, insert after its closing `}`):

```js
  // ── GET /external ────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/external') {
    const checks = loadExternalChecks();
    const withStatus = checks.map(c => ({
      key: c.key, label: c.label, icon: c.icon || '🔌',
      ...(externalRuns[c.key] || { status: 'idle', startTime: null, endTime: null, exitCode: null }),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ checks: withStatus }));
    return;
  }
```

- [ ] **Step 3: Add `POST /external/run` and `GET /external/log`**

Insert immediately after the existing `POST /stop` route (search for `if (req.method === 'POST' && req.url === '/stop')`, insert after its closing `}`, before the `GET / or /dashboard` comment):

```js
  // ── POST /external/run ───────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/external/run') {
    if (!checkToken(req, res)) return;
    const body = await readBody(req);
    let params = {};
    try { params = JSON.parse(body); } catch {}
    const { key } = params;

    const check = loadExternalChecks().find(c => c.key === key);
    if (!check) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown external check key' }));
      return;
    }
    if (externalRuns[key]?.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Already running' }));
      return;
    }

    fs.mkdirSync(EXTERNAL_LOG_DIR, { recursive: true });
    const logPath = path.join(EXTERNAL_LOG_DIR, `${key}.log`);
    const logFd = fs.openSync(logPath, 'w');
    externalRuns[key] = { status: 'running', startTime: Date.now(), endTime: null, exitCode: null };

    console.log(`[progress-server] Spawning external check "${key}": ${check.command}`);
    const child = spawn(check.command, { cwd: ROOT, shell: true, stdio: ['ignore', logFd, logFd] });
    child.on('exit', code => {
      try { fs.closeSync(logFd); } catch (_) {}
      externalRuns[key] = { ...externalRuns[key], status: 'done', endTime: Date.now(), exitCode: code };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── GET /external/log?key=<key> ──────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/external/log')) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const key = new URLSearchParams(qs).get('key') || '';
    if (!loadExternalChecks().some(c => c.key === key)) { res.writeHead(400).end('Unknown key'); return; }
    const logPath = path.join(EXTERNAL_LOG_DIR, `${key}.log`);
    try {
      const data = fs.readFileSync(logPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(data);
    } catch (_) { res.writeHead(404).end('No log yet'); }
    return;
  }
```

- [ ] **Step 4: Export `loadExternalChecks`**

Find `module.exports = { ... };` at the end of the file and add `loadExternalChecks,` to the list (append, don't remove or reorder any existing name).

- [ ] **Step 5: Manual smoke check**

From a scratch dir with `tests/reporters/progress-server.js` (this file) and a `tests/reporters/external-checks.json` containing:
```json
{"checks":[{"key":"demo","label":"Demo","icon":"🔌","command":"node -e \"console.log('hi'); process.exit(0)\""}]}
```
start the server, `curl -s http://127.0.0.1:7373/external` should show `"status":"idle"`. `curl -X POST http://127.0.0.1:7373/external/run -H "X-Dashboard-Token: <token from console>" -H "Content-Type: application/json" -d "{\"key\":\"demo\"}"` should return `{"ok":true}`; a follow-up `GET /external` after ~1s should show `"status":"done","exitCode":0`; `GET /external/log?key=demo` should contain `hi`.

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): add external-checks config, /external, /external/run, /external/log"
```

---

### Task B2: Dashboard HTML — external-checks state, click handling, actions, CSS

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `GET /external`, `POST /external/run` from Task B1.
- Produces: `externalChecks: Array<{key,label,icon,status,startTime,endTime,exitCode}>` (module-scope var, default `[]`).
- Produces: `viewMode: 'tests' | 'external'` (module-scope var, default `'tests'`) — which pane `renderContent()` (Task B3) shows.
- Produces: `loadExternal(): Promise<void>`, `selectExternalView(): void`, `runExternal(key): Promise<void>`, `viewExternalLog(key): void`.

- [ ] **Step 1: Add CSS for the external-checks panel**

Insert immediately after `.cat-tab:hover:not(.active) { color: var(--text); }` (in the `<style>` block, near the existing `.category-tabs`/`.cat-tab` rules):

```css
  .external-panel { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .external-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .external-card-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
  .external-dur { margin-left: auto; font-size: 11px; color: var(--muted); font-weight: 400; }
  .external-card-actions { display: flex; gap: 8px; }
```

- [ ] **Step 2: Add state vars**

Find `let activeCategory = null;` in the app-state block and add immediately after it:

```js
let externalChecks = [];
let viewMode       = 'tests';
```

- [ ] **Step 3: Branch the `.cat-tab` click handler and add the new-button handlers**

Find, in the global click-delegation handler:

```js
  const catTab = e.target.closest('.cat-tab');
  if (catTab) { selectCategory(catTab.dataset.cat || null); return; }
```

Replace with:

```js
  const catTab = e.target.closest('.cat-tab');
  if (catTab) {
    if (catTab.dataset.view === 'external') { selectExternalView(); return; }
    selectCategory(catTab.dataset.cat || null);
    return;
  }

  const runExtBtn = e.target.closest('[data-run-external]');
  if (runExtBtn) { e.stopPropagation(); runExternal(runExtBtn.dataset.runExternal); return; }

  const viewLogBtn = e.target.closest('[data-view-log]');
  if (viewLogBtn) { e.stopPropagation(); viewExternalLog(viewLogBtn.dataset.viewLog); return; }
```

- [ ] **Step 4: Reset `viewMode` on any Playwright-side selection**

Find `function selectCategory(key) {` and add `viewMode = 'tests';` as the first line inside the function body (before `activeCategory = key || null;`).

Find `async function selectFile(file) {` and add `viewMode = 'tests';` as the first line inside the function body (before `selectedFile = file;`).

- [ ] **Step 5: Add the four new functions**

Find `async function loadCategories() { ... }` and insert immediately after it, before `async function loadHistory()`:

```js
async function loadExternal() {
  try {
    const r = await fetch(`${SERVER}/external`);
    externalChecks = (await r.json()).checks || [];
    render();
  } catch {}
}

function selectExternalView() {
  viewMode = 'external';
  render();
}

async function runExternal(key) {
  try {
    await fetch(`${SERVER}/external/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': DASHBOARD_TOKEN },
      body: JSON.stringify({ key }),
    });
    await loadExternal();
  } catch {}
}

function viewExternalLog(key) {
  window.open(`${SERVER}/external/log?key=${encodeURIComponent(key)}`, '_blank');
}
```

- [ ] **Step 6: Manual verification**

Read the file back and confirm: the click-delegation handler's new branch compiles as valid JS (balanced braces), the two new state vars sit next to the existing ones, the four new functions appear once each with no duplicate names.

- [ ] **Step 7: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass (this task doesn't add tests — that's Task B5).

- [ ] **Step 8: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): wire up external-checks state, click handling, and actions"
```

---

### Task B3: Dashboard HTML — render the External tab and panel

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `externalChecks`, `viewMode`, `categories`, `activeCategory` from Task B2 and the prior plan.
- Produces: `renderExternalPanel(): string` — HTML for the external-checks card list (or an empty-state message).
- Produces: `renderCategoryTabs()` — same name, new behavior: shows Playwright category tabs (unchanged logic) AND/OR an "External" tab, hidden only when *both* are empty.
- Produces: `renderContent()` — same name, now branches to the external panel first when `viewMode === 'external'`.

- [ ] **Step 1: Replace `renderCategoryTabs()`**

Find the full existing function:

```js
function renderCategoryTabs() {
  const el = document.getElementById('category-tabs');
  if (categories.length < 2) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  let html = `<button class="cat-tab${activeCategory === null ? ' active' : ''}" data-cat="">All</button>`;
  for (const c of categories) {
    html += `<button class="cat-tab${activeCategory === c.key ? ' active' : ''}" data-cat="${h(c.key)}">${h(c.icon)} ${h(c.label)}</button>`;
  }
  el.innerHTML = html;
}
```

Replace with:

```js
function renderCategoryTabs() {
  const el = document.getElementById('category-tabs');
  const showPlaywrightTabs = categories.length >= 2;
  if (!showPlaywrightTabs && externalChecks.length === 0) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  let html = '';
  if (showPlaywrightTabs) {
    html += `<button class="cat-tab${viewMode === 'tests' && activeCategory === null ? ' active' : ''}" data-cat="">All</button>`;
    for (const c of categories) {
      html += `<button class="cat-tab${viewMode === 'tests' && activeCategory === c.key ? ' active' : ''}" data-cat="${h(c.key)}">${h(c.icon)} ${h(c.label)}</button>`;
    }
  }
  if (externalChecks.length > 0) {
    html += `<button class="cat-tab${viewMode === 'external' ? ' active' : ''}" data-view="external">🔌 External</button>`;
  }
  el.innerHTML = html;
}
```

Note the backward-compat gate: with `externalChecks` empty (the default, zero-config case) and a single Playwright category, both conditions in the early-return hold, so behavior is unchanged from before this plan.

- [ ] **Step 2: Add `renderExternalPanel()`**

Insert immediately after `renderCategoryTabs()`:

```js
function renderExternalPanel() {
  if (!externalChecks.length) {
    return `<div class="empty-state">
      <div class="empty-emoji">🔌</div>
      <div class="empty-title">No external checks configured</div>
      <div class="empty-sub">Load-test and pentest scans are configured at install time — re-run /e2e-dashboard to add one.</div>
    </div>`;
  }
  return '<div class="external-panel">' + externalChecks.map(c => {
    const busy = c.status === 'running';
    const label = busy ? 'Running…' : c.status === 'done' ? (c.exitCode === 0 ? 'Passed' : `Failed (exit ${c.exitCode})`) : 'Not run yet';
    const cls   = busy ? 's-running' : c.status === 'done' ? (c.exitCode === 0 ? 's-passed' : 's-failed') : 's-pending';
    const timing = c.status === 'done' && c.startTime && c.endTime
      ? `<span class="external-dur">⏱ ${fmtTime(Math.floor((c.endTime - c.startTime) / 1000))}</span>` : '';
    return `<div class="external-card">
      <div class="external-card-header">
        <span class="external-icon">${h(c.icon)}</span>
        <span class="external-label">${h(c.label)}</span>
        <span class="${cls}">${h(label)}</span>
        ${timing}
      </div>
      <div class="external-card-actions">
        <button class="btn-primary" ${busy ? 'disabled' : ''} data-run-external="${h(c.key)}" style="font-size:11px;padding:4px 10px">${busy ? '⟳ Running' : '▶ Run scan'}</button>
        <button class="btn-ghost" data-view-log="${h(c.key)}" style="font-size:11px">📄 View log</button>
      </div>
    </div>`;
  }).join('') + '</div>';
}
```

- [ ] **Step 3: Branch `renderContent()`**

Find:

```js
function renderContent() {
  const s           = state;
```

Replace with:

```js
function renderContent() {
  if (viewMode === 'external') {
    document.getElementById('content').innerHTML = renderExternalPanel();
    return;
  }
  const s           = state;
```

- [ ] **Step 4: Poll for external status at boot**

Find the boot section's final three lines:

```js
loadFiles();
loadCategories();
loadHistory();
```

Replace with:

```js
loadFiles();
loadCategories();
loadHistory();
loadExternal();
setInterval(loadExternal, 3000);
```

- [ ] **Step 5: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): render the External tab and check-status panel"
```

---

### Task B4: `e2e-dashboard` SKILL.md — installer flow for external checks

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md`
- Modify: `README.md` (repo root)

**Interfaces:**
- Consumes: Task B1's `external-checks.json` shape (`{checks: [{key, label, icon, command}]}`).

- [ ] **Step 1: Add an External Checks discovery question to Phase 1**

Find the end of the Phase 1 Discovery section (after the `category_dirs` paragraph added by the prior plan, before the "**Ask the user in one message**..." line). Insert:

```markdown
### External checks (optional)

Ask, in the same Phase 1 confirmation message: "Do you want an External Checks tab for load-testing or penetration-testing tools (e.g. k6, OWASP ZAP)? If yes, what's the exact shell command for each, and what should the tab call it?" Skip entirely if the user declines — this is opt-in and has zero effect on the rest of the install when skipped.

For each tool the user wants, record `{key, label, icon, command}`:
- `key`: a short slug (e.g. `load`, `pentest`).
- `label`: display name (e.g. "Load Test", "Pentest").
- `icon`: one emoji — suggest 📈 for load, 🕵️ for pentest, 🔌 as a generic fallback.
- `command`: the exact shell command to run, verbatim as the user gave it (e.g. `k6 run tests/load/script.js`, or `docker run --rm -t owasp/zap2docker-stable zap-baseline.py -t http://localhost:3000`). Do not modify or "improve" it — it runs exactly as typed, with the project root as its working directory.
```

- [ ] **Step 2: Write `external-checks.json` in Phase 4**

Find the Phase 4 "Write Files" section. Add:

```markdown
### External checks config (only if the user configured any in Phase 1)

Write `{reporters_dir}/external-checks.json`:

```json
{
  "checks": [
    { "key": "load", "label": "Load Test", "icon": "📈", "command": "<the exact command the user gave>" }
  ]
}
```

One entry per tool the user described. If none were configured, do not create this file at all — its absence is what keeps the External tab hidden.
```

- [ ] **Step 3: Update the features line and Common Pitfalls table**

Find the bold "**N features**" line and bump the count by one, inserting a new clause: `external checks tab for load/pentest tools (opt-in via external-checks.json, hidden entirely when not configured)`.

Add to the Common Pitfalls table:

```markdown
| External tab not showing | By design when no `tests/reporters/external-checks.json` exists — this feature is fully opt-in. Re-run `/e2e-dashboard` and answer yes to the External Checks question to add one. |
| External check stuck "Running…" | The configured command is still executing (or hung) in a child process — check `test-results/external/<key>.log` directly, or restart the dashboard server to clear stale in-memory state (the log file itself is untouched). |
```

- [ ] **Step 4: Update the README**

Find the `e2e-dashboard` row in the skill summary table (`README.md`). Update it to mention the external-checks tab, e.g. append "; optional External Checks tab for load/pentest tools" to the existing description, keeping the feature count in sync with whatever Step 3 set it to.

- [ ] **Step 5: Verify by reading both files back**

Confirm the new Phase 1/Phase 4 sections read naturally in context, the features count and the new clause are consistent, and the README row matches.

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md README.md
git commit -m "docs(e2e-dashboard): document the external-checks installer flow"
```

---

### Task B5: `node:test` coverage for `/external`, `/external/run`, `/external/log`

**Files:**
- Create: `plugins/e2e-dashboard/tests/external-checks.test.js`

**Interfaces:**
- Consumes: `progress-server.js` spawned as a real child process (same pattern as `progress-server-http.test.js`), with a real `external-checks.json` fixture written per-test-run.

- [ ] **Step 1: Write the test file**

```javascript
// plugins/e2e-dashboard/tests/external-checks.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'progress-server.js');
const HTML     = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'test-progress-dashboard.html');

function waitForLine(stream, pattern, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('timeout waiting for: ' + pattern)), timeoutMs);
    stream.on('data', d => {
      buf += d.toString();
      const m = buf.match(pattern);
      if (m) { clearTimeout(timer); resolve(m); }
    });
  });
}

function waitUntil(fn, timeoutMs = 8000, intervalMs = 100) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      if (await fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

let tmpRoot, child, origin, token;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-ext-'));
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'reporters'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'test-results'), { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  fs.copyFileSync(HTML, path.join(tmpRoot, 'tests', 'test-progress-dashboard.html'));

  const nodeExe = JSON.stringify(process.execPath);
  fs.writeFileSync(path.join(tmpRoot, 'tests', 'reporters', 'external-checks.json'), JSON.stringify({
    checks: [
      { key: 'ok-check',   label: 'OK Check',   icon: '✅', command: `${nodeExe} -e "console.log('external check ok'); process.exit(0)"` },
      { key: 'fail-check', label: 'Fail Check', icon: '❌', command: `${nodeExe} -e "console.error('external check failing'); process.exit(1)"` },
    ],
  }));

  child = spawn(process.execPath, [path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js')], {
    cwd: tmpRoot,
    env: { ...process.env, E2E_DASHBOARD_PORT: '0' },
  });
  const originMatch = await waitForLine(child.stdout, /Listening on (http:\/\/127\.0\.0\.1:\d+)/);
  origin = originMatch[1];
  const tokenMatch = await waitForLine(child.stdout, /Token: ([0-9a-f]+)/);
  token = tokenMatch[1];
});

after(async () => {
  if (child) {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('GET /external lists configured checks with idle status before any run', async () => {
  const res = await fetch(origin + '/external');
  const json = await res.json();
  assert.equal(json.checks.length, 2);
  assert.equal(json.checks.find(c => c.key === 'ok-check').status, 'idle');
});

test('POST /external/run without a token is rejected with 401', async () => {
  const res = await fetch(origin + '/external/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'ok-check' }),
  });
  assert.equal(res.status, 401);
});

test('POST /external/run with an unknown key is rejected with 400', async () => {
  const res = await fetch(origin + '/external/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ key: 'nonexistent' }),
  });
  assert.equal(res.status, 400);
});

test('POST /external/run transitions a check from running to done(exitCode 0), log is readable', async () => {
  const runRes = await fetch(origin + '/external/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ key: 'ok-check' }),
  });
  assert.equal(runRes.status, 200);

  await waitUntil(async () => {
    const r = await fetch(origin + '/external');
    const j = await r.json();
    return j.checks.find(c => c.key === 'ok-check').status === 'done';
  });

  const finalRes = await fetch(origin + '/external');
  const finalJson = await finalRes.json();
  assert.equal(finalJson.checks.find(c => c.key === 'ok-check').exitCode, 0);

  const logRes = await fetch(origin + '/external/log?key=ok-check');
  const logText = await logRes.text();
  assert.ok(logText.includes('external check ok'));
});

test('a failing external command reports a nonzero exitCode', async () => {
  await fetch(origin + '/external/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ key: 'fail-check' }),
  });
  await waitUntil(async () => {
    const r = await fetch(origin + '/external');
    const j = await r.json();
    return j.checks.find(c => c.key === 'fail-check').status === 'done';
  });
  const finalRes = await fetch(origin + '/external');
  const finalJson = await finalRes.json();
  assert.notEqual(finalJson.checks.find(c => c.key === 'fail-check').exitCode, 0);
});

test('GET /external returns an empty list when no external-checks.json exists (backward compat)', async () => {
  const noConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-ext-none-'));
  fs.mkdirSync(path.join(noConfigRoot, 'tests', 'reporters'), { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(noConfigRoot, 'tests', 'reporters', 'progress-server.js'));
  const noConfigChild = spawn(process.execPath, [path.join(noConfigRoot, 'tests', 'reporters', 'progress-server.js')], {
    cwd: noConfigRoot,
    env: { ...process.env, E2E_DASHBOARD_PORT: '0' },
  });
  try {
    const originMatch = await waitForLine(noConfigChild.stdout, /Listening on (http:\/\/127\.0\.0\.1:\d+)/);
    const res = await fetch(originMatch[1] + '/external');
    const json = await res.json();
    assert.deepEqual(json.checks, []);
  } finally {
    noConfigChild.kill();
    await new Promise(resolve => {
      if (noConfigChild.exitCode !== null) return resolve();
      noConfigChild.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    fs.rmSync(noConfigRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the new file alone**

Run: `node --test plugins/e2e-dashboard/tests/external-checks.test.js`
Expected: 6/6 passing.

- [ ] **Step 3: Run the full suite**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all tests pass (pre-existing 20 + 6 new = 26), pristine output.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/tests/external-checks.test.js
git commit -m "test(e2e-dashboard): add coverage for /external, /external/run, /external/log"
```

---

### Task B6: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Real headless-browser check**

In a scratch project with a `tests/reporters/external-checks.json` containing one fast, cross-platform, deterministic command (e.g. `node -e "console.log('demo scan complete'); process.exit(0)"`), start the real server and drive a headless browser (Playwright, already available per the prior plan's Task 12 verification) against it:
1. Confirm the "🔌 External" tab renders in `#category-tabs` even when only one Playwright category exists (proves the OR-condition in `renderCategoryTabs()`).
2. Click it — confirm the main content pane swaps to a card showing "Not run yet".
3. Click "▶ Run scan" — confirm the button becomes disabled/"⟳ Running" within the next poll cycle (up to 3s), then transitions to "Passed" once the command exits.
4. Click "📄 View log" — confirm it opens `/external/log?key=<key>` in a new tab/window showing the command's real output.
5. Click back to a Playwright category or "All" — confirm the content pane returns to the normal file/suite view (proves `viewMode` reset in `selectCategory`/`selectFile`).
6. Confirm zero console/page errors throughout.

- [ ] **Step 2: Backward-compat check**

In a project with no `external-checks.json` at all (e.g. reuse one of the scratch projects from the prior plan's Task 12), confirm the dashboard looks and behaves identically to before this plan — no External tab, no `/external` polling errors visible in the browser console (a 200 with `{checks:[]}` is expected and silent, not an error).

- [ ] **Step 3: Record the outcome**

No commit for this task — if either check fails, open a follow-up task against the specific broken step rather than proceeding to consider the plan complete.

---

## Explicitly out of scope for this plan

- **Result parsing for specific tools** (k6 JSON summaries, ZAP HTML/JSON reports) — v1 only reports the process exit code and raw log. A future plan could add tool-specific summary parsing (e.g. p95 latency from k6, alert counts from ZAP) once real usage shows which fields matter most.
- **Stopping an in-progress external run.** Unlike Playwright's `/stop`, there's no `/external/stop` in this plan — a long-running k6/ZAP process must be killed externally (e.g. server restart) if the user wants to abort it. Small, addable later; left out here to keep the surface area minimal (YAGNI).
- **Live streaming of external-tool output.** The dashboard polls `/external` every 3s and shows only final status — no line-by-line log tail while running (unlike Playwright's step-by-step SSE stream). "View log" always shows the full captured output so far, but the UI doesn't auto-scroll or live-update it while a check is running.
- **Multi-dimensional tagging** (a single test belonging to several categories at once, e.g. both "checkout" and "smoke"). This plan's custom categories (Part A) remain one-folder-per-test, same model as E2E/Security/Perf — a tagging system would be a materially different data model and is deferred.
