"""Validated file intake, metadata storage and conservative content delivery."""

import io
import re
from urllib.parse import unquote
from uuid import uuid4


class FileRepository:
    INLINE_MIMES = frozenset(
        {
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
            "image/tiff",
            "image/bmp",
            "application/pdf",
        }
    )

    def __init__(self, connect, directory):
        self.connect = connect
        self.directory = directory

    def resolve(self, fid):
        if not isinstance(fid, str) or not re.fullmatch(r"[a-f0-9]{32}", fid):
            raise ValueError("Ungültige Datei-ID.")
        path = self.directory / fid
        if not path.is_file():
            raise ValueError("Bilddatei nicht gefunden.")
        return path

    def upload(self, data, original_name):
        from PIL import Image

        if not data:
            raise ValueError("Die Datei ist leer.")
        filename = (
            unquote(original_name).replace(chr(92), "/").rsplit("/", 1)[-1][:240]
            or "Datei"
        )
        mime = (
            "application/pdf"
            if data.startswith(b"%PDF-")
            else "application/octet-stream"
        )
        is_image = False
        try:
            with Image.open(io.BytesIO(data)) as image:
                mime = Image.MIME.get(image.format, mime)
                image.verify()
                is_image = True
        except Exception:
            pass  # Unrecognized content is a downloadable file, never executable HTML.
        fid = uuid4().hex
        path = self.directory / fid
        path.write_bytes(data)
        try:
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO uploaded_files VALUES (?,?,?,?,?)",
                    (fid, filename, mime, len(data), int(is_image)),
                )
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {
            "file_id": fid,
            "filename": filename,
            "mime": mime,
            "size": len(data),
            "is_image": is_image,
        }

    def read(self, fid):
        path = self.resolve(fid)
        with self.connect() as conn:
            info = conn.execute(
                "SELECT filename,mime FROM uploaded_files WHERE id=?", (fid,)
            ).fetchone()
        filename, mime = info or (fid, "application/octet-stream")
        if not info:
            try:
                from PIL import Image

                with Image.open(path) as image:
                    mime = Image.MIME.get(image.format, mime)
            except Exception:
                pass
        return path.read_bytes(), mime, None if mime in self.INLINE_MIMES else filename

    def collect_unused(self, candidates=None):
        """Delete only project-owned candidates, with a short lease for concurrent clipboard/upload work."""
        import json
        import time

        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS file_gc (file_id TEXT PRIMARY KEY,eligible_at REAL NOT NULL)"
            )
            for fid in candidates or []:
                conn.execute(
                    "INSERT OR IGNORE INTO file_gc VALUES (?,?)",
                    (fid, time.time() + 300),
                )
            documents = [r[0] for r in conn.execute("SELECT document FROM projects")]
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='run_history'"
            ).fetchone():
                documents += [
                    r[0] for r in conn.execute("SELECT record FROM run_history")
                ]
            referenced = set()
            for encoded in documents:
                referenced.update(file_references(json.loads(encoded)))
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='remote_media'"
            ).fetchone():
                for url, fid in conn.execute("SELECT url,file_id FROM remote_media"):
                    if any(url in encoded for encoded in documents):
                        referenced.add(fid)
            for (fid,) in conn.execute(
                "SELECT file_id FROM file_gc WHERE eligible_at<=?", (time.time(),)
            ).fetchall():
                if fid in referenced:
                    continue
                path = self.directory / fid
                path.unlink(missing_ok=True)
                conn.execute("DELETE FROM uploaded_files WHERE id=?", (fid,))
                conn.execute("DELETE FROM file_gc WHERE file_id=?", (fid,))
                if conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE name='remote_media'"
                ).fetchone():
                    conn.execute("DELETE FROM remote_media WHERE file_id=?", (fid,))


def file_references(value):
    result = set()
    if isinstance(value, dict):
        if isinstance(value.get("file_id"), str) and re.fullmatch(
            r"[a-f0-9]{32}", value["file_id"]
        ):
            result.add(value["file_id"])
        for child in value.values():
            result.update(file_references(child))
    elif isinstance(value, list):
        for child in value:
            result.update(file_references(child))
    return result
