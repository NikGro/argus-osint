"""One-time upgrades of stored plugin settings from earlier ARGUS versions."""

import json


def migrate_plugin_state(manager, conn):
    """Seal plaintext secrets and carry settings of merged plugins forward."""
    previous = {
        row[0]: json.loads(row[1])
        for row in conn.execute("SELECT id,settings FROM plugin_state")
    }
    for pid, value in previous.items():
        encrypted = manager.secrets.seal(value, manager.secret_fields(pid, value))
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
        if pid not in manager.native:
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
        descriptor = manager.native[pid]["descriptor"]["actions"][0]["default_params"]
        for key in descriptor:
            if key.startswith("use_"):
                defaults[key] = key == "use_consensus"
        settings["consensus_only_defaults_v1"] = True
        conn.execute(
            "UPDATE plugin_state SET settings=? WHERE id=?",
            (json.dumps(settings), pid),
        )
