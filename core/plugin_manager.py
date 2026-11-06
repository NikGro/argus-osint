"""Plugin catalogue, on-demand installation of native and community plugins.

ARGUS ships without installed plugins. Native plugins come from the official
catalogue (plugins/native.json): installing one downloads its files from the
ARGUS repository at the image's source revision, accepts them only when every
SHA-256 matches the catalogue, and installs the research tools it needs into
the data volume. Uninstalling removes the files and any tool that no other
installed plugin still needs. Settings survive uninstalling.
"""

from core.errors import AppError, DomainError
from core.build_info import user_agent, VERSION
from core import catalogues, tools
import copy
import hashlib
import importlib.util
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import urllib.parse
import urllib.request
from uuid import uuid4
from core.database import connect as database_connect
from core.secrets import SecretStore, redact, is_secret
from core.plugin_contract import validate_descriptor
from core.community_plugin import CommunityPlugin

CATALOGUE = Path(__file__).resolve().parents[1] / "plugins" / "native.json"
LOG = logging.getLogger("argus.plugins")


def load_catalogue():
    return json.loads(CATALOGUE.read_text(encoding="utf-8"))


class Manager:

    def __init__(self, db, data, builtins=None, *, catalogue=None, source=None):
        """builtins: modules to treat as installed natives (tests); None loads
        the natives installed in the data volume."""
        self.db, self.data = db, Path(data)
        self.catalogue = load_catalogue() if catalogue is None else catalogue
        self.native = {item["id"]: item for item in self.catalogue["plugins"]}
        self.native_root = self.data / "plugins" / "native"
        self.source = source or os.environ.get("ARGUS_PLUGIN_SOURCE", "github")
        self.ref = os.environ.get("ARGUS_SOURCE_REF") or "v" + VERSION
        self.progress = {}
        self.pending = []
        self.install_queue = threading.Lock()
        self.builtins = {}
        for module in (builtins or {}).values():
            self.register(module)
        self.data_descriptors = [
            dict(
                json.loads(file.read_text(encoding="utf-8")),
                origin="builtin",
                version="bundled",
            )
            for file in sorted(
                (Path(__file__).parents[1] / "data_plugins").glob("*.json")
            )
        ]
        self.builtin_locales = {
            pid: item["descriptor"]["translations"]
            for pid, item in self.native.items()
            if item["descriptor"].get("translations")
        }
        for pid in self.builtins:
            file = Path(__file__).parents[1] / "plugins" / "locales" / (pid + ".json")
            if pid not in self.builtin_locales and file.exists():
                self.builtin_locales[pid] = json.loads(file.read_text(encoding="utf-8"))
        self.sources = self.data / "community-plugins"
        self.sources.mkdir(exist_ok=True)
        self.secrets = SecretStore(data)
        with self.connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS plugin_state (id TEXT PRIMARY KEY, installed INTEGER NOT NULL, settings TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS community_repos (id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, manifest TEXT NOT NULL, error TEXT)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS community_installed (id TEXT PRIMARY KEY, descriptor TEXT NOT NULL, source_path TEXT NOT NULL, sha256 TEXT NOT NULL, repo_id TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS native_installed (id TEXT PRIMARY KEY, files TEXT NOT NULL, ref TEXT NOT NULL)"
            )
            previous = {
                row[0]: json.loads(row[1])
                for row in conn.execute("SELECT id,settings FROM plugin_state")
            }
            for pid, value in previous.items():
                encrypted = self.secrets.seal(value, self.secret_fields(pid, value))
                if encrypted != value:
                    conn.execute(
                        "UPDATE plugin_state SET settings=? WHERE id=?",
                        (json.dumps(encrypted), pid),
                    )
            for target, sources in {
                "username": ("profiles", "maigret"),
                "email": ("holehe",),
                "phone": ("phoneinfoga",),
            }.items():
                if target in previous:
                    continue
                defaults = {}
                for source in sources:
                    action = (
                        "lookup"
                        if source == "holehe"
                        else "scan" if source == "phoneinfoga" else "search"
                    )
                    old = previous.get(source, {}).get("defaults", {}).get(action, {})
                    for key, value in old.items():
                        if key == "sites":
                            defaults[
                                {
                                    "profiles": "sherlock_sites",
                                    "maigret": "maigret_sites",
                                    "holehe": "holehe_sites",
                                }.get(source, "sites")
                            ] = value
                        elif key not in (
                            "run_timeout",
                            "request_timeout",
                            "max_results",
                        ):
                            defaults[key] = value
                conn.execute(
                    "INSERT OR IGNORE INTO plugin_state VALUES (?,?,?)",
                    (target, 1, json.dumps({"defaults": {"lookup": defaults}})),
                )
            for pid, disabled in {
                "username": ["sherlock", "maigret", "user_scanner"],
                "email": ["holehe", "user_scanner"],
                "phone": ["ignorant"],
            }.items():
                row = conn.execute(
                    "SELECT settings FROM plugin_state WHERE id=?", (pid,)
                ).fetchone()
                if not row:
                    continue
                settings = json.loads(row[0])
                if settings.get("consensus_migrated"):
                    continue
                defaults = settings.setdefault("defaults", {}).setdefault("lookup", {})
                defaults["use_consensus"] = True
                for source in disabled:
                    defaults["use_" + source] = False
                defaults["source_order"] = ["consensus"] + [
                    source
                    for source in defaults.get("source_order", [])
                    if source != "consensus"
                ]
                settings["consensus_migrated"] = True
                conn.execute(
                    "UPDATE plugin_state SET settings=? WHERE id=?",
                    (json.dumps(settings), pid),
                )
            for pid in ("username", "email"):
                if pid not in self.native:
                    continue
                row = conn.execute(
                    "SELECT settings FROM plugin_state WHERE id=?", (pid,)
                ).fetchone()
                if not row:
                    continue
                settings = json.loads(row[0])
                if settings.get("consensus_only_defaults_v1"):
                    continue
                defaults = settings.setdefault("defaults", {}).setdefault("lookup", {})
                descriptor = self.native[pid]["descriptor"]["actions"][0][
                    "default_params"
                ]
                for key in descriptor:
                    if key.startswith("use_"):
                        defaults[key] = key == "use_consensus"
                settings["consensus_only_defaults_v1"] = True
                conn.execute(
                    "UPDATE plugin_state SET settings=? WHERE id=?",
                    (json.dumps(settings), pid),
                )

        if builtins is None:
            self.load_installed()

    def connect(self):
        return database_connect(self.db)

    # -- native plugins: loading, installing, removing ----------------------

    def register(self, module):
        for action in module.PLUGIN.get("actions", []):
            schema = action.setdefault("parameter_schema", {})
            for key in action.get("default_params", {}):
                schema.setdefault(key, {"secret": is_secret(key)})
        self.builtins[module.PLUGIN["id"]] = module

    def load_installed(self):
        """Load installed natives; outdated ones are reinstalled by resume()."""
        with self.connect() as conn:
            rows = conn.execute("SELECT id,files FROM native_installed").fetchall()
        for pid, files in rows:
            entry = self.native.get(pid)
            if not entry:
                continue
            current = json.loads(files) == entry["files"] and all(
                tools.installed(tool) for tool in entry["tools"]
            )
            try:
                if current:
                    self.register(self.import_native(pid))
                    continue
            except (OSError, SyntaxError, ImportError, AppError) as error:
                LOG.warning(
                    json.dumps(
                        {
                            "event": "plugin_load_failed",
                            "plugin": pid,
                            "error": type(error).__name__,
                        }
                    )
                )
            self.pending.append(pid)

    def resume(self):
        """Bring installed natives up to the catalogue of this ARGUS version."""
        for pid in self.pending:
            self.start_install(pid)
        self.pending = []

    def import_native(self, pid):
        entry = self.native[pid]
        path = self.native_root / pid / entry["module"]
        name = "plugins." + Path(entry["module"]).stem
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            sys.modules.pop(name, None)
            raise
        return module

    def source_file(self, path):
        if self.source == "github":
            repository = self.catalogue["repository"]
            return self.fetch(
                f"https://raw.githubusercontent.com/{repository}/"
                + urllib.parse.quote(self.ref, safe="")
                + "/"
                + urllib.parse.quote(path, safe="/"),
                4 * 1024 * 1024,
            )
        return (Path(self.source) / path).read_bytes()

    def install_native(self, pid, log, with_tools=True):
        entry = self.native[pid]
        staging = self.native_root / (pid + ".partial")
        shutil.rmtree(staging, ignore_errors=True)
        try:
            for path, expected in sorted(entry["files"].items()):
                self.set_progress(pid, "download", path)
                content = self.source_file(path)
                if hashlib.sha256(content).hexdigest() != expected:
                    raise DomainError("validation.79bd815e89")
                target = staging / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            if with_tools:
                for tool in entry["tools"]:
                    self.set_progress(pid, "tool", tools.RECIPES[tool].label)
                    tools.install(tool, log)
                if entry["tools"]:
                    self.set_progress(pid, "catalogue")
                    catalogues.build()
            final = self.native_root / pid
            shutil.rmtree(final, ignore_errors=True)
            staging.rename(final)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        self.builtins.pop(pid, None)
        self.register(self.import_native(pid))
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO native_installed VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET files=excluded.files, ref=excluded.ref",
                (pid, json.dumps(entry["files"]), self.ref),
            )

    def set_progress(self, pid, step, detail=""):
        state = self.progress.setdefault(pid, {"state": "installing", "log": []})
        state.update(step=step, detail=detail)

    def required_tools(self):
        needed = set()
        for item in self.installed():
            if item["id"] in self.native:
                needed.update(self.native[item["id"]]["tools"])
            elif item.get("origin") == "community":
                needed.update(item.get("tools", []))
        return needed

    def prune_tools(self):
        needed = self.required_tools()
        removed = False
        for tool in tools.RECIPES:
            if tool not in needed and tools.installed(tool):
                tools.remove(tool)
                removed = True
        if removed:
            catalogues.build()

    def secret_fields(self, pid, settings=None):
        first_party = pid in self.builtins or pid in self.native
        if pid in self.builtins:
            descriptor = self.builtins[pid].PLUGIN
        elif pid in self.native:
            descriptor = self.native[pid]["descriptor"]
        else:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT descriptor FROM community_installed WHERE id=?", (pid,)
                ).fetchone()
            descriptor = json.loads(row[0]) if row else {}
        fields = set()
        for action in descriptor.get("actions", []):
            schema = action.get("parameter_schema", {})
            params = {
                **action.get("default_params", {}),
                **(settings or {}).get("defaults", {}).get(action["id"], {}),
            }
            for key, value in params.items():
                if schema.get(key, {}).get(
                    "secret", not first_party and isinstance(value, str)
                ) or is_secret(key):
                    fields.add(key)
            fields.update(
                (
                    key
                    for key, config in schema.items()
                    if config.get("secret", not first_party)
                )
            )
        return fields

    def state(self, reveal_secrets=False):
        with self.connect() as conn:
            return {
                row[0]: {
                    "installed": bool(row[1]),
                    "settings": (
                        self.secrets.reveal(json.loads(row[2]))
                        if reveal_secrets
                        else redact(
                            json.loads(row[2]),
                            self.secret_fields(row[0], json.loads(row[2])),
                        )
                    ),
                }
                for row in conn.execute(
                    "SELECT id,installed,settings FROM plugin_state"
                )
            }

    def repositories(self):
        with self.connect() as conn:
            return [
                {"id": r[0], "url": r[1], "manifest": json.loads(r[2]), "error": r[3]}
                for r in conn.execute(
                    "SELECT id,url,manifest,error FROM community_repos"
                )
            ]

    def all_descriptors(self):
        items = []
        for pid, entry in self.native.items():
            module = self.builtins.get(pid)
            descriptor = copy.deepcopy(module.PLUGIN if module else entry["descriptor"])
            descriptor.pop("tools", None)
            items.append(
                dict(
                    descriptor,
                    origin="builtin",
                    version="bundled",
                    tools=entry["tools"],
                )
            )
        items.extend(
            dict(copy.deepcopy(m.PLUGIN), origin="builtin", version="bundled")
            for pid, m in self.builtins.items()
            if pid not in self.native and not m.PLUGIN.get("hidden")
        )
        items.extend(copy.deepcopy(self.data_descriptors))
        for item in items:
            if item["id"] in self.builtin_locales:
                item["translations"] = copy.deepcopy(self.builtin_locales[item["id"]])
        with self.connect() as conn:
            for row in conn.execute("SELECT descriptor FROM community_installed"):
                item = json.loads(row[0])
                item["origin"] = "community"
                items.append(item)
        return items

    def installed(self, reveal_secrets=False):
        states = self.state(reveal_secrets=reveal_secrets)
        result = []
        for item in self.all_descriptors():
            state = states.get(item["id"], {"installed": True, "settings": {}})
            # Native plugins count only once their files are installed and loaded.
            native = item["id"] in self.native
            if not state["installed"] or (native and item["id"] not in self.builtins):
                continue
            item["settings"] = state["settings"]
            defaults = item["settings"].get("defaults", {})
            for action in item["actions"]:
                fields = self.secret_fields(item["id"], item["settings"])
                schema = action.setdefault("parameter_schema", {})
                for key in fields:
                    schema[key] = {**schema.get(key, {}), "secret": True}
                action["settings_only"] = sorted(
                    set(action.get("settings_only", [])) | fields
                )
                action["default_params"] = {
                    **action.get("default_params", {}),
                    **defaults.get(action["id"], {}),
                }
                if item["id"] in ("username", "email", "phone"):
                    from plugins._search_profiles import catalogue

                    action["research_profiles"] = copy.deepcopy(
                        catalogue().get(item["id"], {})
                    )
                if item["id"] == "deep_research":
                    action["default_params"].pop("argus_flaresolverr_url", None)
            for node in item.get("nodes", []):
                config = item["settings"].get("nodes", {}).get(node["type"], {})
                node["display_defaults"] = {
                    **node.get("display_defaults", {}),
                    **config.get("display_defaults", {}),
                }
                for key in ("map_preview_sources", "map_action_sources"):
                    if key in config:
                        node[key] = copy.deepcopy(config[key])
            result.append(item)
        return result

    def library(self):
        items = self.all_descriptors()
        known = {item["id"] for item in items}
        for repo in self.repositories():
            for descriptor in repo["manifest"].get("plugins", []):
                key = f"community:{repo['id']}:{descriptor['id']}"
                if key in known:
                    continue
                item = dict(
                    descriptor,
                    id=key,
                    local_id=descriptor["id"],
                    repo_id=repo["id"],
                    repo_url=repo["url"],
                    commit=repo["manifest"].get("commit"),
                    origin="community",
                )
                items.append(item)
        installed = {item["id"] for item in self.installed()}
        status = tools.status()
        return [
            dict(
                item,
                installed=item["id"] in installed,
                progress=copy.deepcopy(self.progress.get(item["id"])),
                tool_status=[
                    {"id": tool, **status[tool]}
                    for tool in item.get("tools", [])
                    if tool in status
                ],
            )
            for item in items
        ]

    def uninstall(self, pid):
        if pid not in {d["id"] for d in self.all_descriptors()}:
            raise DomainError("validation.655dc4df51")
        if (self.progress.get(pid) or {}).get("state") == "installing":
            raise AppError("plugin_installing", 409)
        settings = self.state(reveal_secrets=True).get(pid, {}).get("settings", {})
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO plugin_state VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET installed=excluded.installed",
                (
                    pid,
                    0,
                    json.dumps(
                        self.secrets.seal(settings, self.secret_fields(pid, settings))
                    ),
                ),
            )
        if pid in self.native:
            with self.connect() as conn:
                conn.execute("DELETE FROM native_installed WHERE id=?", (pid,))
            module = self.builtins.pop(pid, None)
            if module:
                sys.modules.pop(module.__name__, None)
            shutil.rmtree(self.native_root / pid, ignore_errors=True)
        self.progress.pop(pid, None)
        self.prune_tools()
        return {"removed": True}

    def data_catalogue(self):
        enabled = {p["id"]: p for p in self.installed()}
        return [
            {**item, **enabled.get(item["id"], {})}
            for item in self.all_descriptors()
            if item.get("nodes")
        ]

    def node_descriptors(self, installed_only=True):
        return [
            node
            for plugin in (
                self.installed() if installed_only else self.all_descriptors()
            )
            for node in plugin.get("nodes", [])
        ]

    def node_defaults(self):
        return {
            node["type"]: copy.deepcopy(node.get("defaults", {}))
            for node in self.node_descriptors(False)
        }

    def display_defaults(self, legacy=None):
        legacy = legacy or {}
        states = self.state()
        out = {}
        for item in self.installed():
            for node in item.get("nodes", []):
                defaults = node.get("display_defaults", {})
                configured = (
                    states.get(item["id"], {})
                    .get("settings", {})
                    .get("nodes", {})
                    .get(node["type"], {})
                    .get("display_defaults")
                )
                out[node["type"]] = {
                    **defaults,
                    **(
                        legacy.get(node["type"], {})
                        if configured is None
                        else configured
                    ),
                }
        return out

    def configure(self, pid, settings):
        if pid not in {d["id"] for d in self.installed()}:
            raise DomainError("validation.bb9a7b287a")
        if not isinstance(settings, dict) or len(json.dumps(settings)) > 64000:
            raise DomainError("validation.436f7cd098")
        previous = self.state(reveal_secrets=True).get(pid, {}).get("settings", {})
        settings = self.secrets.preserve_masks(settings, previous)
        descriptor = next((item for item in self.installed() if item["id"] == pid))
        if not isinstance(settings.get("nodes", {}), dict):
            raise DomainError("validation.b7061dfdee")
        for node in descriptor.get("nodes", []):
            config = settings.get("nodes", {}).get(node["type"], {})
            if (
                not isinstance(config, dict)
                or not isinstance(config.get("display_defaults", {}), dict)
                or any(
                    (
                        not isinstance(v, bool)
                        for v in config.get("display_defaults", {}).values()
                    )
                )
            ):
                raise DomainError("validation.9b01c3794f")
            for key in ("map_preview_sources", "map_action_sources"):
                if key not in config:
                    continue
                sources = config[key]
                allowed = {s["id"] for s in node.get(key, [])}
                if (
                    not isinstance(sources, list)
                    or len(sources) != len(allowed)
                    or any(
                        (
                            not isinstance(s, dict)
                            or s.get("id") not in allowed
                            or (not isinstance(s.get("enabled"), bool))
                            for s in sources
                        )
                    )
                    or (len({s["id"] for s in sources}) != len(sources))
                ):
                    raise DomainError("validation.3e7f20da25")
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO plugin_state VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings",
                (
                    pid,
                    1,
                    json.dumps(
                        self.secrets.seal(settings, self.secret_fields(pid, settings))
                    ),
                ),
            )
        return {"saved": True}

    @staticmethod
    def repo_url(url):
        parsed = urllib.parse.urlparse(url.strip().removesuffix(".git").rstrip("/"))
        parts = parsed.path.strip("/").split("/")
        if (
            parsed.scheme != "https"
            or parsed.netloc != "github.com"
            or parsed.query
            or parsed.fragment
            or (len(parts) != 2)
            or any(
                (
                    not re.fullmatch("[A-Za-z0-9_.-]+", p) or p in (".", "..")
                    for p in parts
                )
            )
        ):
            raise DomainError("validation.3dd722bb1c")
        return "https://github.com/" + "/".join(parts)

    @staticmethod
    def fetch(url, limit=1024 * 1024):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": user_agent("plugin manager"),
                "Accept": "application/json",
            },
        )
        if urllib.parse.urlparse(url).hostname not in (
            "api.github.com",
            "raw.githubusercontent.com",
        ):
            raise DomainError("validation.ddfd60a0ed")

        class NoRedirect(urllib.request.HTTPRedirectHandler):

            def redirect_request(self, *args):
                return None

        with urllib.request.build_opener(NoRedirect()).open(
            req, timeout=12
        ) as response:
            data = response.read(limit + 1)
        if len(data) > limit:
            raise DomainError("validation.847357e264")
        return data

    def refresh_repo(self, rid):
        repo = next((r for r in self.repositories() if r["id"] == rid), None)
        if not repo:
            raise DomainError("validation.75b8f2cffa")
        path = repo["url"].removeprefix("https://github.com/")
        try:
            info = json.loads(self.fetch("https://api.github.com/repos/" + path))
            commit = json.loads(
                self.fetch(
                    "https://api.github.com/repos/"
                    + path
                    + "/commits/"
                    + urllib.parse.quote(info["default_branch"], safe="")
                )
            )["sha"]
            if not re.fullmatch("[a-f0-9]{40}", commit):
                raise DomainError("validation.efeb51329b")
            manifest = json.loads(
                self.fetch(
                    f"https://raw.githubusercontent.com/{path}/{commit}/argus-repository.json"
                )
            )
            if (
                not isinstance(manifest, dict)
                or manifest.get("schema_version") != 1
                or not isinstance(manifest.get("plugins"), list)
                or len(manifest["plugins"]) > 100
            ):
                raise DomainError("validation.4a1fd1001a")
            seen = set()
            for item in manifest["plugins"]:
                if (
                    not isinstance(item, dict)
                    or not re.fullmatch("[a-z][a-z0-9_-]{0,63}", item.get("id", ""))
                    or item["id"] in seen
                ):
                    raise DomainError("validation.4b02988d2e")
                seen.add(item["id"])
                self.validate_descriptor(item)
                requested = item.get("tools", [])
                if not isinstance(requested, list) or any(
                    tool not in tools.RECIPES for tool in requested
                ):
                    raise DomainError("validation.4b02988d2e")
                if not item.get("actions"):
                    continue
                module = Path(item.get("module", ""))
                if (
                    module.is_absolute()
                    or ".." in module.parts
                    or module.suffix != ".py"
                ):
                    raise DomainError("validation.62e9abc3ee")
                if not re.fullmatch("[a-f0-9]{64}", item.get("sha256", "")):
                    raise DomainError("validation.ee22e2cd86")
            manifest["commit"] = commit
            error = None
        except (OSError, ValueError, KeyError, TypeError) as exc:
            manifest = repo["manifest"]
            error = str(exc)
        with self.connect() as conn:
            conn.execute(
                "UPDATE community_repos SET manifest=?,error=? WHERE id=?",
                (json.dumps(manifest), error, rid),
            )
        return next((r for r in self.repositories() if r["id"] == rid))

    validate_descriptor = staticmethod(validate_descriptor)

    def add_repo(self, url):
        url = self.repo_url(url)
        with self.connect() as conn:
            row = conn.execute(
                "SELECT id FROM community_repos WHERE url=?", (url,)
            ).fetchone()
            rid = row[0] if row else uuid4().hex
            conn.execute(
                "INSERT OR IGNORE INTO community_repos VALUES (?,?,?,NULL)",
                (rid, url, '{"plugins":[]}'),
            )
        return self.refresh_repo(rid)

    def remove_repo(self, rid):
        with self.connect() as conn:
            conn.execute("DELETE FROM community_repos WHERE id=?", (rid,))
        return {"removed": True}

    def install(self, pid):
        """Start installing in the background; poll library() for progress."""
        item = next((x for x in self.library() if x["id"] == pid), None)
        if not item:
            raise DomainError("validation.09967d95a5")
        owned = {
            node["type"]: descriptor["id"]
            for descriptor in self.all_descriptors()
            for node in descriptor.get("nodes", [])
        }
        for node in item.get("nodes", []):
            if node["type"] in owned and owned[node["type"]] != pid:
                raise DomainError("validation.4f93ab50cc")
        if pid not in self.native and not item.get("tools"):
            # Plugins without tools are a few small files: install inline.
            self.install_now(pid)
            return {"installing": False}
        # Native plugins may download large tools; poll library() for progress.
        self.start_install(pid)
        return {"installing": True}

    def start_install(self, pid, wait=False):
        current = self.progress.get(pid)
        if current and current.get("state") == "installing" and not wait:
            return
        self.progress[pid] = {"state": "installing", "step": "queued", "log": []}
        if wait:
            self.install_job(pid)
        else:
            threading.Thread(target=self.install_job, args=(pid,), daemon=True).start()

    def install_now(self, pid, with_tools=True):
        """Synchronous install for maintenance and tests."""
        self.progress[pid] = {"state": "installing", "step": "queued", "log": []}
        self.install_job(pid, with_tools=with_tools, raise_errors=True)

    def install_job(self, pid, with_tools=True, raise_errors=False):
        state = self.progress[pid]

        def log(line):
            state["log"] = (state["log"] + [str(line)[:500]])[-200:]

        try:
            with self.install_queue:
                if pid in self.native:
                    self.install_native(pid, log, with_tools=with_tools)
                elif not any(d["id"] == pid for d in self.data_descriptors):
                    # Data plugins ship with ARGUS; only their state changes.
                    self.install_community(pid, log, with_tools=with_tools)
                self.mark_installed(pid)
            self.progress.pop(pid, None)
            LOG.info(json.dumps({"event": "plugin_installed", "plugin": pid}))
        except Exception as error:
            code = getattr(error, "code", None) or type(error).__name__
            state.update(state="failed", step="failed", error=code)
            LOG.warning(
                json.dumps(
                    {"event": "plugin_install_failed", "plugin": pid, "error": code}
                )
            )
            if raise_errors:
                raise

    def mark_installed(self, pid):
        settings = self.state(reveal_secrets=True).get(pid, {}).get("settings", {})
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO plugin_state VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET installed=1",
                (
                    pid,
                    1,
                    json.dumps(
                        self.secrets.seal(settings, self.secret_fields(pid, settings))
                    ),
                ),
            )

    def install_community(self, pid, log, with_tools=True):
        item = next((x for x in self.library() if x["id"] == pid), None)
        if not item or item.get("origin") != "community":
            raise DomainError("validation.09967d95a5")
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT source_path FROM community_installed WHERE id=?", (pid,)
            ).fetchone()
        if not existing and not item.get("actions"):
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO community_installed VALUES (?,?,?,?,?)",
                    (pid, json.dumps(item), "", "", item["repo_id"]),
                )
        elif not existing:
            self.set_progress(pid, "download", item["module"])
            path = item["repo_url"].removeprefix("https://github.com/")
            source = self.fetch(
                f"https://raw.githubusercontent.com/{path}/{item['commit']}/"
                + urllib.parse.quote(item["module"], safe="/"),
                512 * 1024,
            )
            if hashlib.sha256(source).hexdigest() != item["sha256"]:
                raise DomainError("validation.79bd815e89")
            compile(source.decode("utf-8"), item["module"], "exec")
            target = self.sources / (uuid4().hex + ".py")
            target.write_bytes(source)
            with self.connect() as conn:
                conn.execute(
                    "INSERT INTO community_installed VALUES (?,?,?,?,?)",
                    (
                        pid,
                        json.dumps(
                            {
                                k: v
                                for k, v in item.items()
                                if k not in ("progress", "tool_status", "installed")
                            }
                        ),
                        str(target),
                        item["sha256"],
                        item["repo_id"],
                    ),
                )
        if with_tools and item.get("tools"):
            for tool in item["tools"]:
                self.set_progress(pid, "tool", tools.RECIPES[tool].label)
                tools.install(tool, log)
            self.set_progress(pid, "catalogue")
            catalogues.build()

    def action_params(self, pid, action_id):
        plugin = next(
            (item for item in self.installed(reveal_secrets=True) if item["id"] == pid),
            None,
        )
        if not plugin:
            raise DomainError("validation.bb9a7b287a")
        action = next(
            (item for item in plugin["actions"] if item["id"] == action_id), None
        )
        if not action:
            raise DomainError("validation.b680d5ba95")
        return copy.deepcopy(action.get("default_params", {}))

    def descriptor(self, pid):
        """Descriptor of an installed or catalogued plugin, or None."""
        if pid in self.builtins:
            return self.builtins[pid].PLUGIN
        if pid in self.native:
            return self.native[pid]["descriptor"]
        with self.connect() as conn:
            row = conn.execute(
                "SELECT descriptor FROM community_installed WHERE id=?", (pid,)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def module(self, pid):
        descriptor = next((x for x in self.installed() if x["id"] == pid), None)
        if not descriptor:
            return None
        if pid in self.builtins:
            return self.builtins[pid]
        with self.connect() as conn:
            row = conn.execute(
                "SELECT source_path,sha256 FROM community_installed WHERE id=?", (pid,)
            ).fetchone()
        if not row:
            return None
        source = Path(row[0])
        content = source.read_bytes()
        if hashlib.sha256(content).hexdigest() != row[1]:
            raise DomainError("validation.62511d284c")
        return CommunityPlugin(descriptor, source, content.decode())
