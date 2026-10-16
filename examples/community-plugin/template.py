"""Argus community plugin template. Copy the directory into your own public repository."""

PLUGIN = {
    "id": "example",
    "name": "Information zusammenfassen",
    "category": "Datenbearbeitung",
    "description": "Kleine lokale Beispielaktion ohne externe Abfragen.",
    "actions": [
        {
            "id": "summarize",
            "name": "Information zusammenfassen",
            "inputs": ["*"],
            "external": False,
            "default_params": {"prefix": "Angabe"},
            "input_prompt": {
                "title": "Bezeichnung wählen",
                "fields": [
                    {
                        "key": "prefix",
                        "label": "Präfix",
                        "type": "text",
                        "required": True,
                        "default": "Angabe",
                    }
                ],
            },
        }
    ],
}


def run(action, inputs, params, context):
    if action != "summarize":
        raise ValueError("Unbekannte Aktion.")
    outputs = []
    for node in inputs:
        for key, value in node["data"].items():
            if value is None or value == "":
                continue
            outputs.append(
                {
                    "type": "value",
                    "label": str(params.get("prefix", "Angabe")) + " · " + key,
                    "data": {"value": str(value)},
                    "source_input": node["id"],
                    "group": node["label"],
                    "relation": "Angabe",
                    "source": {"tool": "Community example", "attribute": key},
                }
            )
        # For file/image inputs only, context['resolve_file'](node['data']['file_id'])
        # resolves their uploaded file. Never modify this original file.
    return {
        "outputs": outputs,
        "warnings": [],
        "log": "Lokale Beispielaktion abgeschlossen.",
    }
