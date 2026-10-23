"""Local two-image verification adapter; inference runs only on an explicit tool execution."""

import json
import math
from pathlib import Path
import tempfile
from plugins._process import bounded_run

MODELS = [
    "SFace",
    "VGG-Face",
    "Facenet",
    "Facenet512",
    "OpenFace",
    "DeepFace",
    "DeepID",
    "ArcFace",
    "GhostFaceNet",
]
DETECTORS = ["opencv", "ssd", "yunet", "centerface", "skip"]
METRICS = ["cosine", "euclidean", "euclidean_l2", "angular"]
NORMALIZATIONS = [
    "base",
    "raw",
    "Facenet",
    "Facenet2018",
    "VGGFace",
    "VGGFace2",
    "ArcFace",
]
DEFAULTS = {
    "model_name": "SFace",
    "detector_backend": "opencv",
    "distance_metric": "cosine",
    "normalization": "base",
    "align": True,
    "enforce_detection": True,
    "expand_percentage": 0,
    "custom_threshold": False,
    "threshold": 0.4,
    "anti_spoofing": False,
    "include_overlays": True,
    "resize_large_images": False,
    "run_timeout": 300,
    "column_id": "",
    "max_comparisons": 100,
}
SCHEMA = {
    key: {"secret": False, "enum": options}
    for key, options in {
        "model_name": MODELS,
        "detector_backend": DETECTORS,
        "distance_metric": METRICS,
        "normalization": NORMALIZATIONS,
    }.items()
}
SCHEMA.update(
    {
        "expand_percentage": {
            "secret": False,
            "min": 0,
            "max": 100,
            "step": 1,
            "control": "range",
        },
        "threshold": {
            "secret": False,
            "min": 0,
            "max": 100,
            "step": 0.01,
            "control": "range",
        },
        "run_timeout": {
            "secret": False,
            "min": 0,
            "max": 900,
            "step": 10,
            "control": "range",
        },
    }
)
PLUGIN = {
    "id": "deepface",
    "icon": "face-compare",
    "name": "DeepFace",
    "category": "Bildanalyse",
    "description": "Zwei Bilder vergleichen; Scores und Bilder mit Erkennungs-Overlays ausgeben.",
    "actions": [
        {
            "id": "verify",
            "name": "Bilder mit DeepFace vergleichen",
            "inputs": ["image", "database"],
            "min_inputs": 2,
            "max_inputs": 2,
            "input_roles": [["image"], ["image", "database"]],
            "external": False,
            "default_params": DEFAULTS,
            "parameter_schema": SCHEMA,
        }
    ],
}


def validated(params):
    values = {**DEFAULTS, **params}
    for key, choices in [
        ("model_name", MODELS),
        ("detector_backend", DETECTORS),
        ("distance_metric", METRICS),
        ("normalization", NORMALIZATIONS),
    ]:
        if values[key] not in choices:
            raise ValueError("Ungültige DeepFace-Option: " + key)
    for key in (
        "align",
        "enforce_detection",
        "custom_threshold",
        "anti_spoofing",
        "include_overlays",
        "resize_large_images",
    ):
        if not isinstance(values[key], bool):
            raise ValueError("Ungültiger Schalter: " + key)
    for key, low, high in [
        ("expand_percentage", 0, 100),
        ("threshold", 0, 100),
        ("run_timeout", 0, 900),
    ]:
        number = values[key]
        if (
            isinstance(number, bool)
            or not isinstance(number, (int, float))
            or not math.isfinite(number)
            or not low <= number <= high
        ):
            raise ValueError("Ungültiger Zahlenwert: " + key)
    if int(values["expand_percentage"]) != values["expand_percentage"]:
        raise ValueError("Bildausschnitt-Erweiterung muss ganzzahlig sein.")
    if values["run_timeout"] != 0 and values["run_timeout"] < 10:
        key = "run_timeout"
        raise ValueError("Ungültiger Zahlenwert: " + key)
    return values


def run(action, inputs, params, context):
    if action == "verify" and any(n.get("type") == "database" for n in inputs):
        from plugins._database_faces import search

        return search(inputs, validated(params), context, run)
    if (
        action != "verify"
        or len(inputs) != 2
        or any(n.get("type") != "image" for n in inputs)
    ):
        raise ValueError("Genau zwei Bild-Nodes verbinden.")
    values = validated(params)
    # Resolve uploaded files only. URLs are never sent to the library or downloaded here.
    paths = [str(context["resolve_file"](n["data"].get("file_id", ""))) for n in inputs]
    if not values["resize_large_images"]:
        from PIL import Image

        for path in paths:
            with Image.open(path) as image:
                if image.width * image.height > 40_000_000:
                    return {
                        "outputs": [],
                        "warnings": [],
                        "input_request": {
                            "kind": "deepface_resize",
                            "title": "Großes Bild für DeepFace",
                            "message": "Mindestens ein Bild hat mehr als 40 Megapixel. Eine verkleinerte Arbeitskopie verwenden? Die Originale bleiben unverändert.",
                            "fields": [
                                {
                                    "key": "resize_large_images",
                                    "label": "Arbeitskopie auf höchstens 40 Megapixel reduzieren",
                                    "type": "checkbox",
                                    "default": True,
                                    "required": True,
                                }
                            ],
                        },
                    }
    cache = Path(context["credential_dir"]) / "deepface-cache"
    cache.mkdir(parents=True, exist_ok=True)
    annotations = []
    with tempfile.TemporaryDirectory(prefix="argus-deepface-") as folder:
        stdout, _ = bounded_run(
            [
                "/opt/argus-tools/deepface-venv/bin/python",
                "-I",
                str(Path(__file__).with_name("_deepface_runner.py")),
            ],
            int(values["run_timeout"]) if values["run_timeout"] else None,
            {"paths": paths, "params": values, "artifact_dir": folder},
            extra_env={
                "DEEPFACE_HOME": str(cache),
                "DEEPFACE_BACKEND_ENGINE": "onnx",
                "TF_CPP_MIN_LOG_LEVEL": "3",
                "CUDA_VISIBLE_DEVICES": "-1",
                "OMP_NUM_THREADS": "2",
                "TF_NUM_INTRAOP_THREADS": "2",
                "TF_NUM_INTEROP_THREADS": "2",
            },
        )
        result = json.loads(stdout)
        if not isinstance(result, dict) or not isinstance(result.get("verified"), bool):
            raise ValueError("DeepFace lieferte kein gültiges Vergleichsergebnis.")
        for key in ("distance", "threshold"):
            if not isinstance(result.get(key), (float, int)) or not math.isfinite(
                result[key]
            ):
                raise ValueError("DeepFace lieferte keinen gültigen Zahlenwert: " + key)
        for annotation in result.get("annotations", []):
            index = annotation.get("image_index")
            if (
                type(index) is not int
                or index not in (0, 1)
                or annotation.get("file") != f"overlay-{index + 1}.jpg"
            ):
                raise ValueError("Ungültige Overlay-Datei.")
            if not callable(context.get("store_file")):
                result.setdefault("warnings", []).append(
                    "Overlay-Dateien konnten nicht im Projekt gespeichert werden."
                )
                break
            try:
                data = (Path(folder) / annotation["file"]).read_bytes()
                stored = context["store_file"](
                    data, f"DeepFace-Overlay-{index + 1}.jpg"
                )
                annotations.append(
                    {
                        "type": "image",
                        "label": f"DeepFace · Bild {index + 1} · Overlay",
                        "data": {
                            "file_id": stored["file_id"],
                            "filename": stored["filename"],
                            "url": "",
                        },
                        "source_input": inputs[index]["id"],
                        "relation": "DeepFace-Overlay",
                        "source": {
                            "tool": "DeepFace",
                            "input_id": inputs[index]["id"],
                            "annotation": annotation,
                        },
                        "group": "DeepFace",
                        "group_id": ":".join(n["id"] for n in inputs),
                    }
                )
            except Exception as exc:
                result.setdefault("warnings", []).append(
                    f"Overlay für Bild {index + 1} konnte nicht gespeichert werden ({type(exc).__name__})."
                )
    if not isinstance(result.get("verified"), bool):
        raise ValueError("DeepFace lieferte kein gültiges Vergleichsergebnis.")
    source = {
        "tool": "DeepFace",
        "version": "0.0.102",
        "input_ids": [n["id"] for n in inputs],
        "parameters": values,
        "result": result,
    }
    fields = [
        ("Ergebnis", "Match" if result["verified"] else "No match"),
        ("Distanz", result["distance"]),
        ("Schwellenwert", result["threshold"]),
    ]
    if result.get("confidence") is not None:
        fields.append(("Konfidenz (%)", result["confidence"]))
    return {
        "outputs": [
            {
                "type": "value",
                "label": label,
                "data": {"value": str(value)},
                "source_input": inputs[0]["id"],
                "source": source,
                "relation": "Bildvergleich",
                "group": "DeepFace",
                "group_id": ":".join(n["id"] for n in inputs),
            }
            for label, value in fields
        ]
        + annotations,
        "warnings": result.get("warnings", []),
        "log": json.dumps(result, ensure_ascii=False),
    }
