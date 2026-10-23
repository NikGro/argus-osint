"""Tool failures must survive edits made while the tool was running."""

import copy
import threading
from types import SimpleNamespace
import unittest

from core.actors import ActorService


class FailingModule:
    PLUGIN = {
        "id": "fixture",
        "name": "Fixture tool",
        "actions": [{"id": "lookup", "name": "Lookup", "inputs": ["username"]}],
    }

    @staticmethod
    def run(action, inputs, params, context):
        raise ValueError("synthetic upstream failure")


class FakeManager:
    def module(self, plugin_id):
        return FailingModule if plugin_id == "fixture" else None

    def secret_fields(self, plugin_id, settings=None):
        return set()

    def action_params(self, plugin_id, action_id):
        return {}

    def node_defaults(self):
        return {}

    def installed(self):
        return []


def base_document():
    return {
        "nodes": [
            {
                "id": "name",
                "type": "username",
                "label": "fixture",
                "data": {"value": "fixture"},
                "x": 0,
                "y": 0,
            },
            {
                "id": "tool",
                "type": "actor",
                "label": "Lookup",
                "data": {"plugin": "fixture", "action": "lookup", "params": {}},
                "x": 300,
                "y": 0,
            },
        ],
        "edges": [{"id": "e1", "source": "name", "target": "tool"}],
        "groups": [],
        "runs": [],
    }


class FailureSurvivesConcurrentEdits(unittest.TestCase):

    def run_failing_tool(self, concurrent_edit):
        stored = {"revision": 1, "title": "Fixture", "document": base_document()}
        saved = []

        def load(pid):
            return {**copy.deepcopy(stored), "archived_at": None}

        def save(pid, title, document, revision):
            saved.append(copy.deepcopy(document))
            return {"revision": revision + 1, "document": document}

        service = ActorService(
            FakeManager(),
            load,
            save,
            lambda node: (node.get("x", 0), node.get("y", 0), 210, 76),
            lambda: {"node_display_defaults": {}},
            lambda fid: None,
            lambda: "2026-01-01T00:00:00+00:00",
            threading.Lock(),
            None,
        )
        original_load = service.load

        def load_with_edit(pid):
            project = original_load(pid)
            if concurrent_edit and load_with_edit.calls:
                # The user saved a new note while the tool was running.
                project["revision"] = 2
                project["document"]["nodes"].append(
                    {
                        "id": "note",
                        "type": "note",
                        "label": "user note",
                        "data": {},
                        "x": 0,
                        "y": 200,
                    }
                )
            load_with_edit.calls += 1
            return project

        load_with_edit.calls = 0
        service.load = load_with_edit
        service.execute("project", {"actor_id": "tool", "revision": 1})
        return SimpleNamespace(document=saved[-1])

    def assert_failure_recorded(self, document):
        tool = next(n for n in document["nodes"] if n["id"] == "tool")
        self.assertEqual(tool["data"]["status"], "failed")
        errors = [n for n in document["nodes"] if n["type"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("synthetic upstream failure", errors[0]["data"]["message"])
        self.assertEqual([r["status"] for r in document["runs"]], ["failed"])

    def test_failure_is_recorded_without_concurrent_edit(self):
        self.assert_failure_recorded(self.run_failing_tool(False).document)

    def test_failure_is_kept_next_to_concurrent_edit(self):
        document = self.run_failing_tool(True).document
        self.assert_failure_recorded(document)
        self.assertIn("note", [n["id"] for n in document["nodes"]])


if __name__ == "__main__":
    unittest.main()
