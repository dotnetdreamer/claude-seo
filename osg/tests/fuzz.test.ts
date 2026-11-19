// Whole inputs made up at random, the same list for Python and for the port:
// pages, robots.txt files, llms.txt files, copy and title pairs, built from
// the pieces that trip up a port from Python. Those are the characters the
// two languages read differently (Python's whitespace has U+001C to U+001F
// and U+0085 and not U+FEFF; its \w and \d know every script; its len()
// counts code points), entities, odd spacing and case, and every tag and
// attribute a check reads. A difference in any finding, its evidence, a
// count or a fact fails the test.
//
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/fuzz.test.ts
//   FUZZ_PAGES=20000 ... for a longer run

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPageChecks } from '../checks/pageChecks.ts';
import { auditRobotsText } from '../checks/aiAccess.ts';
import { lighthouseLlmsTxt } from '../checks/llms.ts';
import { analyseText } from '../checks/contentQuality.ts';
import { analyseMetadata, analyseMetadataPairs } from '../checks/metadataTemplate.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const python = process.env.OSG_PARITY_PYTHON || 'python3';
const PAGES = Number(process.env.FUZZ_PAGES ?? 3000);
const TEXTS = Number(process.env.FUZZ_TEXTS ?? 3000);

function harness(name: string, payload: unknown): any {
  const result = spawnSync(python, ['-I', path.join(here, 'harness.py'), name], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) throw result.error;
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

/** Characters Python and JavaScript don't agree are spaces, and some they do. */
const SPACES = [' ', ' ', ' ', '  ', '\t', '\n', '\r\n', '\r', '\u000b', '\u000c', '\u001c', '\u001d', '\u001e', '\u001f', '\u0085', '\u{A0}', '\u{1680}', '\u{2000}', '\u{2009}', '\u{200A}', '\u{2028}', '\u{2029}', '\u{202F}', '\u{205F}', '\u{3000}', '\u{FEFF}', '\u{200B}', '\u{180E}'];
const WORDS = [
  'Pebble', 'notes', 'sync', 'everywhere', 'your', 'phone', 'app', 'the', 'and', 'free', 'fast', 'Notes', 'NOTES',
  'caf\u{E9}', 'cafe\u{301}', 'na\u{EF}ve', '\u{130}stanbul', '\u{131}\u{131}', 'Stra\u{DF}e', '\u{3A3}\u{39F}\u{3A6}\u{399}\u{391}\u{3A3}', '\u{3C3}\u{3BF}\u{3C6}\u{3AF}\u{3B1}', '\u{65E5}\u{672C}\u{8A9E}', '\u{306E}\u{30A2}\u{30D7}\u{30EA}', '\u{639}\u{631}\u{628}\u{649}', '\u{928}\u{92E}\u{938}\u{94D}\u{924}\u{947}',
  'emoji\u{1F600}', '\u{1F44D}\u{1F3FD}', '\u{1D400}\u{1D401}', '\u{212B}', '\u{FB01}le', '\u{216B}', '\u{663}\u{664}', '\u{FF13}\u{FF14}', '\u{BD}', '\u{B2}', 'x_y', 'A-B', "it's", 'don\u{2019}t',
  '&amp;', '&nbsp;', '&#160;', '&#x85;', '&#133;', '&copy', '&lt;b&gt;', '&#xFEFF;', '&#28;', '&ensp;', '<b>bold</b>', '<i>it</i>', '<br>', '<span>in</span>',
  // Letters and digits in Unicode 16 and 17 that Python 3.13 (Unicode 15.1) doesn't know: a browser's \\p{L} counts them, Python doesn't.
  'x\u{1C89}y', '\u{A7CB}\u{A7CC}', '\u{10D50}\u{10D51}', '\u{88F}', '\u{16D40}', '\u{1E5D0}', '\u{10D40}\u{10D41}',
  'UPPER', 'MiXeD', '123', '1,000', '4.5', '\u{2014}', '\u{2013}', '\u{2026}', '"quoted"', '\u{201C}curly\u{201D}', 'click here', 'Read More', 'lorem ipsum', 'Lorem Ipsum', 'dolor sit amet',
];

test('pages: thousands of made-up pages read the same by Python and by the port', () => {
  const random = seeded(4242);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const maybe = (p: number) => random() < p;
  const text = (min: number, max: number) => {
    const count = min + Math.floor(random() * (max - min + 1));
    let out = maybe(0.15) ? pick(SPACES) : '';
    for (let i = 0; i < count; i++) out += (i ? pick(SPACES) : '') + pick(WORDS);
    return out + (maybe(0.15) ? pick(SPACES) : '');
  };
  // Text inside an attribute: no markup, but entities, quotes and spaces.
  const attrText = (min: number, max: number) => text(min, max).replace(/<[^>]*>/g, '').replace(/"/g, '&quot;');
  const URLS = [
    'https://pebble.example/', 'https://pebble.example/Notes_App/', 'https://pebble.example/a//b/', 'https://pebble.example/\u{FC}n\u{EF}/', 'https://pebble.example/caf%C3%A9/',
    'https://pebble.example/?utm_source=x', 'https://pebble.example/?id=3&b=4', `https://pebble.example/${'x'.repeat(90)}/`, 'http://pebble.example/', 'https://Pebble.Example/A/',
  ];
  const HREFS = ['/', '/support/', 'support/', '../up/', '#top', 'http://old.example/', 'https://pebble.example/privacy/', 'javascript:void(0)', 'mailto:hi@pebble.example', '', ' /spaced/ ', '/a b/', 'https://pebble.example/caf\u{E9}/', '//cdn.example/x'];
  const JSONLD = [
    '{"@context":"https://schema.org","@type":"MobileApplication","name":"Pebble","offers":{"price":0}}',
    '[{"@type":"FAQPage"}]', '{"a": NaN}', '{"a":1,}', '\u{FEFF}', '\u{FEFF}{}', '\u{A0}{}', '\u001c{}', '{}\u0085', '', '   ', '\n', '{"a": "\\u12"}', '[', '{"b": "x\u0001y"}', '"text"', '1e400', '{"@graph":[{"@id":"#a"}]}',
  ];
  const pages: Array<{ html: string; url: string; headers: Record<string, string> | null; bytes: number }> = [];
  for (let n = 0; n < PAGES; n++) {
    const head: string[] = [];
    const body: string[] = [];
    if (maybe(0.7)) head.push(pick(['<meta charset="utf-8">', '<meta charset=" UTF-8 ">', '<meta charset="windows-1252">', '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">', '<meta charset="utf8">', '<META CHARSET="Utf-8">']));
    const titles = maybe(0.9) ? (maybe(0.1) ? 2 : 1) : 0;
    for (let i = 0; i < titles; i++) head.push(`<title>${text(0, 14)}</title>`);
    if (maybe(0.08)) body.push(`<svg><title>${text(1, 3)}</title></svg>`);
    const descriptions = maybe(0.8) ? (maybe(0.1) ? 2 : 1) : 0;
    for (let i = 0; i < descriptions; i++) head.push(`<meta name="${pick(['description', 'Description', ' description', 'DESCRIPTION'])}" content="${attrText(0, 40)}">`);
    if (maybe(0.3)) head.push(`<meta name="${pick(['robots', 'ROBOTS', 'googlebot'])}" content="${pick(['noindex', 'NOINDEX, nofollow', 'none', ' noindex ', 'index,follow', 'noindex\u{A0}', 'nofollow', 'noindex\u001c', 'max-snippet:-1', 'noindex\u{FEFF}'])}">`);
    const canonicals = maybe(0.7) ? (maybe(0.1) ? 2 : 1) : 0;
    for (let i = 0; i < canonicals; i++) head.push(`<link rel="${pick(['canonical', 'Canonical', 'canonical\u{A0}x', ' canonical ', 'alternate canonical', 'canonical\u001c', 'canonical\u{FEFF}'])}" href="${pick([...URLS, ...HREFS])}">`);
    if (maybe(0.25)) for (const lang of pick([['en', 'de'], ['x-default', 'en-US'], ['EN']])) head.push(`<link rel="alternate" hreflang="${lang}" href="${pick([...URLS, ...HREFS])}">`);
    if (maybe(0.7)) head.push(`<meta name="${pick(['viewport', 'Viewport', ' viewport'])}" content="width=device-width">`);
    if (maybe(0.5)) head.push(`<meta property="og:title" content="${attrText(1, 6)}">`);
    if (maybe(0.4)) head.push(`<meta property="${pick(['og:image', 'OG:Image', 'og:image:url'])}" content="${pick(['https://pebble.example/a.png', '', ' ', 'a.png'])}">`);
    if (maybe(0.3)) head.push(`<meta property="og:url" content="${pick([...URLS, ...HREFS])}">`);
    if (maybe(0.08)) head.push(`<meta http-equiv="${pick(['refresh', 'Refresh'])}" content="${pick(['0; url=/x', '5', '0;URL=https://elsewhere.example/', ''])}">`);
    if (maybe(0.1)) head.push(`<base href="${pick(['/sub/', 'https://other.example/', '', 'sub/'])}">`);
    const blocks = maybe(0.5) ? 1 + Math.floor(random() * 3) : 0;
    for (let i = 0; i < blocks; i++) head.push(`<script type="${pick(['application/ld+json', 'application/LD+JSON', 'application/ld+json; charset=utf-8'])}">${pick(JSONLD)}</script>`);
    if (maybe(0.3)) head.push(pick(['<link rel="stylesheet" href="http://cdn.example/a.css">', '<script src="http://cdn.example/a.js"></script>', '<link rel="preload" href="http://x.example/f.woff2">']));

    if (maybe(0.3)) body.push(`<nav class="${pick(['menu', 'site-nav', 'Nav'])}"><a href="/">${text(1, 2)}</a></nav>`);
    const wrap = pick(['main', 'article', 'div', 'section', '']);
    const content: string[] = [];
    const headings = Math.floor(random() * 5);
    for (let i = 0; i < headings; i++) {
      const level = pick([1, 1, 2, 2, 3, 4, 5, 6]);
      content.push(`<h${level}${maybe(0.05) ? ' aria-hidden="true"' : ''}>${text(0, 8)}</h${level}>`);
    }
    const paragraphs = Math.floor(random() * 8);
    for (let i = 0; i < paragraphs; i++) content.push(`<p>${text(0, maybe(0.2) ? 120 : 30)}</p>`);
    const images = Math.floor(random() * 4);
    for (let i = 0; i < images; i++) {
      const alt = pick(['', ' alt=""', ` alt="${attrText(1, 4)}"`, ' alt=" "', ' alt="\u{A0}"', ' alt="\u001c"', ' alt="\u{FEFF}"', ' role="presentation"', ' aria-hidden="true"']);
      const size = pick(['', ' width="10" height="10"', ' width="10"', ' width=" " height="0"']);
      const lazy = pick(['', ' loading="lazy"', ' loading="LAZY"', ' loading=" lazy"']);
      const src = pick([' src="a.png"', ' src=""', ' data-src="b.png"', ' srcset="c.png 1x, d.png 2x"', ' src="http://cdn.example/e.png"', '']);
      content.push(`<img${src}${alt}${size}${lazy}>`);
    }
    const links = Math.floor(random() * 6);
    for (let i = 0; i < links; i++) {
      const inner = pick(['', 'click here', 'Click Here!', 'read more', ' ', '\u{A0}', '\u001c', '\u{FEFF}', text(1, 4), '<img alt="x" src="a.png">', '<img alt="" src="a.png">', '<svg><title>T</title></svg>', 'here\u{A0}', ' Learn more\u{2026} ']);
      const label = pick(['', '', '', ' aria-label="Go"', ' aria-label=" "', ' title="t"', ' aria-labelledby="x"']);
      content.push(maybe(0.05) ? `<a${label}>${inner}</a>` : `<a href="${pick(HREFS)}"${label}>${inner}</a>`);
    }
    if (maybe(0.1)) content.push(pick(['<center>old</center>', '<font color="red">old</font>', '<marquee>old</marquee>', '<big>old</big>', '<tt>t</tt>']));
    if (maybe(0.05)) content.push(pick(['<frameset><frame src="a.html"></frameset>', '<iframe src="x.html"></iframe>']));
    if (maybe(0.2)) content.push(pick(['<script>var a = "<p>hidden words here</p>";</script>', '<style>p { color: red }</style>', '<noscript>no script words</noscript>', '<template><p>template words</p></template>', '<!-- a comment with words -->']));
    if (maybe(0.05)) content.push(`${'<div>'.repeat(34)}deep${'</div>'.repeat(34)}`);
    if (maybe(0.05)) content.push(`<ul>${'<li>x</li>'.repeat(61)}</ul>`);
    body.push(wrap ? `<${wrap}>${content.join('\n')}</${wrap}>` : content.join('\n'));
    if (maybe(0.3)) body.push(`<footer><p>${text(1, 6)}</p></footer>`);

    const doctype = pick(['<!doctype html>', '<!DOCTYPE html>', '', '\u{FEFF}<!doctype html>', ' <!doctype html>', '\n<!doctype html>', '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">', '<!doctype html >']);
    const lang = pick([' lang="en"', ' lang=""', ' lang=" EN-us "', '', ' lang="\u{A0}"', ' LANG="de"', ' lang="\u001cen"', ' lang="\u{FEFF}en"']);
    const html = `${doctype}\n<html${lang}><head>${head.join('\n')}</head><body>${body.join('\n')}</body></html>`;
    const headers = maybe(0.6)
      ? Object.fromEntries(
          [
            [pick(['content-type', 'Content-Type', 'CONTENT-TYPE']), pick(['text/html; charset=utf-8', 'text/html', 'text/html; charset=ISO-8859-1', 'text/html;charset="utf-8"', 'text/html; charset=windows-1252 '])],
            ...(maybe(0.2) ? [[pick(['x-robots-tag', 'X-Robots-Tag']), pick(['noindex', 'googlebot: noindex', 'none', 'NoIndex', 'unavailable_after: 2020-01-01', 'noindex\u{A0}'])]] : []),
          ]
        )
      : null;
    pages.push({ html, url: pick(URLS), headers, bytes: Buffer.byteLength(html, 'utf8') });
  }

  const py: any[] = harness('pages', { pages });
  const shape = (findings: any[]) => findings.map((f) => ({ id: f.id, severity: f.severity, count: f.count ?? null, evidence: f.evidence }));
  const differences: string[] = [];
  const kinds = new Map<string, number>();
  pages.forEach((page, index) => {
    const expected = py[index];
    let ts: any;
    try {
      const result = runPageChecks(page.html, page.url, page.headers, page.bytes);
      ts = { findings: shape(result.findings), not_checked: result.notChecked.map((entry) => entry.id), facts: result.facts, checks_run: result.summary.checksRun, headers_available: result.headersAvailable };
    } catch (error) {
      ts = { error: String(error) };
    }
    const wanted = expected.error ? expected : { ...expected, findings: shape(expected.findings) };
    for (const key of Object.keys({ ...wanted, ...ts })) {
      if (key === 'facts') {
        for (const fact of new Set([...Object.keys(wanted.facts ?? {}), ...Object.keys(ts.facts ?? {})])) {
          const a = JSON.stringify(ts.facts?.[fact]);
          const b = JSON.stringify(wanted.facts?.[fact]);
          if (a !== b) {
            differences.push(`page ${index}: fact ${fact}: ${a?.slice(0, 200)} vs ${b?.slice(0, 200)}`);
            kinds.set(`fact ${fact}`, (kinds.get(`fact ${fact}`) ?? 0) + 1);
          }
        }
        continue;
      }
      const a = JSON.stringify(ts[key]);
      const b = JSON.stringify(wanted[key]);
      if (a !== b) {
        if (key === 'findings') {
          const ids = new Set([...(ts.findings ?? []), ...(wanted.findings ?? [])].map((f: any) => f.id));
          for (const id of ids) {
            const x = JSON.stringify((ts.findings ?? []).filter((f: any) => f.id === id));
            const y = JSON.stringify((wanted.findings ?? []).filter((f: any) => f.id === id));
            if (x !== y) {
              differences.push(`page ${index}: finding ${id}: ${x.slice(0, 300)} vs ${y.slice(0, 300)}`);
              kinds.set(`finding ${id}`, (kinds.get(`finding ${id}`) ?? 0) + 1);
            }
          }
        } else {
          differences.push(`page ${index}: ${key}: ${a?.slice(0, 300)} vs ${b?.slice(0, 300)}`);
          kinds.set(key, (kinds.get(key) ?? 0) + 1);
        }
      }
    }
  });
  if (process.env.FUZZ_PAGE) console.log(JSON.stringify(pages[Number(process.env.FUZZ_PAGE)]));
  if (differences.length && process.env.FUZZ_DUMP) {
    const first = Number(differences[0].match(/^page (\d+)/)?.[1]);
    console.log(JSON.stringify(pages[first]));
  }
  assert.deepEqual(differences.slice(0, 15), [], `${differences.length} differences in ${pages.length} pages, by kind: ${JSON.stringify(Object.fromEntries(kinds))}`);
});

test('robots.txt, llms.txt, copy and titles: made-up files read the same by Python and by the port', () => {
  const random = seeded(777);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const maybe = (p: number) => random() < p;
  const space = () => (maybe(0.3) ? pick(SPACES.filter((char) => char !== '\n' && char !== '\r' && char !== '\r\n')) : '');
  const ending = () => pick(['\n', '\n', '\r\n', '\r', '\u0085', '\u{2028}']);

  const robotsLines = [
    'User-agent: *', 'User-Agent: GPTBot', 'user-agent:ClaudeBot', 'User-agent: Google-Extended', 'User-agent: PerplexityBot', 'User-agent: OAI-SearchBot', 'User-agent: CCBot # c',
    'User-agent: Bad Bot', 'User-agent: \u{A0}GPTBot', 'User-agent: gptbot', 'User-agent: GPTBot/1.0', 'User-agent: ChatGPT-User', 'User-agent: Claude-SearchBot',
    'Disallow: /', 'Disallow:', 'Allow: /', 'Allow: /x', 'Disallow: /*.pdf$', 'Disallow: /private/', 'disallow : /', 'Disallow:\u{A0}/', 'Disallow: /\u{E9}t\u{E9}/',
    'Sitemap: https://pebble.example/sitemap.xml', 'sitemap:https://pebble.example/s2.xml', 'Sitemap: ', '# comment', '', '   ', 'Crawl-delay: 5', 'Host: pebble.example', 'nonsense line', ':', 'User-agent:',
  ];
  const robots: string[] = [];
  for (let n = 0; n < TEXTS; n++) {
    const lines = Array.from({ length: Math.floor(random() * 12) }, () => `${space()}${pick(robotsLines)}${space()}`);
    robots.push((maybe(0.1) ? '\u{FEFF}' : '') + lines.map((line) => line + ending()).join(''));
  }
  const pyRobots: any[] = harness('robots-batch', { texts: robots });
  const robotsDiff: string[] = [];
  robots.forEach((text, index) => {
    const ts = auditRobotsText(text);
    const py = pyRobots[index];
    const a = JSON.stringify([ts.agents.map((agent) => [agent.token, agent.group, agent.rootAllowed]), ts.sitemaps, ts.nonstandardUserAgentLines, ts.aiGroups.status, ts.userAgents.status]);
    const b = JSON.stringify([py.agents.map((agent: any) => [agent.token, agent.group, agent.root_allowed]), py.sitemaps, py.nonstandard, py.ai_groups_status, py.user_agents_status]);
    if (a !== b) robotsDiff.push(`${JSON.stringify(text)}:\n  ${a.slice(0, 400)}\n  ${b.slice(0, 400)}`);
  });
  assert.deepEqual(robotsDiff.slice(0, 5), [], `${robotsDiff.length} of ${robots.length} robots.txt files differ`);

  const llmsLines = ['# Pebble', '#Pebble', ' # Pebble', '\u{FEFF}# Pebble', '> Notes for your phone.', '>Notes', '## Pages', '##Pages', '- [Home](https://pebble.example/): the app', '[a](b)', '[x] (y)', 'Some words about it', '', '\u001c', '<!doctype html>', '<html>', '   ', '\u{A0}# T', '\u0085', 'caf\u{E9} \u{1F600}'];
  const llms: string[] = [];
  for (let n = 0; n < TEXTS; n++) {
    const lines = Array.from({ length: Math.floor(random() * 9) }, () => `${space()}${pick(llmsLines)}${space()}`);
    llms.push((maybe(0.1) ? pick(['\u{FEFF}', '\u{FEFF}\u{FEFF}', ' ', '\n']) : '') + lines.map((line) => line + ending()).join(''));
  }
  const pyLlms: any[] = harness('llms-batch', { texts: llms });
  const llmsDiff: string[] = [];
  llms.forEach((text, index) => {
    const a = JSON.stringify(lighthouseLlmsTxt(200, text));
    const b = JSON.stringify(pyLlms[index]);
    if (a !== b) llmsDiff.push(`${JSON.stringify(text)}:\n  ${a}\n  ${b}`);
  });
  assert.deepEqual(llmsDiff.slice(0, 5), [], `${llmsDiff.length} of ${llms.length} llms.txt files differ`);

  const phrases = ['at the end of the day', 'when it comes to', 'unlock the full potential', 'game-changer', 'delve into', 'in today\u{2019}s fast-paced world', 'seamlessly', 'leverage', 'it is important to note', 'a testament to'];
  const copy: string[] = [];
  for (let n = 0; n < TEXTS; n++) {
    const words = Array.from({ length: Math.floor(random() * (maybe(0.3) ? 400 : 60)) }, () => (maybe(0.05) ? pick(phrases) : pick(WORDS).replace(/<[^>]*>/g, '')));
    copy.push(words.map((word, i) => (i ? pick(SPACES) : '') + (maybe(0.1) ? word.toUpperCase() : word)).join('') + (maybe(0.3) ? '.' : ''));
  }
  const pyCopy: any[] = harness('content-batch', { texts: copy });
  const copyDiff: string[] = [];
  copy.forEach((text, index) => {
    const a = JSON.stringify(analyseText(text));
    const b = JSON.stringify(pyCopy[index]);
    if (a !== b) copyDiff.push(`${JSON.stringify(text.slice(0, 200))}:\n  ${a.slice(0, 400)}\n  ${b.slice(0, 400)}`);
  });
  assert.deepEqual(copyDiff.slice(0, 5), [], `${copyDiff.length} of ${copy.length} texts differ`);

  const pairs: Array<{ title: string; description: string; url: string | null }> = [];
  for (let n = 0; n < TEXTS; n++) {
    const name = pick(['Pebble', 'Pebble Notes', 'caf\u{E9}', '\u{65E5}\u{672C}\u{8A9E}', 'Notes\u{A0}App', 'NOTES']);
    const title = pick([`${name} | Brand`, `${name} - Brand`, `Buy ${name}`, name, `${name}${pick(SPACES)}|${pick(SPACES)}Shop`, '', ' ', `Best ${name} 2026`]);
    const description = pick([`${title}. Shop now!`, `${name} for your phone. Download today.`, `Get ${name}. Free shipping.`, '', `${title}${pick(SPACES)}Learn more.`, pick(WORDS)]);
    pairs.push({ title, description, url: maybe(0.5) ? pick(['https://pebble.example/a/', 'https://pebble.example/Notes_App/', null]) : null });
  }
  const pyPairs: any[] = harness('metadata-batch', { pairs });
  const pairDiff: string[] = [];
  pairs.forEach((pair, index) => {
    const a = JSON.stringify(analyseMetadata(pair.title, pair.description, pair.url));
    const b = JSON.stringify(pyPairs[index]);
    if (a !== b) pairDiff.push(`${JSON.stringify(pair)}:\n  ${a.slice(0, 400)}\n  ${b.slice(0, 400)}`);
  });
  assert.deepEqual(pairDiff.slice(0, 5), [], `${pairDiff.length} of ${pairs.length} title pairs differ`);
  for (let start = 0; start + 12 <= pairs.length; start += 300) {
    const site = pairs.slice(start, start + 12);
    assert.deepEqual(analyseMetadataPairs(site), harness('metadata-site', { pairs: site }), `site of pairs ${start}`);
  }
});
