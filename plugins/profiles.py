"""Broad username discovery through Sherlock; no provider-specific plugin dependency."""

import csv
import io
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import urlparse

PLUGIN = {
    "id": "profiles",
    "name": "Profile suchen - Sherlock",
    "description": "Breite Benutzernamensuche; Treffer als URL und Value in Anbietergruppen.",
    "actions": [
        {
            "id": "search",
            "name": "Profile zum Benutzernamen suchen",
            "inputs": ["username"],
            "external": True,
            "external_notice": "Der Benutzername wird an die ausgewählten Websites gesendet. Gleiche Benutzernamen beweisen keine gemeinsame Identität.",
            "default_params": {
                "sites": [],
                "request_timeout": 10,
                "run_timeout": 120,
                "max_results": 100,
            },
        }
    ],
}
_search_lock = threading.Lock()


def parse_csv(text, node, max_results):
    reader = csv.DictReader(io.StringIO(text))
    required = {"name", "url_user", "exists"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        raise ValueError(
            "Sherlock-Ergebnisformat nicht unterstützt: CSV-Spalten fehlen."
        )
    outputs, warnings, seen = [], [], set()
    counts = {"found": 0, "not_found": 0, "inconclusive": 0}
    rows = list(reader)
    for row in rows:
        # QueryStatus string differs between upstream versions; the pinned version uses Claimed.
        status = str(row["exists"]).strip().lower()
        if status in (
            "available",
            "querystatus.available",
            "illegal",
            "querystatus.illegal",
        ):
            counts["not_found"] += 1
            continue
        if status not in ("claimed", "querystatus.claimed"):
            counts["inconclusive"] += 1
            continue
        url = row["url_user"].strip()
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            counts["inconclusive"] += 1
            continue
        key = (row["name"], url)
        if key in seen:
            continue
        seen.add(key)
        counts["found"] += 1
        if counts["found"] > max_results:
            continue
        common = {
            "source_input": node["id"],
            "source": {
                "tool": "Sherlock",
                "service": row["name"],
                "url": url,
                "status": row["exists"],
                "http_status": row.get("http_status"),
            },
            "relation": "Benutzername gefunden",
        }
        outputs.append(
            {
                **common,
                "type": "url",
                "label": row["name"] + " · Profiladresse",
                "data": {"value": url},
            }
        )
    if counts["inconclusive"]:
        warnings.append(
            f"{counts['inconclusive']} Prüfungen ohne eindeutiges Ergebnis; nicht als 'kein Treffer' bewertet."
        )
    if counts["found"] > max_results:
        warnings.append(
            f"{counts['found']} Treffer; Anzeige auf {max_results} Treffer begrenzt. Alle Prüfungen bleiben im Suchbefund erhalten."
        )

    for output in outputs:
        output["source"]["counts"] = counts
    return outputs, warnings


def search(username, params):
    executable = shutil.which("sherlock")
    if not executable:
        raise ValueError(
            "Sherlock ist nicht installiert. Container mit der aktuellen requirements.txt neu bauen."
        )
    # Disallow path segments, options and upstream wildcard expansion; no shell execution.
    if (
        not re.fullmatch(r"[\w.@+\-]{1,100}", username, flags=re.UNICODE)
        or username.startswith("-")
        or username in (".", "..")
    ):
        raise ValueError(
            "Benutzername enthält nicht unterstützte Zeichen oder ist zu lang."
        )
    sites = params.get("sites", [])
    if (
        not isinstance(sites, list)
        or len(sites) > 50
        or any(not isinstance(s, str) or not s.strip() or len(s) > 100 for s in sites)
    ):
        raise ValueError(
            "sites muss eine Liste von höchstens 50 Sherlock-Anbieternamen sein."
        )
    request_timeout = int(params.get("request_timeout", 10))
    run_timeout = int(params.get("run_timeout", 120))
    if not 1 <= request_timeout <= 30 or not 10 <= run_timeout <= 180:
        raise ValueError(
            "request_timeout: 1–30 Sekunden; run_timeout: 10–180 Sekunden."
        )
    with tempfile.TemporaryDirectory(prefix="trace-sherlock-") as directory:
        args = [
            executable,
            "--csv",
            "--print-all",
            "--folderoutput",
            directory,
            "--timeout",
            str(request_timeout),
            "--no-color",
        ]
        for site in sites:
            args.extend(["--site", site])
        args.extend(["--", username])
        try:
            # Child stdout/stderr stay local and bounded by a file; do not leak research inputs to logs.
            with open(Path(directory) / "process.log", "wb") as log:
                completed = subprocess.run(
                    args,
                    cwd=directory,
                    stdout=log,
                    stderr=log,
                    timeout=run_timeout,
                    check=False,
                )
        except subprocess.TimeoutExpired as exc:
            raise ValueError(
                "Sherlock-Gesamtzeitlimit erreicht. Suche unvollständig; weniger Anbieter auswählen oder Zeitlimit erhöhen."
            ) from exc
        report = Path(directory) / (username + ".csv")
        if completed.returncode != 0 or not report.is_file():
            raise ValueError(
                "Sherlock lieferte kein auswertbares Ergebnis. Installation, Netzwerk und sites-Auswahl prüfen."
            )
        if report.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("Sherlock-Ergebnis überschreitet 4 MiB.")
        return report.read_text(encoding="utf-8-sig")


def run(action, inputs, params, context):
    if action != "search":
        raise ValueError("Unbekannte Profilsuchaktion.")
    if len(inputs) != 1:
        raise ValueError("Pro Suchlauf genau einen Benutzername-Knoten anschließen.")
    node = inputs[0]
    username = node["data"].get("value")
    if not isinstance(username, str) or not username:
        raise ValueError("Benutzername im Feld data.value fehlt.")
    max_results = int(params.get("max_results", 100))
    if not 1 <= max_results <= 400:
        raise ValueError("max_results muss zwischen 1 und 400 liegen.")
    if not _search_lock.acquire(blocking=False):
        raise ValueError(
            "Es läuft bereits eine Profilsuche. Bitte deren Abschluss abwarten."
        )
    try:
        text = search(username, params)
        outputs, warnings = parse_csv(text, node, max_results)
        warnings.append(
            "Treffer beruhen auf Sherlock-Prüfungen und müssen geprüft werden; gleiche Benutzernamen belegen keine gemeinsame Person."
        )
        return {
            "outputs": outputs,
            "warnings": warnings,
            "group_outputs": False,
            "log": text,
        }
    finally:
        _search_lock.release()


PLUGIN["hidden"] = True
