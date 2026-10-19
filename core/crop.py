"""One normalized crop contract shared by image and video tools."""

from core.errors import DomainError
import math

CROP_DEFAULTS = {
    "crop_enabled": False,
    "crop_x": 0.0,
    "crop_y": 0.0,
    "crop_width": 1.0,
    "crop_height": 1.0,
}
CROP_SCHEMA = {
    key: {"secret": False, "min": 0, "max": 1, "step": 0.001}
    for key in CROP_DEFAULTS
    if key != "crop_enabled"
}


def crop_box(params, width, height, even=False):
    if not isinstance(params.get("crop_enabled", False), bool):
        raise DomainError("validation.dabce27835")
    if not params.get("crop_enabled", False):
        return None
    values = []
    for key in ("crop_x", "crop_y", "crop_width", "crop_height"):
        value = params.get(key, CROP_DEFAULTS[key])
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or (not math.isfinite(value))
        ):
            raise DomainError("validation.32698effeb")
        values.append(value)
    x, y, w, h = values
    if x < 0 or y < 0 or w <= 0 or (h <= 0) or (x + w > 1.000001) or (y + h > 1.000001):
        raise DomainError("validation.b1693aec33")
    left, top = (round(x * width), round(y * height))
    right, bottom = (
        min(width, round((x + w) * width)),
        min(height, round((y + h) * height)),
    )
    if even:
        left, top = (left // 2 * 2, top // 2 * 2)
        right, bottom = (right // 2 * 2, bottom // 2 * 2)
    if right - left < (2 if even else 1) or bottom - top < (2 if even else 1):
        raise DomainError("validation.008643ca3c")
    return (left, top, right - left, bottom - top)
