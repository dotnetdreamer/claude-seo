"""Write osg/checks/codecs.ts: how Python finds a codec by name, and its one-byte codecs.

url_safety.decode_body decodes a page with Python's codecs: bytes.decode(name,
errors="replace"), and UTF-8 when Python has no codec by that name. A browser's
TextDecoder knows other names and other tables (it reads "iso-8859-1" as
windows-1252, for one), so decode.ts follows Python's own lookup and tables,
written here from the Python the parity tests use:

    python osg/tests/make_codecs.py
"""

from __future__ import annotations

import codecs
import encodings
import encodings.aliases
import importlib
import os
import pkgutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "checks", "codecs.ts")

modules: dict[str, str] = {}
tables: dict[str, str] = {}
for name in sorted(m.name for m in pkgutil.iter_modules(encodings.__path__)):
    if name == "aliases":
        continue
    try:
        module = importlib.import_module(f"encodings.{name}")
        info = codecs.lookup(name)
    except (ImportError, LookupError):
        continue  # mbcs and oem are Windows only
    if not info._is_text_encoding:
        modules[name] = (
            "bytes"  # rot_13, base64_codec...: bytes.decode refuses them with a LookupError
        )
        continue
    table = getattr(module, "decoding_table", None)
    if isinstance(table, str) and len(table) == 256:
        modules[name] = "table"
        tables[name] = table
    else:
        modules[name] = "text"

aliases = dict(sorted(encodings.aliases.aliases.items()))


def literal(text: str) -> str:
    out = []
    for ch in text:
        cp = ord(ch)
        if (
            ch in "\\'"
            or cp < 0x20
            or 0x7F <= cp <= 0xA0
            or cp in (0x2028, 0x2029, 0xFFFE, 0xFEFF, 0xAD)
            or 0xD800 <= cp <= 0xDFFF
        ):
            out.append(f"\\u{{{cp:X}}}")
        else:
            out.append(ch)
    return "".join(out)


lines = [
    "// Python's codecs by name, written by osg/tests/make_codecs.py: do not edit,",
    "// run the script again. decode.ts reads them.",
    "",
    f"export const CODECS_PYTHON = '{sys.version.split()[0]}';",
    "",
    "/** encodings.aliases.aliases: a normalised name to the codec module it means. */",
    "export const CODEC_ALIASES: Readonly<Record<string, string>> = {",
]
for alias, target in aliases.items():
    lines.append(f"  {alias if alias.isidentifier() else repr(alias)}: '{target}',")
lines += [
    "};",
    "",
    "/** The codec modules: 'table' for a one-byte codec (CODEC_TABLES), 'text' for any other text codec, 'bytes' for one bytes.decode refuses. */",
    "export const CODEC_MODULES: Readonly<Record<string, 'table' | 'text' | 'bytes'>> = {",
]
for name, kind in modules.items():
    lines.append(f"  {name}: '{kind}',")
lines += [
    "};",
    "",
    "/**",
    " * Each one-byte codec's decoding_table, the character for each byte, from",
    " * byte 0x80 when the bytes below are ASCII and from 0x00 when they aren't",
    " * (EBCDIC). U+FFFE is a byte the codec doesn't define.",
    " */",
    "export const CODEC_TABLES: Readonly<Record<string, string>> = {",
]
for name, table in tables.items():
    ascii_low = all(table[i] == chr(i) for i in range(128))
    lines.append(f"  {name}: '{literal(table[128:] if ascii_low else table)}',")
lines += ["};", ""]
open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print(
    f"wrote {OUT}: {len(aliases)} aliases, {len(modules)} modules, {len(tables)} tables, {os.path.getsize(OUT)} bytes"
)
