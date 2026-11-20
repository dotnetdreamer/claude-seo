// What WebKit before Safari 16.4 can't run, kept out of the checks: a
// lookbehind, which it can't even parse, and the regular-expression flags it
// doesn't have (v), with JavaScript's i flag, which these checks never use
// (py.ts says why). The app runs these files in the Mac app's web view, and
// the newest WebKit macOS 10.15 runs is Safari 15.6, so one such pattern at
// the top of a module would stop the whole app loading there.
//
// Two ways in: every regular-expression literal in the source, found by a
// small scanner, and every pattern built at run time, caught as it's built,
// while every module loads and every check runs on the fixtures.
//
//   node --test osg/tests/webkit.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checksDir = path.resolve(here, '..', 'checks');
const files = fs.readdirSync(checksDir).filter((name) => name.endsWith('.ts')).sort();

/** Whether a pattern's source has a lookbehind: "(?<=" or "(?<!" outside a class and not escaped. */
export function hasLookbehind(source: string): boolean {
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '[') {
      for (i++; i < source.length && source[i] !== ']'; i++) if (source[i] === '\\') i++;
    } else if (ch === '(' && source.startsWith('?<', i + 1) && (source[i + 3] === '=' || source[i + 3] === '!')) {
      return true;
    }
  }
  return false;
}

const BAD_FLAGS = /[iv]/;

/**
 * The regular-expression literals in a file: a "/" where an expression can
 * start (after an operator, a bracket, a keyword or the start), outside
 * strings, templates and comments. Good enough for this code, which has no
 * division that looks like anything else.
 */
export function regexLiterals(source: string): Array<{ body: string; flags: string; line: number }> {
  const found: Array<{ body: string; flags: string; line: number }> = [];
  const templates: number[] = [];
  let depth = 0;
  let last = '';
  let word = '';
  const lineOf = (at: number) => source.slice(0, at).split('\n').length;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === '\\') i++;
      last = 'string';
      word = '';
      continue;
    }
    if (ch === '`' || (ch === '}' && templates.length && templates[templates.length - 1] === depth)) {
      if (ch === '}') templates.pop();
      // Inside a template: to its end, or into a ${ }.
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '`') break;
        else if (source[i] === '$' && source[i + 1] === '{') {
          templates.push(depth);
          i++;
          break;
        }
      }
      last = source[i] === '`' ? 'string' : '{';
      word = '';
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === '/') {
      const expressionStarts = last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(word);
      if (expressionStarts) {
        let j = i + 1;
        let inClass = false;
        for (; j < source.length && (inClass || source[j] !== '/'); j++) {
          if (source[j] === '\\') j++;
          else if (source[j] === '[') inClass = true;
          else if (source[j] === ']') inClass = false;
          else if (source[j] === '\n') break;
        }
        const flags = /^[a-z]*/.exec(source.slice(j + 1))![0];
        found.push({ body: source.slice(i + 1, j), flags, line: lineOf(i) });
        i = j + flags.length;
        last = 'regex';
        word = '';
        continue;
      }
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      word = /[A-Za-z0-9_$]/.test(source[i - 1] ?? '') ? word + ch : ch;
      last = 'word';
    } else if (!/\s/.test(ch)) {
      last = ch;
      word = '';
    }
  }
  return found;
}

test('the scanner finds literals and tells them from division and strings', () => {
  const found = regexLiterals("const a = /x(?<=y)/gi; const b = c / d / e; const s = '/not/'; const t = `${/in/u.source}/x/`; // /no/\nf(/z/v)");
  assert.deepEqual(found.map((literal) => `${literal.body}|${literal.flags}`), ['x(?<=y)|gi', 'in|u', 'z|v']);
  assert.equal(hasLookbehind('a(?<=b)'), true);
  assert.equal(hasLookbehind('a(?<!b)'), true);
  assert.equal(hasLookbehind('a\\(?<=b'), false);
  assert.equal(hasLookbehind('[(?<=]'), false);
  assert.equal(hasLookbehind('(?<name>x)'), false);
});

test('no lookbehind and no i or v flag in any regular-expression literal of the checks', () => {
  const problems: string[] = [];
  let literals = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(checksDir, file), 'utf8');
    // The plainest rule first: the characters of a lookbehind appear nowhere, not even in a comment.
    if (/\(\?<[=!]/.test(source)) problems.push(`${file}: "(?<" with = or ! in the source`);
    for (const literal of regexLiterals(source)) {
      literals++;
      if (hasLookbehind(literal.body)) problems.push(`${file}:${literal.line}: a lookbehind in /${literal.body}/`);
      if (BAD_FLAGS.test(literal.flags)) problems.push(`${file}:${literal.line}: flags ${literal.flags} on /${literal.body}/`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(literals > 40, `only ${literals} literals found: the scanner missed some`);
});

test('no pattern built at run time has a lookbehind or an i or v flag, while every module loads and every check runs', async () => {
  const built: Array<{ source: string; flags: string }> = [];
  const Native = RegExp;
  const record = (args: unknown[]) => {
    const [pattern, flags] = args;
    built.push({ source: pattern instanceof Native ? pattern.source : String(pattern ?? ''), flags: flags !== undefined ? String(flags) : pattern instanceof Native ? pattern.flags : '' });
  };
  globalThis.RegExp = new Proxy(Native, {
    construct(target, args, newTarget) {
      record(args);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, self, args) {
      record(args);
      return Reflect.apply(target, self, args);
    },
  });
  try {
    // Every module, so a pattern built when one loads is caught, then every check on the fixtures.
    for (const file of files) await import(pathToFileURL(path.join(checksDir, file)).href);
    const checks = await import(pathToFileURL(path.join(checksDir, 'index.ts')).href);
    const fixtures = path.join(here, 'fixtures');
    for (const file of fs.readdirSync(path.join(fixtures, 'pages')).filter((name) => name.endsWith('.html'))) {
      const raw = fs.readFileSync(path.join(fixtures, 'pages', file));
      const meta = JSON.parse(fs.readFileSync(path.join(fixtures, 'pages', file.replace(/\.html$/, '.json')), 'utf8'));
      const html = checks.decodeBody(new Uint8Array(raw), meta.headers?.['content-type'] ?? '');
      checks.runPageChecks(html, meta.url, meta.headers ?? null, raw.length);
      checks.serverRendered(html);
      checks.analyseText(checks.visibleText(checks.parseHtml(html)));
    }
    for (const file of fs.readdirSync(path.join(fixtures, 'robots'))) checks.auditRobotsText(fs.readFileSync(path.join(fixtures, 'robots', file), 'utf8'));
    for (const file of fs.readdirSync(path.join(fixtures, 'llms'))) checks.lighthouseLlmsTxt(200, fs.readFileSync(path.join(fixtures, 'llms', file), 'utf8'));
    for (const file of fs.readdirSync(path.join(fixtures, 'text'))) checks.analyseText(fs.readFileSync(path.join(fixtures, 'text', file), 'utf8'));
    checks.analyseMetadataPairs(JSON.parse(fs.readFileSync(path.join(fixtures, 'metadata-pairs.json'), 'utf8')));
    checks.decodeBody(new TextEncoder().encode('<meta charset="windows-1252"><p>caf\u{E9}</p>'), 'text/html; charset=latin1');
    for (const body of ['<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.example/</loc></url></urlset>', 'https://a.example/\n', '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="p"/></entry></feed>']) {
      checks.readSitemapBody(new TextEncoder().encode(body), 'text/plain', 'https://a.example/sitemap.txt');
    }
  } finally {
    globalThis.RegExp = Native;
  }
  const bad = built.filter((entry) => hasLookbehind(entry.source) || BAD_FLAGS.test(entry.flags));
  assert.deepEqual(bad.map((entry) => `/${entry.source.slice(0, 120)}/${entry.flags}`), []);
  assert.ok(built.length > 30, `only ${built.length} patterns were built: the checks didn't run`);
});
