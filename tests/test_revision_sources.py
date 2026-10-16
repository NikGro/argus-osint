"""Offline integration coverage for queued revisions; no external account lookups."""

import copy
import io
import json
import tempfile
import threading
import time
import unittest
import hashlib
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
import server
from http_fixture import request as authenticated_request, await_project
from plugins import _research as research, _extra_sources as extra, location, metadata


class RevisionSources(unittest.TestCase):
    def node(self, kind="username"):
        return {
            "id": "input",
            "type": kind,
            "data": {
                "value": (
                    "fixture@example.invalid"
                    if kind == "email"
                    else "+12025550123" if kind == "phone" else "fixture"
                )
            },
        }

    def output(self, tool="a", value="https://example.invalid/profile", kind="url"):
        return {
            "type": kind,
            "label": "example · registration",
            "data": {"value": value},
            "source": {"tool": tool, "service": "example"},
            "relation": "Benutzername gefunden",
        }

    def project(self, kind="value", plugin="transform", action="code"):
        pid = uuid4().hex
        doc = {
            "nodes": [
                {
                    "id": "input",
                    "type": kind,
                    "label": "Fixture",
                    "data": (
                        {"locality": "Hamburg", "unit": "Suite 1"}
                        if kind == "location"
                        else {"value": "fixture"}
                    ),
                    "x": 0,
                    "y": 0,
                },
                {
                    "id": "actor",
                    "type": "actor",
                    "label": "Fixture actor",
                    "data": {"plugin": plugin, "action": action, "params": {}},
                    "x": 400,
                    "y": 0,
                },
            ],
            "edges": [{"id": "edge", "source": "input", "target": "actor"}],
            "groups": [],
            "runs": [],
        }
        server.validate(doc)
        with server.connect() as db:
            db.execute(
                "INSERT INTO projects VALUES (?,?,?,?,?)",
                (pid, "Revision fixture", json.dumps(doc), 1, server.now()),
            )
        return server.load_project(pid)

    def test_source_priority_and_disabled_sources(self):
        calls = []

        def source(name):
            return lambda *a: (calls.append(name) or {"outputs": [self.output(name)]})

        result = research.aggregate(
            "username",
            {n: source(n) for n in ("a", "b", "c")},
            [self.node()],
            {"source_order": ["c", "a", "b"], "use_a": False},
            {},
        )
        self.assertEqual(calls, ["c", "b"])
        self.assertEqual(len(result["outputs"]), 1)
        self.assertEqual(len(result["outputs"][0]["source"]["sources"]), 2)

    def test_failure_retains_other_source_and_logs(self):
        def failed(*a):
            raise ValueError("fixture failure")

        r = research.aggregate(
            "username",
            {
                "bad": failed,
                "ok": lambda *a: {"outputs": [self.output()], "log": "complete"},
            },
            [self.node()],
            {},
            {},
        )
        self.assertEqual(len(r["outputs"]), 1)
        self.assertIn("fixture failure", r["log"])
        self.assertIn("complete", r["log"])
        self.assertFalse(r["group_outputs"])
        self.assertEqual(r["outputs"][0]["type"], "profile")

    def test_all_fail_disabled_and_invalid_limits(self):
        def failed(*a):
            raise ValueError("offline")

        for params in (
            {"use_a": False},
            {"max_results": 0},
            {"run_timeout": 999},
            {"source_order": ["missing"]},
            {"use_a": "no"},
        ):
            with self.assertRaises(ValueError):
                research.aggregate("username", {"a": failed}, [self.node()], params, {})
        with self.assertRaisesRegex(ValueError, "Alle Recherchequellen"):
            research.aggregate("username", {"a": failed}, [self.node()], {}, {})

    def test_dedup_preserves_different_facts_queries_and_provenance(self):
        a = self.output("a", "https://EXAMPLE.invalid/p/?utm_source=a")
        b = self.output("b", "https://example.invalid/p")
        c = self.output("c", "https://example.invalid/p?user=2")
        values = [self.output("a", v, "value") for v in ("one", "two")]
        r = research.deduplicate([a, b, c, *values])
        self.assertEqual(len(r), 4)
        self.assertEqual(len(r[0]["source"]["sources"]), 2)
        self.assertEqual(a["source"]["tool"], "a")

    def test_user_scanner_and_blackbird_positive_parsers(self):
        rows = [
            {
                "site_name": "One",
                "status": "Found",
                "url": "https://example.invalid/p",
                "extra": {"name": "Fixture"},
                "media": {"photo": "https://example.invalid/p.jpg"},
            },
            {"site_name": "No", "status": "Not Found"},
            {"site_name": "Bad", "status": "Error", "reason": "rate limit"},
        ]
        r = extra.positive_outputs(rows, self.node(), "User Scanner", "username")
        self.assertEqual([o["type"] for o in r["outputs"]], ["url", "value", "url"])
        self.assertEqual(len(r["warnings"]), 1)
        r = extra.positive_outputs(
            [
                {
                    "name": "One",
                    "status": "FOUND",
                    "url": "https://example.invalid/private/check",
                    "metadata": [{"name": "masked", "value": "x***"}],
                }
            ],
            self.node("email"),
            "Blackbird",
            "email",
        )
        self.assertTrue(all(o["type"] == "value" for o in r["outputs"]))
        self.assertEqual(len(r["outputs"]), 2)

    def test_user_scanner_command_and_report(self):
        def run(command, *a, **k):
            return json.dumps([{"site_name": "Fixture", "status": "Registered"}]), ""

        with patch.object(extra, "bounded_run", side_effect=run) as cmd:
            r = extra.user_scanner("email", [self.node("email")], {}, {})
        self.assertEqual(len(r["outputs"]), 1)
        self.assertIn("-I", cmd.call_args.args[0])
        self.assertEqual(cmd.call_args.args[2]["kind"], "email")
        self.assertEqual(cmd.call_args.args[2]["value"], "fixture@example.invalid")

    def test_blackbird_uses_private_environment_reports_and_cleans_files(self):
        work = []

        def copy(src, dst):
            Path(dst).mkdir()
            (Path(dst) / "blackbird.py").write_text("")
            data = Path(dst) / "data"
            data.mkdir()
            [
                (data / name).write_text(json.dumps({"sites": [{"name": "Fixture"}]}))
                for name in ("email-data.json", "wmn-data.json", "wmn-metadata.json")
            ]
            work.append(Path(dst))

        def run(command, *a, **k):
            report = Path(k["cwd"]) / "results" / "fixture"
            report.mkdir(parents=True)
            (report / "report.json").write_text(
                json.dumps(
                    [
                        {
                            "name": "Fixture",
                            "status": "FOUND",
                            "url": "https://example.invalid/p",
                        }
                    ]
                )
            )
            return "offline", ""

        with (
            patch.object(extra.shutil, "copytree", side_effect=copy),
            patch.object(extra, "bounded_run", side_effect=run) as cmd,
        ):
            r = extra.blackbird("username", [self.node()], {}, {})
        self.assertEqual(len(r["outputs"]), 1)
        self.assertIn("blackbird-venv", cmd.call_args.args[0][0])
        self.assertFalse(work[0].exists())

    def test_ignorant_retains_unique_facts_and_unknowns(self):
        rows = [
            {
                "name": "A",
                "exists": True,
                "phoneNumber": "***123",
                "profile": "https://example.invalid/p",
            },
            {"name": "B", "exists": True, "rateLimit": True},
            {"name": "C", "exists": None},
        ]
        with patch.object(
            extra, "bounded_run", return_value=(json.dumps({"rows": rows}), "")
        ) as child:
            r = extra.ignorant([self.node("phone")], {}, {})
        self.assertEqual(len(r["outputs"]), 3)
        self.assertEqual(len(r["warnings"]), 2)
        self.assertEqual(child.call_args.args[2]["country_code"], "1")

    def test_catalog_three_bundles_all_enabled_and_global_source_order(self):
        ids = {p["id"]: p for p in server.MANAGER.installed()}
        self.assertTrue({"username", "email", "phone"} <= ids.keys())
        self.assertFalse({"profiles", "maigret", "holehe", "phoneinfoga"} & ids.keys())
        for key, count in [("username", 1), ("email", 1), ("phone", 2)]:
            defaults = ids[key]["actions"][0]["default_params"]
            self.assertEqual(
                sum(k.startswith("use_") and v is True for k, v in defaults.items()),
                count,
            )
            n = {
                "type": "actor",
                "data": {
                    "plugin": key,
                    "params": {
                        "source_order": ["custom"],
                        "use_blackbird": False,
                        "request_timeout": 10,
                    },
                },
            }
            server.canonicalize_node(n)
            self.assertEqual(n["data"]["params"], {"request_timeout": 10})

    def test_provider_singletons_and_flat_provider_results_create_groups(self):
        for outputs in (
            [{**self.output(), "group": "One"}],
            [self.output("a"), self.output("b", "https://example.invalid/2")],
        ):
            p = self.project()
            r = server.execute(
                p["id"], {"actor_id": "actor", "revision": 1, "outputs": outputs}
            )
            self.assertEqual(r["document"]["runs"][0]["status"], "completed")
            groups = r["document"]["groups"]
            self.assertEqual(sum(len(g["members"]) for g in groups), len(outputs))
            self.assertTrue(all(g["members"] for g in groups))

    def test_actor_lock_serializes_concurrent_projects(self):
        p = self.project("location", "location", "normalize")
        q = self.project("location", "location", "normalize")
        entered = threading.Event()
        release = threading.Event()
        active = 0
        peak = 0
        lock = threading.Lock()
        results = []

        def fake(*a):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            entered.set()
            release.wait(2)
            with lock:
                active -= 1
            return {"outputs": []}

        with patch.object(location, "run", side_effect=fake):
            one = threading.Thread(
                target=lambda: results.append(
                    server.execute(p["id"], {"actor_id": "actor", "revision": 1})
                )
            )
            two = threading.Thread(
                target=lambda: results.append(
                    server.execute(q["id"], {"actor_id": "actor", "revision": 1})
                )
            )
            one.start()
            self.assertTrue(entered.wait(2))
            two.start()
            time.sleep(0.04)
            self.assertEqual(peak, 1)
            release.set()
            one.join(3)
            two.join(3)
        self.assertEqual(len(results), 2)
        self.assertEqual(peak, 1)

    def test_location_new_result_original_unchanged_and_selection_target(self):
        p = self.project("location", "location", "normalize")
        feature = lambda city: {
            "properties": {"city": city, "countrycode": "DE", "country": "Deutschland"},
            "geometry": {"coordinates": [10, 53]},
        }
        with patch.object(
            location,
            "request",
            return_value={"features": [feature("Hamburg"), feature("Other")]},
        ):
            r = server.execute(p["id"], {"actor_id": "actor", "revision": 1})
        self.assertEqual(r["document"]["nodes"][0], p["document"]["nodes"][0])
        choice = r["document"]["runs"][0]["candidates"][0]
        self.assertNotEqual(choice["input_id"], "input")
        final = server.choose_location(
            p["id"],
            {
                "revision": r["revision"],
                "run_id": r["document"]["runs"][0]["id"],
                "input_id": choice["input_id"],
                "index": 0,
            },
        )
        self.assertEqual(
            next(
                n
                for n in reversed(final["document"]["nodes"])
                if n["type"] == "location"
            )["data"]["locality"],
            "Hamburg",
        )
        self.assertEqual(final["document"]["nodes"][0], p["document"]["nodes"][0])

    def test_location_source_order_cache_and_attribution(self):
        self.assertEqual(
            location.query(
                {
                    "latitude": 53.5,
                    "longitude": 10,
                    "country": "Deutschland",
                    "formatted_address": "Deutschland",
                }
            )[0],
            "reverse",
        )
        features = {
            "features": [
                {"properties": {"city": "Fixture"}, "geometry": {"coordinates": [1, 2]}}
            ]
        }
        with patch.object(location, "request", return_value=features) as request:
            r = location.run(
                "normalize",
                [{"id": "x", "data": {"locality": "Fixture"}}],
                {
                    "source_order": ["nominatim", "photon"],
                    "nominatim_url": "https://nominatim.example.invalid",
                },
                {},
            )
        self.assertEqual(
            [call.args[2] for call in request.call_args_list], ["nominatim", "photon"]
        )
        self.assertEqual(len(r["outputs"]), 1)
        self.assertIn("OpenStreetMap", str(r))
        location._cache.clear()

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

            def read(self, *a):
                return b'{"features":[]}'

        with (
            patch.object(
                location.urllib.request, "urlopen", return_value=Response()
            ) as urlopen,
            patch.object(location.time, "sleep"),
        ):
            location.request("api", {"q": "fixture"}, "photon")
            location.request("api", {"q": "fixture"}, "photon")
        self.assertEqual(urlopen.call_count, 1)
        location._cache.clear()

    def test_plugin_display_defaults_saved_without_changing_existing_nodes(self):
        p = self.project()
        old = copy.deepcopy(p["document"])
        pid = "data_url"
        prior = server.MANAGER.state().get(pid, {}).get("settings", {})
        try:
            server.MANAGER.configure(
                pid, {"nodes": {"url": {"display_defaults": {"openButton": True}}}}
            )
            self.assertEqual(server.load_project(p["id"])["document"], old)
            self.assertTrue(
                server.settings()["node_display_defaults"]["url"]["openButton"]
            )
        finally:
            server.MANAGER.configure(pid, prior)

    def test_exiftool_actual_pdf_and_image_metadata_are_individual_and_read_only(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "photo.png"
            pdf = Path(folder) / "file.pdf"
            Image.new("RGB", (7, 9)).save(image)
            Image.new("RGB", (7, 9)).save(pdf, format="PDF", title="Fixture PDF")
            before = {p: p.read_bytes() for p in (image, pdf)}
            inputs = [
                {
                    "id": name,
                    "type": kind,
                    "label": "Same filename",
                    "data": {"filename": "same", "file_id": name},
                }
                for name, kind in [("image", "image"), ("pdf", "file")]
            ]
            result = metadata.run(
                "extract",
                inputs,
                {},
                {"resolve_file": lambda fid: image if fid == "image" else pdf},
            )
            self.assertTrue(
                any(
                    "Title" in o["label"] and o["data"]["value"] == "Fixture PDF"
                    for o in result["outputs"]
                )
            )
            self.assertEqual(
                {o["group_id"] for o in result["outputs"]}, {"image", "pdf"}
            )
            self.assertTrue(all(set(o["data"]) == {"value"} for o in result["outputs"]))
            self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_metadata_list_elements_and_original_file_names(self):
        with patch.object(
            metadata,
            "bounded_run",
            return_value=(
                json.dumps(
                    [
                        {
                            "SourceFile": "internal",
                            "System:Directory": "private",
                            "EXIF:Keywords": ["one", "two"],
                            "System:FileName": "internal-id",
                        }
                    ]
                ),
                "",
            ),
        ):
            r = metadata.run(
                "extract",
                [
                    {
                        "id": "x",
                        "label": "Original",
                        "data": {"file_id": "x", "filename": "photo.jpg"},
                    }
                ],
                {},
                {"resolve_file": lambda id: "/tmp/fixture"},
            )
        values = {o["label"]: o["data"]["value"] for o in r["outputs"]}
        self.assertEqual(values["EXIF:Keywords [1]"], "one")
        self.assertEqual(values["EXIF:Keywords [2]"], "two")
        self.assertNotIn("System:Directory", values)
        self.assertEqual(values["System:FileName"], "photo.jpg")

    def test_runtime_input_requests_and_new_file_contract(self):
        p = self.project("location", "location", "normalize")
        with patch.object(
            location,
            "run",
            return_value={
                "outputs": [],
                "input_request": {"fields": [{"key": "answer"}]},
            },
        ):
            r = server.execute(p["id"], {"actor_id": "actor", "revision": 1})
        self.assertEqual(r["document"]["runs"][0]["status"], "needs_input")
        self.assertEqual(r["document"]["nodes"][1]["data"]["status"], "needs_input")
        server.MANAGER.validate_descriptor(
            {
                "name": "File",
                "actions": [{"id": "a", "name": "Read", "inputs": ["file"]}],
            }
        )

    @unittest.skipUnless(
        Path("/run/argus/worker.sock").exists(),
        "Requires enabled namespace worker runtime",
    )
    def test_community_template_hash_and_file_context(self):
        folder = server.ROOT / "examples" / "community-plugin"
        manifest = json.loads((folder / "argus-repository.json").read_text())
        source = folder / "template.py"
        self.assertEqual(
            hashlib.sha256(source.read_bytes()).hexdigest(),
            manifest["plugins"][0]["sha256"],
        )
        from plugin_manager import CommunityPlugin

        plugin = CommunityPlugin(manifest["plugins"][0], source)
        r = plugin.run(
            "summarize",
            [
                {
                    "id": "x",
                    "label": "Fixture",
                    "type": "value",
                    "data": {"value": "hello"},
                }
            ],
            {"prefix": "Test"},
            {},
        )
        self.assertEqual(r["outputs"][0]["data"]["value"], "hello")
        self.assertIn("input_prompt", manifest["plugins"][0]["actions"][0])


class UploadAndDocumentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = "http://127.0.0.1:" + str(cls.http.server_port)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def upload(self, content, name):
        import urllib.request
        from urllib.parse import quote

        request = authenticated_request(
            self.base + "/api/files",
            data=content,
            headers={"X-File-Name": quote(name, safe="")},
        )
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def test_file_and_photo_upload_detection_safe_download_and_limits(self):
        import urllib.request
        import urllib.error
        from PIL import Image

        image = io.BytesIO()
        Image.new("RGB", (3, 4)).save(image, format="PNG")
        photo = self.upload(image.getvalue(), "photo.png")
        self.assertTrue(photo["is_image"])
        self.assertEqual(photo["mime"], "image/png")
        active = self.upload(
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
            "file name.svg",
        )
        self.assertFalse(active["is_image"])
        with urllib.request.urlopen(
            authenticated_request(self.base + "/api/files/" + active["file_id"])
        ) as response:
            self.assertIn("attachment", response.headers["Content-Disposition"])
            self.assertIn("file%20name.svg", response.headers["Content-Disposition"])
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.upload(b"", "empty")
        self.assertEqual(error.exception.code, 400)

    def test_pdf_upload_is_inline_and_preserves_uploaded_bytes(self):
        import urllib.request
        from PIL import Image

        pdf = io.BytesIO()
        Image.new("RGB", (5, 5)).save(pdf, format="PDF", title="Fixture")
        uploaded = self.upload(pdf.getvalue(), "fixture.pdf")
        self.assertEqual(uploaded["mime"], "application/pdf")
        with urllib.request.urlopen(
            authenticated_request(self.base + "/api/files/" + uploaded["file_id"])
        ) as response:
            self.assertEqual(response.read(), pdf.getvalue())
            self.assertIsNone(response.headers.get("Content-Disposition"))

    def test_office_and_audio_fixtures_metadata(self):
        import zipfile
        import wave

        with tempfile.TemporaryDirectory() as folder:
            office = Path(folder) / "fixture.docx"
            audio = Path(folder) / "fixture.wav"
            with zipfile.ZipFile(office, "w") as doc:
                doc.writestr(
                    "[Content_Types].xml",
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
                )
                doc.writestr(
                    "_rels/.rels",
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
                )
                doc.writestr(
                    "docProps/core.xml",
                    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture Office</dc:title></cp:coreProperties>',
                )
                doc.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
                )
            with wave.open(str(audio), "wb") as file:
                file.setnchannels(1)
                file.setsampwidth(2)
                file.setframerate(8000)
                file.writeframes(b"\x00\x00" * 800)
            inputs = [
                {
                    "id": "o",
                    "label": "Office",
                    "data": {"file_id": "o", "filename": "fixture.docx"},
                },
                {
                    "id": "a",
                    "label": "Audio",
                    "data": {"file_id": "a", "filename": "fixture.wav"},
                },
            ]
            result = metadata.run(
                "extract",
                inputs,
                {},
                {"resolve_file": lambda fid: office if fid == "o" else audio},
            )
            self.assertTrue(
                any(o["data"]["value"] == "Fixture Office" for o in result["outputs"]),
                json.dumps(result, ensure_ascii=False),
            )
            self.assertTrue(
                any(
                    "SampleRate" in o["label"] and o["data"]["value"] == "8000"
                    for o in result["outputs"]
                )
            )


class FrontendAssetIntegrityTests(unittest.TestCase):
    def test_shipped_bundle_matches_authored_module_digest(self):
        import hashlib

        root = server.ROOT
        manifest = json.loads((root / "static" / "build-manifest.json").read_text())
        for relative, digest in manifest["sources"].items():
            self.assertEqual(
                hashlib.sha256((root / relative).read_bytes()).hexdigest(),
                digest,
                relative,
            )
        self.assertEqual(
            hashlib.sha256((root / "static/app.js").read_bytes()).hexdigest(),
            manifest["bundle_sha256"],
        )
