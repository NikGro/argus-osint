"""Explicit image/database verification; no comparison is run at import time."""

import time
from uuid import uuid4
from core.datasets import row_outputs
from core.execution_context import checkpoint
from core.errors import AppError
from plugins.database_search import connected_database, column_prompt


def search(inputs, params, context, verify):
    source, database = connected_database(inputs, context)
    reference = next((n for n in inputs if n["type"] == "image"), None)
    if len(inputs) != 2 or not reference:
        raise ValueError("Eine Datenbank und ein Referenzbild verbinden.")
    fields = [f for f in database["fields"] if f["type"] == "image"]
    if not fields:
        raise ValueError("Die Datenbank enthält keine Bildspalte.")
    field = next((f for f in fields if f["id"] == params.get("column_id")), None)
    if not field:
        return column_prompt(database, images=True)
    limit = params.get("max_comparisons", 100)
    if type(limit) is not int or not 1 <= limit <= 1000:
        raise ValueError("Ungültiges Vergleichslimit.")
    outputs = []
    warnings = []
    compared = 0
    failed = 0
    matches = 0
    start = time.monotonic()
    timeout = params.get("run_timeout", 300)
    capacity = min(4800, 5000 - context.get("node_count", 0) - 1)
    if capacity < 1:
        return {
            "outputs": [],
            "warnings": [
                "Vergleichslimit oder Zeitlimit erreicht; die Datenbank wurde nicht vollständig durchsucht."
            ],
        }
    exhausted = False
    for row in database["rows"]:
        checkpoint()
        cell = row["cells"].get(field["id"], [])
        images = cell if isinstance(cell, list) else [cell]
        for item in images:
            if not isinstance(item, dict) or not item.get("file_id"):
                continue
            if compared >= limit or (
                timeout != 0 and time.monotonic() - start > timeout
            ):
                exhausted = True
                break
            candidate = {"id": row["id"], "type": "image", "data": item}
            compared += 1
            artifacts = {}

            def buffer_file(data, name):
                ident = uuid4().hex
                artifacts[ident] = (data, name)
                return {"file_id": ident, "filename": name}

            try:
                # Store overlays only for matching rows; rejected candidates must
                # not leave unreferenced artifacts in the project directory.
                remaining = (
                    max(10, int(timeout - (time.monotonic() - start))) if timeout else 0
                )
                result = verify(
                    "verify",
                    [reference, candidate],
                    {
                        **params,
                        "run_timeout": min(timeout, remaining) if timeout else 0,
                    },
                    {**context, "store_file": buffer_file},
                )
            except AppError:
                raise
            except Exception:
                failed += 1
                continue
            if result.get("input_request"):
                return result
            warnings.extend(result.get("warnings", []))
            comparison = next(
                (
                    o.get("source", {}).get("result")
                    for o in result["outputs"]
                    if o.get("source", {}).get("result")
                ),
                {},
            )
            if not comparison.get("verified"):
                continue
            fields_output = row_outputs(
                database,
                row,
                source["id"],
                extra={
                    "comparison": {
                        k: comparison.get(k)
                        for k in (
                            "verified",
                            "distance",
                            "threshold",
                            "model",
                            "distance_metric",
                        )
                    },
                    "reference_image": reference["id"],
                },
            )
            overlays = [o for o in result["outputs"] if o["type"] == "image"]
            for overlay in overlays:
                overlay.update(
                    group=fields_output[0]["group"],
                    group_id=fields_output[0]["group_id"],
                    source_input=source["id"],
                )
            if len(outputs) + len(fields_output) + len(overlays) > capacity:
                exhausted = True
                break
            for overlay in overlays:
                temporary = overlay["data"]["file_id"]
                if temporary in artifacts:
                    data, name = artifacts[temporary]
                    stored = context["store_file"](data, name)
                    overlay["data"].update(
                        file_id=stored["file_id"], filename=stored["filename"]
                    )
            outputs.extend(fields_output + overlays)
            matches += 1
            break  # A record with several matching images is emitted once.
        if exhausted:
            break
    if exhausted:
        warnings.append(
            "Vergleichslimit oder Zeitlimit erreicht; die Datenbank wurde nicht vollständig durchsucht."
        )
    if failed:
        warnings.append(
            "Einige Datenbankbilder konnten nicht verglichen werden. Die Ergebnisse sind unvollständig."
        )
    if not outputs:
        outputs = [
            {
                "type": "value",
                "label": "Treffer",
                "data": {"value": str(matches)},
                "source_input": source["id"],
                "source": {
                    "database_id": database["id"],
                    "field_id": field["id"],
                    "comparisons": compared,
                    "failed_comparisons": failed,
                },
            }
        ]
    return {
        "outputs": outputs,
        "warnings": list(dict.fromkeys(warnings)),
        "log": f"Compared: {compared}; matched records: {matches}; failed comparisons: {failed}",
    }
