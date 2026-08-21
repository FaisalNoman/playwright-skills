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
      const text = decodeXmlEntities((failureMatch[2] || '').trim());
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
