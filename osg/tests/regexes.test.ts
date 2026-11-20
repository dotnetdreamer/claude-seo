// The patterns the port reads without a lookbehind and without JavaScript's
// i flag (py.ts says why), against the scripts' own patterns run by Python,
// on strings built to sit on every edge they have: a \w or not on each side
// of a phrase, a number or a name; "%" and st/nd/rd/th at a number's end; a
// line that starts after "\r" or U+2028; and the five characters the i flag
// would have counted as Python's \w. Then re.I itself, for every ASCII
// character, over every code point.
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/regexes.test.ts
//   FUZZ_REGEX=200000 for more strings (default 60000).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { placeholderSpan } from '../checks/pageChecks.ts';
import { AI_PATTERNS, FILLER_PHRASES, numberAndEntityMatches, phraseHits } from '../checks/contentQuality.ts';
import { llmsLineTests } from '../checks/llms.ts';
import { ctaTail } from '../checks/metadataTemplate.ts';
import { pyIgnoreCase } from '../checks/py.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const python = process.env.OSG_PARITY_PYTHON || 'python3';

function harness(name: string, payload: unknown): any {
  const result = spawnSync(python, ['-I', path.join(here, 'harness.py'), name], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`harness ${name} failed (${result.status}):\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];

/** One of Python's \w on either side of something, or not. */
const WORDS = ['x', 'X', '_', '0', '9', '\u{E9}', '\u{416}', '\u{3A3}', '\u{10400}', '\u{1D7CE}', '\u{663}', '\u{FF13}', '\u{2160}', '\u{AA}'];
const NOT_WORDS = [
  ' ', '  ', '\n', '\r', '\r\n', '\u{2028}', '\u{2029}', '\u{B}', '\u{C}', '\u{1C}', '\u{85}', '\u{A0}', '\t', '-', '.', ',', "'", '%', '!', '?',
  // What JavaScript's i flag would have taken for Python's \w.
  '\u{345}', '\u{A7CB}', '\u{A7D2}', '\u{A7D4}', '\u{A7DC}',
  '\u{200B}', '\u{1F600}', '\u{301}', '\u{FEFF}', '\u{2019}',
];
const PLACEHOLDERS = ['lorem ipsum', 'Lorem Ipsum', 'LOREM IPSUM', 'lorem \u{131}psum', 'lorem \u{130}psum', 'dolor sit amet', 'dolor \u{17F}it amet', 'DOLOR SIT AMET', 'consectetur adipiscing', 'consectetur adipi\u{17F}cing', 'CONSECTETUR ADIPISCING', 'lorem', 'ipsum'];
const NUMBERS = ['12', '3.5', '7,25', '50%', '1st', '22nd', '3rd', '4th', '5TH', '11th', '\u{661}\u{662}', '\u{1D7CF}\u{1D7D0}', '1.', '.5', '12a', 'st', 'th', '%', '1%2', '9.9%'];
const NAMES = ['New York', 'San Francisco Bay', 'Ab Cd', 'ABC Def', 'New\u{A0}York', 'New\nYork', 'New\u{2028}York', 'Paris', 'Rome Italy', 'Ab', 'Ab  Cd Ef'];
const LLMS = ['# Title', '#Title', '## Section', '> Summary', '>no', ' # x', '\t## y', '#  ', '# \n', '>\u{A0}x', '\u{B}# z', '\u{1C}> q', '###', '#\u{2028}x'];
const CTA = [
  'start your free', 'start now', 'start the big new thing now', 'start \u{345} now', 'start \u{A7CB} now', 'get started', 'Get Started Today', 'try it free', 'TRY IT NOW', 'try today',
  'sign up today', 'learn more now', 'read now', 'find out now', 'check it out now', 'check your inbox now', 'check your \u{345} now', 'boost your sales now', 'improve now', 'upgrade your plan today',
  '\u{17F}ign up now', '\u{17F}tart now', 'tr\u{130} it free', 'tr\u{131} it now', 'learn more now!', 'try it free...',
];

function phrasePieces(random: () => number): string {
  const phrase = pick(random, pick(random, [FILLER_PHRASES, AI_PATTERNS]));
  const roll = random();
  return roll < 0.3 ? phrase.toUpperCase() : roll < 0.4 ? phrase.replace(/s/g, '\u{17F}') : roll < 0.5 ? phrase.replace(/i/g, '\u{130}') : phrase;
}

/** Strings that sit right on the edges, written out once. */
const EDGES = [
  'lorem ipsum\u{345}', '\u{345}lorem ipsum', 'xlorem ipsum', 'lorem ipsumx', 'lorem ipsum_', '_lorem ipsum', 'lorem ipsum\u{A7CB}', '\u{A7DC}dolor sit amet', '\u{10400}lorem ipsum', 'lorem ipsum\u{1D7CE}',
  'lorem ipsum lorem ipsum', 'xlorem ipsum lorem ipsum', '50% off', '50%off', '1st.', '22ndx', '3rd_', '4th\u{345}', '12\u{A7CB}', '\u{663}%x', '1.5.6', '1,2,3', 'x12 34',
  'New York\u{345}', 'New York\u{A7D2}', 'xNew York', 'New YorkX', 'New York_', 'New  York City',
  '\r# Title', '\u{2028}# Title', 'a\n# Title', 'a\r\n# Title', '\u{2029}> x', 'a\n> x', 'a\n## x', 'a\r## x', '\n', '#', '',
  'start \u{345} now', 'start \u{A7CB} \u{A7D2} now', 'check your \u{345} now', 'improve \u{345} now', 'start your free.', 'start your free \n',
];

const STRINGS = Number(process.env.FUZZ_REGEX ?? 60000);

test('the patterns without a lookbehind or the i flag find what the scripts find, on strings built around their edges', () => {
  const random = seeded(4016);
  const texts = [...EDGES];
  const pools = [WORDS, NOT_WORDS, NOT_WORDS, PLACEHOLDERS, NUMBERS, NAMES, LLMS, CTA];
  while (texts.length < STRINGS) {
    const parts: string[] = [];
    for (let n = Math.floor(random() * 10); n > 0; n--) parts.push(random() < 0.12 ? phrasePieces(random) : pick(random, pick(random, pools)));
    texts.push(parts.join(''));
  }
  const py: any[] = harness('regex-probes', { texts });
  const names = ['placeholder', 'numbers', 'names', 'filler phrases', 'AI phrases', 'llms.txt lines', 'call to action'];
  const differences: string[] = [];
  const found = new Array(names.length).fill(0);
  texts.forEach((text, index) => {
    const [numbers, entities] = numberAndEntityMatches(text);
    const ts = [placeholderSpan(text), numbers, entities, phraseHits(text, FILLER_PHRASES), phraseHits(text, AI_PATTERNS), llmsLineTests(text), ctaTail(text)];
    ts.forEach((value, at) => {
      const theirs = py[index][at];
      if (JSON.stringify(value) !== JSON.stringify(theirs)) differences.push(`${names[at]} of ${JSON.stringify(text)}: ${JSON.stringify(value)} vs Python's ${JSON.stringify(theirs)}`);
      const hit = Array.isArray(theirs) ? (at === 5 ? theirs.some(Boolean) : theirs.length > 0) : theirs !== null;
      if (hit) found[at]++;
    });
  });
  assert.deepEqual(differences.slice(0, 20), [], `${differences.length} differences in ${texts.length} strings`);
  // Each pattern was reached often, so agreeing says something.
  names.forEach((name, at) => assert.ok(found[at] > 500, `${name}: only ${found[at]} strings with a match`));
});

test("re.I for every ASCII character, over every code point, without JavaScript's i flag", () => {
  const chars = Array.from({ length: 95 }, (_, at) => String.fromCharCode(0x20 + at));
  const py: Record<string, number[]> = harness('ignore-case', { chars });
  const points: string[] = [];
  for (let point = 0; point <= 0x10ffff; point++) if (point < 0xd800 || point > 0xdfff) points.push(String.fromCodePoint(point));
  const every = points.join('');
  const differences: string[] = [];
  for (const ch of chars) {
    const ts = Array.from(every.matchAll(new RegExp(pyIgnoreCase(ch), 'gu')), (match) => match[0].codePointAt(0));
    if (JSON.stringify(ts) !== JSON.stringify(py[ch])) differences.push(`${JSON.stringify(ch)}: ${ts.map((p) => p!.toString(16)).join(' ')} vs ${py[ch].map((p) => p.toString(16)).join(' ')}`);
  }
  assert.deepEqual(differences, []);
});
