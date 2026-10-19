"""Current application factory, streaming intake and tool contracts. Offline only."""

import io
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from core.application import create_app
from core.errors import AppError
from core.http_server import Handler
from core.maps import Maps
from core.tool_contracts import result_state, validate_result


class ApplicationLifecycle(unittest.TestCase):

    def test_import_does_not_create_database_or_start_workers(self):
        code = "import server; from core import application; assert application._default is None"
        result = subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_independent_resources_and_explicit_worker_lifetime(self):
        with (
            tempfile.TemporaryDirectory() as first,
            tempfile.TemporaryDirectory() as second,
        ):
            with (
                create_app(first, start_workers=False) as a,
                create_app(second, start_workers=False) as b,
            ):
                self.assertIsNone(a.JOBS.thread)
                a.PROJECTS.create(
                    "Synthetic", {"nodes": [], "edges": [], "groups": [], "runs": []}
                )
                with b.connect() as conn:
                    self.assertEqual(
                        conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0], 0
                    )
                a.JOBS.start()
                self.assertTrue(a.JOBS.thread.is_alive())
                a.JOBS.close()
                self.assertFalse(a.JOBS.thread.is_alive())


class StreamingFiles(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name, start_workers=False)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.app.close)
        self.project = self.app.PROJECTS.create(
            "Files", {"nodes": [], "edges": [], "groups": [], "runs": []}
        )

    def test_bounded_chunks_project_ownership_and_original_bytes(self):

        class Stream(io.BytesIO):

            def read(self, size=-1):
                if not 0 < size <= 65536:
                    raise AssertionError("Unbounded upload read")
                return super().read(size)

        content = b"synthetic binary " * 12000
        result = self.app.FILES.upload_stream(
            Stream(content), len(content), "fixture.bin", self.project["id"]
        )
        path = self.app.FILES.resolve(result["file_id"])
        self.assertEqual(path.parent.name, self.project["id"])
        self.assertEqual(path.read_bytes(), content)

    def test_truncated_upload_leaves_no_artifact_or_metadata(self):
        with self.assertRaises(AppError):
            self.app.FILES.upload_stream(
                io.BytesIO(b"short"), 99, "fixture.bin", self.project["id"]
            )
        self.assertEqual(list((Path(self.temp.name) / "files").rglob("*.upload")), [])
        with self.app.connect() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM uploaded_files").fetchone()[0], 0
            )

    def test_parser_admission_is_bounded(self):
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(body_slots=threading.BoundedSemaphore(1))
        handler.body_reserved = False
        handler.reserve_body()
        other = object.__new__(Handler)
        other.server = handler.server
        other.body_reserved = False
        with self.assertRaises(AppError) as failure:
            other.reserve_body()
        self.assertEqual(
            (failure.exception.code, failure.exception.status), ("server_busy", 503)
        )
        handler.server.body_slots.release()
        with patch(
            "http.server.BaseHTTPRequestHandler.handle_one_request",
            lambda _: other.reserve_body(),
        ):
            other.handle_one_request()
        self.assertTrue(other.server.body_slots.acquire(blocking=False))


class ToolContracts(unittest.TestCase):

    def test_state_precedence_and_partial_success(self):
        for data, expected in [
            ({}, "completed"),
            ({"warnings": ["limited"]}, "completed"),
            ({"candidates": [{}]}, "needs_selection"),
            ({"input_request": {"fields": []}}, "needs_input"),
            ({"failed": True, "candidates": [{}]}, "failed"),
        ]:
            self.assertEqual(
                result_state(validate_result({"outputs": [], **data})), expected
            )

    def test_invalid_transport_shapes_are_rejected(self):
        for result in [
            None,
            {"outputs": "invalid"},
            {"outputs": [], "warnings": "invalid"},
            {"outputs": [], "input_request": []},
        ]:
            with self.assertRaises(ValueError):
                validate_result(result)

    def test_unavailable_map_is_localized_html(self):
        self.assertIn(b'role="status"', Maps.unavailable("en"))
        self.assertIn(b"currently unavailable", Maps.unavailable("en"))
        self.assertIn("nicht verfügbar", Maps.unavailable("de").decode())
        self.assertNotIn(b"request_id", Maps.unavailable("en"))
