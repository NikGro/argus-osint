"""Review labels and project-independent tag references, outside node data schemas."""

STATUSES = {"unverified", "unclear", "verified"}


def normalize(node):
    if node.get("type") == "actor":
        return
    status = node.get("verification", "unverified")
    if not isinstance(status, str) or status not in STATUSES:
        raise ValueError("Ungültiger Verifizierungsstatus.")
    tags = node.get("tags", [])
    if (
        not isinstance(tags, list)
        or len(tags) > 50
        or any(not isinstance(tag, str) or len(tag) > 64 for tag in tags)
    ):
        raise ValueError("Ungültige Tags am Knoten.")
    node["verification"] = status
    node["tags"] = list(dict.fromkeys(tags))


def badge_height(node, width, tags=None, language="de"):
    if node.get("type") in ("actor", "marker"):
        return 0
    names = (
        {"unverified": "Unverifiziert", "unclear": "Unklar", "verified": "Verifiziert"}
        if language == "de"
        else {"unverified": "Unverified", "unclear": "Unclear", "verified": "Verified"}
    )
    labels = (
        []
        if node.get("type") in ("note", "error")
        else [names.get(node.get("verification", "unverified"), names["unverified"])]
    ) + [tag["name"] for tag in (tags or []) if tag["id"] in node.get("tags", [])]
    if not labels:
        return 0
    used = 0
    rows = 1
    for name in labels:
        size = min(width - 24, 20 + len(name) * 6)
        if used and used + size > width - 24:
            rows += 1
            used = 0
        used += size + 5
    return rows * 22 + 8
