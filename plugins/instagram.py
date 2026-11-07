"""Instagram enrichment: section-specific collection and native nested output groups."""

import json
import hashlib
import subprocess
from core.errors import AppError
from core.secrets import SecretStore
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
from plugins._process import bounded_run
from plugins._browser import browser_command
from core import tools
from core.provider_registry import identity
from plugins._helpers import helper

SECTIONS = {
    "profile": True,
    "contacts": True,
    "recovery": True,
    "followers": True,
    "following": True,
    "posts": False,
    "highlights": False,
    "stories": True,
}
LIMITS = {
    "followers": 100,
    "following": 100,
    "posts": 20,
    "comments": 20,
    "highlights": 10,
    "highlight_items": 20,
    "stories": 20,
}
DEFAULTS = {
    **{"include_" + key: value for key, value in SECTIONS.items()},
    **{key + "_limit": value for key, value in LIMITS.items()},
    "request_timeout": 15,
    "browser_enabled": True,
    "browser_timeout": 60,
    "use_toutatis": True,
    "sessionid": "",
    "login_username": "",
    "login_password": "",
}
PLUGIN = {
    "id": "instagram",
    "tools": ["instagram", "flaresolverr"],
    "name": "Instagram Deep Research",
    "category": "Research",
    "icon": "instagram",
    "connection_action": {"id": "login", "label": "Log in to Instagram"},
    "auth_fields": [["login_username", "login_password"], ["sessionid"]],
    "description": "Retrieve Instagram profiles, contacts, account lists, posts and stories.",
    "actions": [
        {
            "id": "lookup",
            "name": "Instagram Deep Research",
            "inputs": ["profile"],
            "providers": ["instagram"],
            "max_inputs": 1,
            "external": True,
            "external_notice": "Retrieve Instagram data with the permissions of the optional saved session. Media are saved as links; stories are not marked as viewed.",
            "default_params": DEFAULTS,
            "parameter_sections": [
                {
                    "key": key,
                    "label": {
                        "profile": "General profile information",
                        "contacts": "Contact details",
                        "recovery": "Masked account recovery details",
                        "followers": "Followers",
                        "following": "Following",
                        "posts": "Posts",
                        "highlights": "Highlight stories",
                        "stories": "Current stories",
                    }[key],
                    "toggle": "include_" + key,
                    "limits": (
                        [key + "_limit"]
                        + (
                            ["comments_limit"]
                            if key == "posts"
                            else (
                                ["highlight_items_limit"] if key == "highlights" else []
                            )
                        )
                        if key in LIMITS
                        else []
                    ),
                }
                for key in SECTIONS
            ],
            "parameter_help": "0 = no item limit. The project limit of 5,000 nodes still applies.",
            "parameter_schema": {
                key: {"label": label}
                for key, label in {
                    "followers_limit": "Followers limit",
                    "following_limit": "Following limit",
                    "posts_limit": "Posts limit",
                    "comments_limit": "Comments per post",
                    "highlights_limit": "Highlights limit",
                    "highlight_items_limit": "Stories per highlight",
                    "stories_limit": "Current stories limit",
                    "request_timeout": "Request timeout (seconds)",
                    "browser_enabled": "Built-in browser fallback",
                    "browser_timeout": "Browser timeout (seconds)",
                    "use_toutatis": "Look up masked recovery details (Toutatis)",
                    "sessionid": "Instagram session ID (optional, plugin settings only)",
                    "login_username": "Instagram login username",
                    "login_password": "Instagram login password",
                }.items()
            },
            "settings_only": [
                "sessionid",
                "login_username",
                "login_password",
                "use_toutatis",
            ],
        }
    ],
}


def target(data):
    if identity(data.get("provider", "")) != "instagram":
        raise ValueError("Connect one Instagram profile.")
    identifier = str(data.get("identifier", "")).strip().lstrip("@")
    url = str(data.get("url", "")).strip()
    username = ""
    user_id = ""
    if url:
        parsed = urlsplit(url)
        parts = [p for p in parsed.path.split("/") if p]
        if (
            parsed.scheme not in ("https", "http")
            or (parsed.hostname or "").lower()
            not in ("instagram.com", "www.instagram.com", "m.instagram.com")
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Invalid Instagram profile URL.")
        if len(parts) == 1 and parts[0].lower() not in (
            "accounts",
            "explore",
            "p",
            "reel",
            "reels",
            "stories",
            "direct",
            "about",
        ):
            username = parts[0]
        elif parsed.path.rstrip("/") == "/web/friendships/show":
            from urllib.parse import parse_qs

            user_id = (parse_qs(parsed.query).get("user_id") or [""])[0]
        else:
            raise ValueError(
                "Use a profile URL rather than a post, login or home page."
            )
    if not username and identifier:
        if identifier.isdecimal():
            user_id = identifier
        else:
            username = identifier
    if username and not re.fullmatch(r"[A-Za-z0-9_.]{1,30}", username):
        raise ValueError("Invalid Instagram username.")
    if user_id and not user_id.isdecimal():
        raise ValueError("Invalid Instagram ID.")
    if not username and not user_id:
        raise ValueError(
            "An Instagram profile requires a username, profile URL or numeric ID."
        )
    return {"username": username, "user_id": user_id}


def run(action, inputs, params, context):
    if action != "lookup" or len(inputs) != 1 or inputs[0]["type"] != "profile":
        raise ValueError("Connect exactly one Instagram profile.")
    settings = {**DEFAULTS, **params}
    lookup = target(inputs[0]["data"])
    if not isinstance(settings["browser_enabled"], bool) or not isinstance(
        settings["use_toutatis"], bool
    ):
        raise ValueError("Browser must be enabled or disabled.")
    for key in SECTIONS:
        if not isinstance(settings["include_" + key], bool):
            raise ValueError("Sections must be enabled or disabled.")
    for key in LIMITS:
        value = settings[key + "_limit"]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or value < 0
            or int(value) != value
        ):
            raise ValueError("Limits must be whole numbers of 0 or more.")
        settings[key + "_limit"] = int(value)
    for key, low, high in [
        ("request_timeout", 2, 30),
        ("browser_timeout", 10, 120),
    ]:
        value = settings[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or int(value) != value
            or not low <= value <= high
        ):
            raise ValueError("Invalid timeout: " + key)
    if not any(settings["include_" + key] for key in SECTIONS):
        raise ValueError("Enable at least one research section.")
    # Keep the session only in plugin settings/stdin, never output provenance or logs.
    if not isinstance(settings["sessionid"], str) or len(settings["sessionid"]) > 4096:
        raise ValueError("Invalid Instagram session.")
    remaining = max(0, 5000 - int(context.get("node_count", 0)) - 1)
    if remaining < 5:
        raise ValueError("Project limit reached. Use a new project.")
    result = collect(lookup, settings, context, remaining)
    return finish_result(result, inputs, settings)


def collect(lookup, settings, context, remaining=4999, auth_only=False):
    if bool(settings.get("login_username")) != bool(settings.get("login_password")):
        raise ValueError("Enter both username and password to sign in.")
    if any(
        not isinstance(settings.get(key, ""), str) or len(settings.get(key, "")) > 4096
        for key in ("login_username", "login_password", "sessionid")
    ):
        raise ValueError("Invalid Instagram credentials.")
    credentials = Path(
        context.get("credential_dir") or Path("/tmp/argus-instagram-sessions")
    )
    credentials.mkdir(parents=True, exist_ok=True)
    store = SecretStore(credentials.parent)
    fingerprint = hashlib.sha256(
        json.dumps(
            [
                settings.get("login_username", ""),
                settings.get("login_password", ""),
                settings.get("sessionid", ""),
            ]
        ).encode()
    ).hexdigest()
    cache = credentials / ("instagram-" + fingerprint + ".session")
    settings = dict(settings)
    if cache.exists():
        settings["saved_session"] = json.loads(store.decrypt_text(cache.read_text()))
    with tempfile.TemporaryDirectory(prefix="argus-instagram-") as folder:
        checkpoint = Path(folder) / "progress.json"
        payload = {
            **lookup,
            "settings": settings,
            "checkpoint": str(checkpoint),
            "node_budget": remaining,
            "auth_only": auth_only,
            "transient": context.get("transient", {}),
            "session_output": str(Path(folder) / "session.json"),
            "browser": browser_command(),
        }
        try:
            stdout, _ = bounded_run(
                [
                    tools.python("instagram"),
                    "-I",
                    helper("_instagram_runner.py"),
                ],
                None,
                payload,
                max_bytes=12 * 1024 * 1024,
            )
            result = json.loads(stdout)
        except AppError:
            raise
        except (OSError, ValueError, subprocess.SubprocessError):
            if checkpoint.exists():
                result = json.loads(checkpoint.read_text())
                result.setdefault("warnings", []).append(
                    "Time or process limit reached; results so far are kept."
                )
            else:
                result = {
                    "outputs": [],
                    "warnings": [
                        "Instagram retrieval could not complete. Check the session and time limits in plugin settings."
                    ],
                }
        session = Path(folder) / "session.json"
        if session.exists():
            sealed = store.encrypt_text(session.read_text())
            temporary = cache.with_suffix(".tmp")
            temporary.write_text(sealed)
            temporary.chmod(0o600)
            temporary.replace(cache)
    return result


def connect(action, params, context):
    if action != "login":
        raise ValueError("Connection action unavailable.")
    settings = {**DEFAULTS, **params}
    if not (
        settings.get("sessionid")
        or settings.get("login_username")
        and settings.get("login_password")
    ):
        raise ValueError("Add Instagram credentials in the plugin settings first.")
    return collect({"username": "", "user_id": ""}, settings, context, auth_only=True)


def finish_result(result, inputs, settings):
    if result.get("input_request"):
        return {**result, "outputs": [], "group_outputs": False}
    for output in result.get("outputs", []):
        output["source_input"] = inputs[0]["id"]
    if not result.get("outputs"):
        message = (
            "; ".join(result.get("warnings", []))
            or "No accessible data in the selected sections."
        )
        result["outputs"] = [
            {
                "type": "error",
                "label": "Instagram collection",
                "data": {
                    "title": "No Instagram data available",
                    "message": message,
                },
                "relation": "Research information",
                "source_input": inputs[0]["id"],
                "source": {"tool": "Argus Instagram"},
            }
        ]
        result["failed"] = True
        result["error"] = message
    if result.get("outputs") and all(
        o.get("type") == "error" for o in result["outputs"]
    ):
        result["failed"] = True
        result["error"] = (
            "; ".join(result.get("warnings", [])) or "No Instagram data available."
        )
    result["group_outputs"] = True
    result["log"] = json.dumps(
        {
            "tool": "Argus Instagram / instagrapi",
            "sections": {key: settings["include_" + key] for key in SECTIONS},
            "limits": {key: settings[key + "_limit"] for key in LIMITS},
            "outputs": len(result["outputs"]),
            "authenticated": bool(
                settings.get("sessionid")
                or settings.get("login_username")
                and settings.get("login_password")
            ),
            "warnings": result.get("warnings", []),
        },
        ensure_ascii=False,
    )
    return result
