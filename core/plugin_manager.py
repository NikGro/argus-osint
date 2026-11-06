"""Plugin catalogue, on-demand installation of native and community plugins.

ARGUS ships without installed plugins. Native plugins come from the official
catalogue (plugins/native.json): installing one downloads its files from the
ARGUS repository at the image's source revision, accepts them only when every
SHA-256 matches the catalogue, and installs the research tools it needs into
the data volume. Uninstalling removes the files and any tool that no other
installed plugin still needs. Settings survive uninstalling.
"""

from core.errors import DomainError
from core.build_info import VERSION
from core import tools
import copy
import hashlib
import json
import logging
import os
from pathlib import Path
import threading
from core.database import connect as database_connect
from core.secrets import SecretStore, redact, is_secret
from core.plugin_contract import validate_descriptor
from core.community_plugin import CommunityPlugin
from core.community_repos import CommunityRepositories
from core.plugin_install import NativeInstalls
from core.plugin_state_migrations import migrate_plugin_state

CATALOGUE = Path(__file__).resolve().parents[1] / "plugins" / "native.json"
LOG = logging.getLogger("argus.plugins")


def load_catalogue():
    return json.loads(CATALOGUE.read_text(encoding="utf-8"))


class Manager(NativeInstalls, CommunityRepositories):

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
            migrate_plugin_state(self, conn)

        if builtins is None:
            self.load_installed()

    def connect(self):
        return database_connect(self.db)

    # -- native plugins: loading, installing, removing ----------------------

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

    validate_descriptor = staticmethod(validate_descriptor)

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
