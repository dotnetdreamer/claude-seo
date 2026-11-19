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
| `checks/html.ts`, `checks/url.ts`, `checks/py.ts` | the parts of BeautifulSoup, lxml and Python the checks depend on |

The files use only TypeScript that Node can run as is (no enums, `.ts` in
imports), so the tests below need no build step.

## Proving the port still matches

`tests/parity.test.ts` runs the Python scripts and the TypeScript versions on
the same pages (`tests/fixtures/`) and fails on any difference in a finding,
its evidence text, a fact, a robots.txt verdict, an llms.txt verdict or a
copy score.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
OSG_PARITY_PYTHON=.venv/bin/python node --test osg/tests/parity.test.ts
```

It needs Node 22.18 or newer and the Python packages in `requirements.txt`
(beautifulsoup4, lxml and requests are enough).

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
