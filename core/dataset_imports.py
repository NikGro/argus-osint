"""Bounded, preview-first imports. Spreadsheet readers use standard-library XML.

No macros, formulas, URLs or external relationships are executed. Unknown files
remain local attachments. A staged preview is immutable and consumed atomically.
"""

import csv
import io
import json
import re
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from uuid import uuid4
from core.errors import AppError

MAX_BYTES = 32 * 1024 * 1024
MAX_ROWS = 10000
MAX_CELLS = 300000


def xml(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise AppError("validation_failed", 400)
    return ET.fromstring(data)


def local(tag):
    return tag.rsplit("}", 1)[-1]


def archive(path):
    package = zipfile.ZipFile(path)
    infos = package.infolist()
    if (
        len(infos) > 10000
        or sum(i.file_size for i in infos) > MAX_BYTES
        or any(i.flag_bits & 1 for i in infos)
    ):
        package.close()
        raise AppError("request_too_large", 413)
    return package


def spreadsheet(path, kind, selected=""):
    with archive(path) as package:
        if kind == ".ods":
            root = xml(package.read("content.xml"))
            tables = [e for e in root.iter() if local(e.tag) == "table"]
            sheets = [
                next((v for k, v in t.attrib.items() if local(k) == "name"), str(i + 1))
                for i, t in enumerate(tables)
            ]
            chosen = sheets.index(selected) if selected in sheets else 0
            if not tables:
                raise AppError("validation_failed", 400)
            matrix = []
            for row in tables[chosen]:
                if local(row.tag) != "table-row":
                    continue
                cells = []
                for cell in row:
                    if local(cell.tag) not in {"table-cell", "covered-table-cell"}:
                        continue
                    attrs = {local(k): v for k, v in cell.attrib.items()}
                    value = attrs.get(
                        "value", attrs.get("date-value", attrs.get("boolean-value"))
                    )
                    if value is None:
                        value = "\n".join(
                            "".join(p.itertext()) for p in cell if local(p.tag) == "p"
                        )
                    if attrs.get("value-type") in {"float", "currency", "percentage"}:
                        value = float(value) if value else None
                    elif attrs.get("value-type") == "boolean":
                        value = value == "true"
                    repeats = min(201, int(attrs.get("number-columns-repeated", "1")))
                    cells.extend([value] * repeats)
                while cells and cells[-1] in (None, ""):
                    cells.pop()
                repeat_rows = min(
                    MAX_ROWS + 1,
                    int(
                        next(
                            (
                                v
                                for k, v in row.attrib.items()
                                if local(k) == "number-rows-repeated"
                            ),
                            "1",
                        )
                    ),
                )
                if cells:
                    matrix.extend([cells] * repeat_rows)
                if len(matrix) > MAX_ROWS + 1 or len(cells) > 200:
                    raise AppError("request_too_large", 413)
            return sheets, sheets[chosen], matrix
        main = xml(package.read("xl/workbook.xml"))
        links = xml(package.read("xl/_rels/workbook.xml.rels"))
        targets = {
            e.attrib["Id"]: e.attrib["Target"]
            for e in links
            if not e.attrib.get("TargetMode")
        }
        tabs = [e for e in main.iter() if local(e.tag) == "sheet"]
        sheets = [e.attrib["name"] for e in tabs]
        if not sheets:
            raise AppError("validation_failed", 400)
        chosen = sheets.index(selected) if selected in sheets else 0
        relation = next(v for k, v in tabs[chosen].attrib.items() if local(k) == "id")
        target = targets[relation]
        target = target.lstrip("/") if target.startswith("/") else "xl/" + target
        if ".." in target.split("/") or not target.startswith("xl/"):
            raise AppError("validation_failed", 400)
        shared = []
        if "xl/sharedStrings.xml" in package.namelist():
            shared = [
                "".join(e.itertext()) for e in xml(package.read("xl/sharedStrings.xml"))
            ]
        matrix = []
        for row in xml(package.read(target)).iter():
            if local(row.tag) != "row":
                continue
            cells = []
            for cell in row:
                if local(cell.tag) != "c":
                    continue
                letters = re.match(r"[A-Z]+", cell.attrib.get("r", "A1"))
                col = 0
                for c in letters[0] if letters else "A":
                    col = col * 26 + ord(c) - 64
                if col > 200:
                    raise AppError("request_too_large", 413)
                while len(cells) < col:
                    cells.append("")
                value = next((e.text or "" for e in cell if local(e.tag) == "v"), "")
                if cell.attrib.get("t") == "s":
                    value = shared[int(value)] if value else ""
                elif cell.attrib.get("t") == "inlineStr":
                    value = "".join(
                        e.text or "" for e in cell.iter() if local(e.tag) == "t"
                    )
                elif cell.attrib.get("t") == "b":
                    value = value == "1"
                elif cell.attrib.get("t") not in {"str", "e"} and value:
                    value = float(value)
                    if value.is_integer():
                        value = int(value)
                cells[col - 1] = value
            matrix.append(cells)
            if len(matrix) > MAX_ROWS + 1:
                raise AppError("request_too_large", 413)
        return sheets, sheets[chosen], matrix


def flatten(value, prefix="", output=None):
    output = {} if output is None else output
    if isinstance(value, dict) and not value.get("file_id"):
        for key, item in value.items():
            flatten(item, prefix + "." + str(key) if prefix else str(key), output)
    else:
        output[prefix or "value"] = value
    return output


def records_from_matrix(matrix, headers):
    width = max((len(row) for row in matrix), default=0)
    names = []
    for index in range(width):
        candidate = str(
            matrix[0][index]
            if headers and matrix and index < len(matrix[0])
            else "Column " + str(index + 1)
        ).strip() or "Column " + str(index + 1)
        name = candidate
        suffix = 2
        while name in names:
            name = candidate + " (" + str(suffix) + ")"
            suffix += 1
        names.append(name)
    return [
        {name: row[i] if i < len(row) else "" for i, name in enumerate(names)}
        for row in matrix[int(headers) :]
        if any(c not in (None, "") for c in row)
    ]


def bounded_matrix(iterator):
    rows = []
    count = 0
    for row in iterator:
        count += len(row)
        if len(rows) >= MAX_ROWS + 1 or len(row) > 200 or count > MAX_CELLS:
            raise AppError("request_too_large", 413)
        rows.append(row)
    return rows


class DatasetImports:
    def __init__(self, datasets):
        self.datasets = datasets

    def preview(self, body):
        identifiers = body.get("files", [])
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 200:
            raise AppError("validation_failed", 400)
        sheets, chosen, records, total_bytes = [], "", [], 0
        warnings = []
        mode = body.get("mode", "auto")
        if mode not in {"auto", "attachments", "one_record"}:
            raise AppError("validation_failed", 400)
        for fid in identifiers:
            path = self.datasets.files.resolve(fid)
            with self.datasets.connect() as db:
                info = db.execute(
                    "SELECT filename,mime,size,is_image FROM uploaded_files WHERE id=?",
                    (fid,),
                ).fetchone()
            if not info:
                raise AppError("not_found", 404)
            name, mime, size, is_image = info
            ext = Path(name).suffix.lower()
            if mode != "auto" or ext not in {
                ".csv",
                ".tsv",
                ".xlsx",
                ".ods",
                ".json",
                ".jsonl",
                ".ndjson",
                ".xml",
                ".txt",
            }:
                records.append(
                    {
                        "Filename": name,
                        "Images" if is_image else "Files": {
                            "file_id": fid,
                            "filename": name,
                            "mime": mime,
                            "size": size,
                        },
                    }
                )
                continue
            total_bytes += path.stat().st_size
            if total_bytes > MAX_BYTES:
                raise AppError("request_too_large", 413)
            if ext in {".xlsx", ".ods"}:
                file_sheets, sheet, matrix = spreadsheet(
                    path, ext, body.get("sheet", "")
                )
                if len(identifiers) == 1:
                    sheets, chosen = file_sheets, sheet
                warnings.append(
                    "Formeln werden nicht ausgeführt; gespeicherte Zellwerte werden importiert."
                )
                records.extend(records_from_matrix(matrix, body.get("headers", True)))
                continue
            encoding = body.get("encoding", "utf-8-sig")
            if encoding not in {"utf-8-sig", "utf-16", "cp1252"}:
                raise AppError("validation_failed", 400)
            text = path.read_text(encoding=encoding)
            if ext in {".jsonl", ".ndjson"}:
                parsed = [
                    json.loads(line) for line in text.splitlines() if line.strip()
                ]
            elif ext == ".json":
                parsed = json.loads(text)
                if isinstance(parsed, dict) and body.get("record_path"):
                    for key in body["record_path"].split("."):
                        parsed = parsed[key]
                elif isinstance(parsed, dict):
                    lists = [
                        v
                        for v in parsed.values()
                        if isinstance(v, list)
                        and v
                        and all(isinstance(item, dict) for item in v)
                    ]
                    if len(lists) == 1:
                        parsed = lists[0]
                parsed = parsed if isinstance(parsed, list) else [parsed]
            elif ext == ".xml":
                parsed = [
                    (
                        {local(e.tag): "".join(e.itertext()) for e in row}
                        if len(row)
                        else {local(row.tag): row.text}
                    )
                    for row in xml(text.encode())
                ]
            elif ext == ".txt" and body.get("delimiter", "auto") == "lines":
                parsed = [{"Text": line} for line in text.splitlines() if line.strip()]
            else:
                delimiter = body.get("delimiter", "auto")
                if delimiter == "auto":
                    try:
                        delimiter = (
                            csv.Sniffer()
                            .sniff(text[:8192], delimiters=",;\t|")
                            .delimiter
                        )
                    except csv.Error:
                        delimiter = "\t" if ext == ".tsv" else ","
                if delimiter not in {",", ";", "\t", "|"}:
                    raise AppError("validation_failed", 400)
                parsed = records_from_matrix(
                    bounded_matrix(csv.reader(io.StringIO(text), delimiter=delimiter)),
                    body.get("headers", True),
                )
            records.extend(flatten(item) for item in parsed)
        if mode == "one_record":
            files, images = [], []
            for record in records:
                for key, target in [("Images", images), ("Files", files)]:
                    if record.get(key):
                        target.append(record[key])
            records = [
                {
                    **({"Images": images} if images else {}),
                    **({"Files": files} if files else {}),
                }
            ]
        if (
            not records
            or len(records) > MAX_ROWS
            or sum(len(r) for r in records) > MAX_CELLS
        ):
            raise AppError(
                "validation_failed" if not records else "request_too_large",
                400 if not records else 413,
            )
        keys = list(dict.fromkeys(k for row in records for k in row))
        if len(keys) > 200:
            raise AppError("request_too_large", 413)
        columns = []
        for key in keys:
            values = [r[key] for r in records if key in r and r[key] not in (None, "")][
                :100
            ]
            sample = values[:3]

            def attachment(v):
                return (
                    isinstance(v, dict)
                    and v.get("file_id")
                    or isinstance(v, list)
                    and v
                    and all(isinstance(i, dict) and i.get("file_id") for i in v)
                )

            kind = (
                "image"
                if key == "Images" and all(attachment(v) for v in values)
                else (
                    "file"
                    if values and all(attachment(v) for v in values)
                    else (
                        "boolean"
                        if values and all(isinstance(v, bool) for v in values)
                        else (
                            "number"
                            if values
                            and all(
                                isinstance(v, (int, float)) and not isinstance(v, bool)
                                for v in values
                            )
                            else (
                                "json"
                                if any(isinstance(v, (dict, list)) for v in values)
                                else "value"
                            )
                        )
                    )
                )
            )
            columns.append({"key": key, "type": kind, "samples": sample})
        ident = uuid4().hex
        payload = json.dumps(
            {"records": records, "columns": columns},
            ensure_ascii=False,
            allow_nan=False,
        )
        if len(payload.encode()) > MAX_BYTES:
            raise AppError("request_too_large", 413)
        with self.datasets.connect() as db:
            # Keep only one day of abandoned staging, never duplicate an applied import.
            db.execute(
                "DELETE FROM dataset_imports WHERE created_at < ?",
                (str(time.time() - 86400),),
            )
            db.execute(
                "INSERT INTO dataset_imports VALUES (?,?,?)",
                (ident, payload, str(time.time())),
            )
        return {
            "id": ident,
            "columns": columns,
            "rows": records[:10],
            "total": len(records),
            "sheets": sheets,
            "sheet": chosen,
            "warnings": list(dict.fromkeys(warnings)),
        }

    def commit(self, body):
        repo = self.datasets
        with repo.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            staged = db.execute(
                "SELECT payload FROM dataset_imports WHERE id=?",
                (body.get("preview_id"),),
            ).fetchone()
            if not staged:
                raise AppError("not_found", 404)
            payload = json.loads(staged[0])
            ident = body.get("database_id")
            if ident:
                meta = repo.metadata(ident, db)
                if body.get("revision") != meta["revision"]:
                    raise AppError("revision_conflict", 409)
                fields = list(meta["fields"])
            else:
                ident = uuid4().hex
                title = str(body.get("title", "")).strip()[:200]
                if not title:
                    raise AppError("validation_failed", 400)
                fields = []
                meta = {"title": title, "revision": 1}
            mapping = body.get("mapping", [])
            if not isinstance(mapping, list) or len(mapping) > 200:
                raise AppError("validation_failed", 400)
            selected = {}
            used = set()
            valid = {c["key"] for c in payload["columns"]}
            for entry in mapping:
                if entry.get("skip"):
                    continue
                key = entry.get("source")
                if key not in valid or key in selected:
                    raise AppError("validation_failed", 400)
                target = entry.get("field_id")
                if not target:
                    target = uuid4().hex
                    fields.append(
                        {
                            "id": target,
                            "name": str(entry.get("name", key)),
                            "type": entry.get("type", "value"),
                        }
                    )
                if target not in {f["id"] for f in fields} or target in used:
                    raise AppError("validation_failed", 400)
                used.add(target)
                selected[key] = target
            if not selected:
                raise AppError("validation_failed", 400)
            fields = repo.schema(fields)
            count = db.execute(
                "SELECT count(*) FROM dataset_rows WHERE dataset_id=?", (ident,)
            ).fetchone()[0]
            if count + len(payload["records"]) > 100000:
                raise AppError("request_too_large", 413)
            encoded = []
            for record in payload["records"]:
                cells = {selected[k]: v for k, v in record.items() if k in selected}
                for f in fields:
                    value = cells.get(f["id"])
                    if value in (None, ""):
                        continue
                    if f["type"] == "number" and isinstance(value, str):
                        cells[f["id"]] = float(value)
                    if f["type"] == "boolean" and isinstance(value, str):
                        if value.casefold() not in {
                            "true",
                            "false",
                            "1",
                            "0",
                            "yes",
                            "no",
                            "ja",
                            "nein",
                        }:
                            raise AppError("validation_failed", 400)
                        cells[f["id"]] = value.casefold() in {"true", "1", "yes", "ja"}
                encoded.append(repo.cells(cells, fields))
            if body.get("database_id"):
                db.execute(
                    "UPDATE datasets SET fields=?,revision=revision+1,updated_at=? WHERE id=?",
                    (repo.encode(fields), repo.now(), ident),
                )
            else:
                db.execute(
                    "INSERT INTO datasets VALUES (?,?,?,?,?)",
                    (ident, meta["title"], repo.encode(fields), 1, repo.now()),
                )
            db.executemany(
                "INSERT INTO dataset_rows VALUES (?,?,?,?)",
                [(uuid4().hex, ident, r, repo.now()) for r in encoded],
            )
            db.execute(
                "DELETE FROM dataset_imports WHERE id=?", (body.get("preview_id"),)
            )
        return {"database_id": ident, "imported": len(encoded)}
