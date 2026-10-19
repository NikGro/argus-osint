"""Beta regressions: real HTTP response lifecycles, no external requests."""

import http.server
import socket
import threading
import unittest
from urllib.parse import urlsplit
from unittest.mock import patch
from core.public_network import request
from core.errors import AppError


class ResponseLifecycles(unittest.TestCase):

    @classmethod
    def setUpClass(cls):

        class Fixture(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                if self.path == "/chunked":
                    self.send_header("Transfer-Encoding", "chunked")
                    body = b"7\r\nfixture\r\n0\r\n\r\n"
                else:
                    self.send_header("Content-Length", "7")
                    body = b"fixture"
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)

        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def fetch(self, path, limit=1024):

        def pinned(url, timeout):
            return (
                urlsplit(url),
                socket.create_connection(self.server.server_address, timeout),
            )

        with patch("core.public_network.connect_pinned", pinned):
            return request("http://fixture.invalid" + path, limit=limit)

    def test_content_length_socket_closes_after_final_chunk(self):
        self.assertEqual(self.fetch("/fixed")["body"], b"fixture")

    def test_chunked_response_and_body_limit(self):
        self.assertEqual(self.fetch("/chunked")["body"], b"fixture")
        with self.assertRaises(AppError) as caught:
            self.fetch("/fixed", limit=3)
        self.assertEqual(caught.exception.code, "external_response_too_large")
