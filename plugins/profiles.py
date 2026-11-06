"""Broad username discovery through Sherlock; no provider-specific plugin dependency."""

from core import tools
from plugins._process import bounded_run
import csv
import io
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import urlparse

PLUGIN = {
    "id": "profiles",
    "name": "Find profiles - Sherlock",
    "description": "Broad username search; results are URLs and values grouped by provider.",
    "actions": [
        {
            "id": "search",
            "name": "Find profiles for username",
            "inputs": ["username"],
            "external": True,
            "external_notice": "The username is sent to the selected websites. Matching usernames do not prove a shared identity.",
            "default_params": {
                "sites": [],
                "request_timeout": 10,
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
        raise ValueError("Unsupported Sherlock result format: CSV columns missing.")
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
            "relation": "Username found",
        }
        outputs.append(
            {
                **common,
                "type": "url",
                "label": row["name"] + " · Profile URL",
                "data": {"value": url},
            }
        )
    if counts["inconclusive"]:
        warnings.append(
            f"{counts['inconclusive']} checks without a conclusive result; not counted as 'no match'."
        )
    if counts["found"] > max_results:
        warnings.append(
            f"{counts['found']} matches; showing the first {max_results}. All checks remain in the search record."
        )

    for output in outputs:
        output["source"]["counts"] = counts
    return outputs, warnings


def search(username, params):
    executable = tools.executable("sherlock", "sherlock")
    # Disallow path segments, options and upstream wildcard expansion; no shell execution.
    if (
        not re.fullmatch(r"[\w.@+\-]{1,100}", username, flags=re.UNICODE)
        or username.startswith("-")
        or username in (".", "..")
    ):
        raise ValueError("Username contains unsupported characters or is too long.")
    sites = params.get("sites", [])
    if (
        not isinstance(sites, list)
        or len(sites) > 50
        or any(not isinstance(s, str) or not s.strip() or len(s) > 100 for s in sites)
    ):
        raise ValueError("sites must list at most 50 Sherlock site names.")
    request_timeout = int(params.get("request_timeout", 10))
    if not 1 <= request_timeout <= 30:
        raise ValueError("Request timeout: 1–30 seconds.")
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
        # No overall time limit; cancellation still stops the whole process group.
        # Child output stays local and is discarded; research inputs never reach logs.
        bounded_run(args, None, cwd=directory, max_bytes=64 * 1024 * 1024)
        report = Path(directory) / (username + ".csv")
        if not report.is_file():
            raise ValueError(
                "Sherlock returned no usable result. Check installation, network and selected sites."
            )
        if report.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("Sherlock result exceeds 4 MiB.")
        return report.read_text(encoding="utf-8-sig")


def run(action, inputs, params, context):
    if action != "search":
        raise ValueError("Unknown profile search action.")
    if len(inputs) != 1:
        raise ValueError("Connect exactly one username node per search.")
    node = inputs[0]
    username = node["data"].get("value")
    if not isinstance(username, str) or not username:
        raise ValueError("Username is missing in data.value.")
    max_results = int(params.get("max_results", 100))
    if not 1 <= max_results <= 400:
        raise ValueError("max_results must be between 1 and 400.")
    if not _search_lock.acquire(blocking=False):
        raise ValueError("A profile search is already running. Wait for it to finish.")
    try:
        text = search(username, params)
        outputs, warnings = parse_csv(text, node, max_results)
        warnings.append(
            "Results are based on Sherlock checks and require review; matching usernames do not prove a shared identity."
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
