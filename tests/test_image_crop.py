"""Synthetic photos only: crop bounds, orientation, transparency and originals."""

import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from PIL import Image
from plugins import image_crop
from core.crop import crop_box


class PhotoCrop(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "synthetic.png"
        Image.new("RGBA", (8, 6), (20, 40, 60, 100)).save(self.path)
        self.original = self.path.read_bytes()
        self.saved = []
        self.node = {"id": "synthetic", "type": "image", "data": {"file_id": "fixture"}}
        self.context = {"resolve_file": lambda _: self.path, "store_file": self.store}

    def store(self, data, name):
        self.saved.append((data, name))
        return {"file_id": "new-copy"}

    def test_cropped_copy_preserves_original_alpha_and_provenance(self):
        result = image_crop.run(
            "crop",
            [self.node],
            {
                "crop_enabled": True,
                "crop_x": 0.25,
                "crop_y": 0.5,
                "crop_width": 0.5,
                "crop_height": 0.5,
            },
            self.context,
        )
        self.assertEqual(self.path.read_bytes(), self.original)
        with Image.open(io.BytesIO(self.saved[0][0])) as image:
            self.assertEqual((image.size, image.mode), ((4, 3), "RGBA"))
            self.assertEqual(image.getpixel((0, 0)), (20, 40, 60, 100))
        output = result["outputs"][0]
        self.assertEqual(output["source_input"], self.node["id"])
        self.assertEqual(output["source"]["crop_pixels"], (2, 3, 4, 3))
        self.assertEqual(output["data"]["file_id"], "new-copy")

    def test_exif_orientation_is_applied_before_rectangle(self):
        photo = Image.new("RGB", (8, 6), "#123456")
        exif = Image.Exif()
        exif[274] = 6
        photo.save(self.path, format="JPEG", exif=exif)
        image_crop.run("crop", [self.node], {"crop_enabled": True}, self.context)
        with Image.open(io.BytesIO(self.saved[0][0])) as image:
            self.assertEqual(image.size, (6, 8))

    def test_invalid_and_out_of_bounds_rectangles_do_not_store_files(self):
        for values in [
            {"crop_width": 0},
            {"crop_x": 0.9, "crop_width": 0.5},
            {"crop_height": float("nan")},
            {"crop_x": True},
        ]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                image_crop.run(
                    "crop", [self.node], {"crop_enabled": True, **values}, self.context
                )
        self.assertEqual(self.saved, [])

    def test_oversized_input_is_rejected_without_allocating_large_image(self):
        fake = MagicMock()
        fake.__enter__.return_value = fake
        fake.width, fake.height = 8001, 5000
        with (
            patch.object(image_crop.Image, "open", return_value=fake),
            self.assertRaises(ValueError),
        ):
            image_crop.run("crop", [self.node], {}, self.context)
        self.assertEqual(self.saved, [])

    def test_video_crop_has_even_pixel_coordinates(self):
        left, top, width, height = crop_box(
            {
                "crop_enabled": True,
                "crop_x": 0.1,
                "crop_y": 0.1,
                "crop_width": 0.8,
                "crop_height": 0.8,
            },
            321,
            241,
            even=True,
        )
        self.assertTrue(all(value % 2 == 0 for value in (left, top, width, height)))
