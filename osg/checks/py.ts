// The few Python behaviours the checks depend on, so the TypeScript versions
// give the scripts' numbers and words to the last digit.

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

/** Python's repr() of a string, as an f-string's !r writes it. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return out + quote;
}

/** Python's \w in a str pattern: letters, numbers and the underscore. */
export const WORD_CHAR = '[\\p{L}\\p{N}_]';
