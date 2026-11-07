"""Pure HTML report rendering from a snapshot and explicit locale/settings inputs."""

import copy
import html

REPORT_LABELS = {
    "first_name": "First name",
    "middle_name": "Middle name",
    "last_name": "Last name",
    "birth_date": "Date of birth",
    "birth_place": "Place of birth",
    "birth_country": "Country of birth",
    "provider": "Provider",
    "url": "Profile URL",
    "identifier": "Identifier",
    "date": "Date",
    "time": "Time",
    "timezone": "Time zone",
    "value": "Contents",
    "semantic_key": "Meaning",
    "service": "Provider",
    "text": "Text",
    "country_code": "Country code",
    "country": "Country",
    "admin_area_1": "State / Province",
    "admin_area_2": "County",
    "locality": "City / Town",
    "dependent_locality": "District",
    "postal_code": "Postal code",
    "street": "Street",
    "house_number": "House number",
    "latitude": "Latitude",
    "longitude": "Longitude",
    "original_input": "Original location input",
    "formatted_address": "Formatted address",
    "retrieved_at": "Retrieved at",
    "origin": "Origin",
    "source": "Source",
    "plugin": "Plugin",
    "action": "Action",
    "status": "Status",
    "started_at": "Started at",
    "finished_at": "Finished at",
    "warnings": "Warnings",
    "error": "Error",
    "run_id": "Run ID",
    "source_input": "Input node",
    "last_update": "Last update",
    "at": "Time",
    "tool": "Tool",
    "sources": "Sources",
    "failed": "Failed",
    "masked": "Masked",
}


def facts_html(value, tr=lambda value: value):
    """Render nested evidence as flat field paths, never shrinking nested tables."""
    rows = []

    def visit(item, path, depth=0):
        if item is None or item == "":
            return
        if isinstance(item, (dict, list)) and depth < 32:
            pairs = item.items() if isinstance(item, dict) else enumerate(item, 1)
            for key, child in pairs:
                label = tr(REPORT_LABELS.get(key, str(key).replace("_", " ")))
                visit(child, path + [label], depth + 1)
        else:
            if isinstance(item, (dict, list)):
                import json

                item = json.dumps(item, ensure_ascii=False)
            rows.append(
                '<tr><th scope="row">'
                + html.escape(" / ".join(path))
                + "</th><td>"
                + html.escape(str(item))
                + "</td></tr>"
            )

    if not isinstance(value, (dict, list)):
        return html.escape(str(value))
    visit(value, [])
    return '<table class="facts-table"><tbody>' + "".join(rows) + "</tbody></table>"


STATUS = {
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "interrupted": "Interrupted",
    "needs_input": "Input required",
    "needs_selection": "Selection required",
}


def tr(text):
    """Report text is English; codes such as run states get a readable form."""
    text = str(text or "")
    return STATUS.get(text, text)


def readable_time(value):
    """ISO timestamp as "7 Nov 2026, 10:58 UTC"; anything else unchanged."""
    from datetime import datetime, timezone

    try:
        moment = datetime.fromisoformat(str(value)).astimezone(timezone.utc)
    except ValueError:
        return str(value)
    return f"{moment.day} {moment:%b %Y, %H:%M} UTC"


def render_report(project, preferences, descriptors, generated_at):

    doc = project["document"]
    plugins = {p["id"]: p for p in descriptors}
    data_plugins = {n["type"]: p for p in plugins.values() for n in p.get("nodes", [])}
    group_by_id = {g["id"]: g for g in doc["groups"]}
    owners = {}
    depths = {}
    for group in doc["groups"]:
        for ident in group["members"]:
            owners.setdefault(ident, []).append(group["id"])
    for group in doc["groups"]:
        path = []
        current = group["id"]
        while current in group_by_id and current not in depths:
            path.append(current)
            current = group_by_id[current].get("parent_id")
        depth = depths.get(current, -1)
        for ident in reversed(path):
            depth += 1
            depths[ident] = depth
    selected = [n for n in doc["nodes"] if n.get("report") and n["type"] != "actor"]
    esc = html.escape
    parts = [
        f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(project['title'])} – Report</title>"""
        + '<link rel="stylesheet" href="/report.css"><div class="report-actions"><button id="print">'
        + esc(tr("Print / Save as PDF"))
        + "</button><span>ARGUS · "
        + esc(tr("Research report"))
        + '</span></div><script src="/print.js"></script><main class="report-sheet">',
        f"<h1>{esc(project['title'])}</h1><p>ARGUS · {esc(tr("Research report"))} · {esc(readable_time(generated_at))}</p><p>{esc(doc.get('report_notes', ''))}</p>",
    ]
    if not selected:
        parts.append(
            "<p>"
            + esc(
                tr(
                    "No findings selected for the report. Select nodes in the graph and enable Include in report."
                )
            )
            + "</p>"
        )

    def group_title(group):
        if group.get("label_key"):
            return tr(group["label_key"])
        if group.get("run_id") and not group.get("label_custom"):
            return tr(group["label"])
        return group["label"]

    def node_title(node):
        title = node.get("evidence", {}).get("label_key") or node["label"]
        if node.get("evidence", {}).get("label_custom"):
            return node["label"]
        if node.get("evidence", {}).get("run_id") or node.get("evidence", {}).get(
            "label_key"
        ):
            return tr(title)
        return title

    def type_label(node_type):
        plugin = data_plugins.get(node_type)
        spec = next(
            (n for n in (plugin or {}).get("nodes", []) if n.get("type") == node_type),
            None,
        )
        return tr(spec["name"]) if spec else tr(node_type)

    def action_label(run):
        plugin = plugins.get(run.get("plugin"))
        action = next(
            (
                a
                for a in (plugin or {}).get("actions", [])
                if a.get("id") == run.get("action")
            ),
            None,
        )
        if action:
            return tr(action["name"])
        return run.get("action", "")

    def evidence_view(evidence):
        evidence = copy.deepcopy(evidence)
        plugin = plugins.get(evidence.get("plugin"))
        if plugin:
            evidence["plugin"] = tr(plugin.get("name", evidence["plugin"]))
        if evidence.get("origin"):
            evidence["origin"] = tr(evidence["origin"])
        return evidence

    for node in selected:
        group_ids = set()
        stack = list(owners.get(node["id"], []))
        while stack:
            ident = stack.pop()
            if ident not in group_by_id or ident in group_ids:
                continue
            group_ids.add(ident)
            parent = group_by_id[ident].get("parent_id")
            if parent:
                stack.append(parent)
        groups = [
            group_title(group_by_id[ident])
            for ident in sorted(group_ids, key=lambda id: depths.get(id, 0))
        ]

        title = node_title(node)
        parts.append(
            f"""<section class="report-node"><small>{esc(" · ".join([type_label(node['type']), *([" / ".join(groups)] if groups else [])]))}</small><h2>{esc(title)}</h2>"""
        )
        if node["type"] == "image" and node["data"].get("file_id"):
            parts.append(
                f"""<img style="max-width:400px;max-height:300px" src="/api/files/{esc(node['data']['file_id'])}">"""
            )
        if node["type"] in ("file", "video", "audio") and node["data"].get("file_id"):
            parts.append(
                '<p><a href="/api/files/'
                + esc(node["data"]["file_id"])
                + '" target="_blank" rel="noopener noreferrer">'
                + esc(tr("Open file"))
                + "</a></p>"
            )
        report_data = copy.deepcopy(node["data"])
        if node["type"] == "profile":
            from core.provider_registry import label

            report_data["provider"] = label(report_data.get("provider", ""))
        if node["type"] == "error":
            # Failure and partial-result nodes carry generated text, not findings.
            for key in ("title", "message"):
                if report_data.get(key):
                    report_data[key] = tr(report_data[key])
        parts.append(facts_html(report_data, tr))
        review = {
            "unverified": "Unverified",
            "unclear": "Unclear",
            "verified": "Verified",
        }.get(node.get("verification", "unverified"), "Unverified")
        tag_names = [
            tag["name"]
            for tag in preferences.get("tags", [])
            if tag["id"] in node.get("tags", [])
        ]
        parts.append(
            "<p>"
            + esc(tr("Verification"))
            + ": "
            + esc(tr(review))
            + (" · " + esc(", ".join(tag_names)) if tag_names else "")
            + "</p>"
        )
        parts.append(
            "<h3>"
            + esc(tr("Source / Origin"))
            + "</h3>"
            + facts_html(evidence_view(node.get("evidence", {"origin": "manual"})), tr)
            + "</section>"
        )
    selected_ids = {n["id"] for n in selected}
    by_id = {n["id"]: n for n in doc["nodes"]}
    relations = [
        e
        for e in doc["edges"]
        if e["source"] in selected_ids and e["target"] in selected_ids
    ]
    if relations:
        parts.append("<h2>" + esc(tr("Relationships")) + "</h2><ul>")
        for edge in relations:
            parts.append(
                "<li>"
                + esc(node_title(by_id[edge["source"]]))
                + " → "
                + esc(tr(edge.get("label", "")) if edge.get("label") else "")
                + " → "
                + esc(node_title(by_id[edge["target"]]))
                + "</li>"
            )
        parts.append("</ul>")
    parts.append(
        "<h2>"
        + esc(tr("Research history"))
        + "</h2>"
        + facts_html(
            [
                {
                    k: value
                    for k, value in (
                        (
                            "plugin",
                            tr(
                                plugins.get(run.get("plugin"), {}).get(
                                    "name", run.get("plugin", "")
                                )
                            ),
                        ),
                        ("action", action_label(run)),
                        ("started_at", run.get("started_at")),
                        ("finished_at", run.get("finished_at")),
                        ("status", tr(run["status"]) if run.get("status") else None),
                        (
                            "warnings",
                            [tr(w) for w in run.get("warnings") or []],
                        ),
                        (
                            "error",
                            tr(run["error"]) if run.get("error") else None,
                        ),
                    )
                    if value
                }
                for run in doc["runs"]
            ],
            tr,
        )
        + "</main></html>"
    )
    return "".join(parts).encode()
