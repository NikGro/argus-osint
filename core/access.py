"""Single-installation authentication, CSRF and explicit DNS-rebinding protection."""

from core.errors import DomainError
import ipaddress
import hmac
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit
from core.errors import AppError


class Access:

    def __init__(self, data, allowed_hosts=None):
        self.allow_private_literals = allowed_hosts is None and (
            not os.getenv("ARGUS_ALLOWED_HOSTS")
        )
        self.allowed_hosts = set(
            allowed_hosts
            or os.getenv(
                "ARGUS_ALLOWED_HOSTS", "localhost,127.0.0.1,::1,workbench,argus"
            ).split(",")
        )
        self.allowed_hosts = {
            h.strip().lower().rstrip(".") for h in self.allowed_hosts if h.strip()
        }
        path = Path(data) / ".access-key"
        configured = os.getenv("ARGUS_ACCESS_TOKEN", "")
        if configured and len(configured) < 24:
            raise DomainError("validation.7600724816")
        if not path.exists():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 384)
            with os.fdopen(fd, "w") as f:
                f.write(configured or secrets.token_urlsafe(32))
        self.key = configured or path.read_text().strip()
        path.chmod(384)
        self.sessions, self.attempts = ({}, {})
        self.pairing_code = secrets.token_urlsafe(32)
        self.pairing_expires = time.monotonic() + 86400
        self.lock = threading.Lock()

    def host_allowed(self, host):
        if host.lower().rstrip(".") in self.allowed_hosts:
            return True
        if self.allow_private_literals:
            try:
                return ipaddress.ip_address(host).is_private
            except ValueError:
                return False
        return False

    def check_host(self, headers):
        hosts = headers.get_all("Host", [])
        if len(hosts) != 1:
            raise AppError("invalid_host", 403)
        try:
            host = urlsplit("http://" + hosts[0])
            valid = (
                host.hostname
                and self.host_allowed(host.hostname)
                and (not host.username)
                and (not host.password)
                and (not host.path)
                and (not host.query)
                and (not host.fragment)
            )
            _ = host.port
        except ValueError:
            valid = False
        if not valid:
            raise AppError("invalid_host", 403)
        origin = headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in ("http", "https")
                or parsed.netloc.lower() != hosts[0].lower()
            ):
                raise AppError("forbidden_origin", 403)
        if headers.get("Sec-Fetch-Site") == "cross-site":
            raise AppError("forbidden_origin", 403)

    def session(self, headers, write=False):
        bearer = headers.get("Authorization", "")
        if bearer.startswith("Bearer ") and hmac.compare_digest(bearer[7:], self.key):
            return {"csrf": "bearer"}
        from http.cookies import SimpleCookie, CookieError

        cookie = SimpleCookie()
        try:
            cookie.load(headers.get("Cookie", ""))
        except CookieError:
            raise AppError("authentication_required", 401) from None
        sid = cookie.get("argus_session")
        with self.lock:
            record = self.sessions.get(sid.value if sid else "")
            if not record or record["expires"] <= time.monotonic():
                raise AppError("authentication_required", 401)
            if write and (
                not hmac.compare_digest(
                    headers.get("X-Argus-Token", ""), record["csrf"]
                )
            ):
                raise AppError("csrf_required", 403)
            return dict(record)

    def login(self, supplied, address):
        now = time.monotonic()
        with self.lock:
            self.attempts = {
                key: [t for t in values if t > now - 300]
                for key, values in self.attempts.items()
                if any((t > now - 300 for t in values))
            }
            if address not in self.attempts and len(self.attempts) >= 10000:
                raise AppError("login_rate_limited", 429)
            attempts = [t for t in self.attempts.get(address, []) if t > now - 300]
            self.attempts[address] = attempts
            if len(attempts) >= 8:
                raise AppError("login_rate_limited", 429)
            paired = (
                isinstance(supplied, str)
                and self.pairing_code is not None
                and (now < self.pairing_expires)
                and hmac.compare_digest(supplied, self.pairing_code)
            )
            if not isinstance(supplied, str) or not (
                paired or hmac.compare_digest(supplied, self.key)
            ):
                attempts.append(now)
                raise AppError("invalid_credentials", 401)
            if paired:
                self.pairing_code = None
            self.sessions = {
                k: v for k, v in self.sessions.items() if v["expires"] > now
            }
            sid, csrf = (secrets.token_urlsafe(32), secrets.token_urlsafe(32))
            self.sessions[sid] = {"csrf": csrf, "expires": now + 12 * 3600}
            return (sid, csrf, paired)

    def logout(self, headers):
        from http.cookies import SimpleCookie

        cookie = SimpleCookie()
        cookie.load(headers.get("Cookie", ""))
        sid = cookie.get("argus_session")
        if sid:
            with self.lock:
                self.sessions.pop(sid.value, None)
