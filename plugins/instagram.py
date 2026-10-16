"""Instagram enrichment: section-specific collection and native nested output groups."""

import json
import hashlib
from core.secrets import SecretStore
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
from plugins._process import bounded_run
from provider_registry import identity

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
    "run_timeout": 300,
    "browser_enabled": True,
    "browser_timeout": 60,
    "use_toutatis": True,
    "sessionid": "",
    "login_username": "",
    "login_password": "",
}
PLUGIN = {
    "id": "instagram",
    "name": "Instagram Deep Research",
    "category": "Recherche",
    "icon": "instagram",
    "connection_action": {"id": "login", "label": "Bei Instagram anmelden"},
    "auth_fields": [["login_username", "login_password"], ["sessionid"]],
    "description": "Instagram-Profile gezielt auslesen: Profil, Kontakte, Kontenlisten, Beiträge und Stories.",
    "actions": [
        {
            "id": "lookup",
            "name": "Instagram Deep Research",
            "inputs": ["profile"],
            "providers": ["instagram"],
            "max_inputs": 1,
            "external": True,
            "external_notice": "Abruf bei Instagram mit den Rechten der optional hinterlegten Sitzung. Medien werden als Links gespeichert; Stories werden nicht als gesehen markiert.",
            "default_params": DEFAULTS,
            "parameter_sections": [
                {
                    "key": key,
                    "label": {
                        "profile": "Allgemeine Profilinfos",
                        "contacts": "Kontaktdaten",
                        "recovery": "Maskierte Wiederherstellungsangaben",
                        "followers": "Follower",
                        "following": "Gefolgte Konten",
                        "posts": "Beiträge",
                        "highlights": "Highlight-Stories",
                        "stories": "Aktuelle Stories",
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
            "parameter_help": "0 = kein Mengenlimit. Zeitlimit und Projektlimit von 5.000 Nodes bleiben aktiv.",
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
        raise ValueError("Ein Instagram-Profil anschließen.")
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
            raise ValueError("Keine gültige Instagram-Profil-URL.")
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
                "Eine Profil-URL verwenden, keine Beitrags-, Login- oder Startseite."
            )
    if not username and identifier:
        if identifier.isdecimal():
            user_id = identifier
        else:
            username = identifier
    if username and not re.fullmatch(r"[A-Za-z0-9_.]{1,30}", username):
        raise ValueError("Ungültiger Instagram-Benutzername.")
    if user_id and not user_id.isdecimal():
        raise ValueError("Ungültige Instagram-ID.")
    if not username and not user_id:
        raise ValueError(
            "Instagram-Profil benötigt Benutzername, Profil-URL oder numerische ID."
        )
    return {"username": username, "user_id": user_id}


def run(action, inputs, params, context):
    if action != "lookup" or len(inputs) != 1 or inputs[0]["type"] != "profile":
        raise ValueError("Genau ein Instagram-Profil anschließen.")
    settings = {**DEFAULTS, **params}
    lookup = target(inputs[0]["data"])
    if not isinstance(settings["browser_enabled"], bool) or not isinstance(
        settings["use_toutatis"], bool
    ):
        raise ValueError("Browser muss ein- oder ausgeschaltet sein.")
    for key in SECTIONS:
        if not isinstance(settings["include_" + key], bool):
            raise ValueError("Bereiche müssen ein- oder ausgeschaltet sein.")
    for key in LIMITS:
        value = settings[key + "_limit"]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or value < 0
            or int(value) != value
        ):
            raise ValueError("Limits müssen ganze Zahlen ab 0 sein.")
        settings[key + "_limit"] = int(value)
    for key, low, high in [
        ("request_timeout", 2, 30),
        ("run_timeout", 30, 1800),
        ("browser_timeout", 10, 120),
    ]:
        value = settings[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or int(value) != value
            or not low <= value <= high
        ):
            raise ValueError("Ungültiges Zeitlimit: " + key)
    if not any(settings["include_" + key] for key in SECTIONS):
        raise ValueError("Mindestens einen Recherchebereich aktivieren.")
    # Keep the session only in plugin settings/stdin, never output provenance or logs.
    if not isinstance(settings["sessionid"], str) or len(settings["sessionid"]) > 4096:
        raise ValueError("Ungültige Instagram-Sitzung.")
    remaining = max(0, 5000 - int(context.get("node_count", 0)) - 1)
    if remaining < 5:
        raise ValueError("Projektlimit erreicht. Ein neues Projekt verwenden.")
    result = collect(lookup, settings, context, remaining)
    return finish_result(result, inputs, settings)


def collect(lookup, settings, context, remaining=4999, auth_only=False):
    if bool(settings.get("login_username")) != bool(settings.get("login_password")):
        raise ValueError("Für den Login Benutzername und Passwort zusammen eingeben.")
    if any(
        not isinstance(settings.get(key, ""), str) or len(settings.get(key, "")) > 4096
        for key in ("login_username", "login_password", "sessionid")
    ):
        raise ValueError("Ungültige Instagram-Zugangsdaten.")
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
        }
        try:
            stdout, _ = bounded_run(
                [
                    "/opt/argus-tools/instagram-venv/bin/python",
                    "-I",
                    str(Path(__file__).with_name("_instagram_runner.py")),
                ],
                int(settings["run_timeout"]) + 15,
                payload,
                max_bytes=12 * 1024 * 1024,
            )
            result = json.loads(stdout)
        except Exception:
            if checkpoint.exists():
                result = json.loads(checkpoint.read_text())
                result.setdefault("warnings", []).append(
                    "Zeit- oder Prozesslimit erreicht; bisherige Ergebnisse bleiben erhalten."
                )
            else:
                result = {
                    "outputs": [],
                    "warnings": [
                        "Instagram-Abruf konnte nicht abgeschlossen werden. Sitzung und Zeitlimits in den Plugin-Einstellungen prüfen."
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
        raise ValueError("Verbindungsaktion nicht verfügbar.")
    settings = {**DEFAULTS, **params}
    if not (
        settings.get("sessionid")
        or settings.get("login_username")
        and settings.get("login_password")
    ):
        raise ValueError(
            "Zuerst Instagram-Zugangsdaten in den Plugin-Einstellungen hinterlegen."
        )
    return collect({"username": "", "user_id": ""}, settings, context, auth_only=True)


def finish_result(result, inputs, settings):
    if result.get("input_request"):
        return {**result, "outputs": [], "group_outputs": False}
    for output in result.get("outputs", []):
        output["source_input"] = inputs[0]["id"]
    if not result.get("outputs"):
        message = (
            "; ".join(result.get("warnings", []))
            or "Keine Daten in den gewählten Bereichen zugänglich."
        )
        result["outputs"] = [
            {
                "type": "error",
                "label": "Instagram-Abruf",
                "data": {
                    "title": "Keine Instagram-Daten verfügbar",
                    "message": message,
                },
                "relation": "Recherchehinweis",
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
            "; ".join(result.get("warnings", [])) or "Keine Instagram-Daten verfügbar."
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
