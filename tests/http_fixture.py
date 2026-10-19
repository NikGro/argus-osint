"""Authenticated fixture client. Production authentication is never disabled for tests."""

import json
import time
import urllib.request
from runtime_fixture import app


def request(*args, **kwargs):
    headers = dict(kwargs.pop("headers", {}) or {})
    headers["Authorization"] = "Bearer " + app.AUTH.key
    return urllib.request.Request(*args, headers=headers, **kwargs)


def await_project(base, job):
    deadline = time.monotonic() + 15
    while job["state"] not in ("completed", "failed", "cancelled", "interrupted"):
        if time.monotonic() > deadline:
            raise AssertionError("Fixture job did not finish")
        time.sleep(0.02)
        with urllib.request.urlopen(
            request(base + "/api/jobs/" + job["id"])
        ) as response:
            job = json.load(response)
    with urllib.request.urlopen(
        request(base + "/api/projects/" + job["project_id"])
    ) as response:
        return json.load(response)
