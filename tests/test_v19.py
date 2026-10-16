"""Offline contract coverage for profiles, review metadata, merge and native web enrichment."""

import copy
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
import server
import provider_registry as registry
from plugins import (
    merge,
    deep_research,
    _research,
    _extra_sources,
    _profile,
    _argus_web_runner as web,
)
import node_metadata


class V19Contracts(unittest.TestCase):
    def person(self, id="a", **data):
        return {
            "id": id,
            "type": "person",
            "label": id,
            "data": {
                "first_name": "",
                "middle_name": "",
                "last_name": "",
                "birth_date": "",
                "birth_place": "",
                "birth_country": "",
                **data,
            },
            "x": 0,
            "y": 0,
        }

    def profile(self):
        return {
            "id": "p",
            "type": "profile",
            "data": {
                "provider": "twitch",
                "url": "https://www.twitch.tv/fixture",
                "identifier": "fixture",
            },
        }

    def test_person_contract_and_review_defaults(self):
        node = self.person(first_name="Ada")
        server.canonicalize_node(node)
        self.assertEqual(
            set(node["data"]),
            {
                "first_name",
                "middle_name",
                "last_name",
                "birth_date",
                "birth_place",
                "birth_country",
            },
        )
        self.assertEqual(node["verification"], "unverified")
        self.assertEqual(node["tags"], [])

    def test_review_survives_canonicalization_without_polluting_data(self):
        node = self.person()
        node.update(verification="verified", tags=["nsfw", "nsfw"])
        server.canonicalize_node(node)
        self.assertEqual(node["verification"], "verified")
        self.assertEqual(node["tags"], ["nsfw"])
        self.assertNotIn("verification", node["data"])
        for status in ("bad", [], None):
            with self.assertRaises(ValueError):
                node_metadata.normalize({"type": "value", "verification": status})

    def test_badges_wrap_and_actors_have_none(self):
        node = {"type": "value", "tags": ["a", "b"]}
        tags = [{"id": "a", "name": "A" * 30}, {"id": "b", "name": "B" * 30}]
        self.assertGreater(
            node_metadata.badge_height(node, 210, tags),
            node_metadata.badge_height(node, 210, []),
        )
        self.assertEqual(node_metadata.badge_height({"type": "actor"}, 210), 0)

    def test_global_tags_persist_and_reject_duplicate_names(self):
        before = server.settings()
        try:
            result = server.save_settings(
                {
                    "language": "de",
                    "tags": [
                        {"id": "fixture-nsfw", "name": "NSFW", "color": "#aa7788"}
                    ],
                }
            )
            self.assertEqual(result["tags"][0]["name"], "NSFW")
            with self.assertRaises(ValueError):
                server.save_settings(
                    {
                        "language": "de",
                        "tags": [
                            {"id": "a", "name": "Same", "color": "#aaaaaa"},
                            {"id": "b", "name": "same", "color": "#aaaaaa"},
                        ],
                    }
                )
        finally:
            server.save_settings(
                {"language": before["language"], "tags": before.get("tags", [])}
            )

    def test_merge_completes_person_and_never_changes_inputs(self):
        inputs = [
            self.person("a", first_name="Ada"),
            self.person("b", last_name="Lovelace", birth_country="GB"),
        ]
        original = copy.deepcopy(inputs)
        result = merge.run("merge", inputs, {}, {})
        self.assertEqual(result["outputs"][0]["data"]["first_name"], "Ada")
        self.assertEqual(result["outputs"][0]["data"]["last_name"], "Lovelace")
        self.assertEqual(inputs, original)

    def test_merge_conflicts_require_valid_choice_for_each_field(self):
        inputs = [
            self.person("a", first_name="Ada", last_name="A"),
            self.person("b", first_name="Grace", last_name="B"),
        ]
        request = merge.run("merge", inputs, {}, {})
        self.assertEqual(len(request["input_request"]["fields"]), 2)
        self.assertEqual(request["outputs"], [])
        params = {
            "_merge_fingerprint": request["input_request"]["fingerprint"],
            "_merge_0": "1",
            "_merge_1": "0",
        }
        result = merge.run("merge", inputs, params, {})
        self.assertEqual(result["outputs"][0]["data"]["first_name"], "Grace")
        self.assertEqual(result["outputs"][0]["data"]["last_name"], "A")
        params["_merge_0"] = "99"
        self.assertIn("input_request", merge.run("merge", inputs, params, {}))

    def test_merge_stale_choices_do_not_override_changed_inputs(self):
        inputs = [
            self.person("a", first_name="Ada"),
            self.person("b", first_name="Grace"),
        ]
        request = merge.run("merge", inputs, {}, {})
        params = {
            "_merge_fingerprint": request["input_request"]["fingerprint"],
            "_merge_0": "1",
        }
        inputs[1]["data"]["first_name"] = "Changed"
        self.assertIn("input_request", merge.run("merge", inputs, params, {}))

    def test_merge_rejects_mixed_types_and_preserves_false_zero_and_tags(self):
        with self.assertRaises(ValueError):
            merge.run(
                "merge",
                [self.person(), {"id": "b", "type": "email", "data": {"value": "x"}}],
                {},
                {},
            )
        inputs = [
            {
                "id": "a",
                "type": "demo",
                "data": {"enabled": False, "count": 0, "name": ""},
                "tags": ["x"],
            },
            {
                "id": "b",
                "type": "demo",
                "data": {"enabled": None, "count": None, "name": "Fixture"},
                "tags": ["y"],
            },
        ]
        result = merge.run("merge", inputs, {}, {})
        self.assertIs(result["outputs"][0]["data"]["enabled"], False)
        self.assertEqual(result["outputs"][0]["data"]["count"], 0)
        self.assertEqual(result["outputs"][0]["tags"], ["x", "y"])

    def test_provider_aliases_and_duplicate_profiles_retain_sources(self):
        node = {"id": "i", "data": {"value": "Fixture"}}
        a = _profile.make_profile(
            "Twitter",
            "https://twitter.com/Fixture",
            "Fixture",
            node,
            "Sherlock",
            "username",
        )
        b = _profile.make_profile(
            "X (Twitter)",
            "https://x.com/fixture",
            "fixture",
            node,
            "User Scanner",
            "username",
        )
        out = _research.deduplicate([a, b])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["data"]["provider"], "x")
        self.assertEqual(len(out[0]["source"]["sources"]), 2)
        self.assertIn("reported_profile", out[0]["source"]["sources"][1])

    def test_unknown_custom_provider_names_not_aggressively_merged(self):
        self.assertNotEqual(
            registry.identity("custom:Unknown.a-b"),
            registry.identity("custom:Unknown.a.b"),
        )

    def test_initial_account_discovery_has_only_profiles(self):
        node = {"id": "i", "data": {"value": "Fixture"}}
        r = _extra_sources.positive_outputs(
            [
                {
                    "site_name": "Discord",
                    "status": "taken",
                    "url": "https://discord.com",
                    "extra": {"bio": "must not appear"},
                    "media": {"avatar": "https://example.invalid/a.jpg"},
                }
            ],
            node,
            "User Scanner",
            "username",
            True,
        )
        self.assertEqual(len(r["outputs"]), 1)
        p = r["outputs"][0]
        self.assertEqual(p["type"], "profile")
        self.assertEqual(p["data"]["url"], "")
        self.assertEqual(set(p["data"]), {"provider", "url", "identifier"})
        self.assertNotIn("bio", json.dumps(p))

    def test_profile_recipes_invalidated_by_changed_identifier(self):
        node = {"id": "i", "data": {"value": "Fixture"}}
        p = _profile.make_profile(
            "Twitch",
            "https://twitch.tv/Fixture",
            "Fixture",
            node,
            "Sherlock",
            "username",
        )
        profile = {"data": p["data"], "evidence": {"source": p["source"]}}
        self.assertEqual(len(_profile.recipes(profile)), 1)
        profile["data"] = {**profile["data"], "identifier": "other"}
        self.assertEqual(_profile.recipes(profile), [])

    def test_native_page_metadata_yields_specific_image_and_bio(self):
        html = '<meta property="og:description" content="Public biography"><meta property="og:image" content="https://cdn.example.invalid/jtv_user_pictures/profile_image.png"><script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Person","name":"Fixture","description":"Structured bio"}}</script>'
        facts = web.extract_page(html, "https://example.invalid/fixture")
        self.assertEqual(facts["Biografie"], "Structured bio")
        self.assertIn("Profilbild", facts)
        self.assertEqual(facts["Name"], "Fixture")

    def test_native_page_handles_malformed_json_and_labels_general_preview(self):
        facts = web.extract_page(
            '<meta property="og:image" content="/card.jpg"><script type="application/ld+json">{not valid</script>',
            "https://example.invalid/fixture",
        )
        self.assertEqual(facts["Vorschaubild"], "https://example.invalid/card.jpg")

    def test_deep_empty_run_outputs_visible_error_not_a_missing_account_claim(self):
        params = {
            **deep_research.PLUGIN["actions"][0]["default_params"],
            **{"use_" + name: False for name in deep_research.TOOLS},
            "use_argus": True,
        }
        with patch.object(
            deep_research,
            "bounded_run",
            return_value=(json.dumps({"facts": {}, "warnings": []}), ""),
        ):
            result = deep_research.run("lookup", [self.profile()], params, {})
        self.assertEqual(result["outputs"][0]["type"], "error")
        self.assertFalse(result["group_outputs"])
        self.assertFalse(result["failed"])
        self.assertIn("nicht existiert", result["outputs"][0]["data"]["message"])

    def test_deep_failed_run_keeps_failure_status_and_explanation(self):
        params = {
            **deep_research.PLUGIN["actions"][0]["default_params"],
            **{"use_" + name: False for name in deep_research.TOOLS},
            "use_argus": True,
        }
        with patch.object(
            deep_research, "bounded_run", side_effect=ValueError("fixture blocked")
        ):
            result = deep_research.run("lookup", [self.profile()], params, {})
        self.assertTrue(result["failed"])
        self.assertIn("fixture blocked", result["error"])

    @unittest.skipUnless(
        (Path(server.ROOT) / "providers/catalogue.json").exists(),
        "Catalogue is generated by Docker build",
    )
    def test_profile_union_contains_all_tools_in_built_image(self):
        if not (Path(server.ROOT) / "providers/catalogue.json").exists():
            return
        tools = {
            tool
            for provider in registry.catalogue()
            for tool in provider.get("sources", {})
        }
        self.assertTrue(
            {"sherlock", "maigret", "user_scanner", "blackbird", "holehe", "ignorant"}
            <= tools
        )
        self.assertGreater(len(registry.catalogue()), 8000)

    @unittest.skipUnless(
        Path("/opt/argus-tools/flaresolverr-venv/bin/python").exists(),
        "Embedded browser is installed by Docker build",
    )
    @unittest.skipUnless(
        Path("/run/argus/worker.sock").exists(),
        "Requires enabled namespace worker runtime; no unrestricted browser fallback",
    )
    def test_embedded_browser_executes_offline_javascript(self):
        python = Path("/opt/argus-tools/flaresolverr-venv/bin/python")
        if not python.exists():
            return
        result = subprocess.run(
            [
                str(python),
                "-I",
                str(Path(server.ROOT) / "plugins/_browser_runner.py"),
                "--self-test",
            ],
            capture_output=True,
            text=True,
            timeout=75,
        )
        self.assertEqual(result.returncode, 0, result.stderr[-3000:])
        payload = json.loads(result.stdout)
        self.assertTrue(payload["javascript"])
        self.assertFalse(payload["external_requests"])

    @unittest.skipUnless(
        Path("/opt/argus-tools/flaresolverr-venv/bin/python").exists(),
        "Chromium is installed by Docker build",
    )
    def test_actual_chromium_ui_workflow_without_external_requests(self):
        result = subprocess.run(
            [
                "/opt/argus-tools/flaresolverr-venv/bin/python",
                str(Path(server.ROOT) / "tests/browser_v19_smoke.py"),
            ],
            capture_output=True,
            text=True,
            timeout=150,
        )
        self.assertEqual(
            result.returncode, 0, result.stderr[-5000:] + "\n" + result.stdout[-2000:]
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "ok")
        self.assertGreaterEqual(len(payload["checks"]), 7)
