"""Graph domain: schemas, normalization, validation, group trees and optimistic merging."""

import copy
import re
from uuid import uuid4

TYPES = {
    "person",
    "datetime",
    "actor",
    "profile",
    "file",
    "location",
    "username",
    "url",
    "email",
    "error",
    "phone",
    "note",
    "value",
    "image",
}
LOCATION_DEFAULTS = {
    key: ""
    for key in (
        "country_code",
        "country",
        "admin_area_1",
        "admin_area_2",
        "admin_area_3",
        "locality",
        "dependent_locality",
        "postal_code",
        "street",
        "house_number",
        "building",
        "unit",
        "po_box",
        "formatted_address",
        "original_input",
        "granularity",
    )
}
LOCATION_DEFAULTS.update(latitude=None, longitude=None, coordinate_role="")
NODE_DEFAULTS = {
    "location": LOCATION_DEFAULTS,
    "value": {"value": ""},
    "url": {"value": ""},
    "email": {"value": ""},
    "phone": {"value": ""},
    "username": {"value": ""},
    "datetime": {"date": "", "time": "", "timezone": "UTC"},
    "note": {"text": ""},
    "image": {"filename": "", "file_id": "", "url": ""},
    "file": {"filename": "", "file_id": "", "mime": "", "size": 0},
}


def strip_assessment(value):
    if isinstance(value, dict):
        value.pop("assessment", None)
        for item in value.values():
            strip_assessment(item)
    elif isinstance(value, list):
        for item in value:
            strip_assessment(item)


def value_text(value):
    if isinstance(value, dict):
        return "\n".join(str(k) + ": " + value_text(v) for k, v in value.items())
    if isinstance(value, list):
        return ", ".join(value_text(v) for v in value)
    if value is None:
        return ""
    return str(value)


def group_node_ids(doc, group):
    children = {}
    for item in doc["groups"]:
        children.setdefault(item.get("parent_id"), []).append(item)
    stack = [group]
    seen = set()
    nodes = set()
    while stack:
        item = stack.pop()
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        nodes.update(item["members"])
        stack.extend(children.get(item["id"], []))
    return nodes


def prune_groups(groups, node_ids):
    result = copy.deepcopy(groups)
    for item in result:
        item["members"] = [id for id in item["members"] if id in node_ids]
    while True:
        parents = {item.get("parent_id") for item in result}
        filtered = [item for item in result if item["members"] or item["id"] in parents]
        if len(filtered) == len(result):
            break
        result = filtered
    ids = {item["id"] for item in result}
    for item in result:
        if item.get("parent_id") not in ids:
            item.pop("parent_id", None)
    return result


def validate_group_tree(groups):
    by_id = {g["id"]: g for g in groups}
    children = {id: [] for id in by_id}
    roots = []
    for group in groups:
        parent = group.get("parent_id")
        if parent is None:
            roots.append(group["id"])
            continue
        if not isinstance(parent, str) or parent not in by_id or parent == group["id"]:
            raise ValueError("Ungültige übergeordnete Gruppe.")
        children[parent].append(group["id"])
    seen = set()
    stack = roots
    while stack:
        ident = stack.pop()
        if ident in seen:
            raise ValueError("Zyklische Gruppenstruktur.")
        seen.add(ident)
        stack.extend(children[ident])
    if len(seen) != len(groups):
        raise ValueError("Zyklische Gruppenstruktur.")


def merge_value(base, local, remote):
    if local == base:
        return copy.deepcopy(remote)
    if all(isinstance(value, dict) for value in (base, local, remote)):
        out = copy.deepcopy(remote)
        for key in set(base) | set(local):
            if key not in local:
                out.pop(key, None)
            elif key in remote:
                out[key] = merge_value(base.get(key), local[key], remote[key])
            else:
                out[key] = copy.deepcopy(local[key])
        return out
    return copy.deepcopy(local)


def merge_documents(base, local, remote):
    result = copy.deepcopy(remote)
    for key in ("nodes", "edges", "groups", "runs"):
        old = {item["id"]: item for item in base[key]}
        mine = {item["id"]: item for item in local[key]}
        items = []
        for incoming in remote[key]:
            ident = incoming["id"]
            if ident in old and ident not in mine:
                continue
            items.append(
                merge_value(old.get(ident), mine[ident], incoming)
                if ident in mine
                else copy.deepcopy(incoming)
            )
            mine.pop(ident, None)
        items.extend(
            copy.deepcopy(value)
            for ident, value in mine.items()
            if ident not in old or value != old[ident]
        )
        result[key] = items
    result["report_notes"] = merge_value(
        base.get("report_notes"), local.get("report_notes"), remote.get("report_notes")
    )
    result["preferences"] = merge_value(
        base.get("preferences", {}),
        local.get("preferences", {}),
        remote.get("preferences", {}),
    )
    ids = {node["id"] for node in result["nodes"]}
    result["edges"] = [
        edge
        for edge in result["edges"]
        if edge["source"] in ids and edge["target"] in ids
    ]
    result["groups"] = prune_groups(result["groups"], ids)
    return result


class GraphSchema:
    def __init__(self, schemas, actor_policy=None, node_policy=None):
        self.schemas = schemas
        self.actor_policy = actor_policy or (lambda node: None)
        self.node_policy = node_policy or (lambda node: None)

    def canonicalize_node(self, node, schemas=None):
        self.node_policy(node)
        kind = node["type"]
        data = node["data"]
        strip_assessment(node)
        if kind == "actor":
            self.actor_policy(node)
            if data.get("plugin") in ("username", "email", "phone", "location"):
                data["params"] = {
                    k: v
                    for k, v in data.get("params", {}).items()
                    if not k.startswith("use_") and k != "source_order"
                }
            return
        if kind == "note":
            appearance = node.get("appearance", {})
            width = max(200, min(900, float(appearance.get("width", 320))))
            height = max(120, min(800, float(appearance.get("height", 180))))
            color = str(appearance.get("color", "#ffcc70"))
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                color = "#ffcc70"
            node["appearance"] = {"width": width, "height": height, "color": color}
        if kind == "profile":
            if any(
                not isinstance(data.get(key, ""), str) or len(data.get(key, "")) > 4096
                for key in ("provider", "url", "identifier")
            ):
                raise ValueError(
                    "Profilfelder müssen Texte mit höchstens 4096 Zeichen sein."
                )
        if kind == "datetime":
            data["timezone"] = data.get("timezone") or "UTC"
        defaults = (schemas if schemas is not None else self.schemas()).get(
            kind, NODE_DEFAULTS.get(kind, {})
        )
        evidence = node.setdefault("evidence", {})
        if data.get("metadata") is not None:
            evidence["metadata"] = data["metadata"]
        extra = {k: v for k, v in data.items() if k not in defaults and k != "metadata"}
        if extra:
            evidence["additional_data"] = {
                **evidence.get("additional_data", {}),
                **extra,
            }
        node["data"] = {
            key: copy.deepcopy(data.get(key, default))
            for key, default in defaults.items()
        }
        if kind == "value":
            if isinstance(data.get("value"), (dict, list)):
                evidence["raw_value"] = copy.deepcopy(data["value"])
            node["data"]["value"] = value_text(data.get("value", data))

    def canonicalize_document(self, doc):
        strip_assessment(doc)
        schemas = self.schemas()
        for node in doc["nodes"]:
            self.canonicalize_node(node, schemas)
        return doc

    def validate(self, doc):
        value = copy.deepcopy(doc)
        self._validate_in_place(value)
        return value

    def prepare(self, doc):
        from core.migrations import migrate

        prepared = migrate(doc)
        self._validate_in_place(prepared)
        return prepared

    def _validate_in_place(self, doc):
        if not isinstance(doc, dict):
            raise ValueError("Projekt muss ein Objekt sein.")
        for field in ("nodes", "edges", "groups", "runs"):
            if not isinstance(doc.get(field), list):
                raise ValueError(field + " muss eine Liste sein.")
        if len(doc["nodes"]) > 5000 or len(doc["edges"]) > 15000:
            raise ValueError("Projektlimit der Grundversion überschritten.")
        ids = set()
        schemas = self.schemas()
        valid_types = TYPES | set(schemas)
        for node in doc["nodes"]:
            if (
                not isinstance(node, dict)
                or not isinstance(node.get("id"), str)
                or node.get("type") not in valid_types
                or not isinstance(node.get("data"), dict)
            ):
                raise ValueError("Ungültiger Knoten.")
            if node["id"] in ids:
                raise ValueError("Doppelte Knoten-ID.")
            ids.add(node["id"])
            self.canonicalize_node(node, schemas)
            if len(str(node.get("label", ""))) > 1000:
                raise ValueError("Knotenbezeichnung zu lang.")
            for key in ("x", "y"):
                value = node.get(key, 0)
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (float, int))
                    or not (-1e7 < value < 1e7)
                ):
                    raise ValueError("Ungültige Knotenposition.")
        edge_ids = set()
        for edge in doc["edges"]:
            if not isinstance(edge, dict):
                raise ValueError("Ungültige Verbindung.")
            edge.setdefault("id", uuid4().hex)
            if not isinstance(edge["id"], str) or edge["id"] in edge_ids:
                raise ValueError("Ungültige oder doppelte Verbindungs-ID.")
            edge_ids.add(edge["id"])
            if edge.get("source") not in ids or edge.get("target") not in ids:
                raise ValueError("Verbindung verweist auf unbekannten Knoten.")
        gids = set()
        for group in doc["groups"]:
            if (
                not isinstance(group, dict)
                or not isinstance(group.get("id"), str)
                or group["id"] in gids
                or not isinstance(group.get("members"), list)
                or any(x not in ids for x in group["members"])
            ):
                raise ValueError("Ungültige Gruppe.")
            gids.add(group["id"])
        if any(not isinstance(run, dict) for run in doc["runs"]):
            raise ValueError("Ungültiger Rechercheverlauf.")
        if not isinstance(doc.get("preferences", {}), dict):
            raise ValueError("Ungültige Projekteinstellungen.")
        validate_group_tree(doc["groups"])
        return doc
