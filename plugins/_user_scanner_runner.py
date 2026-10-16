"""Isolated pinned User Scanner adapter: discovery or exactly one provider in deep mode."""

import asyncio
import contextlib
import inspect
import json
import resource
import sys
from user_scanner.core.helpers import (
    load_categories,
    load_modules,
    get_scan_func,
    get_site_name,
    set_global_timeout,
    is_loud,
)


def key(value):
    import re

    return re.sub(r"[^a-z0-9]", "", str(value).casefold().replace(" (twitter)", ""))


async def collect(payload):
    from user_scanner.core.orchestrator import set_concurrency

    set_global_timeout(payload["request_timeout"])
    set_concurrency(12)
    email = payload["kind"] == "email"
    selected = key(payload.get("service", ""))
    categories = payload.get("categories", [])
    sites = {key(s) for s in payload.get("sites", [])}
    modules = []
    for category, path in load_categories(is_email=email).items():
        if categories and category.lower() not in categories:
            continue
        for module in load_modules(path):
            name = get_site_name(module)
            if selected and selected not in (key(name), key(module.__name__)):
                continue
            if sites and not sites.intersection((key(name), key(module.__name__))):
                continue
            modules.append((module, category, name))
    if (selected or sites or categories) and not modules:
        raise ValueError("User Scanner unterstützt diesen Anbieter nicht.")
    sem = asyncio.Semaphore(12)

    async def check(entry):
        module, category, name = entry
        func = get_scan_func(module)
        if not func or is_loud(module.__name__, is_email=email):
            return None
        if payload.get("identity_only"):
            # Audited extra-only fetches in the pinned 1.5.2.2 release. No mutation of installed code.
            if module.__name__ == "roblox":
                module._fetch_user_details = lambda *_: {}
                module._get_avatar_picture = lambda *_: None
            if email and module.__name__ == "gravatar":

                async def no_collect(*_):
                    return {}, {}

                module._collect_profile = no_collect
        async with sem:
            try:
                if inspect.iscoroutinefunction(func):
                    result = await asyncio.wait_for(
                        func(payload["value"]), payload["request_timeout"] + 10
                    )
                else:
                    result = await asyncio.wait_for(
                        asyncio.to_thread(func, payload["value"]),
                        payload["request_timeout"] + 10,
                    )
                result.update(
                    username=payload["value"],
                    site_name=name,
                    category=category,
                    is_email=email,
                )
                row = result.to_dict()
                row["service_key"] = module.__name__
                if payload.get("identity_only"):
                    # Retain only identity hints, never biographies/images/raw enrichment in discovery logs.
                    row["extra"] = {
                        k: v
                        for k, v in (row.get("extra") or {}).items()
                        if k.casefold()
                        in (
                            "id",
                            "uid",
                            "user_id",
                            "username",
                            "login",
                            "login_name",
                            "profile_url",
                        )
                    }
                    row["media"] = {}
                return row
            except Exception as exc:
                return {"site_name": name, "status": "error", "reason": str(exc)}

    return [row for row in await asyncio.gather(*(check(m) for m in modules)) if row]


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        rows = asyncio.run(collect(payload))
    json.dump(rows, sys.stdout, ensure_ascii=False, default=str)
