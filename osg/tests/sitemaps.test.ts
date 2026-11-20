// claude-seo's sitemap reading (scripts/sitemap_discovery.py, _read_body and
// _xml_entries) against sitemap.ts, xml.ts and gzip.ts on the same bytes:
// written-out cases first (namespaces with and without a prefix, each reason
// lxml refuses a document, gzip in every shape, text sitemaps), then made-up
// documents by the thousand, each written out a random way and, half the
// time, broken a random way.
//
// Two things the port says it can't read instead of guessing (sitemap.ts):
// an XML encoding libxml2 hands to iconv, and Atom links under an xml:base.
// Those are counted, and everything else about the same documents compared.
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/sitemaps.test.ts
//   FUZZ_SITEMAPS=20000 for more made-up documents (default 6000).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAX_SITEMAP_BYTES, readSitemapBody, type SitemapBody } from '../checks/sitemap.ts';
import { AT, XML, madeUpCases, member, utf8, writtenCases, type Case } from './sitemapCases.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const python = process.env.OSG_PARITY_PYTHON || 'python3';

function harness(name: string, payload: unknown): any {
  const result = spawnSync(python, ['-I', path.join(here, 'harness.py'), name], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`harness ${name} failed (${result.status}):\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

// --- comparison -------------------------------------------------------------

interface Python {
  kind: string | null;
  error: string | null;
  gzip: boolean;
  entries: Array<[string | null, string | null]>;
  lines: string[] | null;
}

function compare(cases: Case[]): { differences: string[]; unread: Record<string, number>; kinds: Record<string, number> } {
  const py: Python[] = harness('sitemaps', { cases: cases.map((entry) => ({ body: Buffer.from(entry.body).toString('base64'), type: entry.type, url: entry.url })) });
  const differences: string[] = [];
  const unread: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  cases.forEach((entry, index) => {
    const ts: SitemapBody = readSitemapBody(entry.body, entry.type, entry.url);
    const theirs = py[index];
    const label = `${entry.name} (${JSON.stringify(Buffer.from(entry.body.subarray(0, 120)).toString('latin1'))}${entry.body.length > 120 ? '...' : ''}, ${entry.type || 'no type'}, ${entry.url})`;
    kinds[ts.kind ?? ts.error ?? `unread: ${ts.unread}`] = (kinds[ts.kind ?? ts.error ?? `unread: ${ts.unread}`] ?? 0) + 1;
    if (ts.unread && ts.kind === null) {
      // An encoding this port leaves to iconv: nothing to compare.
      unread[ts.unread] = (unread[ts.unread] ?? 0) + 1;
      return;
    }
    if (ts.unread) unread[ts.unread] = (unread[ts.unread] ?? 0) + 1;
    const mine = { kind: ts.kind, error: ts.error, gzip: ts.gzip, lines: ts.lines, entries: ts.entries.map((item, at) => (item.unresolved ? ['(xml:base)', theirs.entries[at]?.[1] ?? null] : [item.loc, item.lastmod])) };
    const python = { kind: theirs.kind, error: theirs.error, gzip: theirs.gzip, lines: theirs.lines, entries: theirs.entries.map((item, at) => (ts.entries[at]?.unresolved ? ['(xml:base)', item[1]] : item)) };
    if (JSON.stringify(mine) !== JSON.stringify(python)) differences.push(`${label}:\n    port   ${JSON.stringify(mine)}\n    Python ${JSON.stringify(python)}`);
  });
  return { differences, unread, kinds };
}

test("written-out sitemaps: what claude-seo reads them as, namespaces, every refusal, gzip and text sitemaps", () => {
  const { differences, unread } = compare(writtenCases());
  assert.deepEqual(differences, []);
  assert.deepEqual(unread, { 'Atom links under an xml:base': 1 });
});

test('made-up sitemaps, written out and broken at random: the same reading as claude-seo', () => {
  const cases = madeUpCases(Number(process.env.FUZZ_SITEMAPS ?? 6000));
  const { differences, unread, kinds } = compare(cases);
  if (process.env.SITEMAP_STATS) console.log(JSON.stringify({ kinds, unread }, null, 1));
  assert.deepEqual(differences.slice(0, 10), [], `${differences.length} of ${cases.length} differ`);
  // Every kind and the common refusals were reached.
  for (const kind of ['urlset', 'sitemapindex', 'rss', 'feed', 'text', 'invalid XML', 'invalid gzip data', 'unsupported XML root', 'invalid text sitemap', 'response is not a supported sitemap format']) {
    assert.ok((kinds[kind] ?? 0) > 20, `only ${kinds[kind] ?? 0} made-up documents came out as ${kind}`);
  }
});

test('the 50 MiB limit after inflating, on both sides of it', () => {
  const cases: Case[] = [];
  for (const size of [MAX_SITEMAP_BYTES, MAX_SITEMAP_BYTES + 1]) {
    const spaces = new Uint8Array(size).fill(0x20);
    cases.push({ name: `${size} spaces gzipped`, body: member(spaces, { level: 9 }), type: XML, url: AT });
  }
  const { differences } = compare(cases);
  assert.deepEqual(differences, []);
  assert.equal(readSitemapBody(cases[1].body, XML, AT).error, 'Sitemap exceeds the 50 MiB uncompressed protocol limit');
});

test("libxml2's ten-million-byte limits: a text node and a comment on both sides of them, and what the port leaves unread", () => {
  const cases: Case[] = [];
  for (const size of [10_000_000, 10_000_001]) {
    cases.push({ name: `loc of ${size} bytes`, body: utf8(`<urlset><url><loc>${'a'.repeat(size)}</loc></url></urlset>`), type: XML, url: AT });
    cases.push({ name: `comment of ${size} bytes`, body: utf8(`<urlset><!--${'c'.repeat(size)}--></urlset>`), type: XML, url: AT });
  }
  const { differences } = compare(cases);
  assert.deepEqual(differences.map((line) => line.slice(0, 300)), []);
  // A start tag, CDATA section or PI read in one piece: lxml's limit there depends on its buffer, so the port says it can't tell.
  for (const body of [`<urlset a="${'a'.repeat(9_500_000)}"/>`, `<urlset><![CDATA[${'c'.repeat(9_500_000)}]]></urlset>`, `<urlset><?p ${'c'.repeat(9_500_000)}?></urlset>`]) {
    const read = readSitemapBody(utf8(body), XML, AT);
    assert.deepEqual([read.kind, read.unread], [null, 'a start tag, CDATA section or PI over 9 MB'], body.slice(0, 20));
  }
});
