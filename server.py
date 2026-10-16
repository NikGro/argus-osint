"""Small single-container workbench: stdlib HTTP server + SQLite + plugin registry."""

import importlib
import json
import mimetypes
import os
from pathlib import Path
import threading
import logging
import hashlib
import time
from uuid import uuid4
from core.errors import AppError, classify
from core.access import Access
from core.node_policy import normalize_node
from core.connections import PluginConnections
from core.jobs import Jobs
from core.media import Media
from core.maps import Maps
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from core.database import connect as database_connect
from plugin_manager import Manager
from core.graph import (
    TYPES as TYPES,
    NODE_DEFAULTS,
    LOCATION_DEFAULTS as LOCATION_DEFAULTS,
    GraphSchema,
    strip_assessment as strip_assessment,
    value_text as value_text,
    group_node_ids as group_node_ids,
    prune_groups as prune_groups,
    validate_group_tree as validate_group_tree,
    merge_value as merge_value,
    merge_documents as merge_documents,
)
from core.projects import ProjectRepository
from core.actors import ActorService
from core.geometry import node_bounds as graph_node_bounds
from core.secrets import is_secret
from core.reports import facts_html as facts_html, render_report
from core.settings import SettingsRepository
from core.files import FileRepository
from core.system_logs import SystemLogs
from core.vpn import VPN as VPNService

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)
DATA.chmod(0o700)
(DATA / "home").mkdir(mode=0o700, exist_ok=True)
(DATA / "files").mkdir(exist_ok=True)
DB = DATA / "workbench.sqlite3"
PLUGINS = {}
for path in sorted((ROOT / "plugins").glob("*.py")):
    if path.name.startswith("_"):
        continue
    module = importlib.import_module("plugins." + path.stem)
    PLUGINS[module.PLUGIN["id"]] = module


def now():
    return datetime.now(timezone.utc).isoformat()


def connect():
    return database_connect(DB)


with connect() as conn:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_archive (project_id TEXT PRIMARY KEY, archived_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS uploaded_files (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, is_image INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS application_settings (id INTEGER PRIMARY KEY, settings TEXT NOT NULL)"
    )

MANAGER = Manager(DB, DATA, PLUGINS)

ACTOR_LOCK = threading.Lock()
TAG_PREFERENCES = {"tags": [], "language": "de"}


SETTINGS = SettingsRepository(lambda: connect(), MANAGER, ROOT, TAG_PREFERENCES)
FILES = FileRepository(lambda: connect(), DATA / "files")
MEDIA = Media(connect, FILES)
MAPS = Maps(DATA)


def settings():
    return SETTINGS.load()


def languages():
    return SETTINGS.languages()


def save_settings(body):
    return SETTINGS.save(body)


def actor_node_policy(node):
    # Configured credentials belong to plugin settings, never to a graph/clipboard.
    params = node.get("data", {}).get("params", {})
    if isinstance(params, dict):
        module = PLUGINS.get(node["data"].get("plugin"))
        action = (
            next(
                (
                    a
                    for a in module.PLUGIN.get("actions", [])
                    if a["id"] == node["data"].get("action")
                ),
                {},
            )
            if module
            else {}
        )
        node["data"]["params"] = {
            key: value
            for key, value in params.items()
            if not is_secret(
                key,
                MANAGER.secret_fields(
                    node["data"].get("plugin"),
                    {"defaults": {node["data"].get("action"): params}},
                ),
            )
            and not key.startswith("_auth_")
            and key not in action.get("settings_only", [])
        }


SCHEMA = GraphSchema(lambda: MANAGER.node_defaults(), actor_node_policy, normalize_node)
PROJECTS = ProjectRepository(
    lambda: connect(),
    lambda doc: canonicalize_document(doc),
    lambda doc: validate(doc),
    lambda: now(),
    prepare=SCHEMA.prepare,
    cleanup=lambda candidates: FILES.collect_unused(candidates),
)


def canonicalize_node(node, schemas=None):
    return SCHEMA.canonicalize_node(node, schemas)


def canonicalize_document(doc):
    return SCHEMA.canonicalize_document(doc)


def validate(doc):
    return SCHEMA.validate(doc)


def load_project(pid):
    return PROJECTS.load(pid)


def save_project(pid, title, doc, revision):
    return PROJECTS.save(pid, title, MEDIA.collect(doc), revision)


def archive_project(pid, archived, revision):
    return PROJECTS.archive(pid, archived, revision)


def delete_archived_project(pid, revision):
    return PROJECTS.delete_archived(pid, revision)


def node_bounds(node):
    return graph_node_bounds(node, TAG_PREFERENCES)


def actor_service():
    preferences = settings()
    return ActorService(
        MANAGER,
        load_project,
        save_project,
        lambda node: graph_node_bounds(node, preferences),
        settings,
        resolve_file,
        now,
        ACTOR_LOCK,
        DATA / "plugin-sessions",
        store_file=FILES.upload,
        collect_media=MEDIA.collect,
    )


def execute(pid, body):
    return actor_service().execute(pid, body)


def execute_serial(pid, body):
    return actor_service().execute_serial(pid, body)


def choose_location(pid, body):
    return actor_service().choose_location(pid, body)


def cancel_run(pid, body):
    return actor_service().cancel_run(pid, body)


def resolve_file(fid):
    return FILES.resolve(fid)


def report(project):
    preferences = settings()
    messages = json.loads(
        (ROOT / "static" / "locales" / (preferences["language"] + ".json")).read_text()
    ).get("messages", {})
    return render_report(
        project, preferences, MANAGER.all_descriptors(), messages, now()
    )


AUTH = Access(DATA)

CONNECTIONS = PluginConnections(MANAGER, ACTOR_LOCK, DATA / "plugin-sessions")
VPN = VPNService(connect, MANAGER.secrets)
VPN.require_gateway()
JOBS = Jobs(
    connect, PROJECTS, execute, now, connect_plugin=CONNECTIONS.connect, vpn=VPN
)
LOGGER = logging.getLogger("argus.http")
SYSTEM_LOGS = SystemLogs(connect, now)
logging.getLogger("argus").addHandler(SYSTEM_LOGS)
logging.getLogger("argus").setLevel(logging.INFO)
LOGGER.info(json.dumps({"event": "application_started", "version": "0.29"}))


class ApplicationServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(64)
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

    def guard(self, write=False):
        self.file_download_name = None
        self.static_response = False
        self.response_headers = {}
        self.access_session = None
        self.connection.settimeout(30)
        AUTH.check_host(self.headers)
        path = urlparse(self.path).path
        if path.startswith("/api/") and path not in ("/api/health", "/api/auth/login"):
            self.access_session = AUTH.session(self.headers, write)
        return path

    def failure(self, exc):
        problem = classify(exc)
        self.close_connection = True
        LOGGER.warning(
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

    def log_message(self, fmt, *args):
        if urlparse(self.path).path.startswith("/api/system-logs"):
            return
        LOGGER.info(
            json.dumps(
                {
                    "event": "http",
                    "method": self.command,
                    "request_id": getattr(self, "request_id", None),
                    "status": (
                        args[1] if fmt.startswith("%s") and len(args) > 1 else None
                    ),
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

    def body(self, raw=False):
        length = int(self.headers.get("Content-Length", "0"))
        maximum = 16 * 1024 * 1024 if raw else 48 * 1024 * 1024
        if (
            self.headers.get("Transfer-Encoding")
            or len(self.headers.get_all("Content-Length", [])) > 1
        ):
            raise AppError("invalid_request", 400)
        if length < 0 or length > maximum:
            raise AppError("request_too_large", 413)
        data = self.rfile.read(length)
        if raw:
            return data
        value = json.loads(data or b"{}")
        if not isinstance(value, dict):
            raise ValueError("JSON-Objekt erwartet.")
        return value

    def do_GET(self):
        try:
            self.request_id = uuid4().hex
            path = self.guard()
            if path == "/api/health":
                with connect() as conn:
                    conn.execute("SELECT 1")
                return self.send(
                    200,
                    {
                        "status": "ok",
                        "database": "ok",
                        "version": "0.29",
                        "worker_isolation": Path("/run/argus/worker.sock").exists(),
                    },
                )
            if path == "/api/auth/session":
                return self.send(200, {"csrf_token": self.access_session["csrf"]})
            if path == "/api/jobs":
                return self.send(
                    200,
                    {
                        **JOBS.active(),
                        "vpn_waiting": JOBS.vpn_waiting,
                        "vpn": (
                            {**VPN.status(), "enabled": True}
                            if VPN.configuration()["enabled"]
                            else {"enabled": False}
                        ),
                    },
                )
            if path == "/api/vpn":
                return self.send(200, VPN.public())
            if path.startswith("/api/jobs/"):
                return self.send(200, JOBS.get(path.rsplit("/", 1)[-1]))
            if path in ("/api/map-preview", "/api/map-tile"):
                from urllib.parse import parse_qs

                query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
                if path == "/api/map-tile":
                    return self.send(
                        200,
                        MAPS.tile(query["z"][0], query["x"][0], query["y"][0]),
                        "image/png",
                    )
                return self.send(
                    200,
                    MAPS.preview(
                        query.get("lat", [""])[0],
                        query.get("lon", [""])[0],
                        query.get("q", [""])[0],
                        query.get("provider", ["osm"])[0],
                    ),
                    "text/html; charset=utf-8",
                )
            if path == "/api/media":
                from urllib.parse import parse_qs

                url = parse_qs(urlparse(self.path).query).get("url", [""])[0]
                _, (content, mime, _) = MEDIA.image(url)
                return self.send(200, content, mime)
            if path == "/api/providers":
                from provider_registry import ui_catalogue

                return self.send(200, {"providers": ui_catalogue()})
            if path == "/api/plugins":
                return self.send(
                    200,
                    {
                        "plugins": MANAGER.installed(),
                        "node_defaults": {**NODE_DEFAULTS, **MANAGER.node_defaults()},
                        "node_display_defaults": settings()["node_display_defaults"],
                        "data_plugins": MANAGER.data_catalogue(),
                        "geocoder_configured": True,
                    },
                )
            if path == "/api/plugin-library":
                return self.send(
                    200,
                    {
                        "plugins": MANAGER.library(),
                        "repositories": MANAGER.repositories(),
                    },
                )
            if path == "/api/settings":
                return self.send(
                    200, {"settings": settings(), "languages": languages()}
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
                    for line in SYSTEM_LOGS.export(search, limit):
                        self.wfile.write(line.encode())
                    return
                return self.send(
                    200, SYSTEM_LOGS.page(search, int(query.get("offset", ["0"])[0]))
                )
            if path == "/api/projects":
                return self.send(200, PROJECTS.list())
            if path.startswith("/api/projects/") and path.endswith(
                ("/logs", "/logs-export")
            ):
                from urllib.parse import parse_qs

                pid = path.split("/")[3]
                PROJECTS.load(pid)
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
                    for index, row in enumerate(PROJECTS.history.lines(pid, search)):
                        if limit and index >= limit:
                            break
                        self.wfile.write((row["text"] + "\n").encode())
                    return
                return self.send(
                    200,
                    PROJECTS.history.line_page(
                        pid, search, int(query.get("offset", [0])[0])
                    ),
                )
            if path.startswith("/api/projects/"):
                parts = path.strip("/").split("/")
                project = load_project(parts[2])
                if len(parts) == 3:
                    return self.send(200, project)
                if len(parts) == 4 and parts[3] == "report":
                    return self.send(200, report(project), "text/html; charset=utf-8")
                raise AppError("not_found", 404)
            if path.startswith("/api/files/"):
                content, mime, download_name = FILES.read(path.rsplit("/", 1)[1])
                if download_name:
                    self.file_download_name = download_name
                return self.send(200, content, mime)
            file = (
                ROOT / "static" / ("index.html" if path == "/" else path.lstrip("/"))
            ).resolve()
            if ROOT / "static" not in file.parents or not file.is_file():
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
                sid, csrf, _ = AUTH.login(AUTH.key, self.client_address[0])
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
                return self.send(
                    201,
                    FILES.upload(
                        self.body(raw=True), self.headers.get("X-File-Name", "Datei")
                    ),
                )
            body = self.body()
            if path == "/api/vpn":
                return self.send(200, VPN.save(body))
            if path == "/api/vpn/rotate":
                return self.send(200, VPN.rotate())
            if path == "/api/system-logs/clear":
                SYSTEM_LOGS.clear()
                return self.send(200, {"cleared": True})
            if path == "/api/media/store":
                fid, _ = MEDIA.image(body.get("url", ""))
                return self.send(200, {"file_id": fid})
            if path == "/api/auth/logout":
                AUTH.logout(self.headers)
                self.response_headers = {
                    "Set-Cookie": "argus_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
                }
                return self.send(200, {"logged_out": True})
            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                return self.send(200, JOBS.cancel(path.split("/")[3]))
            if path == "/api/settings":
                return self.send(200, save_settings(body))
            if path == "/api/plugin/install":
                return self.send(200, MANAGER.install(body["id"]))
            if path == "/api/plugin/remove":
                return self.send(200, MANAGER.uninstall(body["id"]))
            if path == "/api/plugin/connection":
                return self.send(
                    202,
                    JOBS.submit_connection(
                        body,
                        self.headers.get("Idempotency-Key") or body.get("request_key"),
                    ),
                )
            if path == "/api/plugin/settings":
                return self.send(200, MANAGER.configure(body["id"], body["settings"]))
            if path == "/api/repositories/add":
                return self.send(200, MANAGER.add_repo(body["url"]))
            if path == "/api/repositories/remove":
                return self.send(200, MANAGER.remove_repo(body["id"]))
            if path == "/api/repositories/refresh":
                return self.send(200, MANAGER.refresh_repo(body["id"]))
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
                return self.send(201, PROJECTS.create(title, doc))
            parts = path.strip("/").split("/")
            if len(parts) >= 3 and parts[:2] == ["api", "projects"]:
                if len(parts) == 4 and parts[3] == "cancel-run":
                    return self.send(200, cancel_run(parts[2], body))
                if len(parts) == 4 and parts[3] == "location-choice":
                    return self.send(200, choose_location(parts[2], body))
                if len(parts) == 4 and parts[3] == "rename":
                    return self.send(
                        200,
                        PROJECTS.rename(
                            parts[2], body.get("title"), body.get("revision")
                        ),
                    )
                if len(parts) == 4 and parts[3] == "archive":
                    return self.send(
                        200,
                        archive_project(
                            parts[2], body.get("archived"), body.get("revision")
                        ),
                    )
                if len(parts) == 4 and parts[3] == "delete":
                    return self.send(
                        200, delete_archived_project(parts[2], body.get("revision"))
                    )
                if len(parts) == 4 and parts[3] == "logs-clear":
                    return self.send(
                        200, PROJECTS.clear_logs(parts[2], body.get("revision"))
                    )
                if len(parts) == 4 and parts[3] == "reconcile":
                    return self.send(
                        200,
                        PROJECTS.reconcile(
                            parts[2], body, persist=body.get("persist", False)
                        ),
                    )
                if len(parts) == 4 and parts[3] == "run":
                    return self.send(
                        202,
                        JOBS.submit(
                            parts[2],
                            body,
                            self.headers.get("Idempotency-Key")
                            or body.get("request_key"),
                        ),
                    )
                if len(parts) == 3:
                    return self.send(
                        200,
                        PROJECTS.save(
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


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    # Access is currently passwordless; keep same-origin sessions and CSRF checks.
    print(f"Argus listening on {host}:{port}", flush=True)

    def collect_files():
        while True:
            try:
                FILES.collect_unused()
            except Exception:
                LOGGER.warning('{"event":"file_gc_failed"}')
            time.sleep(60)

    threading.Thread(target=collect_files, name="argus-file-gc", daemon=True).start()
    ApplicationServer((host, port), Handler).serve_forever()
