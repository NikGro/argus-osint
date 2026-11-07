"""Render the README screenshots from a throwaway ARGUS instance with synthetic data.

    python scripts/readme_screenshots.py [output-directory]

Starts a local server on a temporary data directory, installs the native plugins
from this checkout (tools are stubbed), creates a demonstration project and
database with generated media, and captures the pages with Playwright. Nothing
contacts a research service; every name, account and file is invented.
"""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "assets"
VIEWPORT = {"width": 1600, "height": 1000}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.cookie = ""
        self.csrf = ""
        request = urllib.request.Request(
            base + "/api/auth/login",
            data=b"{}",
            method="POST",
            headers={"Content-Type": "application/json", "X-Argus-Client": "web"},
        )
        with urllib.request.urlopen(request) as response:
            self.cookie = response.headers["Set-Cookie"].split(";")[0]
            self.csrf = json.load(response)["csrf_token"]

    def call(self, path, body=None, raw=None, headers=None):
        data = (
            raw
            if raw is not None
            else (None if body is None else json.dumps(body).encode())
        )
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method="GET" if data is None else "POST",
            headers={
                "Cookie": self.cookie,
                "X-Argus-Token": self.csrf,
                **({"Content-Type": "application/json"} if raw is None else {}),
                **(headers or {}),
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)


def media(folder):
    """Generated image, audio and video; no real recordings or people."""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (640, 400), "#1d3b53")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 260, 640, 400), fill="#24506b")
    for x, h, c in ((60, 120, "#c9d6df"), (170, 170, "#e3b04b"), (300, 90, "#9fb3c8")):
        draw.rectangle((x, 260 - h, x + 90, 260), fill=c)
    draw.polygon([(420, 260), (600, 260), (560, 300), (450, 300)], fill="#f1f1f1")
    draw.ellipse((520, 40, 580, 100), fill="#ffcc70")
    image.save(folder / "harbor.jpg", quality=90)
    ffmpeg = ["ffmpeg", "-v", "error", "-y"]
    subprocess.run(
        ffmpeg
        + [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:duration=12",
            "-af",
            "afade=t=in:d=2,afade=t=out:st=9:d=3",
            str(folder / "harbor-ambience.m4a"),
        ],
        check=True,
    )
    subprocess.run(
        ffmpeg
        + [
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=25:duration=8",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=8",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(folder / "pier-camera.mp4"),
        ],
        check=True,
    )
    return [
        folder / name
        for name in ("harbor.jpg", "harbor-ambience.m4a", "pier-camera.mp4")
    ]


def node(nid, kind, label, x, y, data, **extra):
    return {
        "id": nid,
        "type": kind,
        "label": label,
        "x": x,
        "y": y,
        "data": data,
        "evidence": {"origin": "manual"},
        "tags": extra.pop("tags", ["demo"]),
        "verification": extra.pop("verification", "unverified"),
        "display": extra.pop("display", {}),
        "report": extra.pop("report", False),
        **extra,
    }


def tool(nid, plugin, action, label, x, y, status="completed", params=None):
    return node(
        nid,
        "actor",
        label,
        x,
        y,
        {"plugin": plugin, "action": action, "params": params or {}, "status": status},
        tags=[],
    )


def project_document(files):
    image, audio, video = files
    found = {"origin": "tool", "tool": "Demonstration"}
    nodes = [
        node(
            "u",
            "username",
            "harbor.demo",
            0,
            40,
            {"value": "harbor.demo"},
            verification="verified",
            report=True,
        ),
        tool("t-user", "username", "lookup", "Research username", 330, 40),
        node(
            "p1",
            "profile",
            "Code hosting",
            680,
            -90,
            {
                "provider": "GitHub",
                "identifier": "harbor-demo-fixture",
                "url": "https://example.org/harbor-demo-fixture",
            },
            evidence=found,
            report=True,
        ),
        node(
            "p2",
            "profile",
            "Photo community",
            680,
            40,
            {
                "provider": "Flickr",
                "identifier": "harbor.demo",
                "url": "https://example.org/harbor.demo",
            },
            evidence=found,
        ),
        node(
            "p3",
            "email",
            "harbor.demo@example.org",
            680,
            170,
            {"value": "harbor.demo@example.org"},
            evidence=found,
        ),
        node(
            "img",
            "image",
            "harbor.jpg",
            0,
            330,
            {"file_id": image["file_id"], "filename": "harbor.jpg"},
            display={"preview": True},
            report=True,
        ),
        tool("t-meta", "metadata", "extract", "Extract metadata", 330, 400),
        node(
            "m1",
            "datetime",
            "EXIF · Create date",
            680,
            330,
            {"date": "2026-10-18", "time": "06:12", "timezone": "UTC"},
            evidence=found,
            tags=[],
        ),
        node(
            "m2",
            "value",
            "EXIF · Camera model",
            680,
            460,
            {"value": "Synthetic Camera 2"},
            evidence=found,
            tags=[],
        ),
        node(
            "aud",
            "audio",
            "harbor-ambience.m4a",
            0,
            680,
            {
                "file_id": audio["file_id"],
                "filename": "harbor-ambience.m4a",
                "mime": audio.get("mime", ""),
                "size": audio.get("size", 0),
                "duration": 12,
            },
            display={"preview": True},
        ),
        node(
            "when",
            "datetime",
            "Recording start",
            0,
            860,
            {"date": "2026-10-18", "time": "06:40", "timezone": "Europe/Berlin"},
            verification="unclear",
        ),
        tool(
            "t-dg",
            "dopplergeist",
            "locate",
            "Estimate recording location",
            330,
            760,
            params={
                "start_uncertainty_minutes": 10,
                "country": "DE",
                "max_candidates": 5,
            },
        ),
        node(
            "loc",
            "location",
            "Candidate 1",
            680,
            740,
            {
                "country": "Germany",
                "country_code": "DE",
                "locality": "Hamburg",
                "road": "Harbour promenade",
            },
            evidence=found,
        ),
        node(
            "vid",
            "video",
            "pier-camera.mp4",
            1060,
            330,
            {
                "file_id": video["file_id"],
                "filename": "pier-camera.mp4",
                "mime": video.get("mime", ""),
                "size": video.get("size", 0),
                "duration": 8,
            },
            display={"preview": True},
        ),
        tool(
            "t-trim",
            "video",
            "trim",
            "Trim video",
            1430,
            400,
            status="ready",
            params={"start_seconds": 1.5, "end_seconds": 5.0},
        ),
        node(
            "note",
            "note",
            "Investigation notes",
            1060,
            -40,
            {
                "text": "Synthetic demonstration data only.\nCompare the photo time with the recording start."
            },
            appearance={"width": 300, "height": 170, "color": "#ffcc70"},
            tags=[],
        ),
        node(
            "err",
            "error",
            "Search incomplete",
            1060,
            740,
            {
                "message": "One provider did not answer in time.\nThe other results are complete."
            },
            tags=[],
        ),
    ]
    links = [
        ("u", "t-user"),
        ("t-user", "p1"),
        ("t-user", "p2"),
        ("t-user", "p3"),
        ("img", "t-meta"),
        ("t-meta", "m1"),
        ("t-meta", "m2"),
        ("aud", "t-dg"),
        ("when", "t-dg"),
        ("t-dg", "loc"),
        ("vid", "t-trim"),
    ]
    edges = []
    for source, target in links:
        edge = {"id": uuid.uuid4().hex, "source": source, "target": target, "label": ""}
        if target == "t-dg":
            edge["target_port"] = "left:0:2" if source == "aud" else "left:1:2"
        edges.append(edge)
    groups = [
        {
            "id": "g-media",
            "label": "Media evidence",
            "members": ["img", "aud", "when"],
            "collapsed": False,
        }
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "groups": groups,
        "runs": [],
        "report_notes": "Synthetic demonstration project.",
    }


def database(api, photo):
    names = [
        ("Vessel", "value"),
        ("Call sign", "value"),
        ("Length (m)", "number"),
        ("Home port", "value"),
        ("Notes", "text"),
        ("Photo", "image"),
    ]
    fields = [{"id": uuid.uuid4().hex, "name": n, "type": k} for n, k in names]
    rows = [
        ("Seabird", "DEMO1", 24.5, "Example Harbor", "Ferry, fictional record", True),
        (
            "Northlight",
            "DEMO2",
            38.0,
            "Sample Bay",
            "Survey vessel, fictional record",
            False,
        ),
        (
            "Kestrel",
            "DEMO3",
            12.2,
            "Example Harbor",
            "Pilot boat, fictional record",
            False,
        ),
        ("Brightwater", "DEMO4", 56.8, "Test Port", "Cargo, fictional record", False),
    ]
    columns = fields[:5]
    cells = [
        {f["id"]: v for f, v in zip(columns, values[:5])}
        | ({fields[5]["id"]: [{"file_id": photo["file_id"]}]} if values[5] else {})
        for values in rows
    ]
    # Show the photo column second.
    ordered = fields[:1] + fields[5:] + fields[1:5]
    db = api.call("/api/databases", {"title": "Harbor vessels", "fields": ordered})
    api.call(
        "/api/databases/" + db["id"],
        {
            "revision": db["revision"],
            "operation": "rows",
            "rows": [{"cells": c} for c in cells],
        },
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = Path(tempfile.mkdtemp(prefix="argus-readme-"))
    stubs = data / "stub-tools"
    port = free_port()
    env = {
        **os.environ,
        "DATA_DIR": str(data / "data"),
        "ARGUS_PLUGIN_SOURCE": str(ROOT),
        "ARGUS_TOOLS_DIR": str(stubs),
        "HOST": "127.0.0.1",
        "PORT": str(port),
    }
    sys.path.insert(0, str(ROOT / "tests"))
    os.environ["ARGUS_TOOLS_DIR"] = str(stubs)
    import tool_stubs  # noqa: F401  (marks every tool as installed)

    server = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py")],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        api = Client(base)
        for plugin in (
            "username",
            "email",
            "metadata",
            "video",
            "audio",
            "dopplergeist",
            "merge",
            "transform",
        ):
            api.call("/api/plugin/install", {"id": plugin})
        settings = api.call("/api/settings")["settings"]
        settings["tags"] = [{"id": "demo", "name": "Demo", "color": "#6fc58c"}]
        api.call("/api/settings", settings)
        project = api.call("/api/projects", {"title": "Harbor · Demonstration"})
        pid = project["id"]
        uploaded = [
            api.call(
                "/api/files",
                raw=path.read_bytes(),
                headers={"X-File-Name": path.name, "X-Project-Id": pid},
            )
            for path in media(data)
        ]
        current = api.call("/api/projects/" + pid)
        api.call(
            "/api/projects/" + pid,
            {
                "title": current["title"],
                "revision": current["revision"],
                "document": project_document(uploaded),
            },
        )
        database(api, uploaded[0])
        render(base, pid)
    finally:
        server.terminate()
        server.wait(10)
        shutil.rmtree(data, ignore_errors=True)


def render(base, pid):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.environ.get("ARGUS_BROWSER_EXECUTABLE") or None
        )
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(base + "/")
        page.locator(".project-tile").first.wait_for()
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "home.png"))
        page.locator(".project-tile button").first.click()
        page.locator(".node[data-id=u]").wait_for()
        page.locator("#fit").click()
        page.wait_for_timeout(800)
        page.locator(".node[data-id=t-dg]").click(position={"x": 30, "y": 10})
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "workspace.png"))
        page.locator(".node[data-id=t-trim]").click(position={"x": 30, "y": 10})
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "video.png"))
        page.locator("#back").click()
        page.locator("#pluginsTab").click()
        page.wait_for_timeout(800)
        page.get_by_role("button", name="Add plugins").click()
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "plugins.png"))
        page.locator("#databasesTab").click()
        page.wait_for_timeout(800)
        page.locator(".database-list-item").first.click()
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "databases.png"))
        page.locator("#settingsTab").click()
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "settings.png"))
        browser.close()


if __name__ == "__main__":
    main()
