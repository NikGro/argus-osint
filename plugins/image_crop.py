"""Non-destructive photo cropping using the same rectangle contract as video."""

import io
from PIL import Image, ImageOps
from core.crop import CROP_DEFAULTS, CROP_SCHEMA, crop_box

PLUGIN = {
    "id": "image_crop",
    "name": "Photo crop",
    "icon": "crop",
    "category": "Media",
    "description": "Choose a rectangle visually and save a cropped copy of a photo.",
    "translations": {
        "de": {
            "Photo crop": "Foto zuschneiden",
            "Crop photo": "Foto zuschneiden",
            "Media": "Medien",
            "Choose a rectangle visually and save a cropped copy of a photo.": "Einen Bildausschnitt auswählen und als neue Bilddatei speichern.",
        },
        "en": {
            "Photo crop": "Photo crop",
            "Crop photo": "Crop photo",
            "Media": "Media",
            "Choose a rectangle visually and save a cropped copy of a photo.": "Choose a rectangle visually and save a cropped copy of a photo.",
        },
    },
    "actions": [
        {
            "id": "crop",
            "name": "Crop photo",
            "icon": "crop",
            "inputs": ["image"],
            "min_inputs": 1,
            "max_inputs": 1,
            "external": False,
            "default_params": {**CROP_DEFAULTS, "crop_enabled": True},
            "parameter_schema": CROP_SCHEMA,
        }
    ],
}


def run(action, inputs, params, context):
    if action != "crop" or len(inputs) != 1 or inputs[0]["type"] != "image":
        raise ValueError("Select one image input.")
    node = inputs[0]
    path = context["resolve_file"](node["data"].get("file_id", ""))
    with Image.open(path) as original:
        if original.width * original.height > 40_000_000:
            raise ValueError("Photo cropping supports images up to 40 MP.")
        image = ImageOps.exif_transpose(original)
        box = crop_box(params, *image.size)
        if box:
            x, y, w, h = box
            image = image.crop((x, y, x + w, y + h))
        if image.mode not in ("RGB", "RGBA", "L", "LA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        output = io.BytesIO()
        image.save(output, format="PNG")
    if output.tell() > 128 * 1024 * 1024:
        raise ValueError("The generated media exceeds the 128 MB limit.")
    stored = context["store_file"](output.getvalue(), "cropped-photo.png")
    return {
        "outputs": [
            {
                "type": "image",
                "label": "cropped-photo.png",
                "data": {"file_id": stored["file_id"], "filename": "cropped-photo.png"},
                "source_input": node["id"],
                "relation": "Cropped copy",
                "source": {"tool": "Pillow", "crop_pixels": box},
            }
        ],
        "warnings": [],
    }
