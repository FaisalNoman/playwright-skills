# Mobile App Testing (tapflow integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third skill, `mobile-app-testing`, that records real-device (iOS Simulator / Android emulator) web app test flows via tapflow's MCP server, replays them with tapflow's own `tapflow flow run` CLI, and streams the results into the existing `e2e-dashboard` as a new category tab.

**Architecture:** tapflow owns device control and flow replay entirely (its MCP server for interactive recording, its `tapflow flow run` CLI + JUnit output for deterministic replay) — this repo adds no custom device-control or comparison code. A small, dependency-free `tapflow-report-adapter.js` parses tapflow's JUnit XML output and POSTs it to `e2e-dashboard`'s existing `progress-server.js` `/event` endpoint using the same event shape `realtime-reporter.js` already sends. `e2e-dashboard` gets one small, backward-compatible extension (per-category file extension) so its existing category/sidebar/SSE machinery can display `.tapflow/flows/*.yaml` results without modification.

**Tech Stack:** Node.js (built-ins only — `http`, `fs`, `path`, no npm dependencies, matching this repo's existing `progress-server.js` convention), `node:test` for unit tests, tapflow CLI + MCP server (external, user-provisioned).

## Global Constraints

- No new npm dependencies anywhere in this repo — pure Node built-ins only (matches `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`'s existing zero-dependency convention; this repo has no `package.json`).
- Tests run via `node --test <file>` directly, no test framework installed — match this exactly for all new test files.
- New skill lives at `plugins/mobile-app-testing/`, mirroring the exact directory layout of `plugins/e2e-dashboard/`: `.claude-plugin/plugin.json`, `skills/mobile-app-testing/SKILL.md`, `skills/mobile-app-testing/templates/`, `tests/`.
- Every change to `e2e-dashboard`'s shipped template must leave existing single- and multi-category Playwright-only projects behaving identically — verified by running the existing test suite unmodified after each change to that file.
- Flow files live at tapflow's own convention path, `.tapflow/flows/*.yaml` — never relocated under `tests/`.
- This round does not generate any CI workflow file or add a `--ci` flag/guard to anything — running in CI is left to the team, using the same `tapflow flow run` + adapter pair this plan builds.

---

### Task 1: `e2e-dashboard` — per-category file extension support

**Files:**
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js:78-88` (`scanTestFiles`)
- Modify: `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md` (CATEGORIES table/docs, around lines 86-113)
- Modify: `plugins/e2e-dashboard/tests/progress-server.test.js` (new test block)

**Interfaces:**
- Produces: `scanTestFiles()` (unchanged signature, `() => string[]`) now reads `cat.ext || SPEC_EXT` per category instead of the global `SPEC_EXT` for every category. Every `CATEGORIES` entry gains an optional `ext` field (string, e.g. `'.yaml'`); omitting it preserves today's behavior exactly.

- [ ] **Step 1: Write the failing test**

Open `plugins/e2e-dashboard/tests/progress-server.test.js` and add this new `describe` block after the existing `describe('multi-category CATEGORIES support', ...)` block (which ends around line 169):

```js
describe('per-category ext override', () => {
  let extRoot;

  before(() => {
    // A category that isn't Playwright specs at all (e.g. a non-.spec.ts
    // tool's output) must be discoverable via an explicit per-entry `ext`,
    // without changing the default `.spec.ts` behavior of sibling categories.
    extRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dash-ext-'));
    fs.mkdirSync(path.join(extRoot, 'tests', 'e2e'), { recursive: true });
    fs.mkdirSync(path.join(extRoot, 'mobile-flows'), { recursive: true });
    fs.mkdirSync(path.join(extRoot, 'tests', 'reporters'), { recursive: true });
    fs.copyFileSync(FIXTURE_SPEC, path.join(extRoot, 'tests', 'e2e', 'example.spec.ts'));
    fs.writeFileSync(path.join(extRoot, 'mobile-flows', 'checkout.yaml'), 'name: checkout\nsteps: []\n');

    const src = fs.readFileSync(TEMPLATE, 'utf8');
    const adapted = src.replace(
      /^const CATEGORIES.*%%ADAPT_CATEGORIES%%.*$/m,
      `const CATEGORIES = [
        { key: 'e2e',    label: 'E2E / Smoke', icon: '🧭', dir: path.join(ROOT, 'tests', 'e2e'),  prefix: 'tests/e2e' },
        { key: 'mobile', label: 'Mobile',      icon: '📱', dir: path.join(ROOT, 'mobile-flows'),   prefix: 'mobile-flows', ext: '.yaml' },
      ];`
    );
    assert.notEqual(adapted, src, 'the %%ADAPT_CATEGORIES%% marker line must exist for this substitution to work');
    fs.writeFileSync(path.join(extRoot, 'tests', 'reporters', 'progress-server.js'), adapted);
  });

  after(() => {
    fs.rmSync(extRoot, { recursive: true, force: true });
  });

  test('scanTestFiles uses the default SPEC_EXT for a category with no ext override', () => {
    const mod = require(path.join(extRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.ok(mod.scanTestFiles().includes('tests/e2e/example.spec.ts'));
  });

  test("scanTestFiles uses a category's own ext override instead of SPEC_EXT", () => {
    const mod = require(path.join(extRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.ok(mod.scanTestFiles().includes('mobile-flows/checkout.yaml'));
  });

  test('a category with an ext override never matches files with the default SPEC_EXT', () => {
    fs.writeFileSync(path.join(extRoot, 'mobile-flows', 'stray.spec.ts'), '// not a flow file');
    const mod = require(path.join(extRoot, 'tests', 'reporters', 'progress-server.js'));
    assert.ok(!mod.scanTestFiles().includes('mobile-flows/stray.spec.ts'));
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd plugins/e2e-dashboard && node --test tests/progress-server.test.js`
Expected: the two `ext`-related assertions FAIL (files with a non-default extension aren't found, since `scanTestFiles` still uses the global `SPEC_EXT` for every category).

- [ ] **Step 3: Implement `scanTestFiles`'s per-category ext**

In `plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js`, replace the existing `scanTestFiles` function (lines 78-88):

```js
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
```

with:

```js
function scanTestFiles() {
  const out = [];
  for (const cat of CATEGORIES) {
    let entries;
    try { entries = fs.readdirSync(cat.dir); } catch { continue; }
    const ext = cat.ext || SPEC_EXT;
    for (const f of entries.filter(x => x.endsWith(ext)).sort()) {
      out.push(`${cat.prefix}/${f}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `cd plugins/e2e-dashboard && node --test tests/progress-server.test.js`
Expected: PASS — all tests in the file, including the three new ones.

- [ ] **Step 5: Run the full existing e2e-dashboard suite to confirm no regression**

Run: `cd plugins/e2e-dashboard && node --test tests/`
Expected: PASS — every existing test file (`browsers.test.js`, `progress-server.test.js`, `progress-server-http.test.js`, `source-editor.test.js`) still passes unmodified. (If `progress-server-http.test.js`'s `EPERM` teardown flake from prior sessions reappears, that's a pre-existing Windows temp-dir issue unrelated to this change — confirm by checking the failure is the same `rmSync`/`EPERM` pattern noted in earlier work, not a new failure.)

- [ ] **Step 6: Document the `ext` field in SKILL.md**

In `plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md`, in the "### Building the `CATEGORIES` array" section, immediately after the sentence ending "...`prefix` is always `tests/<name>` (POSIX, no leading/trailing slash)." (around line 94), add:

```
Each entry also accepts an optional `ext` field (e.g. `ext: '.yaml'`) — omit it to use the project's `SPEC_EXT` (the normal case for Playwright spec categories). Set it explicitly only for a category populated by a non-Playwright tool (for example, the `mobile-app-testing` skill's tapflow flow files).
```

- [ ] **Step 7: Commit**

```bash
git add plugins/e2e-dashboard/skills/e2e-dashboard/templates/progress-server.js \
        plugins/e2e-dashboard/skills/e2e-dashboard/SKILL.md \
        plugins/e2e-dashboard/tests/progress-server.test.js
git commit -m "feat(e2e-dashboard): support per-category file extension in CATEGORIES

Additive, backward-compatible: entries without an explicit ext keep
using the project's SPEC_EXT exactly as before. Enables non-Playwright
categories (e.g. mobile-app-testing's .tapflow/flows/*.yaml) to be
discovered by scanTestFiles without a global extension change."
```

---

### Task 2: Scaffold the `mobile-app-testing` plugin

**Files:**
- Create: `plugins/mobile-app-testing/.claude-plugin/plugin.json`
- Create: `plugins/mobile-app-testing/skills/mobile-app-testing/templates/` (empty dir, populated by Tasks 3-4)
- Modify: `.claude-plugin/marketplace.json`
- Modify: `install.sh`
- Modify: `install.ps1`
- Create: `codex/prompts/mobile-app-testing.md`
- Create: `cursor/commands/mobile-app-testing.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the plugin skeleton every later task writes into (`plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md` from Task 5, `.../templates/tapflow-report-adapter.js` from Tasks 3-4).

- [ ] **Step 1: Create the plugin manifest**

Create `plugins/mobile-app-testing/.claude-plugin/plugin.json`:

```json
{
  "name": "mobile-app-testing",
  "version": "1.0.0",
  "description": "Test your web app on real iOS Simulator / Android emulator sessions via tapflow, alongside your existing Playwright suite.",
  "author": { "name": "FaisalNoman", "url": "https://github.com/FaisalNoman" },
  "homepage": "https://github.com/FaisalNoman/playwright-skills",
  "license": "MIT",
  "keywords": ["playwright", "mobile", "tapflow", "testing", "ios", "android", "skill"]
}
```

- [ ] **Step 2: Create the templates directory placeholder**

Create `plugins/mobile-app-testing/skills/mobile-app-testing/templates/.gitkeep` (empty file) so the directory exists in git before Tasks 3-4 populate it.

- [ ] **Step 3: Register the plugin in the marketplace manifest**

In `.claude-plugin/marketplace.json`, add a third entry to the `plugins` array (after the `e2e-dashboard` entry):

```json
    {
      "name": "mobile-app-testing",
      "source": "./plugins/mobile-app-testing",
      "description": "Record and run real-device (iOS/Android) mobile test flows via tapflow, reported into e2e-dashboard.",
      "version": "1.0.0",
      "author": { "name": "FaisalNoman" }
    }
```

(Insert immediately before the closing `]` of the `plugins` array, with a comma added after the `e2e-dashboard` entry's closing `}`.)

- [ ] **Step 4: Update `install.sh`**

In `install.sh`, change:

```bash
SKILLS=(playwright-setup e2e-dashboard)
```

to:

```bash
SKILLS=(playwright-setup e2e-dashboard mobile-app-testing)
```

Then update every echoed command list to include the third skill — in the `claude)` case:

```bash
    echo "  /plugin install e2e-dashboard@playwright-skills"
```

becomes:

```bash
    echo "  /plugin install e2e-dashboard@playwright-skills"
    echo "  /plugin install mobile-app-testing@playwright-skills"
```

and in both the `codex)` and `cursor)` cases, change:

```bash
    echo "Installed to $CODEX_HOME. Use slash commands: /playwright-setup  /e2e-dashboard"
```

and

```bash
    echo "Installed to $PWD/.cursor. Use: /playwright-setup  /e2e-dashboard in Cursor."
```

to also list `/mobile-app-testing`:

```bash
    echo "Installed to $CODEX_HOME. Use slash commands: /playwright-setup  /e2e-dashboard  /mobile-app-testing"
```

```bash
    echo "Installed to $PWD/.cursor. Use: /playwright-setup  /e2e-dashboard  /mobile-app-testing in Cursor."
```

- [ ] **Step 5: Update `install.ps1`**

Mirror Step 4 in `install.ps1`: change `$Skills  = @('playwright-setup','e2e-dashboard')` to `$Skills  = @('playwright-setup','e2e-dashboard','mobile-app-testing')`, add a `Write-Host "  /plugin install mobile-app-testing@playwright-skills"` line in the `'claude'` case, and append `  /mobile-app-testing` to both `Write-Host "Installed to ..."` lines in the `'codex'` and `'cursor'` cases.

- [ ] **Step 6: Create the Codex prompt pointer**

Create `codex/prompts/mobile-app-testing.md`:

```
Read the file `~/.codex/playwright-skills/mobile-app-testing/SKILL.md` and follow its instructions exactly. Treat that file's body as your operating instructions for this task. Template files to install live in `~/.codex/playwright-skills/mobile-app-testing/templates/`.

User request follows:

$ARGUMENTS
```

- [ ] **Step 7: Create the Cursor command pointer**

Create `cursor/commands/mobile-app-testing.md`:

```
Read `.cursor/playwright-skills/mobile-app-testing/SKILL.md` and follow its instructions exactly. Treat that file's body as your operating instructions for this task. Template files to install live in `.cursor/playwright-skills/mobile-app-testing/templates/`.
```

- [ ] **Step 8: Update the root README**

In `README.md`, add a third row to the skills table (after the `e2e-dashboard` row):

```
| **mobile-app-testing** | Records real-device (iOS Simulator / Android emulator) test flows for your web app via [tapflow](https://www.tapflow.dev), and streams results into the e2e-dashboard. |
```

And in the "Claude Code (native plugin)" code block, add a third install line:

```
/plugin install mobile-app-testing@playwright-skills
```

And update the "Then trigger with..." sentence to mention `/mobile-app-testing`.

- [ ] **Step 9: Verify the JSON manifests are valid and the scaffolding is wired correctly**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('plugins/mobile-app-testing/.claude-plugin/plugin.json','utf8')); console.log('plugin.json OK')"
node -e "const m = JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); if (!m.plugins.some(p => p.name === 'mobile-app-testing')) throw new Error('missing entry'); console.log('marketplace.json OK')"
bash install.sh claude
```
Expected: both `OK` lines print, and `install.sh claude`'s output includes `/plugin install mobile-app-testing@playwright-skills`.

- [ ] **Step 10: Commit**

```bash
git add plugins/mobile-app-testing/.claude-plugin/plugin.json \
        plugins/mobile-app-testing/skills/mobile-app-testing/templates/.gitkeep \
        .claude-plugin/marketplace.json install.sh install.ps1 \
        codex/prompts/mobile-app-testing.md cursor/commands/mobile-app-testing.md \
        README.md
git commit -m "feat(mobile-app-testing): scaffold new plugin

Manifest, marketplace entry, install script wiring, and Codex/Cursor
pointer files for the third skill. SKILL.md and templates land in
later tasks."
```

---

### Task 3: `tapflow-report-adapter.js` — JUnit XML parsing

**Files:**
- Create: `plugins/mobile-app-testing/skills/mobile-app-testing/templates/tapflow-report-adapter.js`
- Create: `plugins/mobile-app-testing/tests/report-adapter.test.js`

**Interfaces:**
- Produces: `parseJUnitXml(xml: string) -> Array<{name: string, classname: string, time: number, failure: {message: string} | null}>`, `parseAttrs(attrString: string) -> Record<string,string>`, `decodeXmlEntities(s: string) -> string`. Consumed by Task 4's `run()`.

- [ ] **Step 1: Write the failing tests**

Create `plugins/mobile-app-testing/tests/report-adapter.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/mobile-app-testing && node --test tests/report-adapter.test.js`
Expected: FAIL — `tapflow-report-adapter.js` doesn't exist yet (`Cannot find module`).

- [ ] **Step 3: Implement the JUnit parser**

Create `plugins/mobile-app-testing/skills/mobile-app-testing/templates/tapflow-report-adapter.js`:

```js
// Parses tapflow's `tapflow flow run --junit report.xml` output and streams
// it into e2e-dashboard's progress-server.js as begin/testBegin/testEnd/end
// events. No npm dependencies — matches progress-server.js's convention.
const fs = require('fs');
const http = require('http');
const { URL } = require('url');

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttrs(attrString) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrString))) attrs[m[1]] = decodeXmlEntities(m[2]);
  return attrs;
}

function parseJUnitXml(xml) {
  const cases = [];
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    const body = m[2] || '';
    const failureMatch = body.match(/<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/);
    let failure = null;
    if (failureMatch) {
      const fAttrs = parseAttrs(failureMatch[1]);
      const text = (failureMatch[2] || '').trim();
      failure = { message: (fAttrs.message || text || 'assertion failed').slice(0, 600) };
    }
    cases.push({
      name: attrs.name || 'unnamed',
      classname: attrs.classname || '',
      time: parseFloat(attrs.time || '0'),
      failure,
    });
  }
  return cases;
}

module.exports = { parseJUnitXml, parseAttrs, decodeXmlEntities };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/mobile-app-testing && node --test tests/report-adapter.test.js`
Expected: PASS — all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/mobile-app-testing/skills/mobile-app-testing/templates/tapflow-report-adapter.js \
        plugins/mobile-app-testing/tests/report-adapter.test.js
git commit -m "feat(mobile-app-testing): add JUnit XML parser for tapflow reports

Dependency-free regex-based parser for tapflow flow run --junit
output. Foundation for the dashboard-event adapter in the next task."
```

---

### Task 4: `tapflow-report-adapter.js` — event building, dashboard POST, orchestration, CLI

**Files:**
- Modify: `plugins/mobile-app-testing/skills/mobile-app-testing/templates/tapflow-report-adapter.js`
- Modify: `plugins/mobile-app-testing/tests/report-adapter.test.js`
- Create: `plugins/mobile-app-testing/tests/fixtures/passing-report.xml`
- Create: `plugins/mobile-app-testing/tests/fixtures/failing-report.xml`

**Interfaces:**
- Consumes: `parseJUnitXml` from Task 3 (same file).
- Produces: `buildBeginEvent(total)`, `buildTestBeginEvent(testCase, flowFile, platform)`, `buildTestEndEvent(testCase, flowFile, platform)`, `buildEndEvent(status)`, `postEvent(dashboardUrl, event) -> Promise<void>`, `run({reportPath, platform, dashboardUrl, flowFilePrefix}) -> Promise<{total: number, failed: number}>`, `parseArgs(argv) -> {reportPath, platform, dashboardUrl}`, `main()`. CLI entry point: `node tapflow-report-adapter.js --report <path> --platform <ios|android> [--dashboard-url <url>]`, exit code 0 if no `<failure>` elements, 1 otherwise.

- [ ] **Step 1: Create fixture report files**

Create `plugins/mobile-app-testing/tests/fixtures/passing-report.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tapflow" tests="1" failures="0" time="6.2">
    <testcase name="checkout-happy-path" classname="tapflow" time="6.2"/>
  </testsuite>
</testsuites>
```

Create `plugins/mobile-app-testing/tests/fixtures/failing-report.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="tapflow" tests="1" failures="1" time="4.1">
    <testcase name="login-smoke" classname="tapflow" time="4.1">
      <failure message="assertVisible: &quot;Orders&quot; not found within 15s">Timed out waiting for selector</failure>
    </testcase>
  </testsuite>
</testsuites>
```

- [ ] **Step 2: Write the failing tests**

Append to `plugins/mobile-app-testing/tests/report-adapter.test.js` (add these requires near the top, alongside the existing ones):

```js
const { spawnSync } = require('child_process');
const http = require('http');
const PASSING_FIXTURE = path.join(__dirname, 'fixtures', 'passing-report.xml');
const FAILING_FIXTURE = path.join(__dirname, 'fixtures', 'failing-report.xml');
```

Then add:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd plugins/mobile-app-testing && node --test tests/report-adapter.test.js`
Expected: FAIL — `buildTestBeginEvent`, `buildTestEndEvent`, `run`, `parseArgs` are `undefined` (not yet exported).

- [ ] **Step 4: Implement event building, POST, orchestration, and CLI**

In `plugins/mobile-app-testing/skills/mobile-app-testing/templates/tapflow-report-adapter.js`, add below the existing `parseJUnitXml`/`parseAttrs`/`decodeXmlEntities` (keep those unchanged) and replace the final `module.exports` line:

```js
function buildBeginEvent(total) {
  return { type: 'begin', startTime: Date.now(), total, runId: null };
}

function buildTestBeginEvent(testCase, flowFile, platform) {
  return {
    type: 'testBegin',
    id: testCase.name,
    title: testCase.name,
    file: flowFile,
    line: null,
    describes: [],
    browser: `mobile:${platform}`,
  };
}

function buildTestEndEvent(testCase, flowFile, platform) {
  const status = testCase.failure ? 'failed' : 'passed';
  return {
    type: 'testEnd',
    id: testCase.name,
    file: flowFile,
    status,
    duration: Math.round(testCase.time * 1000),
    retry: 0,
    attachments: [],
    browser: `mobile:${platform}`,
    error: testCase.failure ? { message: testCase.failure.message, location: null } : null,
  };
}

function buildEndEvent(status) {
  return { type: 'end', endTime: Date.now(), status };
}

function postEvent(dashboardUrl, event) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL('/event', dashboardUrl); } catch { resolve(); return; }
    const body = JSON.stringify(event);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); resolve(); });
    req.on('error', () => resolve()); // dashboard is optional — never fail the run over this
    req.write(body);
    req.end();
  });
}

async function run({ reportPath, platform, dashboardUrl, flowFilePrefix = '.tapflow/flows' }) {
  const xml = fs.readFileSync(reportPath, 'utf8');
  const cases = parseJUnitXml(xml);
  await postEvent(dashboardUrl, buildBeginEvent(cases.length));
  for (const testCase of cases) {
    const flowFile = `${flowFilePrefix}/${testCase.name}.yaml`;
    await postEvent(dashboardUrl, buildTestBeginEvent(testCase, flowFile, platform));
    await postEvent(dashboardUrl, buildTestEndEvent(testCase, flowFile, platform));
  }
  const failed = cases.filter(c => c.failure).length;
  await postEvent(dashboardUrl, buildEndEvent(failed > 0 ? 'failed' : 'passed'));
  return { total: cases.length, failed };
}

function parseArgs(argv) {
  const args = { reportPath: null, platform: null, dashboardUrl: 'http://127.0.0.1:7373' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') args.reportPath = argv[++i];
    else if (argv[i] === '--platform') args.platform = argv[++i];
    else if (argv[i] === '--dashboard-url') args.dashboardUrl = argv[++i];
  }
  if (!args.reportPath) throw new Error('--report <path/to/report.xml> is required');
  if (!args.platform) throw new Error('--platform <ios|android> is required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await run(args);
  console.log(`[tapflow-report-adapter] ${result.total - result.failed}/${result.total} passed`);
  process.exit(result.failed > 0 ? 1 : 0);
}

module.exports = {
  parseJUnitXml, parseAttrs, decodeXmlEntities,
  buildBeginEvent, buildTestBeginEvent, buildTestEndEvent, buildEndEvent,
  postEvent, run, parseArgs,
};

if (require.main === module) {
  main().catch(e => { console.error('[tapflow-report-adapter]', e.message); process.exit(1); });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd plugins/mobile-app-testing && node --test tests/report-adapter.test.js`
Expected: PASS — all tests (the 4 from Task 3 plus the 8 added here).

- [ ] **Step 6: Commit**

```bash
git add plugins/mobile-app-testing/skills/mobile-app-testing/templates/tapflow-report-adapter.js \
        plugins/mobile-app-testing/tests/report-adapter.test.js \
        plugins/mobile-app-testing/tests/fixtures/passing-report.xml \
        plugins/mobile-app-testing/tests/fixtures/failing-report.xml
git commit -m "feat(mobile-app-testing): stream tapflow JUnit results into e2e-dashboard

run() reads a tapflow flow run --junit report, posts begin/testBegin/
testEnd/end events to progress-server.js's existing /event endpoint,
and returns pass/fail counts. CLI wraps it with the correct exit code;
dashboard connectivity is optional and never fails the run."
```

---

### Task 5: `mobile-app-testing` SKILL.md

**Files:**
- Create: `plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md`
- Modify: `plugins/mobile-app-testing/skills/mobile-app-testing/templates/.gitkeep` → delete it (no longer needed once `tapflow-report-adapter.js` exists in that directory)

**Interfaces:**
- Consumes: exact function/CLI names from Tasks 3-4 (`tapflow-report-adapter.js`'s `--report`/`--platform`/`--dashboard-url` flags) and Task 1's `ext` field on `CATEGORIES` entries.
- Produces: the installable skill definition — no code interface, this is the agent-facing instruction file read by Claude Code / Codex / Cursor at skill-invocation time.

- [ ] **Step 1: Remove the templates placeholder**

```bash
git rm plugins/mobile-app-testing/skills/mobile-app-testing/templates/.gitkeep
```

- [ ] **Step 2: Write the SKILL.md**

Create `plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md`:

```markdown
---
name: mobile-app-testing
description: Record real-device (iOS Simulator / Android emulator) test flows for your web app via tapflow's MCP server, replay them with tapflow's own CLI, and stream results into an installed e2e-dashboard.
---

# Mobile App Testing (tapflow) Installer

## What This Skill Does

Records real-device test flows for your web app against a self-hosted [tapflow](https://www.tapflow.dev) relay, using tapflow's own YAML flow format and `tapflow flow run` CLI — not a custom automation engine. Copies a small report adapter that streams results into an already-installed `e2e-dashboard` as a new category tab.

**Prerequisites (not installed or provisioned by this skill):**
- A running tapflow relay + macOS agent (`tapflow start`, or a team-operated relay) — see https://www.tapflow.dev/guide/getting-started
- The `tapflow` CLI available on PATH wherever flows will be run (`npm install -g tapflow`)
- tapflow's MCP server connected to this session (`@tapflowio/mcp-server`, see https://www.tapflow.dev/guide/mcp-server) — required only for the recording phase, not for running already-recorded flows
- Node.js ≥ 18, for the report adapter script only

---

## Phase 1 — Discovery & Connectivity

Ask the user in one message:

| Value | How to find | Default |
|-------|-------------|---------|
| `relay_url` | Ask directly | none — required |
| `relay_token` | Ask directly (a Personal Access Token from tapflow's Settings → Tokens) | none — required |
| `app_id` | App identifier used in tapflow flow YAML (`appId`) — check the project's build config (iOS bundle ID / Android `applicationId`) or ask | ask if not found |
| `flows_dir` | Where flow YAML files live | `.tapflow/flows` (tapflow's own convention — never relocate under `tests/`) |
| `dashboard_installed` | Does a `progress-server.js` from `e2e-dashboard` already exist in this project? Glob for `**/progress-server.js` containing the string `E2E Dashboard`. | if absent, skip Phase 4 |

Verify connectivity before continuing: `GET {relay_url}/api/v1/auth/me` with header `Authorization: Bearer {relay_token}`. A non-2xx response means stop and report the failure clearly — do not proceed to recording against an unreachable relay. Point the user at `tapflow doctor` / `tapflow status` for diagnosis; this skill does not diagnose tapflow's own health.

---

## Phase 2 — Choose Journeys

Scan the project the same way `playwright-setup` does (routes, page components, existing specs in `tests/e2e/`) to propose a short list of candidate mobile journeys (e.g. "Login", "Checkout", "Search"). Present as a multi-select. Recording is one journey at a time — there is no batch or headless recording mode.

---

## Phase 3 — Record Each Journey (interactive, via MCP)

For each selected journey:

1. Call the MCP tools `list_devices`, then `boot_device` (or `connect_device` if already booted) for the platform/device the user wants — ask once per journey, or reuse the prior answer if unchanged.
2. Call `launch_app` (or `install_app` first, if the build isn't on this device yet — ask the user for the build path/URL).
3. Loop: call `screenshot` and `query_ui_tree` to see the current state, decide the next action, call the matching MCP tool (`tap`, `swipe`, `type_text`, `press_key`), then describe what happened in one line and ask the user to confirm it matches intent before recording the step. If they say it's wrong, re-navigate or ask what should have happened instead of recording a bad step.
4. When the user confirms a screen state the flow should assert on going forward (e.g. "yes, that's the confirmation we want to check for"), record an `assertVisible` step targeting that element's resolved selector — prefer `id` when `query_ui_tree` exposes a stable identifier, fall back to `label` otherwise.
5. When the journey is complete, write the accumulated steps as `{flows_dir}/{journey-name}.yaml`, in tapflow's own format:

   ```yaml
   name: {journey-name}
   appId: {app_id}
   steps:
     - launchApp
     - tapOn: "Add to Cart"
     - tapOn: { id: "com.example.app:id/cart-icon" }
     - assertVisible: { label: "Checkout total", timeout: 15 }
   ```

   Use the bare-string selector form (`tapOn: "Sign in"`) when the element's visible label is what was tapped; use `{ id: ... }` when `query_ui_tree` returned a stable identifier; add `timeout` on `assertVisible`/`assertNotVisible` only when the default felt too short during recording. Never write raw tap coordinates — always a resolved selector.
6. Call `disconnect_device` (and `shutdown_device`, if the user doesn't want the simulator left running) once all journeys for this session are recorded.

---

## Phase 4 — Wire Into e2e-dashboard (only if `dashboard_installed`)

1. Read the project's installed `progress-server.js` (path found in Phase 1).
2. Confirm it supports per-category `ext` — check that `scanTestFiles` references `cat.ext`. If it doesn't (an older install), tell the user to update/reinstall `e2e-dashboard` first (an additive, backward-compatible change) rather than patching that logic in here.
3. Find the `const CATEGORIES = [ ... ];` block (may be single- or multi-line). If a `key: 'mobile'` entry already exists, leave it as-is — this step is idempotent. Otherwise insert, immediately before the array's closing `];`:
   ```js
   { key: 'mobile', label: 'Mobile (tapflow)', icon: '📱', dir: path.join(ROOT, '.tapflow', 'flows'), prefix: '.tapflow/flows', ext: '.yaml' }
   ```
   (Adjust the `path.join(ROOT, ...)` segments if `flows_dir` differs from the default `.tapflow/flows`.)
4. Write the file back.
5. Copy this skill's `templates/tapflow-report-adapter.js` into the same directory as the installed `progress-server.js`.

---

## Phase 5 — Running Flows

Print these two commands for the user — do not execute them automatically, since running against a real device is the user's call:

```sh
tapflow flow run .tapflow/flows/*.yaml --relay <relay_url> --device "<device name>" --junit test-results/mobile/report.xml
node <reporters-dir>/tapflow-report-adapter.js --report test-results/mobile/report.xml --platform ios
```

(Swap `ios`/`android` in `--platform` for whichever device the run targeted; run the pair once per platform if flows target both.) The first command replays flows deterministically against the real device — no LLM in the loop, same result every time. The second parses the JUnit report and streams it into the dashboard if `progress-server.js` is running; it reports the correct exit code even if the dashboard isn't running.

---

## Error Handling / Limitations

- Relay/agent unreachable → stop before recording or running; point at `tapflow doctor` / `tapflow status`.
- Never write `relay_token` into a committed flow file or any version-controlled file — env var or gitignored local config only.
- This skill does not generate a CI workflow file. `tapflow flow run` + the adapter are CI-compatible by construction (see tapflow's own CI guide), but wiring that in is left to the team.
- Malformed JUnit XML at adapter run time is a hard failure (non-zero exit, clear parse error) — never silently reported as a pass.

## Common Pitfalls

| Symptom | Cause / Fix |
|---|---|
| `tapflow flow run` reports "device not found" | Device isn't booted, or its name doesn't match exactly — run `tapflow devices` to see the exact name/UDID to pass to `--device`. |
| Recorded flow fails immediately on replay | A selector recorded during exploration (label text, especially) changed, or the app needs `clearState`/`launchApp` first — check the flow's first two steps. |
| Adapter posts nothing to the dashboard | Dashboard not running, or wrong `--dashboard-url`/port — the adapter never fails the run over this, so check its own console line, not the dashboard. |
| Mobile tab doesn't appear in the dashboard | `progress-server.js` doesn't yet support per-category `ext` (see Phase 4, step 2) — update/reinstall `e2e-dashboard` first. |
| Two teammates recording flows disagree on selectors | tapflow resolves id → label → partial-label; prefer `id` selectors when available, since labels can be ambiguous across similar-looking elements. |
```

- [ ] **Step 3: Verify frontmatter is well-formed and cross-references are accurate**

Run:
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md', 'utf8');
if (!content.startsWith('---\nname: mobile-app-testing')) throw new Error('bad frontmatter');
if (!content.includes('--report') || !content.includes('--platform')) throw new Error('CLI flags not documented');
console.log('SKILL.md OK');
"
```
Expected: `SKILL.md OK`. Also manually re-read the file once and confirm every CLI flag/function name mentioned matches Task 4's actual `parseArgs` implementation (`--report`, `--platform`, `--dashboard-url`) and every `CATEGORIES` field mentioned matches Task 1's actual field names (`key`, `label`, `icon`, `dir`, `prefix`, `ext`).

- [ ] **Step 4: Commit**

```bash
git add plugins/mobile-app-testing/skills/mobile-app-testing/SKILL.md
git rm --cached plugins/mobile-app-testing/skills/mobile-app-testing/templates/.gitkeep 2>/dev/null || true
git commit -m "docs(mobile-app-testing): write SKILL.md

Discovery/connectivity, journey selection, MCP-driven recording into
tapflow-native YAML flows, e2e-dashboard CATEGORIES wiring, and the
run/report command pair. Prerequisites and error handling documented
explicitly per the approved design spec."
```

---

### Task 6: Manual end-to-end verification (real tapflow instance required)

**Files:** none — this task exercises the installed skill against real infrastructure. Not automatable: it depends on live device interaction, a live relay/agent, and a real MCP connection, none of which are mockable the way Tasks 1-5's unit tests are (per the spec's own Testing section).

**Interfaces:** N/A.

- [ ] **Step 1: Stand up a real tapflow instance**

On a Mac with Xcode + iOS Simulator installed, follow tapflow's own Quick Start: `npm install -g tapflow`, `tapflow setup`, `tapflow start`, create the admin account, note the relay URL (`http://localhost:4000` by default) and create a Personal Access Token in Settings → Tokens.

- [ ] **Step 2: Install both skills into a scratch project**

In a throwaway web-app project (or a fresh scaffold), run `/e2e-dashboard` first (if not already installed), confirm the dashboard starts and shows the existing Playwright suite normally. Then run `/mobile-app-testing`.

- [ ] **Step 3: Verify connectivity failure handling**

During the Phase 1 interview, deliberately supply an incorrect `relay_token` first. Confirm the skill stops with a clear error message and does not proceed to Phase 2/3 recording.

- [ ] **Step 4: Verify recording produces a correct flow file**

Provide the correct token, pick one real journey, and let Claude record it against a real booted iOS Simulator. After recording, open the written `.tapflow/flows/<journey-name>.yaml` and confirm every step matches what was actually tapped/typed during the session, and that no step contains raw coordinates.

- [ ] **Step 5: Verify the real replay + adapter pipeline**

Run the two commands from Phase 5 for real:
```sh
tapflow flow run .tapflow/flows/*.yaml --relay <relay_url> --device "<device name>" --junit test-results/mobile/report.xml
node tests/reporters/tapflow-report-adapter.js --report test-results/mobile/report.xml --platform ios
```
Confirm `tapflow flow run`'s exit code matches whether the flow actually passed on the device, and the adapter's own exit code matches the JUnit report's content.

- [ ] **Step 6: Verify dashboard display**

With the dashboard running, re-run the adapter command from Step 5. Confirm a "Mobile (tapflow)" category tab appears, shows one row per recorded flow, and that a deliberately-broken flow (edit one `assertVisible` to target a nonexistent label, re-run) shows as failed with the correct error message surfaced from the JUnit `<failure>` text.

- [ ] **Step 7: Verify graceful degradation without the dashboard**

Stop the dashboard, re-run the adapter command. Confirm it still exits with the correct code and logs (not throws) about the dashboard being unreachable.

- [ ] **Step 8: Verify zero impact on Playwright-only projects**

In a separate project that has `e2e-dashboard` installed but never had `mobile-app-testing` run against it, confirm the sidebar, category tabs, and full `node --test` suite (including Task 1's changes) behave exactly as before — no "Mobile" tab, no errors.

- [ ] **Step 9: Record findings**

If any step surfaces a real bug (not a documentation gap), file it as a follow-up task before considering this feature done — this plan's automated tests cover the parsing/event/CLI logic exhaustively, but the MCP recording flow and the live CATEGORIES text-edit in Phase 4 have never executed against real tapflow infrastructure until this task.

---

## Self-Review Notes (from writing this plan)

- **Spec coverage:** every component in the revised spec (per-category `ext`, `tapflow-report-adapter.js`, SKILL.md's five phases, CI explicitly not built) maps to a task above.
- **Type consistency:** `buildTestBeginEvent`/`buildTestEndEvent`'s `(testCase, flowFile, platform)` signature is identical between Task 4's implementation and its tests; `CATEGORIES` entry field names (`key`, `label`, `icon`, `dir`, `prefix`, `ext`) are identical between Task 1's implementation, its tests, and Task 5's SKILL.md instructions.
- **No placeholders:** the two REST endpoints this plan's code actually calls (`GET /api/v1/auth/me` for connectivity verification, and `POST /event` on the already-existing dashboard server) are both confirmed-real from tapflow's/this repo's own documentation — no fabricated API surface remains, unlike the plan's first (discarded) draft.
