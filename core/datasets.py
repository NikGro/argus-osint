"""User databases: stable schema/row IDs, optimistic writes and paged reads.

Cell values are JSON, including typed file references. No user-provided SQL or
column names are interpolated into queries. Project graphs keep references;
tool results keep a snapshot with database/row/field provenance.
"""

import copy
import json
import re
from uuid import uuid4
from core.errors import AppError

FIELD_TYPES = {
    "value",
    "text",
    "number",
    "boolean",
    "email",
    "phone",
    "url",
    "image",
    "file",
    "datetime",
    "json",
}
MAX_ROWS = 100000
MAX_FIELDS = 200


class DatasetRepository:
    def __init__(self, connect, files, now):
        self.connect, self.files, self.now = connect, files, now
        with connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, fields TEXT NOT NULL,
                    revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS dataset_rows (
                    id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL,
                    cells TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS dataset_rows_owner ON dataset_rows(dataset_id);
                CREATE TABLE IF NOT EXISTS dataset_imports (
                    id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
            """)

    @staticmethod
    def encode(value):
        try:
            encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
        except (ValueError, TypeError, RecursionError):
            raise AppError("validation_failed", 400) from None
        if len(encoded.encode()) > 2 * 1024 * 1024:
            raise AppError("request_too_large", 413)
        return encoded

    def list(self):
        with self.connect() as db:
            return [
                dict(
                    id=r[0],
                    title=r[1],
                    fields=json.loads(r[2]),
                    revision=r[3],
                    updated_at=r[4],
                    row_count=r[5],
                )
                for r in db.execute(
                    "SELECT d.*, (SELECT count(*) FROM dataset_rows r WHERE r.dataset_id=d.id) FROM datasets d ORDER BY d.title COLLATE NOCASE"
                )
            ]

    def metadata(self, ident, db=None):
        if db is None:
            with self.connect() as connection:
                return self.metadata(ident, connection)
        row = db.execute("SELECT * FROM datasets WHERE id=?", (ident,)).fetchone()
        if not row:
            raise AppError("not_found", 404)
        return dict(
            id=row[0],
            title=row[1],
            fields=json.loads(row[2]),
            revision=row[3],
            updated_at=row[4],
        )

    def page(self, ident, offset=0, search=""):
        offset = max(0, int(offset))
        with self.connect() as db:
            meta = self.metadata(ident, db)
            pattern = (
                "%"
                + str(search)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")[:1000]
                + "%"
            )
            where = "dataset_id=? AND cells LIKE ? ESCAPE '\\'"
            total = db.execute(
                "SELECT count(*) FROM dataset_rows WHERE " + where, (ident, pattern)
            ).fetchone()[0]
            rows = db.execute(
                "SELECT id,cells,created_at FROM dataset_rows WHERE "
                + where
                + " ORDER BY rowid LIMIT 100 OFFSET ?",
                (ident, pattern, offset),
            ).fetchall()
            return {
                **meta,
                "rows": [
                    dict(id=r[0], cells=json.loads(r[1]), created_at=r[2]) for r in rows
                ],
                "total": total,
                "offset": offset,
                "page_size": 100,
            }

    def rows(self, ident):
        # Snapshot before a long tool run; do not keep a write transaction open.
        with self.connect() as db:
            self.metadata(ident, db)
            return [
                dict(id=r[0], cells=json.loads(r[1]))
                for r in db.execute(
                    "SELECT id,cells FROM dataset_rows WHERE dataset_id=? ORDER BY rowid",
                    (ident,),
                )
            ]

    def schema(self, fields):
        if not isinstance(fields, list) or len(fields) > MAX_FIELDS:
            raise AppError("validation_failed", 400)
        result, ids, names = [], set(), set()
        for field in fields:
            if not isinstance(field, dict):
                raise AppError("validation_failed", 400)
            ident = field.get("id") or uuid4().hex
            name = str(field.get("name", "")).strip()[:200]
            kind = field.get("type", "value")
            if (
                not isinstance(ident, str)
                or not re.fullmatch(r"[a-f0-9]{32}", ident)
                or ident in ids
                or not name
                or name.casefold() in names
                or kind not in FIELD_TYPES
            ):
                raise AppError("validation_failed", 400)
            ids.add(ident)
            names.add(name.casefold())
            result.append(dict(id=ident, name=name, type=kind))
        return result

    def cells(self, cells, fields):
        if not isinstance(cells, dict) or set(cells) - {f["id"] for f in fields}:
            raise AppError("validation_failed", 400)
        from core.files import file_references

        for fid in file_references(cells):
            self.files.resolve(fid)
        for field in fields:
            value = cells.get(field["id"])
            if value is None or value == "":
                continue
            kind = field["type"]
            if kind == "number" and (
                isinstance(value, bool) or not isinstance(value, (float, int))
            ):
                raise AppError("validation_failed", 400)
            if kind == "boolean" and not isinstance(value, bool):
                raise AppError("validation_failed", 400)
            if kind in {"image", "file"}:
                values = value if isinstance(value, list) else [value]
                if any(not isinstance(v, dict) or not v.get("file_id") for v in values):
                    raise AppError("validation_failed", 400)
                if kind == "image":
                    with self.connect() as db:
                        if any(
                            not db.execute(
                                "SELECT is_image FROM uploaded_files WHERE id=? AND is_image=1",
                                (v["file_id"],),
                            ).fetchone()
                            for v in values
                        ):
                            raise AppError("validation_failed", 400)
        return self.encode(cells)

    def create(self, body):
        ident = uuid4().hex
        title = str(body.get("title", "")).strip()[:200]
        if not title:
            raise AppError("validation_failed", 400)
        fields = self.schema(body.get("fields", []))
        with self.connect() as db:
            db.execute(
                "INSERT INTO datasets VALUES (?,?,?,?,?)",
                (ident, title, self.encode(fields), 1, self.now()),
            )
        return self.page(ident)

    def mutate(self, ident, body):
        candidates = set()
        from core.files import file_references

        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            meta = self.metadata(ident, db)
            if (
                type(body.get("revision")) is not int
                or body["revision"] != meta["revision"]
            ):
                raise AppError("revision_conflict", 409)
            operation = body.get("operation")
            if operation == "delete":
                for (cells,) in db.execute(
                    "SELECT cells FROM dataset_rows WHERE dataset_id=?", (ident,)
                ):
                    candidates.update(file_references(json.loads(cells)))
                db.execute("DELETE FROM dataset_rows WHERE dataset_id=?", (ident,))
                db.execute("DELETE FROM datasets WHERE id=?", (ident,))
            elif operation == "schema":
                fields = self.schema(body.get("fields"))
                old = {f["id"]: f for f in meta["fields"]}
                # Renaming and removing fields is safe; type changes require empty data.
                if any(
                    f["id"] in old and f["type"] != old[f["id"]]["type"] for f in fields
                ):
                    raise AppError("validation_failed", 400)
                allowed = {f["id"] for f in fields}
                for rid, encoded in db.execute(
                    "SELECT id,cells FROM dataset_rows WHERE dataset_id=?", (ident,)
                ).fetchall():
                    current = json.loads(encoded)
                    candidates.update(
                        file_references(
                            {k: v for k, v in current.items() if k not in allowed}
                        )
                    )
                    db.execute(
                        "UPDATE dataset_rows SET cells=? WHERE id=?",
                        (
                            self.encode(
                                {k: v for k, v in current.items() if k in allowed}
                            ),
                            rid,
                        ),
                    )
                title = str(body.get("title", meta["title"])).strip()[:200]
                if not title:
                    raise AppError("validation_failed", 400)
                db.execute(
                    "UPDATE datasets SET title=?,fields=? WHERE id=?",
                    (title, self.encode(fields), ident),
                )
            elif operation in {"rows", "delete_rows"}:
                rows = body.get("rows", [])
                if not isinstance(rows, list) or len(rows) > 10000:
                    raise AppError("validation_failed", 400)
                current_count = db.execute(
                    "SELECT count(*) FROM dataset_rows WHERE dataset_id=?", (ident,)
                ).fetchone()[0]
                if (
                    operation == "rows"
                    and current_count + sum(not r.get("id") for r in rows) > MAX_ROWS
                ):
                    raise AppError("request_too_large", 413)
                for row in rows:
                    rid = row.get("id")
                    previous = (
                        db.execute(
                            "SELECT cells FROM dataset_rows WHERE id=? AND dataset_id=?",
                            (rid, ident),
                        ).fetchone()
                        if rid
                        else None
                    )
                    if rid and not previous:
                        raise AppError("not_found", 404)
                    if previous:
                        candidates.update(file_references(json.loads(previous[0])))
                    if operation == "delete_rows":
                        db.execute(
                            "DELETE FROM dataset_rows WHERE id=? AND dataset_id=?",
                            (rid, ident),
                        )
                    else:
                        encoded = self.cells(row.get("cells", {}), meta["fields"])
                        if previous:
                            db.execute(
                                "UPDATE dataset_rows SET cells=? WHERE id=?",
                                (encoded, rid),
                            )
                        else:
                            db.execute(
                                "INSERT INTO dataset_rows VALUES (?,?,?,?)",
                                (uuid4().hex, ident, encoded, self.now()),
                            )
            else:
                raise AppError("validation_failed", 400)
            if operation != "delete":
                db.execute(
                    "UPDATE datasets SET revision=revision+1,updated_at=? WHERE id=?",
                    (self.now(), ident),
                )
        self.files.collect_unused(candidates)
        return {"deleted": True} if operation == "delete" else self.page(ident)

    def snapshot(self, ident):
        with self.connect() as db:
            db.execute("BEGIN")
            meta = self.metadata(ident, db)
            rows = [
                dict(id=r[0], cells=json.loads(r[1]))
                for r in db.execute(
                    "SELECT id,cells FROM dataset_rows WHERE dataset_id=? ORDER BY rowid",
                    (ident,),
                )
            ]
        return {**meta, "rows": rows}


def row_outputs(database, row, source_input, *, extra=None):
    """One result group per matching row; retain field IDs and complete values."""
    outputs = []
    group = database["title"] + " · " + row["id"][:8]
    for field in database["fields"]:
        value = row["cells"].get(field["id"])
        if value is None or value == "":
            continue
        values = (
            value
            if field["type"] in {"image", "file"} and isinstance(value, list)
            else [value]
        )
        for item in values:
            kind = field["type"]
            if kind in {"image", "file"} and isinstance(item, dict):
                data = copy.deepcopy(item)
            else:
                kind = (
                    kind
                    if kind in {"email", "phone", "url"} and isinstance(item, str)
                    else "value"
                )
                data = {
                    "value": (
                        item
                        if isinstance(item, str)
                        else json.dumps(item, ensure_ascii=False)
                    )
                }
            outputs.append(
                dict(
                    type=kind,
                    label=field["name"],
                    data=data,
                    source_input=source_input,
                    relation="Datenbanktreffer",
                    group=group,
                    group_id=database["id"] + ":" + row["id"],
                    source={
                        "database_id": database["id"],
                        "database_title": database["title"],
                        "database_revision": database["revision"],
                        "row_id": row["id"],
                        "field_id": field["id"],
                        "field_name": field["name"],
                        **(extra or {}),
                    },
                )
            )
    # An entirely empty matched record still has an auditable identity.
    if not outputs:
        outputs.append(
            dict(
                type="value",
                label=group,
                data={"value": row["id"]},
                group=group,
                group_id=database["id"] + ":" + row["id"],
                source_input=source_input,
                source={"database_id": database["id"], "row_id": row["id"]},
            )
        )
    return outputs
