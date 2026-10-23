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
        codes, diagnostics = (set(), set())
        for path in [
            *ROOT.glob("*.py"),
            *(ROOT / "core").glob("*.py"),
            *(ROOT / "plugins").glob("*.py"),
        ]:
            for node in ast.walk(ast.parse(path.read_text(encoding="utf8"))):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and (node.func.id in {"AppError", "DomainError"})
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


GERMAN = re.compile(
    r"[äöüÄÖÜß]|\b(und|oder|nicht|der|die|das|ein|eine|wird|ist|mit|für|auf|kein\w*"
    r"|Ergebnis\w*|Quelle\w*|Fehler|Datei|wurde|Anbieter|Treffer|Ort|Bild|Wert|Knoten"
    r"|Profil\w*|Konto|Nummer|Angaben|erreicht|aktivieren|begrenzt|Unbekannt\w*"
    r"|Ungültig\w*|deaktiviert|gefunden|\w*protokoll|\w*befund)\b"
)
ENGLISH = re.compile(
    r"\b(the|and|with|must|invalid|missing|unavailable|cannot|could|should|please"
    r"|selected|supported|refers|unknown)\b",
    re.IGNORECASE,
)


def load_packs():
    return {
        locale: json.loads(
            (ROOT / "static/locales" / (locale + ".json")).read_text(encoding="utf8")
        )["messages"]
        for locale in ("de", "en")
    }


def plugin_translations(locale):
    import importlib
    import sys

    sys.path.insert(0, str(ROOT))
    merged = {}
    for path in (ROOT / "plugins/locales").glob("*.json"):
        merged.update(json.loads(path.read_text(encoding="utf8")).get(locale, {}))
    for path in (ROOT / "plugins").glob("*.py"):
        if not path.stem.startswith("_"):
            module = importlib.import_module("plugins." + path.stem)
            merged.update(module.PLUGIN.get("translations", {}).get(locale, {}))
    for path in (ROOT / "data_plugins").glob("*.json"):
        data = json.loads(path.read_text(encoding="utf8"))
        merged.update(data.get("translations", {}).get(locale, {}))
    return merged


class LanguagePackContracts(unittest.TestCase):
    """The interface must not fall back to the other language."""

    def test_frontend_literal_keys_exist_in_both_languages(self):
        packs = load_packs()
        aliases = json.loads(
            (ROOT / "static/message-keys.json").read_text(encoding="utf8")
        )
        pattern = re.compile(r"""(?<![\w.$])t\(\s*'((?:[^'\\]|\\.)*)'\s*[,)]""")
        files = [
            path
            for path in (ROOT / "static").rglob("*.js*")
            if path.name != "app.js" and path.suffix in (".js", ".jsx")
        ]
        for path in files:
            for match in pattern.finditer(path.read_text(encoding="utf8")):
                key = aliases.get(match.group(1), match.group(1))
                for locale, pack in packs.items():
                    with self.subTest(file=path.name, key=key, locale=locale):
                        self.assertIn(key, pack)

    def test_english_pack_contains_no_german_and_german_errors_no_english(self):
        packs = load_packs()
        for key, value in packs["en"].items():
            with self.subTest(locale="en", key=key):
                self.assertNotRegex(value, "[äöüÄÖÜß]")
        for key, value in packs["de"].items():
            if key.startswith(("validation.", "errors.")):
                with self.subTest(locale="de", key=key):
                    self.assertIsNone(ENGLISH.search(value), value)

    def test_backend_display_text_has_english_translations(self):
        """Labels, relations, warnings and errors that tools emit must translate."""
        en = load_packs()["en"]
        plugin_en = plugin_translations("en")
        sources = sorted((k for k in en if len(k) >= 10), key=len, reverse=True)

        def translated(text):
            stripped = text.strip()
            if text in en or stripped in en or text in plugin_en:
                return True
            numbered = re.match(r"^(.+?) (\d+)$", stripped)
            if numbered and numbered.group(1) in en:
                return True
            for source in sources:
                text = text.replace(source, "")
            return not GERMAN.search(text)

        display = {"label", "relation", "title", "message", "group", "description"}
        found = []
        for path in [*(ROOT / "core").glob("*.py"), *(ROOT / "plugins").glob("*.py")]:
            tree = ast.parse(path.read_text(encoding="utf8"))

            def visit(value, line):
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    if not translated(value.value):
                        found.append(f"{path.name}:{line}: {value.value!r}")
                elif isinstance(value, ast.JoinedStr):
                    for part in value.values:
                        visit(part, line)
                elif isinstance(value, ast.BinOp):
                    visit(value.left, line)
                    visit(value.right, line)
                elif isinstance(value, ast.IfExp):
                    visit(value.body, line)
                    visit(value.orelse, line)

            for node in ast.walk(tree):
                if isinstance(node, ast.Dict):
                    for key, value in zip(node.keys, node.values):
                        if isinstance(key, ast.Constant) and key.value in display:
                            visit(value, node.lineno)
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "append"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "warnings"
                ):
                    for argument in node.args:
                        visit(argument, node.lineno)
                if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                    for argument in node.exc.args:
                        visit(argument, node.lineno)
        self.assertEqual(found, [])

    def test_builtin_plugin_descriptors_translate_to_english(self):
        import importlib
        import sys

        sys.path.insert(0, str(ROOT))
        en = load_packs()["en"]
        aliases = json.loads(
            (ROOT / "static/message-keys.json").read_text(encoding="utf8")
        )

        def texts(descriptor):
            yield from (
                descriptor.get(k)
                for k in ("name", "description", "category")
                if descriptor.get(k)
            )
            for action in descriptor.get("actions", []):
                yield from (
                    action.get(k) for k in ("name", "external_notice") if action.get(k)
                )
            for node in descriptor.get("nodes", []):
                yield from (
                    node.get(k)
                    for k in ("name", "new_label", "category")
                    if node.get(k)
                )

        descriptors = []
        for path in (ROOT / "plugins").glob("*.py"):
            if not path.stem.startswith("_"):
                module = importlib.import_module("plugins." + path.stem)
                local = ROOT / "plugins/locales" / (module.PLUGIN["id"] + ".json")
                own = {
                    **(
                        json.loads(local.read_text(encoding="utf8")).get("en", {})
                        if local.exists()
                        else {}
                    ),
                    **module.PLUGIN.get("translations", {}).get("en", {}),
                }
                descriptors.append((module.PLUGIN, own))
        for path in (ROOT / "data_plugins").glob("*.json"):
            data = json.loads(path.read_text(encoding="utf8"))
            descriptors.append((data, data.get("translations", {}).get("en", {})))
        for descriptor, own in descriptors:
            for text in texts(descriptor):
                if GERMAN.search(text):
                    with self.subTest(plugin=descriptor["id"], text=text):
                        self.assertTrue(
                            text in own or aliases.get(text, text) in en, text
                        )


class ReportTranslation(unittest.TestCase):

    def test_generated_labels_and_diagnostics_use_the_report_language(self):
        import sys

        sys.path.insert(0, str(ROOT))
        from core.reports import Translator

        tr = Translator(load_packs()["en"])
        self.assertEqual(tr("Bild 3"), "Image 3")
        self.assertEqual(
            tr("Metadaten extrahieren fehlgeschlagen"), "Extract metadata failed"
        )
        self.assertEqual(tr("Holehe · Suchprotokoll"), "Holehe · search record")
        self.assertEqual(tr("needs_input"), "Input required")
        self.assertEqual(
            tr.diagnostic(
                "consensus: Zeit- oder Prozesslimit erreicht; bisherige Ergebnisse"
                " bleiben erhalten."
            ),
            "consensus: Time or process limit reached; results so far are kept.",
        )
