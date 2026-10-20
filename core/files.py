"""Validated file intake, metadata storage and conservative content delivery."""

from core.errors import DomainError
import io
import re
import os
import shutil
import threading
import subprocess
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
            "video/mp4",
            "video/webm",
            "video/quicktime",
        }
    )

    def __init__(self, connect, directory):
        self.connect = connect
        self.directory = directory
        self.playback_locks = [threading.Lock() for _ in range(16)]
        self.playback_slots = threading.BoundedSemaphore(2)
        with connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS project_files (project_id TEXT NOT NULL,file_id TEXT NOT NULL,PRIMARY KEY(project_id,file_id))"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS project_files_by_file ON project_files(file_id)"
            )

    def project_path(self, pid, fid):
        if not isinstance(pid, str) or not re.fullmatch("[a-f0-9]{32}", pid):
            raise DomainError("validation.55f0f81352")
        if not isinstance(fid, str) or not re.fullmatch("[a-f0-9]{32}", fid):
            raise DomainError("validation.d2673f7901")
        return self.directory / "projects" / pid / fid

    def attach(self, conn, pid, document):
        """Give every referenced artifact a project-local copy, retaining stable IDs.

        Hard links avoid duplicate bytes across projects. Never remove the legacy
        source during migration: a failed DB transaction must remain recoverable.
        History snapshots are included by the repository before detaching them.
        """
        for fid in file_references(document):
            target = self.project_path(pid, fid)
            if not target.is_file():
                source = self.directory / fid
                if not source.is_file():
                    rows = conn.execute(
                        "SELECT project_id FROM project_files WHERE file_id=?", (fid,)
                    ).fetchall()
                    source = next(
                        (
                            p
                            for row in rows
                            if (p := self.project_path(row[0], fid)).is_file()
                        ),
                        None,
                    )
                if source is None or not source.is_file():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    os.link(source, target)
                except FileExistsError:
                    pass
                except OSError:
                    temporary = target.with_name(fid + "." + uuid4().hex + ".tmp")
                    try:
                        shutil.copyfile(source, temporary)
                        os.replace(temporary, target)
                    finally:
                        temporary.unlink(missing_ok=True)
            conn.execute("INSERT OR IGNORE INTO project_files VALUES (?,?)", (pid, fid))

    def resolve(self, fid):
        if not isinstance(fid, str) or not re.fullmatch("[a-f0-9]{32}", fid):
            raise DomainError("validation.8e525d9dc3")
        path = self.directory / fid
        if not path.is_file():
            with self.connect() as conn:
                rows = conn.execute(
                    "SELECT project_id FROM project_files WHERE file_id=?", (fid,)
                ).fetchall()
            path = next(
                (p for row in rows if (p := self.project_path(row[0], fid)).is_file()),
                None,
            )
        if path is None or not path.is_file():
            raise DomainError("validation.4c17f3876f")
        return path

    def upload(self, data, original_name, project_id=None):
        """Compatibility adapter for in-process tool artifacts."""
        return self.upload_stream(
            io.BytesIO(data), len(data), original_name, project_id
        )

    def upload_stream(self, stream, length, original_name, project_id=None):
        """Stream an exact, bounded body into its project; never buffer the upload."""
        from PIL import Image
        from core.errors import AppError

        if not 0 < length <= 128 * 1024 * 1024:
            raise AppError(
                "request_too_large" if length else "validation_failed",
                413 if length else 400,
            )
        filename = (
            unquote(original_name).replace(chr(92), "/").rsplit("/", 1)[-1][:240]
            or "Datei"
        )
        fid = uuid4().hex
        path = (
            self.project_path(project_id, fid) if project_id else self.directory / fid
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".upload")
        try:
            remaining = length
            with temporary.open("xb") as output:
                while remaining:
                    chunk = stream.read(min(64 * 1024, remaining))
                    if not chunk:
                        raise AppError("invalid_request", 400)
                    output.write(chunk)
                    remaining -= len(chunk)
            with temporary.open("rb") as source:
                mime = (
                    "application/pdf"
                    if source.read(5) == b"%PDF-"
                    else "application/octet-stream"
                )
            is_image = False
            try:
                with Image.open(temporary) as image:
                    mime = Image.MIME.get(image.format, mime)
                    image.verify()
                    is_image = True
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
                pass
            video = {}
            if not is_image:
                from core.video import probe_video

                video = probe_video(temporary, required=False)
                if video:
                    mime = video["mime"]
            os.replace(temporary, path)
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO uploaded_files VALUES (?,?,?,?,?)",
                    (fid, filename, mime, length, int(is_image)),
                )
                if project_id:
                    conn.execute(
                        "INSERT INTO project_files VALUES (?,?)", (project_id, fid)
                    )
            return {
                "file_id": fid,
                "filename": filename,
                "mime": mime,
                "size": length,
                "is_image": is_image,
                "is_video": bool(video),
                "duration": video.get("duration", 0),
            }
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        finally:
            temporary.unlink(missing_ok=True)

    def browser_video(self, fid):
        """Cache a browser-compatible working copy beside the immutable original."""
        from core.errors import AppError
        from core.video import probe_video

        source = self.resolve(fid)
        target = source.with_name(fid + ".browser.mp4")
        with self.playback_locks[int(fid[:2], 16) % len(self.playback_locks)]:
            if target.is_file():
                return target
            if not self.playback_slots.acquire(timeout=15):
                raise AppError("media_preview_unavailable", 503)
            temporary = target.with_name(fid + "." + uuid4().hex + ".browser.mp4")
            try:
                original = probe_video(source)
                subprocess.run(
                    [
                        "ffmpeg",
                        "-nostdin",
                        "-v",
                        "error",
                        "-i",
                        str(source),
                        "-map",
                        "0:v:0",
                        "-map",
                        "0:a:0?",
                        "-vf",
                        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "23",
                        "-threads",
                        "2",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                        "-movflags",
                        "+faststart",
                        "-fs",
                        "536870912",
                        str(temporary),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=180,
                )
                result = probe_video(temporary)
                if result["duration"] < original["duration"] - 0.5:
                    raise DomainError("validation.1f425d1edb")
                os.replace(temporary, target)
                return target
            except (OSError, ValueError, subprocess.SubprocessError):
                raise AppError("media_preview_unavailable", 422) from None
            finally:
                temporary.unlink(missing_ok=True)
                self.playback_slots.release()

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
            except (ImportError, OSError, ValueError):
                pass
        return (
            path.read_bytes(),
            mime,
            None if mime in self.INLINE_MIMES else filename,
        )

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
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='dataset_rows'"
            ).fetchone():
                documents += [
                    r[0] for r in conn.execute("SELECT cells FROM dataset_rows")
                ]
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='dataset_imports'"
            ).fetchone():
                documents += [
                    r[0] for r in conn.execute("SELECT payload FROM dataset_imports")
                ]
            referenced = set()
            for encoded in documents:
                referenced.update(file_references(json.loads(encoded)))
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='remote_media'"
            ).fetchone():
                for url, fid in conn.execute("SELECT url,file_id FROM remote_media"):
                    if any((url in encoded for encoded in documents)):
                        referenced.add(fid)
            for (fid,) in conn.execute(
                "SELECT file_id FROM file_gc WHERE eligible_at<=?", (time.time(),)
            ).fetchall():
                if fid in referenced:
                    continue
                for row in conn.execute(
                    "SELECT project_id FROM project_files WHERE file_id=?", (fid,)
                ).fetchall():
                    owned = self.project_path(row[0], fid)
                    owned.with_name(fid + ".browser.mp4").unlink(missing_ok=True)
                    owned.unlink(missing_ok=True)
                conn.execute("DELETE FROM project_files WHERE file_id=?", (fid,))
                path = self.directory / fid
                path.with_name(fid + ".browser.mp4").unlink(missing_ok=True)
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
            "[a-f0-9]{32}", value["file_id"]
        ):
            result.add(value["file_id"])
        for child in value.values():
            result.update(file_references(child))
    elif isinstance(value, list):
        for child in value:
            result.update(file_references(child))
    return result
