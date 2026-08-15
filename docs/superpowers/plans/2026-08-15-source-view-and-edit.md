# Source View & Inline Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user click a spec file in the sidebar and see (and edit) its real source code inline in the middle pane, with a Save button that writes changes back to disk — closing the "playwright-setup generates boilerplate the user can't easily tweak" gap, without a step-parser or code-editor dependency.

**Architecture:** Server gains two routes reusing the existing `isKnownSpecFile` whitelist (the same gate `/run` and `/filetests` already use, so no new path-validation surface): `GET /source` returns raw file content, `POST /save-spec` writes it back atomically (temp file + rename, so a mid-write crash can't corrupt the file). Frontend gets a collapsible source panel injected once per file into the existing per-file block in `renderContent()`'s loop — a plain `<textarea>` in edit mode, no syntax highlighting and no code-editor library, keeping the zero-dependency-template rule intact. This is deliberately v1-scoped: raw-code editing only, not the structured "list of editable steps" idea — that's a code-generation problem with real corruption risk and is out of scope here (see bottom).

**Tech Stack:** Node core only in `progress-server.js` (fs, path, crypto — all already imported). Vanilla JS/CSS in the dashboard HTML. `node:test` for coverage.

## Global Constraints

- **No new npm dependencies.** Plain `<textarea>`, no CodeMirror/Monaco/etc. — this is an explicit scope cut, not an oversight (see "Explicitly out of scope").
- **Reuse `isKnownSpecFile` as the sole gate** for both reading and writing — no new path-validation logic. A file must resolve inside a configured `CATEGORIES` dir and end in `.spec.ts`/`.spec.js` to be read or written via these routes.
- **Both new routes require the dashboard token** (`X-Dashboard-Token`) — `/source` reveals full file content (more sensitive than `/filetests`' extracted titles, which already require a token), and `/save-spec` is state-changing (writes to disk).
- **Atomic write:** `POST /save-spec` writes to a temp file in the same directory, then `fs.renameSync`s it into place — never a direct in-place write that could leave a half-written file if the process dies mid-save.
- **No conflict detection in v1.** If the file changes on disk between load and save (e.g., the user also edits it in their own IDE), the dashboard's save simply overwrites it — no diffing, no "file changed underneath you" warning. Single-local-user tool; document this as a known v1 limitation, not silently.
- Templates stay single-file-per-concern — do not split `progress-server.js`/`test-progress-dashboard.html`.

---

### Task 1: Server — `GET /source` and `POST /save-spec`

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`

**Interfaces:**
- Consumes: `isKnownSpecFile(fileParam)` (existing), `crypto` (already imported).
- Produces: `GET /source?file=<path>` → `{content: string}` on success, 400 if `file` fails `isKnownSpecFile`, 404 if the file doesn't exist on disk. Requires token.
- Produces: `POST /save-spec` (body `{file, content}`) → `{ok: true}` on success, 400 if `file` fails `isKnownSpecFile` or `content` isn't a string, 500 with `{error}` on a write failure. Requires token.

- [ ] **Step 1: Add both routes**

Insert immediately after the existing `GET /filetests` route block (search for `if (req.method === 'GET' && req.url.startsWith('/filetests'))`, insert after its closing `}`, before the `GET /events` comment):

```js
  // ── GET /source?file=tests/e2e/foo.spec.ts ─────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/source')) {
    if (!checkToken(req, res)) return;
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const fileParam = new URLSearchParams(qs).get('file') || '';
    if (!isKnownSpecFile(fileParam)) { res.writeHead(400).end('Unknown or unsafe file'); return; }
    try {
      const content = fs.readFileSync(path.join(ROOT, fileParam), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
    } catch (_) { res.writeHead(404).end('Not found'); }
    return;
  }

  // ── POST /save-spec ───────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/save-spec') {
    if (!checkToken(req, res)) return;
    const body = await readBody(req);
    let params = {};
    try { params = JSON.parse(body); } catch {}
    const { file, content } = params;
    if (!isKnownSpecFile(file) || typeof content !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown or unsafe file' }));
      return;
    }
    const finalPath = path.join(ROOT, file);
    const tmpPath = `${finalPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, finalPath); // atomic within the same directory
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
```

- [ ] **Step 2: Manual smoke check**

From a scratch project with `tests/e2e/foo.spec.ts` present, start the server. `curl -s "http://127.0.0.1:7373/source?file=tests/e2e/foo.spec.ts" -H "X-Dashboard-Token: <token>"` should return `{"content":"..."}` matching the real file. `curl -X POST http://127.0.0.1:7373/save-spec -H "X-Dashboard-Token: <token>" -H "Content-Type: application/json" -d "{\"file\":\"tests/e2e/foo.spec.ts\",\"content\":\"// edited\\n\"}"` should return `{"ok":true}`, and re-reading the file from disk should show the new content. Then try `file: "../../../etc/passwd.spec.ts"` for both routes and confirm both reject with 400.

- [ ] **Step 3: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "feat(e2e-dashboard): add GET /source and POST /save-spec for inline spec viewing/editing"
```

---

### Task 2: Dashboard HTML — source panel state, CSS, click handling, actions

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `GET /source`, `POST /save-spec` from Task 1.
- Produces: `sourceCache: {[file]: string}`, `sourceOpen: Set<string>`, `editingFile: string | null` (module-scope state).
- Produces: `loadSource(file)`, `hideSource(file)`, `editSource(file)`, `cancelEdit()`, `saveSource(file)` — all async where they fetch.

- [ ] **Step 1: Add CSS**

Insert immediately after the existing `.external-panel`/`.external-card` rules if present, otherwise after `.cat-tab:hover:not(.active) { color: var(--text); }` (search for either — this task doesn't depend on the external-checks plan having landed):

```css
  .source-panel { margin: 10px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); overflow: hidden; }
  .source-panel-header { padding: 6px 10px; background: var(--surface2); display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; color: var(--muted); }
  .source-panel-title { flex: 1; }
  .source-panel-actions { display: flex; gap: 6px; }
  .source-panel-collapsed { margin: 10px 14px; }
  .source-view { margin: 0; padding: 10px; max-height: 320px; overflow: auto; font-family: 'Consolas', 'Fira Code', monospace; font-size: 11px; line-height: 1.5; color: var(--text); white-space: pre; }
  .source-editor { width: 100%; min-height: 320px; padding: 10px; border: none; background: #0d1117; color: var(--text); font-family: 'Consolas', 'Fira Code', monospace; font-size: 11px; line-height: 1.5; resize: vertical; outline: none; tab-size: 2; box-sizing: border-box; display: block; }
```

- [ ] **Step 2: Add state vars**

Find `let fgCollapsed = false;` in the app-state block and add immediately after it (before or after the `categories`/`activeCategory` vars from the prior plan, order doesn't matter):

```js
let sourceCache = {};
let sourceOpen  = new Set();
let editingFile = null;
```

- [ ] **Step 3: Add click-delegation handlers**

Find the "Copy error button" block in the global click-delegation handler (search for `const copyBtn = e.target.closest('[data-copy-err]');`). Insert immediately before it:

```js
  // Source panel controls
  const viewSrcBtn = e.target.closest('[data-view-source]');
  if (viewSrcBtn) { e.stopPropagation(); loadSource(viewSrcBtn.dataset.viewSource); return; }

  const hideSrcBtn = e.target.closest('[data-hide-source]');
  if (hideSrcBtn) { e.stopPropagation(); hideSource(hideSrcBtn.dataset.hideSource); return; }

  const editSrcBtn = e.target.closest('[data-edit-source]');
  if (editSrcBtn) { e.stopPropagation(); editSource(editSrcBtn.dataset.editSource); return; }

  const cancelEditBtn = e.target.closest('[data-cancel-edit]');
  if (cancelEditBtn) { e.stopPropagation(); cancelEdit(); return; }

  const saveSrcBtn = e.target.closest('[data-save-source]');
  if (saveSrcBtn) { e.stopPropagation(); saveSource(saveSrcBtn.dataset.saveSource); return; }
```

- [ ] **Step 4: Add the five action functions**

Find `async function loadFiles() { ... }` and insert the following immediately before it (so they sit together with the other data-loading/action functions):

```js
async function loadSource(file) {
  sourceOpen.add(file);
  render();
  if (sourceCache[file] != null) return;
  try {
    const r = await fetch(`${SERVER}/source?file=${encodeURIComponent(file)}`, { headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN } });
    const json = await r.json();
    sourceCache[file] = json.content ?? '';
  } catch {
    sourceCache[file] = '';
  }
  render();
}

function hideSource(file) {
  sourceOpen.delete(file);
  if (editingFile === file) editingFile = null;
  render();
}

function editSource(file) {
  editingFile = file;
  render();
}

function cancelEdit() {
  editingFile = null;
  render();
}

async function saveSource(file) {
  const textarea = document.querySelector('.source-editor');
  if (!textarea) return;
  const content = textarea.value;
  try {
    const r = await fetch(`${SERVER}/save-spec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': DASHBOARD_TOKEN },
      body: JSON.stringify({ file, content }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert('Save failed: ' + (err.error || r.status));
      return;
    }
    sourceCache[file] = content;
    editingFile = null;
    try {
      const r2 = await fetch(`${SERVER}/filetests?file=${encodeURIComponent(file)}`, { headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN } });
      pendingTitles[file] = (await r2.json()).titles || [];
    } catch {
      pendingTitles[file] = [];
    }
    render();
  } catch {
    alert('Cannot reach progress server to save.');
  }
}
```

- [ ] **Step 5: Manual verification**

Read the file back and confirm: CSS block is syntactically valid, all three state vars are declared once, all five click-delegation branches sit before the pre-existing `copyBtn` check, and all five functions exist with no duplicate names.

- [ ] **Step 6: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass (this task doesn't add tests — that's Task 4).

- [ ] **Step 7: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): wire up source panel state, click handling, and actions"
```

---

### Task 3: Dashboard HTML — render the source panel

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html`

**Interfaces:**
- Consumes: `sourceCache`, `sourceOpen`, `editingFile` from Task 2.
- Produces: `sourcePanelHTML(file): string`.
- Produces: `renderContent()` — same name, now injects `sourcePanelHTML(file)` once per file in its render loop.

- [ ] **Step 1: Add `sourcePanelHTML()`**

Insert immediately before `function noRunYetHTML(file) {`:

```js
function sourcePanelHTML(file) {
  const short = file.split('/').pop();

  if (editingFile === file) {
    return `<div class="source-panel">
      <div class="source-panel-header">
        <span class="source-panel-title">✎ Editing ${h(short)}</span>
        <div class="source-panel-actions">
          <button class="btn-primary" data-save-source="${h(file)}" style="font-size:11px;padding:4px 10px">💾 Save</button>
          <button class="btn-ghost" data-cancel-edit style="font-size:11px">✕ Cancel</button>
        </div>
      </div>
      <textarea class="source-editor" spellcheck="false">${h(sourceCache[file] ?? '')}</textarea>
    </div>`;
  }

  if (!sourceOpen.has(file)) {
    return `<div class="source-panel-collapsed"><button class="btn-ghost" data-view-source="${h(file)}" style="font-size:11px">📄 View source</button></div>`;
  }

  const loaded = sourceCache[file];
  if (loaded == null) {
    return `<div class="source-panel-collapsed"><span class="no-steps">Loading source…</span></div>`;
  }

  return `<div class="source-panel">
    <div class="source-panel-header">
      <span class="source-panel-title">📄 ${h(short)}</span>
      <div class="source-panel-actions">
        <button class="btn-ghost" data-edit-source="${h(file)}" style="font-size:11px">✎ Edit</button>
        <button class="btn-ghost" data-hide-source="${h(file)}" style="font-size:11px">▲ Hide</button>
      </div>
    </div>
    <pre class="source-view">${h(loaded)}</pre>
  </div>`;
}
```

Note: the `data-cancel-edit` button has no file value in its attribute (`cancelEdit()` takes no argument, since only one file can be in edit mode at a time via the single `editingFile` var) — don't add a `data-cancel-edit="${h(file)}"` value, the click handler from Task 2 Step 3 reads only the attribute's presence.

- [ ] **Step 2: Inject it into `renderContent()`'s per-file loop**

Find:

```js
  for (const file of filesToShow) {
    const suite = s && s.suites[file];
    if (suite)               { html += suiteBlockHTML(file, suite); continue; }
    const titles = pendingTitles[file];
    if (titles?.length)      { html += pendingBlockHTML(file, titles); continue; }
    html += noRunYetHTML(file);
  }
```

Replace with:

```js
  for (const file of filesToShow) {
    html += sourcePanelHTML(file);
    const suite = s && s.suites[file];
    if (suite)               { html += suiteBlockHTML(file, suite); continue; }
    const titles = pendingTitles[file];
    if (titles?.length)      { html += pendingBlockHTML(file, titles); continue; }
    html += noRunYetHTML(file);
  }
```

- [ ] **Step 3: Run the test suite for regressions**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all pre-existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): render the source view/edit panel per file"
```

---

### Task 4: `node:test` coverage for `/source` and `/save-spec`

**Files:**
- Create: `plugins/e2e-dashboard/tests/source-editor.test.js`

**Interfaces:**
- Consumes: `progress-server.js` spawned as a real child process (same pattern as `progress-server-http.test.js`).

- [ ] **Step 1: Write the test file**

```javascript
// plugins/e2e-dashboard/tests/source-editor.test.js
const { test, before, after } = require('node:test');
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

let tmpRoot, child, origin, token, specPath;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-src-'));
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'reporters'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'test-results'), { recursive: true });
  specPath = path.join(tmpRoot, 'tests', 'e2e', 'example.spec.ts');
  fs.copyFileSync(FIXTURE_SPEC, specPath);
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

test('GET /source without a token is rejected with 401', async () => {
  const res = await fetch(origin + '/source?file=tests/e2e/example.spec.ts');
  assert.equal(res.status, 401);
});

test('GET /source with a known file returns its real content', async () => {
  const res = await fetch(origin + '/source?file=tests/e2e/example.spec.ts', {
    headers: { 'X-Dashboard-Token': token },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.content, fs.readFileSync(specPath, 'utf8'));
});

test('GET /source with a traversal path is rejected with 400', async () => {
  const res = await fetch(origin + '/source?file=' + encodeURIComponent('../../../etc/passwd.spec.ts'), {
    headers: { 'X-Dashboard-Token': token },
  });
  assert.equal(res.status, 400);
});

test('POST /save-spec without a token is rejected with 401', async () => {
  const res = await fetch(origin + '/save-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'tests/e2e/example.spec.ts', content: 'x' }),
  });
  assert.equal(res.status, 401);
});

test('POST /save-spec writes new content to disk and it round-trips through GET /source', async () => {
  const newContent = "import { test, expect } from '@playwright/test';\ntest('edited', async () => { expect(true).toBe(true); });\n";
  const saveRes = await fetch(origin + '/save-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ file: 'tests/e2e/example.spec.ts', content: newContent }),
  });
  assert.equal(saveRes.status, 200);
  assert.equal(fs.readFileSync(specPath, 'utf8'), newContent);

  const readRes = await fetch(origin + '/source?file=tests/e2e/example.spec.ts', {
    headers: { 'X-Dashboard-Token': token },
  });
  const json = await readRes.json();
  assert.equal(json.content, newContent);
});

test('POST /save-spec with a traversal path is rejected with 400 and writes nothing', async () => {
  const outsidePath = path.join(tmpRoot, 'escaped.spec.ts');
  const res = await fetch(origin + '/save-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ file: '../escaped.spec.ts', content: 'malicious' }),
  });
  assert.equal(res.status, 400);
  assert.equal(fs.existsSync(outsidePath), false);
});

test('POST /save-spec with non-string content is rejected with 400', async () => {
  const res = await fetch(origin + '/save-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ file: 'tests/e2e/example.spec.ts', content: 12345 }),
  });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run the new file alone**

Run: `node --test plugins/e2e-dashboard/tests/source-editor.test.js`
Expected: 7/7 passing.

- [ ] **Step 3: Run the full suite**

Run: `node --test plugins/e2e-dashboard/tests/*.test.js`
Expected: all tests pass, pristine output.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/tests/source-editor.test.js
git commit -m "test(e2e-dashboard): add coverage for GET /source and POST /save-spec"
```

---

### Task 5: `e2e-dashboard` SKILL.md + README

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (docs-only).

- [ ] **Step 1: Bump the features line**

Find the bold "**N features**" line. Read the real current count from the file (do not assume a number — prior plans found this line had already drifted from what earlier plans expected). Bump it by one and insert a new clause: `inline spec source view + edit-and-save (writes back to disk via the same file whitelist /run uses)`.

- [ ] **Step 2: Add a Common Pitfalls row**

```markdown
| Edits not saving | Check the console for a "Save failed" alert with the server's error message — usually a permissions issue on the file, or the file was deleted/moved after the panel loaded. |
| Saved content looks wrong after re-opening | The save is a full-file overwrite with no conflict detection — if the file was also edited outside the dashboard (IDE, git) between load and save, the dashboard's version wins. Re-open (📄 View source) before editing if you suspect the file changed elsewhere. |
```

- [ ] **Step 3: Update the README**

Find the `e2e-dashboard` row in the skill summary table. Append a mention of inline source view/edit, keeping the feature count in sync with whatever Step 1 set it to.

- [ ] **Step 4: Verify and commit**

Read both files back to confirm the edits are well-formed and consistent, then:

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md README.md
git commit -m "docs(e2e-dashboard): document inline source view/edit"
```

---

### Task 6: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Real headless-browser check**

Using a scratch project with a real spec file, drive a headless browser (Playwright, as in prior plans' Task 12/B6) against a live server:
1. Click a file in the sidebar (before any run) — confirm a "📄 View source" button appears above the test list.
2. Click it — confirm the real file content renders in a `<pre>` block, matching the file on disk.
3. Click "✎ Edit" — confirm a `<textarea>` replaces the `<pre>`, pre-filled with the same content.
4. Change the content (e.g., add a comment line), click "💾 Save" — confirm the request succeeds, the panel returns to read mode showing the edited content, and the file on disk actually changed (read it directly).
5. Confirm the sidebar's pending-test titles refresh if the edit changed a `test()` title.
6. Click "✎ Edit" again, then "✕ Cancel" — confirm it discards the in-progress edit and returns to the read view showing the last-saved content (not the cancelled draft).
7. Confirm zero console/page errors throughout.

- [ ] **Step 2: Backward-compat / security check**

Confirm a file outside every configured `CATEGORIES` dir cannot be read or written via these routes even with a crafted `file` value (covered by Task 4's automated tests, but do one manual spot-check with browser devtools' Network tab to see the real 400 response).

- [ ] **Step 3: Record the outcome**

No commit for this task — if any check fails, open a follow-up task against the specific broken step.

---

## Explicitly out of scope for this plan

- **Structured, per-step editing** ("show me a list of steps, let me edit them, regenerate valid Playwright code"). This is a code-generation problem, not a UI problem — parsing arbitrary test code into an editable step model and correctly regenerating syntax from edits has real corruption risk if the parser/generator misses an edge case. Raw-code editing (this plan) is the safe, buildable v1; structured editing would need its own dedicated design and is deferred.
- **Syntax highlighting.** Would require a code-editor library (CodeMirror/Monaco), breaking the zero-dependency-template rule this codebase has held throughout. A plain `<textarea>` is the v1 tradeoff.
- **Conflict detection / concurrent-edit warnings.** No diffing against the on-disk version at save time — last write wins. Acceptable for a single-local-user dev tool; would need real design work (mtime checks, diff UI) if this becomes a shared/multi-user tool later.
- **Undo/version history beyond git.** The user's own git history is the safety net for a bad edit — this plan doesn't add an in-dashboard undo stack.
