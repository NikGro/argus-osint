"""Install the pinned Blackbird source in its own environment inside the image."""

import io
from pathlib import Path
import subprocess
import tarfile
import urllib.request

SHA = "b45505080ef51bb3ef52dc29879ee6bef31e5b94"
root = Path("/opt/argus-tools")
root.mkdir(parents=True, exist_ok=True)
data = urllib.request.urlopen(
    "https://codeload.github.com/p1ngul1n0/blackbird/tar.gz/" + SHA, timeout=60
).read()
archive = tarfile.open(fileobj=io.BytesIO(data))
archive.extractall(root, filter="data")
(root / ("blackbird-" + SHA)).rename(root / "blackbird")
subprocess.run(["python", "-m", "venv", str(root / "blackbird-venv")], check=True)
subprocess.run(
    [
        str(root / "blackbird-venv/bin/pip"),
        "install",
        "--no-cache-dir",
        "-r",
        str(root / "blackbird/requirements.txt"),
    ],
    check=True,
)
