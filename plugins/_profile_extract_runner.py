"""Maigret's existing socid extractor, applied to one public profile URL only."""

import contextlib
import ipaddress
import json
import socket
import sys
import urllib.request
from urllib.parse import urlsplit


def public_url(url):
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Öffentliche HTTP(S)-Profil-URL erforderlich.")
    for entry in socket.getaddrinfo(
        p.hostname,
        p.port or (443 if p.scheme == "https" else 80),
        type=socket.SOCK_STREAM,
    ):
        if not ipaddress.ip_address(entry[4][0]).is_global:
            raise ValueError("Interne Adressen sind keine öffentlichen Profilseiten.")
    return url


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def extract_one(payload):
    from socid_extractor import extract

    # Extraction is from this fetched document. Disable postprocessors that may pivot to other accounts.
    import socid_extractor.main as main

    main.POSTPROCESSORS = []
    from socid_extractor import mutate_url

    facts = {}
    failures = []
    targets = [(payload["url"], {})] + list(mutate_url(payload["url"]))[:5]
    for url, headers in targets:
        try:
            request = urllib.request.Request(
                public_url(url),
                headers={
                    "User-Agent": "Argus/0.17 (public profile research)",
                    "Accept": "text/html,application/json",
                    **dict(headers),
                },
            )
            with urllib.request.build_opener(PublicRedirect()).open(
                request, timeout=payload["request_timeout"]
            ) as response:
                content = response.read(4 * 1024 * 1024 + 1)
                if len(content) > 4 * 1024 * 1024:
                    raise ValueError("Profilseite größer als 4 MiB.")
                page = content.decode(
                    response.headers.get_content_charset() or "utf-8", errors="replace"
                )
            for key, value in extract(page).items():
                if key not in facts:
                    facts[key] = value
        except Exception as exc:
            failures.append(str(exc))
    if len(failures) == len(targets):
        raise ValueError("; ".join(failures))
    return facts


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        facts = extract_one(payload)
    json.dump(facts, sys.stdout, ensure_ascii=False, default=str)
