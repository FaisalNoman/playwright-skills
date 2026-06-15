// Playwright custom reporter — streams events to progress-server on port 7373
// %%ADAPT%% See e2e-dashboard SKILL.md Phase 3 for adaptation instructions
const http = require('http');

function post(event) {
  const body = JSON.stringify(event);
  const req = http.request({
    hostname: 'localhost',
    port: 7373,
    path: '/event',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', () => {});
  req.end(body);
}

function testId(test) {
  return test.id || `${test.location?.file}::${test.titlePath?.join(' > ')}`;
}

function testFile(test) {
  const f = test.location?.file || '';
  // %%ADAPT_TEST_PATH_REGEX%%
  // Normalise to 'tests/e2e/foo.spec.ts' — must match the file keys used in progress-server's scanTestFiles()
  // Change the regex if your e2e dir is not inside a 'tests/' folder:
  //   e.g. /[/\\](e2e[/\\].+)$/  if tests live at root e2e/ dir
  const match = f.match(/[/\\](tests[/\\].+)$/);
  return match ? match[1].replace(/\\/g, '/') : f.split(/[/\\]/).slice(-2).join('/');
}

function getDescribes(test) {
  // titlePath: ['', 'file.spec.ts', 'Describe Block', ..., 'test title']
  // Returns just the describe blocks (not the root empty, not the file, not the title itself)
  const tp = typeof test.titlePath === 'function' ? test.titlePath() : (test.titlePath || []);
  return tp.length > 2 ? tp.slice(2, -1) : [];
}

class RealtimeReporter {
  onBegin(config, suite) {
    post({ type: 'begin', startTime: Date.now(), total: suite.allTests().length });
  }

  onTestBegin(test) {
    post({
      type:      'testBegin',
      id:        testId(test),
      title:     test.title,
      describes: getDescribes(test),
      file:      testFile(test),
      line:      test.location?.line ?? null,
    });
  }

  onTestEnd(test, result) {
    const error = result.errors?.[0];
    const attachments = (result.attachments || [])
      .filter(a => a.path)
      .map(a => ({ name: a.name, path: a.path, contentType: a.contentType || '' }));
    post({
      type:        'testEnd',
      id:          testId(test),
      file:        testFile(test),
      status:      result.status,
      duration:    result.duration,
      retry:       result.retry || 0,
      attachments,
      error: error
        ? { message: error.message?.substring(0, 600), location: error.location }
        : null,
    });
  }

  onStepBegin(test, result, step) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    post({
      type:     'stepBegin',
      id:       testId(test),
      title:    step.title.substring(0, 120),
      category: step.category,
    });
  }

  onStepEnd(test, result, step) {
    if (step.category === 'hook' || step.category === 'fixture') return;
    post({
      type:     'stepEnd',
      id:       testId(test),
      title:    step.title.substring(0, 120),
      category: step.category,
      error:    step.error ? step.error.message?.substring(0, 300) : null,
    });
  }

  onEnd(result) {
    post({ type: 'end', endTime: Date.now(), status: result.status });
  }
}

module.exports = RealtimeReporter;
