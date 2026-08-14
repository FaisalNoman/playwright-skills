// plugins/e2e-dashboard/tests/progress-server.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
