"""Regenerate the hash-pinned dependency locks of the Python research tools.

Every Python tool in core/tools.py installs with `pip --require-hashes` from
core/tool_locks/<tool>.txt, so a changed or substituted package on PyPI fails
the installation instead of running. Run this after changing a tool version:

    python scripts/lock_tools.py            # all tools
    python scripts/lock_tools.py deepface   # one tool

Needs `uv` (https://docs.astral.sh/uv/). Locks target CPython 3.12 on Linux,
the interpreter of the ARGUS image.
"""

import argparse
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LOCKS = ROOT / "core" / "tool_locks"

# Tools installed from a pinned GitHub commit list that commit's own
# dependencies here; the source itself is installed without dependencies.
INPUTS = {
    "sherlock": ["sherlock-project==0.16.2"],
    "maigret": ["maigret==0.6.6"],
    "holehe": ["holehe==1.61"],
    "ignorant": ["ignorant==1.2"],
    "user_scanner": ["user-scanner==1.5.2.2"],
    "deepface": [
        "deepface==0.0.102",
        "onnxruntime==1.31.0",
        "numpy==2.5.4",
        "opencv-python==5.0.0.93",
        "opencv-contrib-python-headless==5.0.0.93",
    ],
    "instagram": ["instagrapi==3.0.25", "toutatis==1.31"],
    "media": ["numpy==2.5.4", "opencv-contrib-python-headless==5.0.0.93"],
    "dopplergeist": ["dopplergeist==0.1.2"],
    # Consensus-OSINT d8545a7: pyproject dependencies + [modules] + build backend.
    "consensus": [
        "httpx[http2,socks]>=0.28,<1",
        "rich>=13.0",
        "prompt-toolkit>=3.0.51,<4",
        "phonenumbers>=8.13",
        "dnspython>=2.6.1",
        "jinja2>=3.1.6",
        "PyYAML>=6.0",
        "beautifulsoup4>=4.12",
        "aiohttp>=3.14.3",
        "trio>=0.27",
        "lxml>=6.1.0",
        "curl_cffi>=0.15.0",
        "socid-extractor>=0.0.27",
        "requests>=2.33.0",
        "termcolor>=2.0",
        "colorama>=0.4",
        "setuptools>=77",
        "wheel",
    ],
    # Blackbird b455050: requirements.txt.
    "blackbird": [
        "aiohappyeyeballs==2.6.1",
        "aiohttp==3.12.13",
        "aiosignal==1.3.2",
        "attrs==25.3.0",
        "certifi==2025.6.15",
        "chardet==5.2.0",
        "charset-normalizer==3.4.2",
        "frozenlist==1.7.0",
        "idna==3.10",
        "markdown-it-py==3.0.0",
        "mdurl==0.1.2",
        "multidict==6.6.2",
        "pillow==11.3.0",
        "propcache==0.3.2",
        "Pygments==2.19.2",
        "python-dotenv==1.1.1",
        "reportlab==4.4.2",
        "requests==2.32.4",
        "rich==14.0.0",
        "urllib3==2.5.0",
        "yarl==1.20.1",
    ],
    # FlareSolverr 76dc404: requirements.txt (Linux entries).
    "flaresolverr": [
        "bottle==0.13.4",
        "waitress==3.0.2",
        "selenium==4.47.0",
        "func-timeout==4.3.5",
        "prometheus-client==0.26.0",
        "requests==2.34.2",
        "certifi==2026.7.22",
        "websockets==17.0.1",
        "packaging==26.3",
        "xvfbwrapper==0.2.29",
        "setuptools",
    ],
}


def lock(tool):
    LOCKS.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / f"{tool}.in"
        source.write_text("\n".join(INPUTS[tool]) + "\n")
        subprocess.run(
            [
                "uv",
                "pip",
                "compile",
                str(source),
                "--generate-hashes",
                "--universal",
                "--python-version",
                "3.12",
                "--no-header",
                "--no-annotate",
                "--quiet",
                "--output-file",
                str(LOCKS / f"{tool}.txt"),
            ],
            check=True,
        )
    print("locked", tool)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tools", nargs="*", help="tool ids (default: all)")
    for tool in parser.parse_args().tools or INPUTS:
        lock(tool)


if __name__ == "__main__":
    main()
