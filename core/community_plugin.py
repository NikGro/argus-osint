"""Run an installed community plugin as a subprocess of ARGUS.

Community plugins are trusted like integrations in a marketplace: there is no
sandbox. The code runs with the application's identity and can read the data
volume and use ARGUS' research tools. A subprocess keeps a crashing plugin from
taking ARGUS down and lets cancellation stop it; there is no time or memory
limit. Users must only install plugins whose source they trust.
"""

import os
from pathlib import Path
import sys

from plugins._process import bounded_run

ROOT = Path(__file__).resolve().parents[1]


class CommunityPlugin:
    def __init__(self, descriptor, path, source=None):
        self.PLUGIN, self.path = descriptor, path
        self.source = path.read_text() if source is None else source

    def run(self, action, inputs, params, context):
        return self._invoke("run", action, inputs, params, context)

    def connect(self, action, params, context):
        return self._invoke("connect", action, [], params, context)

    def _invoke(self, operation, action, inputs, params, context):
        import json

        files = {
            node["data"]["file_id"]: str(
                context["resolve_file"](node["data"]["file_id"])
            )
            for node in inputs
            if node["type"] in ("image", "file", "video", "audio")
            and node["data"].get("file_id")
        }
        stdout, _ = bounded_run(
            [
                sys.executable,
                str(ROOT / "core" / "community_runner.py"),
                str(self.path),
            ],
            None,
            {
                "operation": operation,
                "transient": context.get("transient", {}),
                "action": action,
                "inputs": inputs,
                "params": params,
                "files": files,
            },
            extra_env={
                "PYTHONPATH": str(ROOT),
                "DATA_DIR": os.environ.get("DATA_DIR", ""),
                "ARGUS_TOOLS_DIR": os.environ.get("ARGUS_TOOLS_DIR", ""),
            },
            max_bytes=64 * 1024 * 1024,
        )
        return json.loads(stdout)
