import contextlib
import json
import resource
import sys
from holehe.core import import_submodules, get_functions
import httpx
import trio


async def collect(payload):
    functions = get_functions(import_submodules("holehe.modules"))
    selected = {str(site).lower() for site in payload.get("sites", [])}
    if selected:
        available = {function.__name__.lower() for function in functions}
        if selected - available:
            raise ValueError(
                "Unbekannte Holehe-Anbieter: " + ", ".join(sorted(selected - available))
            )
        functions = [f for f in functions if f.__name__.lower() in selected]
    results = []
    limit = trio.CapacityLimiter(6)
    async with httpx.AsyncClient(
        timeout=payload["request_timeout"], trust_env=False
    ) as client:

        async def check(function):
            rows = []
            async with limit:
                try:
                    with trio.move_on_after(payload["request_timeout"] + 3) as scope:
                        await function(payload["email"], client, rows)
                    if scope.cancelled_caught:
                        rows = [
                            {
                                "name": function.__name__,
                                "exists": None,
                                "error": "Timeout",
                            }
                        ]
                    elif not rows:
                        rows = [
                            {
                                "name": function.__name__,
                                "exists": None,
                                "error": "Kein auswertbares Ergebnis",
                            }
                        ]
                except Exception as exc:
                    rows = [
                        {
                            "name": function.__name__,
                            "exists": None,
                            "error": str(exc)[:300],
                        }
                    ]
            results.extend(rows)

        async with trio.open_nursery() as nursery:
            for function in functions:
                nursery.start_soon(check, function)
    return sorted(results, key=lambda row: str(row.get("name", "")))


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        import holehe

        json.dump(
            {
                "providers": len(get_functions(import_submodules("holehe.modules"))),
                "package": holehe.__file__,
            },
            sys.stdout,
        )
        raise SystemExit(0)
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        result = trio.run(collect, payload)
    json.dump(
        {"rows": result}, sys.stdout, ensure_ascii=False, allow_nan=False, default=str
    )
