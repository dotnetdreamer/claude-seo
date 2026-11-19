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
