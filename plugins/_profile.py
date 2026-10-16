"""Three-field profile contract and private, replayable discovery provenance."""

import copy
import re
from urllib.parse import urlsplit, unquote


def provider_key(value):
    from provider_registry import identity

    return identity(value)


def profile_url(value, kind="username"):
    """Reject site roots, query/API/check/login links. Never invent a profile URL."""
    value = str(value or "").strip()
    try:
        p = urlsplit(value)
        if (
            p.scheme not in ("http", "https")
            or not p.hostname
            or p.username
            or p.password
        ):
            return ""
        path = unquote(p.path).strip("/")
        parts = path.casefold().split("/")
        if not path and not (
            p.hostname.count(".") >= 2
            and p.hostname.split(".")[0]
            not in ("www", "api", "m", "app", "accounts", "users")
        ):
            return ""
        if any(
            part
            in (
                "api",
                "login",
                "signin",
                "signup",
                "register",
                "search",
                "recover",
                "reset",
                "forgot-password",
                "password",
                "graphql",
                "ajax",
                "oauth",
                "auth",
            )
            for part in parts
        ):
            return ""
        # Email discovery tools commonly return an API/check endpoint, not a public profile.
        if kind == "email" and any(
            part
            in ("check", "exists", "validate", "availability", "email", "email-exists")
            for part in parts
        ):
            return ""
        if p.hostname.lower().endswith("discord.com") and not re.fullmatch(
            r"users/[0-9]+", path
        ):
            return ""
        return value
    except ValueError:
        return ""


def make_profile(provider, url, identifier, node, tool, kind, service_key=None):
    from provider_registry import canonical, label

    provider = canonical(provider)
    identifier = str(identifier or "").strip()
    url = profile_url(url, kind)
    if not provider or not (identifier or url):
        raise ValueError("Profil benötigt Anbieter und URL oder Identifier.")
    data = {"provider": provider, "url": url, "identifier": identifier}
    recipe = {
        "tool": tool,
        "service": str(service_key or label(provider)),
        "kind": kind,
        "value": str(node["data"].get("value", "")),
        "profile": copy.deepcopy(data),
    }
    return {
        "type": "profile",
        "label": label(provider),
        "data": data,
        "relation": "Profil gefunden",
        "source_input": node["id"],
        "source": {"tool": tool, "service": label(provider), "lookup": recipe},
    }


def recipes(node):
    source = node.get("evidence", {}).get("source", {})
    sources = source.get("sources") or [source]
    # A changed provider, URL or identifier invalidates the old lookup, never replay a different account.
    return [
        s["lookup"]
        for s in sources
        if isinstance(s, dict)
        and isinstance(s.get("lookup"), dict)
        and same_profile(s["lookup"].get("profile", {}), node["data"])
    ]


def discovery_outputs(outputs, node, kind):
    """Legacy positive registrations become profile entities; exclude all non-identity fields."""
    result = []
    seen = set()
    for item in outputs:
        source = item.get("source", {})
        provider = source.get("service")
        if not provider:
            continue
        if item.get("relation") not in (
            "Benutzername gefunden",
            "Registrierungsbefund",
            "Profil gefunden",
        ):
            continue
        if item["type"] == "profile":
            result.append(item)
            continue
        key = (provider_key(provider), str(source.get("tool", "")))
        if key in seen:
            continue
        seen.add(key)
        url = item.get("data", {}).get("value", "") if item["type"] == "url" else ""
        result.append(
            make_profile(
                provider,
                url,
                node["data"].get("value", ""),
                node,
                source.get("tool", ""),
                kind,
            )
        )
    return result


def same_profile(a, b):
    return provider_key(a.get("provider", "")) == provider_key(
        b.get("provider", "")
    ) and all(a.get(key, "") == b.get(key, "") for key in ("url", "identifier"))
