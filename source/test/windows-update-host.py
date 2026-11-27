"""Regression checks for the Windows update files served by the existing HTTPS service."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mobile-web"))
import windows_updates as host


class Body(io.BytesIO):
    status = 200


class WindowsReleaseFiles(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.target = root / "windows-update"
        self.manifest = root / "stable.json"
        self.body = {"Lychee.exe": b"portable", "Lychee.msi": b"installer"}
        assets = [{"kind": name[-3:], "name": name, "length": len(data),
                   "sha256": hashlib.sha256(data).hexdigest()} for name, data in self.body.items()]
        self.manifest.write_text(json.dumps({"schema": 1, "version": "7.0.7", "assets": assets}), encoding="utf8")

    def prepare(self):
        def fetch(request, timeout):
            base = host.RELEASES + "windows-v7.0.7/"
            self.assertTrue(request.full_url.startswith(base))
            return Body(self.body[request.full_url.removeprefix(base)])
        with patch.object(host, "build_opener") as factory:
            factory.return_value.open.side_effect = fetch
            host.prepare(self.manifest, self.target)

    def test_serves_both_verified_packages_and_the_exact_manifest(self):
        self.prepare()
        self.assertEqual((self.target / "stable.json").read_bytes(), self.manifest.read_bytes())
        landing = (self.target / "download.html").read_text(encoding="utf8")
        for name, data in self.body.items():
            self.assertEqual((self.target / "windows-v7.0.7" / name).read_bytes(), data)
            self.assertIn(f'href="windows-v7.0.7/{name}"', landing)
        self.assertNotIn("https://", landing)

    def test_partial_corrupt_and_oversized_packages_never_publish_a_feed(self):
        for invalid in [b"inst", b"incorrect", b"installer-extra"]:
            with self.subTest(invalid=invalid):
                self.body["Lychee.msi"] = invalid
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.target.exists())

    def test_redirect_is_limited_to_the_official_repository_asset(self):
        handler = host.RepositoryRedirect()
        request = Request(host.RELEASES + "windows-v7.0.7/Lychee.exe")
        asset = "https://release-assets.githubusercontent.com/github-production-release-asset/1471636015/01234567-89ab-cdef-0123-0123456789ab"
        self.assertEqual(handler.redirect_request(request, None, 302, "", {}, asset).full_url, asset)
        for invalid in [asset.replace("https:", "http:"), asset.replace("1471636015", "1"),
                        asset.replace("release-assets.githubusercontent.com", "example.org")]:
            with self.subTest(url=invalid), self.assertRaises(ValueError):
                handler.redirect_request(request, None, 302, "", {}, invalid)


if __name__ == "__main__":
    unittest.main()
