"""Database node helpers shared by Search database and DeepFace."""


def column_prompt(database, *, images=False):
    fields = [f for f in database["fields"] if not images or f["type"] == "image"]
    return {
        "outputs": [],
        "input_request": {
            "kind": "database_column",
            "title": "Choose database column",
            "message": database["title"],
            "fields": [
                {
                    "key": "column_id",
                    "label": "Reference column",
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
        raise ValueError("Connect exactly one database and one compatible input.")
    return nodes[0], context["datasets"].snapshot(nodes[0]["data"]["database_id"])
