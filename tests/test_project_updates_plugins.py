import copy
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4
from core.application import get_default_application
from core import graph
from runtime_fixture import app
from plugins import location
from core.plugin_manager import Manager


class UpdatesTests(unittest.TestCase):

    def setUp(self):
        self.geocoder = patch.object(location, "request", return_value=None)
        self.geocoder.start()

    def tearDown(self):
        self.geocoder.stop()

    def project(self):
        pid = uuid4().hex
        doc = {
            "nodes": [
                {
                    "id": "n",
                    "type": "location",
                    "label": "Place",
                    "data": {
                        "original_input": "Hamburg",
                        "unit": "Suite 1",
                        "custom": "kept",
                    },
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "a",
                    "type": "actor",
                    "label": "Normalize",
                    "data": {
                        "plugin": "location",
                        "action": "normalize",
                        "params": {"enrich": False},
                    },
                    "x": 300,
                    "y": 0,
                },
            ],
            "edges": [{"id": "e", "source": "n", "target": "a"}],
            "groups": [],
            "runs": [],
        }
        app.validate(doc)
        with app.connect() as db:
            db.execute(
                "INSERT INTO projects VALUES (?,?,?,?,?)",
                (pid, "Update test", json.dumps(doc), 1, app.now()),
            )
        return app.load_project(pid)

    def test_location_spawns_new_node_and_preserves_original_and_all_fields(self):
        p = self.project()
        updated = app.execute(p["id"], {"actor_id": "a", "revision": 1})
        self.assertEqual(
            len([n for n in updated["document"]["nodes"] if n["type"] != "error"]), 3
        )
        self.assertEqual(updated["document"]["nodes"][0], p["document"]["nodes"][0])
        place = next(
            (
                n
                for n in reversed(updated["document"]["nodes"])
                if n["type"] == "location"
            )
        )
        self.assertNotEqual(place["id"], "n")
        self.assertEqual(place["data"]["unit"], "Suite 1")
        self.assertEqual(
            updated["document"]["nodes"][0]["evidence"]["additional_data"]["custom"],
            "kept",
        )
        self.assertTrue(set(graph.LOCATION_DEFAULTS) <= set(place["data"]))
        self.assertEqual(updated["document"]["runs"][0]["updated_inputs"], [])

    def test_keyless_provider_and_ambiguous_selection_modify_only_result_node(self):
        p = self.project()
        p["document"]["nodes"][1]["data"]["params"] = {"enrich": True}
        p = app.save_project(p["id"], p["title"], p["document"], 1)

        def feature(city):
            return {
                "properties": {"city": city, "country": "Germany", "countrycode": "DE"},
                "geometry": {"coordinates": [10, 53]},
            }

        with (
            patch.dict("os.environ", {"GEOCODER_URL": ""}),
            patch.object(
                location,
                "request",
                return_value={"features": [feature("Hamburg"), feature("Other")]},
            ) as request,
        ):
            p = app.execute(p["id"], {"actor_id": "a", "revision": p["revision"]})
        self.assertEqual(request.call_args.args[2], "photon")
        run = p["document"]["runs"][0]
        self.assertEqual(run["status"], "needs_selection")
        self.assertEqual(
            len([n for n in p["document"]["nodes"] if n["type"] != "error"]), 3
        )
        selected = app.choose_location(
            p["id"],
            {
                "revision": p["revision"],
                "run_id": run["id"],
                "input_id": run["candidates"][0]["input_id"],
                "index": 0,
            },
        )
        self.assertEqual(
            next(
                (
                    n
                    for n in reversed(selected["document"]["nodes"])
                    if n["type"] == "location"
                )
            )["data"]["locality"],
            "Hamburg",
        )
        self.assertEqual(
            next(
                (
                    n
                    for n in reversed(selected["document"]["nodes"])
                    if n["type"] == "location"
                )
            )["data"]["unit"],
            "Suite 1",
        )
        self.assertEqual(selected["document"]["runs"][0]["status"], "completed")

    def test_long_action_preserves_edits_made_while_it_runs(self):
        p = self.project()
        started = threading.Event()
        resume = threading.Event()
        result = []

        def delayed(*args):
            started.set()
            self.assertTrue(resume.wait(3))
            return {
                "outputs": [],
                "updates": [{"id": "n", "data": {"country": "Germany"}}],
            }

        with patch.object(location, "run", side_effect=delayed):
            worker = threading.Thread(
                target=lambda: result.append(
                    app.execute(p["id"], {"revision": 1, "actor_id": "a"})
                )
            )
            worker.start()
            self.assertTrue(started.wait(3))
            edited = copy.deepcopy(p["document"])
            edited["nodes"][0]["label"] = "Edited while running"
            edited["nodes"][0]["data"]["unit"] = "Suite 2"
            app.save_project(p["id"], "New title", edited, 1)
            resume.set()
            worker.join(4)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result[0]["title"], "New title")
        self.assertEqual(
            result[0]["document"]["nodes"][0]["label"], "Edited while running"
        )
        self.assertEqual(result[0]["document"]["nodes"][0]["data"]["unit"], "Suite 2")
        self.assertEqual(
            result[0]["document"]["nodes"][0]["data"]["country"], "Germany"
        )

    def test_language_packs_and_report(self):
        packs = [
            json.loads(
                (app.ROOT / "static" / "locales" / (c + ".json")).read_text(
                    encoding="utf-8"
                )
            )["messages"]
            for c in ("de", "en")
        ]
        self.assertEqual(set(packs[0]), set(packs[1]))
        with patch.object(
            get_default_application(), "settings", return_value={"language": "en"}
        ):
            output = app.report(self.project()).decode()
        self.assertIn("Research report", output)
        self.assertIn("Print / Save as PDF", output)


class PluginManagerTests(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manager = Manager(self.root / "db.sqlite", self.root, app.PLUGINS)

    def tearDown(self):
        self.temp.cleanup()

    def test_uninstall_reinstall_persists_settings(self):
        self.manager.configure(
            "location", {"defaults": {"normalize": {"enrich": False}}}
        )
        self.manager.uninstall("location")
        self.assertNotIn("location", {p["id"] for p in self.manager.installed()})
        self.manager.install("location")
        item = next((p for p in self.manager.installed() if p["id"] == "location"))
        self.assertFalse(item["actions"][0]["default_params"]["enrich"])

    @unittest.skipUnless(
        Path("/run/argus/worker.sock").exists(),
        "Requires enabled namespace worker runtime",
    )
    def test_repo_install_is_pinned_verified_and_executable(self):
        source = b"def run(action,inputs,params,context):\n return {'outputs':[{'type':'value','data':{'value':'ok'}}]}\n"
        descriptor = {
            "id": "sample",
            "name": "Sample",
            "description": "Test",
            "version": "1",
            "module": "plugin.py",
            "sha256": hashlib.sha256(source).hexdigest(),
            "actions": [{"id": "run", "name": "Run", "inputs": ["value"]}],
        }
        manifest = {"schema_version": 1, "plugins": [descriptor]}
        commit = "a" * 40

        def download(url, *args):
            if "/commits/" in url:
                return json.dumps({"sha": commit}).encode()
            if "api.github.com" in url:
                return b'{"default_branch":"main"}'
            if url.endswith("argus-repository.json"):
                return json.dumps(manifest).encode()
            self.assertIn(commit, url)
            return source

        with patch.object(self.manager, "fetch", side_effect=download):
            repo = self.manager.add_repo("https://github.com/example/demo")
            pid = next(
                (
                    p["id"]
                    for p in self.manager.library()
                    if p.get("local_id") == "sample"
                )
            )
            self.manager.install(pid)
        self.assertEqual(
            self.manager.module(pid).run("run", [], {}, {})["outputs"][0]["data"][
                "value"
            ],
            "ok",
        )
        self.manager.remove_repo(repo["id"])
        self.assertIsNotNone(self.manager.module(pid))
        with self.manager.connect() as conn:
            path = conn.execute(
                "SELECT source_path FROM community_installed"
            ).fetchone()[0]
        Path(path).write_text("tampered")
        with self.assertRaises(ValueError):
            self.manager.module(pid)

    def test_arbitrary_repo_hosts_and_paths_rejected(self):
        for url in [
            "http://github.com/a/b",
            "https://localhost/a/b",
            "https://github.com/a/../b",
            "https://github.com/a/b?x=1",
        ]:
            with self.assertRaises(ValueError):
                self.manager.repo_url(url)


class NodeSchemaTests(unittest.TestCase):

    def test_legacy_fields_and_structured_values_are_preserved_outside_fixed_data_schema(
        self,
    ):
        node = {
            "type": "value",
            "data": {
                "value": {"width": 4, "height": 8},
                "semantic_key": "legacy",
                "assessment": "unreviewed",
            },
            "evidence": {"source": {"assessment": "unreviewed", "provider": "test"}},
        }
        app.canonicalize_node(node)
        self.assertEqual(set(node["data"]), {"value"})
        self.assertEqual(node["data"]["value"], "width: 4\nheight: 8")
        self.assertEqual(node["evidence"]["raw_value"], {"width": 4, "height": 8})
        self.assertEqual(node["evidence"]["additional_data"]["semantic_key"], "legacy")
        self.assertNotIn("assessment", str(node))
        original = copy.deepcopy(node)
        app.canonicalize_node(node)
        self.assertEqual(node, original)

    def test_all_data_node_types_keep_an_identical_schema(self):
        for kind, defaults in graph.NODE_DEFAULTS.items():
            node = {
                "type": kind,
                "data": {"custom_field": "retained", "assessment": "unreviewed"},
            }
            app.canonicalize_node(node)
            self.assertEqual(set(node["data"]), set(defaults), kind)
            self.assertEqual(
                node["evidence"]["additional_data"]["custom_field"], "retained"
            )
            self.assertNotIn("assessment", node["evidence"]["additional_data"])
