"""Persistent plugin catalogue and explicit community installs, independent of projects."""

from core.errors import DomainError
from core.build_info import user_agent
import copy
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
from uuid import uuid4
from core.database import connect as database_connect
from core.secrets import SecretStore, redact, is_secret
from core.plugin_contract import validate_descriptor
from core.community_plugin import CommunityPlugin


class Manager:

    def __init__(self, db, data, builtins):
        self.db, self.data, self.builtins = (db, data, builtins)
        for module in builtins.values():
            for action in module.PLUGIN.get("actions", []):
                schema = action.setdefault("parameter_schema", {})
                for key in action.get("default_params", {}):
                    schema.setdefault(key, {"secret": is_secret(key)})
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
        self.builtin_locales = {}
        for pid in builtins:
            file = Path(__file__).parents[1] / "plugins" / "locales" / (pid + ".json")
            if file.exists():
                self.builtin_locales[pid] = json.loads(file.read_text(encoding="utf-8"))
        self.sources = data / "community-plugins"
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
                if pid not in builtins:
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
                descriptor = builtins[pid].PLUGIN["actions"][0]["default_params"]
                for key in descriptor:
                    if key.startswith("use_"):
                        defaults[key] = key == "use_consensus"
                settings["consensus_only_defaults_v1"] = True
                conn.execute(
                    "UPDATE plugin_state SET settings=? WHERE id=?",
                    (json.dumps(settings), pid),
                )

    def connect(self):
        return database_connect(self.db)

    def secret_fields(self, pid, settings=None):
        if pid in self.builtins:
            descriptor = self.builtins[pid].PLUGIN
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
                    "secret", pid not in self.builtins and isinstance(value, str)
                ) or is_secret(key):
                    fields.add(key)
            fields.update(
                (
                    key
                    for key, config in schema.items()
                    if config.get("secret", pid not in self.builtins)
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
        items = [
            dict(copy.deepcopy(m.PLUGIN), origin="builtin", version="bundled")
            for m in self.builtins.values()
            if not m.PLUGIN.get("hidden")
        ]
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
            if not state["installed"]:
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
        return [dict(item, installed=item["id"] in installed) for item in items]

    def uninstall(self, pid):
        if pid not in {d["id"] for d in self.all_descriptors()}:
            raise DomainError("validation.655dc4df51")
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
        if item.get("origin") == "community":
            with self.connect() as conn:
                existing = conn.execute(
                    "SELECT source_path FROM community_installed WHERE id=?", (pid,)
                ).fetchone()
            if not existing and (not item.get("actions")):
                with self.connect() as conn:
                    conn.execute(
                        "INSERT INTO community_installed VALUES (?,?,?,?,?)",
                        (pid, json.dumps(item), "", "", item["repo_id"]),
                    )
            elif not existing:
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
                            json.dumps(item),
                            str(target),
                            item["sha256"],
                            item["repo_id"],
                        ),
                    )
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
        return {"installed": True}

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
