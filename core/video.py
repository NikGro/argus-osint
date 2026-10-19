"""Local video metadata inspection, independent of names supplied during upload."""

from core.errors import DomainError
import json
import math
import subprocess


def probe_video(path, required=True):
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=format_name,duration",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            timeout=15,
            check=True,
        )
        info = json.loads(result.stdout)
        stream = info.get("streams", [])[0]
        duration = float(
            info.get("format", {}).get("duration") or stream.get("duration") or 0
        )
        width, height = (int(stream["width"]), int(stream["height"]))
        rotation = next(
            (
                item["rotation"]
                for item in stream.get("side_data_list", [])
                if "rotation" in item
            ),
            stream.get("tags", {}).get("rotate", 0),
        )
        if int(float(rotation)) % 180 == 90:
            width, height = (height, width)
        if not math.isfinite(duration) or duration <= 0 or width <= 0 or (height <= 0):
            raise DomainError("validation.4712582c31")
        formats = info.get("format", {}).get("format_name", "").split(",")
        mime = (
            "video/webm"
            if "webm" in formats
            else (
                "video/mp4"
                if "mp4" in formats
                else (
                    "video/quicktime"
                    if "mov" in formats
                    else "application/octet-stream"
                )
            )
        )
        return {"duration": duration, "width": width, "height": height, "mime": mime}
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError):
        if required:
            raise DomainError("validation.9c5a20da87") from None
        return {}
