"""Transactional database/import/search contracts using synthetic local records."""

import io
from pathlib import Path
from core.database import connect as sqlite_connect
import tempfile
import unittest

from core.dataset_imports import DatasetImports, xml
from core.datasets import DatasetRepository
from core.errors import AppError
from core.files import FileRepository
from plugins import database_search
from plugins._database_faces import search as face_search


class Databases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.connect = lambda: sqlite_connect(self.path / "db.sqlite")
        with self.connect() as db:
            db.execute(
                "CREATE TABLE uploaded_files (id TEXT PRIMARY KEY,filename TEXT,mime TEXT,size INTEGER,is_image INTEGER)"
            )
        self.files = FileRepository(self.connect, self.path)
        self.files.collect_unused = lambda _: None
        self.repo = DatasetRepository(self.connect, self.files, lambda: "fixture")
        self.imports = DatasetImports(self.repo)

    def test_revision_conflict_and_row_failure_are_atomic(self):
        data = self.repo.create(
            {"title": "Fixture", "fields": [{"name": "Count", "type": "number"}]}
        )
        field = data["fields"][0]["id"]
        with self.assertRaises(AppError):
            self.repo.mutate(
                data["id"],
                {
                    "revision": 1,
                    "operation": "rows",
                    "rows": [{"cells": {field: 1}}, {"cells": {field: "invalid"}}],
                },
            )
        self.assertEqual(self.repo.page(data["id"])["total"], 0)
        updated = self.repo.mutate(
            data["id"],
            {"revision": 1, "operation": "rows", "rows": [{"cells": {field: 2}}]},
        )
        self.assertEqual(updated["revision"], 2)
        with self.assertRaises(AppError) as error:
            self.repo.mutate(data["id"], {"revision": 1, "operation": "delete"})
        self.assertEqual(error.exception.status, 409)

    def test_csv_mapping_consumed_once_and_full_record_search(self):
        upload = self.files.upload(
            b"Email,Count\nfixture@example.invalid,2\nother@example.invalid,3\n",
            "fixture.csv",
        )
        preview = self.imports.preview({"files": [upload["file_id"]]})
        body = {
            "preview_id": preview["id"],
            "title": "Imported",
            "mapping": [
                {"source": "Email", "type": "email"},
                {"source": "Count", "type": "number"},
            ],
        }
        committed = self.imports.commit(body)
        with self.assertRaises(AppError):
            self.imports.commit(body)
        dataset = self.repo.snapshot(committed["database_id"])
        inputs = [
            {"id": "db", "type": "database", "data": {"database_id": dataset["id"]}},
            {
                "id": "query",
                "type": "email",
                "data": {"value": "FIXTURE@example.invalid"},
            },
        ]
        context = {"datasets": self.repo}
        prompt = database_search.run("search", inputs, {}, context)
        self.assertEqual(prompt["input_request"]["kind"], "database_column")
        result = database_search.run(
            "search", inputs, {"column_id": dataset["fields"][0]["id"]}, context
        )
        self.assertEqual(len(result["outputs"]), 2)
        self.assertEqual(len({o["group_id"] for o in result["outputs"]}), 1)
        self.assertEqual(result["outputs"][1]["data"]["value"], "2.0")

    def test_images_create_rows_and_mock_comparison_returns_full_record(self):
        from PIL import Image

        stream = io.BytesIO()
        Image.new("RGB", (8, 8), "blue").save(stream, format="PNG")
        uploads = [
            self.files.upload(stream.getvalue(), f"dummy-{i}.png") for i in range(2)
        ]
        preview = self.imports.preview({"files": [u["file_id"] for u in uploads]})
        self.assertEqual(preview["total"], 2)
        committed = self.imports.commit(
            {
                "preview_id": preview["id"],
                "title": "Images",
                "mapping": [
                    {"source": "Images", "type": "image"},
                    {"source": "Filename", "type": "value"},
                ],
            }
        )
        dataset = self.repo.snapshot(committed["database_id"])
        inputs = [
            {"id": "db", "type": "database", "data": {"database_id": dataset["id"]}},
            {"id": "ref", "type": "image", "data": uploads[0]},
        ]
        calls = []

        def mock_verify(*args):
            calls.append(args)
            return {
                "outputs": [
                    {
                        "type": "value",
                        "source": {
                            "result": {"verified": len(calls) == 1, "distance": 0.1}
                        },
                    }
                ]
            }

        result = face_search(
            inputs,
            {"column_id": dataset["fields"][0]["id"]},
            {"datasets": self.repo},
            mock_verify,
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(result["outputs"]), 2)
        self.assertTrue(result["outputs"][0]["source"]["comparison"]["verified"])

    def test_xml_entities_are_rejected(self):
        with self.assertRaises(AppError):
            xml(b'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>')
