"""Stream the pinned Consensus CLI to a private checkpoint so deadlines retain evidence."""

import json
import os
from pathlib import Path
import subprocess
import sys


def main(payload):
    command = [
        str(Path(sys.executable).with_name("consensus")),
        payload["kind"],
        payload["value"],
        "--jsonl",
        "--all",
        "--no-color",
        "--no-footer",
        "--no-animation",
        "--no-update-check",
        "--no-extract",
        "--no-breach",
        "--concurrency",
        "20",
        "--timeout",
        str(payload["request_timeout"]),
    ]
    if payload.get("phone_region"):
        command += ["--phone-region", payload["phone_region"]]
    if payload.get("sites"):
        command += ["--site", ",".join(payload["sites"])]
    if payload.get("tags"):
        command += ["--tags", ",".join(payload["tags"])]
    if payload.get("top"):
        command += ["--top", str(payload["top"]), "--no-modules"]
    checkpoint = Path(payload["checkpoint"])
    with (
        checkpoint.open("w", encoding="utf-8") as output,
        checkpoint.with_suffix(".err").open("w+b") as errors,
    ):
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=errors,
            env={
                **os.environ,
                "CONSENSUS_NO_UPDATE_CHECK": "1",
                "CONSENSUS_AUTO_UPDATE": "0",
            },
        )
        size = 0
        for line in process.stdout:
            try:
                row = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(row, dict) and "site" in row and "status" in row:
                row = {
                    key: row[key]
                    for key in (
                        "site",
                        "site_id",
                        "status",
                        "url",
                        "category",
                        "source",
                        "method",
                        "error",
                        "http_status",
                    )
                    if key in row
                }
                encoded = json.dumps(row, ensure_ascii=False) + "\n"
                size += len(encoded.encode("utf-8"))
                if size > 8 * 1024 * 1024:
                    process.terminate()
                    break
                output.write(encoded)
                output.flush()
        code = process.wait()
    json.dump({"exit_code": code, "truncated": size > 8 * 1024 * 1024}, sys.stdout)


if __name__ == "__main__":
    main(json.load(sys.stdin))
