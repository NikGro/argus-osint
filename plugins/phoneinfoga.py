from core import tools
import re
import phonenumbers
from urllib.parse import urlparse, parse_qs
from plugins._process import bounded_run

PLUGIN = {
    "id": "phoneinfoga",
    "name": "Check phone number - PhoneInfoga",
    "description": "Analyze phone numbers and collect direct search results and provider findings.",
    "actions": [
        {
            "id": "scan",
            "name": "Check phone number with PhoneInfoga",
            "inputs": ["phone", "value"],
            "external": True,
            "external_notice": "The phone number is sent to enabled scanners. Search links are not confirmed matches.",
            "default_params": {
                "phone_region": "",
                "disabled_scanners": [],
                "numverify_api_key": "",
                "googlecse_api_key": "",
                "googlecse_cx": "",
            },
        }
    ],
}


def parse_output(text, node):
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    outputs = []
    seen = set()
    group = "PhoneInfoga"
    errors = False
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line == "The following scanners returned errors:":
            errors = True
            continue
        if errors:
            continue
        heading = re.match(
            r"^(?:Results for |\[|Scanner:\s*)([A-Za-z][A-Za-z0-9_-]*)(?:\]|\s*$)", line
        )
        if heading:
            group = "PhoneInfoga · " + heading.group(1)
        common = {
            "source_input": node["id"],
            "group": group,
            "source": {
                "tool": "PhoneInfoga",
                "service": group.removeprefix("PhoneInfoga · "),
                "line": line,
            },
        }
        for url in re.findall(r'https?://[^\s<>"\x1b]+', line):
            url = url.rstrip(").,;]")
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            # Generated search queries are not findings. Keep only direct reported result URLs.
            if (
                "google." in host
                or host
                in (
                    "bing.com",
                    "www.bing.com",
                    "duckduckgo.com",
                    "www.duckduckgo.com",
                    "search.yahoo.com",
                )
            ) and (
                parsed.path.startswith(("/search", "/url"))
                or "q" in parse_qs(parsed.query)
            ):
                continue
            if url in seen:
                continue
            seen.add(url)
            kind = "Profile URL"
            outputs.append(
                {
                    **common,
                    "type": "url",
                    "label": "PhoneInfoga · " + kind,
                    "data": {"value": url},
                    "relation": kind,
                }
            )
        match = re.match(
            r"^(?:[│├└─+\-\[\]> ]*)([A-Za-z][A-Za-z0-9 _/.-]{1,60}):\s*(.+)$", line
        )
        if match and not re.search(r"https?://", match.group(2)):
            outputs.append(
                {
                    **common,
                    "type": "value",
                    "label": match.group(1).strip(),
                    "data": {"value": match.group(2).strip()},
                    "relation": "Phone finding",
                }
            )
    outputs.append(
        {
            "type": "value",
            "label": "PhoneInfoga · Search record",
            "data": {"value": text.strip()},
            "source_input": node["id"],
            "source": {"tool": "PhoneInfoga"},
            "relation": "Search record",
        }
    )
    return outputs


def run(action, inputs, params, context):
    if action != "scan" or len(inputs) != 1:
        raise ValueError("PhoneInfoga requires exactly one phone number input.")
    node = inputs[0]
    raw = str(node["data"].get("value", "")).strip()
    if not re.fullmatch(r"\+?[0-9 ()-]{6,30}", raw):
        raise ValueError(
            "Invalid phone number; include the international dialing code."
        )
    region = str(params.get("phone_region", "")).upper()
    if region and region not in phonenumbers.SUPPORTED_REGIONS:
        raise ValueError("Invalid country calling code.")
    if region and not raw.startswith("+"):
        try:
            raw = phonenumbers.format_number(
                phonenumbers.parse(raw, region), phonenumbers.PhoneNumberFormat.E164
            )
        except phonenumbers.NumberParseException as exc:
            raise ValueError("Invalid phone number.") from exc
    number = re.sub(r"[ ()-]", "", raw)
    if not re.fullmatch(r"\+?[1-9][0-9]{5,14}", number):
        raise ValueError(
            "Invalid phone number; include the international dialing code."
        )
    disabled = params.get("disabled_scanners", [])
    if (
        not isinstance(disabled, list)
        or len(disabled) > 20
        or any(
            not isinstance(s, str) or not re.fullmatch("[a-z][a-z0-9_-]*", s)
            for s in disabled
        )
    ):
        raise ValueError("Invalid scanner list.")
    executable = tools.executable("phoneinfoga", "phoneinfoga")
    command = [executable, "scan", "-n", number]
    for scanner in disabled:
        command.extend(["--disable", scanner])
    extra = {
        env: str(params[key])
        for key, env in [
            ("numverify_api_key", "NUMVERIFY_API_KEY"),
            ("googlecse_api_key", "GOOGLE_API_KEY"),
            ("googlecse_cx", "GOOGLECSE_CX"),
        ]
        if params.get(key)
    }
    output, stderr = bounded_run(command, None, extra_env=extra)
    for secret in extra.values():
        output = output.replace(secret, "[redacted]")
        stderr = stderr.replace(secret, "[redacted]")
    warnings = [stderr.strip()] if stderr.strip() else []
    if "The following scanners returned errors:" in output:
        warnings.append(
            output.split("The following scanners returned errors:", 1)[1].strip()
        )
    return {"outputs": parse_output(output, node), "warnings": warnings, "log": output}


PLUGIN["hidden"] = True
