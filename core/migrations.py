"""Explicit document migrations, applied once and persisted by the repository."""

import copy
import functools
import json
from pathlib import Path
import re

from core.errors import AppError

VERSION = 2
LEGACY_GERMAN = Path(__file__).with_name("legacy_german.json")


@functools.lru_cache(maxsize=1)
def german():
    """German texts written by ARGUS before it became English-only (schema 1)."""
    return json.loads(LEGACY_GERMAN.read_text(encoding="utf-8"))


def english(text, composed=False):
    """English form of a text ARGUS generated in German; anything else unchanged.

    Exact matches cover fixed labels. Tool results also combined fixed parts
    with data ("Bild 3", "Holehe · Suchprotokoll", "Kandidat 1: 48.1, 11.5");
    with composed=True those parts are translated and the data is kept.
    """
    if not isinstance(text, str) or not text:
        return text
    table = german()
    if text in table:
        return table[text]
    if not composed:
        return text
    numbered = re.fullmatch(r"(.+?) (\d+)", text)
    if numbered and numbered.group(1) in table:
        return table[numbered.group(1)] + " " + numbered.group(2)
    candidate = re.fullmatch(r"Kandidat (\d+): (.+)", text)
    if candidate:
        return "Candidate " + candidate.group(1) + ": " + candidate.group(2)
    if " · " in text:
        return " · ".join(english(part, composed=True) for part in text.split(" · "))
    for prefix in ("Anmeldung: ", "Kontaktdaten: "):
        if text.startswith(prefix):
            return table.get(prefix.strip(": "), prefix) + ": " + text[len(prefix) :]
    return text


def to_english(doc):
    """Schema 2: generated German texts become English; user text stays as typed."""
    for node in doc.get("nodes", []):
        evidence = node.setdefault("evidence", {})
        generated = bool(evidence.get("run_id")) and not evidence.get("label_custom")
        if not evidence.get("label_custom"):
            node["label"] = english(node.get("label"), composed=generated)
        if evidence.get("label_key"):
            evidence["label_key"] = english(evidence["label_key"], composed=True)
        if generated:
            data = node.get("data", {})
            for key in ("title", "message", "value"):
                if isinstance(data.get(key), str):
                    data[key] = english(data[key], composed=key != "value")
    for edge in doc.get("edges", []):
        if edge.get("run_id") and edge.get("label"):
            edge["label"] = english(edge["label"], composed=True)
    for group in doc.get("groups", []):
        if group.get("label_key"):
            group["label_key"] = english(group["label_key"], composed=True)
        if group.get("run_id") and not group.get("label_custom"):
            group["label"] = english(group.get("label"), composed=True)
    for run in doc.get("runs", []):
        for key in ("error",):
            if isinstance(run.get(key), str):
                run[key] = english(run[key], composed=True)
        if isinstance(run.get("warnings"), list):
            run["warnings"] = [english(w, composed=True) for w in run["warnings"]]


def migrate(document):
    doc = copy.deepcopy(document)
    version = doc.get("schema_version", 0)
    if type(version) is not int or version < 0 or version > VERSION:
        raise AppError("unsupported_schema", 422)
    if version == 0:
        for node in doc.get("nodes", []):
            data = node.get("data", {})
            if node.get("type") == "actor":
                legacy = {
                    "profiles": "username",
                    "maigret": "username",
                    "holehe": "email",
                    "phoneinfoga": "phone",
                }
                old = data.get("plugin")
                if old in legacy:
                    params = data.setdefault("params", {})
                    if "sites" in params:
                        params[
                            {
                                "profiles": "sherlock_sites",
                                "maigret": "maigret_sites",
                                "holehe": "holehe_sites",
                            }.get(old, "sites")
                        ] = params.pop("sites")
                    if old == "holehe" and params.get("run_timeout") == 120:
                        params["run_timeout"] = 300
                    node.setdefault("evidence", {})["legacy_plugin"] = old
                    data["plugin"], data["action"] = legacy[old], "lookup"
                if data.get("plugin") == "deep_research":
                    data.setdefault("params", {}).pop("argus_flaresolverr_url", None)
            if (
                node.get("type") == "datetime"
                and data.get("value")
                and not data.get("date")
            ):
                raw = str(data["value"])
                data["date"] = raw[:10]
                data["time"] = raw[11:19] if len(raw) > 10 else ""
        doc["schema_version"] = 1
        version = 1
    if version == 1:
        to_english(doc)
        doc["schema_version"] = 2
    return doc
