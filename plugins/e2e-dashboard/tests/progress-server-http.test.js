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

  // A real spec file that exists on disk but lives OUTSIDE E2E_DIR
  // (tmpRoot/tests/e2e) — mirrors the sibling-directory trick used by the
  // safeArtifactPath traversal test. It must be reachable via path.join(ROOT, fileParam)
  // (ROOT === tmpRoot here) so a bypassed isKnownSpecFile guard would actually leak it.
  fs.mkdirSync(path.join(tmpRoot, 'secret'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'secret', 'leaked.spec.ts'), [
    "import { test } from '@playwright/test';",
    "test('LEAKED_TITLE_SHOULD_NEVER_APPEAR', () => {});",
    '',
  ].join('\n'));

  child = spawn(process.execPath, [path.join(tmpRoot, 'tests', 'reporters', 'progress-server.js')], {
    cwd: tmpRoot,
    env: { ...process.env, E2E_DASHBOARD_PORT: '0' }, // OS picks an ephemeral port
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
  // 'secret/leaked.spec.ts' resolves (via path.join(ROOT, fileParam)) to a REAL
  // file on disk that DOES contain a distinctive test title — but it lives
  // outside E2E_DIR, so isKnownSpecFile's containment check must reject it.
  // Unlike a nonexistent traversal path (which would return [] regardless of
  // whether the guard exists, because fs.readFileSync would throw either way),
  // this proves the guard itself — not a missing file — is what prevents the leak.
  const res = await fetch(origin + '/filetests?file=' + encodeURIComponent('secret/leaked.spec.ts'), {
    headers: { 'X-Dashboard-Token': token },
  });
  const json = await res.json();
  assert.ok(!json.titles.includes('LEAKED_TITLE_SHOULD_NEVER_APPEAR'));
  assert.deepEqual(json.titles, []);
});
