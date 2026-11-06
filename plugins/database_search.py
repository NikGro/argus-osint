"""Column-scoped lookup; matches materialize complete records with provenance."""

import json
import unicodedata
from core.datasets import row_outputs
from core.execution_context import checkpoint
from plugins._database import column_prompt, connected_database

PLUGIN = {
    "id": "database_search",
    "name": "Search database",
    "icon": "database-search",
    "category": "Databases",
    "description": "Find matching records in a selected column.",
    "actions": [
        {
            "id": "search",
            "name": "Search database",
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
                "match_mode": {
                    "label": "Match mode",
                    "enum": ["exact", "contains", "starts_with"],
                    "labels": {
                        "exact": "Exact",
                        "contains": "Contains",
                        "starts_with": "Starts with",
                    },
                },
                "case_sensitive": {"label": "Case sensitive"},
                "max_results": {"min": 1, "max": 200, "step": 1},
            },
            "settings_only": [],
            "input_roles": [
                ["database"],
                ["email", "phone", "username", "url", "value"],
            ],
        }
    ],
}


def run(action, inputs, params, context):
    if action != "search" or len(inputs) != 2:
        raise ValueError("Connect exactly one database and one compatible input.")
    source, database = connected_database(inputs, context)
    query = next(n for n in inputs if n["type"] != "database")
    if query["type"] not in {"value", "email", "phone", "username", "url"}:
        raise ValueError("Inputs are incompatible with this action.")
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
        raise ValueError("Invalid search option.")
    needle = query["data"].get("value")
    if needle is None or str(needle).strip() == "":
        raise ValueError("A search value is required.")

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
            "warnings": ["Result limit reached; additional matches may exist."],
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
            warnings.append("Result limit reached; additional matches may exist.")
            break
        outputs.extend(result)
        matches += 1
    if not outputs:
        outputs = [
            {
                "type": "value",
                "label": "Matches",
                "data": {"value": "0"},
                "source_input": source["id"],
                "source": {
                    "database_id": database["id"],
                    "field_id": field["id"],
                    "message": "No matching records found.",
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
