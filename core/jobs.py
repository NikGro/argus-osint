"""Persistent FIFO, idempotent submission and cancellation, independent of HTTP requests."""

import hashlib
import json
import logging
import threading
from uuid import uuid4
from core.errors import AppError, classify
from core.execution_context import CANCEL_EVENT

TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


def fingerprint(project, actor_id):
    doc = project["document"]
    actor = next(
        (n for n in doc["nodes"] if n["id"] == actor_id and n["type"] == "actor"), None
    )
    if not actor:
        raise AppError("actor_not_found", 404)
    ids = {e["source"] for e in doc["edges"] if e["target"] == actor_id}
    data = {
        "actor": actor["data"],
        "inputs": [
            {k: n.get(k) for k in ("id", "type", "data")}
            for n in doc["nodes"]
            if n["id"] in ids
        ],
    }
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class Jobs:
    def __init__(
        self, connect, projects, execute, now, connect_plugin=None, start=True, vpn=None
    ):
        self.connect, self.projects, self.execute, self.now = (
            connect,
            projects,
            execute,
            now,
        )
        self.connect_plugin = connect_plugin
        self.vpn = vpn
        self.vpn_waiting = False
        self.condition = threading.Condition()
        self.ephemeral = {}
        self.cancellations = {}
        self.stopped = False
        with connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS actor_jobs (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,signature TEXT NOT NULL,request TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,run_id TEXT,error_code TEXT,UNIQUE(project_id,request_key))"
            )
            if "result" not in {
                row[1] for row in conn.execute("PRAGMA table_info(actor_jobs)")
            }:
                conn.execute("ALTER TABLE actor_jobs ADD COLUMN result TEXT")
            # A restart never replays an already-started external operation blindly.
            conn.execute(
                "UPDATE actor_jobs SET state='interrupted',error_code='execution_interrupted' WHERE state IN ('queued','running','cancelling')"
            )
        if start:
            threading.Thread(
                target=self.worker, name="argus-actor-worker", daemon=True
            ).start()

    def submit(self, pid, body, key):
        if not isinstance(key, str) or not 16 <= len(key) <= 128:
            raise AppError("idempotency_key_required", 400)
        project = self.projects.load(pid)
        if project["archived_at"]:
            raise AppError("archived_project", 409)
        actor_id = body.get("actor_id")
        signature = hashlib.sha256(
            json.dumps(
                {k: v for k, v in body.items() if k not in ("revision", "transient")},
                sort_keys=True,
            ).encode()
        ).hexdigest()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            archive = conn.execute(
                "SELECT archived_at FROM project_archive WHERE project_id=?", (pid,)
            ).fetchone()
            if archive and archive[0]:
                raise AppError("archived_project", 409)
            existing = conn.execute(
                "SELECT id,signature FROM actor_jobs WHERE project_id=? AND request_key=?",
                (pid, key),
            ).fetchone()
            if existing:
                if existing[1] != signature:
                    raise AppError("idempotency_conflict", 409)
                job_id = existing[0]
            else:
                active = conn.execute(
                    "SELECT id FROM actor_jobs WHERE project_id=? AND actor_id=? AND state IN ('queued','running','cancelling')",
                    (pid, actor_id),
                ).fetchone()
                if active:
                    return self.get(active[0])
                if (
                    conn.execute(
                        "SELECT COUNT(*) FROM actor_jobs WHERE state IN ('queued','running')"
                    ).fetchone()[0]
                    >= 100
                ):
                    raise AppError("queue_full", 429)
                job_id = uuid4().hex
                request = {k: v for k, v in body.items() if k != "transient"}
                conn.execute(
                    "INSERT INTO actor_jobs (id,project_id,actor_id,request_key,fingerprint,signature,request,state,created_at,updated_at,run_id,error_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        job_id,
                        pid,
                        actor_id,
                        key,
                        fingerprint(project, actor_id),
                        signature,
                        json.dumps(request),
                        "queued",
                        self.now(),
                        self.now(),
                        None,
                        None,
                    ),
                )
                if body.get("transient"):
                    self.ephemeral[job_id] = body["transient"]
        with self.condition:
            self.condition.notify()
        return self.get(job_id)

    def submit_connection(self, body, key):
        if not isinstance(key, str) or not 16 <= len(key) <= 128:
            raise AppError("idempotency_key_required", 400)
        request = {
            "_kind": "connection",
            "id": body.get("id"),
            "action": body.get("action"),
        }
        signature = hashlib.sha256(
            json.dumps(request, sort_keys=True).encode()
        ).hexdigest()
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT id,signature FROM actor_jobs WHERE project_id='' AND request_key=?",
                (key,),
            ).fetchone()
            if row:
                if row[1] != signature:
                    raise AppError("idempotency_conflict", 409)
                jid = row[0]
            else:
                if (
                    conn.execute(
                        "SELECT COUNT(*) FROM actor_jobs WHERE state IN ('queued','running','cancelling')"
                    ).fetchone()[0]
                    >= 100
                ):
                    raise AppError("queue_full", 429)
                jid = uuid4().hex
                conn.execute(
                    "INSERT INTO actor_jobs (id,project_id,actor_id,request_key,fingerprint,signature,request,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        jid,
                        "",
                        "connection:" + str(body.get("id")),
                        key,
                        "",
                        signature,
                        json.dumps(request),
                        "queued",
                        self.now(),
                        self.now(),
                    ),
                )
                self.ephemeral[jid] = body.get("transient", {})
        with self.condition:
            self.condition.notify()
        return self.get(jid)

    def get(self, jid):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT id,project_id,actor_id,state,run_id,error_code,created_at,updated_at,result FROM actor_jobs WHERE id=?",
                (jid,),
            ).fetchone()
            if not row:
                raise AppError("job_not_found", 404)
        return {
            **dict(
                zip(
                    (
                        "id",
                        "project_id",
                        "actor_id",
                        "state",
                        "run_id",
                        "error_code",
                        "created_at",
                        "updated_at",
                    ),
                    row[:8],
                )
            ),
            **({"result": json.loads(row[8])} if row[8] else {}),
        }

    def active(self):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id FROM actor_jobs WHERE state IN ('queued','running','cancelling') ORDER BY created_at,rowid"
            ).fetchall()
        return {"jobs": [self.get(row[0]) for row in rows]}

    def cancel(self, jid):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT state FROM actor_jobs WHERE id=?", (jid,)
            ).fetchone()
            if not row:
                raise AppError("job_not_found", 404)
            if row[0] in TERMINAL:
                return self.get(jid)
            conn.execute(
                "UPDATE actor_jobs SET state=?,updated_at=? WHERE id=?",
                ("cancelled" if row[0] == "queued" else "cancelling", self.now(), jid),
            )
            self.cancellations.setdefault(jid, threading.Event()).set()
            self.ephemeral.pop(jid, None)
        return self.get(jid)

    def worker(self):
        while not self.stopped:
            with self.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT id,project_id,actor_id,fingerprint,request FROM actor_jobs WHERE state='queued' ORDER BY created_at,rowid LIMIT 1"
                ).fetchone()
                if row:
                    conn.execute(
                        "UPDATE actor_jobs SET state='running',updated_at=? WHERE id=?",
                        (self.now(), row[0]),
                    )
            if not row:
                with self.condition:
                    self.condition.wait(timeout=1)
                continue
            jid, pid, actor_id, expected, request = row
            event = self.cancellations.setdefault(jid, threading.Event())
            context = CANCEL_EVENT.set(event)
            state, run_id, error, result = "failed", None, None, None
            acquired, run = False, {}
            try:
                payload = json.loads(request)
                if self.vpn:
                    self.vpn_waiting = True
                    try:
                        acquired = self.vpn.before_actor(event)
                    finally:
                        self.vpn_waiting = False
                if payload.get("_kind") == "connection":
                    result = self.connect_plugin(
                        payload.get("id"),
                        payload.get("action"),
                        self.ephemeral.pop(jid, {}),
                    )
                    state = "cancelled" if event.is_set() else "completed"
                    continue
                current = self.projects.load(pid)
                if current["archived_at"]:
                    raise AppError("archived_project", 409)
                if fingerprint(current, actor_id) != expected:
                    raise AppError("actor_inputs_changed", 409)
                before = {r["id"] for r in current["document"].get("runs", [])}
                payload = json.loads(request)
                payload["revision"] = current["revision"]
                payload["transient"] = self.ephemeral.pop(jid, {})
                executed = self.execute(pid, payload)
                run = next(
                    (
                        r
                        for r in reversed(executed["document"].get("runs", []))
                        if r["id"] not in before and r.get("actor_id") == actor_id
                    ),
                    {},
                )
                run_id = run.get("id")
                state = (
                    "cancelled"
                    if event.is_set() or run.get("status") == "cancelled"
                    else "completed"
                )
            except Exception as exc:
                error = classify(exc).code
                state = "cancelled" if event.is_set() else "failed"
            finally:
                if self.vpn:
                    self.vpn.after_actor(
                        acquired,
                        rotate=not run.get("input_request")
                        and not (result or {}).get("input_request"),
                    )
                logging.getLogger("argus.jobs").info(
                    json.dumps(
                        {
                            "event": "job_finished",
                            "job_id": jid,
                            "state": state,
                            "error_code": error,
                        }
                    )
                )
                CANCEL_EVENT.reset(context)
                self.ephemeral.pop(jid, None)
                self.cancellations.pop(jid, None)
                with self.connect() as conn:
                    conn.execute(
                        "UPDATE actor_jobs SET state=?,run_id=?,error_code=?,updated_at=?,result=? WHERE id=?",
                        (
                            state,
                            run_id,
                            error,
                            self.now(),
                            json.dumps(result) if result is not None else None,
                            jid,
                        ),
                    )
