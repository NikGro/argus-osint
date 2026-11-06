"""Location of the helper scripts that ship in the image.

Native plugins are downloaded into the data volume, but their runner scripts
stay next to this file, so entry modules must not resolve them via __file__.
"""

from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent


def helper(name):
    return str(DIRECTORY / name)
