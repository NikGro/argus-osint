"""Synthetic database records and mocked processes only; no face inference."""

import tool_stubs  # noqa: F401  (external tools count as installed)
import threading
import tempfile
import unittest
from unittest.mock import Mock, patch

from core.errors import AppError
from core.execution_context import CANCEL_EVENT
from plugins import _database_faces, _process, deepface_tool


class DeepFaceTimeout(unittest.TestCase):
    def test_adapter_passes_no_deadline_to_process(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(
                deepface_tool,
                "bounded_run",
                return_value=('{"verified":false,"distance":0.9,"threshold":0.5}', ""),
            ) as process,
        ):
            deepface_tool.run(
                "verify",
                [
                    {"id": str(i), "type": "image", "data": {"file_id": str(i)}}
                    for i in range(2)
                ],
                {"resize_large_images": True},
                {"resolve_file": lambda ident: ident, "credential_dir": folder},
            )
        self.assertIsNone(process.call_args.args[1])

    def test_run_timeout_is_gone_and_database_search_compares_every_row(self):
        self.assertNotIn("run_timeout", deepface_tool.SCHEMA)
        database = {
            "id": "db",
            "fields": [{"id": "photo", "type": "image"}],
            "rows": [
                {"id": str(i), "cells": {"photo": {"file_id": str(i)}}}
                for i in range(3)
            ],
        }
        verify = Mock(return_value={"outputs": []})
        with patch.object(
            _database_faces,
            "connected_database",
            return_value=({"id": "db"}, database),
        ):
            _database_faces.search(
                [{"type": "database"}, {"id": "ref", "type": "image"}],
                {"column_id": "photo", "max_comparisons": 1000},
                {},
                verify,
            )
        self.assertEqual(verify.call_count, 3)

    def test_comparison_limit_is_kept(self):
        database = {
            "id": "db",
            "fields": [{"id": "photo", "type": "image"}],
            "rows": [
                {"id": str(i), "cells": {"photo": {"file_id": str(i)}}}
                for i in range(3)
            ],
        }
        verify = Mock(return_value={"outputs": []})
        with patch.object(
            _database_faces,
            "connected_database",
            return_value=({"id": "db"}, database),
        ):
            result = _database_faces.search(
                [{"type": "database"}, {"id": "ref", "type": "image"}],
                {"column_id": "photo", "max_comparisons": 2},
                {},
                verify,
            )
        self.assertEqual(verify.call_count, 2)
        self.assertTrue(result["warnings"])

    def test_process_without_deadline_still_obeys_cancellation(self):
        for cancel in (False, True):
            with self.subTest(cancel=cancel):
                process = Mock(returncode=0)
                process.poll.side_effect = [None, 0]
                event = threading.Event()
                if cancel:
                    event.set()
                token = CANCEL_EVENT.set(event)
                try:
                    with (
                        patch.object(
                            _process.subprocess, "Popen", return_value=process
                        ),
                        patch.object(_process.os, "killpg", create=True),
                        patch.object(_process.signal, "SIGKILL", 9, create=True),
                        patch.object(
                            _process.time, "monotonic", side_effect=[0, 100000]
                        ),
                        patch.object(_process.time, "sleep"),
                    ):
                        if cancel:
                            with self.assertRaises(AppError) as caught:
                                _process.bounded_run(["fixture"], None)
                            self.assertEqual(caught.exception.code, "actor_cancelled")
                        else:
                            self.assertEqual(
                                _process.bounded_run(["fixture"], None), ("", "")
                            )
                    process.wait.assert_called_once()
                finally:
                    CANCEL_EVENT.reset(token)
