import json
from pathlib import Path
import re
import sys
from plugins._process import bounded_run
from plugins._research import fact_outputs

PLUGIN = {
    "id": "holehe",
    "name": "Check E-Mail - Holehe",
    "description": "E-Mail-Adressen auf Registrierung bei unterstützten Anbietern prüfen.",
    "actions": [
        {
            "id": "lookup",
            "name": "E-Mail mit Holehe prüfen",
            "inputs": ["email"],
            "external": True,
            "external_notice": "Die E-Mail-Adresse wird an die ausgewählten Anbieter gesendet.",
            "default_params": {"sites": [], "request_timeout": 12, "run_timeout": 300},
        }
    ],
}


def results(rows, node, identity_only=False):
    outputs = []
    warnings = []
    for row in rows:
        name = str(row.get("name", "Anbieter"))
        group = "Holehe · " + name
        if row.get("rateLimit") or row.get("error") or row.get("exists") is None:
            warnings.append(
                name + ": " + str(row.get("error") or "Nicht eindeutig / Rate-Limit")
            )
            continue
        if row.get("exists") is not True:
            continue
        if identity_only:
            from plugins._profile import make_profile

            outputs.append(
                make_profile(
                    name, "", node["data"].get("value", ""), node, "Holehe", "email"
                )
            )
            continue
        common = {
            "group": group,
            "source_input": node["id"],
            "source": {"tool": "Holehe", "service": name, "result": row},
        }
        outputs.append(
            {
                **common,
                "type": "value",
                "label": "Konto besteht?",
                "fact_key": "registration",
                "data": {"value": "Ja"},
                "relation": "Registrierungsbefund",
            }
        )
        domain = str(row.get("domain") or "")
        if re.fullmatch(r"[A-Za-z0-9.-]+\.[A-Za-z]{2,}", domain):
            outputs.append(
                {
                    **common,
                    "type": "url",
                    "label": name + " · Anbieter",
                    "data": {"value": "https://" + domain},
                    "relation": "Anbieter",
                }
            )
        for key in ("emailrecovery", "phoneNumber", "others"):
            value = row.get(key)
            if value is None or value == "":
                continue
            values = value.items() if isinstance(value, dict) else [(key, value)]
            for label, item in values:
                outputs.extend(
                    fact_outputs(
                        item, str(label), {**common, "relation": "Zusatzangabe"}
                    )
                )
    protocol = "\n".join(
        str(row.get("name", ""))
        + ": "
        + (
            "Rate-Limit"
            if row.get("rateLimit")
            else str(row.get("error") or row.get("exists"))
        )
        for row in rows
    )
    outputs.append(
        {
            "type": "value",
            "label": "Holehe · Suchprotokoll",
            "data": {"value": protocol},
            "source_input": node["id"],
            "source": {"tool": "Holehe", "rows": rows},
            "relation": "Suchprotokoll",
        }
    )
    return {"outputs": outputs, "warnings": warnings, "log": protocol}


def run(action, inputs, params, context):
    if action != "lookup" or len(inputs) != 1:
        raise ValueError("Holehe benötigt genau eine E-Mail als Eingabe.")
    node = inputs[0]
    email = str(node["data"].get("value", "")).strip()
    if (
        not re.fullmatch(r"[^\s@]{1,128}@[^\s@.]+(?:\.[^\s@.]+)+", email)
        or len(email) > 254
    ):
        raise ValueError("Ungültige E-Mail-Adresse.")
    sites = params.get("sites", [])
    if (
        not isinstance(sites, list)
        or len(sites) > 150
        or any(
            not isinstance(s, str) or not re.fullmatch(r"[A-Za-z0-9_]+", s)
            for s in sites
        )
    ):
        raise ValueError("Ungültige Holehe-Anbieterliste.")
    timeout = int(params.get("run_timeout", 300))
    request_timeout = int(params.get("request_timeout", 12))
    if not 5 <= timeout <= 300 or not 2 <= request_timeout <= 30:
        raise ValueError("Ungültiges Suchzeitlimit.")
    output, _ = bounded_run(
        [sys.executable, "-I", str(Path(__file__).with_name("_holehe_runner.py"))],
        timeout,
        {"email": email, "sites": sites, "request_timeout": request_timeout},
    )
    payload = json.loads(output)
    if not isinstance(payload.get("rows"), list):
        raise ValueError("Ungültiges Holehe-Ergebnis.")
    return results(payload["rows"], node, bool(params.get("identity_only")))


PLUGIN["hidden"] = True
