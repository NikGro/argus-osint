"""Explicit document migrations, applied once and persisted by the repository."""

import copy
from core.errors import AppError

VERSION = 1


def migrate(document):
    doc = copy.deepcopy(document)
    version = doc.get("schema_version", 0)
    if type(version) is not int or version < 0 or version > VERSION:
        raise AppError("unsupported_schema", 422)
    if version == 0:
        for node in doc.get("nodes", []):
            data = node.get("data", {})
            if node.get("type") == "actor":
                legacy = {
                    "profiles": "username",
                    "maigret": "username",
                    "holehe": "email",
                    "phoneinfoga": "phone",
                }
                old = data.get("plugin")
                if old in legacy:
                    params = data.setdefault("params", {})
                    if "sites" in params:
                        params[
                            {
                                "profiles": "sherlock_sites",
                                "maigret": "maigret_sites",
                                "holehe": "holehe_sites",
                            }.get(old, "sites")
                        ] = params.pop("sites")
                    if old == "holehe" and params.get("run_timeout") == 120:
                        params["run_timeout"] = 300
                    node.setdefault("evidence", {})["legacy_plugin"] = old
                    data["plugin"], data["action"] = legacy[old], "lookup"
                if data.get("plugin") == "deep_research":
                    data.setdefault("params", {}).pop("argus_flaresolverr_url", None)
            if (
                node.get("type") == "datetime"
                and data.get("value")
                and not data.get("date")
            ):
                raw = str(data["value"])
                data["date"] = raw[:10]
                data["time"] = raw[11:19] if len(raw) > 10 else ""
        doc["schema_version"] = 1
    return doc
