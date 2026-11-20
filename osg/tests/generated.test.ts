// Thousands of made-up inputs, the same list for Python and for the port:
// every character reference HTML5 names, numbers and stray ampersands, and
// broken JSON-LD of every kind, down to the depth where Python gives up. The
// fixtures in parity.test.ts show whole pages agree; these show the two
// places where a page's text is decoded agree on everything in between.
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/generated.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHtml, find, findAll, rawText } from '../checks/html.ts';
import { NAMED_REFERENCES } from '../checks/entities.ts';
import { pythonJsonError } from '../checks/pyJson.ts';
import { decodeBody } from '../checks/decode.ts';
import { PY_DIGIT, PY_WORD, pyBoundaryAt, pyIsAlnum, pyIsAlpha, pyIsSpace, pyLower, pyLstrip, pyRepr, pyRstrip, pySorted, pySplit, pyStrip } from '../checks/py.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const python = process.env.OSG_PARITY_PYTHON || 'python3';

function harness(name: string, payload: unknown): any {
  const result = spawnSync(python, ['-I', path.join(here, 'harness.py'), name], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`harness ${name} failed (${result.status}):\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** A small seeded generator, so every run tries the same cases. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)];
}

const chars = (text: string) => Array.from(text);

test('character references: every HTML5 name, numbers and stray ampersands', () => {
  const random = seeded(2026);
  const cases: string[] = [];
  for (const name of NAMED_REFERENCES.keys()) {
    // As written, and without its semicolon, which most names need.
    for (const tail of ['', 'x', '=', ';', ' ', '1', '&amp;']) cases.push(`&${name}${tail}`, `&${name.replace(/;$/, '')}${tail}`);
  }
  for (let i = 0; i < 3000; i++) {
    const hex = random() < 0.5;
    const digits = Array.from({ length: Math.floor(random() * 13) }, () => pick(random, chars(hex ? '0123456789abcdefABCDEF' : '0123456789'))).join('');
    cases.push(`&#${hex ? 'x' : ''}${digits}${pick(random, ['', ';', 'g', '=', ' ', '9', '&#38;'])}`);
  }
  for (let i = 0; i < 2000; i++) {
    const length = 1 + Math.floor(random() * 40);
    cases.push('&' + Array.from({ length }, () => pick(random, chars('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789;&#='))).join(''));
  }
  // Characters HTML5 changes before it reads a page (CR, CR LF, NUL), with and next to references.
  const raw = ['\r\n', '\r', '\n\r', '\r\r\n', '\u0000', '\f', '\u000b', '\u{2028}', '\u0085', '\u{FEFF}', '\u001f', '\u007f'];
  for (const char of raw) cases.push(char, `x${char}y`, `&amp${char}`, `${char}&amp;`, `&#13;${char}`, `&#x${char}41;`);
  const unique = [...new Set(cases)];
  const py: Array<Array<string | null>> = harness('html-text', { cases: unique });
  const differences: string[] = [];
  unique.forEach((ref, index) => {
    const doc = parseHtml(
      `<html><head><title>A${ref}B</title><meta name="a" content="A${ref}B"><meta name="b" content="A${ref}=B">` +
        `<meta name="c" content="A${ref}xB"></head><body><p>A${ref}B</p></body></html>`
    );
    const title = find(doc, 'title');
    const metas = findAll(doc, 'meta');
    const content = (name: string) => metas.find((meta) => meta.attrs.name === name)?.attrs.content ?? null;
    const paragraph = find(doc, 'p');
    const ts = [title ? rawText(title) : null, content('a'), content('b'), content('c'), paragraph ? rawText(paragraph) : null];
    if (JSON.stringify(ts) !== JSON.stringify(py[index])) differences.push(`${JSON.stringify(ref)}: ${JSON.stringify(ts)} vs ${JSON.stringify(py[index])}`);
  });
  assert.deepEqual(differences.slice(0, 20), [], `${differences.length} of ${unique.length} cases differ`);
  assert.ok(unique.length > 30000, `only ${unique.length} cases`);
});

test("JSON-LD errors: Python's words at Python's positions, and its nesting limit", () => {
  const random = seeded(77);
  const seeds = [
    JSON.stringify(
      { '@context': 'https://schema.org', '@type': 'MobileApplication', name: 'Juniper \u{E9}t\u{E9} \u{1F600}', offers: { '@type': 'Offer', price: 0 }, aggregateRating: { ratingValue: 4.8 } },
      null,
      2
    ),
    JSON.stringify([{ '@type': 'FAQPage', mainEntity: [{ name: 'Is it free?\n', acceptedAnswer: { text: 'Yes "really" \\ / \t' } }] }]),
    '{"a": [1, -2.5e-3, true, false, null, "x\\u00e9\\ud83d\\ude00\\n"], "b": {"c": NaN, "d": Infinity, "e": -Infinity}}',
    '\n\t {"@graph": [{"@id": "#a"}, {"@id": "#b", "url": "https://example.com/?a=1&b=2"}]} \r\n',
  ];
  const pieces = [
    ...chars('{}[]:,"\\ \n\t\r-+.0123456789eEuxNIaf/'),
    '\\u', '\\ud83d', '\\udc00', 'true', 'null', 'NaN', 'Infinity', '\u{E9}', '\u{1F600}', '\u{FEFF}', '\u0000', '\u001f', "'",
  ];
  const texts: string[] = ['', ' ', 'NaN', '-Infinity', '\u{FEFF}{}', '01', '1e+', '"\\u1234', String.raw`"\ud800\u12"`, '[1,]', '{"a":1,}', '{,}', '[,]'];
  for (let i = 0; i < 6000; i++) {
    const text = chars(pick(random, seeds));
    const edits = 1 + Math.floor(random() * 3);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(random() * (text.length + 1));
      const op = random();
      if (op < 0.35 && text.length) text.splice(Math.min(at, text.length - 1), 1);
      else if (op < 0.7) text.splice(at, 0, pick(random, pieces));
      else if (text.length) text[Math.min(at, text.length - 1)] = pick(random, pieces);
    }
    texts.push(text.join(''));
  }
  for (const depth of [9993, 9994, 9995, 9997, 9998, 9999]) {
    const open = '['.repeat(depth);
    const close = ']'.repeat(depth);
    texts.push(
      open + close,
      open + 'x' + close,
      open + '1,' + close,
      open + String.raw`"\x"` + close,
      open + 'NaN' + close,
      open + '1'.repeat(4400) + close,
      open + close.slice(1),
      '{"a":'.repeat(depth) + '1' + '}'.repeat(depth)
    );
  }
  for (const digits of [4300, 4301]) texts.push('1'.repeat(digits), '-' + '1'.repeat(digits), '[' + '9'.repeat(digits) + '.0]');
  const py: Array<string | null> = harness('json-errors', { texts });
  const differences: string[] = [];
  texts.forEach((text, index) => {
    const ts = pythonJsonError(text);
    if (ts !== py[index]) differences.push(`${JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text)}: ${ts} vs ${py[index]}`);
  });
  assert.deepEqual(differences.slice(0, 20), [], `${differences.length} of ${texts.length} texts differ`);
  assert.ok(py.filter((answer) => answer !== null).length > 3000, 'most of the texts should be broken');
});

test("Python's string rules: lower, strip, split, repr, \\w, \\d, \\b and sort, on every code point and on random strings", () => {
  const random = seeded(31);
  const texts: string[] = [];
  // Every code point once, in blocks, so each is read in some company.
  const block: string[] = [];
  for (let point = 0; point <= 0x10ffff; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    block.push(String.fromCodePoint(point));
    if (block.length === 64) texts.push(block.splice(0).join(''));
  }
  if (block.length) texts.push(block.join(''));
  // Strings around the final sigma, spaces and marks.
  const pieces = ['\u{3A3}', '\u{3C3}', 'A', 'a', ' ', '\u{1C}', '\u{85}', '\u{FEFF}', '\u{A0}', '\u{301}', "'", '.', '\u{130}', '\u{131}', '\u{DF}', '\u{1F600}', '\u{FF13}', '\u{663}', '_', '-', '\u{2028}', '\u{200B}', '\u{2C65}', 'x', '\u{10D50}', '\u{1C89}'];
  for (let i = 0; i < 20000; i++) texts.push(Array.from({ length: Math.floor(random() * 9) }, () => pick(random, pieces)).join(''));
  const py: { each: any[]; sorted: string[] } = harness('py-text', { texts });
  const differences: string[] = [];
  const word = new RegExp(PY_WORD, 'u');
  const digit = new RegExp(PY_DIGIT, 'u');
  texts.forEach((text, index) => {
    const list = Array.from(text);
    const positions: number[] = [];
    // \\b positions as Python counts them: in code points.
    let point = 0;
    for (let at = 0; at <= text.length; at += (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1, point++) if (pyBoundaryAt(text, at)) positions.push(point);
    const ts = [
      pyLower(text), pyStrip(text), pyLstrip(text), pyRstrip(text), pySplit(text), pyRepr(text),
      list.map(pyIsAlnum), list.map(pyIsAlpha), list.map(pyIsSpace), list.map((ch) => word.test(ch)), list.map((ch) => digit.test(ch)), positions, pyStrip(text, '._- '),
    ];
    const names = ['lower', 'strip', 'lstrip', 'rstrip', 'split', 'repr', 'isalnum', 'isalpha', 'isspace', '\\w', '\\d', '\\b', 'strip(chars)'];
    ts.forEach((value, at) => {
      if (JSON.stringify(value) !== JSON.stringify(py.each[index][at])) differences.push(`${names[at]} of ${JSON.stringify(text.slice(0, 40))}`);
    });
  });
  assert.deepEqual(differences.slice(0, 20), [], `${differences.length} differences`);
  // Compared by hand: a failing deepEqual on two arrays this long spends minutes on its diff.
  const sorted = pySorted(texts);
  const at = sorted.findIndex((text, index) => text !== py.sorted[index]);
  assert.ok(at < 0 && sorted.length === py.sorted.length, `sorted() differs at ${at}: ${JSON.stringify(sorted[at])} vs ${JSON.stringify(py.sorted[at])}`);
});

test("page bytes: decode_body's choice of codec and Python's codecs, on made-up bytes, headers and meta tags", () => {
  const random = seeded(1252);
  const byte = () => Math.floor(random() * 256);
  const TEXT = ['a', 'Pebble ', '\u{E9}', '\u{20AC}', '\u{201C}', '\u{2026}', '\u{416}', '\u{3A3}', '\u{5D0}', '\u{E01}', '\u{1F600}', '\u{FEFF}', '\u{FFFD}', '\n', '\u{0}', '<', '>', '"'];
  const LABELS = [
    '', 'utf-8', 'UTF8', ' utf-8 ', 'utf-8-sig', 'windows-1252', 'cp1252', 'CP1252', 'latin1', 'latin-1', 'iso-8859-1', 'ISO_8859-1:1987', 'l1', 'iso-8859-15', 'iso8859_2', 'windows-1251',
    'koi8-r', 'koi8_u', 'macintosh', 'mac-roman', 'cp437', 'ibm037', 'cp500', 'ascii', 'us-ascii', 'ANSI_X3.4-1968', 'utf-16', 'UTF-16LE', 'utf-16be', 'utf-32', 'utf-32le', 'utf_32_be',
    'tis-620', 'cp874', 'cp866', 'iso-8859-8', 'bogus', 'rot13', 'base64', 'x-mac-roman', 'unicode-1-1-utf-8', 'latin_1', 'windows_1250', '8859', 'utf', 'UTF-8;', '"utf-8"', 'cp1258', 'hp-roman8',
  ];
  const cases: Array<{ bytes: string; content_type: string }> = [];
  const textBytes = (encoding: string): number[] => {
    const text = Array.from({ length: Math.floor(random() * 30) }, () => pick(random, TEXT)).join('');
    if (encoding === 'utf-8') return Array.from(new TextEncoder().encode(text));
    const units: number[] = [];
    for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
    if (random() < 0.2) units.splice(Math.floor(random() * (units.length + 1)), 0, 0xd800 + Math.floor(random() * 0x800));
    const out: number[] = [];
    for (const unit of units) out.push(...(encoding === 'utf-16le' ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff]));
    if (random() < 0.2) out.push(byte());
    return out;
  };
  for (let n = 0; n < 8000; n++) {
    const kind = pick(random, ['utf-8', 'utf-8', 'utf-16le', 'utf-16be', 'random', 'broken'] as const);
    let body: number[] =
      kind === 'random' ? Array.from({ length: Math.floor(random() * 80) }, byte)
      : kind === 'broken' ? textBytes('utf-8').flatMap((b) => (random() < 0.15 ? [pick(random, [0x80, 0xbf, 0xc0, 0xc2, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff])] : [b]))
      : textBytes(kind);
    if (random() < 0.2) body = [...pick(random, [[0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff], [0xff, 0xfe, 0, 0], [0, 0, 0xfe, 0xff]]), ...body];
    if (random() < 0.4) {
      const label = pick(random, LABELS);
      const meta = pick(random, [
        `<meta charset="${label}">`, `<META CHARSET=${label}>`, `<meta charset=${label}/>`, `<meta http-equiv="Content-Type" content="text/html; charset=${label}">`,
        `<meta content="text/html;charset=${label}" http-equiv=content-type>`, `<meta content="text/html; charset=${label}">`, `<meta property="og:image" content="https://x.example/?charset=${label}">`,
        `<meta charset="${label}" charset="utf-8">`, `<meta\u{1C}charset=${label}>`, `<meta charset = ' ${label} '>`,
      ]);
      const at = random() < 0.15 ? body.length + 4100 : Math.floor(random() * (body.length + 1));
      while (body.length < at) body.push(0x20);
      body.splice(at, 0, ...Array.from(new TextEncoder().encode(meta)));
    }
    const header = random() < 0.5 ? '' : pick(random, ['text/html', 'text/html; charset=', 'text/html;charset=', 'text/html; CHARSET = ', 'text/html; charset="', 'application/xhtml+xml; charset=']) + (random() < 0.8 ? pick(random, LABELS) : '');
    cases.push({ bytes: Buffer.from(body).toString('base64'), content_type: header });
  }
  const py: Array<string | { error: string }> = harness('decode', { cases });
  const differences: string[] = [];
  cases.forEach((item, index) => {
    const ts = decodeBody(new Uint8Array(Buffer.from(item.bytes, 'base64')), item.content_type);
    if (JSON.stringify(ts) !== JSON.stringify(py[index])) differences.push(`${item.content_type} ${item.bytes.slice(0, 60)}: ${JSON.stringify(ts).slice(0, 80)} vs ${JSON.stringify(py[index]).slice(0, 80)}`);
  });
  assert.deepEqual(differences.slice(0, 12), [], `${differences.length} of ${cases.length} cases differ`);
});
