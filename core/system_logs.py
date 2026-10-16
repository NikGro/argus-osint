"""Bounded persistent operational logs, separate from research/project history."""

import json
import logging
from core.secrets import redact


class SystemLogs(logging.Handler):
    def __init__(self, connect, now, capacity=50000):
        super().__init__()
        self.connect, self.now, self.capacity = connect, now, capacity
        with connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL)"
            )

    def emit(self, record):
        try:
            # Only structured application events enter this store. Arbitrary third-party
            # exception text and request bodies can contain credentials.
            try:
                event = json.loads(record.getMessage())
            except (ValueError, TypeError):
                return
            if not isinstance(event, dict):
                return
            text = json.dumps(redact(event), ensure_ascii=False)[:16000]
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO system_logs(created_at,level,message) VALUES (?,?,?)",
                    (self.now(), record.levelname, text),
                )
                conn.execute(
                    "DELETE FROM system_logs WHERE id <= (SELECT COALESCE(MAX(id),0)-? FROM system_logs)",
                    (self.capacity,),
                )
        except Exception:
            self.handleError(record)

    def page(self, search="", offset=0, limit=200):
        if offset < 0 or not 1 <= limit <= 1000:
            raise ValueError("Invalid log page")
        with self.connect() as conn:
            total = conn.execute(
                "SELECT COUNT(*) FROM system_logs WHERE instr(lower(message),lower(?))>0 OR instr(lower(level),lower(?))>0",
                (search, search),
            ).fetchone()[0]
            rows = conn.execute(
                "SELECT id,created_at,level,message FROM system_logs WHERE instr(lower(message),lower(?))>0 OR instr(lower(level),lower(?))>0 ORDER BY id DESC LIMIT ? OFFSET ?",
                (search, search, limit, offset),
            ).fetchall()
        return {
            "total": total,
            "lines": [{"id": row[0], "text": " ".join(row[1:])} for row in rows],
            "offset": offset,
        }

    def export(self, search="", limit=0):
        if limit < 0:
            raise ValueError("Invalid log limit")
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT created_at,level,message FROM system_logs WHERE instr(lower(message),lower(?))>0 OR instr(lower(level),lower(?))>0 ORDER BY id DESC LIMIT ?",
                (search, search, limit or -1),
            )
            for row in rows:
                yield " ".join(row) + "\n"

    def clear(self):
        with self.connect() as conn:
            conn.execute("DELETE FROM system_logs")
