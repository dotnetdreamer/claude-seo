// The tree html.ts builds against the one BeautifulSoup builds with lxml, on
// thousands of made-up documents: tags in and out of place, unclosed and
// stray ones, text with the characters Python and JavaScript read
// differently, entities, comments, doctypes and byte order marks. Every
// check reads this tree, so an element, an attribute or a string that lands
// somewhere else (or two strings where lxml has one, which get_text(" ")
// joins with a space) fails here first.
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/trees.test.ts
//   FUZZ_TREES=20000 ... for a longer run

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isListAttribute, parseHtml, type HtmlElement } from '../checks/html.ts';
import { pySplit } from '../checks/py.ts';
import { callPython } from './python.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const TREES = Number(process.env.FUZZ_TREES ?? 4000);

function harness(name: string, payload: unknown): any {
  const result = callPython([path.join(here, 'harness.py'), name], JSON.stringify(payload), repo);
  if (result.status !== 0) throw new Error(`harness ${name} failed (${result.status}):\n${result.stderr.slice(-4000)}`);
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

/** BeautifulSoup's string kinds, as html.ts names them; comments and declarations are not kept there. */
const KINDS: Record<string, string | null> = {
  NavigableString: 'text',
  RubyTextString: 'rt',
  RubyParenthesisString: 'rp',
  Script: 'script',
  Stylesheet: 'style',
  TemplateString: 'template',
  Comment: null,
  Doctype: null,
  Declaration: null,
  CData: null,
  ProcessingInstruction: null,
  XMLProcessingInstruction: null,
};

function fromPython(nodes: any[]): any[] {
  const out: any[] = [];
  for (const node of nodes) {
    if (node.length === 2) {
      const kind = KINDS[node[0]];
      if (kind === undefined) throw new Error(`unknown string kind ${node[0]}`);
      if (kind !== null) out.push([kind, node[1]]);
    } else out.push([node[0], node[1], fromPython(node[2])]);
  }
  return out;
}

/** The port's tree as the harness writes BeautifulSoup's: a list attribute's words joined by one space. */
function fromPort(el: HtmlElement): any[] {
  return el.children.map((child) => {
    if (child.kind === 'text') return [child.flavour, child.value];
    const attrs = Object.fromEntries(Object.entries(child.attrs).map(([name, value]) => [name, isListAttribute(child, name) ? pySplit(value).join(' ') : value]));
    return [child.name, attrs, fromPort(child)];
  });
}

test('trees: html.ts builds the tree lxml builds', () => {
  const random = seeded(99);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const TEXT = ['a', 'Pebble notes', ' ', '\n', '\t', '\u{A0}', '\u{FEFF}', '\u{1C}', '\u{85}', '&amp;', '&nbsp;', '&#133;', '&lt;b&gt;', 'caf\u{E9}', '\u{1F600}', 'x<y', 'a > b', '&', '\r\n', '\r'];
  const OPEN = ['<p>', '<div>', '<span>', '<a href="/x">', '<b>', '<i>', '<h1>', '<h2>', '<ul>', '<li>', '<table>', '<tr>', '<td>', '<form>', '<button>', '<select>', '<option>', '<article>', '<main>', '<header>', '<footer>', '<nav>', '<section>', '<aside>', '<template>', '<svg>', '<noscript>', '<iframe>', '<center>', '<font>', '<dl>', '<dt>', '<dd>', '<pre>', '<textarea>', '<label>', '<em>', '<strong>', '<small>', '<code>'];
  const CLOSE = OPEN.map((tag) => `</${tag.slice(1).split(/[ >]/)[0]}>`);
  const VOID = ['<br>', '<img src="a.png" alt="x">', '<hr>', '<input value="v">', '<meta name="a" content="b">', '<link rel="x" href="y">', '<wbr>', '<img src=b.png>'];
  const HEAD = ['<title>T &amp; t</title>', '<meta charset="utf-8">', '<link rel="canonical" href="/">', '<style>p{}</style>', '<script>var a = 1 < 2;</script>', '<script type="application/ld+json">{"a":1}</script>', '<base href="/b/">', '<noscript>n</noscript>', '<template><p>t</p></template>'];
  const OTHER = [
    '<!-- c -->', '<!---->', '<!-->', '<!--->', '<!-- a --!> b', '<!doctype html>', '<![CDATA[x]]>', '<?php x ?>', '</p>', '</div>', '</span>', '</body>', '</html>', '</head>', '</>', '</ x>', '</3>',
    '<html lang="en">', '<head>', '<body class="b">', '<frameset>', '<frame src="f">', '<div/>', '<span/>', '<p/>', '<br/>', '<script/>', '<title/>', '<a href="x"/>', '<body/>', '<html/>',
    '<wbr>', '<embed src="e">', '<source src="s">', '<plaintext>', '<xmp>a<b>c</xmp>', '<rt>r</rt>', '<ruby>a<rt>b</rt><rp>(</rp></ruby>', '<textarea> t &amp; </textarea>', '<pre>\n  p</pre>',
    '<script><!-- <script> </script> --></script>', '<div a="1" A="2" b=\'3\' c=4 d>', '<div constructor="x" __proto__="y">', '<p class="a\u{1C}b">', '<DIV CLASS="X">', '<a href=x/>', '< p>', '<3', 'a<',
  ];
  const documents: string[] = [];
  for (let n = 0; n < TREES; n++) {
    const parts: string[] = [];
    if (random() < 0.15) parts.push(pick(['\u{FEFF}', '\u{FEFF}\u{FEFF}', ' \u{FEFF}', '\n', '\u{FEFF}\n']));
    if (random() < 0.6) parts.push(pick(['<!doctype html>', '<!DOCTYPE html>', '<!doctype html >', '']), random() < 0.5 ? '\n' : '');
    const structured = random() < 0.6;
    if (structured) {
      parts.push(pick(['<html>', '<html lang="en">', '']), pick(['<head>', '']));
      for (let i = Math.floor(random() * 4); i > 0; i--) parts.push(pick(HEAD), random() < 0.3 ? '\n' : '');
      parts.push(pick(['</head>', '']), pick(['<body>', '']));
    }
    const length = 1 + Math.floor(random() * 14);
    for (let i = 0; i < length; i++) {
      const roll = random();
      parts.push(roll < 0.35 ? pick(TEXT) : roll < 0.6 ? pick(OPEN) : roll < 0.75 ? pick(CLOSE) : roll < 0.85 ? pick(VOID) : roll < 0.93 ? pick(HEAD) : pick(OTHER));
    }
    if (structured && random() < 0.7) parts.push(pick(['</body></html>', '</body>', '</html>']));
    documents.push(parts.join(''));
  }
  if (process.env.TREES_DUMP) fs.writeFileSync(process.env.TREES_DUMP, JSON.stringify({ documents }));
  const py: any[] = harness('trees', { documents });
  const differences: string[] = [];
  documents.forEach((html, index) => {
    const a = JSON.stringify(fromPort(parseHtml(html)));
    const b = JSON.stringify(fromPython(py[index]));
    if (a !== b) differences.push(`${JSON.stringify(html)}\n    port:   ${a.slice(0, 600)}\n    python: ${b.slice(0, 600)}`);
  });
  assert.deepEqual(differences.slice(0, 6), [], `${differences.length} of ${documents.length} trees differ`);
});
