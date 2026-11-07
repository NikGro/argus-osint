"""Argus community plugin template. Copy the directory into your own public repository."""

PLUGIN = {
    "id": "example",
    "name": "Summarize information",
    "category": "Data processing",
    "description": "Small local example action without external requests.",
    "actions": [
        {
            "id": "summarize",
            "name": "Summarize information",
            "inputs": ["*"],
            "external": False,
            "default_params": {"prefix": "Detail"},
            "input_prompt": {
                "title": "Choose a label",
                "fields": [
                    {
                        "key": "prefix",
                        "label": "Prefix",
                        "type": "text",
                        "required": True,
                        "default": "Detail",
                    }
                ],
            },
        }
    ],
}


def run(action, inputs, params, context):
    if action != "summarize":
        raise ValueError("Unknown action.")
    outputs = []
    for node in inputs:
        for key, value in node["data"].items():
            if value is None or value == "":
                continue
            outputs.append(
                {
                    "type": "value",
                    "label": str(params.get("prefix", "Detail")) + " · " + key,
                    "data": {"value": str(value)},
                    "source_input": node["id"],
                    "group": node["label"],
                    "relation": "Detail",
                    "source": {"tool": "Community example", "attribute": key},
                }
            )
        # For file/image inputs only, context['resolve_file'](node['data']['file_id'])
        # resolves their uploaded file. Never modify this original file.
    return {
        "outputs": outputs,
        "warnings": [],
        "log": "Local example action finished.",
    }
