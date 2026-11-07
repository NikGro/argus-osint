"""Facts from research and metadata become the matching data node types."""

import unittest

from plugins._research import fact_outputs
from plugins._typed import typed_fact


class TypedFacts(unittest.TestCase):
    def test_types_by_field_and_value(self):
        cases = {
            ("File:FileModifyDate", "2024:05:01 12:00:00+02:00"): (
                "datetime",
                {"date": "2024-05-01", "time": "10:00", "timezone": "UTC"},
            ),
            ("created_at", "2019-03-04T10:11:12Z"): (
                "datetime",
                {"date": "2019-03-04", "time": "10:11:12", "timezone": "UTC"},
            ),
            ("Instagram.username", "max.mustermann"): (
                "username",
                {"value": "max.mustermann"},
            ),
            ("profile.screen_name", "@abc"): ("username", {"value": "abc"}),
            ("contact.email", "a@b.de"): ("email", {"value": "a@b.de"}),
            ("phone", "+49 170 1234567"): ("phone", {"value": "+49 170 1234567"}),
            ("website", "https://example.org"): (
                "url",
                {"value": "https://example.org"},
            ),
        }
        for (key, value), expected in cases.items():
            with self.subTest(key=key):
                self.assertEqual(typed_fact(key, value), expected)

    def test_ambiguous_values_stay_custom_values(self):
        for key, value in (
            ("EXIF:ExposureTime", 0.004),
            ("GPSTimeStamp", "12:30:00"),
            ("XMP:ModifyDate", "0000:00:00 00:00:00"),
            ("username", "two words"),
            ("bio", "Hello"),
        ):
            with self.subTest(key=key):
                self.assertEqual(typed_fact(key, value)[0], "value")

    def test_research_facts_use_node_types(self):
        out = fact_outputs({"username": "neo", "bio": "x"}, "Profile", {})
        self.assertEqual(
            [(o["type"], o["data"]) for o in out],
            [("username", {"value": "neo"}), ("value", {"value": "x"})],
        )


if __name__ == "__main__":
    unittest.main()
