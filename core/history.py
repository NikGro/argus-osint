"""Execution history is stored independently from the editable graph transport."""

import copy
import json

SUMMARY_FIELDS = {
    "id",
    "actor_id",
    "plugin",
    "action",
    "started_at",
    "finished_at",
    "status",
    "inputs",
    "outputs",
    "candidates",
    "input_request",
    "error",
    "updated_inputs",
}


class RunHistory:
    def __init__(self, connect):
        self.connect = connect
        with connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS run_history (project_id TEXT NOT NULL,id TEXT NOT NULL,started_at TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(project_id,id))"
            )

    def detach(self, conn, pid, document):
        doc = copy.deepcopy(document)
        for run in doc.get("runs", []):
            if not isinstance(run, dict) or not isinstance(run.get("id"), str):
                continue
            previous = conn.execute(
                "SELECT record FROM run_history WHERE project_id=? AND id=?",
                (pid, run["id"]),
            ).fetchone()
            if previous:
                stored = json.loads(previous[0])
                if "log" in run or "input_snapshot" in run:
                    stored.update(run)
                else:
                    stored.update(
                        {
                            key: run[key]
                            for key in (
                                "status",
                                "candidates",
                                "input_request",
                                "finished_at",
                                "error",
                            )
                            if key in run
                        }
                    )
            else:
                stored = run
            conn.execute(
                "INSERT INTO run_history VALUES (?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET record=excluded.record",
                (
                    pid,
                    run["id"],
                    str(run.get("started_at", "")),
                    json.dumps(stored, ensure_ascii=False, allow_nan=False),
                ),
            )
        rows = conn.execute(
            "SELECT record FROM run_history WHERE project_id=? ORDER BY started_at DESC,rowid DESC LIMIT 200",
            (pid,),
        ).fetchall()
        doc["runs"] = [self.summary(json.loads(row[0])) for row in reversed(rows)]
        return doc

    @staticmethod
    def summary(run):
        # Input snapshots and multi-MiB logs never return in the project save payload.
        record = {k: v for k, v in run.items() if k in SUMMARY_FIELDS}
        if record.get("error"):
            record["error"] = str(record["error"])[:2000]
        record["warnings"] = [str(w)[:1000] for w in run.get("warnings", [])[:8]]
        return record

    def page(self, pid, offset=0, limit=100):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT record FROM run_history WHERE project_id=? ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?",
                (pid, min(200, max(1, limit)), max(0, offset)),
            ).fetchall()
            total = conn.execute(
                "SELECT COUNT(*) FROM run_history WHERE project_id=?", (pid,)
            ).fetchone()[0]
        return {
            "runs": [json.loads(r[0]) for r in rows],
            "total": total,
            "offset": offset,
        }

    def records(self, pid):
        offset = 0
        while True:
            page = self.page(pid, offset, 5)
            yield from page["runs"]
            offset += len(page["runs"])
            if offset >= page["total"] or not page["runs"]:
                return

    def lines(self, pid, query=""):
        import unicodedata

        def normalize(text):
            return "".join(
                ch
                for ch in unicodedata.normalize("NFKD", str(text)).casefold()
                if not unicodedata.combining(ch)
            )

        query = normalize(query)
        for run in self.records(pid):
            rows = [
                " · ".join(
                    str(run.get(key, ""))
                    for key in ("started_at", "plugin", "action", "status")
                )
            ]
            if run.get("error"):
                rows.append(str(run["error"]))
            rows.extend(str(value) for value in run.get("warnings", []))
            rows.extend(str(run.get("log", "")).splitlines())
            for text in rows:
                if not query or query in normalize(text):
                    yield {"run": run["id"], "text": text}

    def line_page(self, pid, query="", offset=0, limit=500):
        from itertools import islice

        offset = max(0, offset)
        limit = min(1000, max(1, limit))
        rows = list(islice(self.lines(pid, query), offset, offset + limit + 1))
        rows = [
            {
                **row,
                "text": row["text"][:8192] + (" …" if len(row["text"]) > 8192 else ""),
            }
            for row in rows
        ]
        return {"rows": rows[:limit], "more": len(rows) > limit, "offset": offset}
