"""Serialized tool orchestration, plugin boundary validation and result persistence."""

import copy
from uuid import uuid4

from core.actor_results import ResultBuilder
from core.errors import AppError, DomainError
from core.execution_context import CANCEL_EVENT
from core.graph import LOCATION_DEFAULTS, merge_documents
from core.partial_results import include_warning_node
from core.provider_registry import identity as provider_identity
from core.secrets import is_secret, scrub_text
from core.tool_contracts import result_state, validate_result

MAX_NODES = 5000
MAX_LOG_CHARACTERS = 4 * 1024 * 1024
MAX_DIAGNOSTIC_CHARACTERS = 12000
SAVE_ATTEMPTS = 3


def _find(items, predicate):
    return next((item for item in items if predicate(item)), None)


class ActorService:

    def __init__(
        self,
        manager,
        load,
        save,
        bounds,
        settings,
        resolve_file,
        now,
        lock,
        credential_dir,
        store_file=None,
        collect_media=None,
        datasets=None,
    ):
        self.manager = manager
        self.load = load
        self.save = save
        self.bounds = bounds
        self.settings = settings
        self.resolve_file = resolve_file
        self.now = now
        self.lock = lock
        self.credential_dir = credential_dir
        self.store_file = store_file
        self.collect_media = collect_media
        self.datasets = datasets

    def execute(self, pid, body):
        with self.lock:
            return self.execute_serial(pid, body)

    def execute_serial(self, pid, body):
        return _Execution(self, pid, body).execute()

    def choose_location(self, pid, body):
        project = self.load(pid)
        if body.get("revision") != project["revision"]:
            raise AppError("revision_conflict", 409)
        doc = project["document"]
        run = _find(
            doc["runs"],
            lambda r: r["id"] == body.get("run_id") and r.get("plugin") == "location",
        )
        if not run:
            raise DomainError("validation.ff2b86db9b")
        if run.get("status") == "cancelled":
            raise DomainError("validation.3f28a20440")
        choice = _find(
            run.get("candidates", []),
            lambda c: c["input_id"] == body.get("input_id") and not c.get("chosen"),
        )
        if not choice:
            raise DomainError("validation.52e598b6af")
        index = body.get("index")
        if type(index) is not int or not 0 <= index < len(choice["options"]):
            raise DomainError("validation.ddf44838a8")
        node = _find(doc["nodes"], lambda n: n["id"] == choice["input_id"])
        if not node:
            raise DomainError("validation.c7dcc9ce84")

        node["data"] = {
            **copy.deepcopy(LOCATION_DEFAULTS),
            **node["data"],
            **choice["options"][index],
        }
        node["evidence"] = {
            **node.get("evidence", {}),
            "last_update": {
                "run_id": run["id"],
                "plugin": "location",
                "at": self.now(),
                "provider": node["data"].get("provider"),
            },
        }
        if choice.get("source_input"):
            from plugins.location import formatted_address

            node["label"] = formatted_address(node["data"]) or node.get("label", "Ort")
        choice["chosen"] = True
        choice["selected_index"] = index
        if all(c.get("chosen") for c in run["candidates"]):
            run["status"] = "completed"
            self._set_actor_status(doc, run["actor_id"], "completed")
        return self.save(pid, project["title"], doc, project["revision"])

    def cancel_run(self, pid, body):
        project = self.load(pid)
        if body.get("revision") != project["revision"]:
            raise AppError("revision_conflict", 409)
        doc = project["document"]
        run = _find(doc["runs"], lambda r: r["id"] == body.get("run_id"))
        if not run:
            raise DomainError("validation.ff2b86db9b")
        if run.get("status") not in ("needs_selection", "needs_input"):
            raise DomainError("validation.dd04b0e490")
        run["status"] = "cancelled"
        run["cancelled_at"] = self.now()
        for choice in run.get("candidates", []):
            choice["cancelled"] = True
        run["input_request"] = None
        self._set_actor_status(doc, run["actor_id"], "cancelled")
        return self.save(pid, project["title"], doc, project["revision"])

    @staticmethod
    def _set_actor_status(doc, actor_id, status):
        actor = _find(doc["nodes"], lambda n: n["id"] == actor_id)
        if actor:
            actor["data"]["status"] = status


class _Execution:
    """One tool run: prepare -> collect (or record_failure) -> persist.

    Attributes set in one phase and read in a later one are the shared run
    state. Everything else stays local to its method.
    """

    def __init__(self, service, pid, body):
        self.service = service
        self.pid = pid
        self.body = body
        # Values that must never appear in persisted logs, warnings or errors.
        self.protected = {}

    def execute(self):
        self.prepare()
        try:
            self.collect()
        except Exception as error:
            self.record_failure(error)
        return self.persist()

    # -- phase 1: validate the request against the current project ---------

    def prepare(self):
        self.project = self.service.load(self.pid)
        if self.project.get("archived_at"):
            raise AppError("archived_project", 409)
        if self.body.get("revision") != self.project["revision"]:
            raise AppError("revision_conflict", 409)
        transient = self.body.get("transient", {})
        if not isinstance(transient, dict):
            raise DomainError("validation.5cc81a92c3")

        self.doc = self.project["document"]
        self.actor = _find(
            self.doc["nodes"],
            lambda n: n["id"] == self.body.get("actor_id") and n["type"] == "actor",
        )
        if not self.actor:
            raise DomainError("validation.f3e0a9f5e8")
        self.module = self.service.manager.module(self.actor["data"].get("plugin"))
        self.action = (
            _find(
                self.module.PLUGIN["actions"],
                lambda a: a["id"] == self.actor["data"].get("action"),
            )
            if self.module
            else None
        )
        if not self.action:
            raise DomainError("validation.b680d5ba95")

        input_ids = {
            e["source"] for e in self.doc["edges"] if e["target"] == self.actor["id"]
        }
        self.inputs = [
            n
            for n in self.doc["nodes"]
            if n["id"] in input_ids and n["type"] != "actor"
        ]
        self._validate_inputs()

        self.started = self.service.now()
        self.original = copy.deepcopy(self.doc)
        self.input_snapshot = copy.deepcopy(self.inputs)
        self.protected = {key + "_token": value for key, value in transient.items()}

    def _validate_inputs(self):
        accepted = self.action["inputs"]
        if not self.inputs or any(
            "*" not in accepted and n["type"] not in accepted for n in self.inputs
        ):
            raise DomainError("validation.00639cc7ad")

        roles = self.action.get("input_roles")
        if roles:
            # Assign the most specific roles first; every input needs one role.
            remaining = list(self.inputs)
            for role in sorted(roles, key=len):
                match = _find(remaining, lambda n: n["type"] in role)
                if match is None:
                    raise AppError("validation_failed", 400)
                remaining.remove(match)
            if remaining:
                raise AppError("validation_failed", 400)

        max_inputs = self.action.get("max_inputs")
        if max_inputs and len(self.inputs) > max_inputs:
            raise DomainError("validation.79c4b95cf5")

        if any(
            n["type"] == "profile" and not self._accepts_profile(n) for n in self.inputs
        ):
            raise DomainError("validation.8f3a1f1728")

    def _accepts_profile(self, node):
        provider = provider_identity(node["data"].get("provider", ""))
        supported = set(self.action.get("providers", []))
        if supported and provider not in supported:
            return False
        if self.action.get("generic_profile"):
            # Generic research yields to an installed platform-specific tool.
            specialized = {
                candidate_provider
                for plugin in self.service.manager.installed()
                for candidate in plugin.get("actions", [])
                for candidate_provider in candidate.get("providers", [])
            }
            if provider in specialized:
                return False
        return True

    # -- phase 2: run the plugin and materialize its results ---------------

    def collect(self):
        if self.service.collect_media:
            self.service.collect_media({"nodes": self.inputs})
        if self.action.get("execution") == "browser":
            if self.body.get("browser_error"):
                raise ValueError(str(self.body["browser_error"])[:1000])
            result = {"outputs": self.body.get("outputs"), "warnings": []}
        else:
            result = self._run_plugin()

        result = self._redact(validate_result(result))
        self.result = include_warning_node(
            result,
            self.inputs,
            self.module.PLUGIN["name"],
            capacity=MAX_NODES - len(self.doc["nodes"]),
        )
        cancellation = CANCEL_EVENT.get()
        if cancellation is not None and cancellation.is_set():
            raise AppError("actor_cancelled", 409)

        self.run_id, self.members = self._build_results(self.result)
        self.doc["runs"].append(self._run_record())
        if self.module.PLUGIN["id"] == "merge" and not self.result.get("input_request"):
            self.actor["data"]["params"] = {}
        self.actor["data"]["status"] = result_state(self.result)

    def _run_plugin(self):
        plugin_id = self.module.PLUGIN["id"]
        secret_fields = self.service.manager.secret_fields(plugin_id)
        effective = self.service.manager.action_params(plugin_id, self.action["id"])
        # Installation-wide source switches/order, settings-only values and
        # secrets cannot be overridden by (possibly stale) node parameters.
        uses_source_order = "source_order" in self.action.get("default_params", {})
        overrides = {
            key: value
            for key, value in self.actor["data"].get("params", {}).items()
            if key not in self.action.get("settings_only", [])
            and not (
                uses_source_order
                and (key in {"source", "source_order"} or key.startswith("use_"))
            )
            and key not in secret_fields
        }
        self.protected.update({**effective, **overrides})
        self.protected.update(
            {key + "_token": effective.get(key, "") for key in secret_fields}
        )
        return self.module.run(
            self.action["id"],
            self.inputs,
            {**effective, **overrides},
            {
                "resolve_file": self.service.resolve_file,
                "datasets": self.service.datasets,
                "settings": self.service.settings(),
                "schemas": self.service.manager.node_defaults(),
                "node_count": len(self.doc["nodes"]),
                "credential_dir": self.service.credential_dir,
                "store_file": self.service.store_file,
                "transient": self.body.get("transient", {}),
            },
        )

    def _redact(self, result):
        error = result.get("error")
        return {
            **result,
            "warnings": [
                scrub_text(value, self.protected)
                for value in result.get("warnings", [])
            ],
            "log": scrub_text(
                str(result.get("log", ""))[:MAX_LOG_CHARACTERS], self.protected
            ),
            "error": scrub_text(error, self.protected) if error is not None else None,
        }

    def _build_results(self, result):
        return ResultBuilder(self.service.bounds, self.service.now).apply(
            self.doc,
            self.actor,
            self.inputs,
            result,
            self.module.PLUGIN["id"],
            self.action["name"],
            self.started,
            self.service.manager.node_defaults(),
            self.service.settings()["node_display_defaults"],
        )

    def _run_record(self):
        result = self.result
        secret_fields = self.service.manager.secret_fields(self.module.PLUGIN["id"])
        return {
            "id": self.run_id,
            "actor_id": self.actor["id"],
            "plugin": self.module.PLUGIN["id"],
            "action": self.action["id"],
            "inputs": [n["id"] for n in self.inputs],
            "input_snapshot": self.input_snapshot,
            "params": {
                key: value
                for key, value in self.actor["data"].get("params", {}).items()
                if not is_secret(key, secret_fields)
            },
            "started_at": self.started,
            "finished_at": self.service.now(),
            "status": result_state(result),
            "candidates": result.get("candidates", []),
            "input_request": result.get("input_request"),
            "updated_inputs": [u["id"] for u in result.get("updates", [])],
            "outputs": self.members,
            "error": result.get("error") if result.get("failed") else None,
            "warnings": result.get("warnings", []),
            "log": str(result.get("log", ""))[:MAX_LOG_CHARACTERS],
        }

    # -- phase 2 (failure): keep a connected error node instead ------------

    def record_failure(self, error):
        self.doc = self.original
        self.actor = _find(self.doc["nodes"], lambda n: n["id"] == self.actor["id"])
        cancelled = isinstance(error, AppError) and error.code == "actor_cancelled"
        status = "cancelled" if cancelled else "failed"
        self.actor["data"]["status"] = status
        diagnostic = scrub_text(error, self.protected)[:MAX_DIAGNOSTIC_CHARACTERS]

        self.run_id, self.members = uuid4().hex, []
        if not cancelled and len(self.doc["nodes"]) < MAX_NODES:
            self.run_id, self.members = self._build_results(
                {"outputs": [self._error_output(diagnostic)]}
            )
        self.doc["runs"].append(
            {
                "id": self.run_id,
                "actor_id": self.actor["id"],
                "plugin": self.module.PLUGIN["id"],
                "action": self.action["id"],
                "started_at": self.started,
                "finished_at": self.service.now(),
                "status": status,
                "error": diagnostic,
                "inputs": [n["id"] for n in self.inputs],
                "outputs": self.members,
            }
        )

    def _error_output(self, diagnostic):
        return {
            "type": "error",
            "label": self.action["name"] + " fehlgeschlagen",
            "data": {
                "title": "Tool-Ausführung fehlgeschlagen",
                "message": diagnostic,
            },
            "source_input": self.inputs[0]["id"],
            "relation": "Ausführungsfehler",
            "source": {"tool": self.module.PLUGIN["name"], "failed": True},
        }

    # -- phase 3: save, merging with edits made while the tool ran ---------

    def persist(self):
        for attempt in range(1, SAVE_ATTEMPTS + 1):
            latest = self.service.load(self.pid)
            document = (
                merge_documents(self.original, latest["document"], self.doc)
                if latest["revision"] != self.project["revision"]
                else self.doc
            )
            try:
                return self.service.save(
                    self.pid, latest["title"], document, latest["revision"]
                )
            except AppError as error:
                if error.code != "revision_conflict" or attempt == SAVE_ATTEMPTS:
                    raise
            except RuntimeError:
                if attempt == SAVE_ATTEMPTS:
                    raise
