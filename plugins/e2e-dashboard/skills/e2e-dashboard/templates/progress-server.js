// Real-time test progress SSE server — binds to 127.0.0.1 only, port auto-falls-back
// %%ADAPT%% See e2e-dashboard SKILL.md Phase 3 for adaptation instructions
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const HOST          = '127.0.0.1';

function resolveBasePort() {
  const raw = process.env.E2E_DASHBOARD_PORT;
  if (!raw) return 7373;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.warn(`[progress-server] Invalid E2E_DASHBOARD_PORT "${raw}" — must be an integer 1-65535. Falling back to 7373.`);
    return 7373;
  }
  return n;
}

const BASE_PORT     = resolveBasePort();
const PORT_ATTEMPTS = 10;
const ROOT          = path.join(__dirname, '..', '..'); // %%ADAPT_ROOT%%
const HTML_PATH     = path.join(__dirname, '..', 'test-progress-dashboard.html'); // %%ADAPT_HTML_PATH%%
const CATEGORIES    = [ { key: 'e2e', label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'), prefix: 'tests/e2e' } ]; // %%ADAPT_CATEGORIES%%
const BROWSERS      = [ { key: 'chromium', label: 'Chromium', icon: '🧭' } ]; // %%ADAPT_BROWSERS%%
const SPEC_EXT      = '.spec.ts'; // %%ADAPT_SPEC_EXT%%
const HISTORY_FILE  = path.join(ROOT, 'test-results', '.run-history.json');
const TOKEN         = process.env.E2E_DASHBOARD_TOKEN || crypto.randomBytes(16).toString('hex');
let   ORIGIN        = ''; // set once the server is actually listening
let   ACTIVE_PORT   = null; // the port actually bound (may differ from BASE_PORT after fallback) — set in 'listening' handler

// Detect primary screen size at startup so interactive runs can be positioned on the right half
let SCREEN_W = 1920, SCREEN_H = 1080;
try {
  if (process.platform === 'win32') {
    const r = spawnSync('wmic', ['desktopmonitor', 'get', 'screenwidth,screenheight', '/format:value'],
      { encoding: 'utf8', timeout: 3000 });
    const out = r.stdout || '';
    const w = (out.match(/ScreenWidth=(\d+)/)  || [])[1];
    const h = (out.match(/ScreenHeight=(\d+)/) || [])[1];
    if (w && parseInt(w) > 0) SCREEN_W = parseInt(w);
    if (h && parseInt(h) > 0) SCREEN_H = parseInt(h);
  }
} catch (_) {}
console.log(`[progress-server] Screen: ${SCREEN_W}x${SCREEN_H}`);

// Run history — last 20 full runs, used for flakiness detection
let runHistory = [];
try {
  fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
  runHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
} catch (_) {}

let state = {
  status: 'idle',
  startTime: null,
  endTime: null,
  total: 0, passed: 0, failed: 0, skipped: 0, running: 0,
  tests: {},   // id -> { title, file, describes, line, status, duration, error, attachments, retry }
  suites: {},  // file -> { file, tests: [] }
  steps: {},   // testId -> [{ title, category, status }]
  errors: [],
  runMode: 'background',
  currentFile: null,
  currentGrep: null,
};

let currentProcess        = null;
let currentRunIsTargeted  = false;  // persists through the run for 'end' handler
const sseClients          = new Set();
const pendingRuns         = new Map(); // runId -> { isTargeted } — set at spawn, consumed by applyEvent('begin')
let   runCounter          = 0;

// ── helpers ───────────────────────────────────────────────────────────────────

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

function isKnownSpecFile(fileParam) {
  if (!fileParam || (!fileParam.endsWith('.spec.ts') && !fileParam.endsWith('.spec.js'))) return false;
  const candidate = path.resolve(ROOT, fileParam);
  return CATEGORIES.some(cat => {
    const rel = path.relative(cat.dir, candidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

function isKnownSpecFileArg(fileArg) {
  const m = /^(.*):(\d+)$/.exec(fileArg);
  return isKnownSpecFile(m ? m[1] : fileArg);
}

function hasShellMetachars(str) {
  return /[;&|`$<>(){}\n\r]/.test(str);
}

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

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}
function broadcastState() { broadcast('state', state); }

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => resolve(body));
  });
}

// Windows blocks a background process from stealing window focus (the
// "foreground lock"), so an automated Chromium window opens correctly
// positioned/sized but stays behind other windows until manually clicked.
// AttachThreadInput is the reliable technique for this: temporarily borrow
// the input thread of whatever window currently owns the foreground, which
// grants us standing to call SetForegroundWindow on the target, then detach.
// (A simpler ALT-keypress simulation was tried first — it worked when a
// human ran the script directly from their own terminal, but not through
// this Node → PowerShell → target-window chain, since the PowerShell
// process spawned here has no foreground standing of its own either.)
// Logs to test-results/.focus-debug.log so a failure is diagnosable without
// another guess-and-check round. We poll briefly because the Chromium
// window doesn't exist yet at spawn time — it can take a second or two.
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

function focusInteractiveBrowser(rootPid) {
  if (process.platform !== 'win32') return;
  const logPath = path.join(ROOT, 'test-results', '.focus-debug.log');
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$logPath = '${logPath.replace(/'/g, "''")}'`,
    'function Log($msg) { Add-Content -Path $logPath -Value "$(Get-Date -Format o) $msg" }',
    "Add-Type -Name Win32Focus -Namespace Native -MemberDefinition '",
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
    '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);',
    '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
    "'",
    'function Get-DescendantPids($rootId) {',
    '  $all = New-Object System.Collections.Generic.List[int]; $all.Add($rootId)',
    '  $queue = New-Object System.Collections.Generic.Queue[int]; $queue.Enqueue($rootId)',
    '  while ($queue.Count -gt 0) {',
    '    $p = $queue.Dequeue()',
    '    Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" | ForEach-Object {',
    '      if (-not $all.Contains($_.ProcessId)) { $all.Add($_.ProcessId); $queue.Enqueue($_.ProcessId) }',
    '    }',
    '  }',
    '  return $all',
    '}',
    `Log "Starting focus attempt for root PID ${rootPid}"`,
    '$target = $null',
    'for ($i = 0; $i -lt 20; $i++) {',
    '  Start-Sleep -Milliseconds 300',
    `  $pids = Get-DescendantPids ${rootPid}`,
    "  $target = Get-Process -Id $pids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -like 'chrome*' } | Select-Object -First 1",
    '  if ($target) { Log "Found target after $($i+1) tries: PID=$($target.Id) Handle=$($target.MainWindowHandle) Title=$($target.MainWindowTitle)"; break }',
    '}',
    'if (-not $target) { Log "FAILED: no chrome window found after 6s"; exit }',
    '',
    '$fgThread = 0',
    '$fg = [Native.Win32Focus]::GetForegroundWindow()',
    '[Native.Win32Focus]::GetWindowThreadProcessId($fg, [ref]$fgThread) | Out-Null',
    '$myThread = [Native.Win32Focus]::GetCurrentThreadId()',
    'Log "Foreground window before: $fg (thread $fgThread), my thread: $myThread"',
    '',
    '[Native.Win32Focus]::AttachThreadInput($fgThread, $myThread, $true) | Out-Null',
    '[Native.Win32Focus]::BringWindowToTop($target.MainWindowHandle) | Out-Null',
    '[Native.Win32Focus]::ShowWindow($target.MainWindowHandle, 9) | Out-Null',
    '$result = [Native.Win32Focus]::SetForegroundWindow($target.MainWindowHandle)',
    '[Native.Win32Focus]::AttachThreadInput($fgThread, $myThread, $false) | Out-Null',
    '',
    'Start-Sleep -Milliseconds 200',
    '$after = [Native.Win32Focus]::GetForegroundWindow()',
    'Log "SetForegroundWindow returned: $result. Foreground after: $after. Success: $($after -eq $target.MainWindowHandle)"',
  ].join('\n');
  try {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { shell: true, stdio: 'ignore', detached: true });
    ps.on('error', () => {}); // best-effort UX polish — must never crash the server if powershell isn't on PATH
    ps.unref();
  } catch (_) {}
}

function killCurrent() {
  if (!currentProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(currentProcess.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
    } else {
      currentProcess.kill('SIGTERM');
    }
  } catch (_) {}
  currentProcess = null;
}

function resetRunState() {
  state.status = 'idle';
  state.startTime = null; state.endTime = null;
  state.total = 0; state.passed = 0; state.failed = 0; state.skipped = 0; state.running = 0;
  state.tests = {}; state.suites = {}; state.steps = {}; state.errors = [];
}

function saveHistory() {
  const entry = {
    id:          Date.now(),
    startTime:   state.startTime,
    endTime:     state.endTime,
    total:       state.total,
    passed:      state.passed,
    failed:      state.failed,
    skipped:     state.skipped,
    testResults: Object.fromEntries(Object.values(state.tests).map(t => [t.id, t.status])),
  };
  runHistory.unshift(entry);
  if (runHistory.length > 20) runHistory = runHistory.slice(0, 20);
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(runHistory)); } catch (_) {}
}

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

// ── server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  // ── POST /event (from realtime-reporter) ──────────────────────────────
  // Intentionally not behind checkToken. This IS reachable as a forged
  // cross-origin POST from any page open in the developer's browser (a plain
  // POST isn't CORS-preflighted, so the request itself isn't blocked — only
  // reading the response would be, and this route doesn't need that). It's
  // left ungated anyway because the worst a forged event can do is corrupt
  // the live dashboard's displayed state (fake test statuses) — there's no
  // code-execution or file-read path through this route, and every value it
  // feeds into the UI is HTML-escaped via the frontend's h() helper, so
  // there's no XSS either. Purely cosmetic blast radius.
  if (req.method === 'POST' && req.url === '/event') {
    const body = await readBody(req);
    try { applyEvent(JSON.parse(body)); broadcastState(); } catch (_) {}
    res.writeHead(204).end();
    return;
  }

  // ── GET /state ────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  // ── GET /files ────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files: scanTestFiles() }));
    return;
  }

  // ── GET /categories ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/categories') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ categories: activeCategories() }));
    return;
  }

  // ── GET /browsers ────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/browsers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ browsers: BROWSERS }));
    return;
  }

  // ── GET /filetests?file=tests/e2e/foo.spec.ts ─────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/filetests')) {
    if (!checkToken(req, res)) return;
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const fileParam = new URLSearchParams(qs).get('file') || '';
    if (!isKnownSpecFile(fileParam)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ titles: [] }));
      return;
    }
    const titles = [];
    try {
      const content = fs.readFileSync(path.join(ROOT, fileParam), 'utf8');
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const m of stripped.matchAll(/\btest(?:\.(?:skip|only|fixme))?\s*\(\s*(['"`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g)) {
        const title = m[2].replace(/\\(['"`\\])/g, '$1').trim();
        if (title) titles.push(title);
      }
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ titles }));
    return;
  }

  // ── GET /source?file=tests/e2e/foo.spec.ts ─────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/source')) {
    if (!checkToken(req, res)) return;
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const fileParam = new URLSearchParams(qs).get('file') || '';
    if (!isKnownSpecFile(fileParam)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown or unsafe file' }));
      return;
    }
    try {
      const content = fs.readFileSync(path.join(ROOT, fileParam), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  // ── POST /save-spec ───────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/save-spec') {
    if (!checkToken(req, res)) return;
    const body = await readBody(req);
    let params = {};
    try { params = JSON.parse(body); } catch {}
    const { file, content } = params;
    if (typeof file !== 'string' || !isKnownSpecFile(file) || typeof content !== 'string') {
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

  // ── GET /events (SSE) ────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ── GET /history ──────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ history: runHistory }));
    return;
  }

  // ── GET /report?file=<path within test-results/> (static CI report mode) ─
  if (req.method === 'GET' && req.url.startsWith('/report')) {
    if (!checkToken(req, res)) return;
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

  // ── GET /serve?p=<path> (serve artifact files within test-results/) ───
  if (req.method === 'GET' && req.url.startsWith('/serve')) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const rawPath = decodeURIComponent(new URLSearchParams(qs).get('p') || '');
    const safe = safeArtifactPath(rawPath);
    if (!safe) { res.writeHead(403).end('Forbidden'); return; }
    try {
      const data = fs.readFileSync(safe);
      const ext = path.extname(safe).toLowerCase();
      const ct = ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : ext === '.zip' ? 'application/zip' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    } catch (_) { res.writeHead(404).end('Not found'); }
    return;
  }

  // ── POST /open-trace?p=<trace-zip-path> ──────────────────────────────
  if (req.method === 'POST' && req.url.startsWith('/open-trace')) {
    if (!checkToken(req, res)) return;
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const rawPath = decodeURIComponent(new URLSearchParams(qs).get('p') || '');
    const safe = safeArtifactPath(rawPath);
    if (!safe) { res.writeHead(403).end('Forbidden'); return; }
    try {
      spawn('npx', ['playwright', 'show-trace', safe], {
        cwd: ROOT, shell: true, stdio: 'ignore', detached: true,
      }).unref();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { res.writeHead(500).end(String(e.message)); }
    return;
  }

  // ── POST /run ─────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/run') {
    if (!checkToken(req, res)) return;
    const body = await readBody(req);
    let params = {};
    try { params = JSON.parse(body); } catch {}

    const { file, grep, mode = 'background', slowMo = 0, skipSeed = false, browsers } = params;

    const allBrowserKeys = BROWSERS.map(b => b.key);
    let selectedBrowsers = Array.isArray(browsers) && browsers.length > 0 ? browsers : allBrowserKeys;
    if (!selectedBrowsers.every(b => typeof b === 'string' && allBrowserKeys.includes(b))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown browser in selection' }));
      return;
    }

    if (file != null && typeof file !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsafe file' }));
      return;
    }
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

    const targeted = !!(file || grep);
    const runId = String(++runCounter);
    pendingRuns.set(runId, { isTargeted: targeted });
    if (pendingRuns.size > 50) pendingRuns.delete(pendingRuns.keys().next().value); // bound memory

    killCurrent();

    if (targeted) {
      // Preserve test/suite data so other rows stay on screen
      state.status = 'idle';
      state.startTime = null; state.endTime = null;
      state.running = 0; state.errors = [];
    } else {
      resetRunState();
    }
    broadcastState();

    state.runMode = mode;
    state.currentFile = file || null;
    state.currentGrep = grep || null;

    const args = ['playwright', 'test'];
    if (file) args.push(file);
    if (grep) args.push('--grep', grep);
    for (const b of selectedBrowsers) args.push('--project', b);
    if (mode === 'interactive') args.push('--headed');

    const env = { ...process.env, E2E_RUN_ID: runId };
    // Tell the reporter which port we actually bound to (may have fallen back
    // past BASE_PORT if it was taken) — see realtime-reporter.js's post().
    env.E2E_PROGRESS_PORT = String(ACTIVE_PORT || BASE_PORT);
    if (skipSeed) env.SKIP_GLOBAL_SETUP = 'true'; // Remove if no globalSetup
    if (mode === 'interactive' && slowMo > 0) env.PLAYWRIGHT_SLOW_MO = String(slowMo);
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

    console.log(`[progress-server] Spawning: npx ${args.join(' ')}`);
    currentProcess = spawn('npx', args, { cwd: ROOT, shell: true, env, stdio: 'ignore' });
    currentProcess.on('exit', code => {
      console.log(`[progress-server] Playwright exited (${code})`);
      currentProcess = null;
      if (state.status === 'running') {
        state.status = 'done'; state.endTime = Date.now(); state.running = 0;
        broadcastState();
      }
    });
    if (mode === 'interactive') focusInteractiveBrowser(currentProcess.pid);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── POST /stop ────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/stop') {
    if (!checkToken(req, res)) return;
    killCurrent();
    if (state.status === 'running') {
      state.status = 'done'; state.endTime = Date.now(); state.running = 0;
      broadcastState();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── GET / or /dashboard ───────────────────────────────────────────────
  if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8').replace('%%RUNTIME_TOKEN%%', TOKEN);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (_) { res.writeHead(404).end('Dashboard HTML not found'); }
    return;
  }

  res.writeHead(404).end();
});

// ── event application ─────────────────────────────────────────────────────────

// Reshape a Playwright --reporter=json output file into this server's `state` shape,
// so a finished CI run can be viewed in the same UI with no live server loop.
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

function applyEvent(event) {
  switch (event.type) {
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
    case 'end': {
      state.status  = 'done';
      state.endTime = event.endTime;
      state.running = 0;
      if (!currentRunIsTargeted) saveHistory();
      break;
    }
  }
}

let currentPort = BASE_PORT;
let portAttemptsLeft = PORT_ATTEMPTS;

server.on('listening', () => {
  const addr = server.address();
  ACTIVE_PORT = addr.port;
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
  TOKEN, HOST, scanTestFiles, checkToken,
  isKnownSpecFile, isKnownSpecFileArg, hasShellMetachars,
  pendingRuns, activeCategories, CATEGORIES, BROWSERS,
  computeTileLayout,
};
