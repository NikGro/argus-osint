"""Install Toutatis separately from application code; import check only, no account lookup."""

import subprocess

PYTHON = "/opt/argus-tools/instagram-venv/bin/python"
subprocess.run(
    [PYTHON, "-m", "pip", "install", "--no-cache-dir", "toutatis==1.31"], check=True
)
subprocess.run(
    [
        PYTHON,
        "-c",
        "from toutatis.core import getInfo, advanced_lookup; assert callable(getInfo) and callable(advanced_lookup); print('Toutatis import OK; no requests executed')",
    ],
    check=True,
)
