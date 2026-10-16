"""Client for the private namespace-worker broker. No unrestricted fallback."""

import base64
import json
import socket
import time
import secrets
from pathlib import Path
from core.errors import AppError
from core.execution_context import CANCEL_EVENT

SOCKET = "/run/argus/worker.sock"


def invoke(kind, payload, timeout=90, code=None, files=None):
    if not Path(SOCKET).exists():
        raise AppError("isolation_unavailable", 503)
    ticket = secrets.token_hex(16)
    message = {
        "kind": kind,
        "payload": payload,
        "timeout": min(600, max(1, timeout)),
        "ticket": ticket,
    }
    if code is not None:
        message["code"] = code
    if files:
        message["files"] = {
            fid: base64.b64encode(Path(path).read_bytes()).decode()
            for fid, path in files.items()
        }
    data = json.dumps(message).encode()
    if len(data) > 24 * 1024 * 1024:
        raise AppError("request_too_large", 413)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(0.5)
        client.connect(SOCKET)
        client.sendall(data)
        client.shutdown(socket.SHUT_WR)
        chunks = []
        size = 0
        deadline = time.monotonic() + timeout + 15
        while True:
            cancellation = CANCEL_EVENT.get()
            if cancellation is not None and cancellation.is_set():
                cancel(ticket)
                raise AppError("actor_cancelled", 409)
            if time.monotonic() > deadline:
                cancel(ticket)
                raise AppError("external_timeout", 504)
            try:
                chunk = client.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > 12 * 1024 * 1024:
                cancel(ticket)
                raise AppError("external_response_too_large", 413)
    result = json.loads(b"".join(chunks))
    if "broker_error" in result:
        raise AppError(result["broker_error"], 503)
    return result


def cancel(ticket):
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2)
            client.connect(SOCKET)
            client.sendall(json.dumps({"kind": "cancel", "ticket": ticket}).encode())
            client.shutdown(socket.SHUT_WR)
    except OSError:
        pass
