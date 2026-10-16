import unittest
from unittest.mock import patch
import subprocess
from pathlib import Path
import tempfile
import os
import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TEMP = tempfile.TemporaryDirectory()
os.environ["DATA_DIR"] = TEMP.name

from plugins import profiles
import server

CSV = """username,name,url_main,url_user,exists,http_status,response_time_s
example,GitHub,https://github.com,https://github.com/example,Claimed,200,0.1
example,Missing,https://missing.example,https://missing.example/example,Available,404,0.1
example,Blocked,https://blocked.example,https://blocked.example/example,Unknown,403,0.1
"""
NODE = {
    "id": "input",
    "type": "username",
    "label": "example",
    "data": {"value": "example"},
}


class ProfileTests(unittest.TestCase):
    def test_found_and_inconclusive_are_distinct(self):
        outputs, warnings = profiles.parse_csv(CSV, NODE, 100)
        self.assertEqual([o["type"] for o in outputs], ["url"])
        self.assertNotIn("group", outputs[0])
        self.assertEqual(
            outputs[-1]["source"]["counts"],
            {"found": 1, "not_found": 1, "inconclusive": 1},
        )
        self.assertTrue(warnings)

    def test_unknown_csv_rejected(self):
        with self.assertRaises(ValueError):
            profiles.parse_csv("site,url\na,b", NODE, 100)

    def test_result_limit_does_not_drop_evidence(self):
        csv = (
            CSV
            + "example,Other,https://other.example,https://other.example/example,Claimed,200,0.1\n"
        )
        outputs, warnings = profiles.parse_csv(csv, NODE, 1)
        self.assertEqual(len([o for o in outputs if o["type"] == "url"]), 1)
        self.assertEqual(outputs[-1]["source"]["counts"]["found"], 2)
        self.assertTrue(any("begrenzt" in warning for warning in warnings))

    def test_invalid_username_never_runs_subprocess(self):
        with (
            patch.object(profiles.shutil, "which", return_value="/bin/sherlock"),
            patch.object(profiles.subprocess, "run") as process,
        ):
            for bad in ["../escape", "--help", "a b", "{?}", ".."]:
                with self.assertRaises(ValueError):
                    profiles.search(bad, {})
            process.assert_not_called()

    def test_cli_arguments_and_csv(self):
        def fake_run(args, **kwargs):
            directory = args[args.index("--folderoutput") + 1]
            (Path(directory) / "example.csv").write_text(CSV)
            self.assertEqual(args[-2:], ["--", "example"])
            self.assertEqual(args[args.index("--site") + 1], "GitHub")
            self.assertNotIn("shell", kwargs)
            return subprocess.CompletedProcess(args, 0)

        with (
            patch.object(profiles.shutil, "which", return_value="/bin/sherlock"),
            patch.object(profiles.subprocess, "run", side_effect=fake_run),
        ):
            self.assertEqual(profiles.search("example", {"sites": ["GitHub"]}), CSV)

    def test_timeout_is_not_no_hits(self):
        with (
            patch.object(profiles.shutil, "which", return_value="/bin/sherlock"),
            patch.object(
                profiles.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("sherlock", 120),
            ),
        ):
            with self.assertRaisesRegex(ValueError, "unvollständig"):
                profiles.search("example", {})

    def test_grouped_results_persist_in_graph(self):
        doc = {
            "nodes": [
                NODE,
                {
                    "id": "actor",
                    "type": "actor",
                    "label": "Search",
                    "data": {"plugin": "profiles", "action": "search", "params": {}},
                    "x": 300,
                    "y": 0,
                },
            ],
            "edges": [{"id": "edge", "source": "input", "target": "actor"}],
            "groups": [],
            "runs": [],
        }
        pid = "profile-test"
        import json

        with server.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?)",
                (pid, "Profiles", json.dumps(doc), 1, server.now()),
            )
        with (
            patch.object(profiles, "search", return_value=CSV),
            patch.object(
                server.PLUGINS["username"],
                "run",
                side_effect=lambda a, i, p, c: profiles.run(
                    "search", i, {**p, "max_results": 300, "run_timeout": 180}, c
                ),
            ),
        ):
            result = server.execute(pid, {"revision": 1, "actor_id": "actor"})
        self.assertEqual(len(result["document"]["groups"]), 1)
        self.assertEqual(result["document"]["groups"][0]["label"], "GitHub")
        self.assertIn(
            "Claimed", server.PROJECTS.history.page(result["id"])["runs"][0]["log"]
        )
        self.assertEqual(result["document"]["runs"][0]["status"], "completed")

    @unittest.skipUnless(shutil.which("sherlock"), "Sherlock-CLI nicht installiert")
    def test_real_cli_against_controlled_local_websites(self):
        class Fixture(BaseHTTPRequestHandler):
            def do_HEAD(self):
                self.send_response(200 if self.path.startswith("/found/") else 404)
                self.end_headers()

            def log_message(self, *args):
                pass

        http = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{http.server_port}"
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                spec = {
                    name: {
                        "urlMain": base,
                        "url": base + url + "{}",
                        "username_claimed": "example",
                        "errorType": "status_code",
                        "errorCode": 404,
                        "isNSFW": False,
                    }
                    for name, url in [("Found", "/found/"), ("Missing", "/missing/")]
                }
                (path / "sites.json").write_text(json.dumps(spec))
                args = [
                    shutil.which("sherlock"),
                    "--json",
                    str(path / "sites.json"),
                    "--ignore-exclusions",
                    "--csv",
                    "--print-all",
                    "--folderoutput",
                    directory,
                    "--timeout",
                    "2",
                    "--no-color",
                    "--",
                    "example",
                ]
                result = subprocess.run(
                    args, cwd=directory, capture_output=True, timeout=30
                )
                self.assertEqual(result.returncode, 0, result.stderr[-500:])
                outputs, _ = profiles.parse_csv(
                    (path / "example.csv").read_text(), NODE, 100
                )
                self.assertEqual(
                    outputs[-1]["source"]["counts"],
                    {"found": 1, "not_found": 1, "inconclusive": 0},
                )
        finally:
            http.shutdown()
            http.server_close()


if __name__ == "__main__":
    unittest.main()
