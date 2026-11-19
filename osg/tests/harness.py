"""Calls the functions of scripts/ that have no command line of their own.

Reads one JSON object on stdin and prints the script's answer as JSON, for
osg/tests/parity.test.ts:

    python osg/tests/harness.py robots < payload.json
"""

from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import agentic_check  # noqa: E402
import content_quality  # noqa: E402
import metadata_template  # noqa: E402
import page_checks  # noqa: E402
from bs4 import BeautifulSoup, NavigableString, Tag  # noqa: E402


def robots(payload: dict) -> dict:
    parsed = agentic_check.parse_robots(payload["text"])
    agents = []
    for token, _vendor, role, _behaviour in agentic_check.AI_AGENTS:
        selected = agentic_check.select_group(parsed, token)
        agents.append(
            {
                "token": token,
                "role": role,
                "group": selected["matched"],
                "root_allowed": agentic_check.is_allowed(selected["rules"], "/"),
            }
        )
    named = [a["token"] for a in agents if a["group"] == "named"]
    blocked_search = [a["token"] for a in agents if a["role"] == "search" and not a["root_allowed"]]
    blocked_user = [a["token"] for a in agents if a["role"] == "user" and not a["root_allowed"]]
    nonstandard = list(
        dict.fromkeys(
            agent[:80]
            for g in parsed["groups"]
            for agent in g["agents"]
            if agent != "*" and not agentic_check._PRODUCT_TOKEN.fullmatch(agent)
        )
    )[:20]
    return {
        "agents": agents,
        "sitemaps": parsed["sitemap"],
        "nonstandard": nonstandard,
        "ai_groups_status": "warn" if blocked_search else ("pass" if named else "info"),
        "user_agents_status": "info" if blocked_user else "pass",
        "tokens": [token for token, *_ in agentic_check.AI_AGENTS],
    }


def llms(payload: dict) -> dict:
    return agentic_check._lighthouse_llms_txt(payload["status"], payload["content"])


def content(payload: dict) -> dict:
    return content_quality.analyse(payload["text"])


def metadata(payload: dict) -> dict:
    return metadata_template.analyse(
        payload.get("title", ""), payload.get("description", ""), payload.get("url")
    )


def metadata_site(payload: dict) -> dict:
    return metadata_template.analyse_pairs(payload["pairs"])


def html_text(payload: dict) -> list:
    """Each case as page text, in an attribute, before "=" and before a letter, read as page_checks reads a page."""
    out = []
    for case in payload["cases"]:
        soup = BeautifulSoup(
            f'<html><head><title>A{case}B</title><meta name="a" content="A{case}B"><meta name="b" content="A{case}=B">'
            f'<meta name="c" content="A{case}xB"></head><body><p>A{case}B</p></body></html>',
            page_checks._HTML_PARSER,
        )
        out.append(
            [
                soup.title.string if soup.title else None,
                *(
                    soup.find("meta", attrs={"name": name}).get("content")
                    for name in ("a", "b", "c")
                ),
                soup.p.get_text() if soup.p else None,
            ]
        )
    return out


def json_errors(payload: dict) -> list:
    """What page_checks writes after "block N: " for each text, or None when json.loads reads it."""
    out = []
    for text in payload["texts"]:
        try:
            json.loads(text)
            out.append(None)
        except RecursionError:
            out.append("nested too deeply to parse")
        except ValueError as exc:
            out.append(str(exc))
    return out


def pages(payload: dict) -> list:
    """page_checks.run_checks on each page, as parity.test.ts compares one page."""
    out = []
    for page in payload["pages"]:
        try:
            result = page_checks.run_checks(
                page["html"], page["url"], page.get("headers"), html_bytes=page.get("bytes")
            )
        except Exception as exc:  # noqa: BLE001 - the port must fail the same way
            out.append({"error": f"{type(exc).__name__}: {exc}"})
            continue
        out.append(
            {
                "findings": [
                    {
                        "id": f["id"],
                        "severity": f["severity"],
                        "count": f.get("count"),
                        "evidence": f.get("evidence"),
                    }
                    for f in result["findings"]
                ],
                "not_checked": [entry["id"] for entry in result["not_checked"]],
                "facts": result["facts"],
                "checks_run": result["summary"]["checks_run"],
                "headers_available": result["headers_available"],
            }
        )
    return out


def py_text(payload: dict) -> list:
    """What Python's string methods give for each text, for py.ts."""
    out = []
    for text in payload["texts"]:
        out.append(
            [
                text.lower(),
                text.strip(),
                text.lstrip(),
                text.rstrip(),
                text.split(),
                repr(text),
                [ch.isalnum() for ch in text],
                [ch.isalpha() for ch in text],
                [ch.isspace() for ch in text],
                [bool(re.match(r"\w", ch)) for ch in text],
                [bool(re.match(r"\d", ch)) for ch in text],
                [m.start() for m in re.finditer(r"\b", text)],
                text.strip("._- "),
            ]
        )
    return {"each": out, "sorted": sorted(payload["texts"])}


def _tree(node) -> list:
    out = []
    for child in node.children:
        if isinstance(child, Tag):
            out.append(
                [
                    child.name,
                    {
                        k: (" ".join(v) if isinstance(v, list) else v)
                        for k, v in child.attrs.items()
                    },
                    _tree(child),
                ]
            )
        elif isinstance(child, NavigableString):
            out.append([type(child).__name__, str(child)])
    return out


def trees(payload: dict) -> list:
    """The tree BeautifulSoup builds with lxml for each document: elements, strings and their kinds."""
    return [_tree(BeautifulSoup(html, page_checks._HTML_PARSER)) for html in payload["documents"]]


def decode(payload: dict) -> list:
    """url_safety.decode_body on each case's bytes (base64) and Content-Type."""
    import base64

    import url_safety

    out = []
    for case in payload["cases"]:
        try:
            out.append(
                url_safety.decode_body(base64.b64decode(case["bytes"]), case["content_type"])
            )
        except Exception as exc:  # noqa: BLE001 - the port must fail the same way
            out.append({"error": f"{type(exc).__name__}: {exc}"})
    return out


def batch(handler, key: str, field: str):
    """A handler that reads one input at a time, run on a list of them."""
    return lambda payload: [
        handler({field: value}) if field else handler(value) for value in payload[key]
    ]


HANDLERS = {
    "robots": robots,
    "llms": llms,
    "content": content,
    "metadata": metadata,
    "metadata-site": metadata_site,
    "html-text": html_text,
    "json-errors": json_errors,
    "pages": pages,
    "decode": decode,
    "trees": trees,
    "py-text": py_text,
    "robots-batch": batch(robots, "texts", "text"),
    "llms-batch": lambda payload: [
        llms({"status": 200, "content": text}) for text in payload["texts"]
    ],
    "content-batch": batch(content, "texts", "text"),
    "metadata-batch": batch(metadata, "pairs", ""),
}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    print(json.dumps(HANDLERS[sys.argv[1]](json.loads(sys.stdin.read())), ensure_ascii=False))
