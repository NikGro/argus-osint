"""Application identity derived from the same VERSION file shipped in the image."""

from pathlib import Path

VERSION = (
    (Path(__file__).resolve().parents[1] / "VERSION")
    .read_text(encoding="utf-8")
    .strip()
)


def user_agent(component):
    return f"ARGUS/{VERSION} ({component})"
