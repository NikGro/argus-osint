"""Reject a stale checked-in frontend bundle without requiring Node in the image."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "static/build-manifest.json").read_text())
for relative, digest in manifest["sources"].items():
    if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != digest:
        raise SystemExit("Stale frontend source: " + relative)
if (
    hashlib.sha256((ROOT / "static/app.js").read_bytes()).hexdigest()
    != manifest["bundle_sha256"]
):
    raise SystemExit("Stale frontend bundle")
print("Frontend manifest verified")
