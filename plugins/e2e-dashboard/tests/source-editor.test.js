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
