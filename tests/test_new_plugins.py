import importlib.util
import shutil
import unittest
from unittest.mock import patch
from plugins import holehe, phoneinfoga
import server


class NewPluginTests(unittest.TestCase):
    def test_holehe_keeps_inconclusive_results_out_of_positive_findings(self):
        rows = [
            {
                "name": "found",
                "domain": "example.org",
                "exists": True,
                "emailrecovery": "m***@example.org",
                "phoneNumber": "+49******12",
            },
            {"name": "blocked", "exists": True, "rateLimit": True},
            {"name": "unknown", "exists": None, "error": "Timeout"},
            {"name": "absent", "exists": False},
        ]
        result = holehe.results(rows, {"id": "email"})
        self.assertEqual(len(result["warnings"]), 2)
        self.assertTrue(
            all(
                output.get("source", {}).get("service") == "found"
                or "Suchprotokoll" in output["label"]
                for output in result["outputs"]
            )
        )
        self.assertEqual(result["outputs"][0]["label"], "Konto besteht?")
        self.assertEqual(result["outputs"][0]["data"]["value"], "Ja")
        self.assertTrue(
            all(set(output["data"]) == {"value"} for output in result["outputs"])
        )
        self.assertEqual(result["outputs"][-1]["source"]["rows"], rows)

    def test_invalid_inputs_never_run_a_subprocess(self):
        with patch.object(holehe, "bounded_run") as command:
            with self.assertRaises(ValueError):
                holehe.run(
                    "lookup", [{"id": "e", "data": {"value": "bad input"}}], {}, {}
                )
            command.assert_not_called()
        with patch.object(phoneinfoga, "bounded_run") as command:
            with self.assertRaises(ValueError):
                phoneinfoga.run(
                    "scan", [{"id": "p", "data": {"value": "--help"}}], {}, {}
                )
            command.assert_not_called()

    def test_phoneinfoga_separates_search_links_and_fields_and_redacts_keys(self):
        sample = "Results for local\nCountry: US\nE164: +12025550123\nResults for googlesearch\nURL: https://www.google.com/search?q=12025550123\nThe following scanners returned errors:\nnumverify: rejected SECRET\n1 scanner(s) succeeded\n"
        with (
            patch.object(
                phoneinfoga.shutil, "which", return_value="/usr/bin/phoneinfoga"
            ),
            patch.object(
                phoneinfoga, "bounded_run", return_value=(sample, "")
            ) as command,
        ):
            result = phoneinfoga.run(
                "scan",
                [{"id": "p", "data": {"value": "+1 (202) 555-0123"}}],
                {"numverify_api_key": "SECRET", "disabled_scanners": ["ovh"]},
                {},
            )
        self.assertEqual(
            command.call_args.args[0],
            ["/usr/bin/phoneinfoga", "scan", "-n", "+12025550123", "--disable", "ovh"],
        )
        self.assertNotIn("SECRET", str(result))
        self.assertTrue(result["warnings"])
        self.assertFalse(any(output["type"] == "url" for output in result["outputs"]))
        self.assertTrue(
            any(
                output.get("group") == "PhoneInfoga · local"
                and output["label"] == "Country"
                for output in result["outputs"]
            )
        )
        self.assertFalse(
            any(output["label"] == "numverify" for output in result["outputs"])
        )

    @unittest.skipUnless(
        shutil.which("phoneinfoga"), "PhoneInfoga binary unavailable locally"
    )
    def test_real_phoneinfoga_binary_on_a_reserved_number_with_external_scanners_disabled(
        self,
    ):
        result = phoneinfoga.run(
            "scan",
            [{"id": "p", "data": {"value": "+12025550123"}}],
            {"disabled_scanners": ["ovh", "numverify", "googlesearch", "googlecse"]},
            {},
        )
        self.assertTrue(
            any(
                output["label"] == "Country" and output["data"]["value"] == "US"
                for output in result["outputs"]
            )
        )

    def test_notes_keep_fixed_data_and_normalize_appearance(self):
        node = {
            "type": "note",
            "data": {"text": "note"},
            "appearance": {"width": 1200, "height": 10, "color": "invalid"},
        }
        server.canonicalize_node(node)
        self.assertEqual(node["data"], {"text": "note"})
        self.assertEqual(
            node["appearance"], {"width": 900, "height": 120, "color": "#ffcc70"}
        )

    def test_holehe_collector_runs_provider_functions_and_retains_provider_errors(self):
        import trio

        source = server.ROOT / "plugins" / "_holehe_runner.py"
        spec = importlib.util.spec_from_file_location("test_holehe_runner", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        async def found(email, client, out):
            out.append(
                {
                    "name": "found",
                    "exists": True,
                    "emailrecovery": "t***@example.invalid",
                }
            )

        async def failed(email, client, out):
            raise RuntimeError("Controlled provider error")

        with (
            patch.object(module, "import_submodules", return_value={}),
            patch.object(module, "get_functions", return_value=[found, failed]),
        ):
            rows = trio.run(
                module.collect,
                {"email": "fixture@example.invalid", "sites": [], "request_timeout": 2},
            )
        self.assertEqual(len(rows), 2)
        self.assertTrue(next(row for row in rows if row["name"] == "found")["exists"])
        self.assertIsNone(
            next(row for row in rows if row["name"] == "failed")["exists"]
        )

    def test_language_setting_and_backend_health_are_actual_api_responses(self):
        server.save_settings({"language": "en"})
        self.assertEqual(server.settings()["language"], "en")
        server.save_settings({"language": "de"})
        self.assertTrue(server.settings()["geocoder_enabled"])
