"""Consensus discovery adapter: confirmed identities only; incomplete checks remain warnings."""

from core import tools
import json
import subprocess
from pathlib import Path
import tempfile
from core.errors import AppError
from plugins._process import bounded_run
from plugins._profile import make_profile
from plugins._extra_sources import validate


def parse_findings(rows, node, kind):
    outputs, warnings = [], []
    for row in rows:
        name = str(row.get("site") or row.get("site_id") or "Consensus")
        status = str(row.get("status", "")).lower()
        if status in ("error", "rate_limited", "blocked", "unknown"):
            warnings.append(name + ": " + str(row.get("error") or status))
        if status != "found" or row.get("category") in ("analysis", "dorks"):
            continue
        item = make_profile(
            name, row.get("url", ""), node["data"]["value"], node, "Consensus", kind
        )
        # Discovery must not turn scraped biographies/avatars into additional nodes.
        item["source"]["consensus"] = {
            "site_id": row.get("site_id"),
            "upstream": row.get("source"),
            "status": status,
            "method": row.get("method"),
            "http_status": row.get("http_status"),
        }
        outputs.append(item)
    return {
        "outputs": outputs,
        "warnings": warnings,
        "log": json.dumps(rows, ensure_ascii=False),
    }


def run(kind, inputs, params, context):
    node = inputs[0]
    value = str(node["data"].get("value", "")).strip()
    if kind in ("email", "username"):
        validate(kind, value)
    else:
        import phonenumbers

        try:
            number = phonenumbers.parse(value, params.get("phone_region") or None)
            if not phonenumbers.is_possible_number(number):
                raise ValueError("Invalid phone number.")
            value = phonenumbers.format_number(
                number, phonenumbers.PhoneNumberFormat.E164
            )
        except phonenumbers.NumberParseException as exc:
            raise ValueError("Invalid phone number.") from exc
        node = {**node, "data": {**node["data"], "value": value}}
    sites = params.get("consensus_sites", [])
    if not isinstance(sites, list) or any(
        not isinstance(s, str) or not s.strip() or s.startswith("-") for s in sites
    ):
        raise ValueError("Invalid Consensus websites.")
    with tempfile.TemporaryDirectory(prefix="argus-consensus-") as folder:
        checkpoint = Path(folder) / "findings.jsonl"
        warnings = []
        try:
            output, _ = bounded_run(
                [
                    tools.python("consensus"),
                    "-I",
                    str(Path(__file__).with_name("_consensus_runner.py")),
                ],
                None,
                {
                    "kind": "user" if kind == "username" else kind,
                    "value": value,
                    "request_timeout": int(params.get("request_timeout", 12)),
                    "phone_region": params.get("phone_region", ""),
                    "sites": sites,
                    "tags": params.get("_profile_tags", []),
                    "top": params.get("_profile_top"),
                    "checkpoint": str(checkpoint),
                },
            )
            status = json.loads(output)
            if status.get("exit_code") or status.get("truncated"):
                warnings.append(
                    "Consensus could not complete retrieval; existing results are preserved."
                )
        except AppError:
            raise
        except (OSError, ValueError, subprocess.SubprocessError):
            if not checkpoint.exists():
                raise
            warnings.append(
                "Consensus: time or process limit reached; results so far are kept."
            )
        rows = []
        if checkpoint.exists():
            for line in checkpoint.read_text(encoding="utf-8").splitlines():
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    warnings.append("Consensus: incomplete final result line.")
        result = parse_findings(rows, node, kind)
        result["warnings"].extend(warnings)
        return result
