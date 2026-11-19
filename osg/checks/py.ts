// The few Python behaviours the checks depend on, so the TypeScript versions
// give the scripts' numbers and words to the last digit.

import { LOWER_RUNS, LOWER_SPECIALS, PACKED_RANGES } from './pyUnicode.ts';

/**
 * Python's round(x, digits): the exact value of the double is rounded, and a
 * value exactly halfway goes to the even neighbour. JavaScript rounds a half
 * up, and toFixed works on a string, so both differ on values like 2.5 and
 * 0.0625.
 */
export function pyRound(value: number, digits = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  // BigInt() calls, not 1n literals: the app compiles for ES2017.
  const ONE = BigInt(1);
  const TWO = BigInt(2);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const negative = bits >> BigInt(63) === ONE;
  const exponentBits = Number((bits >> BigInt(52)) & BigInt(0x7ff));
  let mantissa = bits & ((ONE << BigInt(52)) - ONE);
  let exponent: number;
  if (exponentBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= ONE << BigInt(52);
    exponent = exponentBits - 1075;
  }
  let numerator = mantissa * BigInt(10) ** BigInt(digits);
  let denominator = ONE;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  let quotient = numerator / denominator;
  const twice = TWO * (numerator % denominator);
  if (twice > denominator || (twice === denominator && quotient % TWO === ONE)) quotient += ONE;
  const rounded = Number(quotient) / 10 ** digits;
  return negative ? -rounded : rounded;
}

/** Python's int(round(x)). */
export function pyRoundInt(value: number): number {
  return pyRound(value, 0);
}

/** Python's str.splitlines(): every line break Python knows, the last empty line dropped. */
export function pySplitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// --- Python's character tables (pyUnicode.ts) --------------------------------

type Ranges = ReadonlyArray<readonly [number, number]>;
type Table = keyof typeof PACKED_RANGES;
const decoded = new Map<Table, Ranges>();

/** One of Python's tables, as [first, last] code point pairs in order. */
export function pyTable(name: Table): Ranges {
  let ranges = decoded.get(name);
  if (!ranges) {
    const out: Array<[number, number]> = [];
    let last = -1;
    for (const pair of PACKED_RANGES[name].split(' ')) {
      const [gap, length] = pair.split('.').map((part) => parseInt(part, 36));
      const start = last + 1 + gap;
      last = start + length;
      out.push([start, last]);
    }
    ranges = out;
    decoded.set(name, ranges);
  }
  return ranges;
}

/** Whether the code point is in one of Python's tables. */
export function inTable(name: Table, cp: number): boolean {
  const ranges = pyTable(name);
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** A regular expression class for a table. Code points past U+FFFF need the u flag. */
export function pyClass(name: Table, extra = '', negate = false): string {
  const escape = (cp: number) => (cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : `\\u{${cp.toString(16)}}`);
  return `[${negate ? '^' : ''}${extra}${pyTable(name).map(([a, b]) => (a === b ? escape(a) : `${escape(a)}-${escape(b)}`)).join('')}]`;
}

/**
 * Python's \s and str.isspace(): U+001C to U+001F and U+0085 are spaces,
 * U+FEFF isn't, unlike JavaScript's \s and trim(). Every one is in the BMP,
 * so the class works with or without the u flag.
 */
export const PY_SPACE = pyClass('space');
/** The same characters without the brackets, to put in a class of one's own. */
export const PY_SPACE_CHARS = PY_SPACE.slice(1, -1);
export const PY_NOT_SPACE = pyClass('space', '', true);
/** Python's \w in a str pattern, for a regular expression with the u flag. */
export const PY_WORD = pyClass('alnum', '_');
export const PY_NOT_WORD = pyClass('alnum', '_', true);
/** Python's \w, under the name the port used first. */
export const WORD_CHAR = PY_WORD;
/** Python's \d in a str pattern: a decimal digit of any script (u flag). */
export const PY_DIGIT = pyClass('decimal');
/** Python's \b in a str pattern (u flag): its \w on one side and not the other. */
export const PY_BOUNDARY = `(?:(?<=${PY_WORD})(?!${PY_WORD})|(?<!${PY_WORD})(?=${PY_WORD}))`;

const cp = (ch: string) => ch.codePointAt(0) ?? 0;
export const pyIsSpace = (ch: string) => inTable('space', cp(ch));
export const pyIsAlnum = (ch: string) => inTable('alnum', cp(ch));
export const pyIsAlpha = (ch: string) => inTable('alpha', cp(ch));
export const pyIsPrintable = (ch: string) => inTable('printable', cp(ch));

const SPACE_RUN = new RegExp(`${PY_SPACE}+`);
const LEADING = new RegExp(`^${PY_SPACE}+`);
const TRAILING = new RegExp(`${PY_SPACE}+$`);

/** Python's str.strip(), or str.strip(chars) with the characters given. */
export function pyStrip(text: string, chars?: string): string {
  return pyRstrip(pyLstrip(text, chars), chars);
}

export function pyLstrip(text: string, chars?: string): string {
  if (chars === undefined) return text.replace(LEADING, '');
  const drop = new Set(Array.from(chars));
  const list = Array.from(text);
  let start = 0;
  while (start < list.length && drop.has(list[start])) start++;
  return list.slice(start).join('');
}

export function pyRstrip(text: string, chars?: string): string {
  if (chars === undefined) return text.replace(TRAILING, '');
  const drop = new Set(Array.from(chars));
  const list = Array.from(text);
  let end = list.length;
  while (end > 0 && drop.has(list[end - 1])) end--;
  return list.slice(0, end).join('');
}

/** Python's str.split() with no separator: the words between runs of Python's whitespace. */
export function pySplit(text: string): string[] {
  return text.split(SPACE_RUN).filter((part) => part !== '');
}

let lowerMap: Map<number, string> | null = null;

function lowerTable(): Map<number, string> {
  if (lowerMap) return lowerMap;
  const map = new Map<number, string>();
  for (const run of LOWER_RUNS.split(' ')) {
    const [start, count, step, shift] = run.split('.');
    const from = parseInt(start, 36);
    const delta = shift.startsWith('-') ? -parseInt(shift.slice(1), 36) : parseInt(shift, 36);
    for (let i = 0; i < parseInt(count, 36); i++) {
      const at = from + i * Number(step);
      map.set(at, String.fromCodePoint(at + delta));
    }
  }
  for (const entry of LOWER_SPECIALS.split(' ').filter(Boolean)) {
    const [from, to] = entry.split(':');
    map.set(parseInt(from, 36), String.fromCodePoint(...to.split('.').map((part) => parseInt(part, 36))));
  }
  lowerMap = map;
  return map;
}

const ASCII = /^[\x00-\x7f]*$/;

/**
 * Python's str.lower(): its own table, not the browser's, and its final
 * sigma rule (a cased letter before U+03A3, case-ignorable ones skipped, and
 * none after it, gives U+03C2).
 */
export function pyLower(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase();
  const table = lowerTable();
  const points = Array.from(text, cp);
  let out = '';
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point === 0x3a3) {
      out += String.fromCodePoint(finalSigma(points, i) ? 0x3c2 : 0x3c3);
      continue;
    }
    out += table.get(point) ?? String.fromCodePoint(point);
  }
  return out;
}

function finalSigma(points: number[], at: number): boolean {
  let j = at - 1;
  while (j >= 0 && inTable('ignorable', points[j])) j--;
  if (j < 0 || !inTable('cased', points[j])) return false;
  j = at + 1;
  while (j < points.length && inTable('ignorable', points[j])) j++;
  return j === points.length || !inTable('cased', points[j]);
}

/** Python's order for strings: by code point, where JavaScript's sort goes by UTF-16 unit. */
export function pyCompare(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = cp(x[i]) - cp(y[i]);
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * A literal for a case-blind pattern (flags iu), read the way Python's re.I
 * reads it: there "i" also matches dotless U+0131 and U+0130 ("I" with a
 * dot). The u flag already folds U+017F to "s" and U+212A to "k", as Python does.
 */
export function pyCaseBlind(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/i/g, '[i\\u0131\\u0130]');
}

/** Python's $ without MULTILINE: the end, or just before a newline that ends the text. */
export const PY_END = '(?=\\n?$)';

/** Python's len() of a string: code points, not UTF-16 units. */
export function pyLen(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** Where Python's ^ matches under re.M: the start, or just after "\n" (not after "\r" or U+2028 as JavaScript's m flag has it). */
export const PY_LINE_START = '(?<![^\\n])';
/** Python's . without re.S: any character but "\n" (JavaScript's also stops at "\r", U+2028 and U+2029). */
export const PY_DOT = '[^\\n]';
/** Python's [^\S\n]: whitespace that isn't "\n". */
export const PY_SPACE_NOT_NEWLINE = `(?:(?!\\n)${PY_SPACE})`;

/** Python's sorted() of strings. */
export function pySorted(list: Iterable<string>): string[] {
  return [...list].sort(pyCompare);
}

/** Python's repr() of a string, as an f-string's !r writes it. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = cp(ch);
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (!pyIsPrintable(ch) || code === 0x7f) {
      out += code < 0x100 ? `\\x${code.toString(16).padStart(2, '0')}` : code < 0x10000 ? `\\u${code.toString(16).padStart(4, '0')}` : `\\U${code.toString(16).padStart(8, '0')}`;
    } else out += ch;
  }
  return out + quote;
}
