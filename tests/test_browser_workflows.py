"""Real Chromium, temporary database and fake research only; invoked by the Docker suite."""

from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
BROWSER_PYTHON = Path("/opt/argus-tools/flaresolverr-venv/bin/python")


class BrowserWorkflows(unittest.TestCase):

    @unittest.skipUnless(
        BROWSER_PYTHON.exists() and shutil.which("chromium"),
        "Requires bundled Chromium runtime",
    )
    def test_real_ui_workflows(self):
        result = subprocess.run(
            [str(BROWSER_PYTHON), str(ROOT / "tests/browser_workspace.py")],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=240,
        )
        self.assertEqual(result.returncode, 0, result.stdout[-16000:])
        self.assertIn('"status": "ok"', result.stdout)
