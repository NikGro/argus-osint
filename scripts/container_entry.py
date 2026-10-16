"""Optional isolated-worker supervisor; ordinary app remains unprivileged."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    command = sys.argv[1:] or ["python", "server.py"]
    if not command[-1].endswith("server.py"):
        # Explicit maintenance/test commands do not start application services.
        os.execvp(command[0], command)
    if os.geteuid() != 0:
        print("Integrated VPN/browser/community runtime requires the supplied Compose permissions; starting the unprivileged application. Unavailable isolated features remain disabled.", file=sys.stderr, flush=True)
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

    data = Path(os.environ.get("DATA_DIR", "/data"))
    home = data / "home"
    home.mkdir(exist_ok=True)
    os.chown(home, 10001, 10001)
    private = data / ".vpn-private"
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    vpn = subprocess.Popen(
        [sys.executable, "-m", "core.vpn_gateway"],
        env={**os.environ, "ARGUS_VPN_STATE": str(private)},
    )
    from core.vpn import Gateway

    for _ in range(100):
        if vpn.poll() is not None:
            raise SystemExit("Integrated VPN controller failed to start")
        try:
            Gateway().call("status")
            break
        except Exception:
            time.sleep(0.1)
    else:
        vpn.terminate()
        raise SystemExit("Integrated VPN controller startup timed out")

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
        vpn.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while child.poll() is None:
        if vpn.poll() is not None:
            child.terminate()
            raise SystemExit(
                "VPN controller stopped; application stopped to preserve fail-closed behavior"
            )
        time.sleep(0.5)
    vpn.terminate()
    raise SystemExit(child.returncode)


if __name__ == "__main__":
    main()
