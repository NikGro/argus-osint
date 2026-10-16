from core.node_policy import formatted_address  # Shared presentation normalization.
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request

PLUGIN = {
    "id": "location",
    "name": "Ort normalisieren & vervollständigen",
    "category": "Orte und Zeit",
    "description": "Ort mit Photon und einem konfigurierbaren Nominatim-Endpunkt normalisieren.",
    "actions": [
        {
            "id": "normalize",
            "name": "Ort normalisieren & vervollständigen",
            "inputs": ["location"],
            "external": True,
            "external_notice": "Ortsangaben werden an aktivierte Adressdienste gesendet. Nominatim-Endpunkt passend zu Datenschutz und Nutzungsbedingungen konfigurieren.",
            "default_params": {
                "use_photon": True,
                "use_nominatim": True,
                "source_order": ["photon", "nominatim"],
                "nominatim_url": "",
                "photon_url": "https://photon.komoot.io",
            },
        }
    ],
}

FIELDS = [
    "country_code",
    "country",
    "admin_area_1",
    "admin_area_2",
    "admin_area_3",
    "locality",
    "dependent_locality",
    "postal_code",
    "street",
    "house_number",
    "building",
    "unit",
    "po_box",
    "formatted_address",
    "original_input",
    "granularity",
]
ALIASES = {
    "state": "admin_area_1",
    "province": "admin_area_1",
    "bundesland": "admin_area_1",
    "county": "admin_area_2",
    "city": "locality",
    "town": "locality",
    "village": "locality",
    "suburb": "dependent_locality",
    "postcode": "postal_code",
    "road": "street",
    "lat": "latitude",
    "lon": "longitude",
}
_lock = threading.Lock()
_last_request = 0.0
_cache = {}


def normalize(data):
    if not isinstance(data, dict):
        raise ValueError("Location-Daten müssen ein JSON-Objekt sein.")
    out, extra = {}, {}
    for key, value in data.items():
        key = ALIASES.get(key, key)
        if value is None or value == "":
            continue
        if key in FIELDS:
            out[key] = str(value).strip()
        elif key in ("latitude", "longitude"):
            number = float(value)
            limit = 90 if key == "latitude" else 180
            if not math.isfinite(number) or abs(number) > limit:
                raise ValueError("Ungültige Koordinate: " + key)
            out[key] = number
        elif key == "extra" and isinstance(value, dict):
            extra.update(value)
        else:
            extra[key] = value
    if ("latitude" in out) != ("longitude" in out):
        raise ValueError("Latitude und Longitude müssen gemeinsam angegeben werden.")
    if "country_code" in out:
        out["country_code"] = out["country_code"].upper()
        if (
            len(out["country_code"]) != 2
            or not out["country_code"].isascii()
            or not out["country_code"].isalpha()
        ):
            raise ValueError("country_code muss ein zweistelliger Ländercode sein.")
    if extra:
        out["extra"] = extra
    if not out:
        raise ValueError("Bitte mindestens eine Standortangabe eintragen.")
    return out


def request(endpoint, params, provider="nominatim", base_override=None):
    global _last_request
    base = (
        base_override
        if base_override is not None
        else (
            os.environ.get("GEOCODER_URL", "")
            if provider == "nominatim"
            else "https://photon.komoot.io"
        )
    ).rstrip("/")
    agent = (
        os.environ.get("GEOCODER_USER_AGENT", "").strip()
        or "ArgusWorkbench/0.10 (local research workbench)"
    )
    if not base or not agent:
        return None
    if urllib.parse.urlparse(base).scheme not in ("http", "https"):
        raise ValueError("GEOCODER_URL muss eine HTTP(S)-Adresse sein.")
    url = base + "/" + endpoint + "?" + urllib.parse.urlencode(params)
    with _lock:
        if url in _cache:
            return _cache[url]
        time.sleep(max(0, 1.1 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        req = urllib.request.Request(
            url, headers={"User-Agent": agent, "Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            payload = response.read(2_000_001)
            if len(payload) > 2_000_000:
                raise ValueError("Antwort des Adressdienstes zu groß.")
            result = json.loads(payload)
        if len(_cache) > 500:
            _cache.clear()
        _cache[url] = result
        return result


def query(data, provider="nominatim", language="de"):
    params = (
        {"format": "geocodejson", "addressdetails": 1, "accept-language": language}
        if provider == "nominatim"
        else {"lang": language, "limit": 5}
    )
    has_address = any(data.get(key) for key in ("street", "locality", "postal_code"))
    if "latitude" in data and not has_address:
        params.update(lat=data["latitude"], lon=data["longitude"])
        return "reverse", params
    pieces = [
        " ".join(str(data.get(k, "")) for k in ("street", "house_number")).strip()
    ]
    pieces += [
        str(data.get(k, ""))
        for k in ("postal_code", "locality", "admin_area_2", "admin_area_1", "country")
    ]
    q = ", ".join(p for p in pieces if p)
    if not any(
        data.get(key) for key in ("street", "locality", "postal_code")
    ) and data.get("original_input"):
        q = ", ".join(p for p in (data["original_input"], data.get("country", "")) if p)
    q = q or data.get("formatted_address") or data.get("country_code", "")
    params.update(q=q, limit=5)
    if data.get("country_code"):
        params["countrycodes" if provider == "nominatim" else "countrycode"] = data[
            "country_code"
        ].upper()
    return ("search" if provider == "nominatim" else "api"), params


def candidate(feature, original, reverse):
    props = feature.get("properties", {})
    geo = props.get("geocoding", props)
    mapping = {
        "country": "country",
        "country_code": "country_code",
        "countrycode": "country_code",
        "state": "admin_area_1",
        "county": "admin_area_2",
        "city": "locality",
        "district": "dependent_locality",
        "postcode": "postal_code",
        "street": "street",
        "housenumber": "house_number",
        "label": "formatted_address",
    }
    found = {
        target: geo[source]
        for source, target in mapping.items()
        if geo.get(source) is not None
    }
    coords = feature.get("geometry", {}).get("coordinates", [])
    if len(coords) >= 2:
        found.update(longitude=coords[0], latitude=coords[1])
    if found.get("country_code"):
        found["country_code"] = found["country_code"].upper()
    found["granularity"] = str(geo.get("type") or geo.get("osm_value") or "unknown")
    if not found.get("formatted_address"):
        found["formatted_address"] = ", ".join(
            str(geo.get(key, ""))
            for key in (
                "name",
                "street",
                "housenumber",
                "postcode",
                "city",
                "state",
                "country",
            )
            if geo.get(key)
        )
    found["coordinate_role"] = (
        "original_point" if reverse else "provider_representative_point"
    )
    conflicts = {
        k: {"input": original[k], "candidate": v}
        for k, v in found.items()
        if original.get(k) not in (None, "")
        and str(original[k]).casefold() != str(v).casefold()
    }
    # Preserve supplied coordinates during reverse geocoding; the service may return a nearby object.
    if reverse:
        found.update(latitude=original["latitude"], longitude=original["longitude"])
        conflicts.pop("latitude", None)
        conflicts.pop("longitude", None)
    return {
        **original,
        **found,
        "conflicts": conflicts,
        "candidate": True,
        "provider_result": feature,
    }


def run(action, inputs, params, context):
    if action != "normalize":
        raise ValueError("Unbekannte Standortaktion.")
    outputs = []
    warnings = []
    selections = []
    logs = []
    config = context.get("settings", {"geocoder_enabled": True, "language": "de"})
    order = params.get("source_order", ["photon", "nominatim"])
    if (
        not isinstance(order, list)
        or any(p not in ("photon", "nominatim") for p in order)
        or len(set(order)) != len(order)
    ):
        raise ValueError("Ungültige Quellenreihenfolge.")
    order = order + [p for p in ("photon", "nominatim") if p not in order]
    defaults = {key: "" for key in FIELDS}
    defaults.update(latitude=None, longitude=None)
    for node in inputs:
        data = normalize(node["data"])
        normalized = {**defaults, **node["data"], **data}
        options = []
        seen = set()
        received = False
        queried = []
        for provider in order:
            if not config.get("geocoder_enabled", True) or not params.get(
                "use_" + provider, True
            ):
                continue
            base = params.get(provider + "_url") or (
                os.environ.get("GEOCODER_URL", "")
                if provider == "nominatim"
                else "https://photon.komoot.io"
            )
            if not base:
                warnings.append(
                    "Nominatim: Kein Endpunkt konfiguriert; Quelle übersprungen."
                )
                continue
            endpoint, qp = query(data, provider, config.get("language", "de"))
            try:
                response = request(endpoint, qp, provider, base)
                if not isinstance(response, dict):
                    raise ValueError("Unlesbare Antwort.")
                received = True
                queried.append(provider)
                for feature in response.get("features", []):
                    option = candidate(feature, normalized, endpoint == "reverse")
                    option.update(
                        provider=provider,
                        attribution="© OpenStreetMap contributors",
                        candidate=False,
                    )
                    key = (
                        option.get("formatted_address", ""),
                        option.get("latitude"),
                        option.get("longitude"),
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    options.append(option)
                logs.append(provider + "\n" + json.dumps(response, ensure_ascii=False))
            except Exception as exc:
                warnings.append(
                    provider + ": Adressdienst nicht erreichbar. " + str(exc)
                )
        if len(options) == 1:
            normalized = options[0]
        elif len(options) > 1:
            selections.append({"input_id": node["id"], "options": options})
        elif received:
            warnings.append(
                "Keine passende Adresse gefunden; vorhandene Angaben bleiben erhalten."
            )
        normalized["formatted_address"] = formatted_address(
            normalized
        ) or normalized.get("formatted_address", "")
        outputs.append(
            {
                "type": "location",
                "label": formatted_address(normalized) or node.get("label", "Ort"),
                "data": normalized,
                "source_input": node["id"],
                "relation": "Normalisierter Ort",
                "source": {
                    "providers": queried,
                    "attribution": "© OpenStreetMap contributors",
                },
            }
        )
    return {
        "outputs": outputs,
        "group_outputs": False,
        "candidates": selections,
        "warnings": warnings,
        "log": "\n\n".join(logs),
    }
