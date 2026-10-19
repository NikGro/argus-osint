"""Locale lookup by stable ID. Legacy aliases exist only for persisted labels."""

import functools
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@functools.lru_cache(maxsize=8)
def catalogue(language):
    if language not in {"de", "en"}:
        language = "en"
    return json.loads(
        (ROOT / "static" / "locales" / (language + ".json")).read_text(encoding="utf-8")
    )["messages"]


def text(language, key, **parameters):
    value = catalogue(language).get(key, catalogue("en").get(key, key))
    for name, item in parameters.items():
        value = value.replace("{" + name + "}", str(item))
    return value
