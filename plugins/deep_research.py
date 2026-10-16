"""Explicit provider-scoped enrichment; never rediscover unrelated accounts."""

import copy
import json
from pathlib import Path
import re
import sys
from plugins import _extra_sources as extra, holehe, maigret
from plugins._process import bounded_run
from plugins._profile import provider_key, profile_url, recipes
from plugins._research import deduplicate, fact_outputs
from provider_registry import label as provider_label, services

PLUGIN = {
    "id": "deep_research",
    "name": "Generic Deep Research",
    "category": "Recherche",
    "icon": "argus",
    "description": "Zusatzangaben gezielt zu einem Profil abrufen und als einzelne Daten-Nodes gruppieren.",
    "actions": [
        {
            "id": "lookup",
            "name": "Generic Deep Research",
            "inputs": ["profile"],
            "generic_profile": True,
            "external": True,
            "external_notice": "Die Profilkennung wird nur für den ausgewählten Anbieter an die aktivierten Quellen übergeben.",
            "default_params": {
                "use_argus": True,
                "argus_browser_enabled": True,
                "argus_browser_timeout": 60,
                "use_maigret": True,
                "use_user_scanner": True,
                "use_blackbird": True,
                "use_holehe": True,
                "use_ignorant": True,
                "source_order": [
                    "argus",
                    "user_scanner",
                    "maigret",
                    "blackbird",
                    "holehe",
                    "ignorant",
                ],
                "identifier_kind": "auto",
                "request_timeout": 12,
                "run_timeout": 300,
                "max_results": 500,
            },
        }
    ],
}
TOOLS = {
    "argus": "Argus Web",
    "user_scanner": "User Scanner",
    "maigret": "Maigret",
    "blackbird": "Blackbird",
    "holehe": "Holehe",
    "ignorant": "Ignorant",
}


def as_image(item):
    """Media URLs are image nodes; don't fetch or load them until requested by the user."""
    name = str(item.get("fact_key") or item.get("label", "")).casefold()
    if item.get("type") == "url" and re.search(
        r"avatar|picture|photo|image|pfp|portrait|profilbild|vorschaubild", name
    ):
        url = item["data"]["value"]
        item = {
            **item,
            "type": "image",
            "data": {"filename": item.get("label", "Bild"), "file_id": "", "url": url},
        }
    return item


def run(action, inputs, params, context):
    if action != "lookup" or len(inputs) != 1 or inputs[0]["type"] != "profile":
        raise ValueError("Genau ein Profil anschließen.")
    profile = inputs[0]
    data = profile["data"]
    provider = provider_label(data.get("provider", "")).strip()
    identifier = str(data.get("identifier", "")).strip()
    url = profile_url(data.get("url", ""))
    if not provider or not (identifier or url):
        raise ValueError(
            "Profil benötigt einen Anbieter und mindestens eine gültige Profil-URL oder einen Identifier."
        )
    timeout = int(params.get("run_timeout", 300))
    request = int(params.get("request_timeout", 12))
    limit = int(params.get("max_results", 500))
    if not 10 <= timeout <= 300 or not 2 <= request <= 30 or not 1 <= limit <= 1000:
        raise ValueError("Ungültige Recherchelimits.")
    order = params.get("source_order", list(TOOLS))
    if (
        not isinstance(order, list)
        or any(name not in TOOLS for name in order)
        or len(set(order)) != len(order)
    ):
        raise ValueError("Ungültige Quellenreihenfolge.")
    if any(not isinstance(params.get("use_" + name, True), bool) for name in TOOLS):
        raise ValueError("Quellen müssen ein- oder ausgeschaltet sein.")
    enabled = [
        name
        for name in order + [n for n in TOOLS if n not in order]
        if params.get("use_" + name, True)
    ]
    if not enabled:
        return empty_result(
            profile,
            "Keine Quelle aktiviert",
            "Mindestens eine Deep-Research-Quelle in den Plugin-Einstellungen aktivieren.",
            True,
        )
    saved = recipes(profile)
    outputs = []
    warnings = []
    logs = []
    attempts = 0
    success = 0
    fallback_kind = str(params.get("identifier_kind", "auto"))
    if fallback_kind not in ("auto", "username", "email", "phone", "id"):
        raise ValueError("Identifier-Typ: auto, username, email, phone oder id.")
    if fallback_kind == "auto":
        fallback_kind = (
            saved[0]["kind"]
            if saved
            else (
                "email"
                if "@" in identifier and not identifier.startswith("@")
                else "id" if identifier.isdecimal() else "username"
            )
        )
    if not identifier:
        fallback_kind = "id"
    for tool in enabled:
        recipe = next((r for r in saved if r.get("tool") == TOOLS[tool]), None)
        kind = recipe["kind"] if recipe else fallback_kind
        value = recipe["value"] if recipe else identifier
        targets = services(data.get("provider", ""), tool, kind)
        service = recipe["service"] if recipe else (targets[0] if targets else "")
        if tool not in ("argus", "maigret") and not service:
            continue
        node = {"id": profile["id"], "type": kind, "data": {"value": value}}
        p = {
            **params,
            "identity_only": False,
            "deep": True,
            "run_timeout": timeout,
            "request_timeout": request,
            "max_results": min(limit, 300),
            "service": service,
            "sites": [service],
        }
        try:
            if tool == "argus":
                if not url:
                    continue
                attempts += 1
                browser_timeout = int(params.get("argus_browser_timeout", 60))
                if not 10 <= browser_timeout <= 120:
                    raise ValueError("Browser-Zeitlimit: 10–120 Sekunden.")
                stdout, stderr = bounded_run(
                    [
                        sys.executable,
                        "-I",
                        str(Path(__file__).with_name("_argus_web_runner.py")),
                    ],
                    timeout,
                    {
                        "url": url,
                        "request_timeout": request,
                        "browser_enabled": params.get("argus_browser_enabled", True),
                        "browser_timeout": browser_timeout,
                    },
                )
                payload = json.loads(stdout)
                common = {
                    "source_input": profile["id"],
                    "source": {"tool": "Argus Web", "service": provider, "url": url},
                }
                result = {
                    "outputs": [
                        o
                        for key, value in payload.get("facts", {}).items()
                        for o in fact_outputs(value, str(key), common)
                    ],
                    "warnings": payload.get("warnings", []),
                    "log": stdout,
                }
            elif tool == "maigret":
                if url:
                    attempts += 1
                    stdout, stderr = bounded_run(
                        [
                            sys.executable,
                            "-I",
                            str(Path(__file__).with_name("_profile_extract_runner.py")),
                        ],
                        timeout,
                        {"url": url, "request_timeout": request},
                    )
                    facts = json.loads(stdout)
                    common = {
                        "source_input": profile["id"],
                        "source": {
                            "tool": "Maigret / socid_extractor",
                            "service": provider,
                            "url": url,
                        },
                    }
                    result = {
                        "outputs": [
                            o
                            for key, value in facts.items()
                            if key != "_extractor"
                            for o in fact_outputs(value, str(key), common)
                        ],
                        "log": stdout,
                    }
                elif kind == "username" and value:
                    # Resolve exact site in bundled database before CLI; never accept a broad fallback.
                    import maigret as package
                    from maigret.sites import MaigretDatabase

                    database = MaigretDatabase().load_from_path(
                        str(Path(package.__file__).parent / "resources" / "data.json")
                    )
                    matches = [
                        site.name for site in database.sites if site.name == service
                    ]
                    if not matches and targets:
                        matches = [
                            site.name
                            for site in database.sites
                            if site.name == targets[0]
                        ]
                    if len(matches) != 1:
                        warnings.append(
                            "Maigret: Anbieter nicht eindeutig unterstützt."
                        )
                        continue
                    attempts += 1
                    result = maigret.run(
                        "search", [node], {**p, "sites": matches}, context
                    )
                else:
                    continue
            elif (
                tool in ("user_scanner", "blackbird")
                and kind in ("username", "email")
                and value
            ):
                attempts += 1
                result = getattr(extra, tool)(kind, [node], p, context)
            elif tool == "holehe" and kind == "email" and value:
                attempts += 1
                result = holehe.run("lookup", [node], p, context)
            elif tool == "ignorant" and kind == "phone" and value:
                attempts += 1
                result = extra.ignorant([node], p, context)
            else:
                continue
            success += 1
            warnings.extend(
                TOOLS[tool] + ": " + str(w) for w in result.get("warnings", [])
            )
            logs.append(TOOLS[tool] + "\n" + str(result.get("log", "")))
            for original in result.get("outputs", []):
                if original.get("relation") in (
                    "Suchprotokoll",
                    "Anbieter",
                    "Registrierungsbefund",
                    "Benutzername gefunden",
                    "Profil gefunden",
                ):
                    continue
                item = copy.deepcopy(original)
                source = item.get("source", {})
                if source.get("service") and provider_key(
                    source["service"]
                ) != provider_key(provider):
                    continue
                item = as_image(item)
                item["source_input"] = profile["id"]
                item["group"] = provider
                item["group_id"] = "deep:" + profile["id"]
                item["source"] = {
                    **source,
                    "service": provider,
                    "profile": copy.deepcopy(data),
                }
                outputs.append(item)
        except Exception as exc:
            warnings.append(TOOLS[tool] + ": " + str(exc))
            logs.append(TOOLS[tool] + ": " + str(exc))
    if not attempts:
        return empty_result(
            profile,
            "Keine passende Quelle",
            "Keine aktivierte Quelle unterstützt diese Profilkennung. Identifier-Typ prüfen oder eine öffentliche Profil-URL ergänzen.",
            True,
        )
    if not success:
        return empty_result(
            profile,
            "Profil konnte nicht ausgelesen werden",
            "; ".join(warnings) or "Alle Quellen sind fehlgeschlagen.",
            True,
            logs,
        )
    outputs = deduplicate(outputs)
    for item in outputs:
        item["group"] = provider
        item["group_id"] = "deep:" + profile["id"]
    if len(outputs) > limit:
        warnings.append("Trefferlimit erreicht; vollständiger Abruf in den Logs.")
    if not outputs:
        return empty_result(
            profile,
            "Keine zusätzlichen Daten gefunden",
            "Die ausgewählten Quellen lieferten keine Zusatzangaben. Das bedeutet nicht, dass das Profil nicht existiert."
            + (" Hinweise: " + "; ".join(warnings) if warnings else ""),
            False,
            logs,
        )
    return {
        "outputs": outputs[:limit],
        "group_outputs": True,
        "warnings": warnings,
        "log": "\n\n".join(logs),
    }


def empty_result(profile, title, message, failed=False, logs=None):
    return {
        "outputs": [
            {
                "type": "error",
                "label": title,
                "data": {"title": title, "message": message},
                "relation": "Recherchehinweis",
                "source_input": profile["id"],
                "source": {"tool": "Argus", "profile": copy.deepcopy(profile["data"])},
            }
        ],
        "group_outputs": False,
        "failed": failed,
        "error": message if failed else None,
        "warnings": [message],
        "log": "\n\n".join(logs or [message]),
    }
