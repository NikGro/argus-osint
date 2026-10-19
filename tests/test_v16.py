from core.errors import AppError

"""Integration coverage for data plugins and all deferred data contracts, offline."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
import server
from plugin_manager import Manager
from plugins import location, holehe, phoneinfoga, _research as research


class V16Contracts(unittest.TestCase):
    def manager(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name)
        return Manager(path / "state.sqlite3", path, server.PLUGINS)

    def descriptor(self, kind="demo_reference"):
        return {
            "id": "demo",
            "name": "Demo",
            "actions": [],
            "nodes": [
                {
                    "type": kind,
                    "name": "Reference",
                    "defaults": {"value": "", "code": ""},
                }
            ],
            "translations": {
                "en": {"Reference": "Reference"},
                "de": {"Reference": "Referenz"},
            },
        }

    def repo(self, m, descriptor, rid="r"):
        with m.connect() as db:
            db.execute(
                "INSERT INTO community_repos VALUES (?,?,?,NULL)",
                (
                    rid,
                    "https://github.com/example/" + rid,
                    json.dumps({"plugins": [descriptor], "commit": "a" * 40}),
                ),
            )
        return "community:" + rid + ":" + descriptor["id"]

    def project(self):
        pid = uuid4().hex
        doc = {
            "nodes": [
                {
                    "id": "input",
                    "type": "location",
                    "label": "Original",
                    "data": {"locality": "Fixture"},
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "actor",
                    "type": "actor",
                    "label": "Actor",
                    "data": {"plugin": "location", "action": "normalize", "params": {}},
                    "x": 350,
                    "y": 0,
                },
            ],
            "edges": [{"id": "e", "source": "input", "target": "actor"}],
            "groups": [],
            "runs": [],
        }
        server.validate(doc)
        with server.connect() as db:
            db.execute(
                "INSERT INTO projects VALUES (?,?,?,?,?)",
                (pid, "Offline fixture", json.dumps(doc), 1, server.now()),
            )
        return server.load_project(pid)

    def ambiguous(self):
        p = self.project()
        feature = lambda name: {
            "properties": {"city": name, "countrycode": "DE", "country": "Deutschland"},
            "geometry": {"coordinates": [10, 53]},
        }
        with patch.object(
            location,
            "request",
            return_value={"features": [feature("Fixture"), feature("Other")]},
        ):
            r = server.execute(p["id"], {"actor_id": "actor", "revision": 1})
        return p, r, r["document"]["runs"][-1]

    def test_builtin_data_plugins_have_owned_schemas_and_empty_actions(self):
        m = self.manager()
        data = [p for p in m.installed() if p.get("nodes")]
        self.assertEqual(len(data), 15)
        self.assertIn("video", m.node_defaults())
        self.assertTrue(all(not p["actions"] for p in data))
        self.assertEqual(
            m.node_defaults()["datetime"], {"date": "", "time": "", "timezone": "UTC"}
        )

    def test_data_uninstall_reinstall_retains_schema_and_settings(self):
        m = self.manager()
        m.configure(
            "data_url", {"nodes": {"url": {"display_defaults": {"openButton": True}}}}
        )
        m.uninstall("data_url")
        self.assertNotIn("data_url", {p["id"] for p in m.installed()})
        self.assertIn("url", m.node_defaults())
        m.install("data_url")
        self.assertTrue(m.display_defaults()["url"]["openButton"])

    def test_actor_uninstall_reinstall_library(self):
        m = self.manager()
        m.uninstall("email")
        item = next(p for p in m.library() if p["id"] == "email")
        self.assertFalse(item["installed"])
        m.install("email")
        self.assertTrue(next(p for p in m.library() if p["id"] == "email")["installed"])

    def test_display_defaults_independent_between_data_types(self):
        m = self.manager()
        m.configure(
            "data_image",
            {
                "nodes": {
                    "image": {
                        "display_defaults": {"preview": True, "imageButton": True}
                    }
                }
            },
        )
        d = m.display_defaults()
        self.assertTrue(d["image"]["preview"])
        self.assertFalse(d["url"]["openButton"])
        self.assertTrue(d["image"]["imageButton"])

    def test_legacy_defaults_migrate_until_data_plugin_override(self):
        m = self.manager()
        legacy = {"url": {"openButton": True}}
        self.assertTrue(m.display_defaults(legacy)["url"]["openButton"])
        m.configure(
            "data_url", {"nodes": {"url": {"display_defaults": {"openButton": False}}}}
        )
        self.assertFalse(m.display_defaults(legacy)["url"]["openButton"])

    def test_map_preview_and_actions_store_separate_priorities(self):
        m = self.manager()
        node = next(n for n in m.node_descriptors() if n["type"] == "location")
        pre = list(reversed(node["map_preview_sources"]))
        act = list(reversed(node["map_action_sources"]))
        act[0]["enabled"] = False
        m.configure(
            "data_location",
            {
                "nodes": {
                    "location": {"map_preview_sources": pre, "map_action_sources": act}
                }
            },
        )
        n = next(n for n in m.node_descriptors() if n["type"] == "location")
        self.assertEqual(n["map_preview_sources"][0]["id"], "osm")
        self.assertEqual(n["map_action_sources"][0]["id"], "osm")
        self.assertFalse(n["map_action_sources"][0]["enabled"])

    def test_map_invalid_sources_and_duplicates_rejected(self):
        m = self.manager()
        for sources in (
            [{"id": "unknown", "enabled": True}],
            [{"id": "google", "enabled": True}, {"id": "google", "enabled": True}],
        ):
            with self.assertRaises(ValueError):
                m.configure(
                    "data_location",
                    {"nodes": {"location": {"map_preview_sources": sources}}},
                )

    def test_display_non_boolean_defaults_rejected(self):
        m = self.manager()
        with self.assertRaises(ValueError):
            m.configure(
                "data_url",
                {"nodes": {"url": {"display_defaults": {"openButton": "yes"}}}},
            )

    def test_pure_data_community_install_needs_no_python_or_network(self):
        m = self.manager()
        d = self.descriptor()
        m.validate_descriptor(d)
        pid = self.repo(m, d)
        with patch.object(m, "fetch", side_effect=AssertionError("No download needed")):
            m.install(pid)
        self.assertIn("demo_reference", m.node_defaults())
        m.uninstall(pid)
        self.assertIn("demo_reference", m.node_defaults())
        m.install(pid)

    def test_community_type_collision_and_core_override_rejected(self):
        m = self.manager()
        d = self.descriptor()
        pid = self.repo(m, d)
        m.install(pid)
        other = self.descriptor()
        other["id"] = "other"
        pid2 = self.repo(m, other, "other")
        with self.assertRaises(ValueError):
            m.install(pid2)
        with self.assertRaises(ValueError):
            m.validate_descriptor(self.descriptor("email"))

    def test_community_mixed_actions_allow_custom_input_type(self):
        m = self.manager()
        d = self.descriptor()
        d["actions"] = [
            {"id": "lookup", "name": "Lookup", "inputs": ["demo_reference"]}
        ]
        m.validate_descriptor(d)
        self.assertEqual(d["actions"][0]["inputs"], ["demo_reference"])

    def test_custom_data_schema_can_be_saved_even_after_uninstall(self):
        m = self.manager()
        pid = self.repo(m, self.descriptor())
        m.install(pid)
        m.uninstall(pid)
        node = {
            "id": "x",
            "type": "demo_reference",
            "data": {"value": "info"},
            "label": "Reference",
            "x": 0,
            "y": 0,
        }
        with patch.object(server.get_default_application(), "MANAGER", m):
            server.canonicalize_node(node)
        self.assertEqual(node["data"], {"value": "info", "code": ""})

    def test_owning_plugins_ship_both_languages(self):
        m = self.manager()
        for p in m.installed():
            self.assertTrue(p.get("translations", {}).get("de"), p["id"])
            self.assertTrue(p.get("translations", {}).get("en"), p["id"])

    def test_cancelled_address_selection_terminal_and_original_unchanged(self):
        original, r, run = self.ambiguous()
        cancelled = server.cancel_run(
            r["id"], {"revision": r["revision"], "run_id": run["id"]}
        )
        self.assertEqual(cancelled["document"]["runs"][-1]["status"], "cancelled")
        self.assertEqual(
            cancelled["document"]["nodes"][0], original["document"]["nodes"][0]
        )
        with self.assertRaisesRegex(ValueError, "abgebrochen"):
            server.choose_location(
                r["id"],
                {
                    "revision": cancelled["revision"],
                    "run_id": run["id"],
                    "input_id": run["candidates"][0]["input_id"],
                    "index": 0,
                },
            )

    def test_cancel_requires_current_revision(self):
        _, r, run = self.ambiguous()
        with self.assertRaises(AppError):
            server.cancel_run(r["id"], {"revision": 0, "run_id": run["id"]})

    def test_cancelled_actor_can_be_executed_again(self):
        _, r, run = self.ambiguous()
        r = server.cancel_run(r["id"], {"revision": r["revision"], "run_id": run["id"]})
        with patch.object(location, "request", return_value={"features": []}):
            again = server.execute(
                r["id"], {"actor_id": "actor", "revision": r["revision"]}
            )
        self.assertEqual(again["document"]["runs"][0]["status"], "cancelled")
        self.assertEqual(again["document"]["runs"][-1]["status"], "completed")

    def test_datetime_migrates_old_values_keeps_provenance(self):
        n = {
            "type": "datetime",
            "data": {"value": "2026-10-14T12:34:56", "timezone": None},
        }
        from core.migrations import migrate

        n = migrate({"nodes": [n]})["nodes"][0]
        server.canonicalize_node(n)
        self.assertEqual(
            n["data"], {"date": "2026-10-14", "time": "12:34:56", "timezone": "UTC"}
        )
        self.assertIn("value", n["evidence"]["additional_data"])

    def test_nested_facts_one_answer_per_node_and_provider_dedup(self):
        common = {
            "source": {"service": "Roblox", "tool": "Fixture"},
            "source_input": "x",
        }
        out = research.fact_outputs(
            {
                "name": "Demo",
                "ids": {"uid": "123"},
                "links": ["https://example.invalid/p"],
            },
            "Profile",
            common,
        )
        r = research.deduplicate(out + copy.deepcopy(out))
        self.assertEqual(len(r), 3)
        self.assertTrue(all(o["group"] == "Roblox" for o in r))
        self.assertTrue(
            all(not isinstance(o["data"]["value"], (dict, list)) for o in r)
        )

    def test_single_registration_fact_group_and_positive_only(self):
        result = holehe.results(
            [
                {"name": "Instagram", "exists": True},
                {"name": "Absent", "exists": False},
            ],
            {"id": "e"},
        )
        out = research.deduplicate(result["outputs"])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["group"], "Instagram")
        self.assertEqual(out[0]["label"], "Konto besteht?")
        self.assertEqual(out[0]["data"]["value"], "Ja")

    def test_search_urls_omitted_direct_reported_findings_retained(self):
        rows = phoneinfoga.parse_output(
            "Results for googlecse\nURL: https://google.com/search?q=x\nURL: https://www.bing.com/search?q=x\nResult: https://example.invalid/found",
            {"id": "p"},
        )
        urls = [o["data"]["value"] for o in rows if o["type"] == "url"]
        self.assertEqual(urls, ["https://example.invalid/found"])
