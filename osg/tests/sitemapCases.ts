// The sitemap test's cases (sitemaps.test.ts): written out, and made up at
// random from a seed, so the same ones can be read again outside the test.

import zlib from 'node:zlib';

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Case {
  name: string;
  body: Uint8Array;
  type: string;
  url: string;
}

export const utf8 = (text: string) => new TextEncoder().encode(text);
const bytes = (...parts: Array<Uint8Array | number[] | string>) => {
  const list = parts.map((part) => (typeof part === 'string' ? utf8(part) : part instanceof Uint8Array ? part : new Uint8Array(part)));
  const out = new Uint8Array(list.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of list) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** One gzip member, its header written out so every flag can be tried. */
export function member(data: Uint8Array, options: { level?: number; strategy?: number; flags?: number; extra?: number[]; name?: string; comment?: string; method?: number; crc?: number; size?: number } = {}): Uint8Array {
  const flags = options.flags ?? 0;
  const header = [0x1f, 0x8b, options.method ?? 8, flags, 0, 0, 0, 0, 0, 0xff];
  if (flags & 4) header.push((options.extra ?? []).length & 0xff, (options.extra ?? []).length >> 8, ...(options.extra ?? []));
  if (flags & 8) header.push(...utf8(options.name ?? 'sitemap.xml'), 0);
  if (flags & 16) header.push(...utf8(options.comment ?? 'made by a test'), 0);
  if (flags & 2) header.push(0x12, 0x34);
  const deflated = zlib.deflateRawSync(data, { level: options.level ?? 6, strategy: options.strategy ?? zlib.constants.Z_DEFAULT_STRATEGY });
  const crc = options.crc ?? zlib.crc32(data);
  const size = options.size ?? data.length;
  const trailer = [crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24, size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, size >>> 24];
  return bytes(header, deflated, trailer);
}

const SM = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const URLSET = `<urlset xmlns="${SM}"><url><loc>https://a.example/x</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://a.example/y</loc></url></urlset>`;
export const XML = 'application/xml';
export const AT = 'https://a.example/sitemap.xml';

export function writtenCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, body: Uint8Array | string, type = XML, url = AT) => cases.push({ name, body: typeof body === 'string' ? utf8(body) : body, type, url });
  // Namespaces: GPT's case (a declared prefix) is a sitemap; an undeclared one isn't XML.
  add('default namespace', URLSET);
  add('declared prefix', `<sm:urlset xmlns:sm="${SM}"><sm:url><sm:loc>https://a.example/x</sm:loc></sm:url></sm:urlset>`);
  add('prefix on the root only', `<sm:urlset xmlns:sm="${SM}" xmlns="${SM}"><url><loc>https://a.example/x</loc></url></sm:urlset>`);
  add('undeclared prefix', '<sm:urlset><sm:url><sm:loc>https://a.example/x</sm:loc></sm:url></sm:urlset>');
  add('no namespace', '<urlset><url><loc>https://a.example/x</loc></url></urlset>');
  add('another namespace', '<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.example/x</loc></url></urlset>');
  add('upper case', '<URLSET><URL><LOC>https://a.example/x</LOC></URL></URLSET>');
  add('image:loc before loc', `<urlset xmlns="${SM}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><image:loc>https://a.example/i.png</image:loc><loc>https://a.example/x</loc></url></urlset>`);
  add('image inside image', `<urlset xmlns="${SM}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://a.example/x</loc><image:image><image:loc>https://a.example/i.png</image:loc></image:image></url></urlset>`);
  add('xhtml alternates', `<urlset xmlns="${SM}" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://a.example/x</loc><xhtml:link rel="alternate" hreflang="de" href="https://a.example/de/x"/></url></urlset>`);
  add('index', `<sitemapindex xmlns="${SM}"><sitemap><loc>https://a.example/s1.xml</loc></sitemap><sitemap><loc> https://a.example/s2.xml </loc><lastmod>2026</lastmod></sitemap></sitemapindex>`);
  add('loc after a comment', '<urlset><url><loc><!-- c -->https://a.example/x</loc></url></urlset>');
  add('loc in CDATA', '<urlset><url><loc><![CDATA[https://a.example/x?a=1&b=2]]></loc></url></urlset>');
  add('loc with references', '<urlset><url><loc>https://a.example/x?a=1&amp;b=2&#38;c&#x26;d</loc></url></urlset>');
  add('two locs', '<urlset><url><loc>https://a.example/1</loc><loc>https://a.example/2</loc></url></urlset>');
  add('empty loc then loc', '<urlset><url><loc>  </loc><loc>https://a.example/2</loc></url></urlset>');
  add('CR LF in loc', '<urlset><url><loc>\r\nhttps://a.example/x\r</loc></url></urlset>');
  add('BOM, spaces, root', bytes([0xef, 0xbb, 0xbf], ' \n<urlset/>'));
  add('BOM and declaration', bytes([0xef, 0xbb, 0xbf], '<?xml version="1.0"?><urlset/>'));
  add('spaces before declaration', '  <?xml version="1.0"?><urlset/>');
  add('version 1.1', '<?xml version="1.1"?><urlset/>');
  add('version 1.', '<?xml version="1."?><urlset/>');
  add('version 2.0', '<?xml version="2.0"?><urlset/>');
  add('version 10.0', '<?xml version="10.0"?><urlset/>');
  add('encoding latin1', bytes('<?xml version="1.0" encoding="ISO-8859-1"?><urlset><url><loc>https://a.example/', [0xe9], '</loc></url></urlset>'));
  add('encoding ascii with a high byte', bytes('<?xml version="1.0" encoding="US-ASCII"?><urlset><url><loc>https://a.example/', [0xe9], '</loc></url></urlset>'));
  add('encoding bad name', '<?xml version="1.0" encoding="1x"?><urlset/>');
  add('standalone', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><urlset/>');
  add('standalone maybe', '<?xml version="1.0" standalone="maybe"?><urlset/>');
  add('no blank before encoding', '<?xml version="1.0"encoding="UTF-8"?><urlset/>');
  add('declaration not closed', '<?xml version="1.0" ><urlset/>');
  add('declaration twice', '<?xml version="1.0"?><?xml version="1.0"?><urlset/>');
  add('PI named xml later', "<urlset><?xml version='1.0'?></urlset>");
  add('PI named XmL', '<urlset><?XmL x?></urlset>');
  add('PI with a colon', '<urlset><?a:b x?></urlset>');
  add('PI without a space', '<urlset><?a?></urlset>');
  add('PI before root', '<?style x?><urlset/>');
  add('double hyphen in a comment', '<urlset><!-- a -- b --></urlset>');
  add('comment ending ---', '<urlset><!-- a ---></urlset>');
  add('comment <!-->', '<urlset><!-->x--></urlset>');
  add('text after root', '<urlset/>x');
  add('comment after root', '<urlset/><!-- c -->\n');
  add('two roots', '<urlset/><urlset/>');
  add('name starting with a digit', '<urlset><1a/></urlset>');
  add('name starting with a combining mark', '<urlset><\u{300}a/></urlset>');
  add('name with a middle dot', '<urlset><a\u{b7}b/></urlset>');
  add('duplicate attribute', '<urlset a="1" a="2"/>');
  add('duplicate namespaced attribute', '<urlset xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/>');
  add('empty prefix namespace', '<urlset xmlns:p=""/>');
  add('xml prefix to another URI', '<urlset xmlns:xml="http://other"/>');
  add('xmlns prefix declared', '<urlset xmlns:xmlns="u"/>');
  add('undeclared attribute prefix', '<urlset p:a="1"/>');
  add('xml:lang without a declaration', '<urlset xml:lang="de"/>');
  add('multiple colons', '<a:b:c xmlns:a="u"/>');
  add('attributes without a space', '<urlset a="1"b="2"/>');
  add('control character', '<urlset>\u{1}</urlset>');
  add('form feed', '<urlset>\u{c}</urlset>');
  add('U+FFFE', '<urlset>\u{fffe}</urlset>');
  add(']]> in text', '<urlset>a]]>b</urlset>');
  add('< in an attribute', '<urlset a="<"/>');
  add('unquoted attribute', '<urlset a=1/>');
  add('invalid UTF-8', bytes('<urlset>', [0xff], '</urlset>'));
  add('overlong UTF-8', bytes('<urlset>', [0xc0, 0x80], '</urlset>'));
  add('UTF-8 surrogate', bytes('<urlset>', [0xed, 0xa0, 0x80], '</urlset>'));
  add('character reference U+FFFE', '<urlset>&#xFFFE;</urlset>');
  add('character reference 0', '<urlset>&#0;</urlset>');
  add('character reference &#X41;', '<urlset>&#X41;</urlset>');
  add('long hex reference', '<urlset>&#x000000000a;&#x0000000000a;</urlset>');
  add('undefined entity', '<urlset><url><loc>https://a.example/x&nbsp;</loc></url></urlset>');
  add('entity without ;', '<urlset>&amp</urlset>');
  add('bare &', '<urlset>a & b</urlset>');
  add('CDATA in the prolog', '<![CDATA[x]]><urlset/>');
  add('mismatched tags', '<urlset><url></urlset></url>');
  add('unclosed root', '<urlset><url>');
  add('end tag with a space', '<urlset></urlset >');
  add('end tag starting with a space', '<urlset></ urlset>');
  add('DOCTYPE', '<!DOCTYPE urlset><urlset/>');
  add('doctype in a comment', '<urlset><!-- <!doctype x> --></urlset>');
  add('HTML page', '<!doctype html><html><body>Not found</body></html>', 'text/html');
  add('XHTML root', '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>');
  add('empty', '');
  add('spaces only', ' \t\r\n\u{b}\u{c}');
  add('JSON', '{"urls": []}', 'application/json');
  for (const depth of [255, 256, 257]) add(`depth ${depth}`, `<urlset>${'<a>'.repeat(depth - 1)}${'</a>'.repeat(depth - 1)}</urlset>`);
  // Feeds.
  add('RSS', '<rss version="2.0"><channel><item><link> https://a.example/p </link></item><item><title>x</title></item></channel></rss>');
  add('RSS item with two links', '<rss version="2.0"><channel><item><link>https://a.example/first</link><link>https://a.example/second</link></item></channel></rss>');
  add('RSS item nested in another element', '<rss version="2.0"><channel><x><item><link>https://a.example/deep</link></item></x></channel></rss>');
  add('Atom', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="p"/><updated>2026-01-01</updated></entry><entry><link rel="self" href="s"/><link href="https://a.example/q"/></entry></feed>');
  add('Atom rel with spaces', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel=" alternate" href="https://a.example/x"/></entry></feed>');
  add('Atom without href', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link/><link href="https://a.example/x"/></entry></feed>');
  add('Atom bad IPv6 href', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="https://[nope/x"/></entry></feed>');
  add('Atom xml:base (not followed here)', '<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://a.example/blog/"><entry xml:base="2024/"><link href="p"/></entry></feed>');
  add('feed in .gz', member(utf8('<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="p"/></entry></feed>')), 'application/gzip', 'https://a.example/feed.xml.gz');
  // gzip in every shape.
  const doc = utf8(URLSET);
  add('gzip', member(doc), 'application/gzip', 'https://a.example/sitemap.xml.gz');
  add('gzip stored', member(doc, { level: 0 }));
  add('gzip fixed codes', member(doc, { strategy: zlib.constants.Z_FIXED }));
  add('gzip Huffman only', member(doc, { level: 9, strategy: zlib.constants.Z_HUFFMAN_ONLY }));
  add('gzip with every header field', member(doc, { flags: 2 | 4 | 8 | 16, extra: [1, 2, 3] }));
  add('gzip name to the end', bytes([0x1f, 0x8b, 8, 8, 0, 0, 0, 0, 0, 0xff], 'sitemap.xml'));
  add('gzip two members', bytes(member(doc.subarray(0, 40)), member(doc.subarray(40))));
  add('gzip padded', bytes(member(doc), [0, 0, 0, 0]));
  add('gzip padded between members', bytes(member(doc.subarray(0, 40)), [0, 0], member(doc.subarray(40))));
  add('gzip and junk after', bytes(member(doc), 'junk'));
  add('gzip and one byte after', bytes(member(doc), [0x1f]));
  add('gzip bad CRC', member(doc, { crc: 1 }));
  add('gzip bad length', member(doc, { size: 3 }));
  add('gzip method 7', member(doc, { method: 7 }));
  add('gzip cut short', member(doc).subarray(0, 30));
  add('gzip trailer cut', member(doc).subarray(0, member(doc).length - 3));
  add('gzip header only', bytes([0x1f, 0x8b]));
  add('gzip of nothing', member(new Uint8Array(0)));
  add('gzip of spaces', member(utf8('    ')));
  add('gzip of a text sitemap', member(utf8('https://a.example/x\nhttps://a.example/y\n')), 'application/gzip', 'https://a.example/sitemap.txt.gz');
  add('gzip of a text sitemap, upper case name', member(utf8('https://a.example/x\n')), 'application/gzip', 'https://a.example/SITEMAP.TXT.GZ');
  // Text sitemaps.
  const text = (name: string, lines: string | Uint8Array, type = 'text/plain', url = 'https://a.example/sitemap.txt') => add(name, lines, type, url);
  text('text sitemap', 'https://a.example/x\nhttps://a.example/y\n');
  text('text sitemap by name', 'https://a.example/x\r\nhttp://a.example/y', 'application/octet-stream');
  text('text sitemap by type', 'https://a.example/x', 'text/plain; charset=utf-8', 'https://a.example/list');
  text('text with an ftp line', 'https://a.example/x\nftp://a.example/y');
  text('text with a user', 'https://me@a.example/x');
  text('text with a port', 'https://a.example:8080/x\nhttps://a.example:/y');
  text('text with a bad port', 'https://a.example:80x/x');
  text('text with a big port', 'https://a.example:65536/x');
  text('text with IPv6', 'https://[2001:db8::1]/x\nhttps://[::ffff:1.2.3.4]:8443/y\nhttps://[fe80::1%25en0]/z');
  text('text with a bad IPv6', 'https://[2001:db8::1/x');
  text('text with IPv4 in brackets', 'https://[1.2.3.4]/x');
  text('text with IPvFuture', 'https://[v1.x]/x');
  text('text with a backslash', 'https://a.example\\x');
  text('text with a space', 'https://a.example/a b');
  text('text with NFKC', 'https://a\u{2100}b.example/x');
  text('text with a fullwidth host', 'https://\u{ff41}.example/x');
  text('text with a control first', '\u{1}https://a.example/x');
  text('text with a BOM', bytes([0xef, 0xbb, 0xbf], 'https://a.example/x'));
  text('text with U+2028', 'https://a.example/x\u{2028}https://a.example/y');
  text('text with blank lines', '\n\n https://a.example/x \n\n');
  text('text with bad UTF-8', bytes('https://a.example/', [0xff], 'x'));
  text('text without a host', 'https:///x');
  text('text, one line not a URL', 'https://a.example/x\nnot a url');
  text('not text, no type and no .txt', 'https://a.example/x', '', 'https://a.example/list');
  return cases;
}

// --- made-up documents ------------------------------------------------------

const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];

function madeUp(random: () => number, n: number): Case {
  const chance = (p: number) => random() < p;
  const kind = pick(random, ['urlset', 'urlset', 'sitemapindex', 'rss', 'feed', 'text', 'other'] as const);
  const url = pick(random, ['https://a.example/sitemap.xml', 'https://a.example/sitemap.xml.gz', 'https://a.example/sitemap.txt', 'https://a.example/s?x=1', 'https://a.example/SITEMAP.TXT']);
  const type = pick(random, ['application/xml', 'text/xml', 'text/plain', 'text/html', '', 'application/gzip', 'TEXT/PLAIN; charset=UTF-8']);
  const loc = () =>
    pick(random, [
      'https://a.example/p', ` https://a.example/q${Math.floor(random() * 9)} `, 'https://a.example/a?x=1&amp;y=2', '<![CDATA[https://a.example/c]]>', '&#104;ttps://a.example/r',
      'https://a.example/\u{e9}', '', '  ', '<!-- c -->https://a.example/z', 'https://a.example/<x/>', 'https://b.example/', 'relative/path', 'https://a.example/&nbsp;', 'https://a.example/\u{1}',
    ]);
  const ns = pick(random, ['default', 'default', 'prefix', 'none', 'undeclared', 'other', 'reset']);
  const p = ns === 'prefix' || ns === 'undeclared' ? 'sm:' : '';
  const decl = ns === 'default' ? ` xmlns="${SM}"` : ns === 'prefix' ? ` xmlns:sm="${SM}"` : ns === 'other' ? ' xmlns="urn:x"' : ns === 'reset' ? ` xmlns="${SM}"` : '';
  let body: string;
  if (kind === 'text') {
    const lines = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
      pick(random, ['https://a.example/x', 'http://a.example/y', 'https://a.example:8080/z', 'https://[::1]/v', 'https://[::1/w', 'ftp://a.example/', 'https://u@a.example/', 'https://a.example\\x', 'https://a.example/a b', '', ' https://a.example/t ', 'mailto:x@a.example']),
    );
    body = lines.join(pick(random, ['\n', '\r\n', '\r', '\u{2028}', '\u{85}', '\u{c}']));
  } else if (kind === 'other') {
    body = pick(random, ['<html><body>Not found</body></html>', '<error>no</error>', '{"a":1}', 'just text', '<?xml version="1.0"?><note/>']);
  } else {
    const entryTag = { urlset: 'url', sitemapindex: 'sitemap', rss: 'item', feed: 'entry' }[kind];
    const entries = Array.from({ length: Math.floor(random() * 4) }, () => {
      if (kind === 'feed') {
        const rel = pick(random, ['', ' rel="alternate"', ' rel="self"', ' rel=" alternate"']);
        const href = pick(random, [' href="https://a.example/e"', ' href="e"', ' href="../e"', ' href="//b.example/e"', '', ' href="https://[x/e"', ' href=" https://a.example/s "']);
        const base = chance(0.1) ? ' xml:base="https://a.example/b/"' : '';
        return `<entry${base}><link${rel}${href}/>${chance(0.5) ? '<updated>2026-01-01</updated>' : ''}</entry>`;
      }
      if (kind === 'rss') return `<item><title>t</title><link>${loc()}</link>${chance(0.3) ? `<link>${loc()}</link>` : ''}</item>`;
      const inner = `<${p}loc>${loc()}</${p}loc>${chance(0.4) ? `<${p}lastmod>2026-0${1 + Math.floor(random() * 9)}-01</${p}lastmod>` : ''}${chance(0.2) ? '<image:image xmlns:image="i"><image:loc>https://a.example/i.png</image:loc></image:image>' : ''}`;
      const tag = ns === 'reset' && chance(0.3) ? `${entryTag} xmlns=""` : entryTag;
      return `<${p}${tag}>${inner}</${p}${entryTag}>`;
    }).join(chance(0.3) ? '\n  ' : '');
    const root = kind === 'rss' ? 'rss' : kind === 'feed' ? 'feed' : kind;
    const rootDecl = kind === 'feed' ? ' xmlns="http://www.w3.org/2005/Atom"' : kind === 'rss' ? ' version="2.0"' : decl;
    const rootName = kind === 'urlset' || kind === 'sitemapindex' ? `${p}${chance(0.1) ? root.toUpperCase() : root}` : root;
    const inner = kind === 'rss' ? `<channel>${entries}</channel>` : entries;
    body = `<${rootName}${rootDecl}>${inner}</${rootName}>`;
    const prolog = pick(random, ['', '<?xml version="1.0" encoding="UTF-8"?>', "<?xml version='1.0'?>\n", '<?xml version="1.1" standalone="no"?>', '<!-- made -->', '<?xml-stylesheet href="s.xsl"?>', '\n', '<?xml version="1.0" encoding="latin1"?>', '<?xml version="1.0" encoding="windows-1252"?>']);
    body = prolog + body + pick(random, ['', '\n', '<!-- end -->', ' x', '<x/>']);
  }
  // Broken half the time, one way or another.
  if (chance(0.5)) {
    const at = Math.floor(random() * (body.length + 1));
    const piece = pick(random, ['<', '>', '&', ']]>', '--', '\u{1}', '\u{c}', '"', "'", ':', '\u{e9}', '\u{fffe}', '<!DOCTYPE', '</a>', '<a>', ' ', '\n', '&#0;', '&lt;', '<!-- x -->', '<![CDATA[y]]>', '\u{1f600}']);
    const how = random();
    body = how < 0.4 ? body.slice(0, at) + piece + body.slice(at) : how < 0.7 ? body.slice(0, at) + body.slice(at + 1 + Math.floor(random() * 3)) : body.slice(0, at) + piece + body.slice(at + piece.length);
  }
  let raw = utf8(body);
  if (chance(0.05)) raw = bytes([0xef, 0xbb, 0xbf], raw);
  if (chance(0.04)) raw = bytes(raw.subarray(0, Math.floor(raw.length / 2)), [pick(random, [0xff, 0xc0, 0xed, 0x80, 0xfe])], raw.subarray(Math.floor(raw.length / 2)));
  if (chance(0.03)) raw = Uint8Array.from(Array.from(body, (ch) => ch.charCodeAt(0) & 0xff));
  if (url.endsWith('.gz') || chance(0.15)) {
    const parts = chance(0.3) ? [raw.subarray(0, Math.floor(raw.length / 2)), raw.subarray(Math.floor(raw.length / 2))] : [raw];
    let gz = bytes(...parts.map((part) => member(part, { level: pick(random, [0, 1, 6, 9]), flags: chance(0.3) ? pick(random, [2, 4, 8, 16, 30]) : 0, extra: [7] })));
    const roll = random();
    if (roll < 0.1) gz = gz.subarray(0, Math.floor(random() * gz.length));
    else if (roll < 0.2) {
      const copy = gz.slice();
      copy[10 + Math.floor(random() * (copy.length - 10))] ^= 1 << Math.floor(random() * 8);
      gz = copy;
    } else if (roll < 0.25) gz = bytes(gz, [0, 0, 0]);
    else if (roll < 0.28) gz = bytes(gz, 'x');
    raw = gz;
  }
  return { name: `made-up ${n}`, body: raw, type, url };
}

/** The made-up cases the test reads, the same ones every time. */
export function madeUpCases(count: number): Case[] {
  const random = seeded(2026);
  return Array.from({ length: count }, (_, n) => madeUp(random, n));
}
