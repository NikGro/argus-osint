"""Small privileged launcher. Fixed commands only; code executes after namespace/UID separation."""

import base64
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import socketserver
import struct
import subprocess
import tempfile
import threading
import time

APP_UID = 10001
JOBS = {}
LOCK = threading.Lock()
LIMIT = threading.BoundedSemaphore(2)


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        if (
            struct.unpack(
                "3i", self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            )[1]
            != APP_UID
        ):
            return
        self.request.settimeout(5)
        chunks = []
        size = 0
        while True:
            part = self.request.recv(65536)
            if not part:
                break
            chunks.append(part)
            size += len(part)
            if size > 24 * 1024 * 1024:
                return
        try:
            message = json.loads(b"".join(chunks))
            kind = message.get("kind")
            ticket = message.get("ticket", "")
            if kind == "cancel":
                with LOCK:
                    process = JOBS.get(ticket)
                if process:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                self.request.sendall(b"{}")
                return
            if (
                kind not in ("community", "browser", "browser_self_test")
                or not isinstance(ticket, str)
                or len(ticket) != 32
            ):
                raise ValueError()
            if not LIMIT.acquire(blocking=False):
                self.request.sendall(b'{"broker_error":"actor_busy"}')
                return
            try:
                self.run_job(message)
            finally:
                LIMIT.release()
        except Exception:
            try:
                self.request.sendall(b'{"broker_error":"isolated_execution_failed"}')
            except OSError:
                pass

    def run_job(self, message):
        timeout = min(600, max(1, float(message.get("timeout", 90))))
        ticket = message["ticket"]
        uid = 20000 + secrets.randbelow(40000)
        with tempfile.TemporaryDirectory(prefix="argus-worker-") as folder:
            root = Path(folder)
            (root / "empty").mkdir(mode=0o700)
            if message["kind"] == "community":
                code = message.get("code", "")
                if not isinstance(code, str) or len(code.encode()) > 1024 * 1024:
                    raise ValueError()
                (root / "plugin.py").write_text(code)
            files = {}
            for fid, encoded in message.get("files", {}).items():
                if len(fid) != 32 or any(c not in "abcdef0123456789" for c in fid):
                    raise ValueError()
                data = base64.b64decode(encoded, validate=True)
                if len(data) > 16 * 1024 * 1024:
                    raise ValueError()
                (root / fid).write_bytes(data)
                files[fid] = "/work/" + fid
            payload = (
                {**message["payload"], "files": files}
                if message["kind"] == "community"
                else message["payload"]
            )
            (root / "input.json").write_text(json.dumps(payload))
            (root / "request.json").write_text(json.dumps({"kind": message["kind"]}))
            with open(root / "out", "w+b") as out, open(root / "err", "w+b") as err:
                command = [
                    "/usr/bin/unshare",
                    "--mount",
                    "--net",
                    "--pid",
                    "--fork",
                    "--mount-proc",
                    "--kill-child",
                    "/usr/local/bin/python",
                    "/app/core/worker_entry.py",
                    folder,
                    str(uid),
                ]
                process = subprocess.Popen(
                    command,
                    stdout=out,
                    stderr=err,
                    start_new_session=True,
                    env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
                )
                with LOCK:
                    JOBS[ticket] = process
                try:
                    deadline = time.monotonic() + timeout
                    while process.poll() is None:
                        if (
                            time.monotonic() > deadline
                            or os.fstat(out.fileno()).st_size
                            + os.fstat(err.fileno()).st_size
                            > 10 * 1024 * 1024
                        ):
                            raise TimeoutError()
                        time.sleep(0.05)
                    if process.returncode:
                        raise RuntimeError()
                    out.seek(0)
                    result = json.load(out)
                    self.request.sendall(json.dumps(result).encode())
                finally:
                    with LOCK:
                        JOBS.pop(ticket, None)
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()


def serve(path="/run/argus/worker.sock"):
    socket_path = Path(path)
    socket_path.parent.mkdir(mode=0o711, exist_ok=True)
    socket_path.unlink(missing_ok=True)
    with Server(str(socket_path), Handler) as server:
        os.chown(socket_path, APP_UID, APP_UID)
        socket_path.chmod(0o600)
        server.serve_forever()
