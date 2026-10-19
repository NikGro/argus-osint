"""Resource-limited execution boundary for community Python plugins.

Requires the namespace broker; there is no in-process or same-identity fallback.
"""


class CommunityPlugin:
    def __init__(self, descriptor, path, source=None):
        self.PLUGIN, self.path = descriptor, path
        self.source = path.read_text() if source is None else source

    def run(self, action, inputs, params, context):
        return self._invoke("run", action, inputs, params, context)

    def connect(self, action, params, context):
        return self._invoke("connect", action, [], params, context)

    def _invoke(self, operation, action, inputs, params, context):
        from core.isolation import invoke

        files = {
            node["data"]["file_id"]: context["resolve_file"](node["data"]["file_id"])
            for node in inputs
            if node["type"] in ("image", "file", "video")
            and node["data"].get("file_id")
        }
        return invoke(
            "community",
            {
                "operation": operation,
                "transient": context.get("transient", {}),
                "action": action,
                "inputs": inputs,
                "params": params,
            },
            timeout=60,
            code=self.source,
            files=files,
        )
