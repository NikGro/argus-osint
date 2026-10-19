"""Remote images become verified local files; previews never contact a target from the browser."""

import hashlib
import io
import threading
import time
from core.errors import AppError
from core.public_network import request


class Media:
    def __init__(self, connect, files):
        self.connect, self.files = connect, files
        self.lock = threading.Lock()
        with connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS remote_media (url TEXT PRIMARY KEY,file_id TEXT NOT NULL)"
            )

    def image(self, url):
        with self.lock:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT file_id FROM remote_media WHERE url=?", (url,)
                ).fetchone()
            if row:
                try:
                    return row[0], self.files.read(row[0])
                except ValueError:
                    pass
            response = request(url, timeout=15, limit=64 * 1024 * 1024)
            if response["status"] != 200:
                raise AppError("media_unavailable", 502)
            from PIL import Image

            try:
                with Image.open(io.BytesIO(response["body"])) as picture:
                    picture.verify()
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
                raise AppError("invalid_image", 422) from None
            stored = self.files.upload(
                response["body"],
                hashlib.sha256(url.encode()).hexdigest()[:16] + ".image",
            )
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO remote_media VALUES (?,?) ON CONFLICT(url) DO UPDATE SET file_id=excluded.file_id",
                    (url, stored["file_id"]),
                )
            return stored["file_id"], self.files.read(stored["file_id"])

    def collect(self, document):
        from core.execution_context import CANCEL_EVENT

        deadline = time.monotonic() + 120
        for node in document.get("nodes", []):
            if (
                node.get("type") == "image"
                and not node.get("data", {}).get("file_id")
                and node["data"].get("url")
            ):
                if time.monotonic() > deadline:
                    node.setdefault("evidence", {})[
                        "media_error"
                    ] = "media_download_deferred"
                    continue
                cancellation = CANCEL_EVENT.get()
                if cancellation is not None and cancellation.is_set():
                    raise AppError("actor_cancelled", 409)
                try:
                    fid, _ = self.image(node["data"]["url"])
                    node["data"]["file_id"] = fid
                    node.setdefault("evidence", {}).pop("media_error", None)
                except AppError as error:
                    node.setdefault("evidence", {})["media_error"] = error.code
        return document
