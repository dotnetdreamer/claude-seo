"""Write osg/checks/libxml.ts: the tables libxml2's HTML parser builds its tree with.

page_checks.py reads pages through BeautifulSoup and lxml, so html.ts builds
the tree libxml2 does. libxml2's HTML parser is not an HTML5 tree builder:
it closes and opens elements from three tables in HTMLparser.c, which this
script copies out of the source of the libxml2 version lxml bundles:

    curl -sSfLo HTMLparser.c https://gitlab.gnome.org/GNOME/libxml2/-/raw/v2.14.6/HTMLparser.c
    python osg/tests/make_libxml.py HTMLparser.c

Check the version with: python -c "import lxml.etree as e; print(e.LIBXML_VERSION)".
"""

from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "checks", "libxml.ts")
source = open(sys.argv[1], encoding="utf-8").read()

# html40ElementTable: { "name", startTag, endTag, saveEndTag, empty, depr, dtd, isinline, "desc", 5 pointers, dataMode }
table = source[source.index("html40ElementTable[] = {") :]
table = table[: table.index("\n};")]
entries = re.findall(
    r'\{\s*"([a-z0-9]+)",\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*"[^"]*"\s*,(.*?)\n\}',
    table,
    re.S,
)
elements = [(*entry[:8], re.findall(r"[A-Z_0-9]+", entry[8])[-1]) for entry in entries]
assert len(elements) == table.count('\n{ "'), (len(elements), table.count('\n{ "'))
empty = sorted(name for name, _s, _e, _save, is_empty, *_rest in elements if is_empty == "1")
modes = {name: mode for name, *_rest, mode in elements if mode != "0"}

start_close = source[source.index("htmlStartClose[] = {") :]
start_close = start_close[: start_close.index("\n};")]
pairs = re.findall(r'\{\s*"([a-z0-9]+)",\s*"([a-z0-9]+)"\s*\}', start_close)
assert len(pairs) > 200, len(pairs)
closes: dict[str, list[str]] = {}
for old, new in pairs:
    closes.setdefault(new, []).append(old)

priority = source[source.index("htmlEndPriority[] = {") :]
priority = priority[: priority.index("\n};")]
priorities = re.findall(r'\{\s*"([a-z0-9]+)",\s*(\d+)\}', priority)
default = re.search(r"\{NULL,\s*(\d+)\}", priority).group(1)

lines = [
    "// libxml2's HTML parser tables, written by osg/tests/make_libxml.py from its",
    "// HTMLparser.c (the version lxml bundles): do not edit, run the script again.",
    "",
    "/** Elements libxml2 closes as soon as they open (html40ElementTable, empty). */",
    f"export const EMPTY_ELEMENTS: ReadonlySet<string> = new Set({empty!r});".replace("'", "'"),
    "",
    "/** How libxml2 reads an element's text (html40ElementTable, dataMode). */",
    "export const DATA_MODES: Readonly<Record<string, 'rcdata' | 'rawtext' | 'plaintext' | 'script'>> = {",
]
for name, mode in sorted(modes.items()):
    lines.append(f"  {name}: '{mode.replace('DATA_', '').lower()}',")
lines += [
    "};",
    "",
    "/** For each new element, the open elements it closes first (htmlStartClose, new tag: old tags). */",
    "export const START_CLOSES: Readonly<Record<string, ReadonlySet<string>>> = {",
]
for new in sorted(closes):
    lines.append(f"  {new if new.isidentifier() else repr(new)}: new Set({sorted(closes[new])!r}),")
lines += [
    "};",
    "",
    "/** How far an end tag may reach to close what it names (htmlEndPriority). */",
    "export const END_PRIORITY: Readonly<Record<string, number>> = {",
]
for name, value in priorities:
    lines.append(f"  {name}: {value},")
lines += ["};", f"export const DEFAULT_END_PRIORITY = {default};", ""]
open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print(
    f"wrote {OUT}: {len(elements)} elements, {len(empty)} empty, {len(modes)} with a data mode, {len(pairs)} start-close pairs, {len(priorities)} priorities"
)
