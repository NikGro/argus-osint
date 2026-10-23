"""Privilege boundary contracts; no research or face inference is performed."""

import errno
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

from core import worker_security as security
from scripts import container_entry


class WorkerSecurity(unittest.TestCase):
    def test_kernel_state_must_confirm_identity_groups_and_all_capabilities(self):
        safe = {
            **{
                key: "0000000000000000"
                for key in ("CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb")
            },
            "NoNewPrivs": "1",
            "Seccomp": "2",
        }
        variants = [(safe, (21000,) * 3, (21000,) * 3, [])]
        for key in safe:
            wrong = {**safe, key: "1" if key.startswith("Cap") else "0"}
            variants.append((wrong, (21000,) * 3, (21000,) * 3, []))
        variants.extend(
            [
                (safe, (21000, 21000, 0), (21000,) * 3, []),
                (safe, (21000,) * 3, (21000, 21000, 0), []),
                (safe, (21000,) * 3, (21000,) * 3, [0]),
            ]
        )
        for index, (status, uids, gids, groups) in enumerate(variants):
            with (
                self.subTest(index=index),
                patch.object(
                    security.Path,
                    "read_text",
                    return_value="\n".join(
                        f"{key}:\t{value}" for key, value in status.items()
                    ),
                ),
                patch.object(os, "getresuid", create=True, return_value=uids),
                patch.object(os, "getresgid", create=True, return_value=gids),
                patch.object(os, "getgroups", create=True, return_value=groups),
            ):
                if index == 0:
                    security.verify_worker_state(21000)
                else:
                    with self.assertRaises(RuntimeError):
                        security.verify_worker_state(21000)

    def test_missing_kernel_state_fails_closed(self):
        with (
            patch.object(security.Path, "read_text", return_value=""),
            patch.object(os, "getresuid", create=True, return_value=(21000,) * 3),
            patch.object(os, "getresgid", create=True, return_value=(21000,) * 3),
            patch.object(os, "getgroups", create=True, return_value=[]),
            self.assertRaises(KeyError),
        ):
            security.verify_worker_state(21000)

    def test_seccomp_failure_prevents_final_verification(self):
        with (
            patch.object(security, "drop_identity"),
            patch.object(
                security, "install_seccomp", side_effect=RuntimeError("fixture")
            ),
            patch.object(security, "verify_worker_state") as verify,
            self.assertRaises(RuntimeError),
        ):
            security.harden_worker(21000)
        verify.assert_not_called()

    def test_kernel_verification_is_required_after_filter_installation(self):
        calls = []

        def verify(uid):
            calls.append("verify")
            raise RuntimeError("fixture")

        with (
            patch.object(
                security,
                "drop_identity",
                side_effect=lambda _: calls.append("identity"),
            ),
            patch.object(
                security, "install_seccomp", side_effect=lambda: calls.append("filter")
            ),
            patch.object(security, "verify_worker_state", side_effect=verify),
            self.assertRaises(RuntimeError),
        ):
            security.harden_worker(21000)
        self.assertEqual(calls, ["identity", "filter", "verify"])

    def test_startup_requires_namespaces_and_complete_hardening_before_services(self):
        for results in (
            [subprocess.CalledProcessError(1, "unshare")],
            [None, subprocess.CalledProcessError(1, "hardening")],
        ):
            with (
                self.subTest(stage=len(results)),
                patch.object(
                    sys, "argv", ["container_entry.py", "python", "server.py"]
                ),
                patch.object(os, "geteuid", create=True, return_value=0),
                patch.object(
                    container_entry.subprocess, "run", side_effect=results
                ) as run,
                patch.object(container_entry.subprocess, "Popen") as launch,
                self.assertRaises(subprocess.CalledProcessError),
            ):
                container_entry.main()
            launch.assert_not_called()
            self.assertEqual(run.call_count, len(results))
            if len(results) == 2:
                self.assertEqual(
                    run.call_args.args[0],
                    [
                        sys.executable,
                        "-c",
                        "from core.worker_security import harden_worker; harden_worker(20000)",
                    ],
                )
                self.assertTrue(run.call_args.kwargs["check"])
                self.assertEqual(run.call_args.kwargs["timeout"], 15)

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

    def test_filter_covers_namespace_creation_and_sensitive_kernel_interfaces(self):
        for load_result in (0, -1):
            with self.subTest(load_result=load_result):
                library = Mock()
                library.seccomp_init.return_value = 1
                names = {}

                def resolve(name):
                    names[len(names)] = name.decode()
                    return len(names) - 1

                library.seccomp_syscall_resolve_name.side_effect = resolve
                library.seccomp_rule_add_array.return_value = 0
                library.seccomp_load.return_value = load_result
                with (
                    patch.object(
                        security.ctypes.util, "find_library", return_value="fixture"
                    ),
                    patch.object(security.ctypes, "CDLL", return_value=library),
                ):
                    if load_result:
                        with self.assertRaisesRegex(RuntimeError, "Cannot load"):
                            security.install_seccomp()
                    else:
                        security.install_seccomp()
                rules = library.seccomp_rule_add_array.call_args_list
                denied = {names[call.args[2]] for call in rules}
                self.assertTrue(
                    {
                        "bpf",
                        "keyctl",
                        "io_uring_setup",
                        "unshare",
                        "setns",
                        "mount",
                        "ptrace",
                        "clone3",
                    }
                    <= denied
                )
                clone = [call for call in rules if names[call.args[2]] == "clone"]
                self.assertEqual(
                    {call.args[4][0].datum_a for call in clone},
                    set(security.NAMESPACE_FLAGS),
                )
                for call in clone:
                    arg = call.args[4][0]
                    self.assertEqual(
                        (arg.arg, arg.op, arg.datum_a), (0, 7, arg.datum_b)
                    )
                clone3 = next(call for call in rules if names[call.args[2]] == "clone3")
                self.assertEqual(clone3.args[1], security.ERRNO | errno.ENOSYS)
                library.seccomp_release.assert_called_once_with(1)

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
assert libc.unshare(0)==-1 and ctypes.get_errno()==errno.EPERM
assert libc.setns(-1,0)==-1 and ctypes.get_errno()==errno.EPERM
# Resolve native numbers rather than assuming an x86-only syscall table.
import ctypes.util
sc=ctypes.CDLL(ctypes.util.find_library('seccomp'))
sc.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]
libc.syscall.restype=ctypes.c_long
for name in (b'bpf',b'keyctl',b'io_uring_setup'):
    number=sc.seccomp_syscall_resolve_name(name)
    if number >= 0:
        assert libc.syscall(number,-1,0,0,0,0,0)==-1,name
        assert ctypes.get_errno()==errno.EPERM,name
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
