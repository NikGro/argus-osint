import io
import json
import shutil
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from core.http_server import Handler, ApplicationServer
from runtime_fixture import app
from http_fixture import request as authenticated_request, await_project
from plugins import location, metadata
from PIL import Image


class LocationTests(unittest.TestCase):

    def test_aliases_unicode_and_coordinates(self):
        result = location.normalize(
            {
                "province": "Québec",
                "city": "Montréal",
                "country_code": "ca",
                "lat": "45.5",
                "lon": "-73.5",
                "local_delivery_area": "X",
            }
        )
        self.assertEqual(result["admin_area_1"], "Québec")
        self.assertEqual(result["country_code"], "CA")
        self.assertEqual(result["longitude"], -73.5)
        self.assertEqual(result["extra"]["local_delivery_area"], "X")

    def test_invalid_and_partial_coordinates(self):
        for data in (
            {"latitude": 0},
            {"latitude": 91, "longitude": 0},
            {"latitude": "nan", "longitude": 0},
        ):
            with self.assertRaises(ValueError):
                location.normalize(data)

    def test_representative_point_is_not_exact_address(self):
        feature = {
            "properties": {
                "geocoding": {
                    "type": "city",
                    "label": "Hamburg, Deutschland",
                    "city": "Hamburg",
                    "country_code": "de",
                }
            },
            "geometry": {"coordinates": [10, 53.55]},
        }
        result = location.candidate(feature, {"original_input": "Hamburg"}, False)
        self.assertEqual(result["coordinate_role"], "provider_representative_point")
        self.assertNotIn("house_number", result)
        self.assertEqual(result["granularity"], "city")

    def test_reverse_preserves_original_point_and_conflicts(self):
        feature = {
            "properties": {"geocoding": {"type": "street", "city": "Berlin"}},
            "geometry": {"coordinates": [13.4, 52.5]},
        }
        result = location.candidate(
            feature, {"latitude": 53.5, "longitude": 10, "locality": "Hamburg"}, True
        )
        self.assertEqual(result["latitude"], 53.5)
        self.assertIn("locality", result["conflicts"])

    def test_multiple_candidates_and_no_enrichment(self):
        node = {"id": "n", "data": {"original_input": "Springfield"}}
        features = [
            {
                "properties": {"geocoding": {"city": name}},
                "geometry": {"coordinates": [0, 0]},
            }
            for name in ["A", "B"]
        ]
        with patch.object(location, "request", return_value={"features": features}):
            result = location.run("normalize", [node], {}, {})
        self.assertEqual(len(result["outputs"]), 1)
        self.assertEqual(len(result["candidates"][0]["options"]), 2)
        with patch.object(
            location, "request", side_effect=AssertionError("Must not query")
        ):
            result = location.run(
                "normalize",
                [node],
                {},
                {
                    "settings": {
                        "geocoder_enabled": False,
                        "geocoder_provider": "photon",
                    }
                },
            )
        self.assertEqual(len(result["outputs"]), 1)
        self.assertEqual(result["outputs"][0]["source_input"], "n")
        self.assertEqual(result.get("updates", []), [])


class APITests(unittest.TestCase):

    def setUp(self):
        self.geocoder = patch.object(location, "request", return_value=None)
        self.geocoder.start()

    def tearDown(self):
        self.geocoder.stop()

    @classmethod
    def setUpClass(cls):
        cls.httpd = ApplicationServer(("127.0.0.1", 0), Handler)
        cls.base = "http://127.0.0.1:" + str(cls.httpd.server_address[1])
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def call(self, path, body=None, headers=None, raw=None):
        payload = (
            raw
            if raw is not None
            else json.dumps(body).encode() if body is not None else None
        )
        req = authenticated_request(
            self.base + path,
            data=payload,
            headers=headers or {"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as response:
            result = json.load(response)
            return await_project(self.base, result) if path.endswith("/run") else result

    def project(self, kind="location", plugin="location", action="normalize"):
        doc = {
            "nodes": [
                {
                    "id": "n",
                    "type": kind,
                    "label": "<script>alert(1)</script>",
                    "data": {"original_input": "Hamburg"},
                    "x": 0,
                    "y": 0,
                    "report": True,
                },
                {
                    "id": "a",
                    "type": "actor",
                    "label": "Actor",
                    "data": {
                        "plugin": plugin,
                        "action": action,
                        "params": {"enrich": False},
                    },
                    "x": 300,
                    "y": 0,
                },
            ],
            "edges": [{"id": "e", "source": "n", "target": "a"}],
            "groups": [],
            "runs": [],
        }
        return self.call("/api/projects", {"title": "Test", "document": doc})

    def test_persistence_run_and_optimistic_conflict(self):
        p = self.project()
        result = self.call(
            "/api/projects/" + p["id"] + "/run",
            {
                "request_key": "fixture-" + __import__("uuid").uuid4().hex,
                "actor_id": "a",
                "revision": p["revision"],
            },
        )
        self.assertEqual(result["revision"], 2)
        self.assertEqual(
            len([n for n in result["document"]["nodes"] if n["type"] != "error"]), 3
        )
        self.assertEqual(result["document"]["runs"][0]["status"], "completed")
        self.assertEqual(
            app.PROJECTS.history.page(p["id"])["runs"][0]["input_snapshot"][0]["data"][
                "original_input"
            ],
            "Hamburg",
        )
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call(
                "/api/projects/" + p["id"],
                {
                    "title": p["title"],
                    "document": p["document"],
                    "revision": p["revision"],
                },
            )
        self.assertEqual(error.exception.code, 409)

    def test_invalid_transform_rolls_back_and_records_failure(self):
        p = self.project("value", "transform", "code")
        outputs = [
            {"type": "value", "label": "Valid", "data": {}},
            {"type": "invalid", "data": {}},
        ]
        result = self.call(
            "/api/projects/" + p["id"] + "/run",
            {
                "request_key": "fixture-" + __import__("uuid").uuid4().hex,
                "actor_id": "a",
                "revision": p["revision"],
                "outputs": outputs,
            },
        )
        self.assertEqual(len(result["document"]["nodes"]), 3)
        self.assertEqual(result["document"]["nodes"][-1]["type"], "error")
        self.assertEqual(result["document"]["runs"][0]["status"], "failed")

    def test_language_packs_are_served_as_json(self):
        for code in ("de", "en"):
            pack = self.call("/locales/" + code + ".json")
            self.assertEqual(pack["_meta"]["code"], code)
            self.assertIn("Einstellungen", pack["messages"])

    def test_report_escapes_input(self):
        p = self.project()
        with urllib.request.urlopen(
            authenticated_request(self.base + "/api/projects/" + p["id"] + "/report")
        ) as response:
            report = response.read().decode()
        self.assertIn("&lt;script&gt;", report)
        self.assertNotIn("<script>alert(1)</script>", report)

    def test_cross_origin_writes_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call(
                "/api/projects", {"title": "x"}, {"Origin": "https://foreign.example"}
            )
        self.assertEqual(error.exception.code, 403)

    @unittest.skipUnless(shutil.which("exiftool"), "ExifTool executable absent locally")
    def test_image_upload_and_metadata(self):
        img = Image.new("RGB", (4, 4), "red")
        exif = Image.Exif()
        exif[306] = "2026:10:13 10:00:00"
        data = io.BytesIO()
        img.save(data, format="JPEG", exif=exif)
        uploaded = self.call("/api/files", raw=data.getvalue())
        result = metadata.run(
            "extract",
            [{"id": "image", "data": uploaded}],
            {},
            {"resolve_file": app.resolve_file},
        )
        self.assertEqual(
            next(
                (
                    o["data"]["value"]
                    for o in result["outputs"]
                    if o["label"].endswith("ImageWidth")
                )
            ),
            "4",
        )
        self.assertTrue(all((o["type"] == "value" for o in result["outputs"])))
        self.assertTrue(
            any(
                (
                    o["label"].endswith("ModifyDate")
                    and o["data"] == {"value": "2026:10:13 10:00:00"}
                    for o in result["outputs"]
                )
            )
        )
        self.assertTrue(all((set(o["data"]) == {"value"} for o in result["outputs"])))
        with self.assertRaises(ValueError):
            app.resolve_file("../../server.py")


if __name__ == "__main__":
    unittest.main()
