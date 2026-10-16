"""Image preparation and annotation only; this module never imports or runs DeepFace."""

import math
from PIL import Image, ImageDraw, ImageFont, ImageOps

MAX_PIXELS = 40_000_000


def working_image(path, resize_large=False, max_pixels=MAX_PIXELS):
    with Image.open(path) as source:
        original = source.size
        orientation = source.getexif().get(274)
        oriented = original[::-1] if orientation in (5, 6, 7, 8) else original
        oversized = original[0] * original[1] > max_pixels
        if oversized and not resize_large:
            raise ValueError(
                "Bild ist größer als 40 Megapixel. Automatische Arbeitskopie aktivieren."
            )
        ratio = min(1, math.sqrt(max_pixels / (original[0] * original[1])))
        target = tuple(max(1, math.floor(side * ratio)) for side in original)
        if oversized:
            source.draft("RGB", target)
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail(
            target[::-1] if orientation in (5, 6, 7, 8) else target,
            Image.Resampling.LANCZOS,
        )
        return image, {
            "original_size": list(oriented),
            "working_size": list(image.size),
            "resized": oversized,
        }


def overlay(image, faces, selected, result, metadata, destination):
    preview = image.copy()
    preview.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    sx, sy = preview.width / image.width, preview.height / image.height
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=max(12, min(19, preview.width // 55)))
    for index, face in enumerate(faces):
        area = face.get("facial_area", face)
        if not all(
            isinstance(area.get(key), (float, int)) for key in ("x", "y", "w", "h")
        ):
            continue
        chosen = all(
            abs(area[key] - selected.get(key, -10000)) < 2
            for key in ("x", "y", "w", "h")
        )
        color = (
            ("#50dc8d" if result["verified"] else "#ef7480") if chosen else "#ffbb55"
        )
        x, y, right, bottom = (
            area["x"] * sx,
            area["y"] * sy,
            (area["x"] + area["w"]) * sx,
            (area["y"] + area["h"]) * sy,
        )
        draw.rectangle((x, y, right, bottom), outline=color, width=3)
        label = f"Face {index + 1}" + (" | compared" if chosen else "")
        draw.text(
            (max(0, x), max(0, y - 22)),
            label,
            fill=color,
            font=font,
            stroke_width=1,
            stroke_fill="#091019",
        )
        for key, point in area.items():
            if (
                key
                not in ("left_eye", "right_eye", "nose", "mouth_left", "mouth_right")
                or not isinstance(point, (tuple, list))
                or len(point) != 2
            ):
                continue
            if not all(
                isinstance(value, (int, float)) and math.isfinite(value)
                for value in point
            ):
                continue
            px, py = point[0] * sx, point[1] * sy
            draw.ellipse(
                (px - 3, py - 3, px + 3, py + 3), fill="#ff9d45", outline="#10151d"
            )
            draw.text(
                (px + 5, py + 3),
                key.replace("_", " "),
                fill="#ffffff",
                font=font,
                stroke_width=1,
                stroke_fill="#091019",
            )
    status = "MATCH" if result["verified"] else "NO MATCH"
    caption = f"{status} | distance {result['distance']:.4f} | threshold {result['threshold']:.4f}"
    if metadata["resized"]:
        caption += f" | work copy {image.width}x{image.height}"
    draw.rectangle(
        (0, max(0, preview.height - 30), preview.width, preview.height), fill="#101923"
    )
    draw.text((8, max(0, preview.height - 25)), caption, fill="#ffffff", font=font)
    preview.save(destination, "JPEG", quality=92)
    return list(preview.size)
