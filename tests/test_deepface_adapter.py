"""No inference: validation and result mapping use a stubbed subprocess response."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from plugins import deepface_tool as tool
from core.plugin_contract import validate_descriptor


class DeepFaceAdapter(unittest.TestCase):
    def test_descriptor_and_pair_contract(self):
        validate_descriptor(tool.PLUGIN)
        for inputs in ([], [{"type": "image"}], [{"type": "image"}, {"type": "url"}]):
            with (
                self.subTest(inputs=inputs),
                self.assertRaises(ValueError),
                patch.object(tool, "bounded_run") as process,
            ):
                tool.run("verify", inputs, {}, {})
            process.assert_not_called()

    def test_bad_options_rejected_before_execution(self):
        for params in (
            {"model_name": "unknown"},
            {"threshold": float("nan")},
            {"align": "true"},
            {"run_timeout": 1000},
            {"expand_percentage": 0.5},
        ):
            with self.subTest(params=params), self.assertRaises(ValueError):
                tool.validated(params)

    def test_uploaded_pair_mapping_and_score_output_without_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            inputs = [
                {"id": "a", "type": "image", "data": {"file_id": "first"}},
                {"id": "b", "type": "image", "data": {"file_id": "second"}},
            ]
            from PIL import Image
            for name in ("first", "second"):
                Image.new("RGB", (20, 20), "gray").save(root / name, format="PNG")
            payloads = []

            def stub(command, timeout, payload, extra_env):
                payloads.append(payload)
                self.assertEqual(
                    payload["paths"], [str(root / "first"), str(root / "second")]
                )
                self.assertTrue(extra_env["DEEPFACE_HOME"].endswith("deepface-cache"))
                return (
                    json.dumps(
                        {
                            "verified": False,
                            "distance": 0.9,
                            "threshold": 0.5,
                            "confidence": 20,
                        }
                    ),
                    "",
                )

            with patch.object(tool, "bounded_run", side_effect=stub):
                result = tool.run(
                    "verify",
                    inputs,
                    {"custom_threshold": True, "threshold": 0.5},
                    {"resolve_file": lambda fid: root / fid, "credential_dir": root},
                )
            self.assertEqual(payloads[0]["params"]["threshold"], 0.5)
            self.assertEqual(
                [o["data"]["value"] for o in result["outputs"]],
                ["No match", "0.9", "0.5", "20"],
            )
            self.assertEqual(result["outputs"][0]["source"]["input_ids"], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
