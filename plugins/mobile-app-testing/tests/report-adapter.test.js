// plugins/mobile-app-testing/tests/report-adapter.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const http = require('http');

const ADAPTER = path.join(__dirname, '..', 'skills', 'mobile-app-testing', 'templates', 'tapflow-report-adapter.js');
const PASSING_FIXTURE = path.join(__dirname, 'fixtures', 'passing-report.xml');
const FAILING_FIXTURE = path.join(__dirname, 'fixtures', 'failing-report.xml');

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tapflow" tests="2" failures="1" time="12.5">
    <testcase name="checkout-happy-path" classname="tapflow" time="6.2"/>
    <testcase name="login-smoke" classname="tapflow" time="6.3">
      <failure message="assertVisible: &quot;Orders&quot; not found within 15s">Timed out waiting for selector</failure>
    </testcase>
  </testsuite>
</testsuites>`;

test('parses passing and failing testcases from JUnit XML', () => {
  const { parseJUnitXml } = require(ADAPTER);
  const cases = parseJUnitXml(FIXTURE_XML);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].name, 'checkout-happy-path');
  assert.equal(cases[0].failure, null);
  assert.equal(cases[0].time, 6.2);
  assert.equal(cases[1].name, 'login-smoke');
  assert.ok(cases[1].failure.message.includes('not found within 15s'));
});

test('decodes XML entities in failure messages', () => {
  const { parseJUnitXml } = require(ADAPTER);
  const cases = parseJUnitXml(FIXTURE_XML);
  assert.ok(cases[1].failure.message.includes('"Orders"'));
});

test('returns an empty array for a report with zero testcases', () => {
  const { parseJUnitXml } = require(ADAPTER);
  const cases = parseJUnitXml('<testsuites><testsuite name="tapflow" tests="0"></testsuite></testsuites>');
  assert.deepEqual(cases, []);
});

test('falls back to the failure element\'s text when no message attribute is present', () => {
  const { parseJUnitXml } = require(ADAPTER);
  const xml = `<testsuites><testsuite name="tapflow"><testcase name="x" time="1.0"><failure>plain text failure</failure></testcase></testsuite></testsuites>`;
  const cases = parseJUnitXml(xml);
  assert.equal(cases[0].failure.message, 'plain text failure');
});

test('decodes XML entities in the failure element\'s text content, not just the message attribute', () => {
  const { parseJUnitXml } = require(ADAPTER);
  const xml = `<testsuites><testsuite name="tapflow"><testcase name="x" time="1.0"><failure>at Foo.&lt;init&gt;(Foo.java:10)</failure></testcase></testsuite></testsuites>`;
  const cases = parseJUnitXml(xml);
  assert.equal(cases[0].failure.message, 'at Foo.<init>(Foo.java:10)');
});

test('buildTestBeginEvent and buildTestEndEvent tag events with mobile:<platform> and the flow file path', () => {
  const { buildTestBeginEvent, buildTestEndEvent } = require(ADAPTER);
  const testCase = { name: 'checkout-happy-path', classname: 'tapflow', time: 6.2, failure: null };
  const begin = buildTestBeginEvent(testCase, '.tapflow/flows/checkout-happy-path.yaml', 'ios');
  assert.equal(begin.type, 'testBegin');
  assert.equal(begin.id, 'checkout-happy-path');
  assert.equal(begin.file, '.tapflow/flows/checkout-happy-path.yaml');
  assert.equal(begin.browser, 'mobile:ios');

  const end = buildTestEndEvent(testCase, '.tapflow/flows/checkout-happy-path.yaml', 'ios');
  assert.equal(end.type, 'testEnd');
  assert.equal(end.status, 'passed');
  assert.equal(end.duration, 6200);
  assert.equal(end.error, null);
});

test('buildTestEndEvent reports a failed testcase with its failure message', () => {
  const { buildTestEndEvent } = require(ADAPTER);
  const testCase = { name: 'login-smoke', classname: 'tapflow', time: 4.1, failure: { message: 'not found' } };
  const end = buildTestEndEvent(testCase, '.tapflow/flows/login-smoke.yaml', 'android');
  assert.equal(end.status, 'failed');
  assert.equal(end.browser, 'mobile:android');
  assert.equal(end.error.message, 'not found');
});

test('run() posts begin/testBegin/testEnd/end to the dashboard in order and returns pass/fail counts', async () => {
  const { run } = require(ADAPTER);
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const result = await run({
    reportPath: FAILING_FIXTURE,
    platform: 'ios',
    dashboardUrl: `http://127.0.0.1:${port}`,
  });

  await new Promise(resolve => setTimeout(resolve, 50)); // let the last POST's 'end' listener flush
  server.close();

  assert.deepEqual(result, { total: 1, failed: 1 });
  assert.deepEqual(received.map(e => e.type), ['begin', 'testBegin', 'testEnd', 'end']);
  assert.equal(received[1].browser, 'mobile:ios');
  assert.equal(received[2].status, 'failed');
  assert.equal(received[3].status, 'failed');
});

test('run() resolves without throwing when the dashboard is unreachable', async () => {
  const { run } = require(ADAPTER);
  const result = await run({
    reportPath: PASSING_FIXTURE,
    platform: 'ios',
    dashboardUrl: 'http://127.0.0.1:1', // nothing listens on port 1
  });
  assert.deepEqual(result, { total: 1, failed: 0 });
});

test('parseArgs requires --report and --platform', () => {
  const { parseArgs } = require(ADAPTER);
  assert.throws(() => parseArgs(['--platform', 'ios']), /--report/);
  assert.throws(() => parseArgs(['--report', 'x.xml']), /--platform/);
  const args = parseArgs(['--report', 'x.xml', '--platform', 'ios']);
  assert.equal(args.reportPath, 'x.xml');
  assert.equal(args.platform, 'ios');
  assert.equal(args.dashboardUrl, 'http://127.0.0.1:7373');
});

test('CLI exits 0 for a report with no failures', () => {
  const result = spawnSync(process.execPath, [ADAPTER, '--report', PASSING_FIXTURE, '--platform', 'ios', '--dashboard-url', 'http://127.0.0.1:1'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('CLI exits 1 for a report with a failure', () => {
  const result = spawnSync(process.execPath, [ADAPTER, '--report', FAILING_FIXTURE, '--platform', 'ios', '--dashboard-url', 'http://127.0.0.1:1'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
});
