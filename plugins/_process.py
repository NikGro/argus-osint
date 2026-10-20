"""Bounded stdin/stdout/stderr, deadline and whole-process-group cancellation."""

import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from core.errors import AppError

from core.execution_context import CANCEL_EVENT


def bounded_run(
    command,
    timeout,
    payload=None,
    extra_env=None,
    max_bytes=8 * 1024 * 1024,
    cwd=None,
    output_limit=None,
):
    def check_artifact():
        if output_limit is not None:
            path, maximum = output_limit
            if Path(path).exists() and Path(path).stat().st_size > maximum:
                raise ValueError("The generated media exceeds the 128 MB limit.")

    env = {
        "PATH": os.environ.get("PATH", ""),
        "LANG": "C.UTF-8",
        "NO_COLOR": "1",
        **(extra_env or {}),
    }
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="argus-search-") as directory:
        # A regular input file cannot block on a child which never reads stdin.
        with (
            open(Path(directory) / "in", "w+b") as inp,
            open(Path(directory) / "out", "w+b") as out,
            open(Path(directory) / "err", "w+b") as err,
        ):
            if payload is not None:
                inp.write(json.dumps(payload).encode())
            inp.seek(0)
            env["HOME"] = directory
            process = subprocess.Popen(
                command,
                stdin=inp,
                stdout=out,
                stderr=err,
                cwd=cwd or directory,
                env=env,
                start_new_session=True,
            )
            try:
                while process.poll() is None:
                    check_artifact()
                    cancellation = CANCEL_EVENT.get()
                    if cancellation is not None and cancellation.is_set():
                        raise AppError("actor_cancelled", 409)
                    if timeout is not None and time.monotonic() - start > timeout:
                        raise ValueError("Zeitlimit erreicht; Suche unvollständig.")
                    if (
                        os.fstat(out.fileno()).st_size + os.fstat(err.fileno()).st_size
                        > max_bytes
                    ):
                        raise ValueError("Suchergebnis zu groß.")
                    time.sleep(0.05)
                check_artifact()
                out.seek(0)
                err.seek(0)
                stdout, stderr = out.read(max_bytes + 1), err.read(max_bytes + 1)
                if len(stdout) + len(stderr) > max_bytes:
                    raise ValueError("Suchergebnis zu groß.")
                if process.returncode:
                    error = stderr.decode(errors="replace")[-1000:]
                    for value in (extra_env or {}).values():
                        if value:
                            error = error.replace(str(value), "[redacted]")
                    raise ValueError("Suchwerkzeug fehlgeschlagen: " + error)
                return stdout.decode(errors="replace"), stderr.decode(errors="replace")
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
