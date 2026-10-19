"""Install the pinned upstream release inside the Docker image, not on the host."""

import hashlib
import io
from pathlib import Path
import platform
import sys
import tarfile
import urllib.request

VERSION = "v2.11.0"
arch = {"x86_64": "x86_64", "aarch64": "arm64", "arm64": "arm64"}.get(
    platform.machine()
)
if not arch:
    raise SystemExit("PhoneInfoga: unsupported architecture " + platform.machine())
name = "phoneinfoga_Linux_" + arch + ".tar.gz"
base = "https://github.com/sundowndev/phoneinfoga/releases/download/" + VERSION + "/"


def fetch(name, limit):
    with urllib.request.urlopen(
        urllib.request.Request(
            base + name, headers={"User-Agent": "ArgusDockerBuild/0.6"}
        ),
        timeout=60,
    ) as response:
        payload = response.read(limit + 1)
    if len(payload) > limit:
        raise SystemExit("PhoneInfoga download too large")
    return payload


checksums = fetch("phoneinfoga_checksums.txt", 65536).decode()
expected = next(
    line.split()[0]
    for line in checksums.splitlines()
    if line.split()[-1].lstrip("*") == name
)
payload = fetch(name, 30 * 1024 * 1024)
if hashlib.sha256(payload).hexdigest() != expected:
    raise SystemExit("PhoneInfoga checksum mismatch")
with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
    member = next(
        item
        for item in archive.getmembers()
        if Path(item.name).name == "phoneinfoga" and item.isfile()
    )
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/local/bin/phoneinfoga")
    target.write_bytes(archive.extractfile(member).read())
    target.chmod(0o755)
