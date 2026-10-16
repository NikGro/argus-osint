"""Build-time union of the actual installed tool catalogues; no account queries."""

import importlib.util
import json
from pathlib import Path
import unicodedata
from urllib.parse import urlsplit
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
seeds = json.loads((ROOT / "providers" / "aliases.json").read_text())


def key(value):
    normalized = unicodedata.normalize("NFKC", str(value)).strip().casefold()
    return "".join(c for c in normalized if c.isalnum()) or normalized


aliases = {
    key(alias): id
    for id, entry in seeds.items()
    for alias in [id, entry["name"], *entry.get("aliases", [])]
}
providers = {
    id: {
        "id": id,
        "name": entry["name"],
        "aliases": entry.get("aliases", []),
        "hosts": entry.get("hosts", []),
        "sources": {},
        "case_insensitive": entry.get("case_insensitive", False),
    }
    for id, entry in seeds.items()
}


def add(tool, kind, name, service=None, main_url=None):
    if not str(name).strip() or str(name) == "$schema":
        return
    id = aliases.get(key(name), key(name))
    if not id:
        return
    record = providers.setdefault(
        id,
        {
            "id": id,
            "name": str(name),
            "aliases": [],
            "hosts": [],
            "sources": {},
            "case_insensitive": False,
        },
    )
    if name != record["name"] and name not in record["aliases"]:
        record["aliases"].append(name)
    entries = record["sources"].setdefault(tool, {}).setdefault(kind, [])
    if (service or name) not in entries:
        entries.append(service or name)
    if main_url:
        host = (urlsplit(str(main_url)).hostname or "").lower().removeprefix("www.")
        if host and host not in record["hosts"]:
            record["hosts"].append(host)


def package(name):
    spec = importlib.util.find_spec(name)
    if spec is None or not spec.origin:
        raise RuntimeError("Provider catalogue package missing: " + name)
    return Path(spec.origin).parent


sherlock = json.loads(
    (package("sherlock_project") / "resources" / "data.json").read_text()
)
for name, site in sherlock.items():
    if isinstance(site, dict):
        add("sherlock", "username", name, main_url=site.get("urlMain"))
maigret = json.loads((package("maigret") / "resources" / "data.json").read_text())
for name, site in maigret["sites"].items():
    add("maigret", "username", name, main_url=site.get("urlMain"))
root = package("user_scanner")
for kind, folder in [("username", "user_scan"), ("email", "email_scan")]:
    for file in sorted((root / folder).glob("*/*.py")):
        if file.stem.startswith("_"):
            continue
        name = file.stem.capitalize().replace("_", ".")
        if name == "X":
            name = "X (Twitter)"
        add("user_scanner", kind, name, file.stem)
for tool, kind in [("holehe", "email"), ("ignorant", "phone")]:
    for file in sorted((package(tool) / "modules").rglob("*.py")):
        if not file.stem.startswith("_"):
            add(tool, kind, file.stem, file.stem)
blackbird = Path("/opt/argus-tools/blackbird/data")
wmn = blackbird / "wmn-data.json"
if not wmn.exists():
    with urllib.request.urlopen(
        "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json",
        timeout=40,
    ) as response:
        content = response.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        raise RuntimeError("Blackbird catalogue too large")
    wmn.write_bytes(content)
for kind, file in [("username", wmn), ("email", blackbird / "email-data.json")]:
    for site in json.loads(file.read_text())["sites"]:
        add(
            "blackbird",
            kind,
            site["name"],
            main_url=site.get("uri_pretty") or site.get("uri_check"),
        )
result = {
    "version": 1,
    "providers": sorted(providers.values(), key=lambda p: p["name"].casefold()),
}
(ROOT / "providers" / "catalogue.json").write_text(
    json.dumps(result, ensure_ascii=False, separators=(",", ":"))
)
print(
    "Provider catalogue: "
    + str(len(result["providers"]))
    + " canonical providers from all installed research tools"
)
