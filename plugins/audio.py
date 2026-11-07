"""Non-destructive local audio operations. Originals are never overwritten."""

import json
import math
from pathlib import Path
import tempfile

from core.video import probe_audio
from plugins._process import bounded_run

PLUGIN = {
    "id": "audio",
    "name": "Audio tools",
    "icon": "audio",
    "category": "Media",
    "description": "Trim an audio file into a new copy.",
    "actions": [
        {
            "id": "trim",
            "name": "Trim audio",
            "icon": "audio",
            "inputs": ["audio"],
            "min_inputs": 1,
            "max_inputs": 1,
            "external": False,
            "default_params": {"start_seconds": 0.0, "end_seconds": 10.0},
            "parameter_schema": {
                "start_seconds": {
                    "secret": False,
                    "min": 0,
                    "max": 86400,
                    "step": 0.01,
                    "label": "Start (seconds)",
                },
                "end_seconds": {
                    "secret": False,
                    "min": 0.01,
                    "max": 86400,
                    "step": 0.01,
                    "label": "End (seconds)",
                },
            },
        }
    ],
}

MAX_CLIP_SECONDS = 3600


def number(params, key, default, low, high):
    value = params.get(key, default)
    if isinstance(value, bool):
        raise ValueError("Invalid numeric audio option: " + key)
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError("Invalid numeric audio option: " + key) from None
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError("Audio option is outside the allowed range: " + key)
    return value


def probe_duration(path):
    """Duration of the first audio stream, read from the file rather than the upload name."""
    duration = probe_audio(path).get("duration")
    if not duration:
        raise ValueError("The file could not be read as audio.")
    return duration


def run(action, inputs, params, context):
    if action != "trim" or len(inputs) != 1 or inputs[0]["type"] != "audio":
        raise ValueError("Select one audio input.")
    node = inputs[0]
    path = Path(context["resolve_file"](node["data"].get("file_id", "")))
    total = probe_duration(path)
    start = number(params, "start_seconds", 0, 0, 86400)
    end = number(params, "end_seconds", 10, 0.01, 86400)
    if start >= total:
        raise ValueError("The start time must be inside the audio.")
    end = min(end, total)
    if end <= start or end - start > MAX_CLIP_SECONDS:
        raise ValueError(
            "Choose an end after the start, within the audio; maximum clip length is 60 minutes."
        )
    with tempfile.TemporaryDirectory(prefix="argus-audio-") as directory:
        output = Path(directory) / "clip.m4a"
        bounded_run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-ss",
                str(start),
                "-i",
                str(path),
                "-t",
                str(end - start),
                "-map",
                "0:a:0",
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                "-y",
                str(output),
            ],
            None,
            output_limit=(output, 128 * 1024 * 1024),
        )
        if not output.is_file() or output.stat().st_size > 128 * 1024 * 1024:
            raise ValueError("The generated audio exceeds the 128 MB limit.")
        filename = "trimmed-audio.m4a"
        duration = probe_duration(output)
        stored = context["store_file"](output.read_bytes(), filename)
    details = {
        "start_seconds": start,
        "end_seconds": end,
        "method": "FFmpeg AAC re-encode",
    }
    return {
        "outputs": [
            {
                "type": "audio",
                "label": filename,
                "data": {
                    "file_id": stored["file_id"],
                    "filename": filename,
                    "mime": stored["mime"],
                    "size": stored["size"],
                    "duration": duration,
                },
                "source_input": node["id"],
                "relation": "Trimmed copy",
                "source": {"tool": "FFmpeg", **details},
            }
        ],
        "log": json.dumps(details),
    }
