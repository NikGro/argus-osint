"""Offline regression cases. No face model, Instagram account or OSINT service is invoked."""

import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode

from PIL import Image
from core.actors import ActorService
from core.errors import AppError
from plugins import deepface_tool, instagram, _instagram_runner, _toutatis_runner
from plugins._deepface_images import working_image, overlay


class DeepFaceImages(unittest.TestCase):
    def test_work_copy_and_overlay_leave_original_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.png"
            Image.new("RGB", (600, 400), "#203045").save(path)
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                working_image(path, False, max_pixels=60_000)
            image, metadata = working_image(path, True, max_pixels=60_000)
            self.assertLessEqual(image.width * image.height, 60_000)
            self.assertTrue(metadata["resized"])
            self.assertEqual(metadata["original_size"], [600, 400])
            area = {"x": 20, "y": 30, "w": 100, "h": 120, "left_eye": [50, 60]}
            destination = Path(directory) / "overlay.jpg"
            overlay(
                image,
                [area],
                area,
                {"verified": False, "distance": 0.9, "threshold": 0.4},
                metadata,
                destination,
            )
            with Image.open(destination) as annotated:
                self.assertNotEqual(
                    annotated.getpixel((20, 30)), image.getpixel((20, 30))
                )
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

    def test_artifacts_become_separate_image_nodes_with_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            inputs = [
                {"id": str(i), "type": "image", "data": {"file_id": str(i)}}
                for i in range(2)
            ]

            def process(command, timeout, payload, extra_env):
                annotations = []
                for i in range(2):
                    filename = f"overlay-{i + 1}.jpg"
                    Image.new("RGB", (40, 30), "blue").save(
                        Path(payload["artifact_dir"]) / filename
                    )
                    annotations.append(
                        {"image_index": i, "file": filename, "resized": False}
                    )
                return (
                    json.dumps(
                        {
                            "verified": True,
                            "distance": 0.1,
                            "threshold": 0.4,
                            "annotations": annotations,
                        }
                    ),
                    "",
                )

            for image_id in ("0", "1"):
                Image.new("RGB", (40, 30), "gray").save(Path(directory) / image_id, format="PNG")
            stored = []

            def store(data, name):
                with Image.open(io.BytesIO(data)) as image:
                    self.assertEqual(image.size, (40, 30))
                stored.append(name)
                return {"file_id": str(len(stored)) * 32, "filename": name}

            with patch.object(deepface_tool, "bounded_run", side_effect=process):
                result = deepface_tool.run(
                    "verify",
                    inputs,
                    {},
                    {
                        "resolve_file": lambda fid: Path(directory) / fid,
                        "credential_dir": directory,
                        "store_file": store,
                    },
                )
            images = [item for item in result["outputs"] if item["type"] == "image"]
            self.assertEqual(len(images), 2)
            self.assertEqual([image["source_input"] for image in images], ["0", "1"])
            self.assertEqual(len(stored), 2)
            with patch.object(deepface_tool, "bounded_run", side_effect=process):
                partial = deepface_tool.run(
                    "verify",
                    inputs,
                    {},
                    {
                        "resolve_file": lambda fid: Path(directory) / fid,
                        "credential_dir": directory,
                        "store_file": Mock(side_effect=OSError("fixture")),
                    },
                )
            self.assertEqual(len(partial["outputs"]), 3)
            self.assertTrue(partial["warnings"])


class FailureNodes(unittest.TestCase):
    def execute_failure(self, failure):
        doc = {
            "nodes": [
                {
                    "id": "image",
                    "type": "image",
                    "label": "Dummy",
                    "data": {},
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "tool",
                    "type": "actor",
                    "label": "DeepFace",
                    "data": {"plugin": "deepface", "action": "verify", "params": {}},
                    "x": 300,
                    "y": 0,
                },
            ],
            "edges": [{"id": "in", "source": "image", "target": "tool"}],
            "groups": [],
            "runs": [],
        }
        project = {"id": "fixture", "title": "Fixture", "revision": 1, "document": doc}
        manager = Mock()
        manager.module.return_value = SimpleNamespace(
            PLUGIN=deepface_tool.PLUGIN, run=Mock(side_effect=failure)
        )
        manager.installed.return_value = []
        manager.action_params.return_value = {"login_password": "hidden-password"}
        manager.secret_fields.return_value = ["login_password"]
        manager.node_defaults.return_value = {}

        def save(pid, title, document, revision):
            return {**project, "document": document}

        service = ActorService(
            manager,
            lambda pid: copy.deepcopy(project),
            save,
            lambda node: (node.get("x", 0), node.get("y", 0), 210, 76),
            lambda: {"node_display_defaults": {}},
            lambda fid: None,
            lambda: "2026-10-16T12:00:00Z",
            threading.Lock(),
            Path("unused"),
        )
        return service.execute("fixture", {"actor_id": "tool", "revision": 1})[
            "document"
        ]

    def test_failure_is_connected_and_redacted(self):
        document = self.execute_failure(ValueError("model failed hidden-password"))
        errors = [node for node in document["nodes"] if node["type"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertNotIn("hidden-password", json.dumps(document))
        self.assertEqual(document["runs"][-1]["status"], "failed")
        self.assertEqual(document["runs"][-1]["outputs"], [errors[0]["id"]])
        self.assertTrue(
            any(
                edge["source"] == "tool" and edge["target"] == errors[0]["id"]
                for edge in document["edges"]
            )
        )

    def test_cancellation_does_not_create_failure_evidence(self):
        document = self.execute_failure(AppError("actor_cancelled", 409))
        self.assertEqual(len(document["nodes"]), 2)
        self.assertEqual(document["runs"][-1]["status"], "cancelled")


class ToutatisLookup(unittest.TestCase):
    def test_upstream_calls_are_bounded_and_recovery_is_disabled(self):
        calls = []
        http = SimpleNamespace(
            exceptions=SimpleNamespace(RequestException=RuntimeError)
        )

        def request(url, **kwargs):
            calls.append((url, kwargs))
            return SimpleNamespace(raise_for_status=lambda: None)

        http.get = http.post = request
        core = SimpleNamespace(requests=object())

        def info(*args, **kwargs):
            core.requests.get("https://i.instagram.com/api/v1/users/123/info/")
            return {"user": {"public_email": "dummy@example.invalid"}}

        def lookup(name):
            core.requests.post(
                "https://i.instagram.com/api/v1/users/lookup/",
                data=urlencode(
                    {
                        "signed_body": "SIGNATURE."
                        + json.dumps({"q": name, "skip_recovery": "1"})
                    }
                ),
            )
            return {
                "user": {
                    "obfuscated_email": "d***@example.invalid",
                    "obfuscated_phone": "+49 *** 12",
                }
            }

        core.getInfo, core.advanced_lookup = info, lookup
        result = _toutatis_runner.collect(
            {
                "username": "dummy",
                "user_id": "123",
                "sessionid": "private-session",
                "profile": True,
                "recovery": True,
            },
            core,
            http,
        )
        self.assertEqual(result["recovery"]["obfuscated_phone"], "+49 *** 12")
        self.assertEqual(len(calls), 2)
        self.assertTrue(
            all(
                kwargs["timeout"] <= 10 and not kwargs["allow_redirects"]
                for _, kwargs in calls
            )
        )
        self.assertNotIn("private-session", json.dumps(result))

        def forbidden(name):
            return core.requests.post(
                "https://i.instagram.com/api/v1/accounts/send_recovery_flow_email/",
                data="",
            )

        core.advanced_lookup = forbidden
        result = _toutatis_runner.collect(
            {"username": "dummy", "recovery": True}, core, http
        )
        self.assertEqual(len(calls), 2)
        self.assertTrue(result["warnings"])

    def test_instagram_maps_masked_values_without_normalizing_them_as_full_contacts(
        self,
    ):
        fake_client = SimpleNamespace(
            logger=SimpleNamespace(disabled=False),
            user_info_by_username=lambda name: {"username": name, "pk": "123"},
        )
        config = {
            **instagram.DEFAULTS,
            **{"include_" + key: key == "recovery" for key in instagram.SECTIONS},
        }
        payload = {
            "username": "dummy",
            "user_id": "",
            "settings": config,
            "node_budget": 100,
        }
        response = {
            "profile": {},
            "recovery": {
                "obfuscated_email": "d***@example.invalid",
                "obfuscated_phone": "+49 *** 12",
            },
            "warnings": [],
        }
        with tempfile.TemporaryDirectory() as directory:
            payload.update(
                checkpoint=str(Path(directory) / "progress.json"),
                session_output=str(Path(directory) / "session.json"),
            )
            with (
                patch.dict(
                    "sys.modules",
                    {
                        "instagrapi": SimpleNamespace(Client=lambda: fake_client),
                        "requests": SimpleNamespace(),
                    },
                ),
                patch.object(
                    _instagram_runner.subprocess,
                    "run",
                    return_value=SimpleNamespace(stdout=json.dumps(response)),
                ) as process,
            ):
                result = _instagram_runner.run(payload)
            self.assertEqual(
                [item["type"] for item in result["outputs"]], ["value", "value"]
            )
            self.assertTrue(all(item["source"]["masked"] for item in result["outputs"]))
            self.assertEqual(result["outputs"][1]["data"]["value"], "+49 *** 12")
            self.assertEqual(process.call_count, 1)


if __name__ == "__main__":
    unittest.main()
