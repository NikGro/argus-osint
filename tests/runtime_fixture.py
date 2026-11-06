"""One explicit shared integration fixture, always outside user/project storage.

Pure/unit tests create independent ApplicationResources. Older integration cases
share this named resource; importing the production entry point has no facade.
"""

import tool_stubs  # noqa: F401  (external tools count as installed)
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
# Native plugins are installed from this checkout instead of GitHub. Their
# external tools come from ARGUS_TOOLS_DIR (preinstalled in the CI image).
os.environ.setdefault("ARGUS_PLUGIN_SOURCE", str(Path(__file__).resolve().parents[1]))
app = importlib.import_module("core.application").get_default_application()
for plugin_id in app.MANAGER.native:
    app.MANAGER.install_now(plugin_id, with_tools=False)
