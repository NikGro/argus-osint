"""Entry point that runs one installed community module (no sandbox, no limits)."""

import contextlib
import importlib.util
import json
import sys

payload = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    spec = importlib.util.spec_from_file_location("argus_community", sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def resolve_file(file_id):
        path = payload.get("files", {}).get(file_id)
        if not path:
            raise ValueError("The file does not belong to the supplied inputs.")
        return path

    context = {
        "api_version": 2,
        "resolve_file": resolve_file,
        "transient": payload.get("transient", {}),
    }
    if payload.get("operation", "run") == "connect":
        if not hasattr(module, "connect"):
            raise ValueError("The plugin provides no connection action.")
        result = module.connect(payload["action"], payload["params"], context)
    else:
        result = module.run(
            payload["action"], payload["inputs"], payload["params"], context
        )
json.dump(result, sys.stdout, allow_nan=False)
