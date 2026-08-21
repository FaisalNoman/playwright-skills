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

function extractFailureLike(body, tagName) {
  const re = new RegExp(`<${tagName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tagName}>)`);
  const match = body.match(re);
  if (!match) return null;
  const attrs = parseAttrs(match[1]);
  const text = decodeXmlEntities((match[2] || '').trim());
  return { message: (attrs.message || text || 'assertion failed').slice(0, 600) };
}

function parseJUnitXml(xml) {
  if (!/<testsuite\b/.test(xml)) {
    throw new Error('No <testsuite> found in JUnit XML — report is malformed or empty');
  }
  const cases = [];
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    const body = m[2] || '';
    // JUnit distinguishes <failure> (assertion failure) from <error>
    // (infrastructure/exception failure). Either one fails the testcase;
    // <failure> takes precedence if both are somehow present.
    const failure = extractFailureLike(body, 'failure') || extractFailureLike(body, 'error');
    cases.push({
      name: attrs.name || 'unnamed',
      classname: attrs.classname || '',
      time: parseFloat(attrs.time || '0'),
      failure,
    });
  }
  return cases;
}

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
    try {
      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => { res.resume(); resolve(); });
      req.on('error', () => resolve()); // dashboard is optional — never fail the run over this
      req.write(body);
      req.end();
    } catch {
      resolve(); // e.g. a non-http: dashboardUrl (https:, etc.) — never fail the run over this
    }
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
