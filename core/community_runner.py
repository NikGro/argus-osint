"""Run an explicitly installed community module in a broker-isolated filesystem/network/PID namespace with a per-job identity."""

import contextlib
import importlib.util
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
resource.setrlimit(resource.RLIMIT_FSIZE, (9 * 1024 * 1024, 9 * 1024 * 1024))
payload = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    spec = importlib.util.spec_from_file_location("argus_community", sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def resolve_file(file_id):
        path = payload.get("files", {}).get(file_id)
        if not path:
            raise ValueError("Datei gehört nicht zu den übergebenen Eingaben.")
        return path

    context = {
        "api_version": 1,
        "resolve_file": resolve_file,
        "transient": payload.get("transient", {}),
    }
    if payload.get("operation", "run") == "connect":
        if not hasattr(module, "connect"):
            raise ValueError("Plugin bietet keine Verbindungsaktion.")
        result = module.connect(payload["action"], payload["params"], context)
    else:
        result = module.run(
            payload["action"], payload["inputs"], payload["params"], context
        )
json.dump(result, sys.stdout, allow_nan=False)
