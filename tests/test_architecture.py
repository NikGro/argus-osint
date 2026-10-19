"""Focused contracts for the extracted application services. Offline fixtures only."""

import json
from pathlib import Path
from core.database import connect as sqlite_connect
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock
from core.actor_results import ResultBuilder
from core.files import FileRepository
from core.settings import SettingsRepository


class ExtractedServiceContracts(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / "fixture.sqlite3"
        self.files_dir = self.root / "files"
        self.files_dir.mkdir()
        with self.connect() as conn:
            conn.execute(
                "CREATE TABLE application_settings (id INTEGER PRIMARY KEY, settings TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE uploaded_files (id TEXT PRIMARY KEY, filename TEXT, mime TEXT, size INTEGER, is_image INTEGER)"
            )
        locales = self.root / "static" / "locales"
        locales.mkdir(parents=True)
        for language in ("de", "en"):
            (locales / (language + ".json")).write_text(
                json.dumps({"_meta": {"name": language}})
            )
        self.manager = Mock()
        self.manager.display_defaults.return_value = {}
        self.manager.installed.return_value = []
        self.settings = SettingsRepository(self.connect, self.manager, self.root, {})
        self.files = FileRepository(self.connect, self.files_dir)

    def connect(self):
        return sqlite_connect(self.db)

    def test_settings_validate_before_persisting_and_preserve_untouched_preferences(
        self,
    ):
        self.settings.save(
            {
                "language": "en",
                "tags": [{"id": "one", "name": "Review", "color": "#abcdef"}],
            }
        )
        with self.assertRaises(ValueError):
            self.settings.save({"language": "missing"})
        self.settings.save({"language": "de"})
        value = self.settings.load()
        self.assertEqual(value["language"], "de")
        self.assertEqual(value["tags"][0]["name"], "Review")

    def test_upload_is_not_left_on_disk_after_a_database_failure(self):

        def broken_connection():
            raise sqlite3.OperationalError("fixture")

        service = FileRepository(self.connect, self.files_dir)
        service.connect = broken_connection
        with self.assertRaises(sqlite3.OperationalError):
            service.upload(b"fixture content", "fixture.txt")
        self.assertEqual(list(self.files_dir.iterdir()), [])

    def test_active_content_is_downloaded_and_file_ids_cannot_escape_storage(self):
        result = self.files.upload(b"<script>fixture</script>", "../test.html")
        content, mime, name = self.files.read(result["file_id"])
        self.assertEqual(content, b"<script>fixture</script>")
        self.assertEqual(mime, "application/octet-stream")
        self.assertEqual(name, "test.html")
        with self.assertRaises(ValueError):
            self.files.resolve("../../server.py")

    def test_materializer_retains_provenance_and_native_nested_groups_without_io(self):
        doc = {"nodes": [], "edges": [], "groups": [], "runs": []}
        actor = {"id": "a", "type": "actor", "x": 0, "y": 0}
        result = {
            "outputs": [
                {
                    "type": "value",
                    "label": "Name",
                    "data": {"value": "Fixture"},
                    "group_path": [
                        {"id": "profile", "label": "Profile"},
                        {"id": "facts", "label": "Facts"},
                    ],
                    "source": {"plugin": "fixture"},
                }
            ]
        }
        builder = ResultBuilder(
            lambda n: (n.get("x", 0), n.get("y", 0), 210, 76), lambda: "fixture-time"
        )
        run_id, members = builder.apply(
            doc, actor, [], result, "fixture", "Collect", "fixture-time", {}, {}
        )
        self.assertEqual(members, [doc["nodes"][0]["id"]])
        self.assertEqual(doc["nodes"][0]["evidence"]["run_id"], run_id)
        self.assertEqual(doc["groups"][1]["parent_id"], doc["groups"][0]["id"])
        self.assertEqual(doc["edges"][0]["source"], "a")


class ActorDiagnosticContracts(unittest.TestCase):

    def test_logs_warnings_errors_and_transient_codes_are_redacted_before_persistence(
        self,
    ):
        from core.application import get_default_application

        app = get_default_application()
        from unittest.mock import patch

        doc = {
            "nodes": [
                {
                    "id": "mail",
                    "type": "email",
                    "label": "Fixture",
                    "data": {"value": "fixture@example.invalid"},
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "actor",
                    "type": "actor",
                    "label": "Email",
                    "data": {"plugin": "email", "action": "lookup", "params": {}},
                    "x": 400,
                    "y": 0,
                },
            ],
            "edges": [{"id": "input", "source": "mail", "target": "actor"}],
            "groups": [],
            "runs": [],
        }
        project = app.PROJECTS.create("Diagnostics fixture", doc)
        result = {
            "outputs": [],
            "warnings": ["fixture-password / 654321"],
            "log": "fixture-password 654321",
            "failed": True,
            "error": "fixture-password 654321",
        }
        with (
            patch.object(
                app.MANAGER,
                "action_params",
                return_value={"login_password": "fixture-password"},
            ),
            patch.object(app.PLUGINS["email"], "run", return_value=result),
        ):
            finished = app.execute(
                project["id"],
                {
                    "actor_id": "actor",
                    "revision": project["revision"],
                    "transient": {"verification_code": "654321"},
                },
            )
        run = finished["document"]["runs"][-1]
        self.assertEqual(run["status"], "failed")
        text = json.dumps(run)
        self.assertNotIn("fixture-password", text)
        self.assertNotIn("654321", text)


class HttpLogging(unittest.TestCase):

    def test_successful_gets_are_quiet_and_failures_remain_structured(self):
        from core.application import get_default_application
        from core.http_server import Handler

        app = get_default_application()
        from unittest.mock import patch

        handler = object.__new__(Handler)
        handler.command = "GET"
        handler.request_id = "fixture"
        with patch.object(app.LOGGER, "info") as log:
            for status in (200, 206, 304):
                handler.log_request(status, 128)
            log.assert_not_called()
            handler.log_request(404, 0)
            value = json.loads(log.call_args.args[0])
            self.assertEqual(value["status"], 404)
            handler.command = "POST"
            handler.log_request(201, 0)
            value = json.loads(log.call_args.args[0])
            self.assertEqual(value["status"], 201)
            self.assertEqual(value["method"], "POST")


class OptionalVpnCapability(unittest.TestCase):

    def test_missing_unix_sockets_is_explicitly_unavailable(self):
        from core.vpn import Gateway
        from core.errors import AppError
        from types import SimpleNamespace
        from unittest.mock import patch

        with patch("core.vpn.socket", SimpleNamespace()):
            with self.assertRaises(AppError) as error:
                Gateway().call("status")
        self.assertEqual(error.exception.code, "vpn_unavailable")
