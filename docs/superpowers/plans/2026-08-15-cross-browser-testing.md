# Cross-Browser Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `playwright-setup` configure multiple Playwright browser/device projects (Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari) and let `e2e-dashboard` select which of them to run per-run, show live per-browser results grouped by test, and summarize pass/fail per browser.

**Architecture:** The reporter tags every event with `browser` (the Playwright project name); the server keys `state.tests`/`state.steps` by a composite `${browser}::${id}` instead of the bare test id, so results from different browsers for the same test never collide and the frontend can tell them apart. Every existing consumer of `state.tests` (run-history, flakiness detection, static CI-report mode) needs zero further changes because they all read `t.id` generically — as long as `id` is set to the composite key on every stored test object, they keep working unmodified. `playwright-setup` gains a browser/device multi-select in its interview and generates one `projects[]` entry per selection; when 2+ are selected, each project also gets an index-based window-tiling override so multiple Interactive-mode windows don't stack on top of each other.

**Tech Stack:** Same as every prior task this session — Node core only in `progress-server.js` (no new dependency), vanilla JS/CSS in the dashboard HTML, `node:test` for coverage, Markdown for both skills' `SKILL.md`.

## Global Constraints

- **No new npm dependencies** anywhere in `plugins/e2e-dashboard/` or added automatically to consumer projects by `playwright-setup`.
- **Backward compatibility is mandatory** for every single-browser project (today's default and every existing install): `GET /browsers` returns exactly one entry, the browser dropdown never renders, test rows render exactly as today (no nesting, no browser badge), the summary strip never appears, and the generated `playwright.config.ts`'s `use:` block is byte-for-byte unchanged from today when only one browser is selected — the new per-project window-tiling mechanism only activates for 2+ browsers.
- **Composite key format is `${browser}::${id}`**, stored verbatim as the `id` field on every `state.tests`/`state.steps` entry — every existing consumer (`saveHistory`, `isFlaky`, `testHistoryDots`, click-delegation `data-id` attributes) must keep working unmodified because they only ever read/pass through `t.id` generically, never parse or reconstruct it.
- **Accepted, documented tradeoff:** upgrading an existing project resets its flakiness/run-history matching for entries recorded before the upgrade (old bare-id history entries won't match new composite-keyed test ids). This is a one-time, graceful degradation — old entries just stop matching rather than crashing or corrupting anything. Not a regression to fix, a known cost of the format change.
- **Whitelist discipline**: `browsers` values in `POST /run` are validated against the configured `BROWSERS` array's keys before being used to build `--project=` arguments — same discipline as every other user-facing input this session (`file`, `category`, `key`). Reject unknown names with 400.
- **Window tiling never breaks single-browser Interactive mode**: `progress-server.js` continues emitting the legacy `PW_WIN_X/Y/W/H` env vars (computed from the first tile slot) in addition to the new `PW_WIN_LAYOUT` JSON array — an existing single-project `playwright.config.ts` that only reads `PW_WIN_X` keeps working exactly as before, even without regenerating.
- Templates stay single-file-per-concern — do not split `progress-server.js`/`test-progress-dashboard.html` into a `lib/` folder.

---

## Part A — Server core

### Task 1: `BROWSERS` array + `GET /browsers`

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`

**Interfaces:**
- Produces: `BROWSERS: Array<{key, label, icon}>` (module-scope const, default single `chromium` entry).
- Produces: `GET /browsers` → `{ browsers: BROWSERS }` — no auth token (read-only, same tier as `/categories`).
- Produces: module export gains `BROWSERS`.

- [ ] **Step 1: Add the `BROWSERS` constant**

Find `const CATEGORIES    = [ { key: 'e2e', ... } ]; // %%ADAPT_CATEGORIES%%` (search for `%%ADAPT_CATEGORIES%%`) and insert immediately after it:

```js
const BROWSERS      = [ { key: 'chromium', label: 'Chromium', icon: '🧭' } ]; // %%ADAPT_BROWSERS%%
```

- [ ] **Step 2: Add the route**

Insert immediately after the `GET /categories` route block (search for `if (req.method === 'GET' && req.url === '/categories')`, insert after its closing `}`):

```js
  // ── GET /browsers ────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/browsers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ browsers: BROWSERS }));
    return;
  }
```

- [ ] **Step 3: Export `BROWSERS`**

Find `module.exports = { ... };` and add `BROWSERS,` to the list.

- [ ] **Step 4: Manual smoke check**

Start the server from a scratch project, `curl -s http://127.0.0.1:7373/browsers` should return `{"browsers":[{"key":"chromium","label":"Chromium","icon":"🧭"}]}`.

- [ ] **Step 5: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass (28/28 as of this branch's base).

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): add BROWSERS config and GET /browsers endpoint"
```

---

### Task 2: `realtime-reporter.js` — tag every event with `browser`

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/realtime-reporter.js`

**Interfaces:**
- Produces: `testBrowser(test): string` — reads the Playwright project name via `test.parent?.project()?.name`.
- Produces: every posted event (`begin` excluded — it's suite-wide, not per-test) gains a `browser` field: `testBegin`, `testEnd`, `stepBegin`, `stepEnd`.

- [ ] **Step 1: Add the `testBrowser` helper**

Find `function testId(test) {` and insert immediately before it:

```js
function testBrowser(test) {
  return test.parent?.project()?.name || '';
}
```

- [ ] **Step 2: Tag `onTestBegin`**

Find:

```js
  onTestBegin(test) {
    post({
      type:      'testBegin',
      id:        testId(test),
      title:     test.title,
      describes: getDescribes(test),
      file:      testFile(test),
      line:      test.location?.line ?? null,
    });
  }
```

Replace with:

```js
  onTestBegin(test) {
    post({
      type:      'testBegin',
      id:        testId(test),
      title:     test.title,
      describes: getDescribes(test),
      file:      testFile(test),
      line:      test.location?.line ?? null,
      browser:   testBrowser(test),
    });
  }
```

- [ ] **Step 3: Tag `onTestEnd`**

Find:

```js
  onTestEnd(test, result) {
    const error = result.errors?.[0];
    const attachments = (result.attachments || [])
      .filter(a => a.path)
      .map(a => ({ name: a.name, path: a.path, contentType: a.contentType || '' }));
    post({
      type:        'testEnd',
      id:          testId(test),
      file:        testFile(test),
      status:      result.status,
      duration:    result.duration,
      retry:       result.retry || 0,
      attachments,
      error: error
        ? { message: error.message?.substring(0, 600), location: error.location }
        : null,
    });
  }
```

Replace with:

```js
  onTestEnd(test, result) {
    const error = result.errors?.[0];
    const attachments = (result.attachments || [])
      .filter(a => a.path)
      .map(a => ({ name: a.name, path: a.path, contentType: a.contentType || '' }));
    post({
      type:        'testEnd',
      id:          testId(test),
      file:        testFile(test),
      status:      result.status,
      duration:    result.duration,
      retry:       result.retry || 0,
      attachments,
      browser:     testBrowser(test),
      error: error
        ? { message: error.message?.substring(0, 600), location: error.location }
        : null,
    });
  }
```

- [ ] **Step 4: Tag `onStepBegin` and `onStepEnd`**

Find:

```js
  onStepBegin(test, result, step) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    post({
      type:     'stepBegin',
      id:       testId(test),
      title:    step.title.substring(0, 120),
      category: step.category,
    });
  }

  onStepEnd(test, result, step) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    post({
      type:     'stepEnd',
      id:       testId(test),
      title:    step.title.substring(0, 120),
      category: step.category,
      error:    step.error ? step.error.message?.substring(0, 300) : null,
    });
  }
```

Replace with:

```js
  onStepBegin(test, result, step) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    post({
      type:     'stepBegin',
      id:       testId(test),
      title:    step.title.substring(0, 120),
      category: step.category,
      browser:  testBrowser(test),
    });
  }

  onStepEnd(test, result, step) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    post({
      type:     'stepEnd',
      id:       testId(test),
      title:    step.title.substring(0, 120),
      category: step.category,
      error:    step.error ? step.error.message?.substring(0, 300) : null,
      browser:  testBrowser(test),
    });
  }
```

- [ ] **Step 5: Verify syntax**

Run: `node -c plugins/e2e-dashboard/skills/e2e-dashboard/templates/realtime-reporter.js`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/realtime-reporter.js
git commit -m "feat(e2e-dashboard): tag every reporter event with the Playwright project (browser) name"
```

---

### Task 3: `applyEvent` — composite `${browser}::${id}` keys

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`

**Interfaces:**
- Consumes: `browser` field from Task 2's tagged events.
- Produces: every `state.tests[key]`/`state.steps[key]` entry is now keyed by `${browser}::${id}`; the stored test object's own `.id` field equals this same composite key (so every existing reader of `t.id` — `saveHistory`, click-delegation `data-id`, `isFlaky`, `testHistoryDots` — keeps working with zero changes elsewhere).
- Produces: every stored test object gains a `browser: string` field.
- Produces: `stateFromPlaywrightJson` (static CI-report mode) uses the same composite-key format, reading `projectName` from Playwright's JSON reporter schema, so a static multi-project report renders consistently with a live multi-browser run.

- [ ] **Step 1: Rewrite `testBegin`**

Find:

```js
    case 'testBegin': {
      const { id, title, file, line, describes = [] } = event;
      if (state.tests[id]) {
        const prev = state.tests[id].status;
        if (prev === 'passed')                              state.passed  = Math.max(0, state.passed  - 1);
        else if (prev === 'failed' || prev === 'timedOut') state.failed  = Math.max(0, state.failed  - 1);
        else if (prev === 'skipped')                       state.skipped = Math.max(0, state.skipped - 1);
        state.tests[id].status   = 'running';
        state.tests[id].describes = describes;
        state.steps[id] = [];
      } else {
        state.tests[id] = { id, title, file, line: line || null, describes, status: 'running', duration: null, error: null, attachments: [], retry: 0 };
        state.steps[id] = [];
        if (!state.suites[file]) state.suites[file] = { file, tests: [] };
        if (!state.suites[file].tests.includes(id)) state.suites[file].tests.push(id);
        state.total = Math.max(state.total, Object.keys(state.tests).length);
      }
      state.running++;
      break;
    }
```

Replace with:

```js
    case 'testBegin': {
      const { id, title, file, line, describes = [], browser = '' } = event;
      const key = `${browser}::${id}`;
      if (state.tests[key]) {
        const prev = state.tests[key].status;
        if (prev === 'passed')                              state.passed  = Math.max(0, state.passed  - 1);
        else if (prev === 'failed' || prev === 'timedOut') state.failed  = Math.max(0, state.failed  - 1);
        else if (prev === 'skipped')                       state.skipped = Math.max(0, state.skipped - 1);
        state.tests[key].status   = 'running';
        state.tests[key].describes = describes;
        state.steps[key] = [];
      } else {
        state.tests[key] = { id: key, title, file, line: line || null, describes, browser, status: 'running', duration: null, error: null, attachments: [], retry: 0 };
        state.steps[key] = [];
        if (!state.suites[file]) state.suites[file] = { file, tests: [] };
        if (!state.suites[file].tests.includes(key)) state.suites[file].tests.push(key);
        state.total = Math.max(state.total, Object.keys(state.tests).length);
      }
      state.running++;
      break;
    }
```

- [ ] **Step 2: Rewrite `testEnd`**

Find:

```js
    case 'testEnd': {
      const { id, status, duration, error, attachments = [], retry = 0 } = event;
      if (state.tests[id]) {
        const prev = state.tests[id].status;
        state.tests[id].status      = status;
        state.tests[id].duration    = duration;
        state.tests[id].error       = error || null;
        state.tests[id].attachments = attachments;
        state.tests[id].retry       = retry;
        if (prev === 'running') state.running = Math.max(0, state.running - 1);
      }
      if (status === 'passed')                              state.passed++;
      else if (status === 'failed' || status === 'timedOut') state.failed++;
      else if (status === 'skipped')                        state.skipped++;
      break;
    }
```

Replace with:

```js
    case 'testEnd': {
      const { id, status, duration, error, attachments = [], retry = 0, browser = '' } = event;
      const key = `${browser}::${id}`;
      if (state.tests[key]) {
        const prev = state.tests[key].status;
        state.tests[key].status      = status;
        state.tests[key].duration    = duration;
        state.tests[key].error       = error || null;
        state.tests[key].attachments = attachments;
        state.tests[key].retry       = retry;
        if (prev === 'running') state.running = Math.max(0, state.running - 1);
      }
      if (status === 'passed')                              state.passed++;
      else if (status === 'failed' || status === 'timedOut') state.failed++;
      else if (status === 'skipped')                        state.skipped++;
      break;
    }
```

- [ ] **Step 3: Rewrite `stepBegin`/`stepEnd`**

Find:

```js
    case 'stepBegin': {
      const { id, title, category } = event;
      if (!state.steps[id]) state.steps[id] = [];
      if (state.steps[id].length >= 60) state.steps[id].shift();
      state.steps[id].push({ title, category, status: 'running' });
      break;
    }
    case 'stepEnd': {
      const { id, title, error } = event;
      if (state.steps[id]) {
        const step = [...state.steps[id]].reverse().find(s => s.title === title && s.status === 'running');
        if (step) step.status = error ? 'failed' : 'done';
      }
      break;
    }
```

Replace with:

```js
    case 'stepBegin': {
      const { id, title, category, browser = '' } = event;
      const key = `${browser}::${id}`;
      if (!state.steps[key]) state.steps[key] = [];
      if (state.steps[key].length >= 60) state.steps[key].shift();
      state.steps[key].push({ title, category, status: 'running' });
      break;
    }
    case 'stepEnd': {
      const { id, title, error, browser = '' } = event;
      const key = `${browser}::${id}`;
      if (state.steps[key]) {
        const step = [...state.steps[key]].reverse().find(s => s.title === title && s.status === 'running');
        if (step) step.status = error ? 'failed' : 'done';
      }
      break;
    }
```

- [ ] **Step 4: Make `stateFromPlaywrightJson` use the same composite-key format**

Find:

```js
function stateFromPlaywrightJson(json) {
  const s = { status: 'done', startTime: null, endTime: null, total: 0, passed: 0, failed: 0, skipped: 0, running: 0, tests: {}, suites: {}, steps: {}, errors: [] };
  const walk = (suite, filePath) => {
    const file = filePath || suite.file || '';
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const id = `${file}::${spec.title}`;
        const result = t.results?.[t.results.length - 1] || {};
        const status = result.status || 'skipped';
        s.tests[id] = { id, title: spec.title, file, line: spec.line || null, describes: [], status, duration: result.duration ?? null, error: result.error ? { message: result.error.message } : null, attachments: result.attachments || [], retry: t.results ? t.results.length - 1 : 0 };
        if (!s.suites[file]) s.suites[file] = { file, tests: [] };
        s.suites[file].tests.push(id);
        s.total++;
        if (status === 'passed') s.passed++;
        else if (status === 'failed' || status === 'timedOut') s.failed++;
        else s.skipped++;
      }
    }
    for (const sub of suite.suites || []) walk(sub, file);
  };
  for (const suite of json.suites || []) walk(suite, suite.file);
  return s;
}
```

Replace with:

```js
function stateFromPlaywrightJson(json) {
  const s = { status: 'done', startTime: null, endTime: null, total: 0, passed: 0, failed: 0, skipped: 0, running: 0, tests: {}, suites: {}, steps: {}, errors: [] };
  const walk = (suite, filePath) => {
    const file = filePath || suite.file || '';
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const browser = t.projectName || '';
        const id = `${browser}::${file}::${spec.title}`;
        const result = t.results?.[t.results.length - 1] || {};
        const status = result.status || 'skipped';
        s.tests[id] = { id, title: spec.title, file, line: spec.line || null, describes: [], browser, status, duration: result.duration ?? null, error: result.error ? { message: result.error.message } : null, attachments: result.attachments || [], retry: t.results ? t.results.length - 1 : 0 };
        if (!s.suites[file]) s.suites[file] = { file, tests: [] };
        s.suites[file].tests.push(id);
        s.total++;
        if (status === 'passed') s.passed++;
        else if (status === 'failed' || status === 'timedOut') s.failed++;
        else s.skipped++;
      }
    }
    for (const sub of suite.suites || []) walk(sub, file);
  };
  for (const suite of json.suites || []) walk(suite, suite.file);
  return s;
}
```

- [ ] **Step 5: Manual smoke check**

Run the existing single-browser test suite end to end (`npx playwright test` against any scratch project with the shipped `realtime-reporter.js`/`progress-server.js`) and confirm the dashboard still shows results normally — every test's `browser` field will be `'chromium'` (the default project name), and the composite key `chromium::<id>` is invisible to today's UI since nothing displays it directly yet (that's Tasks 11-12).

- [ ] **Step 6: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass. If `applyEvent begin: two overlapping runIds...` or similar tests reference `state.tests['t1']`/`state.tests['old1']` by bare id directly, they will now need the same composite format to keep passing — read that test file and confirm; if any assertion breaks because it hardcodes a bare id where a composite key is now required, that's expected fallout from this key-format change, not a new bug — note it in your report but do NOT weaken the test to hide it; the fix is to update the test's hardcoded keys to the composite format, matching what real events actually produce now.

- [ ] **Step 7: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): key state.tests/state.steps by composite browser::id, add browser field"
```

---

### Task 4: `/run` — `browsers` param, whitelist, `--project=` args

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`

**Interfaces:**
- Consumes: `BROWSERS` from Task 1.
- Produces: `POST /run` accepts an optional `browsers: string[]` body field. Unknown values → 400. Empty/omitted → treated as all configured `BROWSERS` keys. Valid selections become repeated `--project=X` CLI args.

- [ ] **Step 1: Validate and default the `browsers` param**

Find, inside the `POST /run` handler:

```js
    const { file, grep, mode = 'background', slowMo = 0, skipSeed = false } = params;

    if (file != null && typeof file !== 'string') {
```

Replace with:

```js
    const { file, grep, mode = 'background', slowMo = 0, skipSeed = false, browsers } = params;

    const allBrowserKeys = BROWSERS.map(b => b.key);
    let selectedBrowsers = Array.isArray(browsers) && browsers.length > 0 ? browsers : allBrowserKeys;
    if (!selectedBrowsers.every(b => typeof b === 'string' && allBrowserKeys.includes(b))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown browser in selection' }));
      return;
    }

    if (file != null && typeof file !== 'string') {
```

- [ ] **Step 2: Append `--project=` args**

Find:

```js
    const args = ['playwright', 'test'];
    if (file) args.push(file);
    if (grep) args.push('--grep', grep);
    if (mode === 'interactive') args.push('--headed');
```

Replace with:

```js
    const args = ['playwright', 'test'];
    if (file) args.push(file);
    if (grep) args.push('--grep', grep);
    for (const b of selectedBrowsers) args.push('--project', b);
    if (mode === 'interactive') args.push('--headed');
```

- [ ] **Step 3: Manual smoke check**

With a scratch project configured for 2+ Playwright projects (or fake it by adding a second `projects` entry with the same `chromium` device to any test project), `curl -X POST http://127.0.0.1:7373/run -H "X-Dashboard-Token: <token>" -H "Content-Type: application/json" -d '{"browsers":["chromium","nonexistent"]}'` should return 400. A request with `{"browsers":["chromium"]}` (a real configured key) should return 200 and the server log should show `--project chromium` in the spawned command.

- [ ] **Step 4: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass — the `browsers` param defaults to "all" when omitted, so every existing test calling `/run` without a `browsers` field continues to behave exactly as before (single default `chromium` project, `--project chromium` appended, functionally identical to no `--project` flag at all for a single-project config).

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): validate and apply the browsers selection on /run"
```

---

### Task 5: Interactive-mode window tiling

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`

**Interfaces:**
- Produces: `computeTileLayout(count: number): Array<{x, y, w, h}>` — pure function, exported for testing. `count <= 1` reproduces today's exact single-window position/size (right two-thirds of the screen). `count === 2` splits that same region into two side-by-side halves. `count >= 3` tiles a 2×2 grid within that region, capped at 4 distinct slots (a 5th+ browser reuses the 4th slot — an accepted, documented limitation, not a crash).
- Produces: `POST /run` in interactive mode emits both the legacy `PW_WIN_X/Y/W/H` (first tile slot, unchanged from today) and the new `PW_WIN_LAYOUT` (full JSON array) env vars.

- [ ] **Step 1: Add `computeTileLayout`**

Find `function focusInteractiveBrowser(rootPid) {` and insert immediately before it:

```js
// Computes window positions for N simultaneous Interactive-mode browser
// windows, tiled within the same right-two-thirds screen region the
// single-browser case has always used. count<=1 reproduces that exact
// region unchanged (backward compatible); 2 splits it in half; 3+ tiles a
// 2x2 grid, capped at 4 distinct slots — a 5th+ browser reuses slot 4
// rather than growing the grid further (rare case, not worth more math).
function computeTileLayout(count) {
  const half = Math.floor(SCREEN_W / 3);
  const regionX = half, regionY = 0, regionW = SCREEN_W - half, regionH = SCREEN_H;
  if (count <= 1) return [{ x: regionX, y: regionY, w: regionW, h: regionH }];
  if (count === 2) {
    const w = Math.floor(regionW / 2);
    return [
      { x: regionX,     y: regionY, w,               h: regionH },
      { x: regionX + w, y: regionY, w: regionW - w,   h: regionH },
    ];
  }
  const w = Math.floor(regionW / 2), h = Math.floor(regionH / 2);
  const slots = [
    { x: regionX,     y: regionY,     w,             h },
    { x: regionX + w, y: regionY,     w: regionW - w, h },
    { x: regionX,     y: regionY + h, w,             h: regionH - h },
    { x: regionX + w, y: regionY + h, w: regionW - w, h: regionH - h },
  ];
  const layout = [];
  for (let i = 0; i < count; i++) layout.push(slots[Math.min(i, 3)]);
  return layout;
}
```

- [ ] **Step 2: Emit both env-var formats in `/run`**

Find:

```js
    if (mode === 'interactive') {
      const half = Math.floor(SCREEN_W / 3);
      env.PW_WIN_X = String(half);
      env.PW_WIN_Y = '0';
      env.PW_WIN_W = String(SCREEN_W - half);
      env.PW_WIN_H = String(SCREEN_H);
    }
```

Replace with:

```js
    if (mode === 'interactive') {
      const layout = computeTileLayout(selectedBrowsers.length);
      const first = layout[0];
      // Legacy single-window vars — kept for backward compatibility with any
      // already-generated playwright.config.ts that only reads PW_WIN_X directly.
      env.PW_WIN_X = String(first.x);
      env.PW_WIN_Y = String(first.y);
      env.PW_WIN_W = String(first.w);
      env.PW_WIN_H = String(first.h);
      // New multi-window var — a config generated with 2+ projects reads its
      // own slot by project index; a single-project config ignores this entirely.
      env.PW_WIN_LAYOUT = JSON.stringify(layout);
    }
```

- [ ] **Step 3: Export `computeTileLayout`**

Find `module.exports = { ... };` and add `computeTileLayout,` to the list.

- [ ] **Step 4: Manual smoke check**

Start the server, `POST /run` with `mode: 'interactive'` and no `browsers` field (defaults to 1 browser) — confirm via a quick debug log or by reading the spawned child's env that `PW_WIN_X`/`PW_WIN_Y`/`PW_WIN_W`/`PW_WIN_H` match exactly what today's formula produces (`half = floor(SCREEN_W/3)`, `x=half, y=0, w=SCREEN_W-half, h=SCREEN_H`).

- [ ] **Step 5: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): tile Interactive-mode windows across multiple selected browsers"
```

---

## Part B — `playwright-setup`

### Task 6: Phase 2 — browser/device multi-select interview question

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: a defined interview step later tasks (7) key off — the selected browser/device set.

- [ ] **Step 1: Replace the passing "Browser targets" bullet with a dedicated question**

Find, in the Required information table:

```markdown
| 6 | **Test categories** | Which test categories to scaffold — see "Test Categories" below |
| 7 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`, and whether a `.github/workflows/e2e.yml` is generated in Phase 4) |
```

Replace with:

```markdown
| 6 | **Test categories** | Which test categories to scaffold — see "Test Categories" below |
| 7 | **Browser targets** | Which browsers/device profiles to configure as Playwright projects — see "Browser Targets" below |
| 8 | **CI/CD** | Will tests run in CI? (affects `workers`, `retries`, `forbidOnly`, and whether a `.github/workflows/e2e.yml` is generated in Phase 4) |
```

- [ ] **Step 2: Add the "Browser Targets" section**

Find the end of the existing "### Test Categories" section (it ends with "Selecting more than one category changes `playwright.config.ts`'s `testDir` in Phase 4 and adds the corresponding spec-file sections to the Phase 3 plan and Phase 4 implementation.") and insert immediately after it:

```markdown
### Browser Targets

Ask this as a dedicated multi-select question — use the `AskUserQuestion` tool with `multiSelect: true` — same pattern as Test Categories:

- **Chromium** (default selected) — `devices['Desktop Chrome']`. Covers most projects' needs alone.
- **Firefox** — `devices['Desktop Firefox']`.
- **WebKit** — `devices['Desktop Safari']`.
- **Mobile Chrome** — `devices['Pixel 5']`.
- **Mobile Safari** — `devices['iPhone 13']`.

Selecting more than one target changes Phase 4's `playwright.config.ts` generation: each selection becomes its own `projects[]` entry, and the shared `use.launchOptions` block is replaced by a per-project window-tiling override (see Phase 4 below) — the single-Chromium case is unaffected and generates exactly what it does today.
```

- [ ] **Step 3: Remove the now-redundant optional bullet**

Find, in the "Optional (ask only if not inferable from code)" list:

```markdown
- Browser targets: Chromium only, or also Firefox/Safari?
```

Delete this line — it's superseded by the new required question above.

- [ ] **Step 4: Verify by reading the file back**

Confirm the Required table now has 8 rows, the new section reads naturally after Test Categories, and the removed optional bullet doesn't leave a dangling reference elsewhere.

- [ ] **Step 5: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): add multi-select Browser Targets interview question"
```

---

### Task 7: Phase 4 — generate `projects[]` + per-project window tiling

**Files:**
- Modify: `plugins/playwright-setup/skills/playwright-setup/SKILL.md`

**Interfaces:**
- Consumes: the browser selection from Task 6.
- Produces: guidance for generating either the existing single-project `playwright.config.ts` (unchanged, when only Chromium selected) or a multi-project version with per-project window-tiling args.

- [ ] **Step 1: Add browser-target-aware config guidance**

Find the existing `playwright.config.ts` code block's `projects: [...]` section:

```typescript
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:PORT' },
    },
    // Add more projects for additional URLs or browsers
  ],
```

And the paragraph right after the code block that begins "Adapt: remove `globalSetup` if not needed...". Insert a new subsection immediately after that paragraph (before the `testDir` guidance that follows it):

```markdown
### `projects[]` when multiple browser targets were selected in Phase 2

**Single target (Chromium only, the default):** keep the `projects` array and shared `use.launchOptions` exactly as shown above — unchanged from today.

**Two or more targets:** generate one `projects[]` entry per selection, using the matching `devices[...]` preset, and replace the single shared `use.launchOptions` with a per-project index-based window-tiling override:

```typescript
import { defineConfig, devices } from '@playwright/test';

function windowArgsForProject(index: number) {
  if (process.env.PW_WIN_LAYOUT) {
    try {
      const layout = JSON.parse(process.env.PW_WIN_LAYOUT);
      const slot = layout[index] || layout[layout.length - 1];
      if (slot) {
        return [
          `--window-position=${slot.x},${slot.y}`,
          `--window-size=${slot.w},${slot.h}`,
          '--disable-features=CalculateNativeWinOcclusion',
        ];
      }
    } catch {}
  }
  return process.env.PW_WIN_X != null ? [
    `--window-position=${process.env.PW_WIN_X},${process.env.PW_WIN_Y || '0'}`,
    `--window-size=${process.env.PW_WIN_W || '960'},${process.env.PW_WIN_H || '1080'}`,
    '--disable-features=CalculateNativeWinOcclusion',
  ] : [];
}

export default defineConfig({
  // ...same top-level config as the single-target case (testDir, reporter, use.trace, etc.)...
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'], baseURL: 'http://localhost:PORT',
        launchOptions: { slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10), args: windowArgsForProject(0) },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'], baseURL: 'http://localhost:PORT',
        launchOptions: { slowMo: parseInt(process.env.PLAYWRIGHT_SLOW_MO || '0', 10), args: windowArgsForProject(1) },
      },
    },
    // one entry per selected target, index matching array position (0, 1, 2, ...)
  ],
  // ...webServer unchanged...
});
```

The mapping from Phase 2 selections to `devices[...]` presets:

| Selection | `devices[...]` preset |
|---|---|
| Chromium | `devices['Desktop Chrome']` |
| Firefox | `devices['Desktop Firefox']` |
| WebKit | `devices['Desktop Safari']` |
| Mobile Chrome | `devices['Pixel 5']` |
| Mobile Safari | `devices['iPhone 13']` |

`windowArgsForProject`'s `index` argument is that project's fixed position in the `projects[]` array (0-based) — must match the order the browsers appear in the array, since `progress-server.js`'s `PW_WIN_LAYOUT` array is ordered the same way the `--project` flags were passed on the command line, which itself follows the dashboard's selection order.
```

- [ ] **Step 2: Verify by reading the file back**

Confirm the new subsection sits between the `projects[]` adapt paragraph and the existing `testDir` guidance, and that the single-target case's example still matches exactly what Phase 4's main code block already shows (no accidental drift).

- [ ] **Step 3: Commit**

```bash
git add plugins/playwright-setup/skills/playwright-setup/SKILL.md
git commit -m "feat(playwright-setup): generate multi-project playwright.config.ts with window tiling"
```

---

## Part C — `e2e-dashboard` installer docs

### Task 8: SKILL.md — discovery, adapt marker, docs

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md`

**Interfaces:**
- Consumes: Task 1's `BROWSERS` shape (`{key, label, icon}`).

- [ ] **Step 1: Add browser discovery to Phase 1**

Find the `category_dirs` row in the Phase 1 Discovery table and insert a new row immediately after it:

```markdown
| `browser_targets` | Playwright projects configured in `playwright.config.ts`'s `projects[]` array — ask the user directly (same as `category_dirs`) rather than parsing the TS config file | just `chromium` if the project only has one (or wasn't generated with multiple) — no behavior change for existing single-browser projects |
```

- [ ] **Step 2: Add the `%%ADAPT_BROWSERS%%` row and building guidance**

Find the Phase 3 Adapt table and insert a new row after the `%%ADAPT_CATEGORIES%%` row:

```markdown
| `%%ADAPT_BROWSERS%%` | `const BROWSERS = [ ... ];` — one object per detected `browser_targets` entry, see below |
```

Add this section immediately after the "Building the `CATEGORIES` array" section (before "### No-DB-seed adaptation"):

```markdown
### Building the `BROWSERS` array

Each detected `browser_targets` entry becomes one object:

```js
{ key: 'chromium', label: 'Chromium', icon: '🧭' }
```

`key` must exactly match that project's `name` in `playwright.config.ts`'s `projects[]` array — this is what gets passed as `--project=<key>` when the dashboard runs it.

| Project name | `label` | `icon` |
|---|---|---|
| `chromium` | `Chromium` | `🧭` |
| `firefox` | `Firefox` | `🦊` |
| `webkit` | `WebKit` | `🧭` (Safari-style compass, no distinct emoji) |
| Mobile-profile projects (e.g. `Mobile Chrome`, `Mobile Safari`) | Title-cased project name | `📱` |

Example for a project with all three desktop engines:

```js
const BROWSERS = [
  { key: 'chromium', label: 'Chromium', icon: '🧭' },
  { key: 'firefox',  label: 'Firefox',  icon: '🦊' },
  { key: 'webkit',   label: 'WebKit',   icon: '🧭' },
];
```

For a single-browser project, keep the shipped default (one `chromium` entry) unchanged.
```

- [ ] **Step 3: Bump the features count and add Common Pitfalls rows**

Find the bold "**N features**" line — read the real current count from the file (don't assume a number, it's drifted every time this session). Bump it by one and insert a new clause: `browser selector (multi-select, auto-hidden when only one browser is configured) with grouped per-test results and a per-browser pass/fail summary strip`.

Add to the Common Pitfalls table:

```markdown
| Browser dropdown not showing | By design when only one browser is configured — `GET /browsers` returns a single entry and the dropdown stays hidden. Configure a second browser target via `/playwright-setup` to see it appear. |
| Interactive-mode windows overlapping | Confirm `playwright.config.ts` was regenerated with the per-project `windowArgsForProject()` helper (Task 7) — an older single-project config only reads the legacy `PW_WIN_X` vars and positions every window identically. |
```

- [ ] **Step 4: Verify and commit**

Read the full file back to confirm the new rows/sections are well-formed and consistent, then:

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md
git commit -m "docs(e2e-dashboard): document BROWSERS discovery/adaptation and the browser selector"
```

---

## Part D — Frontend

### Task 9: State, CSS, localStorage, click delegation

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Produces: `browsers: Array<{key,label,icon}>` (default `[]`), `selectedBrowsers: Set<string>` (default empty until `loadBrowsers()` populates it), `browserDropdownOpen: boolean` (default `false`).
- Produces: click-delegation handlers for `[data-toggle-browser-dropdown]`, `[data-toggle-browser]`.

- [ ] **Step 1: Add CSS**

Insert after the existing `.source-editor { ... }` rule (or after `.cat-tab:hover:not(.active)` if that's not present — search for either):

```css
  .browser-dropdown { position: relative; }
  .browser-dropdown-panel { position: absolute; top: 100%; right: 0; margin-top: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 6px; min-width: 180px; z-index: 50; box-shadow: 0 4px 12px #0006; }
  .browser-dropdown-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .browser-dropdown-item:hover { background: var(--surface2); }
  .browser-dropdown-item input { cursor: pointer; accent-color: var(--blue); }
```

- [ ] **Step 2: Add state vars**

Find `let editingFile = null;` and add immediately after it:

```js
let browsers            = [];
let selectedBrowsers    = new Set();
let browserDropdownOpen = false;
```

- [ ] **Step 3: Add click-delegation handlers**

Find the "Source panel controls" block in the click-delegation handler (search for `const viewSrcBtn = e.target.closest('[data-view-source]');`) and insert immediately before it:

```js
  // Browser dropdown
  const toggleDropdownBtn = e.target.closest('[data-toggle-browser-dropdown]');
  if (toggleDropdownBtn) { e.stopPropagation(); browserDropdownOpen = !browserDropdownOpen; render(); return; }

  const toggleBrowserItem = e.target.closest('[data-toggle-browser]');
  if (toggleBrowserItem) {
    e.stopPropagation();
    const key = toggleBrowserItem.dataset.toggleBrowser;
    if (selectedBrowsers.has(key)) selectedBrowsers.delete(key); else selectedBrowsers.add(key);
    localStorage.setItem('e2e-selected-browsers', JSON.stringify([...selectedBrowsers]));
    render();
    return;
  }
```

- [ ] **Step 4: Manual verification**

Read the file back and confirm: CSS is syntactically valid, the three state vars are declared once, both click handlers sit before the pre-existing `viewSrcBtn` check.

- [ ] **Step 5: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass (this task doesn't add tests — that's Task 13).

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): add browser-selection state, CSS, and click handling"
```

---

### Task 10: `loadBrowsers()`, dropdown render, wire into `doRun()`

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `browsers`, `selectedBrowsers`, `browserDropdownOpen` from Task 9.
- Produces: `loadBrowsers(): Promise<void>`, `renderBrowserDropdown(): string`.
- Produces: `render()` calls `renderBrowserDropdown()`; `doRun(params)` includes `browsers: [...selectedBrowsers]` in its request body.

- [ ] **Step 1: Add `loadBrowsers()`**

Find `async function loadCategories() { ... }` and insert immediately after it:

```js
async function loadBrowsers() {
  try {
    const r = await fetch(`${SERVER}/browsers`);
    browsers = (await r.json()).browsers || [];
    if (selectedBrowsers.size === 0) {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('e2e-selected-browsers') || 'null'); } catch {}
      const valid = Array.isArray(stored) ? stored.filter(k => browsers.some(b => b.key === k)) : [];
      selectedBrowsers = new Set(valid.length > 0 ? valid : browsers.map(b => b.key));
    }
    render();
  } catch {}
}
```

- [ ] **Step 2: Add `renderBrowserDropdown()`**

Find `function renderCategoryTabs() {` and insert immediately before it:

```js
function renderBrowserDropdown() {
  if (browsers.length < 2) return '';
  const count = selectedBrowsers.size;
  const items = browsers.map(b => `
    <label class="browser-dropdown-item" data-toggle-browser="${h(b.key)}">
      <input type="checkbox" ${selectedBrowsers.has(b.key) ? 'checked' : ''} onclick="event.preventDefault()">
      <span>${h(b.icon)} ${h(b.label)}</span>
    </label>`).join('');
  return `<div class="browser-dropdown">
    <button class="btn-ghost" data-toggle-browser-dropdown style="font-size:11px">🌐 Browsers: ${count} selected ▾</button>
    <div class="browser-dropdown-panel${browserDropdownOpen ? '' : ' hidden'}">${items}</div>
  </div>`;
}
```

Note: the checkbox's `onclick="event.preventDefault()"` stops the native checkbox toggle from fighting with the `<label>`'s own click-delegation handler (`[data-toggle-browser]`, which reads/writes `selectedBrowsers` and re-renders) — without it, the browser's default label-click-toggles-checkbox behavior would flip the checkbox state once, then `render()` would immediately overwrite it again from `selectedBrowsers`, causing a visible flicker/double-toggle.

- [ ] **Step 3: Wire the dropdown into the header**

Find, in the static HTML `<header>` block, the `<div class="header-right">` opening tag (search for it) and insert a placeholder container immediately before it:

```html
    <div id="browser-dropdown-container"></div>
```

Find `function render() {` and locate the line calling `renderCategoryTabs();` inside it. Insert immediately after that line:

```js
  document.getElementById('browser-dropdown-container').innerHTML = renderBrowserDropdown();
```

- [ ] **Step 4: Include the selection in every run request**

Find `async function doRun(params) {` and locate the line `body: JSON.stringify({ ...params, mode: runMode, slowMo, skipSeed }),`. Replace it with:

```js
      body: JSON.stringify({ ...params, mode: runMode, slowMo, skipSeed, browsers: [...selectedBrowsers] }),
```

- [ ] **Step 5: Call `loadBrowsers()` at boot**

Find the boot section's `loadCategories();` line and insert immediately after it:

```js
loadBrowsers();
```

- [ ] **Step 6: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): load browsers, render the dropdown, include selection in every run"
```

---

### Task 11: Group test rows by (file, describes, title) with per-browser sub-rows

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `t.browser` field from Task 3 (server), present on every `state.tests` entry.
- Produces: `groupTestsForDisplay(tests: Array): Array<{title, describes, entries: Array}>` — groups by `(describes.join('>'), title)`.
- Produces: `suiteBlockHTML(file, suite)` — same name, now groups before rendering; single-browser projects (exactly 1 entry per group) render identically to today (no visible change); multi-browser projects (2+ entries per group) render the parent title once with an indented sub-row per browser underneath.

- [ ] **Step 1: Add `groupTestsForDisplay`**

Find `function testRowHTML(t, file, s) {` and insert immediately before it:

```js
function groupTestsForDisplay(tests) {
  const groups = new Map();
  for (const t of tests) {
    const gk = (t.describes || []).join(' › ') + '::' + t.title;
    if (!groups.has(gk)) groups.set(gk, { title: t.title, describes: t.describes || [], entries: [] });
    groups.get(gk).entries.push(t);
  }
  return [...groups.values()];
}
```

- [ ] **Step 2: Add `testGroupHTML`**

Insert immediately after `groupTestsForDisplay` (still before `testRowHTML`):

```js
function testGroupHTML(group, file, s) {
  if (group.entries.length === 1) return testRowHTML(group.entries[0], file, s);

  const rows = group.entries.map(t => {
    const b = browsers.find(x => x.key === t.browser);
    const icon = b ? b.icon : '🧭';
    const label = b ? b.label : (t.browser || 'unknown');
    const dur = fmtDur(t.duration);
    return `<div class="test-row" data-id="${h(t.id)}" style="padding-left:38px">
      <div class="test-row-main">
        <span class="test-icon">${testIcon(t.status)}</span>
        <div class="test-title-wrap">
          <div class="test-title" style="font-size:12px">${h(icon)} ${h(label)}${dur ? ` — ${dur}` : ''}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="test-row" style="cursor:default">
    <div class="test-row-main">
      <span class="test-icon"></span>
      <div class="test-title-wrap"><div class="test-title">${h(group.title)}</div></div>
    </div>
  </div>${rows}`;
}
```

- [ ] **Step 3: Group before rendering in `suiteBlockHTML`**

Find, inside `suiteBlockHTML`, the describe-block grouping loop:

```js
  // Group by describe block
  const groups = [];
  let curDesc = Symbol(); // unique sentinel
  for (const t of tests) {
    const desc = (t.describes || []).join(' › ');
    if (desc !== curDesc) { curDesc = desc; groups.push({ label: desc, tests: [] }); }
    groups[groups.length - 1].tests.push(t);
  }

  let rows = '';
  for (const grp of groups) {
    if (grp.label) rows += `<div class="describe-header">${h(grp.label)}</div>`;
    for (const t of grp.tests) rows += testRowHTML(t, file, s);
  }
```

Replace the last two lines (the `let rows = '';` block) with:

```js
  let rows = '';
  for (const grp of groups) {
    if (grp.label) rows += `<div class="describe-header">${h(grp.label)}</div>`;
    for (const g of groupTestsForDisplay(grp.tests)) rows += testGroupHTML(g, file, s);
  }
```

- [ ] **Step 4: Manual verification**

Read the file back and confirm: for a single-browser test run (every group has exactly 1 entry), `testGroupHTML` immediately delegates to the unmodified `testRowHTML` — meaning rendering is byte-for-byte identical to before this task for every existing single-browser install. Trace through a 2-browser example by hand to confirm the parent-title + 2 sub-rows structure matches the approved mockup (test title, then one indented row per browser with icon/label/duration).

- [ ] **Step 5: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): group test rows by title with per-browser sub-rows when 2+ browsers ran"
```

---

### Task 12: Browser summary strip

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `state.tests` (each entry's `browser` and `status` fields).
- Produces: `browserSummaryHTML(): string` — a compact per-browser pass/fail strip, rendered above the test list only when 2+ distinct browsers appear in the current `state.tests`.

- [ ] **Step 1: Add `browserSummaryHTML`**

Find `function failureGroupsHTML() {` and insert immediately before it:

```css
```

(No CSS needed — reuses existing `.s-passed`/`.s-failed` classes.)

```js
function browserSummaryHTML() {
  if (!state) return '';
  const byBrowser = new Map();
  for (const t of Object.values(state.tests)) {
    if (!byBrowser.has(t.browser)) byBrowser.set(t.browser, { passed: 0, total: 0 });
    const entry = byBrowser.get(t.browser);
    entry.total++;
    if (t.status === 'passed') entry.passed++;
  }
  if (byBrowser.size < 2) return '';
  const parts = [...byBrowser.entries()].map(([key, { passed, total }]) => {
    const b = browsers.find(x => x.key === key);
    const icon = b ? b.icon : '🧭';
    const label = b ? b.label : (key || 'unknown');
    const cls = passed === total ? 's-passed' : 's-failed';
    return `<span class="${cls}">${h(icon)} ${h(label)}: ${passed}/${total}</span>`;
  });
  return `<div style="padding:6px 16px;font-size:12px;display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--border)">${parts.join('')}</div>`;
}
```

- [ ] **Step 2: Render it above the test list**

Find, inside `renderContent()`:

```js
  let html = failureGroupsHTML();
```

Replace with:

```js
  let html = browserSummaryHTML() + failureGroupsHTML();
```

- [ ] **Step 3: Manual verification**

Trace through by hand: for a single-browser run, `byBrowser.size` is always 1 (every test has the same `browser` value), so the function returns `''` and nothing renders — confirming zero visual change for existing single-browser installs.

- [ ] **Step 4: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): add per-browser pass/fail summary strip"
```

---

## Part E — Tests + Verification

### Task 13: `node:test` coverage

**Files:**
- Create: `plugins/e2e-dashboard/tests/browsers.test.js`
- Modify: `plugins/e2e-dashboard/tests/progress-server.test.js` (only if Task 3's Step 6 found a broken hardcoded-id assertion — fix it there, in place, using the composite-key format; do not duplicate that fix into a new file)

**Interfaces:**
- Consumes: `progress-server.js` spawned as a real child process (established pattern), plus `computeTileLayout`/`BROWSERS`/`applyEvent` required directly for unit-level assertions (established pattern from `progress-server.test.js`'s `multi-category CATEGORIES support` block).

- [ ] **Step 1: Write the test file**

```javascript
// plugins/e2e-dashboard/tests/browsers.test.js
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'progress-server.js');
const HTML     = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'test-progress-dashboard.html');
const REPORTER = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'realtime-reporter.js');
const FIXTURE_SPEC = path.join(__dirname, 'fixtures', 'example.spec.ts');

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

// ── Unit: computeTileLayout (single-category default template, no adaptation needed) ──

describe('computeTileLayout', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-tile-'));
    fs.mkdirSync(path.join(tmpRoot, 'tests', 'e2e'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'tests', 'reporters'), { recursive: true });
    fs.copyFileSync(FIXTURE_SPEC, path.join(tmpRoot, 'tests', 'e2e', 'example.spec.ts'));
    fs.copyFileSync(TEMPLATE, path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('count<=1 reproduces the legacy single-window region', () => {
    const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
    const layout = mod.computeTileLayout(1);
    assert.equal(layout.length, 1);
    assert.equal(layout[0].y, 0);
    assert.equal(layout[0].x, Math.floor(1920 / 3));
    assert.equal(layout[0].w, 1920 - Math.floor(1920 / 3));
    assert.equal(layout[0].h, 1080);
  });

  test('count=2 splits the region into two equal-height, side-by-side halves', () => {
    const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
    const layout = mod.computeTileLayout(2);
    assert.equal(layout.length, 2);
    assert.equal(layout[0].h, 1080);
    assert.equal(layout[1].h, 1080);
    assert.equal(layout[0].x + layout[0].w, layout[1].x); // adjacent, no gap or overlap
  });

  test('count=4 tiles a 2x2 grid with no overlap', () => {
    const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
    const layout = mod.computeTileLayout(4);
    assert.equal(layout.length, 4);
    assert.equal(layout[0].x, layout[2].x);
    assert.equal(layout[1].x, layout[3].x);
    assert.equal(layout[0].y, layout[1].y);
    assert.equal(layout[2].y, layout[3].y);
  });

  test('count=6 reuses the 4th slot rather than growing further', () => {
    const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
    const layout = mod.computeTileLayout(6);
    assert.equal(layout.length, 6);
    assert.deepEqual(layout[3], layout[4]);
    assert.deepEqual(layout[3], layout[5]);
  });
});

// ── HTTP: /browsers, /run browsers validation, composite-key state ──

let tmpRoot, child, origin, token;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-browsers-'));
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'reporters'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'test-results'), { recursive: true });
  fs.copyFileSync(FIXTURE_SPEC, path.join(tmpRoot, 'tests', 'e2e', 'example.spec.ts'));
  fs.copyFileSync(TEMPLATE, path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  fs.copyFileSync(REPORTER, path.join(tmpRoot, 'tests', 'reporters', 'realtime-reporter.js'));
  fs.copyFileSync(HTML, path.join(tmpRoot, 'tests', 'test-progress-dashboard.html'));

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

test('GET /browsers returns a single default entry for an unadapted template', async () => {
  const res = await fetch(origin + '/browsers');
  const json = await res.json();
  assert.deepEqual(json.browsers.map(b => b.key), ['chromium']);
});

test('POST /run with an unknown browser key is rejected with 400', async () => {
  const res = await fetch(origin + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ browsers: ['nonexistent-browser'] }),
  });
  assert.equal(res.status, 400);
});

test('POST /run with a valid known browser key returns 200', async () => {
  const res = await fetch(origin + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ file: 'tests/e2e/example.spec.ts', browsers: ['chromium'] }),
  });
  assert.equal(res.status, 200);
  await fetch(origin + '/stop', { method: 'POST', headers: { 'X-Dashboard-Token': token } });
});

test('applyEvent keys state.tests by composite browser::id with a browser field, two different browsers never collide', async () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  mod.resetRunState();
  mod.applyEvent({ type: 'begin', startTime: Date.now(), total: 2, runId: null });
  mod.applyEvent({ type: 'testBegin', id: 'same-id', title: 'same test', file: 'tests/e2e/example.spec.ts', browser: 'chromium' });
  mod.applyEvent({ type: 'testBegin', id: 'same-id', title: 'same test', file: 'tests/e2e/example.spec.ts', browser: 'firefox' });
  mod.applyEvent({ type: 'testEnd', id: 'same-id', status: 'passed', duration: 100, browser: 'chromium' });
  mod.applyEvent({ type: 'testEnd', id: 'same-id', status: 'failed', duration: 200, browser: 'firefox' });

  const keys = Object.keys(mod.state.tests);
  assert.equal(keys.length, 2); // no collision despite identical raw `id`
  assert.equal(mod.state.tests['chromium::same-id'].status, 'passed');
  assert.equal(mod.state.tests['chromium::same-id'].browser, 'chromium');
  assert.equal(mod.state.tests['firefox::same-id'].status, 'failed');
  assert.equal(mod.state.tests['firefox::same-id'].browser, 'firefox');
  // id field equals the composite key, so every existing consumer of t.id keeps working
  assert.equal(mod.state.tests['chromium::same-id'].id, 'chromium::same-id');
});
```

- [ ] **Step 2: Run the new file alone**

Run: `node --test plugins/e2e-dashboard/tests/browsers.test.js`
Expected: all tests passing (4 tile-layout + 4 HTTP/state tests = 8 total).

- [ ] **Step 3: Address any Task 3 fallout**

If Task 3's Step 6 noted a broken hardcoded-id assertion in `progress-server.test.js`, fix it there now — update the hardcoded key to the composite `${browser}::${id}` format matching what real events now produce (the existing test's own comments will make clear which raw id/browser pairing it was exercising).

- [ ] **Step 4: Run the full suite**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all tests pass, pristine output (28 pre-existing + 8 new = 36, or one fewer/more if Step 3 required a fix rather than a pure addition).

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/tests/browsers.test.js plugins/e2e-dashboard/tests/progress-server.test.js
git commit -m "test(e2e-dashboard): add coverage for /browsers, browsers whitelist, tile layout, composite keys"
```

---

### Task 14: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Multi-browser real headless-browser check**

Build a scratch project with a 2-project `playwright.config.ts` (Chromium + Firefox, or fake Firefox with a second Chromium-backed project if Firefox isn't installed locally — the goal is exercising 2 distinct project *names*, not necessarily 2 distinct engines) and a real spec file. Adapt `progress-server.js`'s `%%ADAPT_BROWSERS%%` marker with both entries (same technique used in every prior plan's verification: replace the marker line, write the adapted copy, spawn it for real). Drive a headless Chromium session (Playwright, already available per every prior plan's Task 12/6/B6) against the live dashboard:
1. Confirm the "🌐 Browsers: 2 selected ▾" dropdown appears (proves the `browsers.length >= 2` gate).
2. Click it, confirm both checkboxes are checked by default (all-selected default).
3. Uncheck one, confirm the count label updates and the selection persists across a page reload (localStorage).
4. Trigger a run, confirm both browsers' rows appear once results stream in, grouped under one parent test title with two sub-rows (matching the approved mockup).
5. Confirm the browser summary strip appears above the test list with correct per-browser pass/fail counts.
6. Confirm zero console/page errors throughout.

- [ ] **Step 2: Backward-compat check**

Against a project with the unmodified single-`chromium` default `BROWSERS`/`CATEGORIES`, confirm: no dropdown renders, test rows look pixel-identical to before this plan (no nesting, no browser label), no summary strip appears, and Interactive mode positions its single window exactly where it always has.

- [ ] **Step 3: Record the outcome**

No commit for this task — if any check fails, open a follow-up task against the specific broken step rather than proceeding to consider the plan complete.

---

## Explicitly Out of Scope

- Real installed/channel browsers (Edge, real Safari via `channel`) — `devices`/engine-based projects only, per the design spec.
- Per-row browser override (bypassing the global dropdown selection for a single test/file run) — the dropdown selection applies uniformly to every run trigger for v1.
- Automatic detection of which browser binaries are actually installed on the machine — `BROWSERS` is whatever `playwright-setup` configured, not runtime-probed.
