"""Gateway state and firewall tests use fake transports; no VPN is connected."""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from core.database import connect
from core.errors import AppError
from core.secrets import SecretStore
from core.vpn import VPN
from core.vpn_gateway import Controller, prepare, firewall_rules

WIREGUARD = "[Interface]\nPrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n[Peer]\nPublicKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 203.0.113.10:51820\n"


def profile(ident="fixture"):
    return {
        "id": ident,
        "name": ident,
        "type": "wireguard",
        "config": WIREGUARD,
        "username": "",
        "password": "",
    }


class Profiles(unittest.TestCase):

    def test_standalone_profiles_and_hook_rejection(self):
        compiled = prepare(profile())
        self.assertIn("PrivateKey", compiled["compiled"])
        self.assertNotIn("DNS =", compiled["compiled"])
        self.assertEqual(compiled["endpoint"], ("203.0.113.10", 51820, "udp"))
        with self.assertRaises(ValueError):
            prepare(
                {
                    **profile(),
                    "config": WIREGUARD.replace(
                        "Address =", "PostUp = echo unsafe\nAddress ="
                    ),
                }
            )
        with self.assertRaises(ValueError):
            prepare(
                {**profile(), "config": WIREGUARD.replace("0.0.0.0/0", "10.0.0.0/8")}
            )
        openvpn = {
            "id": "ovpn",
            "name": "ovpn",
            "type": "openvpn",
            "config": "client\ndev tun\nremote 203.0.113.20 1194 udp\n<ca>\nTEST CERTIFICATE\n</ca>\n",
            "username": "",
            "password": "",
        }
        self.assertEqual(prepare(openvpn)["endpoint"], ("203.0.113.20", 1194, "udp"))
        with self.assertRaises(ValueError):
            prepare({**openvpn, "config": openvpn["config"] + "up /tmp/unsafe\n"})

    def test_firewall_blocks_non_tunnel_traffic_in_both_families(self):
        compiled = prepare(profile())
        rules = firewall_rules([compiled], True)
        self.assertIn("-o argusvpn -j ACCEPT", rules)
        self.assertIn("--mark 51820", rules)
        self.assertLess(
            rules.index("127.0.0.11/32 -j REJECT"), rules.index("-o lo -j ACCEPT")
        )
        self.assertIn("--sport 8080 -m conntrack --ctstate ESTABLISHED", rules)
        self.assertIn("-A ARGUS_VPN -j REJECT\nCOMMIT", rules)
        self.assertNotIn("203.0.113.10", firewall_rules([compiled], True, ipv6=True))
        self.assertIn("-j REJECT", firewall_rules([compiled], True, ipv6=True))


class GatewayState(unittest.TestCase):

    def test_failed_profiles_are_skipped_and_active_lease_defers_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            network = Mock()
            network.healthy.return_value = True
            network.connect.side_effect = lambda p: (
                (_ for _ in ()).throw(RuntimeError("offline"))
                if p["id"] == "bad"
                else None
            )
            controller = Controller(directory, network)
            controller.status = lambda: {
                "state": controller.state,
                "connected": controller.state == "connected",
            }
            settings = {
                "enabled": True,
                "rotation_enabled": True,
                "rotation_mode": "actor",
                "interval_seconds": 60,
                "profiles": [profile("bad"), profile("good"), profile("next")],
            }
            controller.request({"action": "configure", "settings": settings})
            controller.tick()
            self.assertEqual(controller.active["id"], "good")
            self.assertEqual(controller.state, "connected")
            self.assertTrue(controller.request({"action": "acquire"})["acquired"])
            count = network.connect.call_count
            controller.request({"action": "rotate"})
            controller.tick()
            self.assertEqual(network.connect.call_count, count)
            controller.request({"action": "release"})
            controller.tick()
            self.assertEqual(controller.active["id"], "next")
            self.assertTrue(Path(directory, "settings.sealed").exists())
            self.assertNotIn(
                "PrivateKey", Path(directory, "settings.sealed").read_text()
            )

    def test_total_failure_keeps_enabled_firewall_and_queue_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            network = Mock()
            network.connect.side_effect = RuntimeError("offline")
            controller = Controller(directory, network)
            controller.status = lambda: {"connected": controller.state == "connected"}
            controller.request(
                {
                    "action": "configure",
                    "settings": {
                        "enabled": True,
                        "rotation_enabled": False,
                        "rotation_mode": "interval",
                        "interval_seconds": 60,
                        "profiles": [profile()],
                    },
                }
            )
            controller.tick()
            self.assertEqual(controller.state, "unhealthy")
            self.assertFalse(controller.request({"action": "acquire"})["acquired"])
            self.assertTrue(network.firewall.call_args.args[1])


class ApplicationVPN(unittest.TestCase):

    def test_saved_vpn_setting_blocks_startup_without_enabled_gateway(self):
        with tempfile.TemporaryDirectory() as directory:
            gateway = Mock()
            gateway.call.return_value = {"enabled": True}
            service = VPN(
                lambda: connect(Path(directory) / "db.sqlite"),
                SecretStore(directory),
                gateway,
            )
            service.save({"profiles": [profile()], "enabled": True})
            service.require_gateway()
            gateway.call.return_value = {"enabled": False}
            with self.assertRaises(AppError):
                service.require_gateway()
            gateway.call.side_effect = AppError("vpn_unavailable", 409)
            with self.assertRaises(AppError):
                service.require_gateway()

    def test_disable_preference_is_saved_before_gateway_can_open_egress(self):
        with tempfile.TemporaryDirectory() as directory:
            gateway = Mock()
            gateway.call.return_value = {"enabled": True}
            service = VPN(
                lambda: connect(Path(directory) / "db.sqlite"),
                SecretStore(directory),
                gateway,
            )
            service.save({"profiles": [profile()], "enabled": True})

            def call(action, **payload):
                if action == "configure":
                    self.assertFalse(service.configuration()["enabled"])
                return {"enabled": False}

            gateway.call.side_effect = call
            service.save({"enabled": False})
            gateway.call.side_effect = AppError("vpn_unavailable", 409)
            service.require_gateway()

    def test_offline_profiles_are_encrypted_but_cannot_enable_vpn(self):
        with tempfile.TemporaryDirectory() as directory:
            gateway = Mock()
            gateway.call.side_effect = AppError("vpn_unavailable", 409)
            service = VPN(
                lambda: connect(Path(directory) / "db.sqlite"),
                SecretStore(directory),
                gateway,
            )
            public = service.save({"profiles": [profile()]})
            self.assertNotIn("config", public["settings"]["profiles"][0])
            with service.connect() as connection:
                value = connection.execute("SELECT value FROM vpn_settings").fetchone()[
                    0
                ]
            self.assertNotIn("PrivateKey", value)
            with self.assertRaises(AppError):
                service.save({"enabled": True})
            self.assertFalse(service.configuration()["enabled"])

    def test_queue_wait_and_release(self):
        with tempfile.TemporaryDirectory() as directory:
            gateway = Mock()
            gateway.call.return_value = {}
            service = VPN(
                lambda: connect(Path(directory) / "db.sqlite"),
                SecretStore(directory),
                gateway,
            )
            service.save({"profiles": [profile()], "enabled": True})
            acquired = iter([False, False, True])
            gateway.call.side_effect = lambda action, **kw: (
                {"acquired": next(acquired)} if action == "acquire" else {}
            )
            cancellation = Mock()
            cancellation.wait.return_value = False
            self.assertTrue(service.before_actor(cancellation))
            self.assertEqual(cancellation.wait.call_count, 3)
            service.after_actor(True, rotate=False)
            gateway.call.assert_called_with("release", rotate=False)


if __name__ == "__main__":
    unittest.main()
