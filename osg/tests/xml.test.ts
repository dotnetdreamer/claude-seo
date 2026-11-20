// xml.ts against lxml (libxml2 2.14), parsed the way claude-seo's sitemap
// check parses (strict, no DTD), on documents made up from the whole
// grammar: names of every kind, namespace declarations with good and bad
// URIs, attributes with every reference, text with every character that
// matters, CDATA, comments, processing instructions, declarations, depth.
// Every document is compared whole: refused or not, and if not, the tree
// node by node (tag, attributes in order, text, children).
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/xml.test.ts
//   FUZZ_XML=40000 for more (default 12000).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { XmlUnsupported, parseXml, type XmlNode } from '../checks/xml.ts';
import { seeded } from './sitemapCases.ts';
import { callPython } from './python.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

function harness(name: string, payload: unknown): any {
  const result = callPython([path.join(here, 'harness.py'), name], JSON.stringify(payload), repo);
  if (result.status !== 0) throw new Error(`harness ${name} failed (${result.status}):\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];

const NAMES = ['a', 'url', 'loc', 'x-y', 'x.y', 'x1', '_a', '\u{e9}t\u{e9}', '\u{416}', '\u{4e2d}', '\u{10400}', 'a\u{301}', 'a\u{b7}b', 'p:a', 'q:b', 'xml:a', ':a', 'a:', 'a:b:c', '1a', '-a', '\u{300}a', 'A', 'URL', 'a\u{203f}'];
const URIS = [
  'http://www.sitemaps.org/schemas/sitemap/0.9', 'urn:x', 'mailto:a@b', 'u', 'a/b', '#f', '?q', '//h/p', 'http://h:80/p', 'http://h:/p', 'http://h:x/p', 'http://[::1]/p', 'http://[x/p', 'http://u@h/p',
  'a b', 'a<b', 'a>b', 'a"b', 'a{b', 'a|b', 'a\\b', 'a^b', 'a`b', '\u{e9}', '%41', '%zz', 'a%4', '', 'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/', 'x:y:z', 'ftp://h/a;b?c#d[e]', 'http://h/p#a#b',
];
const TEXT = ['x', ' ', '\n', '\r\n', '\r', '\t', 'caf\u{e9}', '\u{1f600}', '&amp;', '&lt;', '&gt;', '&apos;', '&quot;', '&#65;', '&#x41;', '&#x10FFFF;', '&#0;', '&#xFFFE;', '&#xD800;', '&bad;', '&', '&#;', ']]', ']]>', '>', '\u{1}', '\u{c}', '\u{fffe}', '\u{85}', '\u{2028}', 'a]b'];

/** The pieces a document is made of: everything, or (for half the documents) only what's valid. */
let pool = { names: NAMES, uris: URIS, text: TEXT, broken: true };
const CLEAN = {
  names: NAMES.filter((name) => !/^(:|1|-|\u{300})|:$|:.*:|^xml:/u.test(name)),
  uris: ['http://www.sitemaps.org/schemas/sitemap/0.9', 'urn:x', 'http://h:80/p', 'http://[::1]/p', 'ftp://h/a;b?c#d[e]', 'u', '#f', '//h/p'],
  text: TEXT.filter((piece) => !/^(&#0;|&#xFFFE;|&#xD800;|&bad;|&|&#;|\]\]>)$/u.test(piece) && !/[\u{1}\u{c}\u{fffe}]/u.test(piece)),
  broken: false,
};

function attribute(random: () => number): string {
  const roll = random();
  if (roll < 0.2) return ` xmlns="${pick(random, pool.uris)}"`;
  if (roll < 0.4) return ` xmlns:${pick(random, pool.broken ? ['p', 'q', 'xml', 'xmlns', 'p'] : ['p', 'q'])}="${pick(random, pool.uris)}"`;
  // xml:space has two values libxml2 doesn't warn about.
  if (roll < 0.45) return ` xml:space="${pick(random, ['default', 'preserve', 'x', '', 'Default'])}"`;
  const quote = random() < 0.8 ? '"' : "'";
  const value = Array.from({ length: Math.floor(random() * 4) }, () => pick(random, [...pool.text, quote === '"' ? "'" : '"', ...(pool.broken ? ['<'] : [])])).join('');
  return `${pick(random, pool.broken ? [' ', ' ', '\n', '\t', ''] : [' ', '\n', '\t'])}${pick(random, pool.names)}${pick(random, ['=', ' = ', '='])}${quote}${value}${quote}`;
}

function element(random: () => number, depth: number): string {
  const name = pick(random, pool.names);
  const attrs = Array.from({ length: Math.floor(random() * 3) }, () => attribute(random)).join('');
  if (depth > 3 || random() < 0.25) return `<${name}${attrs}${pick(random, ['/>', ' />', '/>'])}`;
  const parts: string[] = [];
  for (let n = Math.floor(random() * 4); n > 0; n--) {
    const roll = random();
    if (roll < 0.35) parts.push(element(random, depth + 1));
    else if (roll < 0.7) parts.push(Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(random, pool.text)).join(''));
    else if (roll < 0.8) parts.push(`<!--${pick(random, ['', ' c ', ' a -- b ', '-', ' x -'])}-->`);
    else if (roll < 0.9) parts.push(`<?${pick(random, ['p', 'xml', 'XmL', 'a:b', 'xmlfoo', 'p'])}${pick(random, ['', ' data', '  d?', 'x'])}?>`);
    else parts.push(`<![CDATA[${pick(random, ['', 'x', ']]', '&amp;', '<a>', '\u{1}'])}]]>`);
  }
  const close = !pool.broken || random() < 0.95 ? name : pick(random, pool.names);
  return `<${name}${attrs}>${parts.join('')}</${close}${pick(random, ['', ' ', '\n'])}>`;
}

function document(random: () => number): Uint8Array {
  pool = random() < 0.5 ? CLEAN : { names: NAMES, uris: URIS, text: TEXT, broken: true };
  const prolog = pick(random, ['', '', '<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-8"?>', "<?xml version='1.1' standalone='yes'?>", '<?xml version="1.0" encoding="ISO-8859-1"?>', ' ', '\n<!-- c -->', '<?p x?>\n', 'x', '<?xml version="1.0"?>\n<?xml version="1.0"?>']);
  const epilog = pick(random, ['', '', '\n', '<!-- e -->', '<?p?>', ' x', '<a/>', '&amp;']);
  let deep = '';
  if (random() < 0.03) {
    const levels = 250 + Math.floor(random() * 10);
    deep = `${'<d>'.repeat(levels)}${'</d>'.repeat(levels)}`;
  }
  const root = deep ? `<r>${deep}</r>` : element(random, 0);
  let bytes = new TextEncoder().encode(prolog + root + epilog);
  if (random() < 0.05) bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]);
  if (random() < 0.04) {
    const at = Math.floor(random() * bytes.length);
    bytes = Uint8Array.from([...bytes.subarray(0, at), pick(random, [0xff, 0xc0, 0x80, 0xed, 0xf8]), ...bytes.subarray(at)]);
  }
  return bytes;
}

type Tree = [string] | [string, Array<[string, string]>, string | null, Tree[]];

function tree(node: XmlNode): Tree {
  if (node.type !== 'element') return [node.type === 'comment' ? '#comment' : '#pi'];
  return [node.tag, [...node.attributes], node.text, node.children.map(tree)];
}

test('the XML parser against lxml, on documents made from the whole grammar, tree by tree', () => {
  const random = seeded(1998);
  const count = Number(process.env.FUZZ_XML ?? 12000);
  const written = [
    // libxml2 reads UTF-8 as it goes: a bad byte after the root, once a namespace error has stopped it looking there, is never read.
    '<p:a><b xmlns="r"/></p:a>\u{ff}',
    '<a/>\u{ff}',
    '<a>\u{ff}</a>',
    '<p:a><b xmlns="r"/>\u{ff}</p:a>',
  ].map((doc) => Uint8Array.from(Array.from(doc, (ch) => ch.charCodeAt(0))));
  const docs = [...written, ...Array.from({ length: count }, () => document(random))];
  const py: Array<Tree | null> = harness('xml-trees', { docs: docs.map((doc) => Buffer.from(doc).toString('base64')) });
  const differences: string[] = [];
  let parsed = 0;
  let unread = 0;
  const why: Record<string, number> = {};
  docs.forEach((doc, index) => {
    let mine: Tree | null;
    try {
      const root = parseXml(doc);
      mine = root ? tree(root) : null;
    } catch (error) {
      if (!(error instanceof XmlUnsupported)) throw error;
      unread++;
      why[error.message] = (why[error.message] ?? 0) + 1;
      // What the port leaves unread, lxml must read: otherwise the port could have said so.
      if (py[index] === null) differences.push(`${JSON.stringify(Buffer.from(doc).toString('latin1'))}\n    port   unread (${error.message})\n    lxml   refused`);
      return;
    }
    if (mine) parsed++;
    if (JSON.stringify(mine) !== JSON.stringify(py[index])) {
      differences.push(`${JSON.stringify(Buffer.from(doc).toString('latin1'))}\n    port   ${JSON.stringify(mine)}\n    lxml   ${JSON.stringify(py[index])}`);
    }
  });
  if (process.env.XML_STATS) console.log(JSON.stringify({ parsed, unread, why }));
  assert.deepEqual(differences.slice(0, 8), [], `${differences.length} of ${docs.length} documents differ`);
  assert.ok(unread < count * 0.02, `${unread} documents left unread: ${JSON.stringify(why)}`);
  // Enough of both kinds that agreeing says something.
  assert.ok(parsed > count * 0.08, `only ${parsed} documents parsed`);
  assert.ok(count - parsed - unread > count * 0.3, `only ${count - parsed - unread} refused`);
});
