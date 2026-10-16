"""The application's stable error codes and known German validation text need both locales."""

import ast
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LocaleContracts(unittest.TestCase):
    def test_error_codes_and_validation_fragments_have_english_translations(self):
        packs = {
            locale: json.loads(
                (ROOT / "static/locales" / (locale + ".json")).read_text(
                    encoding="utf8"
                )
            )["messages"]
            for locale in ("de", "en")
        }
        codes, diagnostics = set(), set()
        for path in [
            *ROOT.glob("*.py"),
            *(ROOT / "core").glob("*.py"),
            *(ROOT / "plugins").glob("*.py"),
        ]:
            for node in ast.walk(ast.parse(path.read_text(encoding="utf8"))):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "AppError"
                    and node.args
                    and isinstance(node.args[0], ast.Constant)
                ):
                    codes.add(node.args[0].value)
                if isinstance(node, ast.Raise) and node.exc:
                    for fragment in ast.walk(node.exc):
                        if (
                            isinstance(fragment, ast.Constant)
                            and isinstance(fragment.value, str)
                            and re.search(
                                "[äöüÄÖÜß]| nicht | keine|Ungült|Fehler|fehl|Keine|Bild|Eingab",
                                fragment.value,
                            )
                        ):
                            diagnostics.add(fragment.value)
        for code in codes | {"execution_interrupted"}:
            for locale in packs:
                with self.subTest(locale=locale, code=code):
                    self.assertIn("errors." + code, packs[locale])
        for message in diagnostics:
            with self.subTest(message=message):
                self.assertIn(message, packs["en"])
                self.assertNotEqual(message, packs["en"][message])
