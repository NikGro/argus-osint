"""Offline regression contracts for access, transport, history and durable execution."""

import copy
from email.message import Message
import json
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
import urllib.request
import urllib.error
from uuid import uuid4
from core.http_server import Handler, ApplicationServer
from runtime_fixture import app
from core.access import Access
from core.database import connect
from core.errors import AppError
from core.execution_context import CANCEL_EVENT
from core.jobs import Jobs
from core.public_network import destination, connect_pinned
from core.secrets import SecretStore, redact
from plugins._process import bounded_run


def headers(**values):
    out = Message()
    for key, value in values.items():
        out[key.replace("_", "-")] = value
    return out


def document():
    return {"nodes": [], "edges": [], "groups": [], "runs": [], "report_notes": ""}


class AccessContracts(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.access = Access(Path(self.temp.name), allowed_hosts=["localhost"])

    def test_host_required_even_without_origin(self):
        for value in [
            "rebind.attacker.invalid",
            "localhost.attacker.invalid",
            "localhost@attacker.invalid",
            "localhost/path",
        ]:
            with self.subTest(host=value), self.assertRaises(AppError):
                self.access.check_host(headers(Host=value))
        self.access.check_host(headers(Host="localhost:8080"))
        with self.assertRaises(AppError):
            self.access.check_host(headers())

    def test_cross_site_origin_and_fetch_metadata_rejected(self):
        for extra in [
            {"Origin": "https://foreign.invalid"},
            {"Sec_Fetch_Site": "cross-site"},
        ]:
            with self.assertRaises(AppError):
                self.access.check_host(headers(Host="localhost", **extra))

    def test_cookie_write_requires_csrf_even_without_origin(self):
        sid, csrf, _ = self.access.login(self.access.key, "fixture")
        with self.assertRaises(AppError) as error:
            self.access.session(headers(Cookie="argus_session=" + sid), True)
        self.assertEqual(error.exception.code, "csrf_required")
        self.access.session(
            headers(Cookie="argus_session=" + sid, X_Argus_Token=csrf), True
        )

    def test_bearer_can_authenticate_read_and_write(self):
        self.access.session(headers(Authorization="Bearer " + self.access.key), True)
        with self.assertRaises(AppError):
            self.access.session(headers(), False)

    def test_pairing_is_single_use_and_key_stays_private(self):
        code = self.access.pairing_code
        self.assertTrue(self.access.login(code, "fixture")[2])
        with self.assertRaises(AppError):
            self.access.login(code, "fixture")
        self.assertEqual(
            (Path(self.temp.name) / ".access-key").stat().st_mode & 511, 384
        )

    def test_builtin_runtime_strings_survive_save_without_becoming_secrets(self):
        for plugin, action, params in [
            ("merge", "merge", {"_merge_fingerprint": "fixture", "_merge_0": "1"}),
            ("transform", "code", {"code": "return inputs;"}),
        ]:
            with self.subTest(plugin=plugin):
                doc = document()
                doc["nodes"] = [
                    {
                        "id": "actor",
                        "type": "actor",
                        "label": "Fixture",
                        "x": 0,
                        "y": 0,
                        "data": {"plugin": plugin, "action": action, "params": params},
                    }
                ]
                project = app.PROJECTS.create("runtime string fixture", doc)
                self.assertEqual(
                    project["document"]["nodes"][0]["data"]["params"], params
                )

    def test_descriptor_secret_encrypts_nonstandard_and_structured_fields(self):
        store = SecretStore(self.temp.name)
        value = {"opaque": "secret fixture", "bundle": {"cookie": "fixture"}}
        encrypted = store.seal(value, {"opaque", "bundle"})
        self.assertNotIn("secret fixture", json.dumps(encrypted))
        self.assertEqual(store.reveal(encrypted), value)
        self.assertNotIn("fixture", json.dumps(redact(encrypted, {"opaque", "bundle"})))


class PublicNetworkContracts(unittest.TestCase):

    def test_private_and_mixed_dns_answers_rejected(self):
        for ips in [
            ["127.0.0.1"],
            ["10.0.0.1"],
            ["::1"],
            ["93.184.216.34", "127.0.0.1"],
        ]:
            answers = [
                (
                    socket.AF_INET6 if ":" in ip else socket.AF_INET,
                    socket.SOCK_STREAM,
                    6,
                    "",
                    (ip, 443),
                )
                for ip in ips
            ]
            with (
                patch("socket.getaddrinfo", return_value=answers),
                self.assertRaises(AppError),
            ):
                destination("https://example.invalid")

    def test_connection_uses_validated_numeric_address_without_second_lookup(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        connection = Mock()
        with (
            patch("socket.getaddrinfo", return_value=answers) as resolve,
            patch("socket.socket", return_value=connection),
        ):
            _, actual = connect_pinned("https://example.invalid")
            self.assertIs(actual, connection)
            resolve.assert_called_once()
            connection.connect.assert_called_once_with(("93.184.216.34", 443))

    def test_missing_worker_never_falls_back_to_app_identity(self):
        from core.isolation import invoke

        with (
            patch("core.isolation.Path.exists", return_value=False),
            self.assertRaises(AppError) as error,
        ):
            invoke("community", {})
        self.assertEqual(error.exception.code, "isolation_unavailable")

    def test_stdin_cannot_block_before_timeout_starts(self):
        started = time.monotonic()
        with self.assertRaises(ValueError):
            bounded_run(
                [sys.executable, "-c", "import time;time.sleep(10)"],
                timeout=0.2,
                payload="x" * 2000000,
            )
        self.assertLess(time.monotonic() - started, 3)

    def test_cancellation_terminates_subprocess(self):
        event = threading.Event()
        event.set()
        token = CANCEL_EVENT.set(event)
        try:
            with self.assertRaises(AppError) as error:
                bounded_run(
                    [sys.executable, "-c", "import time;time.sleep(10)"], timeout=5
                )
            self.assertEqual(error.exception.code, "actor_cancelled")
        finally:
            CANCEL_EVENT.reset(token)


class PersistenceContracts(unittest.TestCase):

    def test_rename_preserves_graph_and_checks_revision_including_archive(self):
        project = app.PROJECTS.create("before", document())
        renamed = app.PROJECTS.rename(project["id"], "after", project["revision"])
        self.assertEqual(renamed["title"], "after")
        self.assertEqual(renamed["document"], project["document"])
        with self.assertRaises(AppError):
            app.PROJECTS.rename(project["id"], "stale", project["revision"])
        archived = app.PROJECTS.archive(project["id"], True, renamed["revision"])
        renamed_archive = app.PROJECTS.rename(
            project["id"], "archived title", archived["revision"]
        )
        self.assertEqual(renamed_archive["document"], project["document"])
        self.assertTrue(renamed_archive["archived_at"])
        for title in ["", "   ", None, "x" * 201]:
            with self.assertRaises(AppError):
                app.PROJECTS.rename(project["id"], title, renamed_archive["revision"])

    def test_database_context_closes_after_success_and_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            with connect(Path(folder) / "fixture.db") as conn:
                conn.execute("SELECT 1")
            with self.assertRaises(sqlite3.ProgrammingError):
                conn.execute("SELECT 1")
            try:
                with connect(Path(folder) / "fixture.db") as failed:
                    raise ValueError("fixture")
            except ValueError:
                pass
            with self.assertRaises(sqlite3.ProgrammingError):
                failed.execute("SELECT 1")

    def test_validation_is_nonmutating_and_version_migration_is_persisted(self):
        doc = document()
        original = copy.deepcopy(doc)
        app.validate(doc)
        self.assertEqual(doc, original)
        p = app.PROJECTS.create("fixture", doc)
        self.assertEqual(p["document"]["schema_version"], 1)
        again = app.load_project(p["id"])
        self.assertEqual(again, p)

    def test_large_history_does_not_expand_project_save_payload(self):
        p = app.PROJECTS.create("fixture", document())
        for i in range(5):
            doc = p["document"]
            doc["runs"].append(
                {
                    "id": uuid4().hex,
                    "status": "completed",
                    "started_at": str(i),
                    "log": "x" * (4 * 1024 * 1024),
                    "input_snapshot": [{"fixture": True}],
                }
            )
            p = app.save_project(p["id"], p["title"], doc, p["revision"])
        self.assertLess(len(json.dumps(p["document"])), 20000)
        page = app.PROJECTS.history.page(p["id"])
        self.assertEqual(page["total"], 5)
        self.assertEqual(len(page["runs"][0]["log"]), 4 * 1024 * 1024)
        p = app.PROJECTS.save(
            p["id"], p["title"], p["document"], p["revision"], client=True
        )
        self.assertEqual(app.PROJECTS.history.page(p["id"])["total"], 5)

    def test_reconciliation_uses_key_order_independent_equality(self):
        from core.graph import merge_documents

        base = document()
        base["nodes"] = [{"id": "a", "data": {"a": 1, "b": 2}}]
        local = copy.deepcopy(base)
        local["nodes"][0]["data"] = {"b": 2, "a": 1}
        remote = copy.deepcopy(base)
        remote["nodes"][0]["data"]["a"] = 3
        self.assertEqual(
            merge_documents(base, local, remote)["nodes"][0]["data"]["a"], 3
        )

    def test_archive_blocks_mutation_until_restored(self):
        p = app.PROJECTS.create("fixture", document())
        p = app.archive_project(p["id"], True, p["revision"])
        with self.assertRaises(AppError) as error:
            app.save_project(p["id"], p["title"], p["document"], p["revision"])
        self.assertEqual(error.exception.code, "archived_project")


class DurableJobContracts(unittest.TestCase):

    def test_retry_is_idempotent_and_execution_survives_the_request(self):
        p = app.PROJECTS.create(
            "job fixture",
            {
                **document(),
                "nodes": [
                    {
                        "id": "actor",
                        "type": "actor",
                        "label": "Actor",
                        "data": {"plugin": "transform", "action": "code", "params": {}},
                        "x": 0,
                        "y": 0,
                    }
                ],
            },
        )
        gate = threading.Event()
        calls = []

        def execute(pid, body):
            calls.append(pid)
            gate.wait(2)
            value = app.load_project(pid)
            value["document"]["runs"].append(
                {
                    "id": uuid4().hex,
                    "actor_id": "actor",
                    "status": "completed",
                    "started_at": app.now(),
                }
            )
            return app.save_project(
                pid, value["title"], value["document"], value["revision"]
            )

        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)

        def fixture_connect():
            return connect(Path(folder.name) / "jobs.db")

        with fixture_connect() as conn:
            conn.execute(
                "CREATE TABLE project_archive(project_id TEXT, archived_at TEXT)"
            )
        projects = Mock()
        projects.load.return_value = p
        jobs = Jobs(fixture_connect, projects, execute, app.now, start=False)
        try:
            first = jobs.submit(
                p["id"], {"actor_id": "actor"}, "fixture-idempotent-key"
            )
            second = jobs.submit(
                p["id"], {"actor_id": "actor"}, "fixture-idempotent-key"
            )
            self.assertEqual(first["id"], second["id"])
            thread = threading.Thread(target=jobs.worker, daemon=True)
            thread.start()
            deadline = time.monotonic() + 3
            while not calls and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(jobs.get(first["id"])["state"], "running")
            gate.set()
            while (
                jobs.get(first["id"])["state"] == "running"
                and time.monotonic() < deadline
            ):
                time.sleep(0.01)
            self.assertEqual(jobs.get(first["id"])["state"], "completed")
            self.assertEqual(len(calls), 1)
            self.assertEqual(
                jobs.submit(p["id"], {"actor_id": "actor"}, "fixture-idempotent-key")[
                    "id"
                ],
                first["id"],
            )
        finally:
            gate.set()
            jobs.stopped = True
            with jobs.condition:
                jobs.condition.notify_all()


class HttpAccessContracts(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.http = ApplicationServer(("127.0.0.1", 0), Handler)
        cls.base = "http://127.0.0.1:" + str(cls.http.server_port)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def call(self, path, body=None, extra=None):
        req = urllib.request.Request(
            self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json", **(extra or {})},
        )
        return urllib.request.urlopen(req, timeout=3)

    def test_all_sensitive_routes_require_authentication(self):
        for path, body in [
            ("/api/projects", None),
            ("/api/repositories/add", {"url": "https://example.invalid"}),
            ("/api/plugin/install", {"id": "fixture"}),
            ("/api/projects/fake/run", {}),
        ]:
            with (
                self.subTest(path=path),
                self.assertRaises(urllib.error.HTTPError) as error,
            ):
                self.call(path, body)
            self.assertEqual(error.exception.code, 401)
            self.assertEqual(
                json.load(error.exception)["error"]["code"], "authentication_required"
            )

    def test_login_cookie_requires_explicit_write_token(self):
        with self.call("/api/auth/login", {}, {"X-Argus-Client": "web"}) as response:
            session = json.load(response)
            self.assertNotIn("initial_key", session)
            cookie = response.headers["Set-Cookie"].split(";")[0]
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call("/api/projects", {"title": "blocked"}, {"Cookie": cookie})
        self.assertEqual(error.exception.code, 403)
        with self.call(
            "/api/projects",
            {"title": "fixture"},
            {"Cookie": cookie, "X-Argus-Token": session["csrf_token"]},
        ) as response:
            self.assertEqual(response.status, 201)

    def test_passwordless_session_still_rejects_foreign_origins_and_missing_header(
        self,
    ):
        for extra in [
            {},
            {"X-Argus-Client": "web", "Origin": "https://foreign.invalid"},
            {"X-Argus-Client": "web", "Sec-Fetch-Site": "cross-site"},
        ]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.call("/api/auth/login", {}, extra)
            self.assertEqual(error.exception.code, 403)

    def test_bad_host_rejected_before_health(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call("/api/health", extra={"Host": "attacker.invalid"})
        self.assertEqual(error.exception.code, 403)

    def test_csp_and_http_cache_headers_prohibit_remote_embeds(self):
        with self.call("/") as response:
            self.assertEqual(response.version, 11)
            csp = response.headers["Content-Security-Policy"]
            self.assertIn("img-src 'self' data: blob:", csp)
            self.assertIn("frame-src 'self'", csp)
            self.assertIn("max-age=", response.headers["Cache-Control"])
            etag = response.headers["ETag"]
        with self.assertRaises(urllib.error.HTTPError) as response:
            self.call("/", extra={"If-None-Match": etag})
        self.assertEqual(response.exception.code, 304)
