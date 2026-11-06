"""Schema 2 turns generated German texts into English and leaves user text alone."""

import unittest

import tool_stubs  # noqa: F401  (puts the repository on sys.path)

from core.migrations import VERSION, migrate


def document():
    return {
        "schema_version": 1,
        "nodes": [
            {"id": "a", "type": "actor", "label": "Metadaten extrahieren", "data": {}},
            {
                "id": "b",
                "type": "image",
                "label": "Bild 3",
                "data": {},
                "evidence": {"run_id": "r"},
            },
            {
                "id": "c",
                "type": "value",
                "label": "Holehe · Suchprotokoll",
                "data": {"value": "Ja"},
                "evidence": {"run_id": "r"},
            },
            {
                "id": "d",
                "type": "note",
                "label": "Meine Notiz über Bild 3",
                "data": {"text": "Bild 3 prüfen"},
                "evidence": {"origin": "manual"},
            },
            {
                "id": "e",
                "type": "value",
                "label": "Kontaktdaten",
                "data": {},
                "evidence": {"run_id": "r", "label_custom": True},
            },
            {
                "id": "f",
                "type": "error",
                "label": "Fehler",
                "data": {
                    "title": "Teilabruf",
                    "message": "Suchwerkzeug fehlgeschlagen",
                },
                "evidence": {"run_id": "r"},
            },
        ],
        "edges": [
            {
                "id": "x",
                "source": "a",
                "target": "b",
                "label": "Metadatum",
                "run_id": "r",
            },
            {"id": "y", "source": "a", "target": "d", "label": "Bild"},
        ],
        "groups": [{"id": "g", "label": "Metadaten · Foto.jpg", "run_id": "r"}],
        "runs": [{"id": "r", "warnings": ["Zeitlimit erreicht; Suche unvollständig."]}],
    }


class EnglishMigration(unittest.TestCase):
    def test_generated_texts_become_english(self):
        doc = migrate(document())
        self.assertEqual(doc["schema_version"], VERSION)
        nodes = {n["id"]: n for n in doc["nodes"]}
        self.assertEqual(nodes["a"]["label"], "Extract metadata")
        self.assertEqual(nodes["b"]["label"], "Image 3")
        self.assertEqual(nodes["c"]["label"], "Holehe · Search record")
        self.assertEqual(nodes["c"]["data"]["value"], "Yes")
        self.assertEqual(nodes["f"]["data"]["title"], "Partial result")
        self.assertEqual(doc["edges"][0]["label"], "Metadata field")
        self.assertEqual(doc["groups"][0]["label"], "Metadata · Foto.jpg")
        self.assertNotIn("Zeitlimit", doc["runs"][0]["warnings"][0])

    def test_user_text_stays_as_typed(self):
        doc = migrate(document())
        nodes = {n["id"]: n for n in doc["nodes"]}
        self.assertEqual(nodes["d"]["label"], "Meine Notiz über Bild 3")
        self.assertEqual(nodes["d"]["data"]["text"], "Bild 3 prüfen")
        self.assertEqual(nodes["e"]["label"], "Kontaktdaten")
        self.assertEqual(doc["edges"][1]["label"], "Bild")

    def test_migration_is_idempotent(self):
        once = migrate(document())
        self.assertEqual(migrate(once), once)


if __name__ == "__main__":
    unittest.main()
