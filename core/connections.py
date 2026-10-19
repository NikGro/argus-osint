"""Plugin login operations share resource serialization and secret-safe diagnostics."""

from core.errors import DomainError
from core.secrets import scrub_text


class PluginConnections:

    def __init__(self, manager, lock, credential_dir):
        self.manager, self.lock, self.credential_dir = (manager, lock, credential_dir)

    def connect(self, plugin_id, action_id, transient=None):
        transient = {} if transient is None else transient
        if not isinstance(transient, dict):
            raise DomainError("validation.5cc81a92c3")
        module = self.manager.module(plugin_id)
        if (
            not module
            or not hasattr(module, "connect")
            or action_id != module.PLUGIN.get("connection_action", {}).get("id")
        ):
            raise DomainError("validation.4910b5ba20")
        params = self.manager.action_params(
            plugin_id, module.PLUGIN["actions"][0]["id"]
        )
        protected = {
            **params,
            **{
                key + "_token": params.get(key, "")
                for key in self.manager.secret_fields(plugin_id)
            },
            **{key + "_token": value for key, value in transient.items()},
        }
        with self.lock:
            try:
                result = module.connect(
                    action_id,
                    params,
                    {"credential_dir": self.credential_dir, "transient": transient},
                )
            except Exception as exc:
                raise ValueError(scrub_text(exc, protected)) from None
        if not isinstance(result, dict):
            raise DomainError("validation.5d4e9106d9")
        return {
            "authenticated": bool(result.get("authenticated")),
            "input_request": result.get("input_request"),
            "warnings": [
                scrub_text(value, protected) for value in result.get("warnings", [])
            ],
            "failed": bool(result.get("failed")),
        }
