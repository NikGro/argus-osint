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
    if isinstance(value, (dict, list)):
        pairs = value.items() if isinstance(value, dict) else enumerate(value, 1)
        cells = []
        for key, item in pairs:
            if item is None or item == "":
                continue
            title = REPORT_LABELS.get(key, str(key).replace("_", " "))
            cells.append(
                "<tr><th>"
                + html.escape(tr(title))
                + "</th><td>"
                + facts_html(item, tr)
                + "</td></tr>"
            )
        return "<table>" + "".join(cells) + "</table>"
    return html.escape(str(value))


def render_report(project, preferences, descriptors, messages, generated_at):
    language = preferences["language"]
    pack = messages

    def tr(key):
        return pack.get(key, key)

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
        f'<!doctype html><html lang="{esc(language)}"><meta charset="utf-8"><title>{esc(project["title"])} – Report</title><style>body{{font:15px/1.65 system-ui;max-width:960px;margin:40px auto;padding:24px;color:#172334;background:#fff}}table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere;white-space:pre-wrap}}th{{width:32%;font-weight:500;color:#66503b}}section{{break-inside:avoid;border-top:1px solid #ccd;padding-top:20px;margin-top:28px}}h1{{font-size:30px;line-height:1.2;letter-spacing:-.02em;overflow-wrap:anywhere}}h2{{font-size:20px;line-height:1.35}}small{{color:#526478}}button{{font:inherit;background:#f4f6f9;color:#172334;border:1px solid #aab5c3;border-radius:7px;padding:8px 14px;cursor:pointer}}button:focus-visible{{outline:2px solid #995200;outline-offset:3px}}@media print{{button{{display:none}}body{{margin:0}}}}</style><button id="print">{esc(tr("Drucken / als PDF speichern"))}</button><script src="/print.js"></script>',
        f'<h1>{esc(project["title"])}</h1><p>Argus · {esc(tr("Recherchebericht"))} · {esc(generated_at)}</p><p>{esc(doc.get("report_notes", ""))}</p>',
    ]
    if not selected:
        parts.append(
            "<p>"
            + esc(
                tr(
                    "Keine Erkenntnisse für den Report ausgewählt. Im Graphen Knoten markieren und „Report“ aktivieren."
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
            f'<section><small>{esc(node["type"])} · {esc(" / ".join(groups))}</small><h2>{esc(title)}</h2>'
        )
        if node["type"] == "image" and node["data"].get("file_id"):
            parts.append(
                f'<img style="max-width:400px;max-height:300px" src="/api/files/{esc(node["data"]["file_id"])}">'
            )
        if node["type"] == "file" and node["data"].get("file_id"):
            parts.append(
                '<p><a href="/api/files/'
                + esc(node["data"]["file_id"])
                + '" target="_blank" rel="noopener noreferrer">'
                + esc(tr("Datei öffnen"))
                + "</a></p>"
            )
        report_data = copy.deepcopy(node["data"])
        if node["type"] == "profile":
            from provider_registry import label

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
            + esc(tr("Verifizierung"))
            + ": "
            + esc(tr(review))
            + (" · " + esc(", ".join(tag_names)) if tag_names else "")
            + "</p>"
        )
        parts.append(
            "<h3>"
            + esc(tr("Quelle / Herkunft"))
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
        parts.append("<h2>" + esc(tr("Beziehungen")) + "</h2><ul>")
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
        + esc(tr("Rechercheverlauf"))
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
        + "</html>"
    )
    return "".join(parts).encode()
