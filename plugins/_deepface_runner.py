"""Isolated DeepFace entry point. Import checks do not invoke this entry point."""

import contextlib
import json
import sys
import importlib.util
from pathlib import Path


def main(payload):
    import numpy as np

    spec = importlib.util.spec_from_file_location(
        "deepface_images", Path(__file__).with_name("_deepface_images.py")
    )
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    p = payload["params"]
    prepared = [
        helper.working_image(path, p.get("resize_large_images", False))
        for path in payload["paths"]
    ]
    images = [np.asarray(image)[:, :, ::-1].copy() for image, _ in prepared]
    from deepface import DeepFace

    result = DeepFace.verify(
        img1_path=images[0],
        img2_path=images[1],
        model_name=p["model_name"],
        detector_backend=p["detector_backend"],
        distance_metric=p["distance_metric"],
        enforce_detection=p["enforce_detection"],
        align=p["align"],
        expand_percentage=int(p["expand_percentage"]),
        normalization=p["normalization"],
        silent=True,
        threshold=p["threshold"] if p["custom_threshold"] else None,
        anti_spoofing=p["anti_spoofing"],
    )
    result["image_processing"] = [metadata for _, metadata in prepared]
    result["annotations"] = []
    result["warnings"] = []
    if p.get("include_overlays", True):
        for index, (image, metadata) in enumerate(prepared):
            selected = result.get("facial_areas", {}).get("img" + str(index + 1), {})
            faces = [{"facial_area": selected}]
            try:
                if p["detector_backend"] != "skip":
                    detected = DeepFace.extract_faces(
                        img_path=images[index],
                        detector_backend=p["detector_backend"],
                        enforce_detection=False,
                        align=p["align"],
                        expand_percentage=int(p["expand_percentage"]),
                        normalize_face=False,
                    )
                    faces = [
                        {
                            "facial_area": face["facial_area"],
                            "confidence": face.get("confidence"),
                        }
                        for face in detected
                        if face.get("confidence", 0) > 0
                    ]
                else:
                    faces = []
                filename = f"overlay-{index + 1}.jpg"
                size = helper.overlay(
                    image,
                    faces,
                    selected,
                    result,
                    metadata,
                    Path(payload["artifact_dir"]) / filename,
                )
                result["annotations"].append(
                    {
                        "file": filename,
                        "image_index": index,
                        "preview_size": size,
                        "faces": faces,
                        **metadata,
                    }
                )
            except Exception as exc:
                result["warnings"].append(
                    f"Overlay für Bild {index + 1} nicht vollständig verfügbar ({type(exc).__name__})."
                )
    return result


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        result = main(payload)
    json.dump(
        result,
        sys.stdout,
        default=lambda value: value.item() if hasattr(value, "item") else str(value),
    )
