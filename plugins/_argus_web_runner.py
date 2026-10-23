"""Bounded public-page enrichment using Open Graph, Twitter cards and JSON-LD."""

import contextlib
from html.parser import HTMLParser
import json
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urljoin

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LIMIT = 4 * 1024 * 1024


def public_url(url):
    from core.public_network import destination

    destination(url)
    return url


def get_page(url, timeout):
    from core.public_network import request

    response = request(url, timeout=timeout, limit=LIMIT)
    if response["status"] >= 400:
        raise ValueError("Public page HTTP " + str(response["status"]))
    from email.message import Message

    content_type = Message()
    content_type["content-type"] = next(
        (
            value
            for key, value in response["headers"].items()
            if key.lower() == "content-type"
        ),
        "",
    )
    charset = content_type.get_content_charset() or "utf-8"
    try:
        page = response["body"].decode(charset, errors="replace")
    except LookupError:
        page = response["body"].decode("utf-8", errors="replace")
    return page, response["url"]


def browser_page(url, timeout):
    from core.isolation import invoke

    payload = invoke("browser", {"url": url, "timeout": timeout}, timeout=timeout + 25)
    if int(payload.get("status", 200)) >= 400:
        raise ValueError("Public page HTTP " + str(payload["status"]))
    return payload["html"], payload["url"]


def blocked(page):
    lower = page[:250000].lower()
    return any(
        marker in lower
        for marker in (
            "cf-chl-",
            "challenge-platform/",
            'id="challenge-running"',
            "checking your browser",
            "verify you are human",
            "access denied |",
        )
    )


class PageData(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.jsonld = []
        self.script = None
        self.buffer = []
        self.title = []
        self.in_title = False
        self.avatars = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = (
                a.get("property") or a.get("name") or a.get("itemprop") or ""
            ).casefold()
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"].strip())
        elif tag == "script" and (a.get("type") or "").lower() == "application/ld+json":
            self.script = True
            self.buffer = []
        elif tag == "title":
            self.in_title = True
        elif tag == "img":
            hint = " ".join(
                str(a.get(k, "")) for k in ("class", "id", "alt", "itemprop")
            ).casefold()
            if re.search(
                r"avatar|profile.?picture|profile.?photo|profile.?image", hint
            ) and not re.search(r"logo|banner", hint):
                url = a.get("src") or a.get("data-src")
                if url and len(self.avatars) < 8:
                    self.avatars.append(url)

    def handle_endtag(self, tag):
        if tag == "script" and self.script:
            text = "".join(self.buffer)
            if len(text) <= 256000 and len(self.jsonld) < 32:
                try:
                    self.jsonld.append(json.loads(text))
                except (ValueError, TypeError):
                    pass
            self.script = None
            self.buffer = []
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.script and sum(map(len, self.buffer)) <= 256000:
            self.buffer.append(data)
        if self.in_title and sum(map(len, self.title)) < 2000:
            self.title.append(data)


def web_url(value, base):
    if isinstance(value, dict):
        value = value.get("url") or value.get("contentUrl") or value.get("@id")
    if not isinstance(value, str):
        return ""
    value = urljoin(base, value.strip())
    try:
        p = urlsplit(value)
    except ValueError:
        return ""
    return (
        value
        if p.scheme in ("http", "https")
        and p.hostname
        and not p.username
        and not p.password
        else ""
    )


def extract_page(page, url):
    parser = PageData()
    parser.feed(page)
    facts = {}
    meta = parser.meta
    images = set()

    def image(value, label):
        if isinstance(value, list):
            for item in value[:8]:
                image(item, label)
            return
        value = web_url(value, url)
        if re.search(
            r"(?:default|placeholder|blank)[_-]?(?:avatar|profile)|(?:avatar|profile)[_-]?(?:default|placeholder|blank)",
            value,
            re.I,
        ):
            return
        if value and value not in images:
            images.add(value)
            name = label if label not in facts else label + " " + str(len(images))
            facts[name] = value

    title = (
        meta.get("og:title")
        or meta.get("twitter:title")
        or "".join(parser.title).strip()
    )
    description = (
        meta.get("og:description")
        or meta.get("twitter:description")
        or meta.get("description")
    )
    if title:
        facts["Seitentitel"] = title[:3000]
    if description:
        facts["Seitenbeschreibung"] = description[:12000]
    nodes = []

    def visit(value, depth=0):
        if depth > 5 or len(nodes) > 100:
            return
        if isinstance(value, list):
            for child in value[:50]:
                visit(child, depth + 1)
        elif isinstance(value, dict):
            types = value.get("@type", [])
            types = (
                [types]
                if isinstance(types, str)
                else types if isinstance(types, list) else []
            )
            if any(
                str(t).split("/")[-1] in ("ProfilePage", "Person", "Organization")
                for t in types
            ):
                nodes.append(value)
            for key in ("@graph", "mainEntity", "author", "about"):
                if key in value:
                    visit(value[key], depth + 1)

    for entry in parser.jsonld:
        visit(entry)
    for node in nodes:
        for field, label in [
            ("name", "Name"),
            ("alternateName", "Benutzername"),
            ("description", "Biografie"),
            ("identifier", "Profil-ID"),
            ("jobTitle", "Beruf"),
            ("homeLocation", "Wohnort"),
            ("location", "Ort"),
            ("address", "Adresse"),
            ("knowsLanguage", "Sprachen"),
            ("sameAs", "Verknüpfte Profile"),
        ]:
            value = node.get(field)
            if value is not None and value != "":
                facts.setdefault(label, value)
        image(node.get("image"), "Profilbild")
    for value in parser.avatars:
        image(value, "Profilbild")
    for key in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
        value = meta.get(key)
        if value:
            image(
                value,
                (
                    "Profilbild"
                    if re.search(
                        r"avatar|profile[_-]?image|jtv_user_pictures", value, re.I
                    )
                    else "Vorschaubild"
                ),
            )
    return facts


def collect(payload):
    from core.errors import AppError

    url = public_url(payload["url"])
    warnings = []
    browser_enabled = bool(payload.get("browser_enabled", True))
    browser = False
    try:
        page, final = get_page(url, int(payload["request_timeout"]))
        if blocked(page):
            raise ValueError("Die Profilseite liefert eine Bot-Prüfung.")
    except (AppError, OSError, ValueError) as exc:
        if isinstance(exc, urllib.error.HTTPError) and exc.code not in (403, 503):
            raise ValueError(
                "Profilseite nicht verfügbar: HTTP " + str(exc.code)
            ) from exc
        if not browser_enabled:
            raise ValueError(
                str(exc) + " Eingebauter Browser ist deaktiviert."
            ) from exc
        page, final = browser_page(url, int(payload.get("browser_timeout", 60)))
        browser = True
    if any(
        part in ("login", "signin", "signup", "auth", "oauth")
        for part in urlsplit(final).path.lower().split("/")
    ):
        raise ValueError(
            "Die Profilseite leitet zur Anmeldung weiter; keine öffentlichen Profildaten verfügbar."
        )
    if blocked(page):
        raise ValueError(
            "Die Bot-Prüfung wurde nicht gelöst; keine Profildaten ausgewertet."
        )
    facts = extract_page(page, final)
    # Title alone is not meaningful profile enrichment; a configured browser may render the page.
    if (
        browser_enabled
        and not browser
        and not any(k not in ("Seitentitel",) for k in facts)
    ):
        try:
            rendered, rendered_url = browser_page(
                url, int(payload.get("browser_timeout", 60))
            )
            if not blocked(rendered):
                facts.update(extract_page(rendered, rendered_url))
                browser = True
        except (AppError, OSError, ValueError) as exc:
            warnings.append(str(exc))
    if not any(k not in ("Seitentitel",) for k in facts):
        facts = {}
    return {
        "facts": facts,
        "warnings": warnings,
        "mode": "browser" if browser else "http",
        "url": final,
    }


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        result = collect(payload)
    json.dump(result, sys.stdout, ensure_ascii=False, default=str)
