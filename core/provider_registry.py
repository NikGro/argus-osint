"""Single shared provider identity, aliases and per-tool routing catalogue."""

import functools
import json
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parents[1]


def key(value):
    normalized = unicodedata.normalize("NFKC", str(value)).strip().casefold()
    return "".join(c for c in normalized if c.isalnum()) or normalized


@functools.lru_cache(maxsize=1)
def catalogue():
    file = ROOT / "providers" / "catalogue.json"
    if file.exists():
        return json.loads(file.read_text())["providers"]
    # Development without a built Docker image retains the explicit seed identities.
    return [
        dict(entry, id=id, sources={})
        for id, entry in json.loads(
            (ROOT / "providers" / "aliases.json").read_text()
        ).items()
    ]


@functools.lru_cache(maxsize=1)
def index():
    return {
        key(alias): record
        for record in catalogue()
        for alias in [record["id"], record["name"], *record.get("aliases", [])]
    }


def resolve(value):
    if str(value).startswith("custom:"):
        return None
    return index().get(key(value))


def canonical(value):
    value = str(value or "").strip()
    record = resolve(value)
    return (
        record["id"]
        if record
        else (
            value if value.startswith("custom:") else "custom:" + value if value else ""
        )
    )


def label(value):
    record = resolve(value)
    return record["name"] if record else str(value or "").removeprefix("custom:")


def identity(value):
    record = resolve(value)
    return record["id"] if record else "custom:" + label(value).strip().casefold()


def services(value, tool, kind):
    record = resolve(value)
    return record.get("sources", {}).get(tool, {}).get(kind, []) if record else []


def ui_catalogue():
    return [
        {"id": p["id"], "name": p["name"], "aliases": p.get("aliases", [])}
        for p in catalogue()
    ]
