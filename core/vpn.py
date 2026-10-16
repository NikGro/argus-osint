"""Encrypted VPN preferences and control of a gateway in the same network namespace."""

import json
import logging
import os
import re
import socket
import threading
from uuid import uuid4
from core.errors import AppError


class Gateway:
    def __init__(self, path="/run/argus-vpn/control.sock"):
        self.path = path

    def call(self, action, **payload):
        try:
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(120 if action == "configure" else 4)
                connection.connect(self.path)
                connection.sendall(
                    (json.dumps({"action": action, **payload}) + "\n").encode()
                )
                stream = connection.makefile("rb")
                response = json.loads(stream.readline(1024 * 1024))
            if response.get("namespace") != os.stat("/proc/self/ns/net").st_ino:
                raise AppError("vpn_namespace_mismatch", 409)
            if response.get("error"):
                raise AppError("vpn_configuration_failed", 422, response["error"])
            return response
        except AppError:
            raise
        except (OSError, ValueError):
            raise AppError("vpn_unavailable", 409) from None


class VPN:
    def __init__(self, connect, secrets, gateway=None):
        self.connect, self.secrets = connect, secrets
        self.gateway = gateway or Gateway(
            os.environ.get("ARGUS_VPN_SOCKET", "/run/argus-vpn/control.sock")
        )
        self.lock = threading.RLock()
        self.last_status = None
        with connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS vpn_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)"
            )

    def configuration(self):
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM vpn_settings WHERE id=1").fetchone()
        return (
            json.loads(self.secrets.decrypt_text(row[0]))
            if row
            else {
                "enabled": False,
                "rotation_enabled": False,
                "rotation_mode": "interval",
                "interval_seconds": 900,
                "profiles": [],
            }
        )

    def status(self):
        try:
            status = {"available": True, **self.gateway.call("status")}
        except AppError as error:
            status = {
                "available": False,
                "connected": False,
                "state": error.code,
                "active": None,
            }
        signature = (status.get("state"), (status.get("active") or {}).get("id"))
        if signature != self.last_status:
            logging.getLogger("argus.vpn").info(
                json.dumps(
                    {
                        "event": "vpn_state",
                        "state": signature[0],
                        "profile_id": signature[1],
                    }
                )
            )
            self.last_status = signature
        return status

    def public(self):
        config = self.configuration()
        config["profiles"] = [
            {key: p[key] for key in ("id", "name", "type")} for p in config["profiles"]
        ]
        return {"settings": config, "status": self.status()}

    def require_gateway(self):
        if self.configuration()["enabled"]:
            status = self.status()
            if not status.get("available") or status.get("enabled") is not True:
                raise AppError("vpn_unavailable", 503)

    def save(self, body):
        with self.lock:
            previous = self.configuration()
            config = {
                **previous,
                **{
                    key: body[key]
                    for key in (
                        "enabled",
                        "rotation_enabled",
                        "rotation_mode",
                        "interval_seconds",
                    )
                    if key in body
                },
            }
            if (
                any(
                    type(config[key]) is not bool
                    for key in ("enabled", "rotation_enabled")
                )
                or config["rotation_mode"] not in ("interval", "actor")
                or type(config["interval_seconds"]) is not int
                or not 60 <= config["interval_seconds"] <= 86400
            ):
                raise AppError("vpn_configuration_failed", 422)
            profiles = body.get("profiles", previous["profiles"])
            if not isinstance(profiles, list) or len(profiles) > 32:
                raise AppError("vpn_configuration_failed", 422)
            old = {p["id"]: p for p in previous["profiles"]}
            clean = []
            for profile in profiles:
                if not isinstance(profile, dict):
                    raise AppError("vpn_configuration_failed", 422)
                ident = profile.get("id") or uuid4().hex
                name, kind = str(profile.get("name", "")).strip(), profile.get("type")
                data = profile.get("config", old.get(ident, {}).get("config", ""))
                username = profile.get(
                    "username", old.get(ident, {}).get("username", "")
                )
                password = profile.get(
                    "password", old.get(ident, {}).get("password", "")
                )
                if (
                    not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", ident)
                    or not name
                    or len(name) > 80
                    or kind not in ("openvpn", "wireguard")
                    or not isinstance(data, str)
                    or not 1 <= len(data) <= 131072
                    or not all(
                        isinstance(v, str) and len(v) <= 1000 and "\n" not in v
                        for v in (username, password)
                    )
                    or any(p["id"] == ident for p in clean)
                ):
                    raise AppError("vpn_configuration_failed", 422)
                clean.append(
                    {
                        "id": ident,
                        "name": name,
                        "type": kind,
                        "config": data,
                        "username": username,
                        "password": password,
                    }
                )
            config["profiles"] = clean
            if config["enabled"] and not clean:
                raise AppError("vpn_no_profiles", 422)

            def persist():
                with self.connect() as conn:
                    conn.execute(
                        "INSERT INTO vpn_settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                        (self.secrets.encrypt_text(json.dumps(config)),),
                    )

            # Never open egress while the saved preference still promises VPN protection.
            deactivating = previous["enabled"] and not config["enabled"]
            if deactivating:
                persist()
            # A missing gateway can store profiles, but can never pretend to enable VPN.
            if config["enabled"] or previous["enabled"]:
                self.gateway.call("configure", settings=config)
            elif self.status()["available"]:
                self.gateway.call("configure", settings=config)
            if not deactivating:
                persist()
            return self.public()

    def before_actor(self, cancellation):
        while self.configuration()["enabled"]:
            if cancellation.wait(0.25):
                raise AppError("actor_cancelled", 409)
            try:
                response = self.gateway.call("acquire")
                if response.get("acquired"):
                    return True
            except AppError:
                pass
        return False

    def after_actor(self, acquired, rotate=True):
        if acquired:
            try:
                self.gateway.call("release", rotate=rotate)
            except AppError:
                pass  # The gateway's firewall remains closed when its control API fails.

    def rotate(self):
        if not self.configuration()["enabled"]:
            raise AppError("vpn_disabled", 409)
        self.gateway.call("rotate")
        return self.public()
