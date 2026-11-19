"""Calls the functions of scripts/ that have no command line of their own.

Reads one JSON object on stdin and prints the script's answer as JSON, for
osg/tests/parity.test.ts:

    python osg/tests/harness.py robots < payload.json
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import agentic_check  # noqa: E402
import content_quality  # noqa: E402
import metadata_template  # noqa: E402
import page_checks  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402


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


HANDLERS = {
    "robots": robots,
    "llms": llms,
    "content": content,
    "metadata": metadata,
    "metadata-site": metadata_site,
    "html-text": html_text,
    "json-errors": json_errors,
}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    print(json.dumps(HANDLERS[sys.argv[1]](json.loads(sys.stdin.read())), ensure_ascii=False))
