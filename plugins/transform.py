PLUGIN = {
    "id": "transform",
    "name": "Data transform",
    "description": "JavaScript in a browser worker; turn inputs into data nodes.",
    "actions": [
        {
            "id": "code",
            "name": "JavaScript transform",
            "inputs": ["*"],
            "execution": "browser",
            "external": False,
        }
    ],
}
