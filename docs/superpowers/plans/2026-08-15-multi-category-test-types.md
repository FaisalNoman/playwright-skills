# Multi-Category Test Types (Security-smoke / Perf-smoke) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `playwright-setup` and `e2e-dashboard` to scaffold and visualize two additional Playwright-native test categories — Security-smoke and Performance-smoke — alongside the existing E2E/Smoke category, with the dashboard grouping tests by category via tabs that stay hidden for today's single-category projects.

**Architecture:** `playwright-setup` gains a multi-select interview question (E2E/Smoke default-on, Security-smoke, Performance-smoke) that drives which `tests/<category>/*.spec.ts` directories get scaffolded and what `playwright.config.ts`'s `testDir` resolves to. `e2e-dashboard`'s `progress-server.js` replaces its single hardcoded `E2E_DIR` constant with a `CATEGORIES` array (one object per category dir); `scanTestFiles()` walks all of them, and a new `GET /categories` endpoint reports only the categories that actually contain a spec file — so a project with only `tests/e2e/` gets a one-entry list and the dashboard's new category-tab row auto-hides, identical to how the existing skip-seed toggle already hides itself when there's no `globalSetup`. The Playwright custom reporter (`realtime-reporter.js`) needs **no change** — its `testFile()` regex already normalizes any `tests/<anything>/foo.spec.ts` path, so it already forwards category-prefixed paths correctly today. `Unit Test` and `Penetration Test`/`Load Test` are explicitly out of scope (see Global Constraints) — they don't fit the Playwright-native model these two skills are built around.

**Tech Stack:** Node.js core modules only (`http`, `path`, `fs`) in `progress-server.js` — no new runtime dependencies. Vanilla JS/CSS in `test-progress-dashboard.html` — no new frontend dependencies. `node:test` for the new unit/HTTP coverage, matching the existing suite. TypeScript/`@playwright/test` for the generated security-smoke and perf-smoke spec templates in `playwright-setup` — no new npm dependency added to consumer projects (Navigation Timing API via `page.evaluate`, not Lighthouse).

## Global Constraints

- **Base branch:** `fix/e2e-dashboard-security-and-quality` (22 commits ahead of `master`, already landed the security/quality work this plan builds on) — not `master`. Isolate this work in its own worktree/branch stacked on top of it (e.g. `feat/multi-category-test-types`), created via the `superpowers:using-git-worktrees` skill before Task 1.
- **No new npm dependencies** in `plugins/e2e-dashboard/` (server/reporter/dashboard stay Node-core-only) or added automatically to consumer projects by `playwright-setup` (perf-smoke uses the built-in Navigation Timing API, not Lighthouse).
- **Category directory convention (fixed):** `tests/<category>/*.spec.ts` under the project root, sibling to today's `tests/e2e/`. Default keys/labels/icons: `e2e` → "E2E / Smoke" / 🧭, `security` → "Security" / 🛡️, `perf` → "Performance" / ⚡. Both skills must agree on this convention — `playwright-setup` writes to it, `e2e-dashboard` reads from it.
- **Backward compatibility is mandatory:** a project with only `tests/e2e/` populated must produce a `CATEGORIES` array with exactly one entry, `GET /categories` must return exactly one entry, and the dashboard's category-tab row must render nothing visible (`hidden` class stays on) — pixel-identical to today's UI for every existing install.
- **Only two of the four requested test types are in scope for Playwright-native generation:** Security-smoke (response headers, auth-bypass, reflected-input checks — not a substitute for real penetration testing) and Performance-smoke (page-load timing budgets via Navigation Timing — not a substitute for real load testing with concurrent virtual users). Every place these are surfaced to the user (interview question, generated spec file header comment, confirm report) must say so explicitly. Unit tests and true Penetration/Load testing are out of scope for this plan — they need a different runner/tool entirely and don't belong in `playwright-setup`'s output.
- Do not touch the existing token/CORS/path-traversal logic beyond broadening `isKnownSpecFile`'s single-directory check into a loop over `CATEGORIES` — every other security property from the base branch must be preserved unchanged.
- Templates stay single-file-per-concern (do not split `progress-server.js` into a `lib/` folder) — same constraint the base branch already documented.

---

### Task 1: `progress-server.js` — replace `E2E_DIR` with a `CATEGORIES` array

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:14` (config block)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:64-71` (`scanTestFiles`)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:73-78` (`isKnownSpecFile`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CATEGORIES: Array<{key, label, icon, dir, prefix}>` — module-scope config, one entry per test category, default single `e2e` entry.
- Produces: `scanTestFiles(): string[]` — same return shape as before (flat array of `tests/<cat>/file.spec.ts` strings), now walks every dir in `CATEGORIES` instead of just `E2E_DIR`.
- Produces: `activeCategories(): Array<{key, label, icon, prefix}>` — new helper, filters `CATEGORIES` down to only those with ≥1 spec file on disk right now.
- Produces: `isKnownSpecFile(fileParam): boolean` — same signature, now accepts a file inside *any* configured category dir (not just `tests/e2e/`).

- [ ] **Step 1: Replace the `E2E_DIR` config line**

Replace `progress-server.js:14` (`const E2E_DIR = path.join(ROOT, 'tests', 'e2e'); // %%ADAPT_E2E_DIR%%`) with:

```js
const CATEGORIES    = [ { key: 'e2e', label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'), prefix: 'tests/e2e' } ]; // %%ADAPT_CATEGORIES%%
```

- [ ] **Step 2: Replace `scanTestFiles` and add `activeCategories`**

Replace `progress-server.js:64-71`:

```js
function scanTestFiles() {
  const out = [];
  for (const cat of CATEGORIES) {
    let entries;
    try { entries = fs.readdirSync(cat.dir); } catch { continue; }
    for (const f of entries.filter(x => x.endsWith(SPEC_EXT)).sort()) {
      out.push(`${cat.prefix}/${f}`);
    }
  }
  return out;
}

function activeCategories() {
  const files = scanTestFiles();
  return CATEGORIES
    .filter(cat => files.some(f => f.startsWith(cat.prefix + '/')))
    .map(({ key, label, icon, prefix }) => ({ key, label, icon, prefix }));
}
```

- [ ] **Step 3: Replace `isKnownSpecFile` to check every category dir**

Replace `progress-server.js:73-78`:

```js
function isKnownSpecFile(fileParam) {
  if (!fileParam || (!fileParam.endsWith('.spec.ts') && !fileParam.endsWith('.spec.js'))) return false;
  const candidate = path.resolve(ROOT, fileParam);
  return CATEGORIES.some(cat => {
    const rel = path.relative(cat.dir, candidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}
```

- [ ] **Step 4: Manual smoke check**

Run: `node plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js` from a scratch dir with `tests/e2e/foo.spec.ts` present. Confirm it still starts cleanly and `curl -s http://127.0.0.1:7373/files` returns `{"files":["tests/e2e/foo.spec.ts"]}` exactly as before.

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): generalize E2E_DIR into a CATEGORIES array"
```

---

### Task 2: `progress-server.js` — `GET /categories` endpoint + exports

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:188-193` (after the `/files` handler)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:534-539` (`module.exports`)

**Interfaces:**
- Consumes: `activeCategories()` from Task 1.
- Produces: `GET /categories` — no auth token required (read-only, same tier as `/files`/`/history`) — returns `{ categories: [{key, label, icon, prefix}, ...] }`, only categories with ≥1 spec file present.

- [ ] **Step 1: Add the route**

Insert immediately after the `/files` handler block (`progress-server.js:188-193`):

```js
  // ── GET /categories ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/categories') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ categories: activeCategories() }));
    return;
  }
```

- [ ] **Step 2: Export the new names**

Replace `progress-server.js:534-539`:

```js
module.exports = {
  server, state, resetRunState, applyEvent, safeArtifactPath,
  TOKEN, HOST, scanTestFiles, checkToken,
  isKnownSpecFile, isKnownSpecFileArg, hasShellMetachars,
  pendingRuns, activeCategories, CATEGORIES,
};
```

- [ ] **Step 3: Manual smoke check**

With the server running, `curl -s http://127.0.0.1:7373/categories` returns `{"categories":[{"key":"e2e","label":"E2E / Smoke","icon":"🧭","prefix":"tests/e2e"}]}` for a project with only `tests/e2e/` populated.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): add GET /categories endpoint"
```

---

### Task 3: Dashboard HTML — category-tab CSS + markup

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:140-144` (CSS, near `.sidebar-top`)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:372-375` (sidebar markup)

**Interfaces:**
- Consumes: nothing (styling/markup only — wired up in Task 4/5).
- Produces: `#category-tabs` container element, starts `hidden`.

- [ ] **Step 1: Add CSS**

Insert after `test-progress-dashboard.html:144` (`#file-search:focus { border-color: var(--blue); }`):

```css
  .category-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
  .cat-tab { background: transparent; color: var(--muted); padding: 3px 8px; border-radius: 5px; font-size: 10px; font-weight: 600; border: 1px solid var(--border); cursor: pointer; white-space: nowrap; }
  .cat-tab.active { background: var(--surface2); color: var(--text); border-color: var(--blue); }
  .cat-tab:hover:not(.active) { color: var(--text); }
```

- [ ] **Step 2: Add the container to the sidebar**

Replace `test-progress-dashboard.html:372-375`:

```html
    <div class="sidebar-top">
      <div class="sidebar-heading" id="sidebar-heading">Test Files</div>
      <div class="category-tabs hidden" id="category-tabs"></div>
      <input type="search" id="file-search" placeholder="🔍 Filter files…" oninput="filterSidebar(this.value)">
    </div>
```

- [ ] **Step 3: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): add category-tab CSS and container markup"
```

---

### Task 4: Dashboard HTML — category state, data loading, click handling

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:448-453` (app state)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:460-462` (click delegation, top of handler)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:762-768` (`loadFiles`)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:1226-1227` (boot section)

**Interfaces:**
- Consumes: `GET /categories` from Task 2.
- Produces: `categories: Array<{key,label,icon,prefix}>` (module-scope var, default `[]`).
- Produces: `activeCategory: string | null` (module-scope var, `null` = "All").
- Produces: `categoryOf(file): {key,label,icon,prefix} | undefined` — looks up which category a file path belongs to by prefix match.
- Produces: `selectCategory(key: string | null): void` — sets `activeCategory`, clears `selectedFile` if it no longer belongs to the new category, re-renders.
- Produces: `loadCategories(): Promise<void>` — fetches `/categories` into `categories`.

- [ ] **Step 1: Add state vars**

Replace `test-progress-dashboard.html:448-453`:

```js
let filterFailed   = false;
let compactMode    = false;
let sortBy         = 'default';
let testSearch     = '';
let fgCollapsed    = false;
let categories     = [];
let activeCategory = null;
```

- [ ] **Step 2: Add `categoryOf` and `selectCategory` near `mergedFiles`**

Insert immediately before `function mergedFiles()` (currently `test-progress-dashboard.html:866`):

```js
function categoryOf(file) {
  return categories.find(c => file.startsWith(c.prefix + '/'));
}

function selectCategory(key) {
  activeCategory = key || null;
  if (selectedFile && activeCategory) {
    const cat = categories.find(c => c.key === activeCategory);
    if (cat && !selectedFile.startsWith(cat.prefix + '/')) selectedFile = null;
  }
  render();
}
```

- [ ] **Step 3: Handle clicks on `.cat-tab`**

In the click-delegation handler, insert right after the opening line `document.addEventListener('click', e => {` (`test-progress-dashboard.html:460`):

```js
  const catTab = e.target.closest('.cat-tab');
  if (catTab) { selectCategory(catTab.dataset.cat || null); return; }
```

- [ ] **Step 4: Add `loadCategories`**

Insert immediately after `loadFiles` (`test-progress-dashboard.html:762-768`):

```js
async function loadCategories() {
  try {
    const r = await fetch(`${SERVER}/categories`);
    categories = (await r.json()).categories || [];
    render();
  } catch {}
}
```

- [ ] **Step 5: Call it at boot**

Replace `test-progress-dashboard.html:1226-1227`:

```js
loadFiles();
loadCategories();
loadHistory();
```

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): load categories and wire up category-tab selection"
```

---

### Task 5: Dashboard HTML — render tabs, filter sidebar by category

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:801-808` (`render`)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:866-872` (`mergedFiles`)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:885-913` (`renderSidebar`)

**Interfaces:**
- Consumes: `categories`, `activeCategory`, `categoryOf` from Task 4.
- Produces: `renderCategoryTabs(): void` — new function, renders/hides the `#category-tabs` row.
- Produces: `mergedFiles()` — same signature, now also filtered by `activeCategory` when set.

- [ ] **Step 1: Add `renderCategoryTabs` and call it from `render()`**

Replace `test-progress-dashboard.html:801-808`:

```js
function render() {
  renderHeader();
  renderStats();
  renderProgress();
  renderCategoryTabs();
  renderSidebar();
  renderContent();
  if (selectedTestId && !document.getElementById('detail-panel').classList.contains('closed')) renderDetail();
}

function renderCategoryTabs() {
  const el = document.getElementById('category-tabs');
  if (categories.length < 2) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  let html = `<button class="cat-tab${activeCategory === null ? ' active' : ''}" data-cat="">All</button>`;
  for (const c of categories) {
    html += `<button class="cat-tab${activeCategory === c.key ? ' active' : ''}" data-cat="${h(c.key)}">${c.icon} ${h(c.label)}</button>`;
  }
  el.innerHTML = html;
}
```

- [ ] **Step 2: Filter `mergedFiles()` by `activeCategory`**

Replace `test-progress-dashboard.html:866-872`:

```js
let sidebarFilter = '';
function filterSidebar(v) { sidebarFilter = v.toLowerCase(); renderSidebar(); }

function mergedFiles() {
  const fromState = state
    ? Object.keys(state.suites).filter(f => f.endsWith('.spec.ts') || f.endsWith('.spec.js'))
    : [];
  let all = [...new Set([...availableFiles, ...fromState])].sort();
  if (activeCategory) {
    const cat = categories.find(c => c.key === activeCategory);
    if (cat) all = all.filter(f => f.startsWith(cat.prefix + '/'));
  }
  return sidebarFilter ? all.filter(f => f.toLowerCase().includes(sidebarFilter)) : all;
}
```

- [ ] **Step 3: Prefix each sidebar row with its category icon when viewing "All"**

Replace `test-progress-dashboard.html:897-911` (the `for (const file of files) {...}` loop body inside `renderSidebar`):

```js
  for (const file of files) {
    const suite  = s && s.suites[file];
    const tests  = suite ? suite.tests : [];
    const st     = suiteStatus(tests);
    const passC  = tests.filter(id => s?.tests[id]?.status === 'passed').length;
    const short  = file.split('/').pop();
    const active = selectedFile === file;
    const fail   = st === 'failed';
    const cat    = categories.length > 1 && !activeCategory ? categoryOf(file) : null;
    const icon   = cat ? `${cat.icon} ` : '';
    html += `<div class="suite-item${active ? ' active' : ''}${fail ? ' has-fail' : ''}" data-file="${h(file)}">
      <span class="suite-icon">${suiteIcon(st)}</span>
      <span class="suite-name" title="${h(file)}">${icon}${h(short)}</span>
      <span class="suite-count">${tests.length ? `${passC}/${tests.length}` : ''}</span>
      <button class="suite-run-btn" data-run-file="${h(file)}" title="Run ${h(short)}">▶</button>
    </div>`;
  }
```

- [ ] **Step 4: Manual smoke check**

With a project that only has `tests/e2e/`, load the dashboard and confirm `#category-tabs` stays empty/hidden and the sidebar looks unchanged. Then manually create `tests/security/example.spec.ts` in that project, refresh, and confirm three tabs ("All", "🧭 E2E / Smoke", "🛡️ Security") appear and clicking each filters the sidebar file list correctly.

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): render category tabs, filter sidebar by active category"
```

---

### Task 6: `node:test` — multi-category unit coverage in `progress-server.test.js`

**Files:**
- Modify: `plugins/e2e-dashboard/tests/progress-server.test.js:2` (import line)
- Modify: `plugins/e2e-dashboard/tests/progress-server.test.js` (append new `describe` block at end of file)
- Create: `plugins/e2e-dashboard/tests/fixtures/security-example.spec.ts`

**Interfaces:**
- Consumes: `CATEGORIES`/`scanTestFiles`/`isKnownSpecFile`/`activeCategories` exports from Task 1–2.

- [ ] **Step 1: Create the second fixture spec file**

```typescript
// plugins/e2e-dashboard/tests/fixtures/security-example.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Security smoke', () => {
  test('should pass', async () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Import `describe`**

Replace `progress-server.test.js:2`:

```js
const { test, before, after, describe } = require('node:test');
```

- [ ] **Step 3: Append the multi-category `describe` block**

Add at the end of `plugins/e2e-dashboard/tests/progress-server.test.js`:

```js
const SECURITY_FIXTURE = path.join(__dirname, 'fixtures', 'security-example.spec.ts');

describe('multi-category CATEGORIES support', () => {
  let catRoot;

  before(() => {
    // Simulate what the e2e-dashboard installer writes for a two-category
    // project: substitute the %%ADAPT_CATEGORIES%% line with a real
    // multi-entry array, exactly as SKILL.md Phase 3 instructs, then require
    // that adapted copy — this exercises the real installed code path
    // instead of just the shipped single-category default.
    catRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-cat-'));
    fs.mkdirSync(path.join(catRoot, 'tests', 'e2e'), { recursive: true });
    fs.mkdirSync(path.join(catRoot, 'tests', 'security'), { recursive: true });
    fs.mkdirSync(path.join(catRoot, 'tests', 'reporters'), { recursive: true });
    fs.copyFileSync(FIXTURE_SPEC, path.join(catRoot, 'tests', 'e2e', 'example.spec.ts'));
    fs.copyFileSync(SECURITY_FIXTURE, path.join(catRoot, 'tests', 'security', 'headers.spec.ts'));

    const src = fs.readFileSync(TEMPLATE, 'utf8');
    const adapted = src.replace(
      /^const CATEGORIES.*%%ADAPT_CATEGORIES%%.*$/m,
      `const CATEGORIES = [
        { key: 'e2e',      label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'),      prefix: 'tests/e2e' },
        { key: 'security', label: 'Security',    icon: '🛡️', dir: path.join(ROOT, 'tests', 'security'), prefix: 'tests/security' },
      ];`
    );
    assert.notEqual(adapted, src, 'the %%ADAPT_CATEGORIES%% marker line must exist for this substitution to work');
    fs.writeFileSync(path.join(catRoot, 'tests', 'reporters', 'progress-server.js'), adapted);
  });

  after(() => {
    fs.rmSync(catRoot, { recursive: true, force: true });
  });

  test('scanTestFiles finds files across every configured category dir', () => {
    const mod = require(path.join(catRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.deepEqual(
      mod.scanTestFiles().sort(),
      ['tests/e2e/example.spec.ts', 'tests/security/headers.spec.ts'].sort()
    );
  });

  test('isKnownSpecFile accepts a file inside a non-default category dir', () => {
    const mod = require(path.join(catRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.equal(mod.isKnownSpecFile('tests/security/headers.spec.ts'), true);
  });

  test('isKnownSpecFile still rejects traversal outside every configured category dir', () => {
    const mod = require(path.join(catRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.equal(mod.isKnownSpecFile('../../../etc/passwd.spec.ts'), false);
  });

  test('activeCategories only reports categories that actually contain a spec file', () => {
    const mod = require(path.join(catRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.deepEqual(mod.activeCategories().map(c => c.key).sort(), ['e2e', 'security']);
  });
});
```

- [ ] **Step 4: Run the suite**

Run: `node --test plugins/e2e-dashboard/tests/progress-server.test.js`
Expected: all tests pass, including the 4 new ones plus the pre-existing ones untouched.

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/tests/progress-server.test.js plugins/e2e-dashboard/tests/fixtures/security-example.spec.ts
git commit -m "test(e2e-dashboard): add multi-category unit coverage for CATEGORIES support"
```

---

### Task 7: `node:test` — multi-category HTTP coverage in `progress-server-http.test.js`

**Files:**
- Modify: `plugins/e2e-dashboard/tests/progress-server-http.test.js:2` (import line)
- Modify: `plugins/e2e-dashboard/tests/progress-server-http.test.js` (append test + `describe` block)

**Interfaces:**
- Consumes: `GET /categories`, `GET /files` from Task 2. `SECURITY_FIXTURE` path from Task 6.

- [ ] **Step 1: Import `describe`**

Replace `progress-server-http.test.js:2`:

```js
const { test, before, after, describe } = require('node:test');
```

- [ ] **Step 2: Add a backward-compat assertion to the existing single-category server**

Add anywhere among the existing top-level `test(...)` calls in `progress-server-http.test.js` (after the `/filetests` traversal test):

```js
test('GET /categories returns a single category for a project with only tests/e2e/', async () => {
  const res = await fetch(origin + '/categories');
  const json = await res.json();
  assert.deepEqual(json.categories.map(c => c.key), ['e2e']);
});
```

- [ ] **Step 3: Add the multi-category `describe` block**

Add at the end of `plugins/e2e-dashboard/tests/progress-server-http.test.js`:

```js
const SECURITY_FIXTURE = path.join(__dirname, 'fixtures', 'security-example.spec.ts');

describe('multi-category HTTP behavior', () => {
  let catRoot, catChild, catOrigin;

  before(async () => {
    catRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-cat-http-'));
    fs.mkdirSync(path.join(catRoot, 'tests', 'e2e'), { recursive: true });
    fs.mkdirSync(path.join(catRoot, 'tests', 'security'), { recursive: true });
    fs.mkdirSync(path.join(catRoot, 'tests', 'reporters'), { recursive: true });
    fs.mkdirSync(path.join(catRoot, 'test-results'), { recursive: true });
    fs.copyFileSync(FIXTURE_SPEC, path.join(catRoot, 'tests', 'e2e', 'example.spec.ts'));
    fs.copyFileSync(SECURITY_FIXTURE, path.join(catRoot, 'tests', 'security', 'headers.spec.ts'));
    fs.copyFileSync(HTML, path.join(catRoot, 'tests', 'test-progress-dashboard.html'));
    fs.copyFileSync(REPORTER, path.join(catRoot, 'tests', 'reporters', 'realtime-reporter.js'));

    const src = fs.readFileSync(TEMPLATE, 'utf8');
    const adapted = src.replace(
      /^const CATEGORIES.*%%ADAPT_CATEGORIES%%.*$/m,
      `const CATEGORIES = [
        { key: 'e2e',      label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'),      prefix: 'tests/e2e' },
        { key: 'security', label: 'Security',    icon: '🛡️', dir: path.join(ROOT, 'tests', 'security'), prefix: 'tests/security' },
      ];`
    );
    fs.writeFileSync(path.join(catRoot, 'tests', 'reporters', 'progress-server.js'), adapted);

    catChild = spawn(process.execPath, [path.join(catRoot, 'tests', 'reporters', 'progress-server.js')], {
      cwd: catRoot,
      env: { ...process.env, E2E_DASHBOARD_PORT: '0' },
    });
    const originMatch = await waitForLine(catChild.stdout, /Listening on (http:\/\/127\.0\.0\.1:\d+)/);
    catOrigin = originMatch[1];
  });

  after(async () => {
    if (catChild) {
      catChild.kill();
      await new Promise(resolve => {
        if (catChild.exitCode !== null) return resolve();
        catChild.once('exit', resolve);
        setTimeout(resolve, 3000);
      });
    }
    fs.rmSync(catRoot, { recursive: true, force: true });
  });

  test('GET /categories reports both categories for a two-category project', async () => {
    const res = await fetch(catOrigin + '/categories');
    const json = await res.json();
    assert.deepEqual(json.categories.map(c => c.key).sort(), ['e2e', 'security']);
  });

  test('GET /files lists spec files from every category dir', async () => {
    const res = await fetch(catOrigin + '/files');
    const json = await res.json();
    assert.deepEqual(
      json.files.sort(),
      ['tests/e2e/example.spec.ts', 'tests/security/headers.spec.ts'].sort()
    );
  });
});
```

- [ ] **Step 4: Run the full suite**

Run: `node --test plugins/e2e-dashboard/tests/`
Expected: all tests pass — pre-existing tests unchanged plus the new single-category and multi-category coverage.

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/tests/progress-server-http.test.js
git commit -m "test(e2e-dashboard): add multi-category HTTP coverage for /categories and /files"
```

---

### Task 8: `e2e-dashboard` SKILL.md — installer discovery + adapt-marker docs

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md:14-20` (features/security intro)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md:28-50` (Phase 1 Discovery table)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md:70-93` (Phase 3 Adapt table)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md:151-160` (Common Pitfalls table)

**Interfaces:**
- Consumes: nothing (docs-only) — describes Task 1–2's `CATEGORIES` shape and the `%%ADAPT_CATEGORIES%%` marker so a fresh agent installing this skill on a new project can adapt it correctly.

- [ ] **Step 1: Update the features line and bump the count**

Replace `SKILL.md:18` (the "14 features" — already "16 features" per the file header on this branch, confirm the actual current wording and bump it by one for category tabs):

```markdown
**17 features**: live SSE stream · sidebar file filter · category tabs (auto-hidden when only one test category — E2E, Security, or Perf — is installed) · per-file/per-test run buttons · re-run failed · failures-only toggle · test name search · sort (default/failed-first/slowest) · describe-block nesting · flakiness badge (from run history) · ETA during run · screenshot thumbnails · Playwright Trace Viewer integration · copy error button · browser notifications · compact mode · keyboard shortcuts · auto-scroll to first failure · failure grouping by error pattern · auto-opens the dashboard in your default browser when the server starts (disable with `E2E_NO_OPEN=1` or in CI) · download report buttons.
```

(Keep every clause already present in the file's current features line — only insert the new "category tabs" clause and bump the leading count by one; do not drop any existing clause.)

- [ ] **Step 2: Add `category_dirs` to the Phase 1 Discovery table**

Insert a new row into the Phase 1 Discovery table (`SKILL.md:28-35`), directly after the `e2e_dir` row:

```markdown
| `category_dirs` | Sibling directories of `e2e_dir`'s parent (`{root}/tests/*/`) that contain `*{spec_ext}` files — use Glob `tests/*/*.spec.ts` (or `.js`) | just `e2e` if none found — no behavior change for existing single-category projects |
```

Add a short paragraph after the table:

```markdown
If Glob finds more than one populated `tests/<name>/` directory, confirm the full set with the user in the same discovery/confirmation message from Phase 1 — don't silently drop any of them. If only one is found (or the project is a first-time install with no test files yet), proceed with the single-category `e2e` default exactly as documented below — this is the common case and needs no extra confirmation.
```

- [ ] **Step 3: Replace the Phase 3 Adapt table's `%%ADAPT_E2E_DIR%%`/`%%ADAPT_FILE_PREFIX%%` rows with `%%ADAPT_CATEGORIES%%`**

Replace the two rows for `%%ADAPT_E2E_DIR%%` and `%%ADAPT_FILE_PREFIX%%` in the Phase 3 table (`SKILL.md:74-80`) with a single row:

```markdown
| `%%ADAPT_CATEGORIES%%` | `const CATEGORIES = [ ... ];` — one object per detected category dir, see below |
```

Then add this section immediately after the table (before the "Example for a project where reporters are at..." paragraph):

```markdown
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
```

- [ ] **Step 4: Add a Common Pitfalls row**

Add to the Common Pitfalls table (`SKILL.md:151-160`):

```markdown
| Category tabs not showing | By design when only one category dir has spec files — `GET /categories` returns a single entry and the tab row stays hidden. Add a second `tests/<category>/*.spec.ts` file (e.g. via `/playwright-setup` with Security-smoke or Perf-smoke selected) to see tabs appear. |
```

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md
git commit -m "docs(e2e-dashboard): document CATEGORIES discovery/adaptation and category tabs"
```

---

### Task 9: `playwright-setup` SKILL.md — Test Categories interview question

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md:69-78` (Phase 2 Required-info table)

**Interfaces:**
- Consumes: nothing (interview guidance only).
- Produces: a defined interview step that later phases (Task 10) key off — the selected category set.

- [ ] **Step 1: Add a "Test categories" row to the Required table**

Insert a new row 7 into the Phase 2 Required table (`SKILL.md:71-78`), and renumber the existing CI/CD row from 6 to keep it — insert the new row *before* CI/CD since category selection affects earlier planning decisions:

```markdown
| # | Question | Why needed |
|---|----------|-----------|
| 1 | **App type** | SPA, SSR, multi-page? Single URL or multiple? |
| 2 | **Base URLs** | Dev server URLs (frontend, admin, API) |
| 3 | **Auth** | Is login required? What credentials? How many roles? |
| 4 | **Critical flows** | Top 3–5 user journeys that MUST be tested (e.g. "register → book → cancel") |
| 5 | **Out of scope** | Any pages/flows explicitly NOT to test now |
| 6 | **Test categories** | Which test categories to scaffold — see "Test Categories" below |
| 7 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`, and whether a `.github/workflows/e2e.yml` is generated in Phase 4) |
```

- [ ] **Step 2: Add the "Test Categories" section**

Insert a new section immediately after the Required table and before the "Optional" bullet list (`SKILL.md:80`):

```markdown
### Test Categories

Ask this as a dedicated multi-select question — use the `AskUserQuestion` tool with `multiSelect: true` — rather than folding it into the free-text interview message:

- **E2E / Smoke** (default selected) — user-journey specs under `tests/e2e/`. This is what Phase 3/4 already produce and is the only category most projects need.
- **Security-smoke** — `tests/security/` specs covering response security headers, an auth-bypass probe, and a reflected-input/XSS check. This is a lightweight smoke layer, **not a substitute for real penetration testing** — say so explicitly if the user's framing suggests they expect full pentest coverage.
- **Performance-smoke** — `tests/perf/` specs asserting page-load timing budgets via the browser's Navigation Timing API. This is a lightweight smoke layer, **not a substitute for real load testing** (concurrent virtual users) — say so explicitly if the user's framing suggests they expect load-test coverage.

Selecting more than one category changes `playwright.config.ts`'s `testDir` in Phase 4 and adds the corresponding spec-file sections to the Phase 3 plan and Phase 4 implementation.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): add multi-select Test Categories interview question"
```

---

### Task 10: `playwright-setup` SKILL.md — security-smoke & perf-smoke generation guidance

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md:96-145` (Phase 3 Test Plan format)
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md:148-200` (Phase 4, `playwright.config.ts` section)
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md:243-276` (Phase 4, after the E2E spec-file style rules)
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md:329-361` (Phase 5 Confirm report)

**Interfaces:**
- Consumes: the category selection from Task 9's interview question.

- [ ] **Step 1: Note per-category grouping in the Phase 3 Test Plan format**

Add a sentence right after the Phase 3 heading's intro paragraph ("Present as a structured table. Show EVERY planned test — not just files.", `SKILL.md:98`):

```markdown
When more than one category was selected in Phase 2, group the "Files to create" and "Test titles" tables by category (E2E / Smoke, Security-smoke, Performance-smoke, in that order) instead of one flat list — each category gets its own subheading.
```

- [ ] **Step 2: Add `testDir` adaptation guidance to the `playwright.config.ts` section**

Insert immediately after the existing "Adapt: remove `globalSetup` if not needed..." paragraph (`SKILL.md:199`):

```markdown
`testDir` depends on how many categories were selected in Phase 2:
- **Single category (E2E only, the default):** `testDir: './tests/e2e'` — unchanged from today.
- **Two or more categories:** `testDir: './tests'` (the parent dir) so Playwright's default recursive glob (`**/*.spec.ts`) picks up `tests/e2e/`, `tests/security/`, and `tests/perf/` together. Do not add a `testMatch` override — the default pattern already covers all three subfolders.
```

- [ ] **Step 3: Add the Security-smoke spec-file section**

Insert a new subsection after the existing "#### DO NOT" list (`SKILL.md:271-276`), before the `.env.test` section:

```markdown
#### Security-smoke spec files (only if selected in Phase 2)

Write to `tests/security/*.spec.ts`. Start every security-smoke file with this header comment so it's unambiguous in review:

```typescript
// Security SMOKE checks — not a penetration test. Verifies baseline hygiene
// (headers, auth gating, reflected-input handling) on every CI run; it does
// not replace a real security assessment.
import { test, expect } from '@playwright/test';

test.describe('Security headers', () => {
  test('should set core security headers on the home page', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options'] || headers['content-security-policy']).toBeTruthy();
  });
});

test.describe('Auth bypass', () => {
  test('should redirect unauthenticated users away from a protected page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/login/);
  });
});

test.describe('Reflected input handling', () => {
  test('should not execute a script injected via a query parameter', async ({ page }) => {
    await page.goto('/search?q=%3Cscript%3Ewindow.__xss_marker__=true%3C%2Fscript%3E');
    const executed = await page.evaluate(() => (window /** @type {any} */)['__xss_marker__']);
    expect(executed).toBeUndefined();
  });
});
```

Adapt the URLs/selectors to the actual project (a real protected route for the auth-bypass test, a real user-input-reflecting page for the injection test). If no page reflects raw query/form input anywhere, say so in the Phase 3 plan and drop that one test rather than inventing a fake target.
```

- [ ] **Step 4: Add the Performance-smoke spec-file section**

Insert immediately after the Security-smoke section from Step 3:

```markdown
#### Performance-smoke spec files (only if selected in Phase 2)

Write to `tests/perf/*.spec.ts`. Uses the browser's built-in Navigation Timing API — no new dependency. Start every perf-smoke file with this header comment:

```typescript
// Performance SMOKE checks — not a load test. Asserts single-user page-load
// timing budgets on every CI run; it does not simulate concurrent traffic.
import { test, expect } from '@playwright/test';

const BUDGET_MS = 3000; // adjust to the project's actual SLA

test.describe('Page load budget', () => {
  test('should load the home page within budget', async ({ page }) => {
    await page.goto('/');
    const timing = await page.evaluate(() => {
      const [nav] = performance.getEntriesByType('navigation');
      return { domContentLoaded: nav.domContentLoadedEventEnd, loadEvent: nav.loadEventEnd };
    });
    expect(timing.domContentLoaded).toBeLessThan(BUDGET_MS);
  });
});
```

Add one `test()` per critical page from the Phase 2 "Critical flows" answer, not just the home page — reuse `BUDGET_MS` unless the user gave a different budget for a specific page.
```

- [ ] **Step 5: Mention categories in the Phase 5 Confirm report**

Add a line to the Phase 5 report template, right after the "Files created" list (`SKILL.md:339-345`):

```markdown
### Categories scaffolded
- E2E / Smoke: N tests
- Security-smoke: N tests (smoke-level only — not a penetration test)   ← only if selected
- Performance-smoke: N tests (smoke-level only — not a load test)      ← only if selected
```

- [ ] **Step 6: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): generate security-smoke and perf-smoke spec files"
```

---

### Task 11: README — mention multi-category support

**Files:**
- Modify: `README.md:9-10` (skill summary table)

**Interfaces:**
- Consumes: nothing (docs-only).

- [ ] **Step 1: Update the two summary rows**

Replace `README.md:9-10`:

```markdown
| **playwright-setup** | Scans project docs/source, interviews you, generates a complete Playwright test suite (E2E/Smoke, plus optional Security-smoke and Performance-smoke) + config from scratch. |
| **e2e-dashboard** | Installs a real-time Playwright test dashboard (live SSE progress, 17 features, category tabs when multiple test types are installed) into any project. |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: mention multi-category test support in the README summary"
```

---

### Task 12: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Scratch-project run-through**

In a throwaway scratch directory with a trivial static site (or any existing sample app):
1. Run `/playwright-setup`, select all three categories when asked (E2E/Smoke, Security-smoke, Performance-smoke).
2. Confirm the generated `playwright.config.ts` has `testDir: './tests'` and that `tests/e2e/`, `tests/security/`, `tests/perf/` all contain spec files.
3. Run `npx playwright test --list` and confirm it reports tests from all three directories.
4. Run `/e2e-dashboard` to install the dashboard into the same project.
5. Start it (`node tests/reporters/progress-server.js`), open the dashboard, and confirm three category tabs render ("All", "🧭 E2E / Smoke", "🛡️ Security", "⚡ Performance") and each filters the sidebar correctly.
6. Click "▶ Run All" and confirm tests from every category run and report through the same live SSE stream.

- [ ] **Step 2: Backward-compatibility check**

In a second scratch project, run `/playwright-setup` selecting **only** E2E/Smoke, then `/e2e-dashboard`. Confirm the dashboard looks pixel-identical to the pre-this-plan UI — no visible category-tab row, `testDir` is `./tests/e2e` as before.

- [ ] **Step 3: Record the outcome**

No commit for this task — if either check fails, open a follow-up task against the specific broken step rather than proceeding to consider the plan complete.

---

## Explicitly out of scope for this plan

- **Unit testing.** Wrong layer for `playwright-setup`/`e2e-dashboard` — unit tests exercise source functions directly (Jest/Vitest/etc.), not the running UI Playwright drives. A separate skill would be needed; not attempted here.
- **Real Penetration Testing and Load Testing.** Both need dedicated tooling (OWASP ZAP/Burp for pentest; k6/Artillery for load) that Playwright itself cannot provide — simulating concurrent virtual users or running exploit chains is outside what a browser-automation framework does. The Security-smoke and Performance-smoke categories added here are deliberately named and documented as lightweight smoke layers, not replacements. A future plan could add a dashboard "external scan" tab that shells out to k6/ZAP and displays their output, but that is a materially different, larger feature and is deferred.
