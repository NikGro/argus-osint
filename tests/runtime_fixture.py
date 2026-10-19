"""One explicit shared integration fixture, always outside user/project storage.

Pure/unit tests create independent ApplicationResources. Older integration cases
share this named resource; importing the production entry point has no facade.
"""

import atexit
import importlib
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
directory = tempfile.TemporaryDirectory(prefix="argus-tests-")
atexit.register(directory.cleanup)
os.environ["DATA_DIR"] = directory.name
app = importlib.import_module("core.application").get_default_application()
