"""On-demand plugins, tools and parallel workers; local sources only, no network."""

import tool_stubs  # noqa: F401  (external tools count as installed)
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from core import system_resources, tools
from core.database import connect
from core.errors import AppError, DomainError
from core.jobs import Jobs
from core.plugin_manager import Manager

ROOT = Path(__file__).resolve().parents[1]


class ToolRegistry(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        for name, value in (("_root", Path(self.folder.name)), ("_owned", True)):
            patcher = patch.object(tools, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def recipe(self, fail=False):
        def steps(job):
            (job.path / "bin").mkdir()
            (job.path / "bin" / "fixture").write_text("#!/bin/sh\n")
            if fail:
                raise AppError("tool_install_failed", 502)

        return tools.Recipe("Fixture", "1", steps)

    def test_marker_is_written_last_and_removal_deletes_everything(self):
        with patch.dict(tools.RECIPES, {"fixture": self.recipe()}):
            self.assertFalse(tools.installed("fixture"))
            with self.assertRaises(AppError):
                tools.require("fixture")
            self.assertTrue(tools.install("fixture"))
            self.assertFalse(tools.install("fixture"))
            self.assertTrue(tools.executable("fixture", "fixture").endswith("fixture"))
            self.assertGreater(tools.status()["fixture"]["size"], 0)
            tools.remove("fixture")
            self.assertFalse(tools.directory("fixture").exists())

    def test_failed_installation_leaves_nothing_behind(self):
        with patch.dict(tools.RECIPES, {"fixture": self.recipe(fail=True)}):
            with self.assertRaises(AppError):
                tools.install("fixture")
            self.assertFalse(tools.directory("fixture").exists())
            self.assertFalse(tools.installed("fixture"))

    def test_external_tool_directory_is_never_deleted(self):
        with patch.dict(tools.RECIPES, {"fixture": self.recipe()}):
            tools.install("fixture")
            with patch.object(tools, "_owned", False):
                tools.remove("fixture")
            self.assertTrue(tools.installed("fixture"))

    def test_outdated_recipe_counts_as_missing(self):
        with patch.dict(tools.RECIPES, {"fixture": self.recipe()}):
            tools.install("fixture")
        with patch.dict(
            tools.RECIPES, {"fixture": tools.Recipe("Fixture", "2", lambda job: None)}
        ):
            self.assertFalse(tools.installed("fixture"))


class NativePlugins(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)

    def manager(self, source=ROOT):
        return Manager(self.root / "db.sqlite3", self.root, source=str(source))

    def test_starts_without_plugins_and_installs_from_the_catalogue(self):
        manager = self.manager()
        self.assertFalse([p for p in manager.installed() if p.get("actions")])
        item = next(p for p in manager.library() if p["id"] == "username")
        self.assertFalse(item["installed"])
        self.assertIn("sherlock", [tool["id"] for tool in item["tool_status"]])
        manager.install_now("username", with_tools=False)
        self.assertIn("username", {p["id"] for p in manager.installed()})
        # A restart loads the installed copy from the data volume.
        reloaded = self.manager()
        self.assertIn("username", reloaded.builtins)
        self.assertTrue(
            Path(reloaded.builtins["username"].__file__).is_relative_to(self.root)
        )

    def test_changed_source_file_is_rejected(self):
        source = self.root / "source"
        shutil.copytree(ROOT / "plugins", source / "plugins")
        (source / "plugins" / "merge.py").write_text("PLUGIN = {}\n")
        manager = self.manager(source)
        with self.assertRaises(DomainError):
            manager.install_now("merge", with_tools=False)
        self.assertNotIn("merge", {p["id"] for p in manager.installed()})
        self.assertFalse((self.root / "plugins" / "native" / "merge").exists())

    def test_uninstall_keeps_settings_and_prunes_unused_tools(self):
        manager = self.manager()
        manager.install_now("username", with_tools=False)
        manager.install_now("email", with_tools=False)
        removed = []
        with (
            patch.object(tools, "installed", return_value=True),
            patch.object(tools, "remove", side_effect=removed.append),
            patch("core.catalogues.build"),
        ):
            manager.uninstall("username")
        # Email still needs consensus, user_scanner and blackbird.
        self.assertIn("sherlock", removed)
        self.assertIn("maigret", removed)
        self.assertNotIn("consensus", removed)
        self.assertNotIn("blackbird", removed)

    def test_background_install_reports_failure(self):
        manager = self.manager(self.root / "missing")
        manager.install("merge")
        deadline = time.monotonic() + 5
        while (
            manager.progress.get("merge", {}).get("state") == "installing"
            and time.monotonic() < deadline
        ):
            time.sleep(0.02)
        item = next(p for p in manager.library() if p["id"] == "merge")
        self.assertEqual(item["progress"]["state"], "failed")
        self.assertFalse(item["installed"])

    def test_catalogue_matches_repository(self):
        catalogue = json.loads((ROOT / "plugins" / "native.json").read_text())
        for plugin in catalogue["plugins"]:
            for path, digest in plugin["files"].items():
                with self.subTest(path=path):
                    self.assertEqual(
                        hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest
                    )
            self.assertTrue(set(plugin["tools"]) <= set(tools.RECIPES))


class ParallelWorkers(unittest.TestCase):
    def jobs(self, workers, execute):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)

        def fixture_connect():
            return connect(Path(folder.name) / "jobs.db")

        with fixture_connect() as conn:
            conn.execute(
                "CREATE TABLE project_archive(project_id TEXT, archived_at TEXT)"
            )
        projects = Mock()
        projects.load.side_effect = lambda pid: {
            "id": pid,
            "archived_at": None,
            "revision": 1,
            "document": {
                "nodes": [{"id": "actor", "type": "actor", "data": {}}],
                "edges": [],
                "runs": [],
            },
        }
        jobs = Jobs(
            fixture_connect,
            projects,
            execute,
            lambda: time.strftime("%Y-%m-%dT%H:%M:%S"),
            start=False,
            workers=workers,
        )
        self.addCleanup(jobs.close)
        return jobs

    def test_configured_workers_run_tools_at_the_same_time(self):
        running, peak, lock = [0], [0], threading.Lock()
        gate = threading.Event()

        def execute(pid, body):
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            gate.wait(3)
            with lock:
                running[0] -= 1
            return {"document": {"runs": []}}

        jobs = self.jobs(3, execute)
        jobs.start()
        self.assertEqual(jobs.alive(), 3)
        ids = [
            jobs.submit(f"p{i}", {"actor_id": "actor"}, f"fixture-parallel-key-{i}")[
                "id"
            ]
            for i in range(3)
        ]
        deadline = time.monotonic() + 3
        while peak[0] < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        gate.set()
        self.assertEqual(peak[0], 3)
        while (
            any(jobs.get(i)["state"] != "completed" for i in ids)
            and time.monotonic() < deadline + 3
        ):
            time.sleep(0.01)
        self.assertTrue(all(jobs.get(i)["state"] == "completed" for i in ids))

    def test_resize_retires_extra_workers(self):
        jobs = self.jobs(4, lambda pid, body: {"document": {"runs": []}})
        jobs.start()
        jobs.resize(1)
        with jobs.condition:
            jobs.condition.notify_all()
        deadline = time.monotonic() + 4
        while jobs.alive() > 1 and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(jobs.alive(), 1)
        jobs.resize(2)
        self.assertEqual(jobs.alive(), 2)


class Resources(unittest.TestCase):
    def test_recommendation_is_limited_by_cores_and_memory(self):
        gib = 1024**3
        self.assertEqual(system_resources.recommend(8, 64 * gib), 8)
        self.assertEqual(system_resources.recommend(8, 4 * gib), 2)
        self.assertEqual(system_resources.recommend(1, 512 * 1024**2), 1)
        self.assertEqual(system_resources.recommend(128, 1024 * gib), 32)
        detected = system_resources.detect()
        self.assertGreaterEqual(detected["recommended_workers"], 1)
        self.assertGreaterEqual(detected["cpu_count"], 1)


if __name__ == "__main__":
    unittest.main()
