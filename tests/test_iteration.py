"""Focused checks for Consensus identity parsing, retained partial results and default migration."""

import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
from core.partial_results import include_warning_node
from core.database import connect
from plugin_manager import Manager
from plugins._consensus import parse_findings
from plugins import _consensus


class ConsensusResults(unittest.TestCase):
    def test_timeout_retains_streamed_confirmed_profiles(self):
        def stopped(command, timeout, payload):
            Path(payload["checkpoint"]).write_text(
                json.dumps(
                    {
                        "site": "Example",
                        "status": "found",
                        "url": "https://example.invalid/fixture",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            raise ValueError("fixture deadline")

        with patch("plugins._consensus.bounded_run", side_effect=stopped):
            result = _consensus.run(
                "username", [{"id": "input", "data": {"value": "fixture"}}], {}, {}
            )
        self.assertEqual(len(result["outputs"]), 1)
        self.assertTrue(result["warnings"])

    def test_invalid_email_never_starts_consensus(self):
        with patch("plugins._consensus.bounded_run") as run:
            with self.assertRaises(ValueError):
                _consensus.run(
                    "email", [{"id": "input", "data": {"value": "invalid"}}], {}, {}
                )
            run.assert_not_called()

    def test_confirmed_profiles_only_and_no_extra_metadata_nodes(self):
        node = {"id": "input", "data": {"value": "fixture"}}
        result = parse_findings(
            [
                {
                    "site": "Example",
                    "status": "found",
                    "url": "https://example.invalid/fixture",
                    "extra": {"bio": "secret detail"},
                },
                {"site": "Blocked", "status": "rate_limited", "error": "429"},
                {"site": "No", "status": "not_found"},
                {"site": "Phone analysis", "status": "found", "category": "analysis"},
            ],
            node,
            "username",
        )
        self.assertEqual(len(result["outputs"]), 1)
        self.assertEqual(result["outputs"][0]["type"], "profile")
        self.assertEqual(
            set(result["outputs"][0]["data"]), {"provider", "url", "identifier"}
        )
        self.assertNotIn("secret detail", json.dumps(result["outputs"]))
        self.assertIn("429", result["warnings"][0])

    def test_partial_warning_keeps_findings_and_provides_visible_node(self):
        finding = {
            "type": "profile",
            "data": {"provider": "Example", "identifier": "fixture", "url": ""},
        }
        result = include_warning_node(
            {"outputs": [finding], "warnings": ["Source: 429", "Source: 429"]},
            [{"id": "input"}],
            "Fixture",
        )
        self.assertIs(result["outputs"][0], finding)
        self.assertEqual(result["outputs"][1]["type"], "error")
        self.assertEqual(result["outputs"][1]["data"]["message"], "Source: 429")
        self.assertTrue(result["outputs"][1]["source"]["incomplete"])

    def test_prompt_and_error_only_runs_do_not_get_duplicate_errors(self):
        for result in [
            {"outputs": [], "warnings": ["wait"], "input_request": {"title": "Code"}},
            {"outputs": [{"type": "error"}], "warnings": ["failure"]},
        ]:
            self.assertEqual(include_warning_node(result, [], "Fixture"), result)

    def test_consensus_migration_is_once_and_does_not_change_deep_research(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            db = data / "test.db"
            plugins = {
                name: types.SimpleNamespace(
                    PLUGIN={
                        "id": name,
                        "name": name,
                        "actions": [{"id": "lookup", "default_params": {}}],
                    }
                )
                for name in ["username", "email", "phone", "deep_research"]
            }
            manager = Manager(db, data, plugins)
            with connect(db) as conn:
                settings = json.loads(
                    conn.execute(
                        "SELECT settings FROM plugin_state WHERE id='username'"
                    ).fetchone()[0]
                )
                self.assertTrue(settings["defaults"]["lookup"]["use_consensus"])
                self.assertFalse(settings["defaults"]["lookup"]["use_maigret"])
                settings["defaults"]["lookup"]["use_maigret"] = True
                conn.execute(
                    "UPDATE plugin_state SET settings=? WHERE id='username'",
                    (json.dumps(settings),),
                )
            Manager(db, data, plugins)
            self.assertTrue(manager.action_params("username", "lookup")["use_maigret"])
            self.assertEqual(manager.action_params("deep_research", "lookup"), {})


if __name__ == "__main__":
    unittest.main()
