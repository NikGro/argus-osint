"""Filesystem Unix proxy reachable by network-isolated workers, never a TCP listener."""

import http.server
import select
import socketserver
import threading
import time
from core.public_network import connect_pinned, request


class Proxy(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(128)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_CONNECT(self):
        if not self.server.slots.acquire(blocking=False):
            self.send_error(503)
            return
        self.connection.settimeout(15)
        remote = None
        try:
            _, remote = connect_pinned("https://" + self.path, 15)
            self.send_response(200)
            self.end_headers()
            self.wfile.flush()
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
        except Exception:
            self.close_connection = True
        finally:
            if remote:
                remote.close()
            self.server.slots.release()
            self.close_connection = True

    def forward(self):
        if not self.server.slots.acquire(blocking=False):
            self.send_error(503)
            return
        self.connection.settimeout(15)
        try:
            if (
                self.headers.get("Transfer-Encoding")
                or len(self.headers.get_all("Content-Length", [])) > 1
            ):
                self.send_error(400)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 16 * 1024 * 1024:
                self.send_error(413)
                return
            body = self.rfile.read(length) if length else None
            response = request(
                self.path,
                timeout=45,
                method=self.command,
                headers=dict(self.headers),
                body=body,
                follow_redirects=False,
            )
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
        except Exception:
            self.send_error(502, "Public-only proxy rejected request")
        finally:
            self.server.slots.release()
            self.close_connection = True

    do_GET = do_HEAD = do_POST = do_OPTIONS = do_PUT = do_DELETE = forward
