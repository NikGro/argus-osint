"""Atomic revision checks, explicit migrations, external history and file reference cleanup."""

import copy
import json
from uuid import uuid4
from core.errors import AppError
from core.history import RunHistory
from core.migrations import VERSION

MAX_GRAPH_BYTES = 12 * 1024 * 1024


class ProjectRepository:
    def __init__(
        self, connect, canonicalize, validate, now, prepare=None, cleanup=None
    ):
        self.connect, self.canonicalize, self.validate, self.now = (
            connect,
            canonicalize,
            validate,
            now,
        )
        self.prepare = prepare or (lambda doc: self._legacy_prepare(doc))
        self.cleanup = cleanup
        self.history = RunHistory(connect)

    def _legacy_prepare(self, doc):
        value = copy.deepcopy(doc)
        self.validate(value)
        return self.canonicalize(value)

    def _encode(self, conn, pid, document):
        doc = self.prepare(document)
        doc = self.history.detach(conn, pid, doc)
        encoded = json.dumps(doc, ensure_ascii=False, allow_nan=False)
        while len(encoded.encode()) > MAX_GRAPH_BYTES and len(doc.get("runs", [])) > 1:
            doc["runs"].pop(0)
            encoded = json.dumps(doc, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode()) > MAX_GRAPH_BYTES:
            raise AppError("graph_too_large", 413)
        return encoded

    def load(self, pid):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT p.document,p.revision,p.title,a.archived_at FROM projects p LEFT JOIN project_archive a ON a.project_id=p.id WHERE p.id=?",
                (pid,),
            ).fetchone()
            if not row:
                raise AppError("not_found", 404)
            doc = json.loads(row[0])
            if doc.get("schema_version", 0) != VERSION or any(
                "log" in run or "input_snapshot" in run for run in doc.get("runs", [])
            ):
                encoded = self._encode(conn, pid, doc)
                conn.execute(
                    "UPDATE projects SET document=? WHERE id=? AND revision=?",
                    (encoded, pid, row[1]),
                )
                doc = json.loads(encoded)
        return {
            "id": pid,
            "title": row[2],
            "revision": row[1],
            "document": doc,
            "archived_at": row[3],
        }

    def save(self, pid, title, document, revision, client=False):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT p.revision,a.archived_at FROM projects p LEFT JOIN project_archive a ON a.project_id=p.id WHERE p.id=?",
                (pid,),
            ).fetchone()
            if not row:
                raise AppError("not_found", 404)
            if row[1]:
                raise AppError("archived_project", 409)
            if row[0] != revision:
                raise AppError("revision_conflict", 409)
            if client:
                document = copy.deepcopy(document)
                current = conn.execute(
                    "SELECT document FROM projects WHERE id=?", (pid,)
                ).fetchone()
                document["runs"] = json.loads(current[0]).get("runs", [])
            encoded = self._encode(conn, pid, document)
            conn.execute(
                "UPDATE projects SET title=?,document=?,revision=revision+1,updated_at=? WHERE id=?",
                (str(title)[:200], encoded, self.now(), pid),
            )
        return self.load(pid)

    def rename(self, pid, title, revision):
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
            raise AppError("invalid_title", 400)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT revision FROM projects WHERE id=?", (pid,)
            ).fetchone()
            if not row:
                raise AppError("not_found", 404)
            if row[0] != revision:
                raise AppError("revision_conflict", 409)
            conn.execute(
                "UPDATE projects SET title=?,revision=revision+1,updated_at=? WHERE id=?",
                (title.strip(), self.now(), pid),
            )
        return self.load(pid)

    def reconcile(self, pid, body, persist=False):
        from core.graph import merge_documents

        for attempt in range(4):
            latest = self.load(pid)
            merged = merge_documents(body["base"], body["local"], latest["document"])
            title = (
                latest["title"]
                if body.get("title") == body.get("base_title")
                else body.get("title", latest["title"])
            )
            if not persist:
                return {
                    **latest,
                    "title": title,
                    "server_title": latest["title"],
                    "document": merged,
                    "server_document": latest["document"],
                    "has_local_changes": merged != latest["document"]
                    or title != latest["title"],
                }
            try:
                return self.save(pid, title, merged, latest["revision"], client=True)
            except AppError as error:
                if error.code != "revision_conflict" or attempt == 3:
                    raise

    def archive(self, pid, archived, revision):
        if not isinstance(archived, bool):
            raise AppError("validation_failed", 400)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if (
                archived
                and conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE name='actor_jobs'"
                ).fetchone()
                and conn.execute(
                    "SELECT 1 FROM actor_jobs WHERE project_id=? AND state IN ('queued','running','cancelling')",
                    (pid,),
                ).fetchone()
            ):
                raise AppError("actor_busy", 409)
            cursor = conn.execute(
                "UPDATE projects SET revision=revision+1 WHERE id=? AND revision=?",
                (pid, revision),
            )
            if cursor.rowcount != 1:
                raise AppError("revision_conflict", 409)
            if archived:
                conn.execute(
                    "INSERT INTO project_archive VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET archived_at=excluded.archived_at",
                    (pid, self.now()),
                )
            else:
                conn.execute("DELETE FROM project_archive WHERE project_id=?", (pid,))
        return self.load(pid)

    def delete_archived(self, pid, revision):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT p.revision,a.archived_at FROM projects p LEFT JOIN project_archive a ON a.project_id=p.id WHERE p.id=?",
                (pid,),
            ).fetchone()
            if not row:
                raise AppError("not_found", 404)
            if not row[1]:
                raise AppError("archive_required", 409)
            if row[0] != revision:
                raise AppError("revision_conflict", 409)
            from core.files import file_references

            candidates = file_references(
                json.loads(
                    conn.execute(
                        "SELECT document FROM projects WHERE id=?", (pid,)
                    ).fetchone()[0]
                )
            )
            for row in conn.execute(
                "SELECT record FROM run_history WHERE project_id=?", (pid,)
            ):
                candidates.update(file_references(json.loads(row[0])))
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='remote_media'"
            ).fetchone():
                encoded = conn.execute(
                    "SELECT document FROM projects WHERE id=?", (pid,)
                ).fetchone()[0]
                candidates.update(
                    fid
                    for url, fid in conn.execute("SELECT url,file_id FROM remote_media")
                    if url in encoded
                )
            conn.execute("DELETE FROM projects WHERE id=?", (pid,))
            conn.execute("DELETE FROM project_archive WHERE project_id=?", (pid,))
            conn.execute("DELETE FROM run_history WHERE project_id=?", (pid,))
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='actor_jobs'"
            ).fetchone():
                conn.execute("DELETE FROM actor_jobs WHERE project_id=?", (pid,))
        if self.cleanup:
            self.cleanup(candidates)
        return {"deleted": True, "id": pid}

    def clear_logs(self, pid, revision):
        current = self.load(pid)
        if current["archived_at"]:
            raise AppError("archived_project", 409)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if (
                conn.execute(
                    "SELECT revision FROM projects WHERE id=?", (pid,)
                ).fetchone()[0]
                != revision
            ):
                raise AppError("revision_conflict", 409)
            doc = current["document"]
            doc["runs"] = []
            conn.execute("DELETE FROM run_history WHERE project_id=?", (pid,))
            conn.execute(
                "UPDATE projects SET document=?,revision=revision+1 WHERE id=?",
                (json.dumps(doc), pid),
            )
        return self.load(pid)

    def create(self, title, document):
        pid = uuid4().hex
        with self.connect() as conn:
            encoded = self._encode(conn, pid, document)
            conn.execute(
                "INSERT INTO projects VALUES (?,?,?,?,?)",
                (pid, str(title)[:200], encoded, 1, self.now()),
            )
        return self.load(pid)

    def list(self):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT p.id,p.title,p.revision,p.updated_at,a.archived_at FROM projects p LEFT JOIN project_archive a ON a.project_id=p.id ORDER BY p.updated_at DESC"
            ).fetchall()
        return [
            {
                "id": r[0],
                "title": r[1],
                "revision": r[2],
                "updated_at": r[3],
                "archived_at": r[4],
            }
            for r in rows
        ]
