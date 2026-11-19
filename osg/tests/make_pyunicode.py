"""Write osg/checks/pyUnicode.ts: Python's own character tables, for the port.

JavaScript's \\s, \\w, \\d, \\b, \\p{...} and toLowerCase() follow the Unicode
version of the browser running them, and differ from Python's in places
anyway (Python's whitespace has U+001C to U+001F and U+0085 and not U+FEFF;
its \\w and \\d know every script). The checks give Python's answers only
with Python's tables, so this script writes them from the Python it runs on:

    python osg/tests/make_pyunicode.py

Run it with the Python the parity tests use, and again when that Python
moves to a new Unicode version (the file says which one it holds).
"""

from __future__ import annotations

import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "checks", "pyUnicode.ts")
LAST = 0x10FFFF


def points(test) -> list[int]:
    return [cp for cp in range(LAST + 1) if not 0xD800 <= cp <= 0xDFFF and test(chr(cp))]


def ranges(cps: list[int]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for cp in cps:
        if out and out[-1][1] == cp - 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return [(a, b) for a, b in out]


def b36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def pack(rs: list[tuple[int, int]]) -> str:
    """Each range as gap-from-the-last-one.length in base 36."""
    out = []
    last = -1
    for start, end in rs:
        out.append(f"{b36(start - last - 1)}.{b36(end - start)}")
        last = end
    return " ".join(out)


W = re.compile(r"\w")
D = re.compile(r"\d")
S = re.compile(r"\s")
space = points(str.isspace)
alnum = points(str.isalnum)
assert points(lambda ch: bool(W.match(ch))) == sorted(alnum + [ord("_")]), "\\w is isalnum() and _"
decimal = points(str.isdecimal)
assert points(lambda ch: bool(D.match(ch))) == decimal, "\\d is isdecimal()"
assert points(lambda ch: bool(S.match(ch))) == space, "\\s is isspace()"
assert all(cp < 0x10000 for cp in space), "every space is in the BMP"

tables = {
    "space": space,
    "alnum": alnum,
    "alpha": points(str.isalpha),
    "decimal": decimal,
    "printable": points(str.isprintable),
}
for category in ("L", "Mn", "Mc", "Nd", "Nl", "No"):
    tables[category] = points(
        lambda ch, c=category: (
            unicodedata.category(ch).startswith(c) if len(c) == 1 else unicodedata.category(ch) == c
        )
    )

# The final sigma rule of str.lower(), read from lower() itself: a cased
# letter before U+03A3 (case-ignorable ones skipped) and none after.
SIGMA = chr(0x3A3)
cased = points(lambda ch: (ch + SIGMA).lower()[-1] == chr(0x3C2))
either = points(lambda ch: ("A" + ch + SIGMA).lower()[-1] == chr(0x3C2))
cased_set = set(cased)
tables["cased"] = cased
tables["ignorable"] = [cp for cp in either if cp not in cased_set]

# str.lower(), one code point at a time (the final sigma aside): runs of the same shift.
singles: list[tuple[int, int]] = []
specials: dict[int, str] = {}
for cp in range(LAST + 1):
    if 0xD800 <= cp <= 0xDFFF:
        continue
    lowered = chr(cp).lower()
    if lowered == chr(cp):
        continue
    if len(lowered) == 1:
        singles.append((cp, ord(lowered) - cp))
    else:
        specials[cp] = lowered
runs: list[list[int]] = []  # start, count, step, delta
for cp, delta in singles:
    if runs:
        start, count, step, last_delta = runs[-1]
        end = start + step * (count - 1)
        if delta == last_delta and count == 1 and cp - start in (1, 2):
            runs[-1] = [start, 2, cp - start, delta]
            continue
        if delta == last_delta and count > 1 and cp == end + step:
            runs[-1][1] += 1
            continue
    runs.append([cp, 1, 1, delta])
lower_runs = " ".join(
    f"{b36(start)}.{b36(count)}.{step}.{'-' if delta < 0 else ''}{b36(abs(delta))}"
    for start, count, step, delta in runs
)
lower_specials = " ".join(
    f"{b36(cp)}:{'.'.join(b36(ord(ch)) for ch in text)}" for cp, text in specials.items()
)

for cp, delta in singles:
    assert chr(cp).lower() == chr(cp + delta)

lines = [
    "// Python's character tables, written by osg/tests/make_pyunicode.py: do not edit,",
    "// run the script again. They make the port give Python's answers in every",
    "// browser, whatever Unicode version the browser has (py.ts uses them).",
    "",
    "/** The Python and Unicode versions these tables are from. */",
    f"export const PYTHON_VERSION = '{sys.version.split()[0]}';",
    f"export const PYTHON_UNICODE = '{unicodedata.unidata_version}';",
    "",
    "/** Code point ranges, each as gap-from-the-last-one.length in base 36. */",
    "export const PACKED_RANGES = {",
]
for name, cps in tables.items():
    lines.append(f"  {name if name.isidentifier() else repr(name)}: '{pack(ranges(cps))}',")
lines += [
    "} as const;",
    "",
    "/** str.lower() one code point at a time: runs of start.count.step.shift in base 36. */",
    f"export const LOWER_RUNS = '{lower_runs}';",
    "/** str.lower() where one code point becomes several: code point:code points. */",
    f"export const LOWER_SPECIALS = '{lower_specials}';",
    "",
]
open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print(
    f"wrote {OUT}: {', '.join(f'{name} {len(ranges(cps))} ranges' for name, cps in tables.items())}; lower {len(runs)} runs, {len(specials)} specials"
)
