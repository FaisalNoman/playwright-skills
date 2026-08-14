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

  // Simulate two /run requests that both fired (and registered their
  // pendingRuns entry) before either reporter connected back with a 'begin'
  // event. 'A' is created FIRST but is the TARGETED run; 'B' is created
  // SECOND but is the FULL (untargeted) run. A keyed-Map lookup must resolve
  // each runId to its own isTargeted value regardless of creation order —
  // a shared-boolean implementation (the pre-Task-5 bug) could not do this
  // correctly once a second /run overwrote the shared flag.
  mod.pendingRuns.set('A', { isTargeted: true });
  mod.pendingRuns.set('B', { isTargeted: false });

  // Seed some prior-run results so there's something for a "targeted" begin
  // to recompute counters from.
  mod.state.tests['old1'] = { id: 'old1', status: 'passed' };
  mod.state.tests['old2'] = { id: 'old2', status: 'failed' };

  // B's 'begin' (the full/untargeted run) arrives FIRST, even though its
  // pendingRuns entry was created SECOND — order of arrival, not order of
  // creation, must determine behavior.
  mod.applyEvent({ type: 'begin', startTime: Date.now(), total: 5, runId: 'B' });
  assert.equal(mod.state.total, 5);
  assert.equal(Object.keys(mod.state.tests).length, 0); // full run clears everything
  assert.equal(mod.pendingRuns.has('B'), false); // consumed

  // Re-seed state.tests to simulate B's run having produced some results
  // before the next request (A's 'begin') arrives.
  mod.state.tests['new1'] = { id: 'new1', status: 'passed' };
  mod.state.tests['new2'] = { id: 'new2', status: 'passed' };

  // A's 'begin' (the targeted run) arrives SECOND, even though its
  // pendingRuns entry was created FIRST.
  mod.applyEvent({ type: 'begin', startTime: Date.now(), total: 99, runId: 'A' });
  const testCount = Object.keys(mod.state.tests).length;
  assert.ok(testCount > 0); // targeted branch does NOT clear state.tests
  assert.equal(mod.state.total, testCount); // targeted branch recomputes total from state.tests, ignoring event.total
  assert.equal(mod.pendingRuns.has('A'), false); // consumed

  // This proves runId 'A' independently resolved to isTargeted:true and
  // runId 'B' independently resolved to isTargeted:false, with no
  // cross-contamination between the two overlapping runs.
});
