"""Write plugins/native.json: the official plugin catalogue shipped in the image.

Native plugins are not installed by default. Installing one downloads the
files listed here from the ARGUS repository at the image's source revision and
accepts them only if every SHA-256 matches, then installs the listed tools.
Run with --check in CI to verify the committed catalogue is current.
"""

import argparse
import hashlib
import importlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

REPOSITORY = "NikGro/argus-osint"
# Entry modules of installable plugins. Underscore modules and the source
# helpers (holehe, maigret, phoneinfoga, profiles) remain part of the core.
NATIVE = [
    "username",
    "email",
    "phone",
    "deep_research",
    "instagram",
    "deepface_tool",
    "database_search",
    "location",
    "metadata",
    "image_crop",
    "video",
    "merge",
    "transform",
]
TARGET = ROOT / "plugins" / "native.json"
IGNORE = ROOT / ".dockerignore"
BEGIN = "# >>> native plugins (written by scripts/build_plugin_manifest.py)"
END = "# <<< native plugins"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    from core.tools import RECIPES

    plugins = []
    for name in NATIVE:
        module = importlib.import_module("plugins." + name)
        descriptor = json.loads(json.dumps(module.PLUGIN))
        pid = descriptor["id"]
        files = {f"plugins/{name}.py": digest(ROOT / "plugins" / f"{name}.py")}
        locale = ROOT / "plugins" / "locales" / f"{pid}.json"
        if locale.exists():
            files[f"plugins/locales/{pid}.json"] = digest(locale)
            descriptor["translations"] = json.loads(locale.read_text(encoding="utf-8"))
        tools = descriptor.pop("tools", [])
        unknown = set(tools) - set(RECIPES)
        if unknown:
            raise SystemExit(f"{pid}: unknown tools {sorted(unknown)}")
        plugins.append(
            {
                "id": pid,
                "module": f"plugins/{name}.py",
                "files": files,
                "tools": tools,
                "descriptor": descriptor,
            }
        )
    return {"schema_version": 1, "repository": REPOSITORY, "plugins": plugins}


def render():
    return json.dumps(build(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def ignore_rules(catalogue):
    """The image leaves native plugin files out; they are downloaded on demand."""
    current = IGNORE.read_text(encoding="utf-8") if IGNORE.exists() else ""
    head = current.split(BEGIN)[0].rstrip("\n")
    tail = current.split(END, 1)[1].lstrip("\n") if END in current else ""
    files = sorted(path for p in catalogue["plugins"] for path in p["files"])
    block = "\n".join([BEGIN, *files, END])
    return head + "\n" + block + "\n" + (tail and tail)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content = render()
    rules = ignore_rules(json.loads(content))
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != content:
            raise SystemExit(
                "plugins/native.json is outdated: run python scripts/build_plugin_manifest.py"
            )
        if IGNORE.read_text(encoding="utf-8") != rules:
            raise SystemExit(
                ".dockerignore is outdated: run python scripts/build_plugin_manifest.py"
            )
        print("Plugin catalogue current")
        return
    TARGET.write_text(content, encoding="utf-8")
    IGNORE.write_text(rules, encoding="utf-8")
    print(
        f"Wrote {TARGET.relative_to(ROOT)} ({len(json.loads(content)['plugins'])} plugins)"
    )


if __name__ == "__main__":
    main()
