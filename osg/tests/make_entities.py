"""Writes osg/checks/entities.ts from the HTML5 named character references.

lxml 6 (libxml2 2.14) reads character references the way HTML5 does, with
the whole WHATWG table, so html.ts needs the same table. Python ships it as
html.entities.html5. Run it again if that table ever changes:

    python osg/tests/make_entities.py
"""

from __future__ import annotations

import os
from html.entities import html5

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(os.path.dirname(HERE), "checks", "entities.ts")


def main() -> None:
    entries = []
    for name in sorted(html5):
        points = ",".join(format(ord(char), "x") for char in html5[name])
        entries.append(f"{name}:{points}")
    packed = " ".join(entries)
    lines = [packed[i : i + 110] for i in range(0, len(packed), 110)]
    body = "\n".join(f"  {line!r} +" for line in lines).rstrip(" +")
    with open(TARGET, "w", encoding="utf-8", newline="\n") as out:
        out.write(
            "// The HTML5 named character references: name, then the code points in hex.\n"
            "// Names that end without a semicolon are the legacy ones a page may write\n"
            "// without it. Written by osg/tests/make_entities.py from Python's\n"
            "// html.entities.html5 (the WHATWG table). Don't edit it by hand.\n\n"
            "const PACKED =\n"
            f"{body};\n\n"
            "/** Each name, with or without its semicolon, and the text it stands for. */\n"
            "export const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map(\n"
            "  PACKED.split(' ').map((entry) => {\n"
            "    const colon = entry.indexOf(':');\n"
            "    const points = entry.slice(colon + 1).split(',').map((hex) => parseInt(hex, 16));\n"
            "    return [entry.slice(0, colon), String.fromCodePoint(...points)] as [string, string];\n"
            "  })\n"
            ");\n"
        )
    print(f"wrote {len(html5)} names to {TARGET}")


if __name__ == "__main__":
    main()
