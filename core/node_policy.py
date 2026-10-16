"""Typed node normalization injected into graph validation; no plugin imports in the graph core."""

from node_metadata import normalize
from provider_registry import canonical


def formatted_address(data):
    parts = [
        " ".join(
            str(data.get(k) or "").strip() for k in ("street", "house_number")
        ).strip(),
        " ".join(
            str(data.get(k) or "").strip() for k in ("postal_code", "locality")
        ).strip(),
    ]
    parts.extend(
        str(data.get(k) or "").strip()
        for k in ("dependent_locality", "admin_area_2", "admin_area_1", "country")
    )
    return ", ".join(dict.fromkeys(p for p in parts if p))


def normalize_node(node):
    normalize(node)
    if node["type"] == "location":
        node["data"]["formatted_address"] = formatted_address(node["data"]) or node[
            "data"
        ].get("formatted_address", "")
    if node["type"] == "profile":
        node["data"]["provider"] = canonical(node["data"].get("provider", ""))
