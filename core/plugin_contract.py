"""Pure validation for installable data and actor plugin descriptors."""

import re
from core.graph import TYPES


def validate_descriptor(item):
    if (
        not isinstance(item.get("name"), str)
        or not isinstance(item.get("actions", []), list)
        or not 0 <= len(item.get("actions", [])) <= 30
        or not (item.get("actions") or item.get("nodes"))
    ):
        raise ValueError("Plugin benötigt name und actions oder nodes.")
    item.setdefault("actions", [])
    nodes = item.get("nodes", [])
    if not isinstance(nodes, list) or len(nodes) > 30:
        raise ValueError("Ungültige Daten-Node-Beschreibung.")
    for node in nodes:
        if (
            not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", node.get("type", ""))
            or not isinstance(node.get("defaults"), dict)
            or not isinstance(node.get("name"), str)
        ):
            raise ValueError("Daten-Node benötigt type, name und defaults.")
        if node["type"] in TYPES:
            raise ValueError("Community-Plugins benötigen eigene Daten-Typnamen.")
    if not isinstance(item.get("translations", {}), dict):
        raise ValueError("Ungültige Übersetzungen.")
    if not isinstance(item.get("auth_fields", []), list) or any(
        not isinstance(group, list)
        or not group
        or any(not isinstance(key, str) for key in group)
        for group in item.get("auth_fields", [])
    ):
        raise ValueError("Ungültige Login-Felder.")
    connection = item.get("connection_action")
    if connection is not None and (
        not isinstance(connection, dict)
        or not isinstance(connection.get("id"), str)
        or not isinstance(connection.get("label"), str)
    ):
        raise ValueError("Ungültige Verbindungsaktion.")
    if connection is not None and not item["actions"]:
        raise ValueError("Verbindungsaktion benötigt eine Konfigurationsaktion.")
    for action in item["actions"]:
        if not isinstance(action, dict):
            raise ValueError("Ungültige Aktorbeschreibung.")
        schema = action.get("parameter_schema", {})
        if not isinstance(schema, dict) or any(
            not isinstance(value, dict)
            or not isinstance(value.get("secret", True), bool)
            for value in schema.values()
        ):
            raise ValueError("Invalid parameter_schema")
        for field in ("providers", "settings_only"):
            values = action.get(field, [])
            if (
                not isinstance(values, list)
                or len(values) > 100
                or any(
                    not isinstance(value, str) or not value or len(value) > 200
                    for value in values
                )
            ):
                raise ValueError("Ungültige Plugin-Metadaten: " + field)
        if not isinstance(action.get("default_params", {}), dict):
            raise ValueError("Ungültige Standardparameter.")
        if not isinstance(action.get("generic_profile", False), bool):
            raise ValueError("Ungültige Profil-Kompatibilität.")
        if "max_inputs" in action and (
            isinstance(action["max_inputs"], bool)
            or not isinstance(action["max_inputs"], int)
            or not 1 <= action["max_inputs"] <= 100
        ):
            raise ValueError("Ungültige Eingabeanzahl.")
        sections = action.get("parameter_sections", [])
        if not isinstance(sections, list) or len(sections) > 50:
            raise ValueError("Ungültige Parameterabschnitte.")
        for section in sections:
            if (
                not isinstance(section, dict)
                or not isinstance(section.get("key"), str)
                or not isinstance(section.get("toggle"), str)
                or not isinstance(section.get("limits", []), list)
                or any(not isinstance(key, str) for key in section.get("limits", []))
            ):
                raise ValueError("Ungültiger Parameterabschnitt.")
        if (
            not isinstance(action.get("id"), str)
            or not isinstance(action.get("name"), str)
            or not isinstance(action.get("inputs"), list)
        ):
            raise ValueError("Ungültige Aktorbeschreibung.")
        if any(
            not isinstance(t, str)
            or (t != "*" and not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", t))
            for t in action["inputs"]
        ):
            raise ValueError("Unbekannter Eingabetyp.")
