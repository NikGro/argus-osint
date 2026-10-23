"""Linux worker privilege boundary. Any failed hardening step aborts the job.

The broker still needs a few capabilities to construct namespaces. None survive
into plugin/browser execution. The inner filter is deliberately independent of
the outer Docker seccomp policy and inherited by subprocesses and threads.
"""

import ctypes
import ctypes.util
import errno
import os
from pathlib import Path

PR_CAPBSET_READ = 23
PR_CAPBSET_DROP = 24
PR_SET_NO_NEW_PRIVS = 38
PR_CAP_AMBIENT = 47
PR_CAP_AMBIENT_CLEAR_ALL = 4
ALLOW = 0x7FFF0000
ERRNO = 0x00050000

DENIED_SYSCALLS = (
    "bpf",
    "perf_event_open",
    "add_key",
    "request_key",
    "keyctl",
    "userfaultfd",
    "io_uring_setup",
    "io_uring_enter",
    "io_uring_register",
    "mount",
    "umount2",
    "pivot_root",
    "chroot",
    "unshare",
    "setns",
    "open_by_handle_at",
    "name_to_handle_at",
    "kexec_load",
    "kexec_file_load",
    "init_module",
    "finit_module",
    "delete_module",
    "reboot",
    "swapon",
    "swapoff",
    "ptrace",
    "process_vm_readv",
    "process_vm_writev",
    "process_madvise",
    "process_mrelease",
    "fanotify_init",
    "fsopen",
    "fsconfig",
    "fsmount",
    "fspick",
    "open_tree",
    "move_mount",
    "mount_setattr",
    "socketcall",
    "kcmp",
    "iopl",
    "ioperm",
)
NAMESPACE_FLAGS = (
    0x00020000,
    0x02000000,
    0x04000000,
    0x08000000,
    0x10000000,
    0x20000000,
    0x40000000,
)


class Argument(ctypes.Structure):
    _fields_ = [
        ("arg", ctypes.c_uint),
        ("op", ctypes.c_int),
        ("datum_a", ctypes.c_uint64),
        ("datum_b", ctypes.c_uint64),
    ]


def checked(result, step):
    if result != 0:
        raise OSError(ctypes.get_errno() or errno.EPERM, step)


def drop_bounding_set(libc=None):
    libc = libc or ctypes.CDLL(None, use_errno=True)
    last = int(Path("/proc/sys/kernel/cap_last_cap").read_text().strip())
    if not 0 <= last < 256:
        raise RuntimeError("Invalid kernel capability range")
    for capability in range(last + 1):
        checked(
            libc.prctl(PR_CAPBSET_DROP, capability, 0, 0, 0),
            "drop capability bounding set",
        )
        if libc.prctl(PR_CAPBSET_READ, capability, 0, 0, 0) != 0:
            raise RuntimeError("Capability survived bounding-set drop")
    checked(
        libc.prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0),
        "clear ambient capabilities",
    )


def drop_identity(uid):
    if not 20000 <= uid < 60000:
        raise ValueError("Invalid worker identity")
    # CAP_SETPCAP is required here and intentionally dropped from the bound set
    # before the last UID transition. No child can reacquire file capabilities.
    libc = ctypes.CDLL(None, use_errno=True)
    drop_bounding_set(libc)
    os.setgroups([])
    os.setgid(uid)
    os.setuid(uid)
    checked(libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0), "set no_new_privs")

    class Header(ctypes.Structure):
        _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]

    class Caps(ctypes.Structure):
        _fields_ = [
            ("effective", ctypes.c_uint32),
            ("permitted", ctypes.c_uint32),
            ("inheritable", ctypes.c_uint32),
        ]

    header, caps = Header(0x20080522, 0), (Caps * 2)()
    checked(libc.capset(ctypes.byref(header), caps), "clear remaining capabilities")
    checked(libc.capget(ctypes.byref(header), caps), "read capability state")
    if any(
        c.effective or c.permitted or c.inheritable for c in caps
    ) or os.getresuid() != (uid, uid, uid):
        raise RuntimeError("Worker identity transition incomplete")


def install_seccomp():
    library = ctypes.util.find_library("seccomp")
    if not library:
        raise RuntimeError("libseccomp is required for isolated workers")
    seccomp = ctypes.CDLL(library, use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.POINTER(Argument),
    ]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    context = seccomp.seccomp_init(ALLOW)
    if not context:
        raise RuntimeError("Cannot initialize worker seccomp")

    def deny(name, comparison=None, error=errno.EPERM):
        number = seccomp.seccomp_syscall_resolve_name(name.encode("ascii"))
        if number < 0:  # A syscall absent on this architecture cannot be invoked.
            return
        args = (Argument * 1)(comparison) if comparison else None
        result = seccomp.seccomp_rule_add_array(
            context, ERRNO | error, number, int(comparison is not None), args
        )
        if result != 0:
            raise RuntimeError("Cannot restrict worker syscall: " + name)

    try:
        for name in DENIED_SYSCALLS:
            deny(name)
        # ENOSYS allows libc/Chromium to fall back to ordinary clone for threads.
        deny("clone3", error=errno.ENOSYS)
        for flag in NAMESPACE_FLAGS:
            deny("clone", Argument(0, 7, flag, flag))
        for family in (16, 17, 38, 40, 44):  # netlink, packet, crypto, vsock, XDP
            deny("socket", Argument(0, 4, family, 0))
        deny("socket", Argument(1, 7, 15, 3))  # SOCK_RAW, even with CLOEXEC flags
        result = seccomp.seccomp_load(context)
        if result != 0:
            raise RuntimeError(
                f"Cannot load worker seccomp: result={result}, errno={ctypes.get_errno()}"
            )
    finally:
        seccomp.seccomp_release(context)


def harden_worker(uid):
    drop_identity(uid)
    install_seccomp()
    verify_worker_state(uid)


def verify_worker_state(uid):
    """Check the kernel's final state before starting threads or untrusted code."""
    status = dict(
        line.split(":", 1)
        for line in Path("/proc/self/status").read_text().splitlines()
        if ":" in line
    )
    if (
        os.getresuid() != (uid, uid, uid)
        or os.getresgid() != (uid, uid, uid)
        or os.getgroups()
        or any(
            int(status[key].strip(), 16) != 0
            for key in ("CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb")
        )
        or status["NoNewPrivs"].strip() != "1"
        or status["Seccomp"].strip() != "2"
    ):
        raise RuntimeError("Worker privilege boundary verification failed")
