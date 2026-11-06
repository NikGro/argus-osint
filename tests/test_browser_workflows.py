"""Real Chromium, temporary database and fake research only; invoked by the Docker suite."""

from pathlib import Path
import shutil
import subprocess
import unittest

import tool_stubs
from core import tools

ROOT = Path(__file__).resolve().parents[1]


class BrowserWorkflows(unittest.TestCase):

    @unittest.skipUnless(
        tool_stubs.real("flaresolverr") and shutil.which("chromium"),
        "Requires bundled Chromium runtime",
    )
    def test_real_ui_workflows(self):
        result = subprocess.run(
            [tools.python("flaresolverr"), str(ROOT / "tests/browser_workspace.py")],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=240,
        )
        self.assertEqual(result.returncode, 0, result.stdout[-16000:])
        self.assertIn('"status": "ok"', result.stdout)
