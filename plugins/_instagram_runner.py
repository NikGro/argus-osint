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


def run(payload):
    import requests
    from instagrapi import Client

    spec = importlib.util.spec_from_file_location(
        "instagram_auth", Path(__file__).with_name("_instagram_auth.py")
    )
    auth = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auth)
    config = payload["settings"]
    outputs = []
    warnings = []
    counts = {}
    seen = set()
    start = time.monotonic()
    session = config.get("sessionid", "")
    checkpoint = Path(payload["checkpoint"])
    node_budget = payload["node_budget"]
    request_timeout = int(config["request_timeout"])
    client = Client()
    client.request_timeout = 1
    client.read_timeout = request_timeout
    client.delay_range = [0.5, 1.0]
    client.logger.disabled = True
    logging.disable(logging.CRITICAL)

    def safe_error(exc):
        if str(exc) == "no_user_id":
            return "Instagram lieferte keine Profil-ID. Dieser Bereich benötigt eine zugängliche Profilantwort oder gültige Sitzung."
        name = type(exc).__name__
        if any(
            word in name.lower()
            for word in (
                "login",
                "challenge",
                "twofactor",
                "password",
                "consent",
                "checkpoint",
            )
        ):
            return "Anmeldung oder manuelle Bestätigung bei Instagram erforderlich. Sitzung im Plugin erneuern."
        if any(word in name.lower() for word in ("wait", "ratelimit", "throttl")):
            return "Instagram begrenzt die Abfragen. Später erneut versuchen."
        if "notfound" in name.lower():
            return "Profil oder Inhalt nicht gefunden bzw. für diese Sitzung nicht sichtbar."
        if "private" in name.lower():
            return "Inhalt ist für diese Sitzung nicht zugänglich."
        return "Abruf nicht verfügbar (" + name + ")."

    def result():
        return {
            "outputs": outputs,
            "warnings": list(dict.fromkeys(warnings)),
            "counts": counts,
        }

    def save():
        temporary = checkpoint.with_suffix(".tmp")
        temporary.write_text(json.dumps(result(), ensure_ascii=False))
        temporary.replace(checkpoint)

    def tick():
        if time.monotonic() - start > config["run_timeout"] - 5:
            raise StopCollection("Zeitlimit erreicht; Teilergebnisse gespeichert.")
        if len(outputs) >= node_budget:
            raise StopCollection(
                "Projektlimit erreicht; Teilergebnisse gespeichert. 0 hebt nur das Bereichslimit auf."
            )

    def path(*parts):
        return [{"id": str(key), "label": str(label)} for key, label in parts]

    def emit(kind, label, value, groups, relation="Instagram-Angabe", source_url=""):
        tick()
        if value is None or value == "" or value == [] or value == {}:
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
            tuple(g["id"] for g in groups),
            json.dumps(data, sort_keys=True),
        )
        if key in seen:
            return
        seen.add(key)
        outputs.append(
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
                    "url": source_url or profile_url,
                },
            }
        )

    profile_url = (
        "https://www.instagram.com/" + payload["username"] + "/"
        if payload.get("username")
        else "https://www.instagram.com/web/friendships/show/?user_id="
        + payload["user_id"]
    )

    def error(section, exc):
        message = safe_error(exc) if isinstance(exc, Exception) else str(exc)
        warnings.append(section + ": " + message)
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
        emit(
            "error", section, message, path((section_key, section)), "Recherchehinweis"
        )
        save()

    def call_section(label, fn):
        try:
            tick()
            fn()
            save()
        except StopCollection:
            raise
        except Exception as exc:
            error(label, exc)

    authenticated = False
    try:
        authenticated = auth.login(
            client,
            config,
            str(payload.get("transient", {}).get("verification_code", "")),
        )
        if authenticated:
            session = str(client.cookie_dict.get("sessionid") or session)
            Path(payload["session_output"]).write_text(
                json.dumps(client.get_settings())
            )
    except Exception as exc:
        # Keep device/challenge state for the next manual code attempt, encrypted by the parent.
        Path(payload["session_output"]).write_text(json.dumps(client.get_settings()))
        request = auth.input_request(exc)
        if request:
            return {
                "outputs": [],
                "input_request": request,
                "warnings": [],
                "authenticated": False,
            }
        return {
            "outputs": [],
            "warnings": ["Anmeldung: " + safe_error(exc)],
            "failed": True,
            "authenticated": False,
        }
    if payload.get("auth_only"):
        return {"outputs": [], "authenticated": authenticated, "warnings": []}

    # Profile reads are separate from the optional bounded Toutatis lookup below.
    def profile_info():
        try:
            return plain(
                client.user_info(payload["user_id"])
                if payload.get("user_id") and not payload.get("username")
                else client.user_info_by_username(payload["username"])
            )
        except Exception as primary:
            try:
                endpoint = (
                    "https://i.instagram.com/api/v1/users/"
                    + payload["user_id"]
                    + "/info/"
                    if payload.get("user_id") and not payload.get("username")
                    else "https://www.instagram.com/api/v1/users/web_profile_info/?username="
                    + quote(payload["username"])
                )
                response = requests.get(
                    endpoint,
                    headers={
                        "User-Agent": "Mozilla/5.0",
                        "X-IG-App-ID": "936619743392459",
                        "Accept": "application/json",
                    },
                    cookies={"sessionid": session} if session else {},
                    timeout=request_timeout,
                    allow_redirects=False,
                )
                response.raise_for_status()
                data = response.json()
                user = data.get("user") or data.get("data", {}).get("user")
                if isinstance(user, dict) and (user.get("id") or user.get("pk")):
                    return user
            except Exception:
                pass
            if not config.get("browser_enabled") or not payload.get("username"):
                raise primary
            spec = importlib.util.spec_from_file_location(
                "argus_web", Path(__file__).with_name("_argus_web_runner.py")
            )
            web = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(web)
            page, url = web.browser_page(
                profile_url,
                min(
                    config["browser_timeout"],
                    max(
                        10, int(config["run_timeout"] - (time.monotonic() - start) - 8)
                    ),
                ),
            )

            # Prefer embedded profile data over document-level OG metadata.
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
                    if str(value.get("username", "")).lower() == payload[
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
                marker in page[:250000].lower()
                for marker in (
                    "challenge_required",
                    "login_required",
                    "accounts/login",
                    "checkpoint_required",
                )
            ):
                warnings.append(
                    "Browser: Instagram zeigt eine Login- oder Bestätigungsseite; nur erkennbare öffentliche Metadaten verfügbar."
                )
            # A login page or generic Instagram document is not profile evidence.
            document_title = str(facts.get("Seitentitel", "")).casefold()
            if not facts or payload["username"].casefold() not in document_title:
                raise primary
            return {"username": payload["username"], "_web_facts": facts}

    try:
        info = profile_info()
    except Exception as exc:
        error("Profil", exc)
        if not (config.get("use_toutatis", True) and payload.get("username")):
            return result()
        info = {"username": payload["username"]}
    if authenticated and config.get("include_contacts"):
        try:
            raw = client.private_request(
                "users/"
                + str(info.get("pk") or info.get("id") or payload.get("user_id"))
                + "/info/"
            )
            if isinstance(raw.get("user"), dict):
                info = {**info, **raw["user"]}
        except Exception as exc:
            warnings.append("Kontaktdaten: " + safe_error(exc))
    username = str(info.get("username") or payload.get("username") or "")
    user_id = str(info.get("pk") or info.get("id") or payload.get("user_id") or "")
    if username:
        profile_url = "https://www.instagram.com/" + username + "/"

    toutatis = {"profile": {}, "recovery": {}, "warnings": []}
    if (
        config.get("use_toutatis", True)
        and username
        and any(
            config.get("include_" + key) for key in ("profile", "contacts", "recovery")
        )
    ):
        remaining = max(
            1, min(25, int(config["run_timeout"] - (time.monotonic() - start) - 5))
        )
        try:
            response = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    str(Path(__file__).with_name("_toutatis_runner.py")),
                ],
                input=json.dumps(
                    {
                        "username": username,
                        "user_id": user_id,
                        "sessionid": session,
                        "profile": bool(
                            config.get("include_profile")
                            or config.get("include_contacts")
                        ),
                        "recovery": bool(config.get("include_recovery")),
                        "timeout": remaining,
                        "request_timeout": min(request_timeout, 10),
                    }
                ),
                text=True,
                capture_output=True,
                timeout=remaining + 2,
                check=True,
            )
            if len(response.stdout) > 512 * 1024:
                raise ValueError("Toutatis response too large")
            toutatis = json.loads(response.stdout)
            info = {**info, **toutatis.get("profile", {})}
            warnings.extend(toutatis.get("warnings", []))
        except Exception as exc:
            warnings.append(
                "Toutatis-Ergänzung nicht verfügbar (" + type(exc).__name__ + ")."
            )

    def field(info, key, label, groups, kind="value"):
        value = info.get(key)
        if value is not None and value != "":
            emit(kind, label, value, groups)

    def profile():
        groups = path(("profile", "Allgemeine Profilinfos"))
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
            field(info, key, label, groups)
        if user_id:
            emit("value", "Instagram-ID", user_id, groups)
        emit("url", "Profil-URL", profile_url, groups)
        pic = (
            info.get("profile_pic_url_hd")
            or (info.get("hd_profile_pic_url_info") or {}).get("url")
            or info.get("profile_pic_url")
        )
        if pic:
            emit("image", "Profilbild", pic, groups)
        for key in ("external_url", "bio_links"):
            value = info.get(key)
            if isinstance(value, list):
                for index, item in enumerate(value):
                    if isinstance(item, dict):
                        emit(
                            "url",
                            item.get("title") or "Profil-Link " + str(index + 1),
                            item.get("url"),
                            groups,
                        )
            elif value:
                emit("url", "Profil-Link", value, groups)
        aliases = {
            "follower_count": "edge_followed_by",
            "following_count": "edge_follow",
            "media_count": "edge_owner_to_timeline_media",
        }
        for key, alias in aliases.items():
            if key not in info and isinstance(info.get(alias), dict):
                emit(
                    "value",
                    {
                        "follower_count": "Follower-Anzahl",
                        "following_count": "Gefolgte-Anzahl",
                        "media_count": "Beitragsanzahl",
                    }[key],
                    info[alias].get("count"),
                    groups,
                )
        for key, value in info.get("_web_facts", {}).items():
            emit(
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

    def contacts():
        groups = path(("contacts", "Kontaktdaten"))
        before = len(outputs)
        for key, label in [
            ("public_email", "Öffentliche E-Mail"),
            ("business_email", "Geschäftliche E-Mail"),
        ]:
            if info.get(key):
                emit("email", label, info[key], groups)
        for key, label in [
            ("public_phone_number", "Öffentliche Telefonnummer"),
            ("contact_phone_number", "Kontakttelefonnummer"),
            ("business_phone_number", "Geschäftliche Telefonnummer"),
        ]:
            value = str(info.get(key) or "").strip()
            if value:
                prefix = str(info.get("public_phone_country_code") or "").strip()
                if prefix and not value.startswith("+"):
                    value = "+" + prefix + " " + value
                emit("phone", label, value, groups)
        for key, label in [
            ("business_contact_method", "Kontaktmethode"),
            ("is_whatsapp_linked", "WhatsApp verknüpft"),
        ]:
            field(info, key, label, groups)
        bio = str(info.get("biography") or "")
        for email in sorted(
            set(
                re.findall(
                    r"[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
                    bio,
                )
            )
        ):
            emit("email", "E-Mail in Biografie", email, groups)
        if len(outputs) == before:
            emit(
                "error",
                "Keine Kontaktdaten",
                "Keine öffentlichen Kontaktdaten in der zugänglichen Profilantwort.",
                groups,
                "Recherchehinweis",
            )

    def recovery():
        groups = path(("recovery", "Maskierte Wiederherstellungsangaben"))
        before = len(outputs)
        for key, label in [
            ("obfuscated_email", "Maskierte Wiederherstellungs-E-Mail"),
            ("obfuscated_phone", "Maskierte Wiederherstellungs-Telefonnummer"),
        ]:
            if toutatis.get("recovery", {}).get(key):
                emit("value", label, toutatis["recovery"][key], groups)
                outputs[-1]["source"].update(
                    tool="Toutatis", version="1.31", masked=True, skip_recovery=True
                )
        if len(outputs) == before:
            emit(
                "error",
                "Wiederherstellungsangaben nicht verfügbar",
                (
                    "Toutatis lieferte keine maskierten Angaben."
                    if config.get("use_toutatis", True)
                    else "Toutatis ist in den Plugin-Einstellungen deaktiviert."
                ),
                groups,
                "Recherchehinweis",
            )

    def accounts(section, label):
        if not user_id:
            raise ValueError("no_user_id")
        amount = config[section + "_limit"]
        count = 0
        iterator = (
            getattr(client, "iter_user_" + section + "_v1", None)
            if authenticated
            else None
        )
        if iterator:
            items = iterator(user_id, amount=amount, page_size=50)
        else:
            values = getattr(client, "user_" + section)(user_id, amount=amount)
            items = values.values() if isinstance(values, dict) else values
        unique = set()
        for model in items:
            tick()
            user = plain(model)
            name = str(user.get("username") or "")
            pk = str(user.get("pk") or "")
            if not name or (pk or name.casefold()) in unique:
                continue
            unique.add(pk or name.casefold())
            groups = path(
                (section, label), (section + ":" + (pk or name.casefold()), name)
            )
            url = "https://www.instagram.com/" + name + "/"
            emit("username", "Benutzername", name, groups, source_url=url)
            emit("url", "Profil-URL", url, groups, source_url=url)
            count += 1
            if count % 10 == 0:
                save()
            if amount and count >= amount:
                break
        counts[section] = count
        if not count:
            emit(
                "error",
                label,
                "Keine Konten zurückgegeben. Dies bestätigt keine leere Liste; Sichtbarkeit und Anmeldung können den Abruf einschränken.",
                path((section, label)),
                "Recherchehinweis",
            )

    def media_fields(media, groups, url):
        emit("url", "URL", url, groups, source_url=url)
        if media.get("caption_text"):
            emit("value", "Beschreibung", media["caption_text"], groups, source_url=url)
        stamp = media.get("taken_at") or media.get("taken_at_utc")
        if stamp:
            emit("value", "Veröffentlicht", stamp, groups, source_url=url)
        picture = media.get("thumbnail_url") or media.get("display_url")
        if picture:
            emit("image", "Bild", picture, groups, source_url=url)
        if media.get("video_url"):
            emit("url", "Video", media["video_url"], groups, source_url=url)
        for index, resource in enumerate(media.get("resources") or []):
            resource = plain(resource)
            if resource.get("thumbnail_url"):
                emit(
                    "image",
                    "Bild " + str(index + 1),
                    resource["thumbnail_url"],
                    groups,
                    source_url=url,
                )
            if resource.get("video_url"):
                emit(
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
            field(media, key, label, groups)

    def posts():
        if not user_id:
            raise ValueError("no_user_id")
        amount = config["posts_limit"]
        count = 0
        unique = set()
        feed = client.iter_user_medias(
            user_id, amount=amount + 3 if amount else 0, page_size=12
        )
        # Allow the three pinned grid positions, then order the requested recent batch by publication.
        if amount:
            feed = sorted(
                feed,
                key=lambda item: str(plain(item).get("taken_at") or ""),
                reverse=True,
            )[:amount]
        for model in feed:
            tick()
            media = plain(model)
            pk = str(media.get("pk") or media.get("id") or "")
            code = media.get("code")
            if pk in unique:
                continue
            unique.add(pk)
            count += 1
            url = "https://www.instagram.com/p/" + code + "/" if code else profile_url
            groups = path(
                ("posts", "Beiträge"), ("post:" + pk, code or "Beitrag " + pk)
            )
            media_fields(media, groups, url)
            if pk:
                comment_count = 0
                try:
                    comments = client.media_comments(
                        media.get("id") or pk, amount=config["comments_limit"]
                    )
                    for item in comments:
                        tick()
                        comment = plain(item)
                        cid = str(comment.get("pk") or comment_count)
                        cg = groups + [
                            {"id": "comments:" + pk, "label": "Kommentare"},
                            {"id": "comment:" + cid, "label": "Kommentar " + cid},
                        ]
                        user = plain(comment.get("user") or {})
                        if user.get("username"):
                            emit(
                                "username",
                                "Benutzername",
                                user["username"],
                                cg,
                                source_url=url,
                            )
                            emit(
                                "url",
                                "Profil-URL",
                                "https://www.instagram.com/" + user["username"] + "/",
                                cg,
                                source_url=url,
                            )
                        if comment.get("text"):
                            emit(
                                "value",
                                "Kommentar",
                                comment["text"],
                                cg,
                                source_url=url,
                            )
                        if comment.get("created_at_utc"):
                            emit(
                                "value",
                                "Zeitpunkt",
                                comment["created_at_utc"],
                                cg,
                                source_url=url,
                            )
                        comment_count += 1
                        if (
                            config["comments_limit"]
                            and comment_count >= config["comments_limit"]
                        ):
                            break
                    if not comment_count:
                        emit(
                            "value",
                            "Kommentarabruf",
                            "Keine Kommentare zurückgegeben.",
                            groups + [{"id": "comments:" + pk, "label": "Kommentare"}],
                            source_url=url,
                        )
                except StopCollection:
                    raise
                except Exception as exc:
                    emit(
                        "error",
                        "Kommentare",
                        safe_error(exc),
                        groups + [{"id": "comments:" + pk, "label": "Kommentare"}],
                        "Recherchehinweis",
                        url,
                    )
            save()
            if amount and count >= amount:
                break
        counts["posts"] = count
        if not count:
            emit(
                "value",
                "Beitragsabruf",
                "Keine Beiträge zurückgegeben.",
                path(("posts", "Beiträge")),
            )

    def story_fields(model, groups):
        story = plain(model)
        pk = str(story.get("pk") or story.get("id") or "")
        url = (
            "https://www.instagram.com/stories/" + username + "/" + pk + "/"
            if username and pk
            else profile_url
        )
        media_fields(story, groups, url)
        for index, item in enumerate(story.get("links") or []):
            item = plain(item)
            emit(
                "url",
                "Story-Link " + str(index + 1),
                item.get("webUri") or item.get("web_uri"),
                groups,
                source_url=url,
            )
        return pk

    def stories():
        if not user_id:
            raise ValueError("no_user_id")
        amount = config["stories_limit"]
        items = client.user_stories(user_id, amount=None)
        items = sorted(
            items, key=lambda item: str(plain(item).get("taken_at") or ""), reverse=True
        )
        count = 0
        for item in items:
            tick()
            pk = str(plain(item).get("pk") or plain(item).get("id") or count)
            story_fields(
                item,
                path(("stories", "Aktuelle Stories"), ("story:" + pk, "Story " + pk)),
            )
            count += 1
            save()
            if amount and count >= amount:
                break
        counts["stories"] = count
        if not count:
            emit(
                "value",
                "Story-Abruf",
                "Keine aktuellen Stories zurückgegeben.",
                path(("stories", "Aktuelle Stories")),
            )

    def highlights():
        if not user_id:
            raise ValueError("no_user_id")
        amount = config["highlights_limit"]
        items = client.user_highlights(user_id, amount=0)
        items = sorted(
            items,
            key=lambda item: str(plain(item).get("latest_reel_media") or ""),
            reverse=True,
        )
        count = 0
        for item in items:
            tick()
            highlight = plain(item)
            pk = str(highlight.get("pk") or highlight.get("id") or "")
            groups = path(
                ("highlights", "Highlight-Stories"),
                ("highlight:" + pk, highlight.get("title") or "Highlight " + pk),
            )
            emit(
                "url",
                "Highlight-URL",
                "https://www.instagram.com/stories/highlights/"
                + pk.removeprefix("highlight:")
                + "/",
                groups,
            )
            detail = plain(client.highlight_info(pk))
            stories = sorted(
                detail.get("items") or [],
                key=lambda story: str(plain(story).get("taken_at") or ""),
                reverse=True,
            )
            for index, story in enumerate(stories):
                if (
                    config["highlight_items_limit"]
                    and index >= config["highlight_items_limit"]
                ):
                    break
                sid = str(plain(story).get("pk") or index)
                story_fields(
                    story,
                    groups
                    + [{"id": "highlight-story:" + sid, "label": "Story " + sid}],
                )
                save()
            count += 1
            if amount and count >= amount:
                break
        counts["highlights"] = count
        if not count:
            emit(
                "value",
                "Highlight-Abruf",
                "Keine Highlights zurückgegeben.",
                path(("highlights", "Highlight-Stories")),
            )

    try:
        for key, label, fn in [
            ("profile", "Allgemeine Profilinfos", profile),
            ("contacts", "Kontaktdaten", contacts),
            ("recovery", "Maskierte Wiederherstellungsangaben", recovery),
            ("followers", "Follower", lambda: accounts("followers", "Follower")),
            (
                "following",
                "Gefolgte Konten",
                lambda: accounts("following", "Gefolgte Konten"),
            ),
            ("posts", "Beiträge", posts),
            ("highlights", "Highlight-Stories", highlights),
            ("stories", "Aktuelle Stories", stories),
        ]:
            if config["include_" + key]:
                call_section(label, fn)
    except StopCollection as exc:
        warnings.append(str(exc))
        # Reserve one node for a visible partial-results explanation.
        if len(outputs) < node_budget + 1:
            outputs.append(
                {
                    "type": "error",
                    "label": "Teilabruf",
                    "data": {"title": "Teilabruf", "message": str(exc)},
                    "relation": "Recherchehinweis",
                    "source": {"tool": "Argus Instagram"},
                }
            )
    save()
    return result()


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            response = run(payload)
        json.dump(response, sys.stdout, ensure_ascii=False)
    except Exception:
        # Never leak request headers, cookies or library exception bodies to logs.
        json.dump(
            {
                "outputs": [],
                "warnings": [
                    "Instagram-Worker fehlgeschlagen. Sitzung und Plugin-Konfiguration prüfen."
                ],
            },
            sys.stdout,
        )
