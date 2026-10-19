"""Serialized actor orchestration, plugin boundary validation and result persistence."""

from core.errors import DomainError
from core.tool_contracts import validate_result, result_state
import copy
from core.partial_results import include_warning_node
from uuid import uuid4
from core.errors import AppError
from core.execution_context import CANCEL_EVENT
from core.secrets import scrub_text, is_secret
from core.actor_results import ResultBuilder
from core.graph import LOCATION_DEFAULTS, merge_documents


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
        self.manager, self.load, self.save, self.bounds = (manager, load, save, bounds)
        self.settings, self.resolve_file, self.now, self.lock = (
            settings,
            resolve_file,
            now,
            lock,
        )
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
        run = next(
            (
                r
                for r in doc["runs"]
                if r["id"] == body.get("run_id") and r.get("plugin") == "location"
            ),
            None,
        )
        if not run:
            raise DomainError("validation.ff2b86db9b")
        if run.get("status") == "cancelled":
            raise DomainError("validation.3f28a20440")
        choice = next(
            (
                c
                for c in run.get("candidates", [])
                if c["input_id"] == body.get("input_id") and (not c.get("chosen"))
            ),
            None,
        )
        if not choice:
            raise DomainError("validation.52e598b6af")
        index = body.get("index")
        if type(index) is not int or not 0 <= index < len(choice["options"]):
            raise DomainError("validation.ddf44838a8")
        node = next((n for n in doc["nodes"] if n["id"] == choice["input_id"]), None)
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
        if all((c.get("chosen") for c in run["candidates"])):
            run["status"] = "completed"
            actor = next((n for n in doc["nodes"] if n["id"] == run["actor_id"]), None)
            if actor:
                actor["data"]["status"] = "completed"
        return self.save(pid, project["title"], doc, project["revision"])

    def cancel_run(self, pid, body):
        project = self.load(pid)
        if body.get("revision") != project["revision"]:
            raise AppError("revision_conflict", 409)
        doc = project["document"]
        run = next((r for r in doc["runs"] if r["id"] == body.get("run_id")), None)
        if not run:
            raise DomainError("validation.ff2b86db9b")
        if run.get("status") not in ("needs_selection", "needs_input"):
            raise DomainError("validation.dd04b0e490")
        run["status"] = "cancelled"
        run["cancelled_at"] = self.now()
        for choice in run.get("candidates", []):
            choice["cancelled"] = True
        run["input_request"] = None
        actor = next((n for n in doc["nodes"] if n["id"] == run["actor_id"]), None)
        if actor:
            actor["data"]["status"] = "cancelled"
        return self.save(pid, project["title"], doc, project["revision"])


class _Execution:

    def __init__(self, service, pid, body):
        self.service = service
        self.pid = pid
        self.body = body

    def execute(self):
        self.prepare()
        try:
            self.collect()
        except Exception as error:
            self.record_failure(error)
        return self.persist()

    def prepare(self):
        self.project = self.service.load(self.pid)
        if self.project.get("archived_at"):
            raise AppError("archived_project", 409)
        if self.body.get("revision") != self.project["revision"]:
            raise AppError("revision_conflict", 409)
        if not isinstance(self.body.get("transient", {}), dict):
            raise DomainError("validation.5cc81a92c3")
        self.doc = self.project["document"]
        self.actor = next(
            (
                n
                for n in self.doc["nodes"]
                if n["id"] == self.body.get("actor_id") and n["type"] == "actor"
            ),
            None,
        )
        if not self.actor:
            raise DomainError("validation.f3e0a9f5e8")
        self.module = self.service.manager.module(self.actor["data"].get("plugin"))
        self.action = (
            next(
                (
                    a
                    for a in self.module.PLUGIN["actions"]
                    if a["id"] == self.actor["data"].get("action")
                ),
                None,
            )
            if self.module
            else None
        )
        if not self.action:
            raise DomainError("validation.b680d5ba95")
        self.input_ids = {
            e["source"] for e in self.doc["edges"] if e["target"] == self.actor["id"]
        }
        self.inputs = [
            n
            for n in self.doc["nodes"]
            if n["id"] in self.input_ids and n["type"] != "actor"
        ]
        if not self.inputs or any(
            (
                "*" not in self.action["inputs"]
                and n["type"] not in self.action["inputs"]
                for n in self.inputs
            )
        ):
            raise DomainError("validation.00639cc7ad")
        from core.provider_registry import identity

        self.identity = identity
        self.supported = set(self.action.get("providers", []))
        self.specialized = {
            provider
            for plugin in self.service.manager.installed()
            for candidate in plugin.get("actions", [])
            for provider in candidate.get("providers", [])
        }
        if self.action.get("input_roles"):
            self.roles = self.action["input_roles"]
            self.remaining = list(self.inputs)
            for self.role in sorted(self.roles, key=len):
                self.match = next(
                    (n for n in self.remaining if n["type"] in self.role), None
                )
                if self.match is None:
                    raise AppError("validation_failed", 400)
                self.remaining.remove(self.match)
            if self.remaining:
                raise AppError("validation_failed", 400)
        if (
            self.action.get("max_inputs")
            and len(self.inputs) > self.action["max_inputs"]
        ):
            raise DomainError("validation.79c4b95cf5")
        if any(
            (
                n["type"] == "profile"
                and (
                    self.supported
                    and self.identity(n["data"].get("provider", ""))
                    not in self.supported
                    or (
                        self.action.get("generic_profile")
                        and self.identity(n["data"].get("provider", ""))
                        in self.specialized
                    )
                )
                for n in self.inputs
            )
        ):
            raise DomainError("validation.8f3a1f1728")
        self.started = self.service.now()
        self.original = copy.deepcopy(self.doc)
        self.input_snapshot = copy.deepcopy(self.inputs)
        self.effective = {}
        self.protected = {
            key + "_token": value
            for key, value in self.body.get("transient", {}).items()
        }

    def collect(self):
        if self.service.collect_media:
            self.service.collect_media({"nodes": self.inputs})
        if self.action.get("execution") == "browser":
            if self.body.get("browser_error"):
                raise ValueError(str(self.body["browser_error"])[:1000])
            self.result = {"outputs": self.body.get("outputs"), "warnings": []}
        else:
            self.effective = self.service.manager.action_params(
                self.module.PLUGIN["id"], self.action["id"]
            )
            self.overrides = {
                k: v
                for k, v in self.actor["data"].get("params", {}).items()
                if k not in self.action.get("settings_only", [])
                and (
                    not (
                        "source_order" in self.action.get("default_params", {})
                        and (k in {"source", "source_order"} or k.startswith("use_"))
                    )
                )
                and (
                    k
                    not in self.service.manager.secret_fields(self.module.PLUGIN["id"])
                )
            }
            self.protected.update({**self.effective, **self.overrides})
            self.protected.update(
                {
                    key + "_token": self.effective.get(key, "")
                    for key in self.service.manager.secret_fields(
                        self.module.PLUGIN["id"]
                    )
                }
            )
            self.result = self.module.run(
                self.action["id"],
                self.inputs,
                {**self.effective, **self.overrides},
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
        self.result = validate_result(self.result)
        self.result = {
            **self.result,
            "warnings": [
                scrub_text(value, self.protected)
                for value in self.result.get("warnings", [])
            ],
            "log": scrub_text(
                str(self.result.get("log", ""))[: 4 * 1024 * 1024], self.protected
            ),
            "error": (
                scrub_text(self.result["error"], self.protected)
                if self.result.get("error") is not None
                else None
            ),
        }
        self.result = include_warning_node(
            self.result,
            self.inputs,
            self.module.PLUGIN["name"],
            capacity=5000 - len(self.doc["nodes"]),
        )
        self.cancellation = CANCEL_EVENT.get()
        if self.cancellation is not None and self.cancellation.is_set():
            raise AppError("actor_cancelled", 409)
        self.run_id, self.members = ResultBuilder(
            self.service.bounds, self.service.now
        ).apply(
            self.doc,
            self.actor,
            self.inputs,
            self.result,
            self.module.PLUGIN["id"],
            self.action["name"],
            self.started,
            self.service.manager.node_defaults(),
            self.service.settings()["node_display_defaults"],
        )
        self.doc["runs"].append(
            {
                "id": self.run_id,
                "actor_id": self.actor["id"],
                "plugin": self.module.PLUGIN["id"],
                "action": self.action["id"],
                "inputs": [n["id"] for n in self.inputs],
                "input_snapshot": self.input_snapshot,
                "params": {
                    k: v
                    for k, v in self.actor["data"].get("params", {}).items()
                    if not is_secret(
                        k, self.service.manager.secret_fields(self.module.PLUGIN["id"])
                    )
                },
                "started_at": self.started,
                "finished_at": self.service.now(),
                "status": result_state(self.result),
                "candidates": self.result.get("candidates", []),
                "input_request": self.result.get("input_request"),
                "updated_inputs": [u["id"] for u in self.result.get("updates", [])],
                "outputs": self.members,
                "error": (
                    self.result.get("error") if self.result.get("failed") else None
                ),
                "warnings": self.result.get("warnings", []),
                "log": str(self.result.get("log", ""))[: 4 * 1024 * 1024],
            }
        )
        if self.module.PLUGIN["id"] == "merge" and (
            not self.result.get("input_request")
        ):
            self.actor["data"]["params"] = {}
        self.actor["data"]["status"] = result_state(self.result)

    def record_failure(self, error):
        self.exc = error
        self.doc = self.original
        self.actor = next((n for n in self.doc["nodes"] if n["id"] == self.actor["id"]))
        self.cancelled = (
            isinstance(self.exc, AppError) and self.exc.code == "actor_cancelled"
        )
        self.actor["data"]["status"] = "cancelled" if self.cancelled else "failed"
        self.diagnostic = scrub_text(self.exc, self.protected)[:12000]
        self.run_id, self.members = (uuid4().hex, [])
        if not self.cancelled and len(self.doc["nodes"]) < 5000:
            self.run_id, self.members = ResultBuilder(
                self.service.bounds, self.service.now
            ).apply(
                self.doc,
                self.actor,
                self.inputs,
                {
                    "outputs": [
                        {
                            "type": "error",
                            "label": self.action["name"] + " fehlgeschlagen",
                            "data": {
                                "title": "Tool-Ausführung fehlgeschlagen",
                                "message": self.diagnostic,
                            },
                            "source_input": self.inputs[0]["id"],
                            "relation": "Ausführungsfehler",
                            "source": {
                                "tool": self.module.PLUGIN["name"],
                                "failed": True,
                            },
                        }
                    ]
                },
                self.module.PLUGIN["id"],
                self.action["name"],
                self.started,
                self.service.manager.node_defaults(),
                self.service.settings()["node_display_defaults"],
            )
        self.doc["runs"].append(
            {
                "id": self.run_id,
                "actor_id": self.actor["id"],
                "plugin": self.module.PLUGIN["id"],
                "action": self.action["id"],
                "started_at": self.started,
                "finished_at": self.service.now(),
                "status": "cancelled" if self.cancelled else "failed",
                "error": self.diagnostic,
                "inputs": [n["id"] for n in self.inputs],
                "outputs": self.members,
            }
        )

    def persist(self):
        for self.attempt in range(3):
            self.latest = self.service.load(self.pid)
            self.merged = (
                merge_documents(self.original, self.latest["document"], self.doc)
                if self.latest["revision"] != self.project["revision"]
                else self.doc
            )
            try:
                return self.service.save(
                    self.pid, self.latest["title"], self.merged, self.latest["revision"]
                )
            except (RuntimeError, AppError) as _caught_2:
                self.error = _caught_2
                if (
                    isinstance(self.error, AppError)
                    and self.error.code != "revision_conflict"
                ):
                    raise
                if self.attempt == 2:
                    raise
