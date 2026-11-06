"""Reads the resources available to ARGUS and recommends a worker count.

Inside a container the cgroup limits are what counts, not the host totals,
so both are read and the smaller value wins.
"""

import math
import os
from pathlib import Path

MAX_WORKERS = 32
# A heavy tool (face analysis, browser research) needs about this much memory.
MEMORY_PER_WORKER = 1.5 * 1024**3
# Memory kept free for the application, the database and the VPN.
RESERVED_MEMORY = 1024**3


def _read(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def cpu_count():
    count = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else 0
    count = count or os.cpu_count() or 1
    quota = _read("/sys/fs/cgroup/cpu.max")
    if quota:
        limit, _, period = quota.partition(" ")
        if limit != "max" and period:
            try:
                count = min(count, max(1, math.ceil(int(limit) / int(period))))
            except ValueError:
                pass
    return count


def _meminfo():
    values = {}
    for line in (_read("/proc/meminfo") or "").splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            values[key] = int(parts[0]) * 1024
    return values


def memory():
    info = _meminfo()
    total = info.get("MemTotal")
    available = info.get("MemAvailable", total)
    limit = _read("/sys/fs/cgroup/memory.max")
    if limit and limit.isdigit():
        limit = int(limit)
        used = _read("/sys/fs/cgroup/memory.current")
        used = int(used) if used and used.isdigit() else 0
        total = min(total, limit) if total else limit
        available = min(available or limit, max(0, limit - used))
    return total, available


def recommend(cpus, available):
    # Most tools wait on the network, so one worker per core is safe; memory
    # is the real limit for face analysis and browser research.
    by_cpu = max(1, cpus)
    if available is None:
        return min(by_cpu, MAX_WORKERS)
    by_memory = max(1, int((available - RESERVED_MEMORY) // MEMORY_PER_WORKER))
    return max(1, min(by_cpu, by_memory, MAX_WORKERS))


def detect():
    cpus = cpu_count()
    total, available = memory()
    return {
        "cpu_count": cpus,
        "memory_total": total,
        "memory_available": available,
        "recommended_workers": recommend(cpus, available),
        "max_workers": MAX_WORKERS,
    }
