"""Public-only transport. Every connection uses a vetted numeric IP, not a second DNS lookup."""

import http.client
import ipaddress
import socket
import ssl
import time
from urllib.parse import urlsplit, urljoin
from core.errors import AppError
from core.build_info import user_agent

MAX_BODY = 16 * 1024 * 1024


def destination(url):
    try:
        p = urlsplit(url)
        port = p.port or (443 if p.scheme == "https" else 80)
        if (
            p.scheme not in ("http", "https")
            or not p.hostname
            or p.username
            or p.password
            or "\\" in p.netloc
        ):
            raise ValueError()
        host = p.hostname.encode("idna").decode("ascii")
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        if not addresses:
            raise ValueError()
        for info in addresses:
            ip = ipaddress.ip_address(info[4][0])
            if not ip.is_global or (
                ip.version == 6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global
            ):
                raise ValueError()
        return p, addresses
    except (ValueError, UnicodeError, socket.gaierror):
        raise AppError("public_destination_required", 400) from None


def connect_pinned(url, timeout=15):
    parsed, addresses = destination(url)
    last = None
    for family, kind, proto, _, sockaddr in addresses:
        sock = socket.socket(family, kind, proto)
        sock.settimeout(timeout)
        try:
            sock.connect(
                sockaddr
            )  # Already-resolved numeric sockaddr; never re-resolve.
            return parsed, sock
        except OSError as error:
            last = error
            sock.close()
    raise AppError("external_request_failed", 502, type(last).__name__) from None


def request(
    url,
    timeout=20,
    limit=MAX_BODY,
    method="GET",
    headers=None,
    body=None,
    follow_redirects=True,
):
    deadline = time.monotonic() + timeout
    for _ in range(6):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AppError("external_timeout", 504)
        parsed, sock = connect_pinned(url, remaining)
        try:
            if parsed.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(
                    sock, server_hostname=parsed.hostname
                )
            conn = http.client.HTTPConnection(
                parsed.hostname, parsed.port, timeout=remaining
            )
            conn.sock = sock
            target = parsed.path or "/"
            if parsed.query:
                target += "?" + parsed.query
            clean = {
                k: v
                for k, v in (headers or {}).items()
                if k.lower()
                not in {
                    "host",
                    "connection",
                    "proxy-connection",
                    "proxy-authorization",
                    "transfer-encoding",
                    "content-length",
                }
            }
            clean["Host"] = parsed.netloc
            clean["Connection"] = "close"
            if not any(key.lower() == "user-agent" for key in clean):
                clean["User-Agent"] = user_agent("public research")
            conn.request(method, target, body=body, headers=clean)
            response = conn.getresponse()
            if (
                follow_redirects
                and response.status in (301, 302, 303, 307, 308)
                and response.getheader("Location")
            ):
                redirected = urljoin(url, response.getheader("Location"))
                if urlsplit(redirected).netloc != parsed.netloc:
                    headers = {
                        k: v
                        for k, v in (headers or {}).items()
                        if k.lower() not in ("authorization", "cookie")
                    }
                url = redirected
                if response.status == 303:
                    method, body = "GET", None
                continue
            chunks, size = [], 0
            # read1 closes the response (and its socket) after the final byte
            # of a Content-Length body. Do not set a timeout on that closed
            # socket in a redundant EOF iteration.
            while not response.isclosed():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise AppError("external_timeout", 504)
                sock.settimeout(remaining)
                chunk = response.read1(min(65536, limit - size + 1))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > limit:
                    raise AppError("external_response_too_large", 413)
            return {
                "url": url,
                "status": response.status,
                "headers": dict(response.getheaders()),
                "header_items": response.getheaders(),
                "body": b"".join(chunks),
            }
        except (OSError, ssl.SSLError, http.client.HTTPException) as error:
            raise AppError(
                "external_request_failed", 502, type(error).__name__
            ) from None
        finally:
            sock.close()
    raise AppError("external_redirect_limit", 502)
