"""Bounded adapter for upstream Toutatis; never invokes recovery/reset endpoints."""

import contextlib
import json
import sys
import time
from urllib.parse import parse_qs, urlsplit


def collect(payload, core=None, requests_module=None):
    if core is None:
        import toutatis.core as core
    if requests_module is None:
        import requests as requests_module
    deadline = time.monotonic() + payload.get("timeout", 20)
    original_requests = core.requests

    class BoundedRequests:
        exceptions = requests_module.exceptions

        @staticmethod
        def request(method, url, **kwargs):
            parsed = urlsplit(url)
            if (
                parsed.scheme != "https"
                or parsed.hostname != "i.instagram.com"
                or parsed.username
                or parsed.password
            ):
                raise ValueError("Unexpected Toutatis endpoint")
            if method == "post":
                if parsed.path != "/api/v1/users/lookup/":
                    raise ValueError("Recovery endpoints are not allowed")
                data = kwargs.get("data", "")
                signed = (
                    (parse_qs(data).get("signed_body") or [""])[0]
                    if isinstance(data, str)
                    else data.get("signed_body", "")
                )
                body = json.loads(signed.removeprefix("SIGNATURE."))
                if (
                    str(body.get("skip_recovery")) != "1"
                    or body.get("q") != payload["username"]
                ):
                    raise ValueError("Lookup must disable recovery")
                if payload.get("sessionid"):
                    kwargs.setdefault("cookies", {})["sessionid"] = payload["sessionid"]
            elif not (
                parsed.path.startswith("/api/v1/users/")
                and (
                    parsed.path.endswith("/info/")
                    or parsed.path.endswith("/web_profile_info/")
                )
            ):
                raise ValueError("Unexpected Toutatis profile endpoint")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Toutatis deadline")
            kwargs.update(
                timeout=min(remaining, payload.get("request_timeout", 10)),
                allow_redirects=False,
            )
            response = getattr(requests_module, method)(url, **kwargs)
            response.raise_for_status()
            return response

        @classmethod
        def get(cls, url, **kwargs):
            return cls.request("get", url, **kwargs)

        @classmethod
        def post(cls, url, **kwargs):
            return cls.request("post", url, **kwargs)

    result = {"profile": {}, "recovery": {}, "warnings": []}
    core.requests = BoundedRequests
    try:
        if payload.get("sessionid") and payload.get("profile"):
            try:
                info = core.getInfo(
                    payload.get("user_id") or payload["username"],
                    payload["sessionid"],
                    searchType="id" if payload.get("user_id") else "username",
                )
                if isinstance(info.get("user"), dict):
                    result["profile"] = info["user"]
                else:
                    result["warnings"].append(
                        "Toutatis: Profilergänzung nicht verfügbar."
                    )
            except Exception as exc:
                result["warnings"].append(
                    "Toutatis: Profilergänzung fehlgeschlagen ("
                    + type(exc).__name__
                    + ")."
                )
        if payload.get("recovery"):
            try:
                response = core.advanced_lookup(payload["username"])

                def fields(data, depth=0):
                    if not isinstance(data, dict) or depth > 3:
                        return
                    for key in ("obfuscated_email", "obfuscated_phone"):
                        value = data.get(key)
                        if isinstance(value, str) and value.strip():
                            result["recovery"].setdefault(key, value.strip()[:500])
                    for key in ("user", "data", "result"):
                        fields(data.get(key), depth + 1)

                fields(response)
                if not result["recovery"]:
                    result["warnings"].append(
                        "Toutatis: Keine maskierten Wiederherstellungsangaben verfügbar; Instagram kann den Abruf begrenzen."
                    )
            except Exception as exc:
                result["warnings"].append(
                    "Toutatis: Wiederherstellungsangaben nicht verfügbar ("
                    + type(exc).__name__
                    + ")."
                )
    finally:
        core.requests = original_requests
    return result


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = collect(payload)
    except Exception as exc:
        result = {
            "profile": {},
            "recovery": {},
            "warnings": [
                "Toutatis konnte nicht geladen werden (" + type(exc).__name__ + ")."
            ],
        }
    json.dump(result, sys.stdout, ensure_ascii=False)
