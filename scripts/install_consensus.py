"""Install a reviewed commit in a separate environment; keep upstream license notices."""

import io
from pathlib import Path
import subprocess
import tarfile
import urllib.request

SHA = "6cd61891bf5ba3ade7788b4033cf751cac5551ed"
root = Path("/opt/argus-tools")
data = urllib.request.urlopen(
    "https://codeload.github.com/OSINT-Experts-Society/Consensus-OSINT/tar.gz/" + SHA,
    timeout=60,
).read()
with tarfile.open(fileobj=io.BytesIO(data)) as archive:
    archive.extractall(root, filter="data")
source = root / ("Consensus-OSINT-" + SHA)
source.rename(root / "consensus")
venv = root / "consensus-venv"
subprocess.run(["python", "-m", "venv", str(venv)], check=True)
subprocess.run(
    [
        str(venv / "bin/pip"),
        "install",
        "--no-cache-dir",
        str(root / "consensus") + "[modules]",
    ],
    check=True,
)
subprocess.run([str(venv / "bin/consensus"), "version"], check=True)
