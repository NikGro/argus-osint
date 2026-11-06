"""Validated provider-local scopes; no user input can broaden an invalid selection."""

import copy
from functools import lru_cache

SITE_FIELDS = {
    "consensus": "consensus_sites",
    "sherlock": "sherlock_sites",
    "maigret": "maigret_sites",
    "holehe": "holehe_sites",
}


@lru_cache(maxsize=1)
def catalogue():
    from core import catalogues

    built = catalogues.load(catalogues.PROFILES)
    if built:
        return built
    # Before the research tools are installed there are no site catalogues.
    return {
        kind: {provider: [] for provider in providers}
        for kind, providers in {
            "username": [
                "consensus",
                "sherlock",
                "maigret",
                "user_scanner",
                "blackbird",
            ],
            "email": ["consensus", "holehe", "user_scanner", "blackbird"],
            "phone": ["consensus", "ignorant"],
        }.items()
    }


def plans(kind, provider, params):
    available = catalogue().get(kind, {})
    if provider not in available:
        return [params]
    selections = params.get("search_profiles", {})
    if not isinstance(selections, dict):
        raise ValueError("Search profiles must be configured per provider.")
    # Keep earlier explicit website restrictions until this provider is first saved.
    legacy = params.get(SITE_FIELDS.get(provider, ""), [])
    rows = selections.get(
        provider, [{"id": "custom", "sites": legacy}] if legacy else []
    )
    if not isinstance(rows, list) or len(rows) > 20:
        raise ValueError("Each provider supports at most 20 search profiles.")
    presets = {entry["id"]: entry for entry in available[provider]}
    result = []
    for row in rows or [{"id": "all"}]:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            raise ValueError("Invalid search profile.")
        ident = row["id"]
        scoped = copy.deepcopy(params)
        scoped.update(
            _profile_mode=True, _profile_sites=[], _profile_tags=[], _profile_top=None
        )
        for field in SITE_FIELDS.values():
            scoped[field] = []
        if ident == "custom":
            sites = row.get("sites", [])
            if (
                not isinstance(sites, list)
                or not 1 <= len(sites) <= 50
                or any(
                    not isinstance(s, str)
                    or not s.strip()
                    or len(s) > 100
                    or s.startswith("-")
                    or any(c in s for c in "\n\r\x00,")
                    for s in sites
                )
            ):
                raise ValueError("Custom websites: 1–50 names, one website per line.")
            scoped["_profile_sites"] = [s.strip() for s in sites]
            if provider == "ignorant":
                scoped["sites"] = scoped["_profile_sites"]
            if provider in SITE_FIELDS:
                scoped[SITE_FIELDS[provider]] = scoped["_profile_sites"]
        elif ident == "all" and not rows:
            pass
        elif ident in presets:
            preset = presets[ident]
            if "top" in preset:
                scoped["_profile_top"] = preset["top"]
                scoped["top_sites"] = preset["top"]
            elif "tag" in preset:
                scoped["_profile_tags"] = [preset["tag"]]
            else:
                raise ValueError("The search profile has no supported filter.")
        else:
            raise ValueError("Search profile unavailable for this provider: " + ident)
        result.append(scoped)
    return result
