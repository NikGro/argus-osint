"""Dopplergeist adapter with a mocked tool; no flight data or real recordings."""

import tool_stubs  # noqa: F401  (external tools count as installed)
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from plugins import dopplergeist

NODE = {
    "id": "a1",
    "type": "audio",
    "label": "Fixture recording",
    "data": {"file_id": "f" * 32, "filename": "fixture.mp3", "mime": "audio/mpeg"},
}
BERLIN_MOMENT = {
    "id": "d0",
    "type": "datetime",
    "data": {"date": "2026-01-15", "time": "14:30", "timezone": "Europe/Berlin"},
}


class Dopplergeist(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.audio = Path(folder.name) / "fixture.bin"
        self.audio.write_bytes(b"synthetic")
        self.context = {"resolve_file": lambda fid: str(self.audio)}

    def run_with(self, result, params=None, inputs=None, fail=False):
        calls = []

        def fake(args, timeout, **kwargs):
            calls.append((args, timeout))
            jobs = Path(args[args.index("--jobs") + 1]) / "job1"
            jobs.mkdir(parents=True)
            (jobs / "result.json").write_text(json.dumps(result))
            config = json.loads(Path(args[args.index("--config") + 1]).read_text())
            self.assertTrue(config["cache_root"].endswith("dopplergeist/cache"))
            self.assertTrue(Path(args[2]).name.endswith(".mp3"))
            if fail:
                raise ValueError("Search tool failed: exit 1")
            return json.dumps(result), ""

        with patch.object(dopplergeist, "bounded_run", side_effect=fake):
            out = dopplergeist.run(
                "locate",
                [NODE, BERLIN_MOMENT] if inputs is None else inputs,
                {
                    **dopplergeist.PLUGIN["actions"][0]["default_params"],
                    **(params or {}),
                },
                self.context,
            )
        return out, calls

    def test_candidates_become_ranked_location_nodes(self):
        result = {
            "schema_version": 1,
            "job_id": "job1",
            "status": "succeeded",
            "events": [{"event_id": "e1"}],
            "candidates": [
                {"lat": 10.0, "lon": 20.0, "score": 0.2, "score_kind": "fixture"},
                {
                    "lat": 11.5,
                    "lon": 21.25,
                    "score": 0.9,
                    "score_kind": "fixture",
                    "uncertainty": {"radius_m": 800},
                },
            ],
        }
        out, calls = self.run_with(result, {"max_candidates": 1})
        args, timeout = calls[0]
        self.assertIsNone(timeout)
        # 14:30 in Berlin winter time is 13:30 UTC.
        self.assertEqual(
            args[args.index("--start-utc") + 1], "2026-01-15T13:30:00+00:00"
        )
        self.assertIn("--online", args)
        self.assertEqual(args[args.index("--country") + 1], "DE")
        self.assertEqual(len(out["outputs"]), 1)
        best = out["outputs"][0]
        self.assertEqual(best["type"], "location")
        self.assertEqual(
            (best["data"]["latitude"], best["data"]["longitude"]), (11.5, 21.25)
        )
        self.assertEqual(best["source"]["uncertainty_radius_m"], 800)

    def test_inconclusive_result_explains_itself(self):
        result = {
            "schema_version": 1,
            "job_id": "job1",
            "status": "inconclusive",
            "reason_code": "insufficient_events",
            "message": "fixture reason",
            "coverage": {"limitations": ["fixture limitation"]},
        }
        out, _ = self.run_with(result, fail=True)
        self.assertEqual(out["outputs"][0]["type"], "error")
        self.assertIn("fixture reason", out["outputs"][0]["data"]["message"])
        self.assertEqual(out["warnings"], ["fixture limitation"])

    def test_datetime_node_and_window(self):
        moment = {
            "id": "d1",
            "type": "datetime",
            "data": {"date": "2026-07-01", "time": "08:00", "timezone": "UTC"},
        }
        _, calls = self.run_with(
            {"schema_version": 1, "job_id": "job1", "status": "inconclusive"},
            {
                "start_uncertainty_minutes": 30,
                "bounds": "13, 52, 14, 53",
            },
            [NODE, moment],
        )
        args = calls[0][0]
        self.assertEqual(args[args.index("--end-utc") + 1], "2026-07-01T08:30:00+00:00")
        self.assertEqual(
            args[args.index("--bounds") + 1 :][:4], ["13.0", "52.0", "14.0", "53.0"]
        )

    def test_invalid_input_is_rejected_before_running(self):
        for params in ({"bounds": "1, 2, 3"}, {"country": "XX"}):
            with self.subTest(params=params), self.assertRaises(ValueError):
                self.run_with({"status": "failed"}, params)
        for moment in (
            None,
            {**BERLIN_MOMENT, "data": {"date": "yesterday", "time": ""}},
            {
                **BERLIN_MOMENT,
                "data": {**BERLIN_MOMENT["data"], "timezone": "Mars/Base"},
            },
        ):
            with self.subTest(moment=moment), self.assertRaises(ValueError):
                self.run_with(
                    {"status": "failed"}, inputs=[NODE] + ([moment] if moment else [])
                )

    def test_start_time_comes_only_from_the_node(self):
        action = dopplergeist.PLUGIN["actions"][0]
        self.assertNotIn("recording_start", action["default_params"])
        self.assertEqual((action["min_inputs"], action["max_inputs"]), (2, 2))


@unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg absent locally")
class AudioUpload(unittest.TestCase):
    def test_audio_with_cover_art_is_audio_not_video(self):
        from core.video import probe_audio, probe_video

        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "tone.mp3"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=1",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=16x16:d=1",
                    "-map",
                    "0:a",
                    "-map",
                    "1:v",
                    "-frames:v",
                    "1",
                    "-c:v",
                    "mjpeg",
                    "-disposition:v",
                    "attached_pic",
                    str(target),
                ],
                check=True,
            )
            self.assertEqual(probe_video(target, required=False), {})
            audio = probe_audio(target)
            self.assertEqual(audio["mime"], "audio/mpeg")
            self.assertGreater(audio["duration"], 0)


if __name__ == "__main__":
    unittest.main()
