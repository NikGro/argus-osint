"""Run the bundled FlareSolverr engine with the system Chromium as a subprocess.

The browser runs with the application's identity, like every other research
tool. It needs the "flaresolverr" tool; without it the caller falls back to
plain HTTP or reports that the browser is unavailable.
"""

import json
import os
from pathlib import Path
import subprocess

from core import tools

RUNNER = Path(__file__).with_name("_browser_runner.py")


def browser_command():
    """Command and environment for the runner, or None if the tool is missing."""
    if not tools.installed("flaresolverr"):
        return None
    return {
        "command": [tools.python("flaresolverr"), "-I", str(RUNNER)],
        "env": {"ARGUS_FLARESOLVERR_SRC": str(tools.source("flaresolverr"))},
    }


def run_browser(browser, payload):
    """Load one page; browser is the value returned by browser_command()."""
    completed = subprocess.run(
        browser["command"],
        input=json.dumps(payload).encode(),
        capture_output=True,
        env={
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "LANG": "C.UTF-8",
            "HOME": os.environ.get("HOME", "/tmp"),
            **browser["env"],
        },
        check=False,
    )
    if completed.returncode:
        raise ValueError("Browserabruf fehlgeschlagen.")
    return json.loads(completed.stdout)


def fetch(payload):
    browser = browser_command()
    if browser is None:
        raise ValueError("Browser nicht installiert.")
    return run_browser(browser, payload)
