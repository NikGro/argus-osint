"""Non-destructive local video operations. Originals are never overwritten."""

import json
import math
from pathlib import Path
import tempfile

from core.video import probe_video
from core.crop import CROP_DEFAULTS, CROP_SCHEMA, crop_box
from plugins._process import bounded_run

FUSION_PYTHON = "/opt/argus-tools/media-venv/bin/python"
PLUGIN = {
    "id": "video",
    "name": "Video tools",
    "icon": "video-analysis",
    "category": "Media",
    "description": "Trim a video into a new copy, or fuse a short sequence into a still image on the CPU.",
    "actions": [
        {
            "id": "trim",
            "name": "Trim video",
            "icon": "video-trim",
            "inputs": ["video"],
            "min_inputs": 1,
            "max_inputs": 1,
            "external": False,
            "default_params": {
                "start_seconds": 0.0,
                "end_seconds": 2.0,
                **CROP_DEFAULTS,
            },
            "parameter_schema": {
                **CROP_SCHEMA,
                "start_seconds": {
                    "secret": False,
                    "min": 0,
                    "max": 86400,
                    "step": 0.01,
                },
                "end_seconds": {
                    "secret": False,
                    "min": 0.01,
                    "max": 86400,
                    "step": 0.01,
                },
            },
        },
        {
            "id": "fuse",
            "name": "Fuse video frames into an image",
            "icon": "video-analysis",
            "inputs": ["video"],
            "min_inputs": 1,
            "max_inputs": 1,
            "external": False,
            "default_params": {
                "start_seconds": 0.0,
                "burst_seconds": 2.0,
                "max_frames": 24,
                "scale_factor": 1,
                "alignment_min": 0.7,
            },
            "parameter_schema": {
                **CROP_SCHEMA,
                "start_seconds": {
                    "secret": False,
                    "min": 0,
                    "max": 86400,
                    "step": 0.01,
                },
                "burst_seconds": {"secret": False, "min": 0.2, "max": 3, "step": 0.1},
                "max_frames": {"secret": False, "min": 2, "max": 32, "step": 1},
                "scale_factor": {"secret": False, "enum": [1, 2]},
                "alignment_min": {
                    "secret": False,
                    "min": 0.1,
                    "max": 0.99,
                    "step": 0.01,
                },
            },
        },
    ],
}


def number(params, key, default, low, high):
    value = params.get(key, default)
    if isinstance(value, bool):
        raise ValueError("Invalid numeric video option: " + key)
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError("Invalid numeric video option: " + key) from None
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError("Video option is outside the allowed range: " + key)
    return value


def run(action, inputs, params, context):
    if (
        action not in ("trim", "fuse")
        or len(inputs) != 1
        or inputs[0]["type"] != "video"
    ):
        raise ValueError("Select one video input.")
    node = inputs[0]
    path = Path(context["resolve_file"](node["data"].get("file_id", "")))
    info = probe_video(path)
    if info["width"] * info["height"] > 40_000_000:
        raise ValueError("Video frames larger than 40 MP are not supported.")
    start = number(params, "start_seconds", 0, 0, 86400)
    if start >= info["duration"]:
        raise ValueError("The start time must be inside the video.")
    warnings = []
    with tempfile.TemporaryDirectory(prefix="argus-video-") as directory:
        folder = Path(directory)
        common = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-threads",
            "2",
            "-ss",
            str(start),
            "-i",
            str(path),
        ]
        if action == "trim":
            end = number(params, "end_seconds", 2, 0.01, 86400)
            if end <= start or end - start > 600 or end > info["duration"] + 0.05:
                raise ValueError(
                    "Choose an end after the start, within the video; maximum clip length is 600 seconds."
                )
            output = folder / "clip.mp4"
            box = crop_box(params, info["width"], info["height"], even=True)
            filters = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
            if box:
                x, y, width, height = box
                filters = f"crop={width}:{height}:{x}:{y}," + filters
            bounded_run(
                common
                + [
                    "-t",
                    str(end - start),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-vf",
                    filters,
                    "-c:v",
                    "libx264",
                    "-threads",
                    "2",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    "-y",
                    str(output),
                ],
                300,
                output_limit=(output, 128 * 1024 * 1024),
            )
            details = {
                "start_seconds": start,
                "end_seconds": end,
                "crop_pixels": box,
                "method": "FFmpeg H.264/AAC re-encode",
            }
            kind, filename = "video", "trimmed-video.mp4"
            duration = probe_video(output)["duration"]
        else:
            duration = number(params, "burst_seconds", 2, 0.2, 3)
            if start + duration > info["duration"] + 0.05:
                raise ValueError("The selected sequence extends beyond the video.")
            frames = number(params, "max_frames", 24, 2, 32)
            scale = number(params, "scale_factor", 1, 1, 2)
            if not frames.is_integer() or scale not in (1, 2):
                raise ValueError("Frame count and output scale must be whole numbers.")
            minimum = number(params, "alignment_min", 0.7, 0.1, 0.99)
            fps = min(16, frames / duration)
            # Bounded 1280x720 working frames keep CPU/RAM use predictable on a NAS.
            bounded_run(
                common
                + [
                    "-t",
                    str(duration),
                    "-an",
                    "-vf",
                    f"fps={fps},scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                    "-frames:v",
                    str(int(frames)),
                    "-threads",
                    "2",
                    "-y",
                    str(folder / "frame-%03d.png"),
                ],
                120,
            )
            output = folder / "fused.png"
            stdout, _ = bounded_run(
                [FUSION_PYTHON, str(Path(__file__).with_name("_video_fusion.py"))],
                240,
                {
                    "directory": str(folder),
                    "scale": int(scale),
                    "alignment_min": minimum,
                },
                extra_env={"OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"},
            )
            details = json.loads(stdout)
            warnings = details.pop("warnings", [])
            details.update(
                start_seconds=start,
                burst_seconds=duration,
                method="CPU ECC alignment and robust multi-frame fusion",
                working_limit="1280x720",
            )
            kind, filename = "image", "fused-video-frame.png"
        if not output.is_file() or output.stat().st_size > 128 * 1024 * 1024:
            raise ValueError("The generated media exceeds the 128 MB limit.")
        stored = context["store_file"](output.read_bytes(), filename)
        data = {"file_id": stored["file_id"], "filename": filename}
        if kind == "video":
            data.update(mime=stored["mime"], size=stored["size"], duration=duration)
        return {
            "outputs": [
                {
                    "type": kind,
                    "label": filename,
                    "data": data,
                    "source_input": node["id"],
                    "relation": (
                        "Trimmed copy" if kind == "video" else "Multi-frame fusion"
                    ),
                    "source": {
                        "tool": (
                            "FFmpeg" if kind == "video" else "ARGUS CPU fusion (OpenCV)"
                        ),
                        **details,
                    },
                }
            ],
            "warnings": warnings,
            "log": json.dumps(details),
        }
