// Runs the Python scripts and their TypeScript versions on the same input and
// fails on any difference, so a change upstream that the port has not caught
// up with shows here.
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/parity.test.ts
//
// The Python needs beautifulsoup4 and lxml (pip install -r requirements.txt).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPageChecks } from '../checks/pageChecks.ts';
import { auditRobotsText, AI_AGENTS } from '../checks/aiAccess.ts';
import { lighthouseLlmsTxt } from '../checks/llms.ts';
import { analyseText } from '../checks/contentQuality.ts';
import { analyseMetadata, analyseMetadataPairs } from '../checks/metadataTemplate.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const python = process.env.OSG_PARITY_PYTHON || 'python3';

function runPython(args: string[], input?: string): string {
  const result = spawnSync(python, ['-I', ...args], { cwd: repo, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`python ${args.join(' ')} failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function harness(name: string, payload: unknown): any {
  return JSON.parse(runPython([path.join(here, 'harness.py'), name], JSON.stringify(payload)));
}

const pagesDir = path.join(here, 'fixtures', 'pages');
const pages = fs.readdirSync(pagesDir).filter((name) => name.endsWith('.html')).sort();

for (const file of pages) {
  test(`page checks: ${file}`, () => {
    const meta = JSON.parse(fs.readFileSync(path.join(pagesDir, file.replace(/\.html$/, '.json')), 'utf8'));
    const args = [path.join(repo, 'scripts', 'page_checks.py'), '--file', path.join(pagesDir, file), '--base-url', meta.url];
    if (meta.headers) args.push('--headers-json', JSON.stringify(meta.headers));
    const py = JSON.parse(runPython(args));
    assert.ok(!py.error, `the script refused the page: ${py.error}`);

    const raw = fs.readFileSync(path.join(pagesDir, file));
    const html = new TextDecoder('utf-8').decode(raw);
    const ts = runPageChecks(html, meta.url, meta.headers ?? null, raw.length);

    const shape = (findings: any[]) =>
      findings.map((f) => ({ id: f.id, severity: f.severity, count: f.count ?? null, evidence: f.evidence }));
    assert.deepEqual(shape(ts.findings), shape(py.findings), 'findings differ');
    assert.deepEqual(ts.notChecked.map((n) => n.id), py.not_checked.map((n: any) => n.id), 'not checked differs');
    assert.deepEqual(ts.facts, py.facts, 'facts differ');
    assert.equal(ts.summary.checksRun, py.summary.checks_run, 'checks run differs');
    assert.equal(ts.headersAvailable, py.headers_available);
  });
}

const robotsDir = path.join(here, 'fixtures', 'robots');
for (const file of fs.readdirSync(robotsDir).filter((name) => name.endsWith('.txt')).sort()) {
  test(`robots.txt and AI agents: ${file}`, () => {
    const text = fs.readFileSync(path.join(robotsDir, file), 'utf8');
    const py = harness('robots', { text });
    const ts = auditRobotsText(text);
    assert.deepEqual(ts.agents.map((a) => [a.token, a.group, a.rootAllowed]), py.agents.map((a: any) => [a.token, a.group, a.root_allowed]), 'agents differ');
    assert.deepEqual(ts.sitemaps, py.sitemaps, 'sitemaps differ');
    assert.deepEqual(ts.nonstandardUserAgentLines, py.nonstandard, 'nonstandard lines differ');
    assert.equal(ts.aiGroups.status, py.ai_groups_status, 'robots-ai-groups status differs');
    assert.equal(ts.userAgents.status, py.user_agents_status, 'robots-user-agents status differs');
    assert.deepEqual(AI_AGENTS.map((a) => a.token), py.tokens, 'the list of AI agents differs');
  });
}

const llmsDir = path.join(here, 'fixtures', 'llms');
for (const file of fs.readdirSync(llmsDir).filter((name) => name.endsWith('.txt')).sort()) {
  test(`llms.txt: ${file}`, () => {
    const text = fs.readFileSync(path.join(llmsDir, file), 'utf8');
    const py = harness('llms', { status: 200, content: text });
    const ts = lighthouseLlmsTxt(200, text);
    assert.deepEqual(ts, py);
  });
}

test('llms.txt: answers other than 200', () => {
  for (const status of [null, 404, 500]) {
    assert.deepEqual(lighthouseLlmsTxt(status, null), harness('llms', { status, content: null }), `status ${status}`);
  }
});

const textDir = path.join(here, 'fixtures', 'text');
for (const file of fs.readdirSync(textDir).filter((name) => name.endsWith('.txt')).sort()) {
  test(`content quality: ${file}`, () => {
    const text = fs.readFileSync(path.join(textDir, file), 'utf8');
    const py = harness('content', { text });
    assert.deepEqual(analyseText(text), py);
  });
}

test('templated metadata: one pair at a time and a whole site', () => {
  const pairs = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'metadata-pairs.json'), 'utf8'));
  for (const pair of pairs) {
    const py = harness('metadata', pair);
    assert.deepEqual(analyseMetadata(pair.title, pair.description, pair.url ?? null), py, `pair ${JSON.stringify(pair)}`);
  }
  assert.deepEqual(analyseMetadataPairs(pairs), harness('metadata-site', { pairs }));
});
