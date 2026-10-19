"""Offline synthetic media only; no face models, network research or user projects."""

import hashlib
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageChops
from plugins import video
from core.video import probe_video


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires bundled FFmpeg"
)
class VideoTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="argus-video-test-")
        cls.root = Path(cls.temp.name)
        image = Image.new("RGB", (160, 120), "#304455")
        draw = ImageDraw.Draw(image)
        rng = random.Random(4)
        for _ in range(120):
            x, y = rng.randrange(150), rng.randrange(110)
            draw.rectangle(
                (x, y, x + 5, y + 5), fill=tuple(rng.randrange(256) for _ in range(3))
            )
        for i in range(12):
            ImageChops.offset(image, [0, 1, 0, -1][i % 4], 0).save(
                cls.root / f"input-{i:03}.png"
            )
        cls.input = cls.root / "input.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-threads",
                "1",
                "-framerate",
                "10",
                "-i",
                str(cls.root / "input-%03d.png"),
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-pix_fmt",
                "yuv420p",
                "-y",
                str(cls.input),
            ],
            check=True,
            timeout=30,
        )

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def context(self):
        self.stored = []

        def store(data, name):
            path = self.root / (str(len(self.stored)) + "-" + name)
            path.write_bytes(data)
            value = {
                "file_id": path.name,
                "filename": name,
                "mime": "video/mp4" if name.endswith("mp4") else "image/png",
                "size": len(data),
            }
            self.stored.append((path, value))
            return value

        return {"resolve_file": lambda fid: self.input, "store_file": store}

    def node(self):
        return {"id": "synthetic", "type": "video", "data": {"file_id": "fixture"}}

    def test_trim_is_accurate_and_preserves_original(self):
        before = hashlib.sha256(self.input.read_bytes()).hexdigest()
        result = video.run(
            "trim",
            [self.node()],
            {"start_seconds": 0.2, "end_seconds": 0.8},
            self.context(),
        )
        self.assertEqual(result["outputs"][0]["type"], "video")
        self.assertAlmostEqual(
            probe_video(self.stored[0][0])["duration"], 0.6, delta=0.12
        )
        self.assertEqual(hashlib.sha256(self.input.read_bytes()).hexdigest(), before)

    @unittest.skipUnless(
        Path(video.FUSION_PYTHON).exists(), "Requires bundled CPU media runtime"
    )
    def test_cpu_fusion_produces_png_with_alignment_provenance(self):
        result = video.run(
            "fuse",
            [self.node()],
            {"start_seconds": 0, "burst_seconds": 1, "max_frames": 8},
            self.context(),
        )
        output = result["outputs"][0]
        self.assertEqual(output["type"], "image")
        self.assertGreaterEqual(output["source"]["frames_used"], 2)
        self.assertLessEqual(output["source"]["frames_extracted"], 8)
        with Image.open(self.stored[0][0]) as image:
            self.assertEqual(image.size, (160, 120))
            self.assertEqual(image.format, "PNG")

    def test_invalid_intervals_and_fusion_limits_do_not_store_outputs(self):
        for action, params in [
            ("trim", {"start_seconds": 1, "end_seconds": 0.5}),
            ("fuse", {"burst_seconds": 4}),
            ("fuse", {"max_frames": 33}),
            ("fuse", {"start_seconds": 1, "burst_seconds": 1}),
        ]:
            context = self.context()
            with self.assertRaises(ValueError):
                video.run(action, [self.node()], params, context)
            self.assertEqual(self.stored, [])

    def test_text_file_is_not_a_video(self):
        file = self.root / "invalid.mp4"
        file.write_text("synthetic text")
        self.assertEqual(probe_video(file, required=False), {})


class MediaRanges(unittest.TestCase):
    def test_authenticated_ranges_and_rejection(self):
        import threading
        import urllib.request
        import urllib.error
        import server
        from http_fixture import request

        stored = server.FILES.upload(b"0123456789", "range-fixture.txt")
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{httpd.server_port}/api/files/{stored['file_id']}"
        try:
            for header, body, span in [
                ("bytes=2-5", b"2345", "bytes 2-5/10"),
                ("bytes=-3", b"789", "bytes 7-9/10"),
                ("bytes=8-", b"89", "bytes 8-9/10"),
            ]:
                with urllib.request.urlopen(
                    request(url, headers={"Range": header})
                ) as response:
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.read(), body)
                    self.assertEqual(response.headers["Content-Range"], span)
            for header in ["bytes=50-60", "bytes=2-1", "bytes=0-1,4-5"]:
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request(url, headers={"Range": header}))
                self.assertEqual(caught.exception.code, 416)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(2)


@unittest.skipUnless(
    hasattr(__import__("os"), "killpg"), "Requires POSIX process groups"
)
class ArtifactBudget(unittest.TestCase):
    def test_output_limit_kills_oversized_child_before_success(self):
        import sys
        from plugins._process import bounded_run

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "artifact.bin"
            command = [
                sys.executable,
                "-c",
                "from pathlib import Path; import time; Path(__import__('sys').argv[1]).write_bytes(b'x'*8192); time.sleep(5)",
                str(output),
            ]
            with self.assertRaisesRegex(ValueError, "128 MB"):
                bounded_run(command, 10, output_limit=(output, 4096))
