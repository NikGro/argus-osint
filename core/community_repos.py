"""Community plugin repositories: pinned manifests and explicit installation.

Mixed into core.plugin_manager.Manager. Community code is not reviewed by
ARGUS and runs unsandboxed; the UI asks for confirmation before installing.
"""

from core.errors import DomainError
from core.build_info import user_agent
from core import catalogues, tools
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
from uuid import uuid4


class CommunityRepositories:
    def repositories(self):
        with self.connect() as conn:
            return [
                {"id": r[0], "url": r[1], "manifest": json.loads(r[2]), "error": r[3]}
                for r in conn.execute(
                    "SELECT id,url,manifest,error FROM community_repos"
                )
            ]

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
