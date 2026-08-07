from __future__ import annotations

import http.client
import io
import unittest
from unittest import mock

from scripts import prepare_desktop_tools


class Response(io.BytesIO):
    def __enter__(self) -> Response:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class DownloadRetryTests(unittest.TestCase):
    @mock.patch.object(prepare_desktop_tools.time, "sleep")
    @mock.patch.object(prepare_desktop_tools.urllib.request, "urlopen")
    def test_read_url_retries_remote_disconnects(
        self,
        urlopen: mock.Mock,
        sleep: mock.Mock,
    ) -> None:
        urlopen.side_effect = [
            http.client.RemoteDisconnected("connection closed"),
            Response(b"checksum data"),
        ]

        content = prepare_desktop_tools.read_url("https://example.test/checksums", 100)

        self.assertEqual(content, b"checksum data")
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1)

    @mock.patch.object(prepare_desktop_tools.time, "sleep")
    @mock.patch.object(prepare_desktop_tools.urllib.request, "urlopen")
    def test_read_url_stops_after_the_configured_attempts(
        self,
        urlopen: mock.Mock,
        sleep: mock.Mock,
    ) -> None:
        urlopen.side_effect = http.client.RemoteDisconnected("connection closed")

        with self.assertRaisesRegex(SystemExit, "after 4 attempt"):
            prepare_desktop_tools.read_url("https://example.test/checksums", 100)

        self.assertEqual(urlopen.call_count, 4)
        self.assertEqual(sleep.call_count, 3)


if __name__ == "__main__":
    unittest.main()
