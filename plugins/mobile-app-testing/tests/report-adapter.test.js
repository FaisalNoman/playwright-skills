// plugins/mobile-app-testing/tests/report-adapter.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ADAPTER = path.join(__dirname, '..', 'skills', 'mobile-app-testing', 'templates', 'tapflow-report-adapter.js');

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
