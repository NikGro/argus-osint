"""Locate where an audio recording was made from aircraft Doppler shifts.

Dopplergeist (github.com/1337isnot1337/DOPPLERGEIST) finds aircraft
overflights in the recording and compares their Doppler curves with the
historical ADS-B flight tracks of that day. Candidate positions become
location nodes; when the evidence is not enough, ARGUS shows why.

Licence: Dopplergeist is PolyForm Noncommercial 1.0.0. It may only be used
for private, noncommercial purposes.
"""

from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import tempfile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from core import tools
from plugins._process import bounded_run

COUNTRIES = ["DE", "US", "FR", "ES", "IT"]
SUFFIXES = {
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/flac": ".flac",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
}
# Dopplergeist requires a finite wall-time limit; ARGUS runs tools without
# one, so a year stands in for "until finished or cancelled".
NO_TIME_LIMIT = str(365 * 24 * 3600)
MESSAGES = {
    "needs_input": "Dopplergeist braucht weitere Angaben: {detail}",
    "inconclusive": "Kein belastbarer Ort gefunden: {detail}",
    "failed": "Dopplergeist ist fehlgeschlagen: {detail}",
}

PLUGIN = {
    "id": "dopplergeist",
    "tools": ["dopplergeist"],
    "name": "Audio mit Dopplergeist verorten",
    "icon": "audio-location",
    "category": "Medien",
    "description": "Aufnahmeort einer Audiodatei aus den Doppler-Verläufen überfliegender Flugzeuge und historischen ADS-B-Flugspuren schätzen. Nur für private, nicht kommerzielle Nutzung (PolyForm Noncommercial).",
    "actions": [
        {
            "id": "locate",
            "name": "Aufnahmeort schätzen",
            "icon": "audio-location",
            "inputs": ["audio", "datetime"],
            "min_inputs": 1,
            "max_inputs": 2,
            "external": True,
            "default_params": {
                "recording_start": "",
                "timezone": "Europe/Berlin",
                "start_uncertainty_minutes": 0,
                "country": "DE",
                "bounds": "",
                "download_data": True,
                "max_candidates": 5,
            },
            "parameter_help": "Aufnahmebeginn als 2026-11-05 14:30 eintragen oder einen Datum-/Zeit-Node verbinden. Suchgebiet optional als West, Süd, Ost, Nord in Dezimalgrad. Das Herunterladen der Flugdaten kann viele Gigabyte und Stunden brauchen; geladene Daten bleiben gespeichert, bis das Plugin entfernt wird.",
            "parameter_schema": {
                "recording_start": {"secret": False},
                "timezone": {"secret": False},
                "start_uncertainty_minutes": {
                    "secret": False,
                    "min": 0,
                    "max": 720,
                    "step": 1,
                },
                "country": {"secret": False, "enum": COUNTRIES},
                "bounds": {"secret": False},
                "download_data": {"secret": False},
                "max_candidates": {"secret": False, "min": 1, "max": 20, "step": 1},
            },
        }
    ],
}


def recording_window(inputs, params):
    """UTC start window from a connected date/time node or the parameters."""
    node = next((n for n in inputs if n["type"] == "datetime"), None)
    if node:
        text = (
            node["data"].get("date", "") + " " + node["data"].get("time", "")
        ).strip()
        zone = node["data"].get("timezone") or "UTC"
    else:
        text = str(params.get("recording_start") or "").strip()
        zone = str(params.get("timezone") or "UTC").strip()
    if not text:
        raise ValueError(
            "Aufnahmebeginn fehlt: Datum-/Zeit-Node verbinden oder Aufnahmebeginn eintragen."
        )
    try:
        start = datetime.fromisoformat(text.replace(" ", "T", 1))
    except ValueError:
        raise ValueError(
            "Aufnahmebeginn nicht lesbar. Format: 2026-11-05 14:30"
        ) from None
    if start.tzinfo is None:
        try:
            start = start.replace(tzinfo=ZoneInfo(zone))
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unbekannte Zeitzone: " + zone) from None
    minutes = params.get("start_uncertainty_minutes", 0)
    if isinstance(minutes, bool) or not isinstance(minutes, (int, float)):
        raise ValueError("Unsicherheit des Aufnahmebeginns: 0–720 Minuten.")
    if not 0 <= minutes <= 720:
        raise ValueError("Unsicherheit des Aufnahmebeginns: 0–720 Minuten.")
    start = start.astimezone(timezone.utc)
    end = start + timedelta(minutes=minutes)
    return start.isoformat(), end.isoformat()


def search_bounds(value):
    text = str(value or "").strip()
    if not text:
        return []
    try:
        numbers = [float(part) for part in text.replace(";", ",").split(",")]
    except ValueError:
        numbers = []
    if (
        len(numbers) != 4
        or not all(math.isfinite(n) for n in numbers)
        or not (-180 <= numbers[0] < numbers[2] <= 180)
        or not (-90 <= numbers[1] < numbers[3] <= 90)
    ):
        raise ValueError(
            "Suchgebiet: vier Zahlen West, Süd, Ost, Nord, z. B. 13.0, 52.3, 13.8, 52.7."
        )
    return [str(n) for n in numbers]


def command(audio, jobs, config, start, end, params):
    country = params.get("country", "DE")
    if country not in COUNTRIES:
        raise ValueError("Land wird von Dopplergeist nicht unterstützt.")
    args = [
        tools.executable("dopplergeist", "dopplergeist"),
        "analyze",
        str(audio),
        "--start-utc",
        start,
        "--end-utc",
        end,
        "--time-source",
        "ARGUS",
        "--country",
        country,
        "--jobs",
        str(jobs),
        "--config",
        str(config),
        "--max-runtime",
        NO_TIME_LIMIT,
        "--max-upload-mb",
        "4096",
    ]
    bounds = search_bounds(params.get("bounds"))
    if bounds:
        args += ["--bounds", *bounds]
    if params.get("download_data", True):
        args.append("--online")
    return args


def outcome(directory, stdout):
    """The job's result.json, falling back to the JSON printed on stdout."""
    for path in sorted(Path(directory).glob("*/result.json")):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            continue
    try:
        return json.loads(stdout)
    except ValueError:
        return None


def candidate_nodes(result, node, limit):
    outputs = []
    candidates = sorted(
        result.get("candidates") or [], key=lambda c: c.get("score", 0), reverse=True
    )
    for rank, candidate in enumerate(candidates[:limit], 1):
        lat, lon = candidate.get("lat"), candidate.get("lon")
        if not all(
            isinstance(v, (int, float)) and math.isfinite(v) for v in (lat, lon)
        ):
            continue
        radius = (candidate.get("uncertainty") or {}).get("radius_m")
        outputs.append(
            {
                "type": "location",
                "label": "Kandidat {}: {:.5f}, {:.5f}".format(rank, lat, lon),
                "data": {
                    "latitude": round(lat, 6),
                    "longitude": round(lon, 6),
                    "coordinate_role": "estimated",
                    "granularity": "coordinates",
                    "original_input": "Dopplergeist",
                },
                "source_input": node["id"],
                "group": "Dopplergeist · " + str(node.get("label") or "Audio"),
                "group_id": node["id"],
                "relation": "Möglicher Aufnahmeort",
                "source": {
                    "tool": "Dopplergeist",
                    "rank": rank,
                    "score": candidate.get("score"),
                    "score_kind": candidate.get("score_kind"),
                    "uncertainty_radius_m": radius,
                    "recording_start_utc": candidate.get("recording_start_utc"),
                    "flight_ids": candidate.get("flight_ids", []),
                    "event_ids": candidate.get("event_ids", []),
                },
            }
        )
    return outputs


def explanation(result):
    status = result.get("status", "failed")
    detail = result.get("message") or result.get("reason_code") or status
    if result.get("required_fields"):
        detail += " (" + ", ".join(result["required_fields"]) + ")"
    return MESSAGES.get(status, MESSAGES["failed"]).format(detail=detail)


def run(action, inputs, params, context):
    if action != "locate":
        raise ValueError("Unbekannte Dopplergeist-Aktion.")
    audio_nodes = [n for n in inputs if n["type"] == "audio"]
    if len(audio_nodes) != 1:
        raise ValueError("Genau einen Audio-Node verbinden.")
    node = audio_nodes[0]
    source = Path(context["resolve_file"](node["data"].get("file_id", "")))
    start, end = recording_window(inputs, params)
    limit = int(params.get("max_candidates", 5))
    cache = tools.directory("dopplergeist") / "cache"
    with tempfile.TemporaryDirectory(prefix="argus-dopplergeist-") as directory:
        folder = Path(directory)
        suffix = SUFFIXES.get(node["data"].get("mime"), "") or (
            Path(node["data"].get("filename", "")).suffix.lower() or ".mp3"
        )
        audio = folder / ("recording" + suffix)
        audio.symlink_to(source)
        config = folder / "config.json"
        config.write_text(json.dumps({"cache_root": str(cache)}))
        jobs = folder / "jobs"
        stdout, error = "", None
        try:
            stdout, _ = bounded_run(
                command(audio, jobs, config, start, end, params),
                None,
                max_bytes=64 * 1024 * 1024,
                cwd=directory,
            )
        except ValueError as problem:
            # A failed or inconclusive analysis still writes result.json.
            error = problem
        result = outcome(jobs, stdout)
    if result is None:
        raise error or ValueError("Dopplergeist hat kein Ergebnis geliefert.")
    outputs = candidate_nodes(result, node, limit)
    warnings = []
    coverage = result.get("coverage") or {}
    warnings += [str(item) for item in coverage.get("limitations", [])]
    if not outputs:
        outputs.append(
            {
                "type": "error",
                "label": "Dopplergeist: kein Ort",
                "data": {
                    "title": "Dopplergeist: kein Ort",
                    "message": explanation(result),
                },
                "source_input": node["id"],
                "relation": "Ergebnis",
                "source": {"tool": "Dopplergeist", "status": result.get("status")},
            }
        )
    events = result.get("events") or []
    summary = {
        "status": result.get("status"),
        "reason_code": result.get("reason_code"),
        "message": result.get("message"),
        "recording_start_utc": [start, end],
        "overflights": len(events),
        "candidates": len(result.get("candidates") or []),
        "coverage": coverage,
    }
    return {
        "outputs": outputs,
        "updates": [
            {
                "id": node["id"],
                "data": node["data"],
                "evidence": {"dopplergeist": summary},
            }
        ],
        "warnings": warnings,
        "log": json.dumps(summary, ensure_ascii=False),
    }
