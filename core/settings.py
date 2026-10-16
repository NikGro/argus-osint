"""Persistent application preferences and installed locale discovery."""

import json
import re


class SettingsRepository:
    def __init__(self, connect, manager, root, tag_preferences):
        self.connect = connect
        self.manager = manager
        self.root = root
        self.tag_preferences = tag_preferences

    def load(self):
        result = {
            "tags": [],
            "language": "de",
            "geocoder_enabled": True,
            "geocoder_provider": "photon",
        }
        with self.connect() as conn:
            row = conn.execute(
                "SELECT settings FROM application_settings WHERE id=1"
            ).fetchone()
        if row:
            result.update(json.loads(row[0]))
        result["node_display_defaults"] = self.manager.display_defaults(
            result.get("node_display_defaults", {})
        )
        result["geocoder_enabled"] = any(
            p["id"] == "location" for p in self.manager.installed()
        )
        result["geocoder_provider"] = "photon"
        self.tag_preferences.update(
            {"tags": result.get("tags", []), "language": result["language"]}
        )
        return result

    def languages(self):
        result = []
        for file in sorted((self.root / "static" / "locales").glob("*.json")):
            try:
                data = json.loads(file.read_text())
                result.append(
                    {
                        "code": file.stem,
                        "name": data.get("_meta", {}).get("name", file.stem),
                    }
                )
            except Exception:
                continue
        return result

    def save(self, body):
        if body.get("language") not in {item["code"] for item in self.languages()}:
            raise ValueError("Sprache nicht installiert.")
        with self.connect() as conn:
            row = conn.execute(
                "SELECT settings FROM application_settings WHERE id=1"
            ).fetchone()
            value = json.loads(row[0]) if row else {}
            value["language"] = body["language"]
            if "tags" in body:
                tags = body["tags"]
                if not isinstance(tags, list) or len(tags) > 200:
                    raise ValueError("Maximal 200 globale Tags.")
                clean = []
                seen = set()
                names = set()
                for tag in tags:
                    if not isinstance(tag, dict):
                        raise ValueError("Ungültiger Tag.")
                    ident = tag.get("id")
                    name = str(tag.get("name", "")).strip()
                    color = tag.get("color", "#8799b2")
                    if (
                        not isinstance(ident, str)
                        or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", ident)
                        or not name
                        or len(name) > 40
                        or not isinstance(color, str)
                        or not re.fullmatch(r"#[0-9a-fA-F]{6}", color)
                    ):
                        raise ValueError(
                            "Tag benötigt ID, Namen (max. 40 Zeichen) und Farbe."
                        )
                    if ident in seen or name.casefold() in names:
                        raise ValueError("Doppelte globale Tags.")
                    seen.add(ident)
                    names.add(name.casefold())
                    clean.append({"id": ident, "name": name, "color": color})
                value["tags"] = clean
            conn.execute(
                "INSERT INTO application_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings",
                (json.dumps(value),),
            )
        return self.load()
