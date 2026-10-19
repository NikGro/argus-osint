"""Pure validation for installable data and actor plugin descriptors."""

from core.errors import DomainError
import re
from core.graph import TYPES


def validate_descriptor(item):
    if (
        not isinstance(item.get("name"), str)
        or not isinstance(item.get("actions", []), list)
        or (not 0 <= len(item.get("actions", [])) <= 30)
        or (not (item.get("actions") or item.get("nodes")))
    ):
        raise DomainError("validation.614b8de496")
    item.setdefault("actions", [])
    nodes = item.get("nodes", [])
    if not isinstance(nodes, list) or len(nodes) > 30:
        raise DomainError("validation.3ddbd076d2")
    for node in nodes:
        if (
            not re.fullmatch("[a-z][a-z0-9_]{0,63}", node.get("type", ""))
            or not isinstance(node.get("defaults"), dict)
            or (not isinstance(node.get("name"), str))
        ):
            raise DomainError("validation.43f8cee274")
        if node["type"] in TYPES:
            raise DomainError("validation.7538f070be")
    if not isinstance(item.get("translations", {}), dict):
        raise DomainError("validation.676a37ad81")
    if not isinstance(item.get("auth_fields", []), list) or any(
        (
            not isinstance(group, list)
            or not group
            or any((not isinstance(key, str) for key in group))
            for group in item.get("auth_fields", [])
        )
    ):
        raise DomainError("validation.4aa46c4775")
    connection = item.get("connection_action")
    if connection is not None and (
        not isinstance(connection, dict)
        or not isinstance(connection.get("id"), str)
        or (not isinstance(connection.get("label"), str))
    ):
        raise DomainError("validation.589194a900")
    if connection is not None and (not item["actions"]):
        raise DomainError("validation.092e966d3b")
    for action in item["actions"]:
        if not isinstance(action, dict):
            raise DomainError("validation.8c24fb644c")
        schema = action.get("parameter_schema", {})
        if not isinstance(schema, dict) or any(
            (
                not isinstance(value, dict)
                or not isinstance(value.get("secret", True), bool)
                for value in schema.values()
            )
        ):
            raise DomainError("validation.f50275370c")
        for field in ("providers", "settings_only"):
            values = action.get(field, [])
            if (
                not isinstance(values, list)
                or len(values) > 100
                or any(
                    (
                        not isinstance(value, str) or not value or len(value) > 200
                        for value in values
                    )
                )
            ):
                raise ValueError("Ungültige Plugin-Metadaten: " + field)
        if not isinstance(action.get("default_params", {}), dict):
            raise DomainError("validation.e1c551aed4")
        if not isinstance(action.get("generic_profile", False), bool):
            raise DomainError("validation.c3b65bdc89")
        if "max_inputs" in action and (
            isinstance(action["max_inputs"], bool)
            or not isinstance(action["max_inputs"], int)
            or (not 1 <= action["max_inputs"] <= 100)
        ):
            raise DomainError("validation.6c8080ef93")
        sections = action.get("parameter_sections", [])
        if not isinstance(sections, list) or len(sections) > 50:
            raise DomainError("validation.3d72226937")
        for section in sections:
            if (
                not isinstance(section, dict)
                or not isinstance(section.get("key"), str)
                or (not isinstance(section.get("toggle"), str))
                or (not isinstance(section.get("limits", []), list))
                or any((not isinstance(key, str) for key in section.get("limits", [])))
            ):
                raise DomainError("validation.8966901cef")
        if (
            not isinstance(action.get("id"), str)
            or not isinstance(action.get("name"), str)
            or (not isinstance(action.get("inputs"), list))
        ):
            raise DomainError("validation.8c24fb644c")
        if any(
            (
                not isinstance(t, str)
                or (t != "*" and (not re.fullmatch("[a-z][a-z0-9_]{0,63}", t)))
                for t in action["inputs"]
            )
        ):
            raise DomainError("validation.d60489a384")
