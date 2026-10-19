"""Explicit application resources and lifecycle; importing creates no files or threads."""

import importlib
import json
import os
from pathlib import Path
import threading
import logging
from core.access import Access
from core.node_policy import normalize_node
from core.connections import PluginConnections
from core.jobs import Jobs
from core.media import Media
from core.maps import Maps
from datetime import datetime, timezone
from core.database import connect as database_connect
from plugin_manager import Manager
from core.graph import (
    TYPES as TYPES,
    NODE_DEFAULTS as NODE_DEFAULTS,
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


class ApplicationResources:
    def __init__(self, data_directory=None, *, start_workers=True):
        self.ROOT = Path(__file__).resolve().parents[1]
        self.APP_VERSION = (self.ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.DATA = Path(
            data_directory
            if data_directory is not None
            else os.environ.get("DATA_DIR", self.ROOT / "data")
        )
        self.DATA.mkdir(parents=True, exist_ok=True)
        self.DATA.chmod(0o700)
        (self.DATA / "home").mkdir(mode=0o700, exist_ok=True)
        (self.DATA / "files").mkdir(exist_ok=True)
        self.DB = self.DATA / "workbench.sqlite3"
        self.PLUGINS = {}
        for path in sorted((self.ROOT / "plugins").glob("*.py")):
            if path.name.startswith("_"):
                continue
            module = importlib.import_module("plugins." + path.stem)
            self.PLUGINS[module.PLUGIN["id"]] = module
        with self.connect() as conn:
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
        self.MANAGER = Manager(self.DB, self.DATA, self.PLUGINS)
        self.ACTOR_LOCK = threading.Lock()
        self.TAG_PREFERENCES = {"tags": [], "language": "de"}
        self.SETTINGS = SettingsRepository(
            lambda: self.connect(), self.MANAGER, self.ROOT, self.TAG_PREFERENCES
        )
        self.FILES = FileRepository(lambda: self.connect(), self.DATA / "files")
        self.MEDIA = Media(self.connect, self.FILES)
        self.MAPS = Maps(self.DATA)
        self.SCHEMA = GraphSchema(
            lambda: self.MANAGER.node_defaults(), self.actor_node_policy, normalize_node
        )
        self.PROJECTS = ProjectRepository(
            lambda: self.connect(),
            lambda doc: self.canonicalize_document(doc),
            lambda doc: self.validate(doc),
            lambda: self.now(),
            prepare=self.SCHEMA.prepare,
            cleanup=lambda candidates: self.FILES.collect_unused(candidates),
            attach_files=self.FILES.attach,
        )
        self.FILES.collect_unused()
        self.AUTH = Access(self.DATA)
        self.CONNECTIONS = PluginConnections(
            self.MANAGER, self.ACTOR_LOCK, self.DATA / "plugin-sessions"
        )
        self.VPN = VPNService(self.connect, self.MANAGER.secrets)

        self.JOBS = Jobs(
            self.connect,
            self.PROJECTS,
            self.execute,
            self.now,
            connect_plugin=self.CONNECTIONS.connect,
            vpn=self.VPN,
            start=False,
        )
        self.LOGGER = logging.getLogger("argus.http")
        self.SYSTEM_LOGS = SystemLogs(self.connect, self.now)

        logging.getLogger("argus").setLevel(logging.INFO)

        self._stop = threading.Event()
        self._gc_thread = None
        self._started = False
        if start_workers:
            self.start()

    def now(self):
        return datetime.now(timezone.utc).isoformat()

    def connect(self):
        return database_connect(self.DB)

    def settings(self):
        return self.SETTINGS.load()

    def languages(self):
        return self.SETTINGS.languages()

    def save_settings(self, body):
        return self.SETTINGS.save(body)

    def actor_node_policy(self, node):
        # Configured credentials belong to plugin settings, never to a graph/clipboard.
        params = node.get("data", {}).get("params", {})
        if isinstance(params, dict):
            module = self.PLUGINS.get(node["data"].get("plugin"))
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
                    self.MANAGER.secret_fields(
                        node["data"].get("plugin"),
                        {"defaults": {node["data"].get("action"): params}},
                    ),
                )
                and not key.startswith("_auth_")
                and key not in action.get("settings_only", [])
            }

    def canonicalize_node(self, node, schemas=None):
        return self.SCHEMA.canonicalize_node(node, schemas)

    def canonicalize_document(self, doc):
        return self.SCHEMA.canonicalize_document(doc)

    def validate(self, doc):
        return self.SCHEMA.validate(doc)

    def load_project(self, pid):
        return self.PROJECTS.load(pid)

    def save_project(self, pid, title, doc, revision):
        return self.PROJECTS.save(pid, title, self.MEDIA.collect(doc), revision)

    def archive_project(self, pid, archived, revision):
        return self.PROJECTS.archive(pid, archived, revision)

    def delete_archived_project(self, pid, revision):
        return self.PROJECTS.delete_archived(pid, revision)

    def node_bounds(self, node):
        return graph_node_bounds(node, self.TAG_PREFERENCES)

    def actor_service(self, pid=None):
        preferences = self.settings()
        return ActorService(
            self.MANAGER,
            self.load_project,
            self.save_project,
            lambda node: graph_node_bounds(node, preferences),
            self.settings,
            self.resolve_file,
            self.now,
            self.ACTOR_LOCK,
            self.DATA / "plugin-sessions",
            store_file=lambda data, name: self.FILES.upload(data, name, project_id=pid),
            collect_media=self.MEDIA.collect,
        )

    def execute(self, pid, body):
        return self.actor_service(pid).execute(pid, body)

    def execute_serial(self, pid, body):
        return self.actor_service(pid).execute_serial(pid, body)

    def choose_location(self, pid, body):
        return self.actor_service().choose_location(pid, body)

    def cancel_run(self, pid, body):
        return self.actor_service().cancel_run(pid, body)

    def resolve_file(self, fid):
        return self.FILES.resolve(fid)

    def report(self, project):
        preferences = self.settings()
        messages = json.loads(
            (
                self.ROOT / "static" / "locales" / (preferences["language"] + ".json")
            ).read_text()
        ).get("messages", {})
        return render_report(
            project, preferences, self.MANAGER.all_descriptors(), messages, self.now()
        )

    def start(self):
        if self._started:
            return
        self.VPN.require_gateway()
        self._started = True
        logging.getLogger("argus").addHandler(self.SYSTEM_LOGS)
        self.JOBS.start()
        self._gc_thread = threading.Thread(
            target=self._collect_files, name="argus-file-gc", daemon=True
        )
        self._gc_thread.start()
        self.LOGGER.info(
            json.dumps({"event": "application_started", "version": self.APP_VERSION})
        )

    def _collect_files(self):
        while not self._stop.wait(60):
            try:
                self.FILES.collect_unused()
            except Exception:
                self.LOGGER.warning('{"event":"file_gc_failed"}')

    def close(self):
        self._stop.set()
        self.JOBS.close()
        if self._gc_thread:
            self._gc_thread.join(timeout=2)
        logging.getLogger("argus").removeHandler(self.SYSTEM_LOGS)
        self.SYSTEM_LOGS.close()
        self._started = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


_default = None
_default_lock = threading.Lock()


def create_app(data_directory=None, *, start_workers=True):
    return ApplicationResources(data_directory, start_workers=start_workers)


def get_default_application():
    global _default
    if _default is None:
        with _default_lock:
            if _default is None:
                _default = create_app()
    return _default
