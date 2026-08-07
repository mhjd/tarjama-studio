from __future__ import annotations

import unittest

from server.main import parse_timecode


class TimestampParsingTests(unittest.TestCase):
    def test_hour_padding_does_not_change_the_value(self) -> None:
        self.assertEqual(parse_timecode("1:00:01.120"), parse_timecode("01:00:01.120"))
        self.assertEqual(parse_timecode("18:45.940"), 1125.94)

    def test_total_minutes_and_out_of_range_minutes_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_timecode("60:01.120")
        with self.assertRaises(ValueError):
            parse_timecode("00:60:01.120")
        with self.assertRaises(ValueError):
            parse_timecode("00:00:60.000")


if __name__ == "__main__":
    unittest.main()
