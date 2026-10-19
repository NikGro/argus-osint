"""Privilege boundary contracts; no research or face inference is performed."""

import errno
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

from core import worker_security as security


class WorkerSecurity(unittest.TestCase):
    def test_bounding_set_is_dropped_before_identity(self):
        calls = []
        libc = Mock()
        libc.prctl.side_effect = lambda *a: calls.append("prctl") or 0
        libc.capset.return_value = libc.capget.return_value = 0
        with (
            patch.object(security.ctypes, "CDLL", return_value=libc),
            patch.object(
                security,
                "drop_bounding_set",
                side_effect=lambda _: calls.append("bounding"),
            ),
            patch.object(
                os,
                "setgroups",
                create=True,
                side_effect=lambda _: calls.append("groups"),
            ),
            patch.object(
                os, "setgid", create=True, side_effect=lambda _: calls.append("gid")
            ),
            patch.object(
                os, "setuid", create=True, side_effect=lambda _: calls.append("uid")
            ),
            patch.object(os, "getresuid", create=True, return_value=(21000,) * 3),
        ):
            security.drop_identity(21000)
        self.assertEqual(calls[:4], ["bounding", "groups", "gid", "uid"])

    def test_bounding_failure_prevents_identity_change_and_execution(self):
        with (
            patch.object(security.ctypes, "CDLL", return_value=Mock()),
            patch.object(
                security,
                "drop_bounding_set",
                side_effect=OSError(errno.EPERM, "fixture"),
            ),
            patch.object(os, "setuid", create=True) as setuid,
            patch.object(security, "install_seccomp") as seccomp,
        ):
            with self.assertRaises(OSError):
                security.harden_worker(21000)
        setuid.assert_not_called()
        seccomp.assert_not_called()

    def test_missing_seccomp_fails_closed(self):
        with patch.object(security.ctypes.util, "find_library", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "required"):
                security.install_seccomp()

    @unittest.skipUnless(sys.platform == "linux", "Linux seccomp runtime")
    def test_filter_blocks_mount_but_allows_threads_and_subprocesses(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                """
import ctypes, errno, subprocess, sys, threading
from core.worker_security import install_seccomp
libc=ctypes.CDLL(None,use_errno=True)
assert libc.prctl(38,1,0,0,0)==0
# A null filter must be rejected with EFAULT on a supporting kernel.
# EINVAL/ENOSYS indicates missing filter support, not a successful boundary.
rc=libc.prctl(22,2,0,0,0)
if rc == -1 and ctypes.get_errno() in (errno.EINVAL,errno.ENOSYS):
    print("Host kernel does not support seccomp filters")
    sys.exit(77)
install_seccomp()
libc=ctypes.CDLL(None,use_errno=True)
assert libc.mount(b'none',b'/nonexistent',b'tmpfs',0,None)==-1
assert ctypes.get_errno()==errno.EPERM
done=[]
t=threading.Thread(target=lambda:done.append(True));t.start();t.join()
assert done==[True]
subprocess.run([sys.executable,'-c','print("child-ok")'],check=True)
""",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.returncode == 77:
            self.skipTest(result.stdout.strip())
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
