"""Pure HTML report rendering from a snapshot and explicit locale/settings inputs."""

import copy
import html

REPORT_LABELS = {
    "first_name": "Vorname",
    "middle_name": "Zweitname",
    "last_name": "Nachname",
    "birth_date": "Geburtsdatum",
    "birth_place": "Geburtsort",
    "birth_country": "Geburtsland",
    "provider": "Anbieter",
    "url": "URL",
    "identifier": "Identifier",
    "date": "Datum",
    "time": "Uhrzeit",
    "timezone": "Zeitzone",
    "value": "Inhalt",
    "semantic_key": "Bedeutung",
    "service": "Anbieter",
    "text": "Text",
    "country_code": "Ländercode",
    "country": "Land",
    "admin_area_1": "Bundesland / State / Provinz",
    "admin_area_2": "Landkreis / County",
    "locality": "Stadt / Ort",
    "dependent_locality": "Stadtteil",
    "postal_code": "Postleitzahl",
    "street": "Straße",
    "house_number": "Hausnummer",
    "latitude": "Breitengrad",
    "longitude": "Längengrad",
    "original_input": "Ursprüngliche Ortsangabe",
    "formatted_address": "Vollständige Adresse",
    "retrieved_at": "Abgerufen am",
    "origin": "Herkunft",
    "source": "Quelle",
    "plugin": "Plugin",
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


def render_report(project, preferences, descriptors, messages, generated_at):
    language = preferences["language"]
    pack = messages

    def tr(key):
        return pack.get(key, pack.get("errors." + key, key))

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
        f"""<!doctype html><html lang="{esc(language)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(project['title'])} – Report</title>"""
        + '<link rel="stylesheet" href="/report.css"><div class="report-actions"><button id="print">'
        + esc(tr("ui.print_save_as_pdf"))
        + "</button><span>ARGUS · "
        + esc(tr("ui.research_report"))
        + '</span></div><script src="/print.js"></script><main class="report-sheet">',
        f"<h1>{esc(project['title'])}</h1><p>Argus · {esc(tr('ui.research_report'))} · {esc(generated_at)}</p><p>{esc(doc.get('report_notes', ''))}</p>",
    ]
    if not selected:
        parts.append(
            "<p>"
            + esc(
                tr(
                    "ui.no_findings_selected_for_the_report_select_nodes_in_the_graph_and"
                )
            )
            + "</p>"
        )
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
            group_by_id[ident]["label"]
            for ident in sorted(group_ids, key=lambda id: depths.get(id, 0))
        ]
        plugin = plugins.get(
            node.get("evidence", {}).get("plugin")
        ) or data_plugins.get(node["type"], {})

        def node_tr(key):
            return plugin.get("translations", {}).get(language, {}).get(key, tr(key))

        title = node.get("evidence", {}).get("label_key") or node["label"]
        title = (
            node_tr(title)
            if node.get("evidence", {}).get("run_id")
            or node.get("evidence", {}).get("label_key")
            else title
        )
        parts.append(
            f"""<section class="report-node"><small>{esc(node['type'])} · {esc(' / '.join(groups))}</small><h2>{esc(title)}</h2>"""
        )
        if node["type"] == "image" and node["data"].get("file_id"):
            parts.append(
                f"""<img style="max-width:400px;max-height:300px" src="/api/files/{esc(node['data']['file_id'])}">"""
            )
        if node["type"] in ("file", "video") and node["data"].get("file_id"):
            parts.append(
                '<p><a href="/api/files/'
                + esc(node["data"]["file_id"])
                + '" target="_blank" rel="noopener noreferrer">'
                + esc(tr("ui.open_file"))
                + "</a></p>"
            )
        report_data = copy.deepcopy(node["data"])
        if node["type"] == "profile":
            from core.provider_registry import label

            report_data["provider"] = label(report_data.get("provider", ""))
        parts.append(facts_html(report_data, node_tr))
        review = {
            "unverified": "Unverifiziert",
            "unclear": "Unklar",
            "verified": "Verifiziert",
        }.get(node.get("verification", "unverified"), "Unverifiziert")
        tag_names = [
            tag["name"]
            for tag in preferences.get("tags", [])
            if tag["id"] in node.get("tags", [])
        ]
        parts.append(
            "<p>"
            + esc(tr("ui.verification"))
            + ": "
            + esc(tr(review))
            + (" · " + esc(", ".join(tag_names)) if tag_names else "")
            + "</p>"
        )
        parts.append(
            "<h3>"
            + esc(tr("ui.source_origin"))
            + "</h3>"
            + facts_html(node.get("evidence", {"origin": "manual"}), tr)
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
        parts.append("<h2>" + esc(tr("ui.relationships")) + "</h2><ul>")
        for edge in relations:
            parts.append(
                "<li>"
                + esc(by_id[edge["source"]]["label"])
                + " → "
                + esc(edge.get("label", ""))
                + " → "
                + esc(by_id[edge["target"]]["label"])
                + "</li>"
            )
        parts.append("</ul>")
    parts.append(
        "<h2>"
        + esc(tr("ui.research_history"))
        + "</h2>"
        + facts_html(
            [
                {
                    k: run[k]
                    for k in (
                        "plugin",
                        "action",
                        "started_at",
                        "finished_at",
                        "status",
                        "warnings",
                        "error",
                    )
                    if k in run
                }
                for run in doc["runs"]
            ],
            tr,
        )
        + "</main></html>"
    )
    return "".join(parts).encode()
