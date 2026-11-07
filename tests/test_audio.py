"""Offline synthetic audio only."""

import tool_stubs  # external tools count as installed
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from core.video import probe_audio
from plugins import audio, metadata


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires bundled FFmpeg"
)
class AudioTools(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="argus-audio-test-")
        self.root = Path(self.temp.name)
        self.input = self.root / "tone.wav"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=6",
                "-y",
                str(self.input),
            ],
            check=True,
            timeout=30,
        )
        self.stored = {}

    def tearDown(self):
        self.temp.cleanup()

    def context(self):
        def store(data, name):
            path = self.root / ("stored-" + name)
            path.write_bytes(data)
            self.stored["path"] = path
            return {"file_id": "out", "mime": "audio/mp4", "size": len(data)}

        return {"resolve_file": lambda _id: str(self.input), "store_file": store}

    def node(self):
        return {
            "id": "a",
            "type": "audio",
            "label": "tone.wav",
            "data": {"file_id": "in"},
        }

    def test_trim_creates_shorter_copy(self):
        result = audio.run(
            "trim",
            [self.node()],
            {"start_seconds": 1, "end_seconds": 3.5},
            self.context(),
        )
        output = result["outputs"][0]
        self.assertEqual(output["type"], "audio")
        self.assertEqual(output["relation"], "Trimmed copy")
        self.assertAlmostEqual(
            probe_audio(self.stored["path"])["duration"], 2.5, delta=0.1
        )
        self.assertTrue(self.input.is_file())

    def test_trim_rejects_bad_ranges(self):
        for params in (
            {"start_seconds": 7, "end_seconds": 8},
            {"start_seconds": 3, "end_seconds": 2},
        ):
            with self.assertRaises(ValueError):
                audio.run("trim", [self.node()], params, self.context())
        with self.assertRaises(ValueError):
            audio.run("trim", [{**self.node(), "type": "video"}], {}, self.context())

    def test_metadata_accepts_media_nodes(self):
        inputs = metadata.PLUGIN["actions"][0]["inputs"]
        self.assertIn("audio", inputs)
        self.assertIn("video", inputs)


if __name__ == "__main__":
    unittest.main()
