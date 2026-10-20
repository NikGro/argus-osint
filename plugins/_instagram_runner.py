"""Read-only Instagram worker. Isolated dependencies, bounded requests, partial checkpoints."""

import contextlib
from html.parser import HTMLParser
import importlib.util
import json
import logging
from pathlib import Path
import re
import sys
import subprocess
import time
from urllib.parse import quote, urlsplit


class StopCollection(Exception):
    pass


def plain(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "dict"):
        return json.loads(value.json())
    return value


def text(value):
    if isinstance(value, bool):
        return "Ja" if value else "Nein"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


class _Completed(Exception):

    def __init__(self, value):
        self.value = value


class InstagramCollector:

    def __init__(self, payload):
        self.payload = payload

    def collect(self):
        try:
            self.configure()
            self.authenticate()
            self.load_identity()
            self.enrich_toutatis()
            self.collect_sections()
        except _Completed as finished:
            return finished.value

    def configure(self):
        import requests

        self.requests = requests
        from instagrapi import Client

        self.Client = Client
        self.spec = importlib.util.spec_from_file_location(
            "instagram_auth", Path(__file__).with_name("_instagram_auth.py")
        )
        self.auth = importlib.util.module_from_spec(self.spec)
        self.spec.loader.exec_module(self.auth)
        self.config = self.payload["settings"]
        self.outputs = []
        self.warnings = []
        self.counts = {}
        self.seen = set()
        self.start = time.monotonic()
        self.session = self.config.get("sessionid", "")
        self.checkpoint = Path(self.payload["checkpoint"])
        self.node_budget = self.payload["node_budget"]
        self.request_timeout = int(self.config["request_timeout"])
        self.client = self.Client()
        self.client.request_timeout = 1
        self.client.read_timeout = self.request_timeout
        self.client.delay_range = [0.5, 1.0]
        self.client.logger.disabled = True
        logging.disable(logging.CRITICAL)
        self.profile_url = (
            "https://www.instagram.com/" + self.payload["username"] + "/"
            if self.payload.get("username")
            else "https://www.instagram.com/web/friendships/show/?user_id="
            + self.payload["user_id"]
        )

    def authenticate(self):
        self.authenticated = False
        try:
            self.authenticated = self.auth.login(
                self.client,
                self.config,
                str(self.payload.get("transient", {}).get("verification_code", "")),
            )
            if self.authenticated:
                self.session = str(
                    self.client.cookie_dict.get("sessionid") or self.session
                )
                Path(self.payload["session_output"]).write_text(
                    json.dumps(self.client.get_settings())
                )
        except Exception as _caught_1:
            self.exc = _caught_1
            Path(self.payload["session_output"]).write_text(
                json.dumps(self.client.get_settings())
            )
            self.request = self.auth.input_request(self.exc)
            if self.request:
                raise _Completed(
                    {
                        "outputs": [],
                        "input_request": self.request,
                        "warnings": [],
                        "authenticated": False,
                    }
                )
            raise _Completed(
                {
                    "outputs": [],
                    "warnings": ["Anmeldung: " + self.safe_error(self.exc)],
                    "failed": True,
                    "authenticated": False,
                }
            )
        if self.payload.get("auth_only"):
            raise _Completed(
                {
                    "outputs": [],
                    "authenticated": self.authenticated,
                    "warnings": [],
                }
            )

    def load_identity(self):
        try:
            self.info = self.profile_info()
        except Exception as _caught_2:
            self.exc = _caught_2
            self.error("Profil", self.exc)
            if not (
                self.config.get("use_toutatis", True) and self.payload.get("username")
            ):
                raise _Completed(self.result())
            self.info = {"username": self.payload["username"]}
        if self.authenticated and self.config.get("include_contacts"):
            try:
                self.raw = self.client.private_request(
                    "users/"
                    + str(
                        self.info.get("pk")
                        or self.info.get("id")
                        or self.payload.get("user_id")
                    )
                    + "/info/"
                )
                if isinstance(self.raw.get("user"), dict):
                    self.info = {**self.info, **self.raw["user"]}
            except Exception as _caught_3:
                self.exc = _caught_3
                self.warnings.append("Kontaktdaten: " + self.safe_error(self.exc))
        self.username = str(
            self.info.get("username") or self.payload.get("username") or ""
        )
        self.user_id = str(
            self.info.get("pk")
            or self.info.get("id")
            or self.payload.get("user_id")
            or ""
        )
        if self.username:
            self.profile_url = "https://www.instagram.com/" + self.username + "/"
        self.toutatis = {"profile": {}, "recovery": {}, "warnings": []}

    def enrich_toutatis(self):
        if (
            self.config.get("use_toutatis", True)
            and self.username
            and any(
                (
                    self.config.get("include_" + key)
                    for key in ("profile", "contacts", "recovery")
                )
            )
        ):
            self.remaining = max(
                1,
                min(
                    25,
                    int(
                        self.config["run_timeout"] - (time.monotonic() - self.start) - 5
                    ),
                ),
            )
            try:
                self.response = subprocess.run(
                    [
                        sys.executable,
                        "-I",
                        str(Path(__file__).with_name("_toutatis_runner.py")),
                    ],
                    input=json.dumps(
                        {
                            "username": self.username,
                            "user_id": self.user_id,
                            "sessionid": self.session,
                            "profile": bool(
                                self.config.get("include_profile")
                                or self.config.get("include_contacts")
                            ),
                            "recovery": bool(self.config.get("include_recovery")),
                            "timeout": self.remaining,
                            "request_timeout": min(self.request_timeout, 10),
                        }
                    ),
                    text=True,
                    capture_output=True,
                    timeout=self.remaining + 2,
                    check=True,
                )
                if len(self.response.stdout) > 512 * 1024:
                    raise ValueError("Toutatis response too large")
                self.toutatis = json.loads(self.response.stdout)
                self.info = {
                    **self.info,
                    **self.toutatis.get("profile", {}),
                }
                self.warnings.extend(self.toutatis.get("warnings", []))
            except Exception as _caught_4:
                self.exc = _caught_4
                self.warnings.append(
                    "Toutatis-Ergänzung nicht verfügbar ("
                    + type(self.exc).__name__
                    + ")."
                )

    def collect_sections(self):
        try:
            for self.key, self.label, self.fn in [
                ("profile", "Allgemeine Profilinfos", self.profile),
                ("contacts", "Kontaktdaten", self.contacts),
                (
                    "recovery",
                    "Maskierte Wiederherstellungsangaben",
                    self.recovery,
                ),
                (
                    "followers",
                    "Follower",
                    lambda: self.accounts("followers", "Follower"),
                ),
                (
                    "following",
                    "Gefolgte Konten",
                    lambda: self.accounts("following", "Gefolgte Konten"),
                ),
                ("posts", "Beiträge", self.posts),
                ("highlights", "Highlight-Stories", self.highlights),
                ("stories", "Aktuelle Stories", self.stories),
            ]:
                if self.config["include_" + self.key]:
                    self.call_section(self.label, self.fn)
        except StopCollection as _caught_5:
            self.exc = _caught_5
            self.warnings.append(str(self.exc))
            if len(self.outputs) < self.node_budget + 1:
                self.outputs.append(
                    {
                        "type": "error",
                        "label": "Teilabruf",
                        "data": {"title": "Teilabruf", "message": str(self.exc)},
                        "relation": "Recherchehinweis",
                        "source": {"tool": "Argus Instagram"},
                    }
                )
        self.save()
        raise _Completed(self.result())

    def safe_error(self, exc):
        if str(exc) == "no_user_id":
            return "Instagram lieferte keine Profil-ID. Dieser Bereich benötigt eine zugängliche Profilantwort oder gültige Sitzung."
        name = type(exc).__name__
        if any(
            (
                word in name.lower()
                for word in (
                    "login",
                    "challenge",
                    "twofactor",
                    "password",
                    "consent",
                    "checkpoint",
                )
            )
        ):
            return "Anmeldung oder manuelle Bestätigung bei Instagram erforderlich. Sitzung im Plugin erneuern."
        if any((word in name.lower() for word in ("wait", "ratelimit", "throttl"))):
            return "Instagram begrenzt die Abfragen. Später erneut versuchen."
        if "notfound" in name.lower():
            return "Profil oder Inhalt nicht gefunden bzw. für diese Sitzung nicht sichtbar."
        if "private" in name.lower():
            return "Inhalt ist für diese Sitzung nicht zugänglich."
        return "Abruf nicht verfügbar (" + name + ")."

    def result(self):
        return {
            "outputs": self.outputs,
            "warnings": list(dict.fromkeys(self.warnings)),
            "counts": self.counts,
        }

    def save(self):
        temporary = self.checkpoint.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.result(), ensure_ascii=False))
        temporary.replace(self.checkpoint)

    def tick(self):
        if time.monotonic() - self.start > self.config["run_timeout"] - 5:
            raise StopCollection("Zeitlimit erreicht; Teilergebnisse gespeichert.")
        if len(self.outputs) >= self.node_budget:
            raise StopCollection(
                "Projektlimit erreicht; Teilergebnisse gespeichert. 0 hebt nur das Bereichslimit auf."
            )

    def path(self, *parts):
        return [{"id": str(key), "label": str(label)} for key, label in parts]

    def emit(
        self,
        kind,
        label,
        value,
        groups,
        relation="Instagram-Angabe",
        source_url="",
    ):
        self.tick()
        if value is None or value == "" or value == [] or (value == {}):
            return
        if kind in ("url", "image"):
            try:
                p = urlsplit(str(value))
                if (
                    p.scheme not in ("https", "http")
                    or not p.hostname
                    or p.username
                    or p.password
                ):
                    return
            except ValueError:
                return
        if kind == "image":
            data = {"filename": label, "file_id": "", "url": str(value)}
        elif kind == "error":
            data = {"title": label, "message": str(value)}
        else:
            data = {"value": text(value)}
        key = (
            kind,
            label,
            tuple((g["id"] for g in groups)),
            json.dumps(data, sort_keys=True),
        )
        if key in self.seen:
            return
        self.seen.add(key)
        self.outputs.append(
            {
                "type": kind,
                "label": label,
                "data": data,
                "relation": relation,
                "group_path": groups,
                "source": {
                    "tool": "Argus Instagram / instagrapi",
                    "service": "Instagram",
                    "plugin": "instagram",
                    "url": source_url or self.profile_url,
                },
            }
        )

    def error(self, section, exc):
        message = self.safe_error(exc) if isinstance(exc, Exception) else str(exc)
        self.warnings.append(section + ": " + message)
        section_key = {
            "Allgemeine Profilinfos": "profile",
            "Kontaktdaten": "contacts",
            "Maskierte Wiederherstellungsangaben": "recovery",
            "Follower": "followers",
            "Gefolgte Konten": "following",
            "Beiträge": "posts",
            "Highlight-Stories": "highlights",
            "Aktuelle Stories": "stories",
        }.get(section, section)
        self.emit(
            "error",
            section,
            message,
            self.path((section_key, section)),
            "Recherchehinweis",
        )
        self.save()

    def call_section(self, label, fn):
        try:
            self.tick()
            fn()
            self.save()
        except StopCollection:
            raise
        except Exception as exc:
            self.error(label, exc)

    def profile_info(self):
        try:
            return plain(
                self.client.user_info(self.payload["user_id"])
                if self.payload.get("user_id") and (not self.payload.get("username"))
                else self.client.user_info_by_username(self.payload["username"])
            )
        except Exception as primary:
            try:
                endpoint = (
                    "https://i.instagram.com/api/v1/users/"
                    + self.payload["user_id"]
                    + "/info/"
                    if self.payload.get("user_id")
                    and (not self.payload.get("username"))
                    else "https://www.instagram.com/api/v1/users/web_profile_info/?username="
                    + quote(self.payload["username"])
                )
                response = self.requests.get(
                    endpoint,
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "X-IG-App-ID": "936619743392459",
                        "Accept": "application/json",
                    },
                    cookies=({"sessionid": self.session} if self.session else {}),
                    timeout=self.request_timeout,
                    allow_redirects=False,
                )
                response.raise_for_status()
                data = response.json()
                user = data.get("user") or data.get("data", {}).get("user")
                if isinstance(user, dict) and (user.get("id") or user.get("pk")):
                    return user
            except Exception:
                # Preserve the original library failure below if this alternate
                # endpoint also fails; it is not converted into a successful result.
                pass
            if not self.config.get("browser_enabled") or not self.payload.get(
                "username"
            ):
                raise primary
            spec = importlib.util.spec_from_file_location(
                "argus_web", Path(__file__).with_name("_argus_web_runner.py")
            )
            web = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(web)
            page, url = web.browser_page(
                self.profile_url,
                min(
                    self.config["browser_timeout"],
                    max(
                        10,
                        int(
                            self.config["run_timeout"]
                            - (time.monotonic() - self.start)
                            - 8
                        ),
                    ),
                ),
            )

            class Scripts(HTMLParser):

                def __init__(self):
                    super().__init__()
                    self.inside = False
                    self.buffer = []
                    self.documents = []

                def handle_starttag(self, tag, attrs):
                    if tag == "script":
                        self.inside = True
                        self.buffer = []

                def handle_data(self, data):
                    if self.inside:
                        self.buffer.append(data)

                def handle_endtag(self, tag):
                    if tag == "script" and self.inside:
                        raw = "".join(self.buffer).strip()
                        self.inside = False
                        if raw.startswith(("{", "[")):
                            try:
                                self.documents.append(json.loads(raw))
                            except ValueError:
                                pass

            parser = Scripts()
            parser.feed(page)

            def find(value, depth=0):
                if depth > 22:
                    return None
                if isinstance(value, dict):
                    if str(value.get("username", "")).lower() == self.payload[
                        "username"
                    ].lower() and (value.get("pk") or value.get("id")):
                        return value
                    for child in value.values():
                        found = find(child, depth + 1)
                        if found:
                            return found
                elif isinstance(value, list):
                    for child in value[:1000]:
                        found = find(child, depth + 1)
                        if found:
                            return found

            for document in parser.documents:
                found = find(document)
                if found:
                    return found
            facts = web.extract_page(page, url)
            if any(
                (
                    marker in page[:250000].lower()
                    for marker in (
                        "challenge_required",
                        "login_required",
                        "accounts/login",
                        "checkpoint_required",
                    )
                )
            ):
                self.warnings.append(
                    "Browser: Instagram zeigt eine Login- oder Bestätigungsseite; nur erkennbare öffentliche Metadaten verfügbar."
                )
            document_title = str(facts.get("Seitentitel", "")).casefold()
            if not facts or self.payload["username"].casefold() not in document_title:
                raise primary
            return {"username": self.payload["username"], "_web_facts": facts}

    def field(self, info, key, label, groups, kind="value"):
        value = info.get(key)
        if value is not None and value != "":
            self.emit(kind, label, value, groups)

    def profile(self):
        groups = self.path(("profile", "Allgemeine Profilinfos"))
        for key, label in [
            ("username", "Benutzername"),
            ("full_name", "Name"),
            ("nickname", "Spitzname"),
            ("biography", "Biografie"),
            ("pronouns", "Pronomen"),
            ("follower_count", "Follower-Anzahl"),
            ("following_count", "Gefolgte-Anzahl"),
            ("media_count", "Beitragsanzahl"),
            ("is_private", "Privates Konto"),
            ("is_verified", "Instagram-verifiziert"),
            ("is_business", "Geschäftskonto"),
            ("category", "Kategorie"),
            ("account_type", "Kontotyp"),
            ("is_memorialized", "Gedenkkonto"),
        ]:
            self.field(self.info, key, label, groups)
        if self.user_id:
            self.emit("value", "Instagram-ID", self.user_id, groups)
        self.emit("url", "Profil-URL", self.profile_url, groups)
        pic = (
            self.info.get("profile_pic_url_hd")
            or (self.info.get("hd_profile_pic_url_info") or {}).get("url")
            or self.info.get("profile_pic_url")
        )
        if pic:
            self.emit("image", "Profilbild", pic, groups)
        for key in ("external_url", "bio_links"):
            value = self.info.get(key)
            if isinstance(value, list):
                for index, item in enumerate(value):
                    if isinstance(item, dict):
                        self.emit(
                            "url",
                            item.get("title") or "Profil-Link " + str(index + 1),
                            item.get("url"),
                            groups,
                        )
            elif value:
                self.emit("url", "Profil-Link", value, groups)
        aliases = {
            "follower_count": "edge_followed_by",
            "following_count": "edge_follow",
            "media_count": "edge_owner_to_timeline_media",
        }
        for key, alias in aliases.items():
            if key not in self.info and isinstance(self.info.get(alias), dict):
                self.emit(
                    "value",
                    {
                        "follower_count": "Follower-Anzahl",
                        "following_count": "Gefolgte-Anzahl",
                        "media_count": "Beitragsanzahl",
                    }[key],
                    self.info[alias].get("count"),
                    groups,
                )
        for key, value in self.info.get("_web_facts", {}).items():
            self.emit(
                (
                    "image"
                    if re.search("bild|avatar", key, re.I)
                    else (
                        "url"
                        if str(value).startswith(("https://", "http://"))
                        else "value"
                    )
                ),
                key,
                value,
                groups,
            )

    def contacts(self):
        groups = self.path(("contacts", "Kontaktdaten"))
        before = len(self.outputs)
        for key, label in [
            ("public_email", "Öffentliche E-Mail"),
            ("business_email", "Geschäftliche E-Mail"),
        ]:
            if self.info.get(key):
                self.emit("email", label, self.info[key], groups)
        for key, label in [
            ("public_phone_number", "Öffentliche Telefonnummer"),
            ("contact_phone_number", "Kontakttelefonnummer"),
            ("business_phone_number", "Geschäftliche Telefonnummer"),
        ]:
            value = str(self.info.get(key) or "").strip()
            if value:
                prefix = str(self.info.get("public_phone_country_code") or "").strip()
                if prefix and (not value.startswith("+")):
                    value = "+" + prefix + " " + value
                self.emit("phone", label, value, groups)
        for key, label in [
            ("business_contact_method", "Kontaktmethode"),
            ("is_whatsapp_linked", "WhatsApp verknüpft"),
        ]:
            self.field(self.info, key, label, groups)
        bio = str(self.info.get("biography") or "")
        for email in sorted(
            set(
                re.findall(
                    "[A-Za-z0-9.!#$%&\\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
                    bio,
                )
            )
        ):
            self.emit("email", "E-Mail in Biografie", email, groups)
        if len(self.outputs) == before:
            self.emit(
                "error",
                "Keine Kontaktdaten",
                "Keine öffentlichen Kontaktdaten in der zugänglichen Profilantwort.",
                groups,
                "Recherchehinweis",
            )

    def recovery(self):
        groups = self.path(("recovery", "Maskierte Wiederherstellungsangaben"))
        before = len(self.outputs)
        for key, label in [
            ("obfuscated_email", "Maskierte Wiederherstellungs-E-Mail"),
            ("obfuscated_phone", "Maskierte Wiederherstellungs-Telefonnummer"),
        ]:
            if self.toutatis.get("recovery", {}).get(key):
                self.emit("value", label, self.toutatis["recovery"][key], groups)
                self.outputs[-1]["source"].update(
                    tool="Toutatis", version="1.31", masked=True, skip_recovery=True
                )
        if len(self.outputs) == before:
            self.emit(
                "error",
                "Wiederherstellungsangaben nicht verfügbar",
                (
                    "Toutatis lieferte keine maskierten Angaben."
                    if self.config.get("use_toutatis", True)
                    else "Toutatis ist in den Plugin-Einstellungen deaktiviert."
                ),
                groups,
                "Recherchehinweis",
            )

    def accounts(self, section, label):
        if not self.user_id:
            raise ValueError("no_user_id")
        amount = self.config[section + "_limit"]
        count = 0
        iterator = (
            getattr(self.client, "iter_user_" + section + "_v1", None)
            if self.authenticated
            else None
        )
        if iterator:
            items = iterator(self.user_id, amount=amount, page_size=50)
        else:
            values = getattr(self.client, "user_" + section)(
                self.user_id, amount=amount
            )
            items = values.values() if isinstance(values, dict) else values
        unique = set()
        for model in items:
            self.tick()
            user = plain(model)
            name = str(user.get("username") or "")
            pk = str(user.get("pk") or "")
            if not name or (pk or name.casefold()) in unique:
                continue
            unique.add(pk or name.casefold())
            groups = self.path(
                (section, label), (section + ":" + (pk or name.casefold()), name)
            )
            url = "https://www.instagram.com/" + name + "/"
            self.emit("username", "Benutzername", name, groups, source_url=url)
            self.emit("url", "Profil-URL", url, groups, source_url=url)
            count += 1
            if count % 10 == 0:
                self.save()
            if amount and count >= amount:
                break
        self.counts[section] = count
        if not count:
            self.emit(
                "error",
                label,
                "Keine Konten zurückgegeben. Dies bestätigt keine leere Liste; Sichtbarkeit und Anmeldung können den Abruf einschränken.",
                self.path((section, label)),
                "Recherchehinweis",
            )

    def media_fields(self, media, groups, url):
        self.emit("url", "URL", url, groups, source_url=url)
        if media.get("caption_text"):
            self.emit(
                "value", "Beschreibung", media["caption_text"], groups, source_url=url
            )
        stamp = media.get("taken_at") or media.get("taken_at_utc")
        if stamp:
            self.emit("value", "Veröffentlicht", stamp, groups, source_url=url)
        picture = media.get("thumbnail_url") or media.get("display_url")
        if picture:
            self.emit("image", "Bild", picture, groups, source_url=url)
        if media.get("video_url"):
            self.emit("url", "Video", media["video_url"], groups, source_url=url)
        for index, resource in enumerate(media.get("resources") or []):
            resource = plain(resource)
            if resource.get("thumbnail_url"):
                self.emit(
                    "image",
                    "Bild " + str(index + 1),
                    resource["thumbnail_url"],
                    groups,
                    source_url=url,
                )
            if resource.get("video_url"):
                self.emit(
                    "url",
                    "Video " + str(index + 1),
                    resource["video_url"],
                    groups,
                    source_url=url,
                )
        for key, label in [
            ("like_count", "Likes"),
            ("comment_count", "Kommentaranzahl"),
        ]:
            self.field(media, key, label, groups)

    def posts(self):
        if not self.user_id:
            raise ValueError("no_user_id")
        amount = self.config["posts_limit"]
        count = 0
        unique = set()
        feed = self.client.iter_user_medias(
            self.user_id, amount=amount + 3 if amount else 0, page_size=12
        )
        if amount:
            feed = sorted(
                feed,
                key=lambda item: str(plain(item).get("taken_at") or ""),
                reverse=True,
            )[:amount]
        for model in feed:
            self.tick()
            media = plain(model)
            pk = str(media.get("pk") or media.get("id") or "")
            code = media.get("code")
            if pk in unique:
                continue
            unique.add(pk)
            count += 1
            url = (
                "https://www.instagram.com/p/" + code + "/"
                if code
                else self.profile_url
            )
            groups = self.path(
                ("posts", "Beiträge"), ("post:" + pk, code or "Beitrag " + pk)
            )
            self.media_fields(media, groups, url)
            if pk:
                comment_count = 0
                try:
                    comments = self.client.media_comments(
                        media.get("id") or pk,
                        amount=self.config["comments_limit"],
                    )
                    for item in comments:
                        self.tick()
                        comment = plain(item)
                        cid = str(comment.get("pk") or comment_count)
                        cg = groups + [
                            {"id": "comments:" + pk, "label": "Kommentare"},
                            {"id": "comment:" + cid, "label": "Kommentar " + cid},
                        ]
                        user = plain(comment.get("user") or {})
                        if user.get("username"):
                            self.emit(
                                "username",
                                "Benutzername",
                                user["username"],
                                cg,
                                source_url=url,
                            )
                            self.emit(
                                "url",
                                "Profil-URL",
                                "https://www.instagram.com/" + user["username"] + "/",
                                cg,
                                source_url=url,
                            )
                        if comment.get("text"):
                            self.emit(
                                "value",
                                "Kommentar",
                                comment["text"],
                                cg,
                                source_url=url,
                            )
                        if comment.get("created_at_utc"):
                            self.emit(
                                "value",
                                "Zeitpunkt",
                                comment["created_at_utc"],
                                cg,
                                source_url=url,
                            )
                        comment_count += 1
                        if (
                            self.config["comments_limit"]
                            and comment_count >= self.config["comments_limit"]
                        ):
                            break
                    if not comment_count:
                        self.emit(
                            "value",
                            "Kommentarabruf",
                            "Keine Kommentare zurückgegeben.",
                            groups + [{"id": "comments:" + pk, "label": "Kommentare"}],
                            source_url=url,
                        )
                except StopCollection:
                    raise
                except Exception as exc:
                    self.emit(
                        "error",
                        "Kommentare",
                        self.safe_error(exc),
                        groups + [{"id": "comments:" + pk, "label": "Kommentare"}],
                        "Recherchehinweis",
                        url,
                    )
            self.save()
            if amount and count >= amount:
                break
        self.counts["posts"] = count
        if not count:
            self.emit(
                "value",
                "Beitragsabruf",
                "Keine Beiträge zurückgegeben.",
                self.path(("posts", "Beiträge")),
            )

    def story_fields(self, model, groups):
        story = plain(model)
        pk = str(story.get("pk") or story.get("id") or "")
        url = (
            "https://www.instagram.com/stories/" + self.username + "/" + pk + "/"
            if self.username and pk
            else self.profile_url
        )
        self.media_fields(story, groups, url)
        for index, item in enumerate(story.get("links") or []):
            item = plain(item)
            self.emit(
                "url",
                "Story-Link " + str(index + 1),
                item.get("webUri") or item.get("web_uri"),
                groups,
                source_url=url,
            )
        return pk

    def stories(self):
        if not self.user_id:
            raise ValueError("no_user_id")
        amount = self.config["stories_limit"]
        items = self.client.user_stories(self.user_id, amount=None)
        items = sorted(
            items, key=lambda item: str(plain(item).get("taken_at") or ""), reverse=True
        )
        count = 0
        for item in items:
            self.tick()
            pk = str(plain(item).get("pk") or plain(item).get("id") or count)
            self.story_fields(
                item,
                self.path(
                    ("stories", "Aktuelle Stories"), ("story:" + pk, "Story " + pk)
                ),
            )
            count += 1
            self.save()
            if amount and count >= amount:
                break
        self.counts["stories"] = count
        if not count:
            self.emit(
                "value",
                "Story-Abruf",
                "Keine aktuellen Stories zurückgegeben.",
                self.path(("stories", "Aktuelle Stories")),
            )

    def highlights(self):
        if not self.user_id:
            raise ValueError("no_user_id")
        amount = self.config["highlights_limit"]
        items = self.client.user_highlights(self.user_id, amount=0)
        items = sorted(
            items,
            key=lambda item: str(plain(item).get("latest_reel_media") or ""),
            reverse=True,
        )
        count = 0
        for item in items:
            self.tick()
            highlight = plain(item)
            pk = str(highlight.get("pk") or highlight.get("id") or "")
            groups = self.path(
                ("highlights", "Highlight-Stories"),
                ("highlight:" + pk, highlight.get("title") or "Highlight " + pk),
            )
            self.emit(
                "url",
                "Highlight-URL",
                "https://www.instagram.com/stories/highlights/"
                + pk.removeprefix("highlight:")
                + "/",
                groups,
            )
            detail = plain(self.client.highlight_info(pk))
            stories = sorted(
                detail.get("items") or [],
                key=lambda story: str(plain(story).get("taken_at") or ""),
                reverse=True,
            )
            for index, story in enumerate(stories):
                if (
                    self.config["highlight_items_limit"]
                    and index >= self.config["highlight_items_limit"]
                ):
                    break
                sid = str(plain(story).get("pk") or index)
                self.story_fields(
                    story,
                    groups
                    + [{"id": "highlight-story:" + sid, "label": "Story " + sid}],
                )
                self.save()
            count += 1
            if amount and count >= amount:
                break
        self.counts["highlights"] = count
        if not count:
            self.emit(
                "value",
                "Highlight-Abruf",
                "Keine Highlights zurückgegeben.",
                self.path(("highlights", "Highlight-Stories")),
            )


def run(payload):
    return InstagramCollector(payload).collect()


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            response = run(payload)
        json.dump(response, sys.stdout, ensure_ascii=False)
    except Exception:
        json.dump(
            {
                "outputs": [],
                "warnings": [
                    "Instagram-Worker fehlgeschlagen. Sitzung und Plugin-Konfiguration prüfen."
                ],
            },
            sys.stdout,
        )
