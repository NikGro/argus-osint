"""Bounded Maigret CLI integration; public matches and extracted facts retain sources."""

import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urlparse
from plugins._process import bounded_run
from plugins._research import fact_outputs

PLUGIN = {
    "id": "maigret",
    "name": "Profile suchen - Maigret",
    "description": "Benutzernamen prüfen und öffentliche Profilangaben sammeln.",
    "actions": [
        {
            "id": "search",
            "name": "Profile mit Maigret suchen",
            "inputs": ["username"],
            "external": True,
            "external_notice": "Der Benutzername wird an ausgewählte Websites gesendet. Gleiche Benutzernamen beweisen keine gemeinsame Identität.",
            "default_params": {
                "sites": [],
                "top_sites": 100,
                "request_timeout": 10,
                "run_timeout": 180,
                "max_results": 100,
            },
        }
    ],
}


def parse_results(rows, node, limit):
    if not isinstance(rows, dict):
        raise ValueError("Ungültiges Maigret-JSON.")
    outputs = []
    warnings = []
    for name, row in rows.items():
        if not isinstance(row, dict):
            continue
        url = str(row.get("url_user", ""))
        parsed = urlparse(url)
        status = row.get("status", {})
        state = str(
            status.get("status", "") if isinstance(status, dict) else status
        ).lower()
        if state and state not in ("claimed", "querystatus.claimed"):
            continue
        if parsed.scheme not in ("https", "http") or not parsed.hostname:
            continue
        if sum(o["type"] == "url" for o in outputs) >= limit:
            warnings.append("Trefferlimit erreicht.")
            break
        common = {
            "source_input": node["id"],
            "group": "Maigret · " + name,
            "source": {"tool": "Maigret", "service": name, "url": url, "result": row},
        }
        outputs.append(
            {
                **common,
                "type": "url",
                "label": name + " · Profiladresse",
                "data": {"value": url},
                "relation": "Benutzername gefunden",
            }
        )
        facts = status.get("ids_data", {}) if isinstance(status, dict) else {}
        if not isinstance(facts, dict):
            facts = {}
        for key, value in facts.items():
            if value is None or value == "":
                continue
            outputs.extend(
                fact_outputs(value, str(key), {**common, "relation": "Profilangabe"})
            )
            if len(outputs) >= 950:
                break
        if len(outputs) >= 950:
            break
    return outputs, warnings


def run(action, inputs, params, context):
    if action != "search" or len(inputs) != 1:
        raise ValueError("Maigret benötigt genau einen Benutzernamen.")
    node = inputs[0]
    username = str(node["data"].get("value", ""))
    if (
        not re.fullmatch(r"[\w.@+\-]{1,100}", username)
        or username.startswith("-")
        or username in (".", "..")
    ):
        raise ValueError("Ungültiger Benutzername.")
    sites = params.get("sites", [])
    if (
        not isinstance(sites, list)
        or len(sites) > 50
        or any(
            not isinstance(v, str) or not re.fullmatch(r"[\w .-]{1,100}", v)
            for v in sites
        )
    ):
        raise ValueError("Ungültige Anbieterliste.")
    timeout = int(params.get("run_timeout", 180))
    request = int(params.get("request_timeout", 10))
    top = int(params.get("top_sites", 100))
    limit = int(params.get("max_results", 100))
    if (
        not 10 <= timeout <= 300
        or not 1 <= request <= 30
        or not 1 <= top <= 500
        or not 1 <= limit <= 300
    ):
        raise ValueError("Ungültiges Maigret-Limit.")
    executable = shutil.which("maigret")
    if not executable:
        raise ValueError("Maigret ist nicht installiert.")
    with tempfile.TemporaryDirectory(prefix="argus-maigret-") as directory:
        command = [
            executable,
            username,
            "--json",
            "simple",
            "--folderoutput",
            directory,
            "--timeout",
            str(request),
            "--top-sites",
            str(top),
            "--no-recursion",
            "--no-progressbar",
            "--no-autoupdate",
        ]
        if params.get("_profile_mode"):
            at = command.index("--top-sites")
            del command[at : at + 2]
            if params.get("_profile_top"):
                command += ["--top-sites", str(params["_profile_top"])]
            else:
                command += ["--all-sites"]
            if params.get("_profile_tags"):
                command += ["--tags", ",".join(params["_profile_tags"])]
        if params.get("identity_only"):
            command.append("--no-extracting")
        elif params.get("deep"):
            command.append("--enrich")
        for site in sites:
            command.extend(["--site", site])
        stdout, stderr = bounded_run(command, timeout)
        reports = list(Path(directory).glob("*.json"))
        if len(reports) != 1 or reports[0].stat().st_size > 8 * 1024 * 1024:
            raise ValueError("Maigret lieferte keinen eindeutigen JSON-Bericht.")
        rows = json.loads(reports[0].read_text())
    outputs, warnings = parse_results(rows, node, limit)
    if params.get("identity_only"):
        from plugins._profile import make_profile

        outputs = [
            make_profile(
                str(name),
                row.get("url_user", ""),
                username,
                node,
                "Maigret",
                "username",
            )
            for name, row in rows.items()
            if isinstance(row, dict)
            and str((row.get("status") or {}).get("status", "")).lower()
            in ("claimed", "querystatus.claimed")
        ][:limit]
    if stderr.strip():
        warnings.append(stderr[-4000:])
    return {
        "outputs": outputs,
        "warnings": warnings,
        "log": stdout[-150000:] + ("\n" + stderr if stderr else ""),
    }


PLUGIN["hidden"] = True
