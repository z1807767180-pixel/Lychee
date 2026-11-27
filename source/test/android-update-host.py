"""Check same-origin Android delivery against an actual release APK and signing receipt."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/"source/mobile-web"))
import android_updates as host


class AndroidReleaseFiles(unittest.TestCase):
    def setUp(self):
        root = Path(os.environ.get("LYCHEE_ANDROID_HOST_INPUT", ROOT))
        release = root/"source/android/friends-release.json"
        self.metadata = json.loads(release.read_bytes())
        version = self.metadata["version"]
        self.name = f"Lychee-Friends-V{version}.apk"
        self.relative = f"android-friends-v{version}/{self.name}"
        self.visible = (self.relative.replace("/Lychee-Friends-V", "/Lychee-Friends-A")
                        if int(version.split('.')[0]) >= 8 else self.relative)
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        work = Path(temp.name)
        self.packages, self.output, self.release = work/"signed", work/"android-update", work/"release.json"
        self.packages.mkdir()
        shutil.copyfile(release,self.release)
        for name in [self.name, "signature.json"]:
            shutil.copyfile(root/"distribution/android-friends"/name, self.packages/name)

    def prepare(self):
        host.prepare(self.release,self.packages,self.output)

    def test_only_current_signed_apk_and_same_origin_download_are_exposed(self):
        self.prepare()
        files = {f.relative_to(self.output).as_posix() for f in self.output.rglob("*") if f.is_file()}
        self.assertEqual(files, {"current.json","download.html",self.relative,self.visible})
        actual = (self.output/self.relative).read_bytes()
        self.assertEqual(actual,(self.packages/self.name).read_bytes())
        expected = {k:self.metadata[k] for k in ["version","note"]}
        expected["sha256"] = hashlib.sha256(actual).hexdigest()
        self.assertEqual(json.loads((self.output/"current.json").read_bytes()),expected)
        page = (self.output/"download.html").read_text(encoding="utf8")
        self.assertEqual((self.output/self.visible).read_bytes(),actual)
        self.assertIn(f'href="{self.visible}" download',page)
        if self.visible != self.relative:
            self.assertIn(f'download="{Path(self.visible).name}"',page)
        self.assertNotIn("https://",page)
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual((self.output/self.relative).read_bytes(),actual)

    def test_wrong_bytes_missing_input_or_published_receipt_never_create_output(self):
        apk = self.packages/self.name
        original=apk.read_bytes()
        for body in [original[:-1], b"bad", b""]:
            apk.write_bytes(body)
            with self.assertRaises(ValueError): self.prepare()
            self.assertFalse(self.output.exists())
        with apk.open("wb") as oversized:
            oversized.truncate(128*1024*1024+1)
        with self.assertRaisesRegex(ValueError,"release APK"): self.prepare()
        apk.unlink()
        with self.assertRaises(FileNotFoundError): self.prepare()
        apk.write_bytes(original)
        (self.packages/"signature.json").unlink()
        with self.assertRaises(FileNotFoundError): self.prepare()
        self.assertFalse(self.output.exists())

    def test_signer_and_actual_version_are_checked_in_addition_to_sha256(self):
        with patch.object(host,"FRIENDS_CERTIFICATE","0"*64), self.assertRaisesRegex(ValueError,"certificate"):
            self.prepare()
        other = "9.9.9" if self.metadata["version"] != "9.9.9" else "9.9.8"
        (self.packages/self.name).rename(self.packages/f"Lychee-Friends-V{other}.apk")
        self.release.write_text(json.dumps({**self.metadata,"version":other}),encoding="utf8")
        with self.assertRaisesRegex(ValueError,"embedded version"): self.prepare()
        self.assertFalse(self.output.exists())

    def test_unsupported_release_cannot_become_an_unreadable_client_manifest(self):
        for changes in [{"version":"../7.0.5"}, {"note":" "}, {"note":"🍒"*501}, {"version":"7.00.6"}]:
            self.release.write_text(json.dumps({**self.metadata,**changes}),encoding="utf8")
            with self.assertRaises(ValueError): self.prepare()
            self.assertFalse(self.output.exists())

    def test_render_start_installs_only_verified_files_and_preserves_other_routes(self):
        self.prepare()
        stage = self.output.parent/"staged"
        mobile = stage/"www/mobile"
        mobile.mkdir(parents=True)
        (mobile/"version.txt").write_text("1.0.0")
        (mobile/"index.html").write_text('data-client-build="1.0.0" /mobile/assets-1.0.0/launch/start.js')
        (mobile/"app.webmanifest").write_text("original mobile identity")
        windows = stage/"www/windows-update"
        windows.mkdir()
        (windows/"stable.json").write_bytes(b"existing Windows route")
        staged = stage/"www/android-update"
        shutil.copytree(self.output,staged)
        (staged/"internal.json").write_bytes(b"private build fixture")
        installer = stage/"install.mjs"
        shutil.copyfile(ROOT/"source/mobile-web/install.mjs",installer)
        def install(destination):
            return subprocess.run(["node","--input-type=module","-e",
                "const m=await import(process.argv[1]);await m.install(process.argv[2]);",
                installer.as_uri(),str(destination)],env={**os.environ,"RENDER":"true"},capture_output=True)
        target=stage/"deployed"
        result=install(target)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((target/"android-update"/self.relative).read_bytes(),(self.packages/self.name).read_bytes())
        self.assertEqual((target/"android-update"/self.visible).read_bytes(),(self.packages/self.name).read_bytes())
        self.assertFalse((target/"android-update/internal.json").exists())
        self.assertEqual((target/"windows-update/stable.json").read_bytes(),b"existing Windows route")
        self.assertEqual((target/"mobile/index.html").read_bytes(),(mobile/"index.html").read_bytes())
        for index,problem in enumerate(["damaged","oversized","missing"]):
            package=staged/self.relative
            if problem == "missing": package.unlink()
            elif problem == "oversized":
                with package.open("wb") as oversized: oversized.truncate(128*1024*1024+1)
            else: package.write_bytes(b"damaged after build")
            target=stage/f"rejected-{index}"
            self.assertNotEqual(install(target).returncode,0)
            self.assertFalse((target/"android-update").exists())


if __name__ == "__main__":
    unittest.main()
