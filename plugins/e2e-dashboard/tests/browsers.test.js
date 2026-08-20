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
