"""Optional dedicated Linux network gateway. Its firewall covers the shared namespace."""

import configparser
import ipaddress
import json
import logging
import os
from pathlib import Path
import shlex
import socket
import socketserver
import struct
import subprocess
import threading
import time
from core.secrets import SecretStore

INTERFACE = "argusvpn"
HEALTH_URL = "https://www.cloudflare.com/cdn-cgi/trace"


def command(arguments, **kwargs):
    return subprocess.run(
        arguments,
        check=True,
        timeout=kwargs.pop("timeout", 10),
        capture_output=True,
        **kwargs,
    )


def endpoint(host, port, protocol):
    try:
        address = ipaddress.IPv4Address(host)
    except ValueError:
        if (
            not host
            or len(host) > 253
            or any(
                character
                not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"
                for character in host
            )
        ):
            raise ValueError("Invalid VPN endpoint") from None
        result = command(["getent", "ahostsv4", host], timeout=3).stdout.decode()
        address = ipaddress.IPv4Address(result.split()[0])
    port = int(port)
    if not 1 <= port <= 65535 or protocol not in ("tcp", "udp"):
        raise ValueError("Invalid VPN transport")
    return str(address), port, protocol


def prepare(profile):
    """Only standalone full-tunnel client profiles; no hooks, plugins or external files."""
    data = profile["config"]
    if profile["type"] == "wireguard":
        parser = configparser.ConfigParser(interpolation=None, strict=True)
        parser.optionxform = str
        parser.read_string(data)
        if set(parser.sections()) != {"Interface", "Peer"} or parser.defaults():
            raise ValueError("WireGuard requires one Interface and one Peer")
        allowed = {
            "Interface": {"privatekey", "address", "dns", "mtu", "listenport"},
            "Peer": {
                "publickey",
                "presharedkey",
                "allowedips",
                "endpoint",
                "persistentkeepalive",
            },
        }
        canonical = {
            key.lower(): key
            for key in (
                "PrivateKey",
                "Address",
                "DNS",
                "MTU",
                "ListenPort",
                "PublicKey",
                "PresharedKey",
                "AllowedIPs",
                "Endpoint",
                "PersistentKeepalive",
            )
        }
        for section in parser.sections():
            original = dict(parser[section])
            parser[section].clear()
            for key, value in original.items():
                parser[section][canonical.get(key.lower(), key)] = value
            if {key.lower() for key in parser[section]} - allowed[section]:
                raise ValueError("WireGuard hooks and custom routing are not supported")
        if "0.0.0.0/0" not in [
            item.strip() for item in parser["Peer"].get("AllowedIPs", "").split(",")
        ]:
            raise ValueError("WireGuard AllowedIPs must include 0.0.0.0/0")
        host, port = parser["Peer"]["Endpoint"].rsplit(":", 1)
        remote = endpoint(host, port, "udp")
        parser["Peer"]["Endpoint"] = remote[0] + ":" + str(remote[1])
        parser["Interface"].pop(
            "DNS", None
        )  # DNS is supplied through the tunnel by the Compose stack.
        import io

        parser["Interface"]["FwMark"] = "51820"
        output = io.StringIO()
        parser.write(output)
        return {**profile, "compiled": output.getvalue(), "endpoint": remote}
    allowed = {
        "client",
        "tls-client",
        "nobind",
        "persist-key",
        "persist-tun",
        "remote-cert-tls",
        "verify-x509-name",
        "cipher",
        "data-ciphers",
        "data-ciphers-fallback",
        "auth",
        "auth-nocache",
        "auth-user-pass",
        "remote",
        "proto",
        "dev",
        "dev-type",
        "resolv-retry",
        "connect-retry",
        "connect-retry-max",
        "connect-timeout",
        "verb",
        "mute",
        "key-direction",
        "tls-version-min",
        "tls-cipher",
        "tls-ciphersuites",
        "tun-mtu",
        "mssfix",
        "sndbuf",
        "rcvbuf",
        "reneg-sec",
        "explicit-exit-notify",
        "keepalive",
        "ping",
        "ping-restart",
        "redirect-gateway",
        "remote-random",
        "allow-compression",
        "compress",
        "comp-lzo",
        "setenv",
        "pull",
        "route-delay",
        "float",
        "auth-retry",
    }
    lines, block, remotes, protocol = [], None, [], "udp"
    for line in data.splitlines():
        stripped = line.strip()
        if block:
            lines.append(line)
            if stripped == "</" + block + ">":
                block = None
            continue
        if stripped.startswith("<"):
            block = stripped[1:-1]
            if block not in {
                "ca",
                "cert",
                "key",
                "tls-auth",
                "tls-crypt",
                "tls-crypt-v2",
            }:
                raise ValueError("Unsupported OpenVPN inline block")
            lines.append(line)
            continue
        if not stripped or stripped.startswith(("#", ";")):
            continue
        words = shlex.split(stripped, comments=True)
        if not words:
            continue
        option = words[0].removeprefix("--")
        if option not in allowed:
            raise ValueError("Unsupported OpenVPN option: " + option)
        if option == "proto":
            protocol = (
                "tcp"
                if words[1] in ("tcp", "tcp-client", "tcp4", "tcp4-client")
                else "udp" if words[1] in ("udp", "udp4") else ""
            )
            continue
        if option == "remote":
            remotes.append(words[1:])
            continue
        if option in {
            "dev",
            "dev-type",
            "auth-user-pass",
            "redirect-gateway",
            "verb",
            "mute",
            "resolv-retry",
            "auth-retry",
            "connect-retry-max",
            "connect-timeout",
        }:
            continue
        if option == "setenv" and (
            len(words) != 3 or words[1] not in {"CLIENT_CERT", "opt"}
        ):
            raise ValueError("Unsupported OpenVPN environment directive")
        lines.append(line)
    if (
        block
        or len(remotes) != 1
        or len(remotes[0]) > 3
        or "<ca>" not in data
        or not protocol
    ):
        raise ValueError(
            "OpenVPN requires an inline CA and exactly one IPv4-capable remote"
        )
    remote = remotes[0]
    transport = (
        ("tcp" if remote[2].startswith("tcp") else "udp")
        if len(remote) == 3
        else protocol
    )
    target = endpoint(remote[0], remote[1] if len(remote) > 1 else 1194, transport)
    lines += [
        "remote " + target[0] + " " + str(target[1]),
        "proto " + ("tcp-client" if target[2] == "tcp" else "udp"),
    ]
    if profile.get("username") or profile.get("password"):
        if not profile.get("username") or not profile.get("password"):
            raise ValueError("OpenVPN requires both username and password")
        lines.append("auth-user-pass /run/argus-vpn-private/auth.txt")
    return {**profile, "compiled": "\n".join(lines) + "\n", "endpoint": target}


def firewall_rules(profiles, enabled, ipv6=False):
    lines = ["*filter", ":ARGUS_VPN - [0:0]", "-F ARGUS_VPN"]
    if enabled:
        if not ipv6:
            lines.append("-A ARGUS_VPN -d 127.0.0.11/32 -j REJECT")
        lines += [
            "-A ARGUS_VPN -o lo -j ACCEPT",
            "-A ARGUS_VPN -o " + INTERFACE + " -j ACCEPT",
            "-A ARGUS_VPN -p tcp --sport 8080 -m conntrack --ctstate ESTABLISHED -j ACCEPT",
        ]
        if not ipv6:
            for address, port, protocol, kind in sorted(
                {(*p["endpoint"], p["type"]) for p in profiles}
            ):
                transport = "-m mark --mark " + (
                    "51820" if kind == "wireguard" else "51821"
                )
                lines.append(
                    f"-A ARGUS_VPN -d {address}/32 -p {protocol} --dport {port} {transport} -j ACCEPT"
                )
        lines.append("-A ARGUS_VPN -j REJECT")
    else:
        lines.append("-A ARGUS_VPN -j RETURN")
    return "\n".join(lines + ["COMMIT", ""])


class Network:
    def __init__(self):
        self.process, self.kind = None, None
        self.directory = Path("/run/argus-vpn-private")
        self.directory.mkdir(mode=0o700, exist_ok=True)
        self.original_dns = Path("/etc/resolv.conf").read_text()
        self.route = json.loads(
            command(["ip", "-j", "-4", "route", "show", "default"]).stdout
        )[0]

    def firewall(self, profiles, enabled):
        for family in ("iptables", "ip6tables"):
            command(
                [family + "-restore", "--noflush"],
                input=firewall_rules(profiles, enabled, family == "ip6tables").encode(),
            )
            exists = subprocess.run(
                [family, "-C", "OUTPUT", "-j", "ARGUS_VPN"],
                capture_output=True,
                timeout=5,
            )
            if exists.returncode:
                command([family, "-I", "OUTPUT", "1", "-j", "ARGUS_VPN"])
        # Public DNS resolves through the tunnel. Docker's embedded resolver is
        # intentionally blocked, since it can forward DNS outside this namespace.
        Path("/etc/resolv.conf").write_text(
            "nameserver 1.1.1.1\nnameserver 9.9.9.9\noptions timeout:2 attempts:2\n"
            if enabled
            else self.original_dns
        )

    def stop(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            self.process = None
        if self.kind == "wireguard":
            subprocess.run(
                ["wg-quick", "down", str(self.directory / (INTERFACE + ".conf"))],
                capture_output=True,
                timeout=10,
            )
        subprocess.run(
            ["ip", "link", "delete", INTERFACE], capture_output=True, timeout=5
        )
        self.kind = None

    def connect(self, profile):
        self.stop()
        address = profile["endpoint"][0]
        route = ["ip", "-4", "route", "replace", address + "/32"]
        if self.route.get("gateway"):
            route += ["via", self.route["gateway"]]
        command(route + ["dev", self.route["dev"]])
        path = self.directory / (INTERFACE + ".conf")
        path.write_text(profile["compiled"])
        path.chmod(0o600)
        self.kind = profile["type"]
        if self.kind == "wireguard":
            command(["wg-quick", "up", str(path)], timeout=15)
        else:
            credentials = self.directory / "auth.txt"
            credentials.write_text(
                profile.get("username", "") + "\n" + profile.get("password", "") + "\n"
            )
            credentials.chmod(0o600)
            self.process = subprocess.Popen(
                [
                    "openvpn",
                    "--config",
                    str(path),
                    "--dev",
                    INTERFACE,
                    "--dev-type",
                    "tun",
                    "--script-security",
                    "0",
                    "--mark",
                    "51821",
                    "--remote-cert-tls",
                    "server",
                    "--redirect-gateway",
                    "def1",
                    "--connect-timeout",
                    "10",
                    "--connect-retry-max",
                    "1",
                    "--auth-nocache",
                    "--verb",
                    "0",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if self.healthy():
                return
            if self.process and self.process.poll() is not None:
                break
            time.sleep(1)
        raise RuntimeError("VPN health check failed")

    def healthy(self):
        try:
            command(
                [
                    "curl",
                    "--interface",
                    INTERFACE,
                    "--connect-timeout",
                    "3",
                    "--max-time",
                    "6",
                    "--fail",
                    "--silent",
                    "--output",
                    "/dev/null",
                    HEALTH_URL,
                ],
                timeout=7,
            )
            return True
        except (subprocess.SubprocessError, OSError):
            return False


class Controller:
    def __init__(self, directory, network):
        self.directory, self.network = Path(directory), network
        self.directory.mkdir(mode=0o700, exist_ok=True)
        self.secrets = SecretStore(self.directory)
        self.file = self.directory / "settings.sealed"
        self.lock = threading.RLock()
        self.settings = (
            json.loads(self.secrets.decrypt_text(self.file.read_text()))
            if self.file.exists()
            else {
                "enabled": False,
                "profiles": [],
                "rotation_enabled": False,
                "rotation_mode": "interval",
                "interval_seconds": 900,
            }
        )
        self.active, self.busy, self.pending, self.stopped = (
            None,
            False,
            self.settings["enabled"],
            False,
        )
        self.switching = False
        self.state, self.next_rotation, self.last_health, self.retry = (
            "connecting" if self.pending else "disabled",
            0,
            0,
            0,
        )
        # Persisted enabled state closes egress before the app container starts.
        self.network.firewall(self.settings["profiles"], self.settings["enabled"])

    def status(self):
        return {
            "namespace": os.stat("/proc/self/ns/net").st_ino,
            "state": self.state,
            "connected": self.state == "connected",
            "active": self.active,
            "enabled": self.settings["enabled"],
        }

    def request(self, request):
        action = request.get("action")
        with self.lock:
            if action == "configure":
                if self.busy or self.switching:
                    raise ValueError(
                        "Wait for the running tool or VPN change before changing VPN settings"
                    )
                settings = request["settings"]
                if (
                    type(settings.get("enabled")) is not bool
                    or type(settings.get("rotation_enabled")) is not bool
                    or settings.get("rotation_mode") not in ("interval", "actor")
                    or type(settings.get("interval_seconds")) is not int
                    or not 60 <= settings["interval_seconds"] <= 86400
                    or not isinstance(settings.get("profiles"), list)
                    or len(settings["profiles"]) > 32
                ):
                    raise ValueError("Invalid VPN settings")
                cached = {p["id"]: p for p in self.settings["profiles"]}
                profiles = []
                for profile in settings["profiles"]:
                    old = cached.get(profile["id"], {})
                    same = all(
                        profile.get(key) == old.get(key)
                        for key in ("id", "type", "config", "username", "password")
                    )
                    if same and old.get("compiled"):
                        profiles.append({**old, "name": profile["name"]})
                    elif settings["enabled"]:
                        profiles.append(prepare(profile))
                    else:
                        profiles.append(profile)
                if settings["enabled"] and not profiles:
                    raise ValueError("No VPN profiles")
                active_id = self.active and self.active["id"]
                previous = cached.get(active_id, {})
                current = next((p for p in profiles if p["id"] == active_id), {})
                reconnect = settings["enabled"] != self.settings["enabled"] or (
                    settings["enabled"]
                    and (
                        not self.active
                        or any(
                            current.get(key) != previous.get(key)
                            for key in (
                                "compiled",
                                "username",
                                "password",
                                "type",
                                "endpoint",
                            )
                        )
                    )
                )
                self.network.firewall(profiles, settings["enabled"])
                self.settings = {**settings, "profiles": profiles}
                temporary = self.file.with_suffix(".tmp")
                temporary.write_text(
                    self.secrets.encrypt_text(json.dumps(self.settings))
                )
                temporary.chmod(0o600)
                temporary.replace(self.file)
                self.next_rotation = time.monotonic() + settings["interval_seconds"]
                if reconnect:
                    self.pending = True
                    self.state = "connecting" if settings["enabled"] else "disabling"
            elif action == "acquire":
                acquired = (
                    self.state == "connected"
                    and not self.pending
                    and not self.busy
                    and not self.switching
                )
                if acquired:
                    self.busy = True
                return {**self.status(), "acquired": acquired}
            elif action == "release":
                self.busy = False
                if (
                    request.get("rotate", True)
                    and self.settings["rotation_enabled"]
                    and self.settings["rotation_mode"] == "actor"
                ):
                    self.pending = True
                    self.state = "connecting"
            elif action == "rotate":
                self.pending = True
                if not self.busy:
                    self.state = "connecting"
            elif action != "status":
                raise ValueError("Unknown VPN action")
            return self.status()

    def tick(self):
        with self.lock:
            if self.busy or self.switching:
                return
            enabled = self.settings["enabled"]
            due = (
                enabled
                and self.settings["rotation_enabled"]
                and self.settings["rotation_mode"] == "interval"
                and time.monotonic() >= self.next_rotation
            )
            check = False
            if (
                not self.pending
                and not due
                and not (
                    enabled
                    and self.state == "unhealthy"
                    and time.monotonic() >= self.retry
                )
            ):
                check = (
                    enabled
                    and self.state == "connected"
                    and time.monotonic() - self.last_health >= 15
                )
                if not check:
                    return
            self.switching = True
            profiles = list(self.settings["profiles"])
            interval = self.settings["interval_seconds"]
            previous = next(
                (
                    i
                    for i, p in enumerate(profiles)
                    if self.active and p["id"] == self.active["id"]
                ),
                -1,
            )
        try:
            if check and self.network.healthy():
                with self.lock:
                    self.last_health = time.monotonic()
                return
            with self.lock:
                self.state = "connecting" if enabled else "disabling"
                self.pending = False
                self.active = None
            if not enabled:
                self.network.stop()
                with self.lock:
                    self.state = "disabled"
                return
            for index in range(len(profiles)):
                profile = profiles[(previous + 1 + index) % len(profiles)]
                try:
                    self.network.connect(profile)
                except (subprocess.SubprocessError, OSError, RuntimeError):
                    continue
                with self.lock:
                    self.active = {key: profile[key] for key in ("id", "name", "type")}
                    self.state = "connected"
                    self.last_health = time.monotonic()
                    self.next_rotation = self.last_health + interval
                return
            self.network.stop()
            with self.lock:
                self.state = "unhealthy"
                self.retry = time.monotonic() + 30
        finally:
            with self.lock:
                self.switching = False


def tick_once(controller):
    """Keep the controller loop alive with an observable, secret-free failure."""
    try:
        controller.tick()
    except Exception as error:
        controller.state = "unhealthy"
        logging.getLogger("argus.vpn").error(
            json.dumps(
                {
                    "event": "vpn_controller_tick_failed",
                    "error_type": type(error).__name__,
                }
            )
        )


def main():
    controller = Controller(os.environ.get("ARGUS_VPN_STATE", "/vpn-state"), Network())

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.connection.settimeout(120)
            credentials = self.connection.getsockopt(
                socket.SOL_SOCKET, socket.SO_PEERCRED, 12
            )
            if struct.unpack("3i", credentials)[1] not in (0, 10001):
                return
            try:
                payload = self.rfile.readline(5 * 1024 * 1024)
                if not payload.endswith(b"\n"):
                    raise ValueError("VPN request too large")
                result = controller.request(json.loads(payload))
            except Exception as error:
                result = {
                    "namespace": os.stat("/proc/self/ns/net").st_ino,
                    "error": (
                        str(error)
                        if isinstance(error, ValueError)
                        else "VPN configuration failed"
                    ),
                }
            self.wfile.write((json.dumps(result) + "\n").encode())

    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    socket_path = Path("/run/argus-vpn/control.sock")
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    socket_path.unlink(missing_ok=True)
    server = Server(str(socket_path), Handler)
    os.chown(socket_path, 0, 10001)
    socket_path.chmod(0o660)

    def worker():
        while True:
            tick_once(controller)
            time.sleep(1)

    threading.Thread(target=worker, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
