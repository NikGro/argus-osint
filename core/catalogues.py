"""Provider catalogues built from the research tools that are installed.

The research tools are downloaded on demand, so the catalogues that list
their websites, tags and aliases are rebuilt after every tool installation
or removal. They live next to the tools in the data volume. Tools that are
not installed simply contribute nothing.
"""

import json
import logging
from pathlib import Path
import subprocess
import unicodedata
from urllib.parse import urlsplit
import urllib.request

from core import tools

ROOT = Path(__file__).resolve().parents[1]
LOG = logging.getLogger("argus.catalogues")
PROVIDERS = "catalogue.json"
PROFILES = "research-profiles.json"
WMN = "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json"
TOP = [{"id": f"top:{n}", "label": f"Top {n}", "top": n} for n in (50, 100, 500)]
CONSENSUS_TAGS = """
import json
from pathlib import Path
import consensus_osint
from consensus_osint.core.modules import all_modules
from consensus_osint.core.phone import SERVICES
data = json.loads((Path(consensus_osint.__file__).parent / "data/sites.json").read_text())
sites = data["sites"] if isinstance(data, dict) else data
out = {kind: set() for kind in ("username", "email", "phone")}
for site in sites:
    out["username"].update(site.get("tags", []))
    if site.get("category"): out["username"].add(site["category"])
for module in all_modules():
    if module.kind in out:
        out[module.kind].update(module.tags)
        out[module.kind].add(module.category)
out["phone"].update(value[1] for value in SERVICES.values())
print(json.dumps({k: sorted(v) for k,v in out.items()}))
"""


def path(name):
    return tools.root() / name


def key(value):
    normalized = unicodedata.normalize("NFKC", str(value)).strip().casefold()
    return "".join(c for c in normalized if c.isalnum()) or normalized


def package(tool, name):
    """Directory of a Python package inside a tool's environment, or None."""
    if not tools.installed(tool):
        return None
    try:
        candidate = tools.site_packages(tool) / name
    except Exception:
        return None
    return candidate if candidate.is_dir() else None


def blackbird_data():
    if not tools.installed("blackbird"):
        return None
    data = tools.source("blackbird") / "data"
    wmn = data / "wmn-data.json"
    if not wmn.exists():
        with urllib.request.urlopen(WMN, timeout=40) as response:
            content = response.read(8 * 1024 * 1024 + 1)
        if len(content) > 8 * 1024 * 1024:
            raise RuntimeError("Blackbird catalogue too large")
        wmn.write_bytes(content)
    return data


def tags(values):
    return [
        {"id": "tag:" + tag, "label": tag.replace("_", " ").capitalize(), "tag": tag}
        for tag in sorted(set(str(v).lower() for v in values if v))
    ]


def providers():
    seeds = json.loads((ROOT / "providers" / "aliases.json").read_text())
    aliases = {
        key(alias): pid
        for pid, entry in seeds.items()
        for alias in [pid, entry["name"], *entry.get("aliases", [])]
    }
    records = {
        pid: {
            "id": pid,
            "name": entry["name"],
            "aliases": entry.get("aliases", []),
            "hosts": entry.get("hosts", []),
            "sources": {},
            "case_insensitive": entry.get("case_insensitive", False),
        }
        for pid, entry in seeds.items()
    }

    def add(tool, kind, name, service=None, main_url=None):
        if not str(name).strip() or str(name) == "$schema":
            return
        pid = aliases.get(key(name), key(name))
        if not pid:
            return
        record = records.setdefault(
            pid,
            {
                "id": pid,
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
            host = (urlsplit(str(main_url)).hostname or "").lower()
            host = host.removeprefix("www.")
            if host and host not in record["hosts"]:
                record["hosts"].append(host)

    sherlock = package("sherlock", "sherlock_project")
    if sherlock:
        data = json.loads((sherlock / "resources" / "data.json").read_text())
        for name, site in data.items():
            if isinstance(site, dict):
                add("sherlock", "username", name, main_url=site.get("urlMain"))
    maigret = package("maigret", "maigret")
    if maigret:
        data = json.loads((maigret / "resources" / "data.json").read_text())
        for name, site in data["sites"].items():
            add("maigret", "username", name, main_url=site.get("urlMain"))
    scanner = package("user_scanner", "user_scanner")
    if scanner:
        for kind, folder in [("username", "user_scan"), ("email", "email_scan")]:
            for file in sorted((scanner / folder).glob("*/*.py")):
                if file.stem.startswith("_"):
                    continue
                name = file.stem.capitalize().replace("_", ".")
                add(
                    "user_scanner",
                    kind,
                    "X (Twitter)" if name == "X" else name,
                    file.stem,
                )
    for tool, kind in [("holehe", "email"), ("ignorant", "phone")]:
        root = package(tool, tool)
        if root:
            for file in sorted((root / "modules").rglob("*.py")):
                if not file.stem.startswith("_"):
                    add(tool, kind, file.stem, file.stem)
    blackbird = blackbird_data()
    if blackbird:
        for kind, file in [("username", "wmn-data.json"), ("email", "email-data.json")]:
            for site in json.loads((blackbird / file).read_text())["sites"]:
                add(
                    "blackbird",
                    kind,
                    site["name"],
                    main_url=site.get("uri_pretty") or site.get("uri_check"),
                )
    return {
        "version": 1,
        "providers": sorted(records.values(), key=lambda p: p["name"].casefold()),
    }


def profiles():
    result = {
        "username": {"sherlock": []},
        "email": {"holehe": []},
        "phone": {"ignorant": []},
    }
    maigret = package("maigret", "maigret")
    if maigret:
        data = json.loads((maigret / "resources/data.json").read_text())
        result["username"]["maigret"] = TOP + tags(
            tag for site in data["sites"].values() for tag in site.get("tags", [])
        )
    scanner = package("user_scanner", "user_scanner")
    blackbird = blackbird_data()
    for kind, folder, file in [
        ("username", "user_scan", "wmn-data.json"),
        ("email", "email_scan", "email-data.json"),
    ]:
        if scanner:
            result[kind]["user_scanner"] = tags(
                entry.name
                for entry in (scanner / folder).iterdir()
                if entry.is_dir() and not entry.name.startswith("_")
            )
        if blackbird:
            data = json.loads((blackbird / file).read_text())
            result[kind]["blackbird"] = tags(site.get("cat") for site in data["sites"])
    if tools.installed("consensus"):
        completed = subprocess.run(
            [tools.python("consensus"), "-I", "-c", CONSENSUS_TAGS],
            check=True,
            capture_output=True,
            text=True,
        )
        for kind, values in json.loads(completed.stdout).items():
            result[kind]["consensus"] = (TOP if kind == "username" else []) + tags(
                values
            )
    return result


def _write(name, value):
    target = path(name)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    temporary.replace(target)


def build():
    """Rebuild both catalogues; a failing tool must not break the others."""
    for name, builder in ((PROVIDERS, providers), (PROFILES, profiles)):
        try:
            _write(name, builder())
        except Exception:
            LOG.exception("Catalogue %s could not be built", name)
    refresh()


def refresh():
    from core import provider_registry
    from plugins import _search_profiles

    provider_registry.catalogue.cache_clear()
    provider_registry.index.cache_clear()
    _search_profiles.catalogue.cache_clear()


def load(name):
    file = path(name)
    if file.exists():
        try:
            return json.loads(file.read_text(encoding="utf-8"))
        except ValueError:
            return None
    return None
