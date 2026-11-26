"""Check a clean checkout without credentials, network calls or production data."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
ENTRIES = (
    "desktop/GardenWindow.cs", "mobile-web/build.py",
    "android/android/app/src/main/java/dev/lychee/pilot/MainActivity.java",
    "ios/Lychee.xcodeproj/project.pbxproj", "server/index.mjs",
)


def main():
    for name in ENTRIES:
        if not (SOURCE / name).is_file():
            raise SystemExit("Missing project entry: " + name)
    manifest = json.loads((SOURCE / "public-build.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "public"
        subprocess.run([sys.executable, str(SOURCE / "build.py"), "--out", str(output)], check=True)
        files = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in output.rglob("*") if p.is_file()}
        if files != manifest["files"]:
            raise SystemExit("Shared client differs from the tracked release manifest.")
    print(f"{manifest['version']}: verified {len(files)} files and all platform entries.")


if __name__ == "__main__":
    main()
