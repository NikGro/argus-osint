"""Read-only metadata extraction for images, PDFs, Office files, media and other ExifTool formats."""

import json
from pathlib import Path
from plugins._process import bounded_run

PLUGIN = {
    "id": "metadata",
    "name": "Metadaten extrahieren",
    "category": "Datenbearbeitung",
    "description": "Dateimetadaten lokal aus Bildern, PDFs, Dokumenten und Medien extrahieren.",
    "actions": [
        {
            "id": "extract",
            "name": "Metadaten extrahieren",
            "inputs": ["image", "file"],
            "external": False,
        }
    ],
}


def safe(value):
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(k): safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def attribute_text(value):
    return "" if value is None else str(value)


def attributes(value, path=""):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from attributes(item, (path + "." if path else "") + str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value, 1):
            yield from attributes(item, path + " [" + str(index) + "]")
    else:
        yield path, value


def degrees(value):
    return float(value[0]) + float(value[1]) / 60 + float(value[2]) / 3600


def run(action, inputs, params, context):
    if action != "extract":
        raise ValueError("Unbekannte Metadatenaktion.")
    outputs = []
    updates = []
    warnings = []
    logs = []
    for node in inputs:
        path = Path(context["resolve_file"](node["data"].get("file_id", "")))
        stdout, stderr = bounded_run(
            [
                "exiftool",
                "-json",
                "-G1:4",
                "-a",
                "-s",
                "-n",
                "-struct",
                "-charset",
                "filename=UTF8",
                str(path),
            ],
            60,
            max_bytes=8 * 1024 * 1024,
        )
        rows = json.loads(stdout)
        if not isinstance(rows, list) or len(rows) != 1:
            raise ValueError("Unlesbare Metadatenausgabe.")
        metadata = {
            k: v
            for k, v in rows[0].items()
            if k != "SourceFile" and k.split(":")[-1] != "Directory"
        }
        metadata = {
            key: (
                (node["data"].get("filename") or node.get("label", "Datei"))
                if key.split(":")[-1] == "FileName"
                else value
            )
            for key, value in metadata.items()
        }
        metadata["System:FileName"] = node["data"].get("filename") or node.get(
            "label", "Datei"
        )
        updates.append(
            {"id": node["id"], "data": node["data"], "evidence": {"metadata": metadata}}
        )
        group = "Metadaten · " + str(node.get("label") or metadata["System:FileName"])
        for attribute, value in attributes(metadata):
            outputs.append(
                {
                    "type": "value",
                    "label": attribute,
                    "data": {"value": attribute_text(value)},
                    "source_input": node["id"],
                    "group": group,
                    "group_id": node["id"],
                    "relation": "Metadatum",
                    "source": {
                        "tool": "ExifTool",
                        "attribute": attribute,
                        "raw_value": value,
                    },
                }
            )
        if stderr.strip():
            warnings.append(stderr.strip())
        if metadata.get("ExifTool:Warning"):
            warnings.append(str(metadata["ExifTool:Warning"]))
        logs.append(json.dumps(metadata, ensure_ascii=False))
    return {
        "outputs": outputs,
        "updates": updates,
        "warnings": warnings,
        "log": "\n".join(logs),
    }
