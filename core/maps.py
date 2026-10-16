"""Same-origin map previews and cached tiles. External map actions remain explicit links."""

import base64
import json
import math
from pathlib import Path
import time
from urllib.parse import urlencode
from core.errors import AppError
from core.public_network import request


class Maps:
    def __init__(self, data):
        self.directory = Path(data) / "map-tiles"
        self.directory.mkdir(exist_ok=True)

    def preview(self, lat, lon, query, provider="osm"):
        if provider == "google" and Path("/run/argus/worker.sock").exists():
            try:
                from core.isolation import invoke

                result = invoke(
                    "browser",
                    {
                        "url": "https://www.google.com/maps/search/?"
                        + urlencode(
                            {"api": 1, "query": query or str(lat) + "," + str(lon)}
                        ),
                        "timeout": 35,
                        "screenshot": True,
                    },
                    timeout=55,
                )
                picture = result.get("image_base64")
                if picture and len(picture) < 8 * 1024 * 1024:
                    base64.b64decode(picture, validate=True)
                    return (
                        '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/map-view.css"><img class="snapshot" alt="Google Maps" src="data:image/png;base64,'
                        + picture
                        + '">'
                    ).encode()
            except Exception:
                pass
        try:
            latitude = float(lat)
            longitude = float(lon)
            if not math.isfinite(latitude) or not math.isfinite(longitude):
                raise ValueError()
        except (ValueError, TypeError):
            if not query:
                raise AppError("location_required", 422)
            response = request(
                "https://photon.komoot.io/api/?" + urlencode({"q": query, "limit": 1}),
                timeout=8,
                limit=1024 * 1024,
            )
            data = json.loads(response["body"])
            found = data.get("features", [])
            if not found:
                raise AppError("location_required", 422)
            longitude, latitude = found[0]["geometry"]["coordinates"][:2]
        latitude = max(-85, min(85, latitude))
        longitude = max(-180, min(180, longitude))
        return (
            f'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/map-view.css"></head><body data-lat="{latitude}" data-lon="{longitude}"><div id="tiles"></div><span id="marker">●</span><div id="zoom"><button id="in" aria-label="Zoom in">+</button><button id="out" aria-label="Zoom out">−</button></div><small>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · serverseitige Vorschau</small><script type="module" src="/map-view.js"></script></body></html>'
        ).encode()

    def tile(self, z, x, y):
        z, x, y = int(z), int(x), int(y)
        if not 0 <= z <= 19 or not 0 <= x < 2**z or not 0 <= y < 2**z:
            raise AppError("invalid_request", 400)
        path = self.directory / f"{z}-{x}-{y}.png"
        if path.exists() and time.time() - path.stat().st_mtime < 7 * 86400:
            return path.read_bytes()
        result = request(
            f"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            timeout=10,
            limit=1024 * 1024,
        )
        if result["status"] != 200:
            raise AppError("map_unavailable", 502)
        if not result["body"].startswith(b"\x89PNG\r\n\x1a\n"):
            raise AppError("invalid_image", 422)
        cached = sorted(
            self.directory.glob("*.png"), key=lambda item: item.stat().st_mtime
        )
        if len(cached) >= 2048:
            for expired in cached[: len(cached) - 2047]:
                expired.unlink(missing_ok=True)
        path.write_bytes(result["body"])
        return result["body"]
