"""Container supervisor: starts the VPN controller, then the unprivileged app.

Plugins and their tools run as ordinary child processes of the application
(UID 10001) inside this container; there is no per-job sandbox. All their
traffic follows the container's routes, so the VPN firewall applies to them.
"""

import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
APP_UID = 10001


def start_vpn(data):
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
            return vpn
        except Exception:
            time.sleep(0.1)
    vpn.terminate()
    raise SystemExit("Integrated VPN controller startup timed out")


def main():
    command = sys.argv[1:] or ["python", "server.py"]
    if not command[-1].endswith("server.py"):
        # Explicit maintenance/test commands do not start application services.
        os.execvp(command[0], command)
    if os.geteuid() != 0:
        print(
            "Started without root: the integrated VPN needs the supplied Compose permissions and stays unavailable.",
            file=sys.stderr,
            flush=True,
        )
        os.execvp(command[0], command)
    data = Path(os.environ.get("DATA_DIR", "/data"))
    for folder in (data, data / "home", data / "tools", data / "plugins"):
        folder.mkdir(parents=True, exist_ok=True)
        os.chown(folder, APP_UID, APP_UID)
    vpn = start_vpn(data)
    child = subprocess.Popen(
        command,
        user=APP_UID,
        group=APP_UID,
        extra_groups=[],
        env={**os.environ, "HOME": str(data / "home")},
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
