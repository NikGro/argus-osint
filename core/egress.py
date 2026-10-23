"""Filesystem Unix proxy reachable by network-isolated workers, never a TCP listener."""

import http.server
import http.client
import json
import logging
import socket
import struct
from urllib.parse import urlsplit
from core.errors import AppError
import select
import socketserver
import threading
import time
from core.public_network import connect_pinned, request

LOGGER = logging.getLogger("argus.egress")
WEB_PORTS = {80, 443}


class Proxy(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(128)

    def verify_request(self, client, address):
        # Per-job UIDs cannot share a socket owner. Mode 0666 permits connecting;
        # Linux peer credentials restrict actual use to reserved worker identities.
        uid = None
        try:
            option = getattr(socket, "SO_PEERCRED", None)
            if option is not None:
                _, uid, _ = struct.unpack(
                    "3i", client.getsockopt(socket.SOL_SOCKET, option, 12)
                )
                if 20000 <= uid < 60000:
                    return True
        except OSError:
            pass
        LOGGER.warning(
            json.dumps(
                {
                    "event": "worker_proxy_rejected",
                    "reason": "peer_identity",
                    "uid": uid,
                }
            )
        )
        return False


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        # BaseHTTPRequestHandler includes raw URLs in access logs. Emit bounded,
        # structured failure events below instead, without credentials or paths.
        pass

    def target(self, url, *, tunnel=False):
        self.destination_host = None
        self.destination_port = None
        if any(ord(char) < 32 or ord(char) == 127 for char in url):
            raise AppError("public_destination_required", 403)
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or "\\" in parsed.netloc
            or parsed.fragment
            or (tunnel and (parsed.port is None or parsed.path or parsed.query))
        ):
            raise AppError("public_destination_required", 403)
        self.destination_host = parsed.hostname.encode("idna").decode("ascii")[:253]
        self.destination_port = parsed.port
        if self.destination_port is None:
            self.destination_port = 443 if parsed.scheme == "https" else 80
        if self.destination_port not in WEB_PORTS:
            raise AppError("public_destination_required", 403)
        return url

    def record_failure(self, reason, error=None):
        LOGGER.warning(
            json.dumps(
                {
                    "event": "worker_proxy_rejected",
                    "method": self.command[:16],
                    "host": getattr(self, "destination_host", None),
                    "port": getattr(self, "destination_port", None),
                    "reason": reason,
                    "error_type": type(error).__name__ if error else None,
                }
            )
        )

    def reject(self, status, reason):
        self.record_failure(reason)
        self.close_connection = True
        self.send_error(status, "Worker proxy request rejected")

    def transport_failure(self, error, *, can_respond):
        self.record_failure("destination_or_transport", error)
        self.close_connection = True
        denied = isinstance(error, ValueError) or (
            isinstance(error, AppError) and error.code == "public_destination_required"
        )
        if can_respond:
            try:
                self.send_error(403 if denied else 502, "Worker proxy request failed")
            except OSError:
                pass  # The rejection is logged even if the peer disconnected.

    def do_CONNECT(self):
        if not self.server.slots.acquire(blocking=False):
            self.reject(503, "capacity")
            return
        self.connection.settimeout(15)
        remote = None
        established = False
        try:
            target = self.target("https://" + self.path, tunnel=True)
            _, remote = connect_pinned(target, 15)
            self.send_response(200)
            self.end_headers()
            self.wfile.flush()
            established = True
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                ready, _, _ = select.select([self.connection, remote], [], [], 1)
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        return
                    (remote if source is self.connection else self.connection).sendall(
                        data
                    )
        except (OSError, ValueError, AppError, http.client.HTTPException) as error:
            self.transport_failure(error, can_respond=not established)
        finally:
            if remote:
                remote.close()
            self.server.slots.release()
            self.close_connection = True

    def forward(self):
        if not self.server.slots.acquire(blocking=False):
            self.reject(503, "capacity")
            return
        self.connection.settimeout(15)
        responding = False
        try:
            target = self.target(self.path)
            if (
                self.headers.get("Transfer-Encoding")
                or len(self.headers.get_all("Content-Length", [])) > 1
            ):
                self.reject(400, "body_framing")
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 16 * 1024 * 1024:
                self.reject(413, "body_size")
                return
            body = self.rfile.read(length) if length else None
            response = request(
                target,
                timeout=45,
                method=self.command,
                headers=dict(self.headers),
                body=body,
                follow_redirects=False,
            )
            responding = True
            self.send_response(response["status"])
            for name, value in response.get(
                "header_items", response["headers"].items()
            ):
                if name.lower() not in (
                    "connection",
                    "transfer-encoding",
                    "content-length",
                    "keep-alive",
                ):
                    self.send_header(name, value)
            self.send_header("Content-Length", str(len(response["body"])))
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response["body"])
        except (OSError, ValueError, AppError, http.client.HTTPException) as error:
            self.transport_failure(error, can_respond=not responding)
        finally:
            self.server.slots.release()
            self.close_connection = True

    do_GET = do_HEAD = do_POST = do_OPTIONS = do_PUT = do_DELETE = forward
