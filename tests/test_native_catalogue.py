"""Every plugin entry module ships in the native catalogue."""

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
# Source helpers that stay part of the core rather than installable plugins.
CORE_HELPERS = {"holehe", "maigret", "phoneinfoga", "profiles"}


class NativeCatalogue(unittest.TestCase):
    def test_every_plugin_module_is_listed(self):
        spec = importlib.util.spec_from_file_location(
            "build_plugin_manifest", ROOT / "scripts/build_plugin_manifest.py"
        )
        manifest = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(manifest)
        modules = {
            path.stem
            for path in (ROOT / "plugins").glob("*.py")
            if not path.stem.startswith("_")
        }
        self.assertEqual(modules - set(manifest.NATIVE) - CORE_HELPERS, set())


if __name__ == "__main__":
    unittest.main()
