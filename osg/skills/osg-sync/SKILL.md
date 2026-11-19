---
name: osg-sync
description: After this fork is synced with AgriciDaniel/claude-seo, bring osg/checks (the TypeScript copy of four Python scripts that Open Screenshot Generator runs) back in line with the scripts, and check osg/manifest.json still names files that exist. Use when asked to "sync osg", "update the osg checks" or after pulling upstream.
---

# Bring osg/ in line with upstream

`osg/checks/` is a TypeScript version of four scripts. Upstream changes them
often. This skill finds what changed and makes the TypeScript match, proven
by `osg/tests/parity.test.ts`.

## 1. Set up once

```bash
python3 -m venv .venv
.venv/bin/pip install beautifulsoup4 lxml lxml_html_clean requests urllib3
```

(`requirements.txt` holds the versions upstream pins; those four are all the
parity tests import.)

## 2. See what moved

Find the last commit osg was checked against: the newest commit that touched
`osg/checks/`.

```bash
last=$(git log -1 --format=%H -- osg/checks)
git diff "$last"..HEAD -- scripts/page_checks.py scripts/agentic_check.py scripts/content_quality.py scripts/metadata_template.py
```

Read the diff. For each change, note whether it moves a threshold, a message,
a severity, a check id, a phrase list, the robots.txt agent list
(`AI_AGENTS`) or how a value is counted.

## 3. Run the parity tests

```bash
OSG_PARITY_PYTHON=.venv/bin/python node --test osg/tests/*.test.ts
```

If upstream raised its lxml, libxml2, BeautifulSoup or Python version, write
the tables again first: `make_entities.py`, `make_pyunicode.py`,
`make_codecs.py`, and `make_libxml.py` with the `HTMLparser.c` of the libxml2
lxml bundles (the script says where to get it). Then run the tests with
larger counts once, for example `FUZZ_PAGES=20000 FUZZ_TREES=20000`.

In the TypeScript, never use JavaScript's own trim, `\s`, `\w`, `\d`, `\b`,
`\p{...}`, `toLowerCase()`, `sort()` or `.length` on text where the script uses
Python's: use `checks/py.ts`.
A failure names the page or file and shows the difference. Change the
matching file in `osg/checks/` until the tests pass. Keep the TypeScript
close to the Python line by line, so the next diff is easy to follow.

## 4. Cover what is new

The fixtures only prove what they exercise. For a new check, a new agent or a
new branch in the scripts, add a page to `osg/tests/fixtures/pages/` (an
`.html` and a `.json` with its `url` and optional `headers`), a file to
`fixtures/robots/`, `fixtures/llms/` or `fixtures/text/`, or a pair to
`fixtures/metadata-pairs.json`. Run the tests again. A new test that passes
before you change the TypeScript proves nothing: check it fails first.

## 5. Check the manifest

Every path in `osg/manifest.json` (each job's `files` and `updates`) must
exist:

```bash
node -e "const m=require('./osg/manifest.json');const fs=require('fs');for(const p of [m.updates,...Object.values(m.jobs).flatMap(j=>j.files)])if(!fs.existsSync(p))console.log('missing',p)"
```

If upstream renamed or split a file, point the manifest at the new path. If a
job's files grew past its `maxCharacters`, the app drops the last files in
the list, so keep the most useful first.

## 6. Commit and tell the app

Commit `osg/` on its own, with a message that names the upstream commit the
checks now match. Then, in Open Screenshot Generator, run
`npm run sync:seo-checks` to copy the new checks in, and run its unit tests.
The manifest and the knowledge files need no app change: the app reads them
from this repository's main branch.
