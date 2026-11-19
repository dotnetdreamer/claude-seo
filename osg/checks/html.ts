// A small, forgiving HTML reader for the checks in this folder.
//
// The Python scripts read pages with BeautifulSoup and lxml. This file builds
// the same kind of tree from the same markup, so a check written against it
// finds what the script finds, in a browser, in Node and in a desktop app
// alike, with no library. It is not a full HTML5 parser: it keeps the rules
// that change what a check sees (raw text in script and style, void elements,
// the implied head and body, a new <p> or <li> closing the open one) and
// skips the rest (the adoption agency, foster parenting in tables).

import { NAMED_REFERENCES } from './entities.ts';

export interface HtmlElement {
  readonly kind: 'element';
  /** Lower case, e.g. "div". The document itself is "#document". */
  readonly name: string;
  /** Attribute names in lower case. The first copy of a repeated attribute wins, as in browsers. */
  readonly attrs: Record<string, string>;
  readonly children: HtmlNode[];
  parent: HtmlElement | null;
}

export interface HtmlText {
  readonly kind: 'text';
  readonly value: string;
  /**
   * What kind of string this is, as BeautifulSoup sees it: text inside
   * script, style and template is left out of an element's text unless that
   * element is the script, style or template itself.
   */
  readonly flavour: 'text' | 'script' | 'style' | 'template';
  parent: HtmlElement | null;
}

export type HtmlNode = HtmlElement | HtmlText;

const VOID = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input',
  'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Elements whose content is text up to their own end tag. */
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']);
/** Like RAW_TEXT, but character references are decoded. */
const RCDATA = new Set(['title', 'textarea']);

const HEAD_ONLY = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'title', 'style', 'script', 'noscript', 'template']);

/** A start tag of one of these closes an open <p>. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre', 'section',
  'summary', 'table', 'ul', 'dd', 'dt', 'xmp',
]);

/** Where a search for an open element to close stops. */
const SCOPE_BOUNDARY = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'svg', 'math']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function element(name: string, attrs: Record<string, string>, parent: HtmlElement | null): HtmlElement {
  return { kind: 'element', name, attrs, children: [], parent };
}

function append(parent: HtmlElement, node: HtmlNode): void {
  node.parent = parent;
  parent.children.push(node);
}

// --- Character references -----------------------------------------------

// lxml 6 (libxml2 2.14) reads character references as HTML5 does, and so does
// this: the whole named table, the legacy names a page may write without a
// semicolon (&copy 2026), and numbers with or without one.

// What HTML5 puts in place of a numeric reference to a C1 control
// ("numeric character reference end state"). The five it leaves out stay.
const WINDOWS_1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** The longest name in the table, "CounterClockwiseContourIntegral;", without its semicolon. */
const LONGEST_NAME = 31;
const ALNUM = /[A-Za-z0-9]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;

function numberText(value: number): string {
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\u{FFFD}';
  return String.fromCodePoint(WINDOWS_1252[value] ?? value);
}

/**
 * The text a reference at `at` (an "&") stands for and where it ends, or
 * null when it stands for nothing and the "&" is plain text. In an attribute
 * value, a name without its semicolon followed by "=" or a letter or digit is
 * left as written, as HTML5 says.
 */
function readReference(text: string, at: number, inAttribute: boolean): { value: string; end: number } | null {
  let i = at + 1;
  if (text[i] === '#') {
    i++;
    const hex = text[i] === 'x' || text[i] === 'X';
    if (hex) i++;
    const digit = hex ? HEX : DIGIT;
    const first = i;
    let value = 0;
    while (i < text.length && digit.test(text[i])) {
      // Past the last code point the value stops growing: it is replaced anyway.
      if (value <= 0x10ffff) value = value * (hex ? 16 : 10) + parseInt(text[i], 16);
      i++;
    }
    if (i === first) return null;
    if (text[i] === ';') i++;
    return { value: numberText(value), end: i };
  }
  let run = i;
  while (run < text.length && run - i <= LONGEST_NAME && ALNUM.test(text[run])) run++;
  if (run === i) return null;
  if (text[run] === ';') {
    const named = NAMED_REFERENCES.get(text.slice(i, run + 1));
    if (named !== undefined) return { value: named, end: run + 1 };
  }
  for (let end = run; end > i; end--) {
    const named = NAMED_REFERENCES.get(text.slice(i, end));
    if (named === undefined) continue;
    if (inAttribute && end < text.length && (text[end] === '=' || ALNUM.test(text[end]))) return null;
    return { value: named, end };
  }
  return null;
}

/** Text with its character references read, as in page text; `inAttribute` for an attribute's value. */
export function decodeEntities(text: string, inAttribute = false): string {
  let at = text.indexOf('&');
  if (at < 0) return text;
  let out = '';
  let from = 0;
  while (at >= 0) {
    const reference = readReference(text, at, inAttribute);
    if (reference) {
      out += text.slice(from, at) + reference.value;
      from = reference.end;
      at = text.indexOf('&', reference.end);
    } else {
      at = text.indexOf('&', at + 1);
    }
  }
  return out + text.slice(from);
}

// --- Tokens -------------------------------------------------------------

type Token =
  | { type: 'start'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'text'; value: string; flavour: HtmlText['flavour'] };

const NAME_START = /[A-Za-z]/;
const SPACE = /[\t\n\f\r ]/;

function readAttributes(source: string, from: number): { attrs: Record<string, string>; end: number; selfClosing: boolean } {
  const attrs: Record<string, string> = {};
  let i = from;
  let selfClosing = false;
  const n = source.length;
  while (i < n) {
    while (i < n && SPACE.test(source[i])) i++;
    if (i >= n) break;
    const ch = source[i];
    if (ch === '>') {
      return { attrs, end: i + 1, selfClosing };
    }
    if (ch === '/') {
      selfClosing = source[i + 1] === '>';
      i++;
      continue;
    }
    selfClosing = false;
    let nameEnd = i + 1;
    while (nameEnd < n && !SPACE.test(source[nameEnd]) && source[nameEnd] !== '/' && source[nameEnd] !== '>' && source[nameEnd] !== '=') nameEnd++;
    const name = source.slice(i, nameEnd).toLowerCase();
    i = nameEnd;
    while (i < n && SPACE.test(source[i])) i++;
    let value = '';
    if (source[i] === '=') {
      i++;
      while (i < n && SPACE.test(source[i])) i++;
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1);
        const stop = close < 0 ? n : close;
        value = source.slice(i + 1, stop);
        i = close < 0 ? n : close + 1;
      } else {
        let valueEnd = i;
        while (valueEnd < n && !SPACE.test(source[valueEnd]) && source[valueEnd] !== '>') valueEnd++;
        value = source.slice(i, valueEnd);
        i = valueEnd;
      }
    }
    if (name && !(name in attrs)) attrs[name] = decodeEntities(value, true);
  }
  return { attrs, end: n, selfClosing };
}

function* tokens(source: string): Generator<Token> {
  const n = source.length;
  let i = 0;
  let textStart = 0;
  const flushText = function* (end: number): Generator<Token> {
    if (end > textStart) yield { type: 'text', value: decodeEntities(source.slice(textStart, end)), flavour: 'text' };
  };
  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;
    const next = source[lt + 1];
    if (next === '!') {
      yield* flushText(lt);
      if (source.startsWith('<!--', lt)) {
        const close = source.indexOf('-->', lt + 4);
        i = close < 0 ? n : close + 3;
      } else {
        const close = source.indexOf('>', lt + 2);
        i = close < 0 ? n : close + 1;
      }
      textStart = i;
      continue;
    }
    if (next === '?') {
      yield* flushText(lt);
      const close = source.indexOf('>', lt + 2);
      i = close < 0 ? n : close + 1;
      textStart = i;
      continue;
    }
    if (next === '/') {
      const nameStart = lt + 2;
      if (!NAME_START.test(source[nameStart] ?? '')) {
        i = lt + 1;
        continue;
      }
      yield* flushText(lt);
      let nameEnd = nameStart;
      while (nameEnd < n && !SPACE.test(source[nameEnd]) && source[nameEnd] !== '/' && source[nameEnd] !== '>') nameEnd++;
      const close = source.indexOf('>', nameEnd);
      yield { type: 'end', name: source.slice(nameStart, nameEnd).toLowerCase() };
      i = close < 0 ? n : close + 1;
      textStart = i;
      continue;
    }
    if (!NAME_START.test(next ?? '')) {
      i = lt + 1;
      continue;
    }
    yield* flushText(lt);
    let nameEnd = lt + 1;
    while (nameEnd < n && !SPACE.test(source[nameEnd]) && source[nameEnd] !== '/' && source[nameEnd] !== '>') nameEnd++;
    const name = source.slice(lt + 1, nameEnd).toLowerCase();
    const { attrs, end, selfClosing } = readAttributes(source, nameEnd);
    yield { type: 'start', name, attrs, selfClosing };
    i = end;
    textStart = i;
    if (RAW_TEXT.has(name) || RCDATA.has(name)) {
      const closer = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'i');
      closer.lastIndex = 0;
      const rest = source.slice(i);
      const match = closer.exec(rest);
      const stop = match ? i + match.index : n;
      if (stop > i) {
        const raw = source.slice(i, stop);
        const flavour = name === 'script' ? 'script' : name === 'style' ? 'style' : 'text';
        yield { type: 'text', value: RCDATA.has(name) ? decodeEntities(raw) : raw, flavour };
      }
      if (match) {
        const close = source.indexOf('>', stop + 2);
        yield { type: 'end', name };
        i = close < 0 ? n : close + 1;
      } else {
        i = n;
      }
      textStart = i;
    }
  }
  yield* flushText(n);
}

// --- Tree ---------------------------------------------------------------

/**
 * Read a page into a tree. The result is the document; its element children
 * hold the <html> element when the page has any content at all, with <head>
 * and <body> made up the way browsers make them when the page leaves them out.
 */
export function parseHtml(source: string): HtmlElement {
  const doc = element('#document', {}, null);
  let html: HtmlElement | null = null;
  let head: HtmlElement | null = null;
  let body: HtmlElement | null = null;
  let headClosed = false;
  const stack: HtmlElement[] = [];
  let templateDepth = 0;

  const ensureHtml = (attrs?: Record<string, string>): HtmlElement => {
    if (!html) {
      html = element('html', { ...(attrs ?? {}) }, null);
      append(doc, html);
      stack.length = 0;
      stack.push(html);
    } else if (attrs) {
      for (const [key, value] of Object.entries(attrs)) if (!(key in html.attrs)) html.attrs[key] = value;
    }
    return html;
  };
  const ensureHead = (attrs?: Record<string, string>): HtmlElement => {
    const root = ensureHtml();
    if (!head) {
      head = element('head', { ...(attrs ?? {}) }, null);
      append(root, head);
    }
    return head;
  };
  const ensureBody = (attrs?: Record<string, string>): HtmlElement => {
    const root = ensureHtml();
    if (!body) {
      body = element('body', { ...(attrs ?? {}) }, null);
      append(root, body);
      headClosed = true;
      stack.length = 0;
      stack.push(root, body);
    } else if (attrs) {
      for (const [key, value] of Object.entries(attrs)) if (!(key in body.attrs)) body.attrs[key] = value;
    }
    return body;
  };
  const current = (): HtmlElement => stack[stack.length - 1];
  const inForeign = (): boolean => stack.some((el) => el.name === 'svg' || el.name === 'math');

  /** Index of the nearest open element named `name`, searching down to a scope boundary. */
  const openInScope = (name: string, extraBoundary?: ReadonlySet<string>): number => {
    for (let index = stack.length - 1; index >= 0; index--) {
      const el = stack[index];
      if (el.name === name) return index;
      if (SCOPE_BOUNDARY.has(el.name) || extraBoundary?.has(el.name) || el.name === 'body') return -1;
    }
    return -1;
  };
  const popTo = (index: number): void => {
    while (stack.length > index) {
      const el = stack.pop();
      if (el?.name === 'template') templateDepth = Math.max(0, templateDepth - 1);
      if (el === head) headClosed = true;
    }
  };

  const closeImplied = (name: string): void => {
    if (CLOSES_P.has(name) || name === 'p') {
      const p = openInScope('p', new Set(['button']));
      if (p >= 0) popTo(p);
    }
    if (HEADINGS.has(name) && HEADINGS.has(current().name)) popTo(stack.length - 1);
    if (name === 'li') {
      const li = openInScope('li', new Set(['ol', 'ul']));
      if (li >= 0) popTo(li);
    }
    if (name === 'dd' || name === 'dt') {
      for (const other of ['dd', 'dt']) {
        const open = openInScope(other, new Set(['dl']));
        if (open >= 0) popTo(open);
      }
    }
    if (name === 'option' && current().name === 'option') popTo(stack.length - 1);
    if (name === 'optgroup') {
      if (current().name === 'option') popTo(stack.length - 1);
      if (current().name === 'optgroup') popTo(stack.length - 1);
    }
    if (name === 'tr') {
      const tr = openInScope('tr', new Set(['tbody', 'thead', 'tfoot']));
      if (tr >= 0) popTo(tr);
    }
    if (name === 'td' || name === 'th') {
      for (const cell of ['td', 'th']) {
        for (let index = stack.length - 1; index >= 0; index--) {
          const el = stack[index];
          if (el.name === cell) {
            popTo(index);
            break;
          }
          if (el.name === 'tr' || el.name === 'table') break;
        }
      }
    }
    if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      for (const section of ['thead', 'tbody', 'tfoot']) {
        const open = openInScope(section);
        if (open >= 0) popTo(open);
      }
    }
    if (name === 'a' || name === 'button' || name === 'select' || name === 'form' || name === 'nobr') {
      const open = openInScope(name);
      if (open >= 0) popTo(open);
    }
  };

  // HTML5's first step, which libxml2 takes for the whole page, script and
  // comments included: every CR or CR LF becomes LF, and NUL becomes U+FFFD.
  // A reference such as &#13; still stands for a CR: it is read later.
  for (const token of tokens(source.replace(/\r\n?/g, '\n').replace(/\0/g, '\u{FFFD}'))) {
    if (token.type === 'text') {
      const blank = !/[^\t\n\f\r ]/.test(token.value);
      if (!body && current() !== undefined && current() !== html && current() !== head && stack.length > 0 && current().name !== 'html') {
        // Inside an element of the head (a <title>, a <script>): keep the text there.
        append(current(), { kind: 'text', value: token.value, flavour: templateDepth > 0 ? 'template' : token.flavour, parent: null });
        continue;
      }
      if (!body) {
        if (blank) continue;
        ensureBody();
      }
      append(current(), { kind: 'text', value: token.value, flavour: templateDepth > 0 ? 'template' : token.flavour, parent: null });
      continue;
    }

    if (token.type === 'start') {
      const { name, attrs } = token;
      if (name === 'html') {
        ensureHtml(attrs);
        continue;
      }
      if (name === 'head') {
        if (!body && !head) {
          const h = ensureHead(attrs);
          stack.length = 0;
          stack.push(html as unknown as HtmlElement, h);
          headClosed = false;
        }
        continue;
      }
      if (name === 'body') {
        ensureBody(attrs);
        continue;
      }
      if (!body && HEAD_ONLY.has(name)) {
        const parentEl = current() && current() !== html && stack.length > 1 ? current() : ensureHead();
        const target = headClosed && parentEl === html ? ensureHead() : parentEl;
        const el = element(name, attrs, null);
        append(target, el);
        if (!VOID.has(name)) {
          if (target === head && current() !== head) stack.push(head as unknown as HtmlElement);
          stack.push(el);
          if (name === 'template') templateDepth++;
        }
        continue;
      }
      if (!body) {
        if (head && current() === head) popTo(stack.length - 1);
        ensureBody();
      }
      if (!inForeign()) closeImplied(name);
      const el = element(name, attrs, null);
      append(current(), el);
      const selfClosed = token.selfClosing && (inForeign() || name === 'svg' || name === 'math');
      if (!VOID.has(name) && !selfClosed) {
        stack.push(el);
        if (name === 'template') templateDepth++;
      }
      continue;
    }

    // End tag.
    const { name } = token;
    if (name === 'html' || name === 'body' || name === 'br') continue;
    if (name === 'head') {
      const index = stack.indexOf(head as unknown as HtmlElement);
      if (index >= 0) popTo(index);
      headClosed = true;
      continue;
    }
    for (let index = stack.length - 1; index > 0; index--) {
      const el = stack[index];
      if (el.name === name) {
        popTo(index);
        break;
      }
      if (el.name === 'body' || (SCOPE_BOUNDARY.has(el.name) && el.name !== name && name !== 'table')) break;
    }
    if (!body && head && stack[stack.length - 1] === html) headClosed = true;
  }
  return doc;
}

// --- Queries ------------------------------------------------------------

export function isElement(node: HtmlNode | null | undefined): node is HtmlElement {
  return node?.kind === 'element';
}

/** Every element under `root` in document order, `root` itself left out. */
export function* descendants(root: HtmlElement): Generator<HtmlElement> {
  const stack: HtmlNode[] = [...root.children].reverse();
  while (stack.length) {
    const node = stack.pop() as HtmlNode;
    if (node.kind !== 'element') continue;
    yield node;
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
}

export function findAll(root: HtmlElement, names: string | readonly string[]): HtmlElement[] {
  const wanted = typeof names === 'string' ? new Set([names]) : new Set(names);
  const out: HtmlElement[] = [];
  for (const el of descendants(root)) if (wanted.has(el.name)) out.push(el);
  return out;
}

export function find(root: HtmlElement, names: string | readonly string[]): HtmlElement | null {
  const wanted = typeof names === 'string' ? new Set([names]) : new Set(names);
  for (const el of descendants(root)) if (wanted.has(el.name)) return el;
  return null;
}

export function findBy(root: HtmlElement, test: (el: HtmlElement) => boolean): HtmlElement | null {
  for (const el of descendants(root)) if (test(el)) return el;
  return null;
}

/** The nearest ancestor named one of `names`, or null. */
export function closest(el: HtmlElement, names: string | readonly string[]): HtmlElement | null {
  const wanted = typeof names === 'string' ? new Set([names]) : new Set(names);
  let node = el.parent;
  while (node && node.name !== '#document') {
    if (wanted.has(node.name)) return node;
    node = node.parent;
  }
  return null;
}

export function hasAncestor(el: HtmlElement, ancestor: HtmlElement): boolean {
  let node = el.parent;
  while (node) {
    if (node === ancestor) return true;
    node = node.parent;
  }
  return false;
}

/** An attribute's value with the ends trimmed, or "" when the attribute is missing. */
export function attr(el: HtmlElement | null | undefined, name: string): string {
  const value = el?.attrs[name];
  return value === undefined ? '' : value.trim();
}

export function hasAttr(el: HtmlElement, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(el.attrs, name);
}

function textFlavourKept(node: HtmlText, root: HtmlElement): boolean {
  if (node.flavour === 'text') return true;
  // The element's own kind of string counts: a script's text is its JSON-LD.
  if (node.flavour === 'script') return root.name === 'script';
  if (node.flavour === 'style') return root.name === 'style';
  return root.name === 'template' || closest(root, 'template') !== null;
}

/**
 * The strings under `root`, as BeautifulSoup's `get_text(" ", strip=True)`
 * gives them: each string trimmed, empty ones left out, joined by a space.
 */
export function textParts(root: HtmlElement): string[] {
  const parts: string[] = [];
  const stack: HtmlNode[] = [...root.children].reverse();
  while (stack.length) {
    const node = stack.pop() as HtmlNode;
    if (node.kind === 'text') {
      if (!textFlavourKept(node, root)) continue;
      const trimmed = node.value.trim();
      if (trimmed) parts.push(trimmed);
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return parts;
}

/** `root`'s text in one line: the strings joined by a space, every run of space made one. */
export function textOf(root: HtmlElement): string {
  return textParts(root).join(' ').replace(/\s+/g, ' ').trim();
}

/** Every string under `root`, untrimmed and with nothing left out (a script's JSON, for one). */
export function rawText(root: HtmlElement): string {
  let out = '';
  const stack: HtmlNode[] = [...root.children].reverse();
  while (stack.length) {
    const node = stack.pop() as HtmlNode;
    if (node.kind === 'text') out += node.value;
    else for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return out;
}

/** The element children of `el`. */
export function childElements(el: HtmlElement): HtmlElement[] {
  return el.children.filter(isElement);
}

/** A copy of the tree with the elements `drop` says yes to taken out, for text that leaves parts out. */
export function without(root: HtmlElement, drop: (el: HtmlElement) => boolean): HtmlElement {
  const copy = (el: HtmlElement, parent: HtmlElement | null): HtmlElement => {
    const out = element(el.name, el.attrs, parent);
    for (const child of el.children) {
      if (child.kind === 'text') out.children.push({ ...child, parent: out });
      else if (!drop(child)) out.children.push(copy(child, out));
    }
    return out;
  };
  return copy(root, null);
}
