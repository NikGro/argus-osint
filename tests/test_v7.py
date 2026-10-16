import json
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig
import unittest
from unittest.mock import patch
from plugins import holehe, maigret


class V7Tests(unittest.TestCase):
    def test_holehe_child_uses_isolated_imports(self):
        node = {
            "id": "email",
            "type": "email",
            "data": {"value": "example@example.com"},
        }
        with patch.object(
            holehe, "bounded_run", return_value=('{"rows":[]}', "")
        ) as child:
            holehe.run("lookup", [node], {}, {})
        self.assertEqual(child.call_args.args[0][:2], [sys.executable, "-I"])

    @unittest.skipUnless(
        (Path(sysconfig.get_path("purelib")) / "holehe").exists(),
        "Holehe system package absent locally",
    )
    def test_real_holehe_child_import_from_plugin_directory(self):
        runner = Path(__file__).resolve().parents[1] / "plugins" / "_holehe_runner.py"
        child = subprocess.run(
            [sys.executable, "-I", str(runner), "--self-test"],
            cwd=runner.parent,
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(child.returncode, 0, child.stderr)
        result = json.loads(child.stdout)
        self.assertGreater(result["providers"], 100)
        self.assertNotIn("/plugins/holehe.py", result["package"])

    def test_maigret_retains_profile_facts_and_sources(self):
        row = {
            "url_user": "https://example.com/alice",
            "status": {
                "status": "Claimed",
                "ids_data": {"fullname": "Test Name", "location": "Test City"},
            },
        }
        outputs, warnings = maigret.parse_results(
            {"Example": row}, {"id": "input"}, 100
        )
        self.assertEqual([o["type"] for o in outputs], ["url", "value", "value"])
        self.assertEqual(outputs[1]["source"]["result"], row)
        self.assertEqual(warnings, [])

    def test_maigret_rejects_inconclusive_and_invalid_links(self):
        outputs, _ = maigret.parse_results(
            {
                "Blocked": {
                    "url_user": "https://example.com/x",
                    "status": {"status": "Unknown"},
                },
                "Bad": {"url_user": "file:///etc/passwd"},
            },
            {"id": "x"},
            10,
        )
        self.assertEqual(outputs, [])

    def test_maigret_invalid_input_does_not_launch(self):
        with patch.object(maigret, "bounded_run") as child:
            with self.assertRaises(ValueError):
                maigret.run("search", [{"id": "x", "data": {"value": "../x"}}], {}, {})
        child.assert_not_called()

    @unittest.skipUnless(shutil.which("maigret"), "Maigret CLI absent locally")
    def test_installed_maigret_cli_starts(self):
        child = subprocess.run(
            [shutil.which("maigret"), "--help"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertIn("--json", child.stdout)
        self.assertIn("--no-autoupdate", child.stdout)
