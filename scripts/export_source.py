"""Export a public beta source snapshot with an explicit allowlist, never user data."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = {
    ".github",
    "core",
    "plugins",
    "data_plugins",
    "providers",
    "static",
    "scripts",
    "tests",
    "examples",
    "docs",
    "deploy",
}
ROOT_FILES = {
    ".dockerignore",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".env.example",
    ".prettierrc.json",
    ".prettierignore",
    "Dockerfile",
    "LICENSE",
    "VERSION",
    "requirements-media.txt",
    "TEST_QUEUE.md",
    "AGENTS.md",
    "deploy/Dockerfile.vpn",
    "compose.vpn.yaml",
    "RELEASE_NOTES.md",
    "compose.standalone.yaml",
    "README.md",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "THIRD_PARTY.md",
    "SECURITY.md",
    "pyproject.toml",
    "package.json",
    "package-lock.json",
    "eslint.config.js",
    "requirements.txt",
    "requirements-core.txt",
    "requirements-dev.txt",
    "requirements-test.txt",
    "server.py",
    "plugin_manager.py",
    "provider_registry.py",
    "result_groups.py",
    "node_metadata.py",
    "community_runner.py",
}
SUFFIXES = {
    ".py",
    ".js",
    ".jsx",
    ".cjs",
    ".mjs",
    ".json",
    ".html",
    ".css",
    ".svg",
    ".png",
    ".txt",
    ".md",
    ".toml",
    ".yml",
    ".yaml",
    ".conf",
}
PRIVATE = re.compile(
    rb"sk-proj-[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)


def payloads():
    for file in sorted(ROOT.rglob("*")):
        relative = file.relative_to(ROOT)
        if not file.is_file() or file.is_symlink():
            continue
        if any(
            part
            in {
                "node_modules",
                "__pycache__",
                ".git",
                ".development",
                "data",
                ".venv",
                ".secrets",
            }
            for part in relative.parts
        ):
            continue
        if relative.as_posix() not in ROOT_FILES:
            if relative.parts[0] not in DIRECTORIES or (
                file.suffix not in SUFFIXES
                and relative.as_posix()
                not in {"deploy/apparmor-argus", "deploy/LICENSE.moby"}
            ):
                continue
            if any(
                part.startswith(".") for part in relative.parts if part != ".github"
            ):
                continue
        if (
            relative.as_posix().startswith("tests/fixtures/")
            and file.name != "frontend-manifest.json"
        ):
            continue  # Retired snapshots; active tests import the production bundle.
        if relative.as_posix() in {
            "docs/test-history.md",
            "docs/revision-history.md",
            "docs/ui-audit-v025.md",
            "docs/worker-runtime.override.yaml",
        }:
            continue
        if relative.parts[0] == "scripts" and file.name not in {
            "build_frontend.mjs",
            "build_provider_catalogue.py",
            "build_research_profiles.py",
            "verify_frontend.py",
            "export_source.py",
            "container_entry.py",
            "install_browser_tool.py",
            "install_consensus.py",
            "install_deepface.py",
            "install_instagram_tool.py",
            "install_phoneinfoga.py",
            "install_research_tools.py",
            "install_toutatis.py",
        }:
            continue
        content = file.read_bytes()
        if PRIVATE.search(content):
            raise ValueError(
                "Possible private key in export source: " + relative.as_posix()
            )
        yield relative.as_posix(), content
    # Application-only default, never the private Synology management Compose file.
    yield "compose.yaml", (ROOT / "compose.standalone.yaml").read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--commit", default="uncommitted snapshot")
    args = parser.parse_args()
    items = list(payloads())
    manifest = {
        "version": json.loads((ROOT / "package.json").read_text())["version"],
        "source_commit": args.commit,
        "purpose": "Public beta source; no user data, credentials, Git history or Synology management services",
        "files": {name: hashlib.sha256(content).hexdigest() for name, content in items},
    }
    items.append(
        ("SOURCE-MANIFEST.json", (json.dumps(manifest, indent=2) + "\n").encode())
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for name, content in items:
            info = zipfile.ZipInfo(
                "argus-" + manifest["version"] + "/" + name, (2026, 10, 15, 0, 0, 0)
            )
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    print(
        json.dumps(
            {
                "path": str(args.output.resolve()),
                "files": len(items),
                "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
