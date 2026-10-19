"""Serialized actor orchestration, plugin boundary validation and result persistence."""

from core.tool_contracts import validate_result, result_state
import copy
from core.partial_results import include_warning_node
from uuid import uuid4
from core.errors import AppError
from core.execution_context import CANCEL_EVENT
from core.secrets import scrub_text, is_secret
from core.actor_results import ResultBuilder
from core.graph import (
    LOCATION_DEFAULTS,
    merge_documents,
)


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
    ):
        self.manager, self.load, self.save, self.bounds = manager, load, save, bounds
        self.settings, self.resolve_file, self.now, self.lock = (
            settings,
            resolve_file,
            now,
            lock,
        )
        self.credential_dir = credential_dir
        self.store_file = store_file
        self.collect_media = collect_media

    def execute(self, pid, body):
        # One actor for the entire container, including calls from other tabs.
        with self.lock:
            return self.execute_serial(pid, body)

    def execute_serial(self, pid, body):
        project = self.load(pid)
        if project.get("archived_at"):
            raise AppError("archived_project", 409)
        if body.get("revision") != project["revision"]:
            raise AppError("revision_conflict", 409)
        if not isinstance(body.get("transient", {}), dict):
            raise ValueError("Ungültige temporäre Eingabe.")
        doc = project["document"]
        actor = next(
            (
                n
                for n in doc["nodes"]
                if n["id"] == body.get("actor_id") and n["type"] == "actor"
            ),
            None,
        )
        if not actor:
            raise ValueError("Aktorknoten nicht gefunden.")
        module = self.manager.module(actor["data"].get("plugin"))
        action = (
            next(
                (
                    a
                    for a in module.PLUGIN["actions"]
                    if a["id"] == actor["data"].get("action")
                ),
                None,
            )
            if module
            else None
        )
        if not action:
            raise ValueError("Plugin-Aktion nicht verfügbar.")
        input_ids = {e["source"] for e in doc["edges"] if e["target"] == actor["id"]}
        inputs = [
            n for n in doc["nodes"] if n["id"] in input_ids and n["type"] != "actor"
        ]
        if not inputs or any(
            "*" not in action["inputs"] and n["type"] not in action["inputs"]
            for n in inputs
        ):
            raise ValueError("Eingaben passen nicht zur Aktion.")
        from provider_registry import identity

        supported = set(action.get("providers", []))
        specialized = {
            provider
            for plugin in self.manager.installed()
            for candidate in plugin.get("actions", [])
            for provider in candidate.get("providers", [])
        }
        if action.get("max_inputs") and len(inputs) > action["max_inputs"]:
            raise ValueError("Zu viele Eingaben für diesen Aktor.")
        if any(
            n["type"] == "profile"
            and (
                supported
                and identity(n["data"].get("provider", "")) not in supported
                or action.get("generic_profile")
                and identity(n["data"].get("provider", "")) in specialized
            )
            for n in inputs
        ):
            raise ValueError(
                "Für dieses Profil den passenden plattformspezifischen Research-Aktor verwenden."
            )
        started = self.now()
        original = copy.deepcopy(doc)
        input_snapshot = copy.deepcopy(inputs)
        effective = {}
        protected = {
            key + "_token": value for key, value in body.get("transient", {}).items()
        }
        try:
            if self.collect_media:
                self.collect_media({"nodes": inputs})
            if action.get("execution") == "browser":
                if body.get("browser_error"):
                    raise ValueError(str(body["browser_error"])[:1000])
                result = {"outputs": body.get("outputs"), "warnings": []}
            else:
                effective = self.manager.action_params(
                    module.PLUGIN["id"], action["id"]
                )
                overrides = {
                    k: v
                    for k, v in actor["data"].get("params", {}).items()
                    if k not in action.get("settings_only", [])
                    and not (
                        "source_order" in action.get("default_params", {})
                        and (k in {"source", "source_order"} or k.startswith("use_"))
                    )
                    and k not in self.manager.secret_fields(module.PLUGIN["id"])
                }
                protected.update({**effective, **overrides})
                protected.update(
                    {
                        key + "_token": effective.get(key, "")
                        for key in self.manager.secret_fields(module.PLUGIN["id"])
                    }
                )
                result = module.run(
                    action["id"],
                    inputs,
                    {**effective, **overrides},
                    {
                        "resolve_file": self.resolve_file,
                        "settings": self.settings(),
                        "schemas": self.manager.node_defaults(),
                        "node_count": len(doc["nodes"]),
                        "credential_dir": self.credential_dir,
                        "store_file": self.store_file,
                        "transient": body.get("transient", {}),
                    },
                )
            result = validate_result(result)
            result = {
                **result,
                "warnings": [
                    scrub_text(value, protected) for value in result.get("warnings", [])
                ],
                "log": scrub_text(
                    str(result.get("log", ""))[: 4 * 1024 * 1024], protected
                ),
                "error": (
                    scrub_text(result["error"], protected)
                    if result.get("error") is not None
                    else None
                ),
            }
            result = include_warning_node(
                result, inputs, module.PLUGIN["name"], capacity=5000 - len(doc["nodes"])
            )
            cancellation = CANCEL_EVENT.get()
            if cancellation is not None and cancellation.is_set():
                raise AppError("actor_cancelled", 409)
            run_id, members = ResultBuilder(self.bounds, self.now).apply(
                doc,
                actor,
                inputs,
                result,
                module.PLUGIN["id"],
                action["name"],
                started,
                self.manager.node_defaults(),
                self.settings()["node_display_defaults"],
            )
            doc["runs"].append(
                {
                    "id": run_id,
                    "actor_id": actor["id"],
                    "plugin": module.PLUGIN["id"],
                    "action": action["id"],
                    "inputs": [n["id"] for n in inputs],
                    "input_snapshot": input_snapshot,
                    "params": {
                        k: v
                        for k, v in actor["data"].get("params", {}).items()
                        if not is_secret(
                            k, self.manager.secret_fields(module.PLUGIN["id"])
                        )
                    },
                    "started_at": started,
                    "finished_at": self.now(),
                    "status": result_state(result),
                    "candidates": result.get("candidates", []),
                    "input_request": result.get("input_request"),
                    "updated_inputs": [u["id"] for u in result.get("updates", [])],
                    "outputs": members,
                    "error": result.get("error") if result.get("failed") else None,
                    "warnings": result.get("warnings", []),
                    "log": str(result.get("log", ""))[: 4 * 1024 * 1024],
                }
            )
            if module.PLUGIN["id"] == "merge" and not result.get("input_request"):
                actor["data"]["params"] = {}
            actor["data"]["status"] = result_state(result)
        except Exception as exc:
            doc = original
            actor = next(n for n in doc["nodes"] if n["id"] == actor["id"])
            cancelled = isinstance(exc, AppError) and exc.code == "actor_cancelled"
            actor["data"]["status"] = "cancelled" if cancelled else "failed"
            diagnostic = scrub_text(exc, protected)[:12000]
            run_id, members = uuid4().hex, []
            if not cancelled and len(doc["nodes"]) < 5000:
                run_id, members = ResultBuilder(self.bounds, self.now).apply(
                    doc,
                    actor,
                    inputs,
                    {
                        "outputs": [
                            {
                                "type": "error",
                                "label": action["name"] + " fehlgeschlagen",
                                "data": {
                                    "title": "Tool-Ausführung fehlgeschlagen",
                                    "message": diagnostic,
                                },
                                "source_input": inputs[0]["id"],
                                "relation": "Ausführungsfehler",
                                "source": {
                                    "tool": module.PLUGIN["name"],
                                    "failed": True,
                                },
                            }
                        ]
                    },
                    module.PLUGIN["id"],
                    action["name"],
                    started,
                    self.manager.node_defaults(),
                    self.settings()["node_display_defaults"],
                )
            doc["runs"].append(
                {
                    "id": run_id,
                    "actor_id": actor["id"],
                    "plugin": module.PLUGIN["id"],
                    "action": action["id"],
                    "started_at": started,
                    "finished_at": self.now(),
                    "status": "cancelled" if cancelled else "failed",
                    "error": diagnostic,
                    "inputs": [n["id"] for n in inputs],
                    "outputs": members,
                }
            )
        for attempt in range(3):
            latest = self.load(pid)
            merged = (
                merge_documents(original, latest["document"], doc)
                if latest["revision"] != project["revision"]
                else doc
            )
            try:
                return self.save(pid, latest["title"], merged, latest["revision"])
            except (RuntimeError, AppError) as error:
                if isinstance(error, AppError) and error.code != "revision_conflict":
                    raise
                if attempt == 2:
                    raise

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
            raise ValueError("Suchlauf nicht gefunden.")
        if run.get("status") == "cancelled":
            raise ValueError("Suchlauf wurde abgebrochen. Aktor erneut ausführen.")
        choice = next(
            (
                c
                for c in run.get("candidates", [])
                if c["input_id"] == body.get("input_id") and not c.get("chosen")
            ),
            None,
        )
        if not choice:
            raise ValueError("Adressauswahl nicht verfügbar.")
        index = body.get("index")
        if type(index) is not int or not 0 <= index < len(choice["options"]):
            raise ValueError("Ungültige Auswahl.")
        node = next((n for n in doc["nodes"] if n["id"] == choice["input_id"]), None)
        if not node:
            raise ValueError("Standortknoten wurde entfernt.")
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
            raise ValueError("Suchlauf nicht gefunden.")
        if run.get("status") not in ("needs_selection", "needs_input"):
            raise ValueError("Suchlauf wartet nicht auf eine Eingabe.")
        run["status"] = "cancelled"
        run["cancelled_at"] = self.now()
        for choice in run.get("candidates", []):
            choice["cancelled"] = True
        run["input_request"] = None
        actor = next((n for n in doc["nodes"] if n["id"] == run["actor_id"]), None)
        if actor:
            actor["data"]["status"] = "cancelled"
        return self.save(pid, project["title"], doc, project["revision"])
