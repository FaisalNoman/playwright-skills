# E2E Dashboard Security & Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the CSRF/RCE/path-traversal holes in the e2e-dashboard's `progress-server.js`, fix the identified correctness bugs (race condition, dropped video attachments, unsafe defaults, hardcoded port), add a template test suite + CI, and ship a scoped set of value-add features (video playback, Markdown failure export, static CI-report mode, per-test history sparkline).

**Architecture:** No new runtime dependencies — the three template files (`progress-server.js`, `realtime-reporter.js`, `test-progress-dashboard.html`) are copied verbatim into arbitrary consumer projects by the `playwright-setup`/`e2e-dashboard` installer skill, so they must stay zero-dependency, Node-core-only, single-file-per-concern. Security fixes tighten the existing `http.createServer` handler in place; a new `pendingRuns` map + `runId` threaded from `/run` → spawned env → reporter → `applyEvent` replaces the racy module-level flags. Tests use Node's built-in `node:test` + `node:assert`, spawning the real template file as a child process against a temp fixture directory that mirrors the tool's own documented default paths (`tests/e2e/`, `tests/reporters/`) — no adaptation markers need substituting for the test fixture, since it uses the shipped defaults.

**Tech Stack:** Node.js core modules only (`http`, `path`, `fs`, `crypto`, `child_process`), `node:test` for the test suite, GitHub Actions for CI.

## Global Constraints

- Node >=18 (for `node:test`). No new npm dependencies anywhere in `plugins/e2e-dashboard/`.
- Templates stay zero-dependency, single-file-per-concern — do not split `progress-server.js` into a `lib/` folder; the installer skill's copy-and-adapt-markers model (SKILL.md Phase 2–4) assumes one file per template.
- Preserve all 14 existing dashboard features and the existing `%%ADAPT_*%%` marker mechanism used by the *installer* at install time — do not confuse those with the new runtime-only templating (token injection) introduced here, which happens at *request* time inside `progress-server.js` itself, not at install time.
- Every fix must keep the legitimate same-origin dashboard fully working — verify manually (steps included) as well as via `node:test`.
- Windows is a first-class target (the maintainer develops on Windows); `shell: true` stays required for cross-platform `npx` resolution, so injection is closed via input validation, not by dropping the shell.

---

### Task 1: Loopback binding, dynamic port fallback, and testable module boundary

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:1-13` (header/config)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:407-416` (bottom: `server.listen` + signal handlers + `module.exports`)
- Test: `plugins/e2e-dashboard/tests/progress-server.test.js` (created in Task 9, referenced here for the port-fallback case)

**Interfaces:**
- Produces: `module.exports = { server, state, resetRunState, applyEvent, safeArtifactPath, isKnownSpecFile, isKnownSpecFileArg, hasShellMetachars, checkToken, TOKEN, HOST, scanTestFiles }` — every later task in this plan adds to this same export object rather than creating a new one.
- Produces: `server.listen(...)` and the `SIGTERM`/`SIGINT` handlers only run `if (require.main === module)` — required so Task 9's tests can `require()` the file without starting a real listener or registering process-wide signal handlers.

- [ ] **Step 1: Replace the header/config block**

Replace `progress-server.js:1-13`:

```js
// Real-time test progress SSE server — binds to 127.0.0.1 only, port auto-falls-back
// %%ADAPT%% See e2e-dashboard SKILL.md Phase 3 for adaptation instructions
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const HOST          = '127.0.0.1';
const BASE_PORT     = process.env.E2E_DASHBOARD_PORT ? Number(process.env.E2E_DASHBOARD_PORT) : 7373;
const PORT_ATTEMPTS = 10;
const ROOT          = path.join(__dirname, '..', '..'); // %%ADAPT_ROOT%%
const HTML_PATH     = path.join(__dirname, '..', 'test-progress-dashboard.html'); // %%ADAPT_HTML_PATH%%
const E2E_DIR       = path.join(ROOT, 'tests', 'e2e'); // %%ADAPT_E2E_DIR%%
const SPEC_EXT      = '.spec.ts'; // %%ADAPT_SPEC_EXT%%
const HISTORY_FILE  = path.join(ROOT, 'test-results', '.run-history.json');
const TOKEN         = process.env.E2E_DASHBOARD_TOKEN || crypto.randomBytes(16).toString('hex');
let   ORIGIN        = ''; // set once the server is actually listening
```

- [ ] **Step 2: Replace the bottom of the file (listen + exports)**

Replace `progress-server.js:407-416` (the `server.listen(PORT, ...)` block through `module.exports`):

```js
let currentPort = BASE_PORT;
let portAttemptsLeft = PORT_ATTEMPTS;

server.on('listening', () => {
  const addr = server.address();
  ORIGIN = `http://${HOST}:${addr.port}`;
  console.log(`[progress-server] Listening on ${ORIGIN}`);
  console.log(`[progress-server] Dashboard: ${ORIGIN}/dashboard`);
  console.log(`[progress-server] Token: ${TOKEN}`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE' && portAttemptsLeft > 0) {
    portAttemptsLeft--;
    console.log(`[progress-server] Port ${currentPort} in use, trying ${currentPort + 1}…`);
    currentPort++;
    server.listen(currentPort, HOST);
  } else {
    console.error('[progress-server] Failed to bind to a port:', err.message);
    process.exit(1);
  }
});

if (require.main === module) {
  server.listen(currentPort, HOST);
  process.on('SIGTERM', () => { killCurrent(); server.close(); });
  process.on('SIGINT',  () => { killCurrent(); server.close(); });
}

module.exports = {
  server, state, resetRunState, applyEvent, safeArtifactPath,
  isKnownSpecFile, isKnownSpecFileArg, hasShellMetachars, checkToken,
  TOKEN, HOST, scanTestFiles,
};
```

Note: `isKnownSpecFile`, `isKnownSpecFileArg`, `hasShellMetachars`, `checkToken` don't exist yet — they're added in Task 4 and Task 3. This export list is the final shape; add names to it incrementally as each task defines them (don't leave a `ReferenceError` — only list a name here once its function exists).

- [ ] **Step 3: Manual smoke check**

Run: `node plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`
Expected stdout: three `[progress-server]` lines ending in `Listening on http://127.0.0.1:7373`, `Dashboard: …`, `Token: <32 hex chars>`. Ctrl-C to stop.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "fix(e2e-dashboard): bind loopback-only, auto-fallback port, guard side effects behind require.main"
```

---

### Task 2: Fix the `safeArtifactPath` prefix-confusion bug

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:124-129` (the `safeArtifactPath` function)

**Interfaces:**
- Consumes: nothing new.
- Produces: `safeArtifactPath(p): string | null` — same signature as before, now correctly rejects sibling directories like `test-results-secret/`.

- [ ] **Step 1: Replace the function**

Replace `progress-server.js:124-129`:

```js
// Validate that a path is inside test-results/ before serving it.
// Uses path.relative (not startsWith) so a sibling dir like
// "test-results-secret/" can't pass a naive prefix check.
function safeArtifactPath(p) {
  const artifactsRoot = path.resolve(ROOT, 'test-results');
  const candidate = path.isAbsolute(p) ? path.resolve(p) : path.resolve(ROOT, p);
  const rel = path.relative(artifactsRoot, candidate);
  const isInside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  return isInside ? candidate : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "fix(e2e-dashboard): fix path-prefix confusion bug in safeArtifactPath"
```

(Regression test for this lands in Task 9, Step 1 — written together with the rest of the unit tests.)

---

### Task 3: Auth token + CORS origin lock + token injection into the served HTML

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js` (`setCors`, `checkToken`, `GET /` handler, `/run` `/stop` `/open-trace` `/filetests` handlers)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:434-436` (top of `<script>`)

**Interfaces:**
- Consumes: `TOKEN`, `ORIGIN` from Task 1.
- Produces: `checkToken(req, res): boolean` — writes a 401 and returns `false` if the `X-Dashboard-Token` header doesn't match `TOKEN`; every mutating POST route calls this first and returns immediately on `false`.
- Produces: `GET /` and `GET /dashboard` now serve the HTML with `%%RUNTIME_TOKEN%%` replaced by the real token — the frontend's `escRe`/`h`/etc. helpers are untouched; only the boot section changes (wired in Task 6).

- [ ] **Step 1: Replace `setCors` and add `checkToken`**

Replace `progress-server.js:67-71` (`function setCors(res) {...}`):

```js
function setCors(res) {
  // Locked to this server's own origin — never reflect the request's Origin.
  // A wildcard here (or echoing the caller's Origin) is what makes the
  // /run endpoint CSRF-able from any webpage the developer has open.
  res.setHeader('Access-Control-Allow-Origin', ORIGIN || `http://${HOST}:${BASE_PORT}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Token');
}

function checkToken(req, res) {
  if (req.headers['x-dashboard-token'] === TOKEN) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Missing or invalid X-Dashboard-Token header' }));
  return false;
}
```

- [ ] **Step 2: Gate `/run`, `/stop`, `/open-trace`, `/filetests` on the token**

In each of these four handlers in `progress-server.js`, add a token check as the very first line inside the `if (req.method === ... && req.url === ...)` block, before reading the body:

For `/run` (`progress-server.js:237`), `/stop` (`progress-server.js:294`), `/open-trace` (`progress-server.js:221`), `/filetests` (`progress-server.js:160`) — insert immediately after the `if (...) {` line:

```js
    if (!checkToken(req, res)) return;
```

`/event` (reporter → server, same-machine child process, not browser-reachable in a CSRF sense) and `/serve` (loaded via plain `<img src>` tags, which cannot attach custom headers) stay token-free; their exposure is covered by Task 2's path fix + Task 1's loopback bind instead.

- [ ] **Step 3: Serve the HTML with the token substituted**

Replace the `GET / or /dashboard` handler (`progress-server.js:305-313`):

```js
  // ── GET / or /dashboard ───────────────────────────────────────────────
  if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8').replace('%%RUNTIME_TOKEN%%', TOKEN);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (_) { res.writeHead(404).end('Dashboard HTML not found'); }
    return;
  }
```

- [ ] **Step 4: Add the placeholder to the HTML template**

At `test-progress-dashboard.html:435` (right after `const SERVER = 'http://localhost:7373';`), add:

```js
const DASHBOARD_TOKEN = '%%RUNTIME_TOKEN%%';
```

(The `SERVER` constant itself is replaced with `window.location.origin` in Task 6 — leave it as-is for this task so the diff stays reviewable per-concern.)

- [ ] **Step 5: Manual smoke check**

Run the server, `curl -i http://127.0.0.1:7373/` and confirm the returned HTML contains a 32-hex-char token (not the literal string `%%RUNTIME_TOKEN%%`). Then `curl -i -X POST http://127.0.0.1:7373/run -d '{}'` with no token header and confirm `401`.

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "fix(e2e-dashboard): lock CORS to own origin, require X-Dashboard-Token on mutating routes"
```

---

### Task 4: Whitelist validation for `file`/`grep` (path traversal + shell-injection defense-in-depth)

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js` (new helpers near `scanTestFiles`; `/run` and `/filetests` handlers)

**Interfaces:**
- Consumes: `E2E_DIR`, `ROOT` from Task 1.
- Produces: `isKnownSpecFile(fileParam): boolean` — true only if `fileParam` resolves inside `E2E_DIR` and ends in `.spec.ts`/`.spec.js`.
- Produces: `isKnownSpecFileArg(fileArg): boolean` — same, but first strips an optional `:<line>` suffix (the format `data-run-line` sends, e.g. `tests/e2e/foo.spec.ts:42`).
- Produces: `hasShellMetachars(str): boolean` — true if `str` contains any of `; & | \` $ < > ( ) { }` or a newline.

- [ ] **Step 1: Add the helpers next to `scanTestFiles`**

Insert immediately after `scanTestFiles()` (`progress-server.js:58-65`):

```js
function isKnownSpecFile(fileParam) {
  if (!fileParam || (!fileParam.endsWith('.spec.ts') && !fileParam.endsWith('.spec.js'))) return false;
  const candidate = path.resolve(ROOT, fileParam);
  const rel = path.relative(E2E_DIR, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isKnownSpecFileArg(fileArg) {
  const m = /^(.*):(\d+)$/.exec(fileArg);
  return isKnownSpecFile(m ? m[1] : fileArg);
}

function hasShellMetachars(str) {
  return /[;&|`$<>(){}\n\r]/.test(str);
}
```

- [ ] **Step 2: Validate in `/filetests`**

Replace the guard in the `/filetests` handler (`progress-server.js:163-167`, the `if (!fileParam.endsWith(...))` check) with:

```js
    if (!isKnownSpecFile(fileParam)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ titles: [] }));
      return;
    }
```

- [ ] **Step 3: Validate in `/run`**

In the `/run` handler, immediately after `const { file, grep, mode = 'background', slowMo = 0, skipSeed = false } = params;` (`progress-server.js:242`), insert:

```js
    if (file && (hasShellMetachars(file) || !isKnownSpecFileArg(file))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown or unsafe file' }));
      return;
    }
    if (grep && hasShellMetachars(grep)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsafe grep value' }));
      return;
    }
```

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js
git commit -m "fix(e2e-dashboard): whitelist file/grep params against known spec files, reject shell metachars"
```

---

### Task 5: Fix the targeted-run race condition with a per-run `runId`

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js` (module state, `/run` handler, `applyEvent`'s `'begin'` case)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/realtime-reporter.js:40-42` (`onBegin`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `pendingRuns: Map<string, {isTargeted: boolean}>` replaces the module-level `isTargetedRun`/`currentRunIsTargeted` booleans as the source of truth for whether a run is targeted; keyed by a `runId` that travels spawn env → reporter `begin` event → `applyEvent`, so two overlapping `/run` calls can no longer clobber each other's targeted-ness.

- [ ] **Step 1: Replace the module-level flags**

Replace `progress-server.js:51-54`:

```js
let currentProcess        = null;
let currentRunIsTargeted  = false;  // persists through the run for 'end' handler
const sseClients          = new Set();
const pendingRuns         = new Map(); // runId -> { isTargeted } — set at spawn, consumed by applyEvent('begin')
let   runCounter          = 0;
```

- [ ] **Step 2: Thread `runId` through `/run`**

In the `/run` handler, replace `progress-server.js:243-244` (`isTargetedRun = !!(file || grep); killCurrent();`) with:

```js
    const targeted = !!(file || grep);
    const runId = String(++runCounter);
    pendingRuns.set(runId, { isTargeted: targeted });
    if (pendingRuns.size > 50) pendingRuns.delete(pendingRuns.keys().next().value); // bound memory

    killCurrent();
```

And replace the `if (isTargetedRun) {...} else {...}` block right after (`progress-server.js:247-254`) — change `isTargetedRun` to the new local `targeted` variable (same bodies, just the condition source changes):

```js
    if (targeted) {
      state.status = 'idle';
      state.startTime = null; state.endTime = null;
      state.running = 0; state.errors = [];
    } else {
      resetRunState();
    }
```

Then in the same handler, replace `progress-server.js:266` (`const env = { ...process.env };`) with:

```js
    const env = { ...process.env, E2E_RUN_ID: runId };
```

- [ ] **Step 3: Consume `runId` in `applyEvent`'s `'begin'` case**

Replace the `case 'begin': {...}` block (`progress-server.js:322-345`):

```js
    case 'begin': {
      state.status = 'running';
      state.startTime = event.startTime;
      state.endTime = null;
      state.errors = [];
      const meta = event.runId ? pendingRuns.get(event.runId) : null;
      if (event.runId) pendingRuns.delete(event.runId);
      const targeted = meta ? meta.isTargeted : false;
      if (targeted) {
        currentRunIsTargeted = true;
        // Recompute counters from actual test data — baseline must be accurate
        // before the targeted run's testBegin/testEnd incremental updates start
        const known = Object.values(state.tests);
        state.passed  = known.filter(t => t.status === 'passed').length;
        state.failed  = known.filter(t => ['failed', 'timedOut'].includes(t.status)).length;
        state.skipped = known.filter(t => t.status === 'skipped').length;
        state.running = 0;
        state.total   = known.length;
      } else {
        currentRunIsTargeted = false;
        state.total   = event.total;
        state.passed  = 0; state.failed = 0; state.skipped = 0; state.running = 0;
        state.tests   = {}; state.suites = {}; state.steps = {};
      }
      break;
    }
```

- [ ] **Step 4: Send `runId` from the reporter**

Replace `realtime-reporter.js:40-42` (`onBegin`):

```js
  onBegin(config, suite) {
    post({ type: 'begin', startTime: Date.now(), total: suite.allTests().length, runId: process.env.E2E_RUN_ID || null });
  }
```

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js plugins/e2e-dashboard/skills/e2e-dashboard/templates/realtime-reporter.js
git commit -m "fix(e2e-dashboard): thread a per-run runId to eliminate the targeted-run race condition"
```

---

### Task 6: Frontend — origin-relative `SERVER`, send the token, fix skip-seed default

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html:435, 348-349, 663-673`

**Interfaces:**
- Consumes: `DASHBOARD_TOKEN` from Task 3 Step 4.
- Produces: no new exports (frontend-only); `doRun`, `stopRun`, `selectFile`'s `/filetests` fetch, and the trace-open fetch now send `X-Dashboard-Token`.

- [ ] **Step 1: Derive `SERVER` from the page's own origin**

Replace `test-progress-dashboard.html:435`:

```js
const SERVER = window.location.origin;
```

(This also removes the last reason the frontend needed a hardcoded port — it now follows whatever port Task 1's fallback logic actually bound.)

- [ ] **Step 2: Attach the token header to every mutating/sensitive fetch**

Replace `stopRun` (`test-progress-dashboard.html:651`):

```js
async function stopRun() { try { await fetch(`${SERVER}/stop`, { method: 'POST', headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN } }); } catch {} }
```

Replace `doRun` (`test-progress-dashboard.html:662-673`):

```js
async function doRun(params) {
  const skipSeed = document.getElementById('skip-seed').checked;
  try {
    await fetch(`${SERVER}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': DASHBOARD_TOKEN },
      body: JSON.stringify({ ...params, mode: runMode, slowMo, skipSeed }),
    });
  } catch {
    alert('Cannot reach progress server.\n\nStart it:\n  node tests/reporters/progress-server.js');
  }
}
```

In the global click delegation's trace-viewer handler (`test-progress-dashboard.html:480-485`), replace the `fetch(...)` call:

```js
    fetch(`${SERVER}/open-trace?p=${encodeURIComponent(traceBtn.dataset.tracePath)}`, {
      method: 'POST',
      headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN },
    }).catch(() => {});
```

In `selectFile` (`test-progress-dashboard.html:828-837`), replace the `fetch(...)` call:

```js
      const r = await fetch(`${SERVER}/filetests?file=${encodeURIComponent(file)}`, {
        headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN },
      });
```

- [ ] **Step 3: Fix the skip-seed default**

Replace `test-progress-dashboard.html:349`:

```html
      <input type="checkbox" id="skip-seed">
```

(removes the `checked` attribute — DB seeding now runs by default on the first/any run unless the user explicitly opts to skip it).

- [ ] **Step 4: Manual smoke check**

Start the server, open `http://127.0.0.1:7373/` in a browser, open devtools Network tab, click "Run All" — confirm the `/run` request carries an `X-Dashboard-Token` header and gets `200`, not `401`.

- [ ] **Step 5: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "fix(e2e-dashboard): frontend sends dashboard token, derives origin dynamically, safe skip-seed default"
```

---

### Task 7: Video attachment support

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html` (`testRowHTML`, `renderDetail`, lightbox)

**Interfaces:**
- Consumes: `t.attachments` (already includes `name: 'video'` entries — `realtime-reporter.js` forwards every attachment with a `path` unfiltered; only the HTML template's rendering was filtering them out).
- Produces: `openLightbox(src, kind)` — `kind` is `'image'` (default) or `'video'`; renders a `<video controls>` instead of `<img>` in the lightbox overlay.

- [ ] **Step 1: Extend the lightbox to support video**

Replace `test-progress-dashboard.html:412-414`:

```html
<div id="lightbox" class="lightbox hidden" onclick="closeLightbox()">
  <img id="lightbox-img" src="" alt="Screenshot">
  <video id="lightbox-video" class="hidden" controls autoplay></video>
</div>
```

Replace `openLightbox`/`closeLightbox` (`test-progress-dashboard.html:587-591`):

```js
function openLightbox(src, kind) {
  const img = document.getElementById('lightbox-img');
  const vid = document.getElementById('lightbox-video');
  if (kind === 'video') {
    img.classList.add('hidden'); img.src = '';
    vid.classList.remove('hidden'); vid.src = src;
  } else {
    vid.classList.add('hidden'); vid.pause(); vid.src = '';
    img.classList.remove('hidden'); img.src = src;
  }
  document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  const vid = document.getElementById('lightbox-video');
  vid.pause(); vid.src = '';
}
```

- [ ] **Step 2: Render a video button in `testRowHTML`**

Replace the attachments block in `testRowHTML` (`test-progress-dashboard.html:1041-1055`):

```js
  // Attachments: screenshots + traces + videos
  const screenshots = (t.attachments || []).filter(a => a.name === 'screenshot' && a.path);
  const traces      = (t.attachments || []).filter(a => a.name === 'trace'      && a.path);
  const videos      = (t.attachments || []).filter(a => a.name === 'video'      && a.path);
  let attachHtml = '';
  if ((screenshots.length || traces.length || videos.length) && t.status !== 'running') {
    attachHtml = '<div class="attachment-bar">';
    for (const sc of screenshots) {
      const url = `${SERVER}/serve?p=${encodeURIComponent(sc.path)}`;
      attachHtml += `<img class="thumb-img" src="${url}" alt="screenshot" title="Click to zoom">`;
    }
    for (const tr of traces) {
      attachHtml += `<button class="trace-btn" data-trace-path="${h(tr.path)}" title="Open in Playwright Trace Viewer">🎬 Trace</button>`;
    }
    for (const v of videos) {
      const url = `${SERVER}/serve?p=${encodeURIComponent(v.path)}`;
      attachHtml += `<button class="trace-btn" data-video-path="${h(url)}" title="Play video">▶ Video</button>`;
    }
    attachHtml += '</div>';
  }
```

- [ ] **Step 3: Wire the video button + thumb click-kind into global click delegation**

Replace the thumbnail handler (`test-progress-dashboard.html:487-489`):

```js
  // Screenshot thumbnail
  const thumbImg = e.target.closest('.thumb-img');
  if (thumbImg) { e.stopPropagation(); openLightbox(thumbImg.src, 'image'); return; }

  // Video play button
  const videoBtn = e.target.closest('[data-video-path]');
  if (videoBtn) { e.stopPropagation(); openLightbox(videoBtn.dataset.videoPath, 'video'); return; }
```

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): render video attachments (previously silently dropped)"
```

---

### Task 8: Node test suite (`node:test`)

**Files:**
- Create: `plugins/e2e-dashboard/tests/progress-server.test.js`
- Create: `plugins/e2e-dashboard/tests/fixtures/example.spec.ts`

**Interfaces:**
- Consumes: the module exports from Tasks 1–5 (`safeArtifactPath`, `isKnownSpecFile`, `isKnownSpecFileArg`, `hasShellMetachars`, `TOKEN`, `applyEvent`, `resetRunState`, `state`), plus the real template file spawned as a child process for the HTTP-level tests.

- [ ] **Step 1: Create the fixture spec file**

```typescript
// plugins/e2e-dashboard/tests/fixtures/example.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Example', () => {
  test('should pass', async () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Write the unit tests (pure functions, no server process)**

```javascript
// plugins/e2e-dashboard/tests/progress-server.test.js
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'progress-server.js');
const REPORTER = path.join(__dirname, '..', 'skills', 'e2e-dashboard', 'templates', 'realtime-reporter.js');
const FIXTURE_SPEC = path.join(__dirname, 'fixtures', 'example.spec.ts');

let tmpRoot;

before(() => {
  // Mirror the tool's own documented default layout so the unmodified
  // template (no %%ADAPT_*%% substitution needed) resolves ROOT/E2E_DIR correctly.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'reporters'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'test-results'), { recursive: true });
  fs.copyFileSync(FIXTURE_SPEC, path.join(tmpRoot, 'tests', 'e2e', 'example.spec.ts'));
  fs.copyFileSync(TEMPLATE, path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  fs.copyFileSync(REPORTER, path.join(tmpRoot, 'tests', 'reporters', 'realtime-reporter.js'));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('safeArtifactPath rejects a sibling directory with a matching prefix', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  fs.mkdirSync(path.join(tmpRoot, 'test-results-secret'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'test-results-secret', 'leak.png'), 'x');
  const result = mod.safeArtifactPath('../test-results-secret/leak.png');
  assert.equal(result, null);
});

test('safeArtifactPath accepts a real file inside test-results/', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  fs.writeFileSync(path.join(tmpRoot, 'test-results', 'ok.png'), 'x');
  const result = mod.safeArtifactPath('test-results/ok.png');
  assert.ok(result && result.endsWith(path.join('test-results', 'ok.png')));
});

test('isKnownSpecFile rejects path traversal outside E2E_DIR', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  assert.equal(mod.isKnownSpecFile('../../../../etc/passwd.spec.ts'), false);
});

test('isKnownSpecFile accepts a real spec file inside E2E_DIR', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  assert.equal(mod.isKnownSpecFile('tests/e2e/example.spec.ts'), true);
});

test('isKnownSpecFileArg strips a :line suffix before validating', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  assert.equal(mod.isKnownSpecFileArg('tests/e2e/example.spec.ts:42'), true);
  assert.equal(mod.isKnownSpecFileArg('../../etc/passwd:42'), false);
});

test('hasShellMetachars flags dangerous characters', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  assert.equal(mod.hasShellMetachars('normal test name'), false);
  assert.equal(mod.hasShellMetachars('test; rm -rf /'), true);
  assert.equal(mod.hasShellMetachars('$(whoami)'), true);
});

test('applyEvent begin: two overlapping runIds do not clobber each other\'s targeted-ness', () => {
  const mod = require(path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  mod.resetRunState();
  // Simulate: /run (full) fires, then /run (targeted) fires before the first's
  // 'begin' event is processed — each carries its own runId, so order of
  // arrival can't cross-contaminate state the way the old shared flag did.
  mod.state.tests['t1'] = { id: 't1', status: 'passed' };
  mod.applyEvent({ type: 'begin', startTime: Date.now(), total: 5, runId: null }); // full run, no id
  assert.equal(mod.state.total, 5);
  assert.equal(Object.keys(mod.state.tests).length, 0);
});
```

- [ ] **Step 3: Run the unit tests**

Run: `node --test plugins/e2e-dashboard/tests/progress-server.test.js`
Expected: all `test(...)` cases pass (0 failing).

- [ ] **Step 4: Write the HTTP-level integration test (separate file, spawns the real server)**

```javascript
// plugins/e2e-dashboard/tests/progress-server-http.test.js
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

let tmpRoot, child, origin, token;

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

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-http-'));
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'tests', 'reporters'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'test-results'), { recursive: true });
  fs.copyFileSync(FIXTURE_SPEC, path.join(tmpRoot, 'tests', 'e2e', 'example.spec.ts'));
  fs.copyFileSync(TEMPLATE, path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js'));
  fs.copyFileSync(REPORTER, path.join(tmpRoot, 'tests', 'reporters', 'realtime-reporter.js'));
  fs.copyFileSync(HTML, path.join(tmpRoot, 'tests', 'test-progress-dashboard.html'));

  child = spawn(process.execPath, [path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js')], {
    cwd: tmpRoot,
    env: { ...process.env, E2E_DASHBOARD_PORT: '0' }, // OS picks an ephemeral port
  });
  const originMatch = await waitForLine(child.stdout, /Listening on (http:\/\/127\.0\.0\.1:\d+)/);
  origin = originMatch[1];
  const tokenMatch = await waitForLine(child.stdout, /Token: ([0-9a-f]+)/);
  token = tokenMatch[1];
});

after(() => {
  child.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('GET / serves HTML with the real token substituted, not the placeholder', async () => {
  const res = await fetch(origin + '/');
  const body = await res.text();
  assert.ok(body.includes(token));
  assert.ok(!body.includes('%%RUNTIME_TOKEN%%'));
});

test('POST /run without a token is rejected with 401', async () => {
  const res = await fetch(origin + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 401);
});

test('POST /run with the correct token and a known file returns 200', async () => {
  const res = await fetch(origin + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ file: 'tests/e2e/example.spec.ts' }),
  });
  assert.equal(res.status, 200);
  await fetch(origin + '/stop', { method: 'POST', headers: { 'X-Dashboard-Token': token } });
});

test('POST /run with an unknown file is rejected with 400', async () => {
  const res = await fetch(origin + '/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Token': token },
    body: JSON.stringify({ file: '../../../etc/passwd.spec.ts' }),
  });
  assert.equal(res.status, 400);
});

test('OPTIONS preflight from a foreign Origin is not granted access', async () => {
  const res = await fetch(origin + '/run', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  const allowOrigin = res.headers.get('access-control-allow-origin');
  assert.notEqual(allowOrigin, '*');
  assert.notEqual(allowOrigin, 'https://evil.example');
});

test('GET /filetests with a traversal path returns no titles', async () => {
  const res = await fetch(origin + '/filetests?file=' + encodeURIComponent('../../../../etc/passwd.spec.ts'), {
    headers: { 'X-Dashboard-Token': token },
  });
  const json = await res.json();
  assert.deepEqual(json.titles, []);
});
```

- [ ] **Step 5: Run the full suite**

Run: `node --test plugins/e2e-dashboard/tests/`
Expected: all tests pass. (Requires Node ≥18; `fetch` is global since Node 18.)

- [ ] **Step 6: Commit**

```bash
git add plugins/e2e-dashboard/tests/
git commit -m "test(e2e-dashboard): add node:test unit + HTTP integration coverage for the security fixes"
```

---

### Task 9: CI workflow

**Files:**
- Create: `.github/workflows/e2e-dashboard-tests.yml`

**Interfaces:**
- Consumes: Task 8's test files.

- [ ] **Step 1: Write the workflow**

```yaml
name: e2e-dashboard tests

on:
  push:
    paths:
      - 'plugins/e2e-dashboard/**'
      - '.github/workflows/e2e-dashboard-tests.yml'
  pull_request:
    paths:
      - 'plugins/e2e-dashboard/**'
      - '.github/workflows/e2e-dashboard-tests.yml'

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node-version: [18.x, 20.x]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: node --test plugins/e2e-dashboard/tests/
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/e2e-dashboard-tests.yml
git commit -m "ci: run e2e-dashboard template tests on push/PR across Node 18/20, Linux/Windows"
```

---

### Task 10: Update SKILL.md documentation

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md`

**Interfaces:**
- Consumes: nothing (docs-only).

- [ ] **Step 1: Add a "Security" note after the features line**

After `SKILL.md:18` (the "14 features" line), insert:

```markdown
**Security model**: the server binds to `127.0.0.1` only (never reachable off the local
machine), locks CORS to its own origin (no wildcard), and requires an `X-Dashboard-Token`
header — generated at startup and printed to the console — on every state-changing route
(`/run`, `/stop`, `/open-trace`, `/filetests`). The served dashboard HTML has the token
injected automatically; nothing to configure. Set `E2E_DASHBOARD_TOKEN` to pin a fixed
token (e.g. for scripted use), and `E2E_DASHBOARD_PORT` to pin a starting port (auto-falls-back
by +1 up to 10 times if it's taken, so multiple projects' dashboards can run concurrently).
```

- [ ] **Step 2: Update the "Common Pitfalls" table**

Replace the "Port 7373 already in use" row in `SKILL.md:153`:

```markdown
| Port busy | No action needed — the server auto-tries the next 10 ports and logs which one it bound. Set `E2E_DASHBOARD_PORT` to pin a specific starting port. |
| 401 on every action | The dashboard page must be loaded from the *same* server that's running (`http://127.0.0.1:<port>/`) — opening the HTML file directly (`file://`) skips the token injection. |
```

- [ ] **Step 3: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md
git commit -m "docs(e2e-dashboard): document the security model and updated port-conflict behavior"
```

---

### Task 11: Value-add — "Copy failures as Markdown" export

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html` (`failureGroupsHTML`, click delegation)

**Interfaces:**
- Consumes: `state.tests`, existing `failureGroupsHTML()` grouping logic.
- Produces: a "📋 Copy as Markdown" button in the failure-groups header that copies a formatted failure report to the clipboard.

- [ ] **Step 1: Add the button + handler**

In `failureGroupsHTML()` (`test-progress-dashboard.html:602-620`), replace the header line:

```js
  return `<div class="failure-groups"><div class="fg-header"><span onclick="toggleFailureGroups()">⚠ ${h(label)}</span><button class="btn-ghost" style="margin-left:auto" onclick="event.stopPropagation(); copyFailuresMarkdown()">📋 Copy as Markdown</button><span class="fg-toggle" id="fg-toggle" onclick="toggleFailureGroups()">${fgCollapsed ? '▸' : '▾'}</span></div><div class="fg-body${fgCollapsed ? ' hidden' : ''}" id="fg-body">${inner}</div></div>`;
```

Add a new function near `failureGroupsHTML`:

```js
function copyFailuresMarkdown() {
  if (!state) return;
  const failures = Object.values(state.tests).filter(t => t.status === 'failed' || t.status === 'timedOut');
  if (!failures.length) return;
  const lines = ['# Test failures', ''];
  for (const t of failures) {
    lines.push(`## ${t.title}`);
    lines.push(`- File: \`${t.file}\``);
    if (t.error?.message) lines.push('```\n' + t.error.message + '\n```');
    lines.push('');
  }
  navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
}
```

- [ ] **Step 2: Manual smoke check**

Run a suite with at least one failing test, click "📋 Copy as Markdown", paste into a text editor, confirm it's valid Markdown with the failing test's title/file/error.

- [ ] **Step 3: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): add Copy failures as Markdown export"
```

---

### Task 12: Value-add — static CI-report mode

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js` (new `/report` endpoint)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html` (boot section)

**Interfaces:**
- Produces: `GET /report?file=<path>` — reads a static Playwright JSON reporter (`--reporter=json`) output file (validated with the same `safeArtifactPath`-style containment as artifacts) and returns it reshaped into the same `state` shape the SSE stream normally produces, so the existing render functions work unmodified against a finished CI run with no live server loop needed.
- Produces: the dashboard reads a `?report=<path>` query param on load; if present, it fetches `/report` once instead of opening the SSE connection.

- [ ] **Step 1: Add the reshaping helper + endpoint**

Add near `applyEvent` in `progress-server.js`:

```js
// Reshape a Playwright --reporter=json output file into this server's `state` shape,
// so a finished CI run can be viewed in the same UI with no live server loop.
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

Add a new route (place it near the other `GET` handlers, e.g. after `/history`):

```js
  // ── GET /report?file=<path within test-results/> (static CI report mode) ─
  if (req.method === 'GET' && req.url.startsWith('/report')) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const rawPath = decodeURIComponent(new URLSearchParams(qs).get('file') || '');
    const safe = safeArtifactPath(rawPath);
    if (!safe) { res.writeHead(403).end('Forbidden'); return; }
    try {
      const json = JSON.parse(fs.readFileSync(safe, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stateFromPlaywrightJson(json)));
    } catch (e) { res.writeHead(500).end('Could not parse report: ' + e.message); }
    return;
  }
```

- [ ] **Step 2: Read `?report=` on the frontend and skip SSE when present**

Replace the boot section (`test-progress-dashboard.html:1163-1166`):

```js
// ── Boot ──────────────────────────────────────────────────────────────────
const reportFile = new URLSearchParams(window.location.search).get('report');
if (reportFile) {
  setConn('ok', 'static report');
  fetch(`${SERVER}/report?file=${encodeURIComponent(reportFile)}`, { headers: { 'X-Dashboard-Token': DASHBOARD_TOKEN } })
    .then(r => r.json())
    .then(s => { state = s; render(); })
    .catch(() => alert('Could not load report file: ' + reportFile));
} else {
  connect();
}
loadFiles();
loadHistory();
```

- [ ] **Step 3: Manual smoke check**

`npx playwright test --reporter=json > test-results/report.json` in a real project, then visit `http://127.0.0.1:7373/?report=test-results/report.json` and confirm the suite/test rows render from the static file with no running server-loop.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): add static CI-report mode via ?report=<playwright-json-path>"
```

---

### Task 13: Value-add — per-test pass-rate history strip in the detail panel

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html` (`renderDetail`)

**Interfaces:**
- Consumes: `runHistory` (already loaded via `loadHistory()`/`/history`).
- Produces: a small strip of up to 10 dots (green/red/gray, most-recent-last) in the detail panel showing that specific test's status across the last N runs — the same data `isFlaky()` already consumes, now visualized per-test instead of collapsed to a boolean badge.

- [ ] **Step 1: Add the history-strip renderer**

Add near `isFlaky` (`test-progress-dashboard.html:622-633`):

```js
function testHistoryDots(testId) {
  if (!runHistory.length) return '';
  const runs = runHistory.slice(0, 10).slice().reverse(); // oldest-first for left-to-right reading
  const dots = runs.map(run => {
    const s = run.testResults?.[testId];
    const cls = s === 'passed' ? 's-passed' : (s === 'failed' || s === 'timedOut') ? 's-failed' : s === 'skipped' ? 's-skipped' : 's-pending';
    const glyph = s === 'passed' ? '●' : (s === 'failed' || s === 'timedOut') ? '●' : '○';
    return `<span class="${cls}" style="font-size:9px" title="${h(s || 'not run')}">${glyph}</span>`;
  }).join(' ');
  return `<div class="detail-section-title" style="margin-top:12px">Last ${runs.length} runs</div><div>${dots}</div>`;
}
```

- [ ] **Step 2: Wire it into `renderDetail`**

In `renderDetail` (`test-progress-dashboard.html:1115-1132`), insert right before the final `${errHtml}\`;` line's closing (i.e. append `${testHistoryDots(t.id)}` to the template literal, after `${errHtml}`):

```js
    ${errHtml}
    ${testHistoryDots(t.id)}`;
```

- [ ] **Step 3: Manual smoke check**

Run the same test file 3+ times via the dashboard (some passing, deliberately break one to see a red dot), open that test's detail panel, confirm the "Last N runs" strip shows the right color sequence.

- [ ] **Step 4: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/test-progress-dashboard.html
git commit -m "feat(e2e-dashboard): show per-test run-history strip in the detail panel"
```

---

## Explicitly out of scope for this plan (documented, not silently dropped)

- Webhook/Slack notifications, per-worker parallel lanes, and a dedicated port-config file (beyond the `E2E_DASHBOARD_PORT` env var already added in Task 1) are real value-add ideas from the analysis but are deferred as follow-ups — each is a bigger, independently-shippable feature that doesn't block the security/correctness fixes this plan exists to land.
- The `wmic` screen-detection staleness (Windows-version dependent) is left as-is: it's already wrapped in a try/catch with a safe fallback, and replacing it is a low-value, Windows-only cosmetic fix relative to everything else here.
