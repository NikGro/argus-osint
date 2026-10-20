"""Release-facing contracts: encrypted credentials, graph persistence and Instagram auth."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
from runtime_fixture import app
from core.graph import merge_documents
from core.secrets import MASK, SecretStore, scrub_text
from core.plugin_manager import Manager
from plugins import instagram
from core.result_groups import (
    nested_outputs,
    create_tree,
    measure,
    place,
    append_groups,
)


class CredentialContracts(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = SecretStore(self.root)

    def test_encrypted_storage_redaction_and_clear(self):
        value = {
            "defaults": {
                "login": {
                    "login_password": "fixture-p@ss",
                    "sessionid": "fixture-session",
                    "login_username": "fixture-user",
                }
            }
        }
        sealed = self.store.seal(value)
        self.assertNotIn("fixture-p@ss", json.dumps(sealed))
        self.assertNotIn("fixture-session", json.dumps(sealed))
        self.assertEqual(self.store.reveal(sealed), value)
        self.assertEqual(
            self.store.preserve_masks(
                {"login_password": MASK}, {"login_password": "original"}
            )["login_password"],
            "original",
        )
        self.assertEqual(
            self.store.preserve_masks(
                {"login_password": ""}, {"login_password": "original"}
            )["login_password"],
            "",
        )

    def test_key_and_session_survive_store_recreation(self):
        token = self.store.encrypt_text('{"cookies":{"sessionid":"private"}}')
        self.assertEqual(
            SecretStore(self.root).decrypt_text(token),
            '{"cookies":{"sessionid":"private"}}',
        )

    @unittest.skipUnless(
        os.name == "posix", "POSIX key permissions require a POSIX filesystem"
    )
    def test_key_file_is_owner_read_write_only(self):
        self.assertEqual((self.root / ".credentials.key").stat().st_mode & 0o777, 0o600)

    def test_plugin_api_masks_but_execution_receives_credentials(self):
        manager = Manager(self.root / "db.sqlite3", self.root, app.PLUGINS)
        manager.configure(
            "instagram",
            {
                "defaults": {
                    "lookup": {
                        "login_username": "fixture-user",
                        "login_password": "fixture-p@ss",
                        "sessionid": "",
                    }
                }
            },
        )
        public = next((p for p in manager.installed() if p["id"] == "instagram"))
        self.assertEqual(public["actions"][0]["default_params"]["login_password"], MASK)
        self.assertEqual(
            manager.action_params("instagram", "lookup")["login_password"],
            "fixture-p@ss",
        )
        with manager.connect() as conn:
            raw = conn.execute(
                "SELECT settings FROM plugin_state WHERE id=?", ("instagram",)
            ).fetchone()[0]
        self.assertNotIn("fixture-p@ss", raw)
        manager.configure("instagram", public["settings"])
        self.assertEqual(
            manager.action_params("instagram", "lookup")["login_password"],
            "fixture-p@ss",
        )
        manager.uninstall("instagram")
        manager.install("instagram")
        self.assertEqual(
            manager.action_params("instagram", "lookup")["login_password"],
            "fixture-p@ss",
        )

    def test_existing_plaintext_settings_migrate(self):
        manager = Manager(self.root / "db.sqlite3", self.root, app.PLUGINS)
        with manager.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO plugin_state VALUES (?,?,?)",
                (
                    "instagram",
                    1,
                    json.dumps(
                        {"defaults": {"lookup": {"login_password": "old-secret"}}}
                    ),
                ),
            )
        reloaded = Manager(self.root / "db.sqlite3", self.root, app.PLUGINS)
        self.assertEqual(
            reloaded.action_params("instagram", "lookup")["login_password"],
            "old-secret",
        )
        with reloaded.connect() as conn:
            self.assertNotIn(
                "old-secret",
                conn.execute(
                    'SELECT settings FROM plugin_state WHERE id="instagram"'
                ).fetchone()[0],
            )

    def test_diagnostic_secret_redaction_including_encoding(self):
        self.assertEqual(
            scrub_text("failed p@ss at p%40ss", {"login_password": "p@ss"}),
            "failed [redacted] at [redacted]",
        )


class GraphReleaseContracts(unittest.TestCase):

    def document(self):
        return {"nodes": [], "edges": [], "groups": [], "runs": [], "report_notes": ""}

    def test_project_preferences_roundtrip_and_merge(self):
        base = self.document()
        local = copy.deepcopy(base)
        remote = copy.deepcopy(base)
        local["preferences"] = {"instagram_anonymous_notice_dismissed": True}
        remote["report_notes"] = "remote"
        merged = merge_documents(base, local, remote)
        self.assertTrue(merged["preferences"]["instagram_anonymous_notice_dismissed"])
        self.assertEqual(merged["report_notes"], "remote")
        project = app.PROJECTS.create("Fixture preferences", merged)
        self.assertTrue(
            app.load_project(project["id"])["document"]["preferences"][
                "instagram_anonymous_notice_dismissed"
            ]
        )

    def test_graph_never_stores_plugin_credentials_or_temporary_codes(self):
        node = {
            "id": "a",
            "type": "actor",
            "label": "Fixture",
            "data": {
                "plugin": "instagram",
                "action": "lookup",
                "params": {
                    "login_username": "fixture-user",
                    "login_password": "secret",
                    "sessionid": "sid",
                    "_auth_code": "123456",
                    "include_posts": True,
                },
            },
            "x": 0,
            "y": 0,
        }
        app.canonicalize_node(node)
        self.assertEqual(node["data"]["params"], {"include_posts": True})

    def test_invalid_positions_duplicate_edges_and_bad_preferences(self):
        node = {
            "id": "n",
            "type": "value",
            "label": "n",
            "data": {"value": "v"},
            "x": False,
            "y": 0,
        }
        doc = self.document()
        doc["nodes"] = [node]
        with self.assertRaises(ValueError):
            app.validate(doc)
        node["x"] = 0
        doc["edges"] = [
            {"id": "same", "source": "n", "target": "n"},
            {"id": "same", "source": "n", "target": "n"},
        ]
        with self.assertRaises(ValueError):
            app.validate(doc)
        doc["edges"] = []
        doc["preferences"] = []
        with self.assertRaises(ValueError):
            app.validate(doc)

    def test_nested_output_groups_are_real_parent_groups(self):
        outputs = [
            {
                "type": "username",
                "data": {"value": "fixture"},
                "group_path": [
                    {"id": "followers", "label": "Follower"},
                    {"id": "user1", "label": "fixture"},
                ],
            },
            {
                "type": "url",
                "data": {"value": "https://www.instagram.com/fixture/"},
                "group_path": [
                    {"id": "followers", "label": "Follower"},
                    {"id": "user1", "label": "fixture"},
                ],
            },
        ]
        selected = nested_outputs(outputs)
        trees = create_tree(selected)
        positions = {}
        tree = trees["followers"]
        measure(tree, lambda _: (0, 0, 210, 106))
        tree["_bounds"] = lambda _: (0, 0, 210, 106)
        place(tree, 400, 0, positions)
        doc = self.document()
        ids = {id(output): str(i) for i, output in enumerate(outputs)}
        members = append_groups(doc, outputs, ids, "run")
        self.assertEqual(members, {"0", "1"})
        self.assertEqual(len(doc["groups"]), 2)
        root, child = doc["groups"]
        self.assertEqual(child["parent_id"], root["id"])
        self.assertEqual(child["members"], ["0", "1"])
        self.assertEqual(root["members"], [])
        self.assertEqual(len(positions), 2)

    def test_service_blocks_generic_for_instagram_and_wrong_provider(self):
        for plugin, provider in [
            ("deep_research", "instagram"),
            ("instagram", "facebook"),
        ]:
            doc = self.document()
            doc["nodes"] = [
                {
                    "id": "p",
                    "type": "profile",
                    "label": "Fixture",
                    "data": {"provider": provider, "url": "", "identifier": "fixture"},
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "a",
                    "type": "actor",
                    "label": "Actor",
                    "data": {"plugin": plugin, "action": "lookup", "params": {}},
                    "x": 400,
                    "y": 0,
                },
            ]
            doc["edges"] = [{"id": "e", "source": "p", "target": "a"}]
            project = app.PROJECTS.create("Fixture provider policy", doc)
            with self.assertRaises(ValueError):
                app.execute(project["id"], {"revision": 1, "actor_id": "a"})


class InstagramLoginContracts(unittest.TestCase):

    def auth(self):
        spec = importlib.util.spec_from_file_location(
            "fixture_instagram_auth",
            Path(instagram.__file__).with_name("_instagram_auth.py"),
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_password_login_reuses_settings_and_passes_code(self):

        class Client:

            def set_settings(self, settings):
                self.saved = settings

            def login(self, *args, **kwargs):
                self.called = (args, kwargs)

        client = Client()
        self.assertTrue(
            self.auth().login(
                client,
                {
                    "login_username": "fixture",
                    "login_password": "secret",
                    "saved_session": {"device": "same"},
                },
                "123456",
            )
        )
        self.assertEqual(client.saved, {"device": "same"})
        self.assertEqual(
            client.called, (("fixture", "secret"), {"verification_code": "123456"})
        )

    def test_login_session_and_anonymous_paths(self):

        class Client:

            def login_by_sessionid(self, value):
                self.value = value

        client = Client()
        self.assertTrue(self.auth().login(client, {"sessionid": "sid"}))
        self.assertEqual(client.value, "sid")
        self.assertFalse(self.auth().login(Client(), {}))

    def test_challenge_never_blocks_on_stdin(self):
        auth = self.auth()

        class Client:

            def login(self, *args, **kwargs):
                self.challenge_code_handler("fixture", "sms")

        with self.assertRaises(auth.ManualVerificationRequired) as failure:
            auth.login(
                Client(), {"login_username": "fixture", "login_password": "secret"}
            )
        request = auth.input_request(failure.exception)
        self.assertTrue(request["fields"][0]["transient"])
        self.assertEqual(request["fields"][0]["type"], "password")

    def test_collect_encrypts_saved_session_and_keeps_transient_code_out_of_outputs(
        self,
    ):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            captured = []

            def worker(command, timeout, payload, **kwargs):
                captured.append(payload)
                Path(payload["session_output"]).write_text(
                    json.dumps({"cookies": {"sessionid": "sensitive-session"}})
                )
                return (json.dumps({"outputs": [], "authenticated": True}), "")

            config = {
                **instagram.DEFAULTS,
                "login_username": "fixture",
                "login_password": "secret",
            }
            with patch.object(instagram, "bounded_run", side_effect=worker):
                result = instagram.collect(
                    {"username": "", "user_id": ""},
                    config,
                    {
                        "credential_dir": root / "sessions",
                        "transient": {"verification_code": "123456"},
                    },
                    auth_only=True,
                )
                instagram.collect(
                    {"username": "", "user_id": ""},
                    config,
                    {"credential_dir": root / "sessions"},
                    auth_only=True,
                )
            self.assertTrue(result["authenticated"])
            self.assertEqual(captured[0]["transient"]["verification_code"], "123456")
            self.assertEqual(
                captured[1]["settings"]["saved_session"]["cookies"]["sessionid"],
                "sensitive-session",
            )
            self.assertNotIn(
                "sensitive-session",
                next((root / "sessions").glob("*.session")).read_text(),
            )
            self.assertNotIn("123456", json.dumps(result))

    def test_validation_rejects_bad_limits_before_network(self):
        profile = {
            "id": "p",
            "type": "profile",
            "data": {"provider": "instagram", "identifier": "fixture", "url": ""},
        }
        for value in [-1, 1.5, True]:
            with (
                self.subTest(value=value),
                patch.object(
                    instagram,
                    "bounded_run",
                    side_effect=AssertionError("network must not run"),
                ),
            ):
                with self.assertRaises(ValueError):
                    instagram.run("lookup", [profile], {"followers_limit": value}, {})

    def test_worker_auth_requests_are_not_converted_to_false_no_results(self):
        request = {
            "kind": "instagram_auth",
            "fields": [{"key": "verification_code", "transient": True}],
        }
        result = instagram.finish_result(
            {"outputs": [], "input_request": request}, [{"id": "p"}], instagram.DEFAULTS
        )
        self.assertEqual(result["outputs"], [])
        self.assertEqual(result["input_request"], request)


class InstagramCollectionContracts(unittest.TestCase):

    def worker(self):
        spec = importlib.util.spec_from_file_location(
            "fixture_instagram_worker",
            Path(instagram.__file__).with_name("_instagram_runner.py"),
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def collect_fixture(self, settings=None, budget=4999):
        import types

        class Client:

            def __init__(self):
                self.logger = types.SimpleNamespace(disabled=False)

            def user_info_by_username(self, username):
                return {
                    "pk": "1",
                    "username": "fixture",
                    "full_name": "Fixture Name",
                    "biography": "Contact: fixture@example.invalid",
                    "follower_count": 2,
                    "following_count": 2,
                    "profile_pic_url": "https://example.invalid/avatar.jpg",
                    "public_email": "public@example.invalid",
                }

            def user_followers(self, uid, amount=0):
                return {
                    "2": {"pk": "2", "username": "second"},
                    "3": {"pk": "3", "username": "third"},
                }

            user_following = user_followers

            def iter_user_medias(self, uid, amount=0, page_size=12):
                yield {
                    "pk": "m1",
                    "id": "m1_1",
                    "code": "OLD",
                    "caption_text": "Old",
                    "taken_at": "2026-01-01",
                    "thumbnail_url": "https://example.invalid/old.jpg",
                }
                yield {
                    "pk": "m2",
                    "id": "m2_1",
                    "code": "NEW",
                    "caption_text": "New",
                    "taken_at": "2026-10-14",
                    "thumbnail_url": "https://example.invalid/new.jpg",
                }

            def media_comments(self, media_id, amount=20):
                return [
                    {
                        "pk": "c1",
                        "text": "Fixture comment",
                        "user": {"username": "commenter"},
                        "created_at_utc": "2026-10-14",
                    }
                ]

            def user_stories(self, uid, amount=None):
                return [
                    {
                        "pk": "s1",
                        "taken_at": "2026-10-13",
                        "thumbnail_url": "https://example.invalid/story.jpg",
                    },
                    {
                        "pk": "s2",
                        "taken_at": "2026-10-14",
                        "thumbnail_url": "https://example.invalid/story2.jpg",
                    },
                ]

            def user_highlights(self, uid, amount=0):
                return [{"pk": "h1", "title": "Highlight", "latest_reel_media": 1}]

            def highlight_info(self, pk):
                return {
                    "items": [
                        {
                            "pk": "hs1",
                            "taken_at": "2026-10-14",
                            "thumbnail_url": "https://example.invalid/highlight.jpg",
                        }
                    ]
                }

        with (
            tempfile.TemporaryDirectory() as folder,
            patch.dict(
                "sys.modules",
                {
                    "instagrapi": types.SimpleNamespace(Client=Client),
                    "requests": types.SimpleNamespace(
                        get=Mock(side_effect=AssertionError("No network"))
                    ),
                },
            ),
        ):
            config = {**instagram.DEFAULTS, **(settings or {})}
            payload = {
                "settings": config,
                "username": "fixture",
                "user_id": "",
                "checkpoint": str(Path(folder) / "checkpoint.json"),
                "session_output": str(Path(folder) / "session.json"),
                "node_budget": budget,
                "transient": {},
            }
            return self.worker().run(payload)

    def test_default_sections_do_not_collect_posts_or_highlights(self):
        result = self.collect_fixture()
        roots = {
            o["group_path"][0]["id"] for o in result["outputs"] if o.get("group_path")
        }
        self.assertEqual(
            roots,
            {"profile", "contacts", "followers", "following", "stories", "recovery"},
        )
        self.assertTrue(
            any(
                (
                    o["type"] == "email"
                    and o["data"]["value"] == "public@example.invalid"
                    for o in result["outputs"]
                )
            )
        )
        self.assertTrue(any((o["type"] == "image" for o in result["outputs"])))

    def test_all_sections_have_nested_results_and_latest_story_limit(self):
        result = self.collect_fixture(
            {
                "include_posts": True,
                "include_highlights": True,
                "stories_limit": 1,
                "posts_limit": 1,
            }
        )
        self.assertEqual(result["counts"]["posts"], 1)
        self.assertEqual(result["counts"]["stories"], 1)
        self.assertTrue(
            any(
                (
                    len(o.get("group_path", [])) == 4 and o["label"] == "Kommentar"
                    for o in result["outputs"]
                )
            )
        )
        self.assertTrue(
            any((o.get("data", {}).get("value") == "New" for o in result["outputs"]))
        )
        self.assertFalse(
            any((o.get("data", {}).get("value") == "Old" for o in result["outputs"]))
        )
        self.assertTrue(
            any(
                (
                    "s2" in o.get("data", {}).get("value", "")
                    for o in result["outputs"]
                    if o["type"] == "url"
                )
            )
        )

    def test_zero_limits_and_project_budget_preserve_partial_results(self):
        result = self.collect_fixture(
            {"followers_limit": 0, "following_limit": 0, "stories_limit": 0}
        )
        self.assertEqual(result["counts"]["followers"], 2)
        self.assertEqual(result["counts"]["following"], 2)
        self.assertEqual(result["counts"]["stories"], 2)
        partial = self.collect_fixture(budget=2)
        self.assertTrue(partial["warnings"])
        self.assertTrue(
            any(
                (
                    o["type"] == "error" and o["label"] == "Teilabruf"
                    for o in partial["outputs"]
                )
            )
        )
        self.assertLessEqual(len(partial["outputs"]), 3)


if __name__ == "__main__":
    unittest.main()


class PluginMetadataContracts(unittest.TestCase):

    def test_malformed_declarative_fields_are_rejected_before_install(self):
        base = {
            "name": "Fixture",
            "actions": [{"id": "x", "name": "X", "inputs": ["profile"]}],
        }
        for key, value in [
            ("providers", {}),
            ("settings_only", True),
            ("parameter_sections", [{"key": "x", "toggle": None}]),
            ("max_inputs", False),
            ("generic_profile", "yes"),
        ]:
            descriptor = copy.deepcopy(base)
            descriptor["actions"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                Manager.validate_descriptor(descriptor)
        Manager.validate_descriptor(copy.deepcopy(instagram.PLUGIN))

    @unittest.skipUnless(
        Path("/run/argus/worker.sock").exists(),
        "Requires enabled namespace worker runtime",
    )
    def test_community_connection_action_uses_same_verified_runner(self):
        from core.plugin_manager import CommunityPlugin

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "plugin.py"
            path.write_text(
                'def connect(action,params,context):\n return {"authenticated":params["token"]=="fixture","code_seen":context["transient"].get("verification_code")}\n'
            )
            result = CommunityPlugin({"id": "fixture"}, path).connect(
                "login",
                {"token": "fixture"},
                {"transient": {"verification_code": "123456"}},
            )
            self.assertTrue(result["authenticated"])
            self.assertEqual(result["code_seen"], "123456")


class DeploymentFixtureContracts(unittest.TestCase):

    def test_shipped_bundle_matches_authored_module_digest(self):
        import hashlib

        root = app.ROOT
        manifest = json.loads((root / "static" / "build-manifest.json").read_text())
        for relative, digest in manifest["sources"].items():
            self.assertEqual(
                hashlib.sha256((root / relative).read_bytes()).hexdigest(),
                digest,
                relative,
            )
        self.assertEqual(
            hashlib.sha256((root / "static/app.js").read_bytes()).hexdigest(),
            manifest["bundle_sha256"],
        )
