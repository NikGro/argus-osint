"""Synthetic contracts only: no VPN connection or face inference."""

import json
from pathlib import Path
import unittest
from core.graph import GraphSchema, NODE_DEFAULTS
from core.geometry import node_bounds
from core.node_metadata import badge_height

ROOT = Path(__file__).resolve().parents[1]


class GraphPortContracts(unittest.TestCase):

    def test_marker_is_persistent_resizable_background_type(self):
        schema = GraphSchema(
            lambda: NODE_DEFAULTS, lambda node: None, lambda node: None
        )
        node = {
            "id": "marker",
            "type": "marker",
            "label": "Section",
            "data": {},
            "x": 0,
            "y": 0,
            "appearance": {"width": 500, "height": 300, "color": "#aabbcc"},
        }
        schema.canonicalize_node(node)
        self.assertEqual(node_bounds(node)[2:], (500, 300))
        self.assertEqual(badge_height(node, 500), 0)

    def test_non_factual_nodes_have_no_verification_badge(self):
        for kind in ("error", "note"):
            self.assertEqual(badge_height({"type": kind}, 320), 0)

    def test_integrated_runtime_starts_vpn_before_application(self):
        text = (ROOT / "scripts/container_entry.py").read_text()
        self.assertLess(
            text.index('"core.vpn_gateway"'), text.index("child = subprocess.Popen")
        )
        docker = (ROOT / "Dockerfile").read_text()
        for package in ("openvpn", "wireguard-tools", "chromium", "iptables"):
            self.assertIn(package, docker)
        self.assertNotIn("service:vpn", (ROOT / "compose.standalone.yaml").read_text())

    def test_mobile_and_log_controls_have_english_translations(self):
        en = json.loads((ROOT / "static/locales/en.json").read_text(encoding="utf-8"))[
            "messages"
        ]
        for text in (
            "Automatisch aktualisieren",
            "Automatisch nach unten scrollen",
            "ARGUS ist für den Desktop gemacht",
        ):
            self.assertIn(text, en)
            self.assertNotEqual(text, en[text])
