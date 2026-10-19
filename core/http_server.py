"""HTTP transport adapter for an explicit application instance."""

import json
import mimetypes
from pathlib import Path
import threading
import hashlib
from uuid import uuid4
from core.errors import AppError, classify
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from core.graph import NODE_DEFAULTS
from core.application import get_default_application


class ApplicationServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, app=None, **kwargs):
        self.app = app if app is not None else get_default_application()
        self.slots = threading.BoundedSemaphore(64)
        self.body_slots = threading.BoundedSemaphore(4)
        super().__init__(*args, **kwargs)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def app(self):
        server = getattr(self, "server", None)
        return server.app if server is not None else get_default_application()

    def handle_one_request(self):
        self.body_reserved = False
        try:
            return super().handle_one_request()
        finally:
            if self.body_reserved:
                self.server.body_slots.release()

    def guard(self, write=False):
        self.file_download_name = None
        self.static_response = False
        self.response_headers = {}
        self.access_session = None
        self.connection.settimeout(30)
        self.app.AUTH.check_host(self.headers)
        path = urlparse(self.path).path
        if path.startswith("/api/") and path not in ("/api/health", "/api/auth/login"):
            self.access_session = self.app.AUTH.session(self.headers, write)
        return path

    def failure(self, exc):
        problem = classify(exc)
        self.close_connection = True
        self.app.LOGGER.warning(
            json.dumps(
                {
                    "event": "request_rejected",
                    "request_id": getattr(self, "request_id", None),
                    "code": problem.code,
                    "type": type(exc).__name__,
                }
            )
        )
        self.send(
            problem.status,
            {
                "error": {
                    "code": problem.code,
                    "params": problem.params,
                    "detail": problem.detail,
                },
                "request_id": getattr(self, "request_id", None),
            },
        )

    def log_request(self, code="-", size="-"):
        # BaseHTTPRequestHandler passes status directly here. Parsing log_message's
        # presentation format was fragile and accidentally logged every successful GET.
        status = int(code) if str(code).isdigit() else None
        if self.command == "GET" and status is not None and 200 <= status < 400:
            return
        self.app.LOGGER.info(
            json.dumps(
                {
                    "event": "http",
                    "method": self.command,
                    "request_id": getattr(self, "request_id", None),
                    "status": status,
                }
            )
        )

    def log_message(self, fmt, *args):
        # Other stdlib diagnostics contain request text; retain structured metadata only.
        self.app.LOGGER.info(
            json.dumps(
                {
                    "event": "http_diagnostic",
                    "method": getattr(self, "command", None),
                    "request_id": getattr(self, "request_id", None),
                }
            )
        )

    def send(self, status, payload, mime="application/json"):
        data = (
            json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            if mime == "application/json" and not isinstance(payload, bytes)
            else payload
        )
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        if getattr(self, "file_download_name", None):
            from urllib.parse import quote

            self.send_header(
                "Content-Disposition",
                "attachment; filename*=UTF-8''"
                + quote(self.file_download_name, safe=""),
            )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Cache-Control",
            (
                "public, max-age=0, must-revalidate"
                if getattr(self, "static_response", False)
                else "no-store"
            ),
        )
        for name, value in getattr(self, "response_headers", {}).items():
            self.send_header(name, value)
        if self.close_connection:
            self.send_header("Connection", "close")
        csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; frame-src 'self'; frame-ancestors 'self'"
        if urlparse(self.path).path == "/transform-worker.js":
            csp = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'"
        self.send_header("Content-Security-Policy", csp)
        self.end_headers()
        self.wfile.write(data)

    def serve_media_file(self, fid, playback=False):
        """Bounded streaming and HTTP byte ranges allow seeking without loading full videos."""
        file = self.app.FILES.browser_video(fid) if playback else self.app.FILES.resolve(fid)
        with self.app.connect() as conn:
            info = conn.execute(
                "SELECT filename,mime FROM uploaded_files WHERE id=?", (fid,)
            ).fetchone()
        name, mime = info or (fid, "application/octet-stream")
        if playback:
            mime = "video/mp4"
        size = file.stat().st_size
        start, end, status = 0, size - 1, 200
        range_header = self.headers.get("Range")
        if range_header:
            import re

            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            try:
                if not match or not any(match.groups()):
                    raise ValueError()
                left, right = match.groups()
                if left:
                    start = int(left)
                    end = min(int(right), size - 1) if right else size - 1
                else:
                    suffix = int(right)
                    if suffix <= 0:
                        raise ValueError()
                    start = max(0, size - suffix)
                if start < 0 or start >= size or end < start:
                    raise ValueError()
                status = 206
            except ValueError:
                self.response_headers = {"Content-Range": f"bytes */{size}"}
                return self.send(416, b"", mime)
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        )
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if mime not in self.app.FILES.INLINE_MIMES:
            from urllib.parse import quote

            self.send_header(
                "Content-Disposition",
                "attachment; filename*=UTF-8''" + quote(name, safe=""),
            )
        self.end_headers()
        try:
            with file.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Seeking/closing a player deliberately abandons its previous range.

    def content_length(self, maximum):
        if (
            self.headers.get("Transfer-Encoding")
            or len(self.headers.get_all("Content-Length", [])) > 1
        ):
            raise AppError("invalid_request", 400)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise AppError("invalid_request", 400) from None
        if length < 0 or length > maximum:
            raise AppError("request_too_large", 413)
        return length

    def reserve_body(self):
        # Four parsers/uploads at most, held through the entire response lifecycle.
        # JSON has a 48 MiB bound; uploads use 64 KiB streaming chunks.
        if not self.body_reserved:
            if not self.server.body_slots.acquire(blocking=False):
                raise AppError("server_busy", 503)
            self.body_reserved = True

    def body(self, raw=False):
        length = self.content_length(128 * 1024 * 1024 if raw else 48 * 1024 * 1024)
        self.reserve_body()
        data = self.rfile.read(length)
        if len(data) != length:
            raise AppError("invalid_request", 400)
        if raw:
            return data
        value = json.loads(data or b"{}")
        if not isinstance(value, dict):
            raise AppError("invalid_request", 400)
        return value

    def do_GET(self):
        try:
            self.request_id = uuid4().hex
            path = self.guard()
            if path == "/api/health":
                with self.app.connect() as conn:
                    conn.execute("SELECT 1")
                return self.send(
                    200,
                    {
                        "status": "ok",
                        "database": "ok",
                        "version": self.app.APP_VERSION,
                        "worker_isolation": Path("/run/argus/worker.sock").exists(),
                        "queue_worker_alive": bool(
                            self.app.JOBS.thread and self.app.JOBS.thread.is_alive()
                        ),
                        "last_worker_error": self.app.JOBS.last_worker_error,
                    },
                )
            if path == "/api/auth/session":
                return self.send(200, {"csrf_token": self.access_session["csrf"]})
            if path == "/api/jobs":
                return self.send(
                    200,
                    {
                        **self.app.JOBS.active(),
                        "vpn_waiting": self.app.JOBS.vpn_waiting,
                        "vpn": (
                            {**self.app.VPN.status(), "enabled": True}
                            if self.app.VPN.configuration()["enabled"]
                            else {"enabled": False}
                        ),
                    },
                )
            if path == "/api/vpn":
                return self.send(200, self.app.VPN.public())
            if path.startswith("/api/jobs/"):
                return self.send(200, self.app.JOBS.get(path.rsplit("/", 1)[-1]))
            if path in ("/api/map-preview", "/api/map-tile"):
                from urllib.parse import parse_qs

                query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
                if path == "/api/map-tile":
                    return self.send(
                        200,
                        self.app.MAPS.tile(query["z"][0], query["x"][0], query["y"][0]),
                        "image/png",
                    )
                try:
                    preview = self.app.MAPS.preview(
                        query.get("lat", [""])[0],
                        query.get("lon", [""])[0],
                        query.get("q", [""])[0],
                        query.get("provider", ["osm"])[0],
                        self.app.settings().get("language", "en"),
                    )
                except Exception:
                    preview = self.app.MAPS.unavailable(
                        self.app.settings().get("language", "en")
                    )
                return self.send(200, preview, "text/html; charset=utf-8")
            if path == "/api/media":
                from urllib.parse import parse_qs

                url = parse_qs(urlparse(self.path).query).get("url", [""])[0]
                _, (content, mime, _) = self.app.MEDIA.image(url)
                return self.send(200, content, mime)
            if path == "/api/providers":
                from provider_registry import ui_catalogue

                return self.send(200, {"providers": ui_catalogue()})
            if path == "/api/plugins":
                return self.send(
                    200,
                    {
                        "plugins": self.app.MANAGER.installed(),
                        "node_defaults": {
                            **NODE_DEFAULTS,
                            **self.app.MANAGER.node_defaults(),
                        },
                        "node_display_defaults": self.app.settings()[
                            "node_display_defaults"
                        ],
                        "data_plugins": self.app.MANAGER.data_catalogue(),
                        "geocoder_configured": True,
                    },
                )
            if path == "/api/plugin-library":
                return self.send(
                    200,
                    {
                        "plugins": self.app.MANAGER.library(),
                        "repositories": self.app.MANAGER.repositories(),
                    },
                )
            if path == "/api/settings":
                return self.send(
                    200,
                    {
                        "settings": self.app.settings(),
                        "languages": self.app.languages(),
                    },
                )
            if path in {"/api/system-logs", "/api/system-logs/export"}:
                from urllib.parse import parse_qs

                query = parse_qs(urlparse(self.path).query)
                search = query.get("q", [""])[0][:1000]
                if path.endswith("/export"):
                    limit = int(query.get("limit", ["0"])[0])
                    if limit < 0:
                        raise AppError("validation_failed", 400)
                    self.close_connection = True
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header(
                        "Content-Disposition",
                        'attachment; filename="argus-system-logs.txt"',
                    )
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    for line in self.app.SYSTEM_LOGS.export(search, limit):
                        self.wfile.write(line.encode())
                    return
                return self.send(
                    200,
                    self.app.SYSTEM_LOGS.page(
                        search, int(query.get("offset", ["0"])[0])
                    ),
                )
            if path == "/api/projects":
                return self.send(200, self.app.PROJECTS.list())
            if path.startswith("/api/projects/") and path.endswith(
                ("/logs", "/logs-export")
            ):
                from urllib.parse import parse_qs

                pid = path.split("/")[3]
                self.app.PROJECTS.load(pid)
                query = parse_qs(urlparse(self.path).query)
                search = query.get("q", [""])[0][:1000]
                if path.endswith("/logs-export"):
                    limit = int(query.get("limit", ["0"])[0])
                    if limit < 0:
                        raise AppError("validation_failed", 400)
                    self.close_connection = True
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header(
                        "Content-Disposition", 'attachment; filename="argus-logs.txt"'
                    )
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    for index, row in enumerate(
                        self.app.PROJECTS.history.lines(pid, search)
                    ):
                        if limit and index >= limit:
                            break
                        self.wfile.write((row["text"] + "\n").encode())
                    return
                return self.send(
                    200,
                    self.app.PROJECTS.history.line_page(
                        pid, search, int(query.get("offset", [0])[0])
                    ),
                )
            if path.startswith("/api/projects/"):
                parts = path.strip("/").split("/")
                project = self.app.load_project(parts[2])
                if len(parts) == 3:
                    return self.send(200, project)
                if len(parts) == 4 and parts[3] == "report":
                    return self.send(
                        200, self.app.report(project), "text/html; charset=utf-8"
                    )
                raise AppError("not_found", 404)
            if path.startswith("/api/files/"):
                parts = path.split("/")
                if len(parts) == 5 and parts[-1] == "playback":
                    return self.serve_media_file(parts[-2], playback=True)
                return self.serve_media_file(path.rsplit("/", 1)[1])
            file = (
                self.app.ROOT
                / "static"
                / ("index.html" if path == "/" else path.lstrip("/"))
            ).resolve()
            if self.app.ROOT / "static" not in file.parents or not file.is_file():
                raise AppError("not_found", 404)
            self.static_response = True
            etag = '"' + hashlib.sha256(file.read_bytes()).hexdigest() + '"'
            self.response_headers = {"ETag": etag}
            if self.headers.get("If-None-Match") == etag:
                return self.send(
                    304,
                    b"",
                    mimetypes.guess_type(file)[0] or "application/octet-stream",
                )
            return self.send(
                200,
                file.read_bytes(),
                mimetypes.guess_type(file)[0] or "application/octet-stream",
            )
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:
            self.failure(exc)

    def do_POST(self):
        try:
            self.request_id = uuid4().hex
            path = self.guard(write=True)
            if path == "/api/auth/login":
                if self.headers.get("X-Argus-Client") != "web":
                    raise AppError("csrf_required", 403)
                self.body()
                sid, csrf, _ = self.app.AUTH.login(
                    self.app.AUTH.key, self.client_address[0]
                )
                secure = (
                    "; Secure"
                    if self.headers.get("Origin", "").startswith("https://")
                    else ""
                )
                self.response_headers = {
                    "Set-Cookie": "argus_session="
                    + sid
                    + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200"
                    + secure
                }
                return self.send(
                    200,
                    {
                        "csrf_token": csrf,
                    },
                )
            if path == "/api/files":
                project_id = self.headers.get("X-Project-Id")
                if project_id:
                    self.app.PROJECTS.load(project_id)
                length = self.content_length(128 * 1024 * 1024)
                self.reserve_body()
                return self.send(
                    201,
                    self.app.FILES.upload_stream(
                        self.rfile,
                        length,
                        self.headers.get("X-File-Name", "Datei"),
                        project_id=project_id,
                    ),
                )
            body = self.body()
            if path == "/api/vpn":
                return self.send(200, self.app.VPN.save(body))
            if path == "/api/vpn/rotate":
                return self.send(200, self.app.VPN.rotate())
            if path == "/api/system-logs/clear":
                self.app.SYSTEM_LOGS.clear()
                return self.send(200, {"cleared": True})
            if path == "/api/media/store":
                fid, _ = self.app.MEDIA.image(body.get("url", ""))
                return self.send(200, {"file_id": fid})
            if path == "/api/auth/logout":
                self.app.AUTH.logout(self.headers)
                self.response_headers = {
                    "Set-Cookie": "argus_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
                }
                return self.send(200, {"logged_out": True})
            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                return self.send(200, self.app.JOBS.cancel(path.split("/")[3]))
            if path == "/api/settings":
                return self.send(200, self.app.save_settings(body))
            if path == "/api/plugin/install":
                return self.send(200, self.app.MANAGER.install(body["id"]))
            if path == "/api/plugin/remove":
                return self.send(200, self.app.MANAGER.uninstall(body["id"]))
            if path == "/api/plugin/connection":
                return self.send(
                    202,
                    self.app.JOBS.submit_connection(
                        body,
                        self.headers.get("Idempotency-Key") or body.get("request_key"),
                    ),
                )
            if path == "/api/plugin/settings":
                return self.send(
                    200, self.app.MANAGER.configure(body["id"], body["settings"])
                )
            if path == "/api/repositories/add":
                return self.send(200, self.app.MANAGER.add_repo(body["url"]))
            if path == "/api/repositories/remove":
                return self.send(200, self.app.MANAGER.remove_repo(body["id"]))
            if path == "/api/repositories/refresh":
                return self.send(200, self.app.MANAGER.refresh_repo(body["id"]))
            if path == "/api/projects":
                title = str(body.get("title", "Neues Projekt"))[:200]
                doc = body.get(
                    "document",
                    {
                        "nodes": [],
                        "edges": [],
                        "groups": [],
                        "runs": [],
                        "report_notes": "",
                    },
                )
                return self.send(201, self.app.PROJECTS.create(title, doc))
            parts = path.strip("/").split("/")
            if len(parts) >= 3 and parts[:2] == ["api", "projects"]:
                if len(parts) == 4 and parts[3] == "cancel-run":
                    return self.send(200, self.app.cancel_run(parts[2], body))
                if len(parts) == 4 and parts[3] == "location-choice":
                    return self.send(200, self.app.choose_location(parts[2], body))
                if len(parts) == 4 and parts[3] == "rename":
                    return self.send(
                        200,
                        self.app.PROJECTS.rename(
                            parts[2], body.get("title"), body.get("revision")
                        ),
                    )
                if len(parts) == 4 and parts[3] == "archive":
                    return self.send(
                        200,
                        self.app.archive_project(
                            parts[2], body.get("archived"), body.get("revision")
                        ),
                    )
                if len(parts) == 4 and parts[3] == "delete":
                    return self.send(
                        200,
                        self.app.delete_archived_project(
                            parts[2], body.get("revision")
                        ),
                    )
                if len(parts) == 4 and parts[3] == "logs-clear":
                    return self.send(
                        200,
                        self.app.PROJECTS.clear_logs(parts[2], body.get("revision")),
                    )
                if len(parts) == 4 and parts[3] == "reconcile":
                    return self.send(
                        200,
                        self.app.PROJECTS.reconcile(
                            parts[2], body, persist=body.get("persist", False)
                        ),
                    )
                if len(parts) == 4 and parts[3] == "run":
                    return self.send(
                        202,
                        self.app.JOBS.submit(
                            parts[2],
                            body,
                            self.headers.get("Idempotency-Key")
                            or body.get("request_key"),
                        ),
                    )
                if len(parts) == 3:
                    return self.send(
                        200,
                        self.app.PROJECTS.save(
                            parts[2],
                            body["title"],
                            body["document"],
                            body["revision"],
                            client=True,
                        ),
                    )
            raise AppError("not_found", 404)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:
            self.failure(exc)
