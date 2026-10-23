"""Column-scoped lookup; matches materialize complete records with provenance."""

import json
import unicodedata
from core.datasets import row_outputs
from core.execution_context import checkpoint

PLUGIN = {
    "id": "database_search",
    "name": "Datenbank durchsuchen",
    "icon": "database-search",
    "category": "Datenbanken",
    "description": "Passende Datensätze in einer ausgewählten Spalte finden.",
    "actions": [
        {
            "id": "search",
            "name": "Datenbank durchsuchen",
            "inputs": ["database", "email", "phone", "username", "url", "value"],
            "min_inputs": 2,
            "max_inputs": 2,
            "external": False,
            "default_params": {
                "column_id": "",
                "match_mode": "exact",
                "case_sensitive": False,
                "max_results": 50,
            },
            "parameter_schema": {
                "match_mode": {"enum": ["exact", "contains", "starts_with"]},
                "max_results": {"min": 1, "max": 200, "step": 1},
            },
            "settings_only": [],
            "input_roles": [
                ["database"],
                ["email", "phone", "username", "url", "value"],
            ],
        }
    ],
    "translations": {
        "de": {
            "Datenbank durchsuchen": "Datenbank durchsuchen",
            "Datenbanken": "Datenbanken",
            "match_mode": "Vergleichsmodus",
            "case_sensitive": "Groß-/Kleinschreibung beachten",
            "max_results": "Maximale Treffer",
            "exact": "Exakt",
            "contains": "Enthält",
            "starts_with": "Beginnt mit",
        },
        "en": {
            "Datenbank durchsuchen": "Search database",
            "Datenbanken": "Databases",
            "Passende Datensätze in einer ausgewählten Spalte finden.": "Find matching records in a selected column.",
            "Datenbankspalte auswählen": "Choose database column",
            "Referenzspalte": "Reference column",
            "Spalte": "Column",
            "Treffer": "Matches",
            "Keine passenden Datensätze gefunden.": "No matching records found.",
            "Trefferlimit erreicht; weitere Ergebnisse sind möglich.": "Result limit reached; additional matches may exist.",
            "Datenbanktreffer": "Database match",
            "match_mode": "Match mode",
            "case_sensitive": "Case sensitive",
            "max_results": "Maximum results",
            "exact": "Exact",
            "contains": "Contains",
            "starts_with": "Starts with",
        },
    },
}


def column_prompt(database, *, images=False):
    fields = [f for f in database["fields"] if not images or f["type"] == "image"]
    return {
        "outputs": [],
        "input_request": {
            "kind": "database_column",
            "title": "Datenbankspalte auswählen",
            "message": database["title"],
            "fields": [
                {
                    "key": "column_id",
                    "label": "Referenzspalte",
                    "type": "select",
                    "options": [{"value": f["id"], "label": f["name"]} for f in fields],
                    "required": True,
                }
            ],
        },
    }


def connected_database(inputs, context):
    nodes = [n for n in inputs if n["type"] == "database"]
    if len(nodes) != 1 or not nodes[0]["data"].get("database_id"):
        raise ValueError("Genau eine Datenbank und eine passende Eingabe verbinden.")
    return nodes[0], context["datasets"].snapshot(nodes[0]["data"]["database_id"])


def run(action, inputs, params, context):
    if action != "search" or len(inputs) != 2:
        raise ValueError("Genau eine Datenbank und eine passende Eingabe verbinden.")
    source, database = connected_database(inputs, context)
    query = next(n for n in inputs if n["type"] != "database")
    if query["type"] not in {"value", "email", "phone", "username", "url"}:
        raise ValueError("Eingaben passen nicht zur Aktion.")
    field = next(
        (f for f in database["fields"] if f["id"] == params.get("column_id")), None
    )
    if not field:
        return column_prompt(database)
    mode = params.get("match_mode", "exact")
    limit = params.get("max_results", 50)
    if (
        mode not in {"exact", "contains", "starts_with"}
        or type(limit) is not int
        or not 1 <= limit <= 200
    ):
        raise ValueError("Ungültige Suchoption.")
    needle = query["data"].get("value")
    if needle is None or str(needle).strip() == "":
        raise ValueError("Eine Suchangabe ist erforderlich.")

    def normalize(value):
        text = unicodedata.normalize("NFKC", str(value)).strip()
        if query["type"] == "phone":
            text = "".join(c for c in text if c.isdigit())
        return text if params.get("case_sensitive") else text.casefold()

    needle = normalize(needle)
    outputs = []
    matches = 0
    warnings = []
    capacity = min(4800, 5000 - context.get("node_count", 0) - 1)
    if capacity < 1:
        return {
            "outputs": [],
            "warnings": ["Trefferlimit erreicht; weitere Ergebnisse sind möglich."],
        }
    for row in database["rows"]:
        checkpoint()
        cell = row["cells"].get(field["id"])
        if cell is None:
            continue
        values = cell if isinstance(cell, list) else [cell]
        hit = False
        for value in values:
            value = normalize(
                json.dumps(value, ensure_ascii=False)
                if isinstance(value, dict)
                else value
            )
            hit = hit or (
                value == needle
                if mode == "exact"
                else needle in value if mode == "contains" else value.startswith(needle)
            )
        if not hit:
            continue
        result = row_outputs(database, row, source["id"])
        if matches >= limit or len(outputs) + len(result) > capacity:
            warnings.append("Trefferlimit erreicht; weitere Ergebnisse sind möglich.")
            break
        outputs.extend(result)
        matches += 1
    if not outputs:
        outputs = [
            {
                "type": "value",
                "label": "Treffer",
                "data": {"value": "0"},
                "source_input": source["id"],
                "source": {
                    "database_id": database["id"],
                    "field_id": field["id"],
                    "message": "Keine passenden Datensätze gefunden.",
                },
            }
        ]
    return {
        "outputs": outputs,
        "warnings": warnings,
        "log": json.dumps(
            {
                "database_id": database["id"],
                "column_id": field["id"],
                "matches": matches,
            }
        ),
    }
