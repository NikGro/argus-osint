"""Fixed bootstrap inside new mount, network and PID namespaces; drops identity before code."""

import json
import os
import resource
from pathlib import Path
import select
import shutil
import socket
import socketserver
import subprocess
import sys
import threading


def mount(*args):
    subprocess.run(
        ["/bin/mount", *args],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


class Bridge(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as upstream:
            upstream.connect("/run/argus-egress.sock")
            while True:
                ready, _, _ = select.select([self.request, upstream], [], [], 120)
                if not ready:
                    return
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        return
                    (upstream if source is self.request else self.request).sendall(data)


def main():
    directory = Path(sys.argv[1])
    uid = int(sys.argv[2])
    message = json.loads((directory / "request.json").read_text())
    mount("--make-rprivate", "/")
    mount("-t", "tmpfs", "-o", "mode=700,size=128m", "tmpfs", "/work")
    for item in directory.iterdir():
        if item.name in ("input.json", "plugin.py") or (
            len(item.name) == 32 and item.is_file()
        ):
            shutil.copyfile(item, Path("/work") / item.name)
    for item in [*Path("/work").iterdir(), Path("/work")]:
        os.chown(item, uid, uid)
    mount("--bind", str(directory / "empty"), "/data")
    mount("-t", "tmpfs", "-o", "mode=1777,size=384m", "tmpfs", "/tmp")
    subprocess.run(["/usr/sbin/ip", "link", "set", "lo", "up"], check=True)
    resource.setrlimit(resource.RLIMIT_FSIZE, (12 * 1024 * 1024, 12 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    resource.setrlimit(resource.RLIMIT_CPU, (600, 600))
    os.chdir("/work")
    from core.worker_security import harden_worker

    harden_worker(uid)
    os.umask(0o077)
    bridge = Bridge(("127.0.0.1", 0), Relay)
    threading.Thread(target=bridge.serve_forever, daemon=True).start()
    proxy = "http://127.0.0.1:" + str(bridge.server_address[1])
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "HOME": "/work",
        "TMPDIR": "/tmp",
        "HTTP_PROXY": proxy,
        "HTTPS_PROXY": proxy,
        "http_proxy": proxy,
        "https_proxy": proxy,
        "NO_PROXY": "localhost,127.0.0.1,::1",
        "ARGUS_WORKER_PROXY": proxy,
        "ARGUS_ISOLATED_WORKER": "1",
    }
    kind = message["kind"]
    if kind in ("browser", "browser_self_test"):
        command = [
            "/opt/argus-tools/flaresolverr-venv/bin/python",
            "-I",
            "/app/plugins/_browser_runner.py",
        ]
        if kind == "browser_self_test":
            command.append("--self-test")
    elif kind == "community":
        command = [
            "/usr/local/bin/python",
            "-I",
            "/app/core/community_runner.py",
            "/work/plugin.py",
        ]
    else:
        raise RuntimeError("Unknown worker kind")
    with open("/work/input.json", "rb") as inp:
        child = subprocess.run(command, stdin=inp, env=env, check=False)
    raise SystemExit(child.returncode)


if __name__ == "__main__":
    main()
