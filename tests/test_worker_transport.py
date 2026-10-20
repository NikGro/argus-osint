"""Worker-only egress policy and broker transport; local fixtures, no research."""

import http.client
from contextlib import closing
from http.server import ThreadingHTTPServer
import importlib
import json
from pathlib import Path
import socket
import socketserver
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.parse import urlsplit

from core import isolation
from core.errors import AppError

# The HTTP handler is exercised on a real loopback server on all dev platforms.
# Windows has no UnixStreamServer; only its unused base is stubbed for import,
# never replaced with a listening TCP implementation of the production proxy.
with patch.object(
    socketserver,
    "UnixStreamServer",
    getattr(socketserver, "UnixStreamServer", socketserver.BaseServer),
    create=True,
):
    egress = importlib.import_module("core.egress")


class WorkerProxy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), egress.Handler)
        cls.server.slots = threading.BoundedSemaphore(8)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def fetch(self, method, target, headers=None):
        with closing(
            http.client.HTTPConnection(*self.server.server_address, timeout=3)
        ) as conn:
            conn.request(method, target, headers=headers or {})
            response = conn.getresponse()
            return response.status, response.read()

    def test_non_web_ports_rejected_before_any_outbound_connection(self):
        with (
            patch.object(egress, "connect_pinned") as connect,
            patch.object(egress, "request") as request,
            self.assertLogs("argus.egress", "WARNING") as logs,
        ):
            for port in (0, 25, 6667, 8080, 65536):
                for method, target in (
                    ("CONNECT", f"public.invalid:{port}"),
                    ("GET", f"http://public.invalid:{port}/"),
                ):
                    with self.subTest(method=method, port=port):
                        self.assertEqual(self.fetch(method, target)[0], 403)
        connect.assert_not_called()
        request.assert_not_called()
        self.assertIn("public.invalid", "\n".join(logs.output))

    def test_http_web_ports_relay_without_following_redirects(self):
        with patch.object(
            egress,
            "request",
            return_value={"status": 200, "headers": {}, "body": b"fixture"},
        ) as request:
            for target in (
                "http://public.invalid/",
                "https://public.invalid/",
                "http://public.invalid:443/",
            ):
                self.assertEqual(self.fetch("GET", target), (200, b"fixture"))
                self.assertFalse(request.call_args.kwargs["follow_redirects"])

    def test_connect_web_port_is_allowed_and_closes_remote(self):
        remote, peer = socket.socketpair()
        peer.close()
        try:
            with patch.object(
                egress,
                "connect_pinned",
                return_value=(urlsplit("https://public.invalid:443"), remote),
            ) as connect:
                self.assertEqual(self.fetch("CONNECT", "public.invalid:443")[0], 200)
            connect.assert_called_once_with("https://public.invalid:443", 15)
            self.assertEqual(remote.fileno(), -1)
        finally:
            remote.close()

    def test_secrets_and_raw_urls_never_enter_rejection_logs(self):
        with self.assertLogs("argus.egress", "WARNING") as logs:
            self.assertEqual(
                self.fetch(
                    "GET", "http://public.invalid:25/private?token=fixture-secret"
                )[0],
                403,
            )
            self.assertEqual(
                self.fetch("GET", "http://user:password@public.invalid/private")[0], 403
            )
        text = "\n".join(logs.output)
        for secret in ("fixture-secret", "password", "private?"):
            self.assertNotIn(secret, text)

    def test_public_destination_validation_and_transport_errors_are_visible(self):
        for error, status in (
            (AppError("public_destination_required", 400), 403),
            (AppError("external_request_failed", 502), 502),
            (OSError("fixture-secret"), 502),
        ):
            with (
                patch.object(egress, "connect_pinned", side_effect=error),
                self.assertLogs("argus.egress", "WARNING") as logs,
            ):
                self.assertEqual(self.fetch("CONNECT", "public.invalid:443")[0], status)
            self.assertIn("public.invalid", "\n".join(logs.output))
            self.assertNotIn("fixture-secret", "\n".join(logs.output))

    def test_connect_authority_cannot_hide_credentials_or_paths(self):
        with (
            patch.object(egress, "connect_pinned") as connect,
            self.assertLogs("argus.egress", "WARNING"),
        ):
            for target in (
                "public.invalid",
                "public.invalid:443/path",
                "user:password@public.invalid:443",
                "public.invalid:443?token=x",
            ):
                self.assertEqual(self.fetch("CONNECT", target)[0], 403)
        connect.assert_not_called()

    def test_unix_socket_requires_reserved_worker_identity(self):
        client = Mock()
        with patch.object(socket, "SO_PEERCRED", 17, create=True):
            for uid in (20000, 59999):
                client.getsockopt.return_value = struct.pack("3i", 123, uid, uid)
                self.assertTrue(egress.Proxy.verify_request(None, client, None))
            with self.assertLogs("argus.egress", "WARNING"):
                for uid in (0, 10001, 60000):
                    client.getsockopt.return_value = struct.pack("3i", 123, uid, uid)
                    self.assertFalse(egress.Proxy.verify_request(None, client, None))
                client.getsockopt.side_effect = OSError("unavailable")
                self.assertFalse(egress.Proxy.verify_request(None, client, None))


class BrokerTransport(unittest.TestCase):
    def test_large_file_survives_real_socket_backpressure(self):
        client, peer = socket.socketpair()
        failures = []
        received = []
        sending = threading.Event()

        def broker():
            try:
                if not sending.wait(3):
                    raise TimeoutError("Fixture upload did not start")
                time.sleep(0.7)  # Longer than the previous total sendall timeout.
                peer.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)
                chunks = []
                while chunk := peer.recv(65536):
                    chunks.append(chunk)
                received.append(json.loads(b"".join(chunks)))
                peer.sendall(b'{"outputs":[]}')
            except Exception as error:
                failures.append(error)
            finally:
                peer.close()

        class ConnectedSocket:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                client.close()

            def connect(self, path):
                pass

            def sendall(self, data):
                sending.set()
                return client.sendall(data)

            def __getattr__(self, name):
                return getattr(client, name)

        client.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
        peer.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
        thread = threading.Thread(target=broker, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                file = Path(folder) / "synthetic.bin"
                file.write_bytes(b"x" * (8 * 1024 * 1024))
                with (
                    patch.object(isolation.Path, "exists", return_value=True),
                    patch.object(isolation.socket, "AF_UNIX", 1, create=True),
                    patch.object(
                        isolation.socket, "socket", return_value=ConnectedSocket()
                    ),
                ):
                    self.assertEqual(
                        isolation.invoke("community", {}, files={"f" * 32: file}),
                        {"outputs": []},
                    )
            thread.join(timeout=4)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertGreater(len(received[0]["files"]["f" * 32]), 2 * 1024 * 1024)
        finally:
            client.close()
            peer.close()

    def test_upload_failure_is_mapped_and_cancels_broker_ticket(self):
        for error, code in (
            (TimeoutError(), "external_timeout"),
            (BrokenPipeError(), "isolated_execution_failed"),
        ):
            client = MagicMock()
            client.__enter__.return_value = client
            client.sendall.side_effect = error
            with (
                patch.object(isolation.Path, "exists", return_value=True),
                patch.object(isolation.socket, "AF_UNIX", 1, create=True),
                patch.object(isolation.socket, "socket", return_value=client),
                patch.object(isolation, "cancel") as cancel,
                self.assertRaises(AppError) as caught,
            ):
                isolation.invoke("community", {})
            self.assertEqual(caught.exception.code, code)
            cancel.assert_called_once()

    def test_receive_failure_is_mapped_and_cancels_broker_ticket(self):
        client = MagicMock()
        client.__enter__.return_value = client
        client.recv.side_effect = ConnectionResetError()
        with (
            patch.object(isolation.Path, "exists", return_value=True),
            patch.object(isolation.socket, "AF_UNIX", 1, create=True),
            patch.object(isolation.socket, "socket", return_value=client),
            patch.object(isolation, "cancel") as cancel,
            self.assertRaises(AppError) as caught,
        ):
            isolation.invoke("community", {})
        self.assertEqual(caught.exception.code, "isolated_execution_failed")
        cancel.assert_called_once()
