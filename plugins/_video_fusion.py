"""Bounded, non-generative CPU fusion worker. Never imports or executes DeepFace."""

import json
from pathlib import Path
import sys

import cv2
import numpy as np


def main():
    cv2.setNumThreads(2)
    options = json.load(sys.stdin)
    directory = Path(options["directory"])
    paths = sorted(directory.glob("frame-*.png"))[:32]
    frames = [cv2.imread(str(path), cv2.IMREAD_COLOR) for path in paths]
    if len(frames) < 2 or any(frame is None for frame in frames):
        raise ValueError("At least two readable frames are required.")
    sharpness = [
        float(cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_32F).var())
        for frame in frames
    ]
    reference_index = int(np.argmax(sharpness))
    reference = frames[reference_index]
    h, w = reference.shape[:2]
    gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    # Alignment is estimated on smaller frames; translations are restored to working size.
    ratio = min(1, 640 / w)
    small = cv2.resize(gray, None, fx=ratio, fy=ratio)
    aligned, masks, weights = (
        [reference.astype(np.float32) / 255],
        [np.ones((h, w), np.float32)],
        [1.0],
    )
    rejected = 0
    correlations = []
    for index, frame in enumerate(frames):
        if index == reference_index:
            continue
        target = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        warp = np.eye(2, 3, dtype=np.float32)
        try:
            score, warp = cv2.findTransformECC(
                small,
                cv2.resize(target, None, fx=ratio, fy=ratio),
                warp,
                cv2.MOTION_EUCLIDEAN,
                (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 60, 1e-5),
                None,
                5,
            )
            warp[:, 2] /= ratio
            if (
                not np.isfinite(warp).all()
                or score < options["alignment_min"]
                or np.linalg.norm(warp[:, 2]) > max(w, h) * 0.2
            ):
                raise ValueError("Unreliable alignment")
            aligned.append(
                cv2.warpAffine(
                    frame.astype(np.float32) / 255,
                    warp,
                    (w, h),
                    flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP,
                    borderMode=cv2.BORDER_REFLECT,
                )
            )
            masks.append(
                cv2.warpAffine(
                    np.ones((h, w), np.float32),
                    warp,
                    (w, h),
                    flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP,
                    borderMode=cv2.BORDER_CONSTANT,
                )
            )
            weights.append(
                float(
                    np.clip(
                        sharpness[index] / max(sharpness[reference_index], 1e-6), 0.1, 1
                    )
                )
            )
            correlations.append(float(score))
        except (cv2.error, ValueError):
            rejected += 1
    if len(aligned) < 2:
        raise ValueError(
            "No reliable multi-frame alignment was found. Choose a more stable, textured sequence."
        )
    numerator = np.zeros_like(aligned[0])
    denominator = np.zeros((h, w), np.float32)
    for image, mask, weight in zip(aligned, masks, weights):
        # Reference-anchored robust weights suppress moving objects and occlusion ghosts.
        residual = np.mean(np.abs(image - aligned[0]), axis=2)
        robust = 1 / (1 + (residual / 0.045) ** 4)
        contribution = mask * robust * weight
        numerator += image * contribution[..., None]
        denominator += contribution
    fused = numerator / np.maximum(denominator[..., None], 1e-6)
    scale = int(options["scale"])
    if scale == 2:
        fused = cv2.resize(fused, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    output = np.clip(fused * 255, 0, 255).astype(np.uint8)
    if not cv2.imwrite(str(directory / "fused.png"), output):
        raise ValueError("The fused image could not be written.")
    warnings = (
        [f"{rejected} frames were excluded because their alignment was unreliable."]
        if rejected
        else []
    )
    print(
        json.dumps(
            {
                "frames_extracted": len(frames),
                "frames_used": len(aligned),
                "frames_rejected": rejected,
                "reference_frame": reference_index + 1,
                "alignment_scores": correlations,
                "output_width": output.shape[1],
                "output_height": output.shape[0],
                "scale": scale,
                "upscale_method": (
                    "bicubic display enlargement"
                    if scale == 2
                    else "native working resolution"
                ),
                "warnings": warnings,
            }
        )
    )


if __name__ == "__main__":
    main()
