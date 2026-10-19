"""Graph sizing independent of HTTP and application globals."""

import json
from pathlib import Path

LAYOUT = json.loads(
    (Path(__file__).resolve().parents[1] / "static/layout-spec.json").read_text()
)


def node_bounds(node, preferences=None):
    preferences = preferences or {"tags": [], "language": "de"}
    appearance = node.get("appearance", {})
    display = node.get("display", {})
    size = LAYOUT.get(node["type"], LAYOUT["base"])
    width, height = size.get("width", LAYOUT["base"]["width"]), size.get(
        "height", LAYOUT["base"]["height"]
    )
    if node["type"] in ("note", "marker"):
        width, height = appearance.get("width", width), appearance.get("height", height)
    if node["type"] == "video" and display.get("preview"):
        height = LAYOUT["videoPreviewHeight"]
    if node["type"] == "image" and display.get("preview"):
        height = LAYOUT["imagePreviewHeight"]
    if node["type"] == "location":
        from core.node_policy import formatted_address

        address = formatted_address(node.get("data", {})) or node.get("data", {}).get(
            "formatted_address", ""
        )
        height = max(
            size["height"],
            76 + size["line"] * (min(5, max(1, (len(address) + 38) // 39)) - 1),
        )
        if display.get("map") and (
            address
            or node.get("data", {}).get("original_input")
            or all(
                node.get("data", {}).get(k) not in (None, "")
                for k in ("latitude", "longitude")
            )
        ):
            height += LAYOUT["mapHeight"]
    from core.node_metadata import badge_height

    height += badge_height(
        node, width, preferences.get("tags", []), preferences.get("language", "de")
    )
    height += LAYOUT["quickActionHeight"] * sum(
        bool(display.get(key))
        for key in (
            "openButton",
            "imageButton",
            "fileButton",
            "videoButton",
            "mapsButton",
            "appleMapsButton",
            "osmButton",
        )
    )
    return (node.get("x", 0), node.get("y", 0), width, height)
