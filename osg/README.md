# osg: what Open Screenshot Generator uses from this repository

This folder belongs to the fork, not to claude-seo upstream. Upstream never
touches it, so syncing the fork with upstream never conflicts here.

[Open Screenshot Generator](https://github.com/dotnetdreamer/open-screenshot-generator)
has an SEO view that checks an app's website. It uses this repository in two
ways:

1. **The checks, copied into the app.** `checks/` is a TypeScript version of
   four of this repository's Python scripts. The app copies these files at a
   pinned commit (`npm run sync:seo-checks` in the app) and runs them on the
   pages it fetches, in the desktop app and on the web, with no Python.
2. **The knowledge, read when the view opens.** `manifest.json` lists the
   skill and reference files the app downloads from this repository's main
   branch when the SEO view opens, and sends to the user's AI (Claude Code,
   Codex or their own AI) as background for a fix plan or an answer. When the
   files here change, every user gets the new version the next time the view
   opens, with no app update. `data/google-updates.json` marks Google's
   updates on the app's Search Console chart.

## What `checks/` covers

| File | Follows |
| --- | --- |
| `checks/pageChecks.ts` | `scripts/page_checks.py`: all 47 on-page checks, same ids, thresholds, severities, messages and facts |
| `checks/aiAccess.ts` | `scripts/agentic_check.py`: robots.txt groups for AI crawlers and agents, and the server-rendered check |
| `checks/llms.ts` | `scripts/agentic_check.py`: llms.txt by the Lighthouse rules |
| `checks/contentQuality.ts` | `scripts/content_quality.py`: filler, AI phrasing, repetition and density |
| `checks/metadataTemplate.ts` | `scripts/metadata_template.py`: machine-made title and description pairs |
| `checks/html.ts`, `checks/libxml.ts`, `checks/entities.ts` | the tree BeautifulSoup builds with lxml: libxml2 2.14's HTML parser and its tables, and BeautifulSoup's strings |
| `checks/py.ts`, `checks/pyUnicode.ts` | Python's string rules: its whitespace, `\w`, `\d`, `\b`, `re.I`, `strip()`, `split()`, `lower()`, `len()`, `sorted()` and `repr()`, from Python's own tables |
| `checks/pyJson.ts` | Python's `json.loads`: what it reads (NaN too) and its error messages, for the JSON-LD check |
| `checks/decode.ts`, `checks/codecs.ts` | `scripts/url_safety.py`'s `decode_body`: a page's bytes made text with Python's codec lookup and its one-byte codecs |
| `checks/url.ts` | the parts of `urllib.parse` the checks use |

The files use only TypeScript that Node can run as is (no enums, `.ts` in
imports), so the tests below need no build step.

Four files are written by scripts in `tests/`, from the Python and libxml2
the parity tests use, and say so at the top:

- `checks/entities.ts` (`make_entities.py`): the HTML5 reference table. lxml 6
  (libxml2 2.14) reads character references as HTML5 does, so the port does too.
- `checks/pyUnicode.ts` (`make_pyunicode.py`): Python's character tables. A
  browser's `\s`, `\w` and `toLowerCase()` follow its own Unicode version and
  differ from Python's (its whitespace has U+001C to U+001F and U+0085 and not
  U+FEFF), so the port never uses them on text.
- `checks/libxml.ts` (`make_libxml.py`, from libxml2's `HTMLparser.c`): which
  elements are empty, which hold raw text, which close which, and how far an
  end tag reaches. libxml2 is not an HTML5 tree builder.
- `checks/codecs.ts` (`make_codecs.py`): Python's codec names and its 70
  one-byte codecs.

A page whose charset is a Chinese, Japanese or Korean codec is decoded the way
a browser decodes it, which matches Python on the characters those codecs
share and differs on the rest (Shift_JIS 0x8160 is U+301C in Python and
U+FF5E in a browser). A page that declares `utf-7`, `unicode_escape`,
`raw_unicode_escape`, `punycode`, `idna`, `hz`, `johab`, `iso2022_kr` or
`undefined` is decoded as UTF-8 here.

## Proving the port still matches

Every test sends the Python and the TypeScript the same input and fails on
any difference in a finding, its evidence text, a count, a fact or a verdict:

- `tests/parity.test.ts`: the pages, robots.txt files, llms.txt files, copy
  and title pairs in `tests/fixtures/`.
- `tests/generated.test.ts`: over 30,000 character references (every HTML5
  name, numbers, stray ampersands), 6,000 broken JSON-LD blocks down to the
  depth where Python gives up, Python's string rules on every code point and
  20,000 random strings, and 8,000 made-up byte strings, Content-Type headers
  and meta tags through `decode_body`.
- `tests/fuzz.test.ts`: 3,000 made-up pages (set `FUZZ_PAGES` for more),
  built from every tag and attribute a check reads and from the characters
  Python and JavaScript read differently, and 3,000 each of robots.txt files,
  llms.txt files, copy and title pairs (`FUZZ_TEXTS`).
- `tests/trees.test.ts`: 4,000 made-up documents (`FUZZ_TREES`) parsed by
  BeautifulSoup with lxml and by `html.ts`, the trees compared node by node:
  elements, attributes and each string with its kind.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
OSG_PARITY_PYTHON=.venv/bin/python node --test osg/tests/*.test.ts
```

It needs Node 22.18 or newer and the Python packages in `requirements.txt`
(beautifulsoup4, lxml and requests are enough). The nesting limit follows
CPython 3.13 on macOS and Linux; another Python version can stop at a
different depth, and the last part of the JSON-LD test says so.

## After syncing with upstream

Ask Claude Code in this repository to follow
[`skills/osg-sync/SKILL.md`](skills/osg-sync/SKILL.md). It runs the parity
tests, reads what changed in the four scripts, updates `checks/` to match,
adds a fixture for anything new, and checks that every path in
`manifest.json` still exists. Then copy the checks into the app with
`npm run sync:seo-checks`.

## Licence

claude-seo is MIT licensed (see `LICENSE` at the root), and so is this
folder. The AI-pattern phrases in `checks/contentQuality.ts` come from the
Wikipedia "AI Cleanup" project's catalogue (CC BY-SA 4.0), as
`scripts/content_quality.py` notes.
