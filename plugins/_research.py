"""Shared provider orchestration and conservative, provenance-preserving deduplication."""

import copy
import json
import math
import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def url_key(value):
    try:
        p = urlsplit(str(value).strip())
        if p.scheme not in ("http", "https") or not p.hostname:
            return str(value)
        host = p.hostname.lower()
        port = p.port
        if port and not (
            p.scheme == "http" and port == 80 or p.scheme == "https" and port == 443
        ):
            host += ":" + str(port)
        query = urlencode(
            [
                (k, v)
                for k, v in parse_qsl(p.query, keep_blank_values=True)
                if not k.lower().startswith("utm_")
                and k.lower() not in ("fbclid", "gclid")
            ]
        )
        return urlunsplit(
            (p.scheme.lower(), host, p.path.rstrip("/") or "/", query, p.fragment)
        )
    except ValueError:
        return str(value)


def fact_outputs(value, label, common, path=()):
    if isinstance(value, dict):
        return [
            item
            for key, child in value.items()
            for item in fact_outputs(child, label, common, path + (str(key),))
        ]
    if isinstance(value, list):
        return [
            item
            for index, child in enumerate(value)
            for item in fact_outputs(child, label, common, path + (str(index + 1),))
        ]
    if value is None or value == "":
        return []
    text = str(value)
    url = urlsplit(text)
    return [
        {
            **common,
            "type": (
                "url" if url.scheme in ("http", "https") and url.hostname else "value"
            ),
            "label": " · ".join((label, *path)),
            "fact_key": ".".join((label, *path)),
            "data": {"value": text},
            "relation": common.get("relation", "Profilangabe"),
        }
    ]


def deduplicate(outputs):
    unique = {}
    for original in outputs:
        item = copy.deepcopy(original)
        if item.get("relation") == "Suchprotokoll" or "Suchprotokoll" in item.get(
            "label", ""
        ):
            continue
        kind = item["type"]
        value = str(item["data"].get("value", item["data"].get("text", ""))).strip()
        source = item.get("source", {})
        if kind == "profile":
            from provider_registry import canonical, identity, label, resolve

            d = item["data"]
            d["provider"] = canonical(d["provider"])
            provider = identity(d["provider"])
            identifier = str(d.get("identifier", "")).strip()
            record = resolve(d["provider"])
            if record and record.get("case_insensitive"):
                identifier = identifier.casefold()
            # These tools confirm the exact queried identifier, not arbitrary name matches.
            key = (
                kind,
                provider,
                (
                    ("identifier", identifier)
                    if identifier
                    else ("url", url_key(d["url"]))
                ),
            )
            item["label"] = label(d["provider"])
        elif kind == "url":
            key = (kind, url_key(value))
        elif kind == "image":
            key = (
                (kind, url_key(item["data"]["url"]))
                if item["data"].get("url")
                else (
                    kind,
                    item["data"].get("file_id")
                    or json.dumps(item["data"], sort_keys=True, ensure_ascii=False),
                )
            )
        elif kind == "email":
            key = (kind, value.casefold())
        elif kind == "value":
            service = str(source.get("service", "")).strip().casefold()
            field = re.sub(
                r"[^a-z0-9]",
                "",
                str(
                    item.get("fact_key") or item.get("label", "").split(" · ")[-1]
                ).casefold(),
            )
            field = {
                "registrierung": "registration",
                "registrierungsbefund": "registration",
            }.get(field, field)
            key = (kind, service, field, value)
        else:
            key = (kind, json.dumps(item["data"], sort_keys=True, ensure_ascii=False))
        service = str(source.get("service") or item.get("group") or "").strip()
        service = re.sub(r"^(?:Holehe|Maigret|PhoneInfoga) · ", "", service)
        if service and kind != "profile":
            item["group"] = service
            item["group_id"] = (
                service.casefold() + ":" + str(item.get("source_input", ""))
            )
            if item["type"] == "value" and item.get("label", "").casefold().startswith(
                service.casefold() + " · "
            ):
                item["label"] = item["label"][len(service) + 3 :]
        sources = source.get("sources") or [source]
        if key in unique:
            if kind == "profile":
                for field in ("url", "identifier"):
                    if not unique[key]["data"].get(field) and item["data"].get(field):
                        unique[key]["data"][field] = item["data"][field]
            combined = unique[key]["source"]["sources"]
            for src in sources:
                if src not in combined:
                    combined.append(src)
        else:
            item["source"] = {"service": service, "sources": sources}
            unique[key] = item
    for item in unique.values():
        if item["type"] == "profile":
            for source in item["source"]["sources"]:
                if isinstance(source.get("lookup"), dict):
                    source.setdefault(
                        "reported_profile",
                        copy.deepcopy(source["lookup"].get("profile", {})),
                    )
                    source["lookup"]["profile"] = copy.deepcopy(item["data"])
    return list(unique.values())


def aggregate(kind, providers, inputs, params, context):
    if len(inputs) != 1:
        raise ValueError("Genau einen Eingabeknoten anschließen.")
    timeout = int(params.get("run_timeout", 300))
    request = int(params.get("request_timeout", 12))
    limit = int(params.get("max_results", 500))
    if not 10 <= timeout <= 300 or not 2 <= request <= 30 or not 1 <= limit <= 1000:
        raise ValueError(
            "Zeitlimit: 10–300 Sekunden; je Website: 2–30 Sekunden; Ergebnisse: 1–1000."
        )
    if any(not isinstance(params.get("use_" + name, True), bool) for name in providers):
        raise ValueError("Recherchequellen müssen ein- oder ausgeschaltet sein.")
    params = {
        **params,
        "run_timeout": timeout,
        "request_timeout": request,
        "max_results": limit,
        "identity_only": True,
    }
    order = params.get("source_order", list(providers))
    if (
        not isinstance(order, list)
        or any(not isinstance(name, str) or name not in providers for name in order)
        or len(order) != len(set(order))
    ):
        raise ValueError("Ungültige Quellenreihenfolge.")
    order = order + [name for name in providers if name not in order]
    enabled = [
        (name, providers[name]) for name in order if params.get("use_" + name, True)
    ]
    if not enabled:
        raise ValueError(
            "Mindestens eine Recherchequelle in den Plugin-Einstellungen aktivieren."
        )
    from plugins._search_profiles import plans
    import time

    # Validate every enabled provider before making the first external request.
    planned = [(name, fn, plans(kind, name, params)) for name, fn in enabled]
    outputs = []
    warnings = []
    logs = []
    success = 0
    for name, fn, scopes in planned:
        deadline = time.monotonic() + timeout
        for scope in scopes:
            remaining = math.ceil(deadline - time.monotonic())
            if remaining < 10:
                warnings.append(
                    name
                    + ": Zeitlimit erreicht; weitere Suchprofile wurden nicht ausgeführt."
                )
                break
            scope["run_timeout"] = remaining
            try:
                result = fn(inputs, scope, context)
                success += 1
                for item in result.get("outputs", []):
                    item = copy.deepcopy(item)
                    item["source"] = {
                        **item.get("source", {}),
                        "tool": item.get("source", {}).get("tool", name),
                    }
                    outputs.append(item)
                warnings.extend(
                    name + ": " + str(w) for w in result.get("warnings", [])
                )
                logs.append(name + "\n" + str(result.get("log", "")))
            except Exception as exc:
                message = name + ": " + str(exc)
                warnings.append(message)
                logs.append(message)
    if not success:
        raise ValueError("Alle Recherchequellen fehlgeschlagen: " + "; ".join(warnings))
    from plugins._profile import discovery_outputs

    profiles = discovery_outputs(outputs, inputs[0], kind)
    technical = [
        o
        for o in outputs
        if kind == "phone" and o.get("source", {}).get("tool") == "PhoneInfoga"
    ]
    result = deduplicate(profiles + technical)
    if len(result) > limit:
        warnings.append(
            "Ausgabe auf "
            + str(limit)
            + " Knoten begrenzt; vollständiges Protokoll bleibt in den Logs."
        )
    return {
        "outputs": result[:limit],
        "warnings": warnings,
        "log": "\n\n".join(logs),
        "group_outputs": False,
    }
