"""Marks every external research tool as installed for mocked adapter tests.

Adapter tests replace the subprocess, so they only need the tool registry to
report the tool as present. The CI image sets ARGUS_TOOLS_DIR to real,
preinstalled tools; then nothing is stubbed and integration tests use them.
"""

import atexit
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if "ARGUS_TOOLS_DIR" not in os.environ:
    _directory = tempfile.TemporaryDirectory(prefix="argus-tools-")
    atexit.register(_directory.cleanup)
    os.environ["ARGUS_TOOLS_DIR"] = _directory.name

from core import tools  # noqa: E402

tools.configure(os.environ["ARGUS_TOOLS_DIR"])
for _tool, _recipe in tools.RECIPES.items():
    if not tools.installed(_tool):
        marker = tools.directory(_tool) / tools.MARKER
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps({"version": _recipe.version, "stub": True}))


def real(tool):
    """True when the tool is really installed, not only stubbed for tests."""
    if not tools.installed(tool):
        return False
    marker = tools.directory(tool) / tools.MARKER
    return not json.loads(marker.read_text()).get("stub")


# Test managers prune tools they do not need; stubs are shared by all tests,
# so removing them would break later tests that rely on the stub.
_remove = tools.remove


def _keep_stubs(tool):
    marker = tools.directory(tool) / tools.MARKER
    try:
        if json.loads(marker.read_text()).get("stub"):
            return
    except (OSError, ValueError):
        pass
    _remove(tool)


tools.remove = _keep_stubs
