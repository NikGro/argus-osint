import copy
import unittest
from core import graph
from runtime_fixture import app


class NestedGroupTests(unittest.TestCase):

    def document(self):
        return {
            "nodes": [
                {
                    "id": "n",
                    "type": "note",
                    "label": "Note",
                    "data": {"text": "Test"},
                    "x": 0,
                    "y": 0,
                    "report": True,
                }
            ],
            "edges": [],
            "runs": [],
            "groups": [
                {"id": "outer", "label": "Outer", "members": []},
                {
                    "id": "inner",
                    "label": "Inner",
                    "members": ["n"],
                    "parent_id": "outer",
                },
            ],
            "report_notes": "",
        }

    def test_parent_tree_and_report_preserve_nested_members(self):
        doc = app.validate(self.document())
        self.assertEqual(graph.group_node_ids(doc, doc["groups"][0]), {"n"})
        text = app.report({"title": "Nested", "document": doc}).decode()
        self.assertIn("Outer", text)
        self.assertIn("Inner", text)

    def test_cycles_and_missing_parents_are_rejected(self):
        doc = self.document()
        doc["groups"][0]["parent_id"] = "inner"
        with self.assertRaises(ValueError):
            app.validate(doc)
        doc = self.document()
        doc["groups"][1]["parent_id"] = "missing"
        with self.assertRaises(ValueError):
            app.validate(doc)

    def test_deep_parent_chain_has_no_arbitrary_depth_limit(self):
        doc = self.document()
        doc["groups"] = [
            {
                "id": str(i),
                "members": ["n"] if i == 0 else [],
                **({"parent_id": str(i + 1)} if i < 999 else {}),
            }
            for i in range(1000)
        ]
        app.validate(doc)
        self.assertEqual(graph.group_node_ids(doc, doc["groups"][-1]), {"n"})

    def test_merge_keeps_empty_container_group_with_nonempty_child(self):
        doc = self.document()
        result = graph.merge_documents(doc, copy.deepcopy(doc), copy.deepcopy(doc))
        self.assertEqual(len(result["groups"]), 2)
        self.assertEqual(result["groups"][1]["parent_id"], "outer")
        self.assertEqual(graph.prune_groups(doc["groups"], set()), [])
