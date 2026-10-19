from core.errors import AppError
import json
import unittest
from uuid import uuid4
from runtime_fixture import app


class ArchiveTests(unittest.TestCase):

    def create(self):
        pid = uuid4().hex
        doc = {"nodes": [], "edges": [], "groups": [], "runs": []}
        with app.connect() as db:
            db.execute(
                "INSERT INTO projects (id,title,document,revision,updated_at) VALUES (?,?,?,?,?)",
                (pid, "Archive test", json.dumps(doc), 1, app.now()),
            )
        return pid

    def test_archive_restore_preserves_graph(self):
        pid = self.create()
        archived = app.archive_project(pid, True, 1)
        self.assertTrue(archived["archived_at"])
        restored = app.archive_project(pid, False, 2)
        self.assertIsNone(restored["archived_at"])
        self.assertEqual(restored["document"], archived["document"])

    def test_active_project_cannot_be_deleted(self):
        pid = self.create()
        with self.assertRaises(AppError):
            app.delete_archived_project(pid, 1)
        self.assertEqual(app.load_project(pid)["revision"], 1)

    def test_delete_only_archived_project_at_current_revision(self):
        pid = self.create()
        app.archive_project(pid, True, 1)
        with self.assertRaises(AppError):
            app.delete_archived_project(pid, 1)
        app.delete_archived_project(pid, 2)
        with self.assertRaises(AppError):
            app.load_project(pid)

    def test_stale_archive_is_rejected(self):
        pid = self.create()
        app.archive_project(pid, True, 1)
        with self.assertRaises(AppError):
            app.archive_project(pid, False, 1)
        self.assertTrue(app.load_project(pid)["archived_at"])
