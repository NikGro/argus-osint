"""Read installed upstream metadata at image build time, without account queries."""

import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def package(name):
    return Path(importlib.util.find_spec(name).origin).parent


def tags(values):
    return [
        {"id": "tag:" + tag, "label": tag.replace("_", " ").capitalize(), "tag": tag}
        for tag in sorted(set(str(v).lower() for v in values if v))
    ]


top = [
    {"id": "top:" + str(n), "label": "Top " + str(n), "top": n} for n in (50, 100, 500)
]
result = {
    "username": {"sherlock": []},
    "email": {"holehe": []},
    "phone": {"ignorant": []},
}
maigret = json.loads((package("maigret") / "resources/data.json").read_text())
result["username"]["maigret"] = top + tags(
    tag for site in maigret["sites"].values() for tag in site.get("tags", [])
)
for kind, folder, blackbird_file in [
    ("username", "user_scan", "wmn-data.json"),
    ("email", "email_scan", "email-data.json"),
]:
    result[kind]["user_scanner"] = tags(
        path.name
        for path in (package("user_scanner") / folder).iterdir()
        if path.is_dir() and not path.name.startswith("_")
    )
    data = json.loads(
        (Path("/opt/argus-tools/blackbird/data") / blackbird_file).read_text()
    )
    result[kind]["blackbird"] = tags(site.get("cat") for site in data["sites"])

code = """
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
completed = subprocess.run(
    ["/opt/argus-tools/consensus-venv/bin/python", "-I", "-c", code],
    check=True,
    capture_output=True,
    text=True,
    timeout=60,
)
for kind, values in json.loads(completed.stdout).items():
    result[kind]["consensus"] = (top if kind == "username" else []) + tags(values)
(ROOT / "providers/research-profiles.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("Research profile catalogues generated from installed providers.")
