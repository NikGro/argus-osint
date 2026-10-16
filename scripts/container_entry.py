"""Optional isolated-worker supervisor; ordinary app remains unprivileged."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    command = sys.argv[1:] or ["python", "server.py"]
    if os.geteuid() != 0:
        os.execvp(command[0], command)
    # Fail closed: an explicitly requested worker configuration must support isolation.
    subprocess.run(
        [
            "/usr/bin/unshare",
            "--mount",
            "--net",
            "--pid",
            "--fork",
            "--mount-proc",
            "/bin/true",
        ],
        check=True,
    )
    from core.egress import Proxy, Handler
    from core.worker_broker import serve

    socket = Path("/run/argus-egress.sock")
    socket.unlink(missing_ok=True)
    proxy = Proxy(str(socket), Handler)
    socket.chmod(0o666)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()
    threading.Thread(target=serve, daemon=True).start()
    child = subprocess.Popen(
        command,
        user=10001,
        group=10001,
        extra_groups=[],
        env={**os.environ, "HOME": "/data/home"},
    )

    def stop(*_):
        child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    raise SystemExit(child.wait())


if __name__ == "__main__":
    main()
