"""Dedicated root-container probe. Never imported by ordinary test discovery."""

import ctypes
import importlib
import errno
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
harden_worker = importlib.import_module("core.worker_security").harden_worker


def isolated_job(kind, code=""):
    with tempfile.TemporaryDirectory(prefix="argus-probe-") as folder:
        directory = Path(folder)
        (directory / "empty").mkdir()
        (directory / "request.json").write_text(json.dumps({"kind": kind}))
        (directory / "input.json").write_text(
            json.dumps({"action": "probe", "inputs": [], "params": {}})
        )
        (directory / "plugin.py").write_text(code)
        result = subprocess.run(
            [
                "/usr/bin/unshare",
                "--mount",
                "--net",
                "--pid",
                "--fork",
                "--mount-proc",
                sys.executable,
                "-m",
                "core.worker_entry",
                folder,
                "21001",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)


result = isolated_job(
    "community",
    """
import os
def run(action, inputs, params, context):
    status=dict(line.split(':',1) for line in open('/proc/self/status') if ':' in line)
    assert os.getuid()==21001
    for key in ('CapBnd','CapEff','CapPrm','CapInh','CapAmb'):
        assert int(status[key].strip(),16)==0,key
    assert status['Seccomp'].strip()=='2'
    try:
        assert not os.listdir('/data')
    except PermissionError:
        pass
    return {'outputs':[{'type':'value','data':{'value':'isolated'}}]}
""",
)
assert result["outputs"][0]["data"]["value"] == "isolated"
print(
    "Community subprocess: private data mount, worker identity and inherited filter verified"
)
browser = isolated_job("browser_self_test")
assert browser.get("status") == "ok", browser
print("Chromium offline self-test completed inside hardened worker")

harden_worker(21000)
status = dict(
    line.split(":", 1)
    for line in Path("/proc/self/status").read_text().splitlines()
    if ":" in line
)
for key in ("CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb"):
    assert int(status[key].strip(), 16) == 0, key
assert status["NoNewPrivs"].strip() == "1"
assert status["Seccomp"].strip() == "2"
libc = ctypes.CDLL(None, use_errno=True)
assert libc.unshare(0x40000000) == -1 and ctypes.get_errno() == errno.EPERM
done = []
thread = threading.Thread(target=lambda: done.append(True))
thread.start()
thread.join()
assert done == [True]
subprocess.run(
    [sys.executable, "-c", "print('child execution remains functional')"], check=True
)
print("Worker UID 21000, all capability sets zero, no_new_privs and seccomp enforced")
