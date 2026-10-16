"""Conservative same-type merge; explicit per-field conflict choices, no input mutation."""

import copy
import hashlib
import json

PLUGIN = {
    "id": "merge",
    "name": "Daten zusammenführen",
    "category": "Datenbearbeitung",
    "icon": "merge",
    "description": "Gleichartige Daten-Nodes zu einem neuen Node zusammenführen; Konflikte einzeln auswählen.",
    "actions": [
        {
            "id": "merge",
            "name": "Daten zusammenführen",
            "inputs": ["*"],
            "same_type": True,
            "min_inputs": 2,
            "default_params": {},
        }
    ],
}


def empty(value):
    return (
        value is None
        or value == ""
        or isinstance(value, (dict, list))
        and len(value) == 0
    )


def flatten(value, path=()):
    result = {}
    for key, child in value.items():
        p = path + (str(key),)
        if isinstance(child, dict) and child:
            result.update(flatten(child, p))
        else:
            result[p] = child
    return result


def put(target, path, value):
    for key in path[:-1]:
        target = target.setdefault(key, {})
    target[path[-1]] = copy.deepcopy(value)


def run(action, inputs, params, context):
    if action != "merge" or len(inputs) < 2 or len(inputs) > 100:
        raise ValueError("Zwei bis 100 Daten-Nodes anschließen.")
    kind = inputs[0]["type"]
    if kind == "actor" or any(n["type"] != kind for n in inputs):
        raise ValueError(
            "Nur Daten-Nodes desselben Typs können zusammengeführt werden."
        )
    fingerprint = hashlib.sha256(
        json.dumps(
            [(n["id"], n["type"], n["data"]) for n in inputs],
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    fields = {}
    base = copy.deepcopy(context.get("schemas", {}).get(kind, {}))
    for node in inputs:
        for path, value in flatten(node["data"]).items():
            fields.setdefault(path, [])
            if not empty(value) and not any(
                value == entry["value"] and type(value) is type(entry["value"])
                for entry in fields[path]
            ):
                fields[path].append(
                    {
                        "value": copy.deepcopy(value),
                        "node": node["id"],
                        "label": node.get("label", node["id"]),
                    }
                )
    conflicts = [
        (path, choices) for path, choices in fields.items() if len(choices) > 1
    ]
    request = []
    selected = {}
    fresh = params.get("_merge_fingerprint") == fingerprint
    for index, (path, choices) in enumerate(conflicts):
        key = "_merge_" + str(index)
        choice = params.get(key) if fresh else None
        if (
            isinstance(choice, str)
            and choice.isdecimal()
            and int(choice) < len(choices)
        ):
            selected[path] = int(choice)
        else:
            request.append(
                {
                    "key": key,
                    "label": ".".join(path),
                    "type": "choice",
                    "required": True,
                    "options": [
                        {
                            "value": str(i),
                            "label": entry["label"]
                            + ": "
                            + (
                                json.dumps(entry["value"], ensure_ascii=False)
                                if not isinstance(entry["value"], str)
                                else entry["value"]
                            ),
                        }
                        for i, entry in enumerate(choices)
                    ],
                }
            )
    if request:
        return {
            "outputs": [],
            "input_request": {
                "kind": "merge",
                "title": "Konflikte beim Zusammenführen",
                "fingerprint": fingerprint,
                "fields": request,
            },
            "warnings": [],
        }
    decisions = []
    for path, choices in fields.items():
        if not choices:
            continue
        index = selected.get(path, 0)
        put(base, path, choices[index]["value"])
        if len(choices) > 1:
            decisions.append(
                {"field": ".".join(path), "source": choices[index]["node"]}
            )
    tags = list(dict.fromkeys(tag for n in inputs for tag in n.get("tags", [])))
    return {
        "outputs": [
            {
                "type": kind,
                "label": "Zusammengeführt · " + inputs[0].get("label", kind),
                "data": base,
                "tags": tags,
                "relation": "Zusammengeführt",
                "source": {
                    "tool": "Argus Merge",
                    "inputs": [n["id"] for n in inputs],
                    "conflict_choices": decisions,
                },
            }
        ],
        "group_outputs": False,
        "warnings": [],
        "log": json.dumps(
            {"inputs": [n["id"] for n in inputs], "decisions": decisions},
            ensure_ascii=False,
        ),
    }
