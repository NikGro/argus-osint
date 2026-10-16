import contextlib
import json
import sys
import httpx
import trio
from ignorant.core import import_submodules, get_functions


async def collect(payload):
    functions = get_functions(import_submodules("ignorant.modules"))
    rows = []
    selected = {str(s).lower() for s in payload.get("sites", [])}
    if selected:
        functions = [f for f in functions if f.__name__.lower() in selected]
        if not functions:
            raise ValueError("Anbieter wird von Ignorant nicht unterstützt.")
    async with httpx.AsyncClient(
        timeout=payload["request_timeout"], trust_env=False
    ) as client:

        async def check(function):
            out = []
            try:
                with trio.move_on_after(payload["request_timeout"] + 3) as scope:
                    await function(
                        payload["phone"], payload["country_code"], client, out
                    )
                if scope.cancelled_caught:
                    out = [
                        {"name": function.__name__, "exists": None, "error": "Timeout"}
                    ]
                elif not out:
                    out = [
                        {
                            "name": function.__name__,
                            "exists": None,
                            "error": "Kein Ergebnis",
                        }
                    ]
            except Exception as exc:
                out = [{"name": function.__name__, "exists": None, "error": str(exc)}]
            rows.extend(out)

        async with trio.open_nursery() as nursery:
            for function in functions:
                nursery.start_soon(check, function)
    return rows


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        rows = trio.run(collect, payload)
    json.dump({"rows": rows}, sys.stdout, ensure_ascii=False, default=str)
