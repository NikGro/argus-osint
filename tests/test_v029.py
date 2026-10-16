"""Offline checks for image preflight and operational logging. No model is loaded."""

import json
import logging
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from core.database import connect
from core.system_logs import SystemLogs
from plugins import deepface_tool


class ImagePreflight(unittest.TestCase):
    def test_oversized_pair_requests_permission_before_any_inference(self):
        image = MagicMock()
        image.__enter__.return_value = SimpleNamespace(width=8000, height=6000)
        with (
            patch("PIL.Image.open", return_value=image),
            patch.object(deepface_tool, "bounded_run") as process,
        ):
            result = deepface_tool.run(
                "verify",
                [
                    {"id": str(i), "type": "image", "data": {"file_id": str(i)}}
                    for i in range(2)
                ],
                {},
                {"resolve_file": lambda fid: "/fixture/" + fid},
            )
        process.assert_not_called()
        self.assertEqual(result["outputs"], [])
        self.assertEqual(result["input_request"]["kind"], "deepface_resize")
        self.assertTrue(result["input_request"]["fields"][0]["default"])


class OperationalLogs(unittest.TestCase):
    def test_search_export_capacity_clear_and_secret_redaction(self):
        with tempfile.TemporaryDirectory() as directory:
            handler = SystemLogs(
                lambda: connect(Path(directory) / "logs.sqlite"),
                lambda: "2026-10-16T00:00:00Z",
                capacity=3,
            )

            def record(message):
                handler.handle(
                    logging.LogRecord(
                        "fixture-system-logs",
                        logging.INFO,
                        __file__,
                        1,
                        message,
                        (),
                        None,
                    )
                )

            try:
                for index in range(5):
                    record(
                        json.dumps(
                            {
                                "event": "request",
                                "index": index,
                                "password": "dummy-secret",
                            }
                        )
                    )
                record("Unstructured third-party diagnostics are excluded")
                page = handler.page("request")
                self.assertEqual(page["total"], 3)
                self.assertNotIn("dummy-secret", json.dumps(page))
                self.assertEqual(len(list(handler.export("request", 0))), 3)
                self.assertEqual(len(list(handler.export("request", 1))), 1)
                self.assertEqual(handler.page('"index": 4')["total"], 1)
                handler.clear()
                self.assertEqual(handler.page()["total"], 0)
            finally:
                handler.close()


if __name__ == "__main__":
    unittest.main()
