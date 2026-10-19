"""Offline contracts for ordered provider scopes and partial results."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from plugins._search_profiles import plans
from plugins._research import aggregate
from plugins import maigret, username, email

CATALOG = {
    "username": {
        "consensus": [
            {"id": "top:50", "top": 50},
            {"id": "tag:social", "tag": "social"},
        ],
        "maigret": [{"id": "top:50", "top": 50}],
        "blackbird": [],
    }
}


class SearchProfiles(unittest.TestCase):

    def setUp(self):
        patcher = patch("plugins._search_profiles.catalogue", return_value=CATALOG)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_empty_overrides_legacy_and_removes_maigret_top_limit(self):
        scope = plans(
            "username",
            "maigret",
            {
                "top_sites": 100,
                "maigret_sites": ["GitHub"],
                "search_profiles": {"maigret": []},
            },
        )[0]
        self.assertEqual(scope["maigret_sites"], [])
        self.assertIsNone(scope["_profile_top"])
        node = {"id": "input", "data": {"value": "fixture"}}

        def run(command, timeout):
            self.assertIn("--all-sites", command)
            self.assertNotIn("--top-sites", command)
            folder = Path(command[command.index("--folderoutput") + 1])
            (folder / "result.json").write_text("{}")
            return ("", "")

        with (
            patch("plugins.maigret.shutil.which", return_value="maigret"),
            patch("plugins.maigret.bounded_run", side_effect=run),
        ):
            maigret.run("search", [node], scope, {})

    def test_order_custom_and_provider_isolation(self):
        original = {
            "search_profiles": {
                "consensus": [
                    {"id": "tag:social"},
                    {"id": "custom", "sites": ["GitHub"]},
                    {"id": "top:50"},
                ],
                "blackbird": [],
            }
        }
        saved = copy.deepcopy(original)
        scopes = plans("username", "consensus", original)
        self.assertEqual(scopes[0]["_profile_tags"], ["social"])
        self.assertEqual(scopes[1]["consensus_sites"], ["GitHub"])
        self.assertEqual(scopes[2]["_profile_top"], 50)
        self.assertEqual(
            plans("username", "blackbird", original)[0]["_profile_sites"], []
        )
        self.assertEqual(original, saved)

    def test_invalid_profile_prevents_any_query(self):
        called = []
        with self.assertRaises(ValueError):
            aggregate(
                "username",
                {
                    "consensus": lambda *args: called.append(True),
                    "blackbird": lambda *args: called.append(True),
                },
                [{}],
                {"search_profiles": {"blackbird": [{"id": "top:50"}]}},
                {},
            )
        self.assertEqual(called, [])

    def test_duplicate_results_merged_and_partial_failure_visible(self):
        calls = []
        node = {"id": "input", "type": "username", "data": {"value": "fixture"}}

        def provider(inputs, params, context):
            calls.append(params["_profile_tags"])
            if len(calls) == 2:
                raise ValueError("Rate limit")
            from plugins._profile import make_profile

            return {
                "outputs": [
                    make_profile(
                        "github",
                        "https://github.com/fixture",
                        "fixture",
                        node,
                        "Consensus",
                        "username",
                    )
                ]
            }

        result = aggregate(
            "username",
            {"consensus": provider},
            [node],
            {
                "search_profiles": {
                    "consensus": [
                        {"id": "top:50"},
                        {"id": "tag:social"},
                        {"id": "custom", "sites": ["GitHub"]},
                    ]
                }
            },
            {},
        )
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result["outputs"]), 1)
        self.assertIn("Rate limit", result["warnings"][0])

    def test_custom_empty_or_flags_rejected(self):
        for sites in ([], ["--all"], ["a,b"], [None]):
            with self.subTest(sites=sites), self.assertRaises(ValueError):
                plans(
                    "username",
                    "consensus",
                    {
                        "search_profiles": {
                            "consensus": [{"id": "custom", "sites": sites}]
                        }
                    },
                )

    def test_defaults_only_consensus_and_private_setting(self):
        for module in (username, email):
            action = module.PLUGIN["actions"][0]
            self.assertEqual(
                [
                    key
                    for key, value in action["default_params"].items()
                    if key.startswith("use_") and value
                ],
                ["use_consensus"],
            )
            self.assertNotIn("search_profiles", action["settings_only"])

    def test_default_migration_runs_once_and_preserves_settings(self):
        from core.plugin_manager import Manager

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manager = Manager(
                root / "test.db", root, {"username": username, "email": email}
            )
            with manager.connect() as conn:
                row = conn.execute(
                    "SELECT settings FROM plugin_state WHERE id='username'"
                ).fetchone()
                settings = json.loads(row[0])
                self.assertFalse(settings["defaults"]["lookup"]["use_blackbird"])
                settings["defaults"]["lookup"]["use_blackbird"] = True
                settings["defaults"]["lookup"]["search_profiles"] = {
                    "consensus": [{"id": "top:50"}]
                }
                conn.execute(
                    "UPDATE plugin_state SET settings=? WHERE id='username'",
                    (json.dumps(settings),),
                )
            again = Manager(
                root / "test.db", root, {"username": username, "email": email}
            )
            with again.connect() as conn:
                saved = json.loads(
                    conn.execute(
                        "SELECT settings FROM plugin_state WHERE id='username'"
                    ).fetchone()[0]
                )
            self.assertTrue(saved["defaults"]["lookup"]["use_blackbird"])
            self.assertEqual(
                saved["defaults"]["lookup"]["search_profiles"],
                settings["defaults"]["lookup"]["search_profiles"],
            )


if __name__ == "__main__":
    unittest.main()
