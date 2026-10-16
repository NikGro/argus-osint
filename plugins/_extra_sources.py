import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
from urllib.parse import urlsplit
from plugins._process import bounded_run
from plugins._research import fact_outputs


def positive_outputs(rows, node, tool, kind, identity_only=False):
    outputs = []
    warnings = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        status = str(row.get("status", "")).casefold()
        if status not in ("found", "registered", "taken"):
            if status in ("error", "skipped", "unknown"):
                warnings.append(
                    str(row.get("site_name", row.get("name", "")))
                    + ": "
                    + status
                    + " "
                    + str(row.get("reason", ""))
                )
            continue
        name = str(row.get("site_name", row.get("name", "Anbieter")))
        if identity_only:
            from plugins._profile import make_profile

            # Email lookup URLs often identify the checking API, not the account.
            url = (
                row.get("url", "")
                if kind == "username"
                else (row.get("extra") or {}).get("profile_url", "")
            )
            outputs.append(
                make_profile(
                    name,
                    url,
                    node["data"].get("value", ""),
                    node,
                    tool,
                    kind,
                    row.get("service_key") or name,
                )
            )
            continue
        source = {"tool": tool, "service": name, "result": row}
        common = {"source_input": node["id"], "source": source}
        url = str(row.get("url", ""))
        p = urlsplit(url)
        if kind == "username" and p.scheme in ("http", "https") and p.hostname:
            outputs.append(
                {
                    **common,
                    "type": "url",
                    "label": name + " · Profiladresse",
                    "data": {"value": url},
                    "relation": "Benutzername gefunden",
                }
            )
        if kind == "email":
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
        facts = {
            **(row.get("extra") if isinstance(row.get("extra"), dict) else {}),
            **(row.get("media") if isinstance(row.get("media"), dict) else {}),
        }
        metadata = row.get("metadata") or []
        if isinstance(metadata, list):
            for m in metadata:
                if isinstance(m, dict):
                    facts[str(m.get("name", "Angabe"))] = m.get(
                        "value", m.get("data", "")
                    )
        for key, value in facts.items():
            outputs.extend(fact_outputs(value, str(key), common))
    return {"outputs": outputs, "warnings": warnings}


def user_scanner(kind, inputs, params, context):
    node = inputs[0]
    value = str(node["data"].get("value", "")).strip()
    validate(kind, value)
    output, stderr = bounded_run(
        [
            sys.executable,
            "-I",
            str(Path(__file__).with_name("_user_scanner_runner.py")),
        ],
        int(params.get("run_timeout", 300)),
        {
            "kind": kind,
            "value": value,
            "service": params.get("service", ""),
            "categories": params.get("_profile_tags", []),
            "sites": params.get("_profile_sites", []),
            "identity_only": bool(params.get("identity_only")),
            "request_timeout": int(params.get("request_timeout", 12)),
        },
    )
    rows = json.loads(output)
    if not isinstance(rows, list):
        raise ValueError("User-Scanner-Format nicht unterstützt.")
    result = positive_outputs(
        rows, node, "User Scanner", kind, bool(params.get("identity_only"))
    )
    result["log"] = json.dumps(rows, ensure_ascii=False)
    return result


def blackbird(kind, inputs, params, context):
    node = inputs[0]
    value = str(node["data"].get("value", "")).strip()
    validate(kind, value)
    if "/" in value or chr(92) in value:
        raise ValueError(
            "Blackbird unterstützt diese Schreibweise der E-Mail-Adresse nicht."
        )
    with tempfile.TemporaryDirectory(prefix="argus-blackbird-") as folder:
        work = Path(folder) / "tool"
        shutil.copytree("/opt/argus-tools/blackbird", work)
        # Keep source targeting and parser policy in this process's private copy.
        from plugins._profile import provider_key

        service = params.get("service", "")
        for filename in ("email-data.json", "wmn-data.json"):
            file = work / "data" / filename
            if not file.exists():
                if filename == "wmn-data.json":
                    # Initial upstream CLI would download the same public catalogue. No user input sent.
                    import urllib.request

                    with urllib.request.urlopen(
                        "https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json",
                        timeout=20,
                    ) as response:
                        catalogue = response.read(8 * 1024 * 1024 + 1)
                    if len(catalogue) > 8 * 1024 * 1024:
                        raise ValueError("Blackbird-Katalog zu groß.")
                    file.write_bytes(catalogue)
                else:
                    continue
            data = json.loads(file.read_text())
            if service:
                data["sites"] = [
                    site
                    for site in data["sites"]
                    if provider_key(site.get("name", "")) == provider_key(service)
                ]
                if (
                    filename
                    == ("email-data.json" if kind == "email" else "wmn-data.json")
                    and not data["sites"]
                ):
                    raise ValueError("Blackbird unterstützt diesen Anbieter nicht.")
            if params.get("_profile_mode"):
                tags = params.get("_profile_tags", [])
                sites = {
                    provider_key(site) for site in params.get("_profile_sites", [])
                }
                data["sites"] = [
                    site
                    for site in data["sites"]
                    if (not tags or str(site.get("cat", "")).lower() in tags)
                    and (not sites or provider_key(site.get("name", "")) in sites)
                ]
                if not data["sites"] and filename == (
                    "email-data.json" if kind == "email" else "wmn-data.json"
                ):
                    raise ValueError(
                        "Blackbird: Keine Websites für das gewählte Suchprofil."
                    )
            if params.get("identity_only"):
                for site in data["sites"]:
                    site["metadata"] = []
            file.write_text(json.dumps(data))
        if params.get("identity_only"):
            (work / "data" / "wmn-metadata.json").write_text(json.dumps({"sites": {}}))
        command = [
            "/opt/argus-tools/blackbird-venv/bin/python",
            str(work / "blackbird.py"),
            "--username" if kind == "username" else "--email",
            value,
            "--json",
            "--no-update",
            "--timeout",
            str(params.get("request_timeout", 12)),
            "--max-concurrent-requests",
            "20",
        ]
        stdout, stderr = bounded_run(
            command, int(params.get("run_timeout", 300)), cwd=work
        )
        files = list((work / "results").rglob("*.json"))
        rows = []
        for file in files:
            if file.stat().st_size > 8 * 1024 * 1024:
                raise ValueError("Blackbird-Bericht zu groß.")
            data = json.loads(file.read_text())
            if isinstance(data, list):
                rows.extend(data)
        # Upstream writes no JSON when there are zero positive results.
        if not files and "No accounts were found" not in stdout:
            raise ValueError("Blackbird lieferte keinen Ergebnisbericht.")
    result = positive_outputs(
        rows, node, "Blackbird", kind, bool(params.get("identity_only"))
    )
    diagnostic = re.sub(r"\x1b\[[0-9;]*m", "", stdout + "\n" + stderr)
    for line in diagnostic.splitlines():
        if re.search(
            r"rate.?limit|quota|timed? ?out|timeout|\bfailed\b|\berror\b|blocked|\b429\b|\b403\b",
            line,
            re.I,
        ):
            result.setdefault("warnings", []).append(
                "Blackbird: " + line.strip()[:1000]
            )
    result["warnings"] = list(dict.fromkeys(result.get("warnings", [])))[:40]
    result["log"] = json.dumps(rows, ensure_ascii=False) + "\n" + diagnostic
    return result


def validate(kind, value):
    if kind == "email":
        if len(value) > 254 or not re.fullmatch(
            r"[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+", value
        ):
            raise ValueError("Ungültige E-Mail-Adresse.")
    elif (
        not re.fullmatch(r"[\w.@+\-]{1,100}", value)
        or value.startswith("-")
        or value in (".", "..")
    ):
        raise ValueError("Ungültiger Benutzername.")


def ignorant(inputs, params, context):
    import phonenumbers

    node = inputs[0]
    raw = str(node["data"].get("value", "")).strip()
    region = params.get("phone_region") or None
    try:
        number = phonenumbers.parse(
            raw if raw.startswith("+") or region else "+" + raw, region
        )
    except phonenumbers.NumberParseException as exc:
        raise ValueError("Ungültige Telefonnummer.") from exc
    output, _ = bounded_run(
        [sys.executable, "-I", str(Path(__file__).with_name("_ignorant_runner.py"))],
        int(params.get("run_timeout", 300)),
        {
            "phone": str(number.national_number),
            "country_code": str(number.country_code),
            "request_timeout": int(params.get("request_timeout", 12)),
            "sites": params.get("sites", []),
        },
    )
    rows = json.loads(output)["rows"]
    outputs = []
    warnings = []
    for row in rows:
        name = str(row.get("name", "Anbieter"))
        source = {"tool": "Ignorant", "service": name, "result": row}
        if row.get("rateLimit") or row.get("error") or row.get("exists") is None:
            warnings.append(
                name + ": " + str(row.get("error") or "Rate-Limit / unbekannt")
            )
            continue
        if row.get("exists") is not True:
            continue
        if params.get("identity_only"):
            from plugins._profile import make_profile

            canonical = phonenumbers.format_number(
                number, phonenumbers.PhoneNumberFormat.E164
            )
            outputs.append(
                make_profile(
                    name,
                    "",
                    canonical,
                    {**node, "data": {"value": canonical}},
                    "Ignorant",
                    "phone",
                )
            )
            continue
        outputs.append(
            {
                "type": "value",
                "label": "Konto besteht?",
                "fact_key": "registration",
                "data": {"value": "Ja"},
                "relation": "Registrierungsbefund",
                "source_input": node["id"],
                "source": source,
            }
        )
        for key, value in row.items():
            if (
                key
                in (
                    "name",
                    "domain",
                    "method",
                    "frequent_rate_limit",
                    "rateLimit",
                    "exists",
                    "error",
                )
                or value is None
                or value == ""
            ):
                continue
            outputs.extend(
                fact_outputs(
                    value,
                    str(key),
                    {
                        "source_input": node["id"],
                        "source": source,
                        "relation": "Zusatzangabe",
                    },
                )
            )
    return {
        "outputs": outputs,
        "warnings": warnings,
        "log": json.dumps(rows, ensure_ascii=False),
    }
