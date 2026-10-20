"""Error recovery contracts using local fixtures; no upstream research or inference."""

import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from core.build_info import VERSION, user_agent
from core.errors import AppError
from core.http_server import Handler
from core.maps import Maps
from core.plugin_manager import Manager
from core import public_network
from plugins import (
    _profile_extract_runner,
    _research,
    deep_research,
    instagram,
    _consensus,
    _argus_web_runner,
)


class RequestIdentity(unittest.TestCase):
    def test_identity_uses_shipped_version(self):
        expected = (Path(__file__).resolve().parents[1] / "VERSION").read_text().strip()
        self.assertEqual(VERSION, expected)
        self.assertEqual(user_agent("fixture"), f"ARGUS/{expected} (fixture)")

    def test_public_transport_sets_default_and_preserves_case_insensitive_override(
        self,
    ):
        from urllib.parse import urlsplit

        for supplied in ({}, {"user-agent": "Fixture/1"}):
            connection = Mock()
            response = connection.getresponse.return_value
            response.status = 200
            response.isclosed.return_value = True
            response.getheaders.return_value = []
            with (
                self.subTest(supplied=supplied),
                patch.object(
                    public_network,
                    "connect_pinned",
                    return_value=(urlsplit("http://example.invalid"), Mock()),
                ),
                patch.object(
                    public_network.http.client,
                    "HTTPConnection",
                    return_value=connection,
                ),
            ):
                public_network.request("http://example.invalid", headers=supplied)
            agents = [
                v
                for k, v in connection.request.call_args.kwargs["headers"].items()
                if k.lower() == "user-agent"
            ]
            self.assertEqual(
                agents, [supplied.get("user-agent", user_agent("public research"))]
            )

    def test_repository_transport_uses_current_identity(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(b"{}")
        with patch(
            "core.plugin_manager.urllib.request.build_opener", return_value=opener
        ):
            self.assertEqual(
                Manager.fetch("https://api.github.com/repos/example/fixture"), b"{}"
            )
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), user_agent("plugin manager"))

    def test_isolated_profile_extractor_receives_current_identity(self):
        from types import ModuleType

        package = ModuleType("socid_extractor")
        package.extract = Mock(return_value={"fixture": "value"})
        package.mutate_url = Mock(return_value=[])
        main = ModuleType("socid_extractor.main")
        package.main = main
        response = Mock()
        response.read.return_value = b"fixture"
        response.headers.get_content_charset.return_value = "utf-8"
        opener = Mock()
        opener.open.return_value.__enter__ = Mock(return_value=response)
        opener.open.return_value.__exit__ = Mock(return_value=False)
        agent = user_agent("public profile research")
        with (
            patch.dict(
                "sys.modules",
                {"socid_extractor": package, "socid_extractor.main": main},
            ),
            patch.object(
                _profile_extract_runner, "public_url", side_effect=lambda value: value
            ),
            patch.object(
                _profile_extract_runner.urllib.request,
                "build_opener",
                return_value=opener,
            ),
        ):
            result = _profile_extract_runner.extract_one(
                {
                    "url": "https://example.invalid/fixture",
                    "request_timeout": 2,
                    "user_agent": agent,
                }
            )
        self.assertEqual(result, {"fixture": "value"})
        self.assertEqual(opener.open.call_args.args[0].get_header("User-agent"), agent)


class CancellationBoundaries(unittest.TestCase):
    def test_non_cancelled_provider_failure_preserves_next_provider_results(self):
        first = Mock(side_effect=AppError("external_request_failed", 502))
        second = Mock(return_value={"outputs": [], "warnings": []})
        with patch("plugins._search_profiles.plans", return_value=[{}]):
            result = _research.aggregate(
                "username",
                {"first": first, "second": second},
                [{"id": "input", "type": "username", "data": {"value": "fixture"}}],
                {},
                {},
            )
        second.assert_called_once()
        self.assertTrue(result["warnings"])

    def test_discovery_cancellation_never_runs_next_provider(self):
        first = Mock(side_effect=AppError("actor_cancelled", 409))
        second = Mock()
        with patch("plugins._search_profiles.plans", return_value=[{}]):
            with self.assertRaises(AppError) as caught:
                _research.aggregate(
                    "username",
                    {"first": first, "second": second},
                    [{"id": "input", "type": "username", "data": {"value": "fixture"}}],
                    {},
                    {},
                )
        self.assertEqual(caught.exception.code, "actor_cancelled")
        first.assert_called_once()
        second.assert_not_called()

    def test_enrichment_cancellation_is_not_a_partial_provider_result(self):
        collector = deep_research.ProfileEnrichment(
            "lookup",
            [
                {
                    "id": "input",
                    "type": "profile",
                    "data": {
                        "provider": "GitHub",
                        "identifier": "fixture",
                        "url": "https://github.com/fixture",
                    },
                }
            ],
            {
                "source_order": ["argus", "maigret"],
                **{
                    "use_" + name: name in {"argus", "maigret"}
                    for name in deep_research.TOOLS
                },
            },
            {},
        )
        collector.prepare()
        with patch.object(
            collector, "query_source", side_effect=AppError("actor_cancelled", 409)
        ) as query:
            with self.assertRaises(AppError) as caught:
                collector.collect()
        self.assertEqual(caught.exception.code, "actor_cancelled")
        query.assert_called_once()

    def test_instagram_cancellation_and_programming_errors_do_not_load_checkpoint(self):
        for error in (AppError("actor_cancelled", 409), RuntimeError("fixture defect")):
            with (
                self.subTest(error=type(error).__name__),
                tempfile.TemporaryDirectory() as directory,
            ):

                def worker(command, timeout, payload, **kwargs):
                    Path(payload["checkpoint"]).write_text(
                        json.dumps({"outputs": [], "warnings": []})
                    )
                    raise error

                with (
                    patch.object(instagram, "bounded_run", side_effect=worker),
                    self.assertRaises(type(error)),
                ):
                    instagram.collect(
                        {"username": "", "user_id": ""},
                        dict(instagram.DEFAULTS),
                        {"credential_dir": Path(directory) / "sessions"},
                    )


class RecoveryBoundaries(unittest.TestCase):
    def test_expected_instagram_process_failure_retains_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:

            def worker(command, timeout, payload, **kwargs):
                Path(payload["checkpoint"]).write_text(
                    json.dumps(
                        {
                            "outputs": [
                                {"type": "value", "data": {"value": "fixture"}}
                            ],
                            "warnings": [],
                        }
                    )
                )
                raise ValueError("expected subprocess failure")

            with patch.object(instagram, "bounded_run", side_effect=worker):
                result = instagram.collect(
                    {"username": "", "user_id": ""},
                    dict(instagram.DEFAULTS),
                    {"credential_dir": Path(directory) / "sessions"},
                )
        self.assertEqual(result["outputs"][0]["data"]["value"], "fixture")
        self.assertTrue(result["warnings"])

    def test_consensus_recovers_expected_process_failure_but_not_programming_error(
        self,
    ):
        for error in (
            ValueError("expected process error"),
            RuntimeError("fixture defect"),
        ):

            def worker(command, timeout, payload):
                Path(payload["checkpoint"]).write_text("")
                raise error

            with (
                self.subTest(error=type(error).__name__),
                patch.object(_consensus, "bounded_run", side_effect=worker),
            ):
                inputs = [
                    {"id": "input", "type": "username", "data": {"value": "fixture"}}
                ]
                if isinstance(error, RuntimeError):
                    with self.assertRaises(RuntimeError):
                        _consensus.run("username", inputs, {}, {})
                else:
                    self.assertTrue(
                        _consensus.run("username", inputs, {}, {})["warnings"]
                    )

    def test_programming_error_does_not_trigger_browser_retry(self):
        with (
            patch.object(
                _argus_web_runner, "public_url", side_effect=lambda value: value
            ),
            patch.object(
                _argus_web_runner,
                "get_page",
                side_effect=RuntimeError("fixture defect"),
            ),
            patch.object(_argus_web_runner, "browser_page") as browser,
            self.assertRaises(RuntimeError),
        ):
            _argus_web_runner.collect(
                {"url": "https://example.invalid/fixture", "request_timeout": 2}
            )
        browser.assert_not_called()

    def test_controller_tick_failure_is_visible_without_secret_values(self):
        from core.vpn_gateway import tick_once

        controller = Mock(state="connected")
        controller.tick.side_effect = RuntimeError("secret fixture value")
        with self.assertLogs("argus.vpn", level="ERROR") as captured:
            tick_once(controller)
        self.assertEqual(controller.state, "unhealthy")
        self.assertIn("vpn_controller_tick_failed", "".join(captured.output))
        self.assertIn("RuntimeError", "".join(captured.output))
        self.assertNotIn("secret fixture value", "".join(captured.output))

    def test_google_failure_falls_back_with_secret_free_diagnostic_but_bug_propagates(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            maps = Maps(directory)
            with (
                patch("core.maps.Path.exists", return_value=True),
                patch(
                    "core.isolation.invoke", side_effect=OSError("secret fixture value")
                ),
                patch.object(maps, "tile", return_value=b"fixture"),
                self.assertLogs("argus.maps", level="WARNING") as captured,
            ):
                html = maps.preview("53.5", "10", "", provider="google")
            self.assertIn(b"OpenStreetMap", html)
            self.assertIn("OSError", "".join(captured.output))
            self.assertNotIn("secret fixture value", "".join(captured.output))
            with (
                patch("core.maps.Path.exists", return_value=True),
                patch(
                    "core.isolation.invoke", side_effect=RuntimeError("fixture defect")
                ),
                self.assertRaises(RuntimeError),
            ):
                maps.preview("53.6", "10", "", provider="google")

    def test_map_endpoint_does_not_hide_unexpected_errors_in_success_html(self):
        handler = Handler.__new__(Handler)
        handler.path = "/api/map-preview?lat=53.5&lon=10"
        maps = Mock()
        handler.server = SimpleNamespace(
            app=SimpleNamespace(MAPS=maps, settings=lambda: {"language": "en"})
        )
        handler.send = Mock()
        maps.preview.side_effect = AppError("location_required", 422)
        handler.get_map("/api/map-preview")
        maps.unavailable.assert_called_once_with("en")
        maps.unavailable.reset_mock()
        maps.preview.side_effect = RuntimeError("fixture defect")
        with self.assertRaises(RuntimeError):
            handler.get_map("/api/map-preview")
        maps.unavailable.assert_not_called()

    def test_repository_bad_manifest_is_reported_but_programming_error_propagates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manager = Manager(root / "state.sqlite3", root, {})
            with manager.connect() as connection:
                connection.execute(
                    "INSERT INTO community_repos VALUES (?,?,?,NULL)",
                    ("fixture", "https://github.com/example/fixture", '{"plugins":[]}'),
                )
            for manifest in ([], {"schema_version": 1, "plugins": ["bad"]}):
                with patch.object(
                    manager,
                    "fetch",
                    side_effect=[
                        b'{"default_branch":"main"}',
                        json.dumps({"sha": "a" * 40}).encode(),
                        json.dumps(manifest).encode(),
                    ],
                ):
                    self.assertTrue(manager.refresh_repo("fixture")["error"])
            with (
                patch.object(
                    manager, "fetch", side_effect=RuntimeError("fixture defect")
                ),
                self.assertRaises(RuntimeError),
            ):
                manager.refresh_repo("fixture")
