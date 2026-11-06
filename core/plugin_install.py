"""Native plugins: download, checksum verification, tool installation, removal.

Mixed into core.plugin_manager.Manager, which owns the state these methods use.
"""

from core.errors import AppError, DomainError
from core import catalogues, tools
import hashlib
import importlib.util
import json
import logging
from pathlib import Path
import shutil
import sys
import threading
import urllib.parse
import urllib.request
from core.secrets import is_secret

LOG = logging.getLogger("argus.plugins")


class NativeInstalls:
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
