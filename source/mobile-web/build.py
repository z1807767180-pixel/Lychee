"""Prepare the mobile web distribution from the approved 6.4.7 archive."""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "source/android"))
from mobile_assets import unpack

VERSION = "6.4.7"
ARCHIVE = "856b197061106f08cb3eb3126998de1a508b9d412956c86b099a0c13571ad975"
SHARED = re.compile(rb"""(?<=[("'\x60])/((?:client|launch|scenes)/|windows/(?:team-share|workspace-nav)\.js|(?:app\.css|camp\.webp|meadow\.webp)\b)""")
PREFIX = "/mobile/assets-" + VERSION + "/"


def build(out):
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "original"
        subprocess.run([sys.executable, str(ROOT / "history/binary-archive/restore.py"),
                        "--select", ARCHIVE, "--out", str(dest)], check=True)
        files = unpack(next(dest.rglob("*.zip")), ARCHIVE, VERSION)
    if len(files) != 146 or files["mobile/version.txt"].strip() != VERSION.encode():
        raise ValueError("Unexpected mobile release")
    out.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        if name == "mobile/index.html":
            marker = b'<link rel="apple-touch-icon"'
            if data.count(marker) != 1:
                raise ValueError("Missing iPhone home screen icon")
            data = data.replace(marker, b'<link rel="manifest" href="/mobile/app.webmanifest">\n' + marker)
        if Path(name).suffix in {".html", ".css", ".js"}:
            data = SHARED.sub(lambda m: PREFIX.encode() + m[1], data)
        target = out / (name if name.startswith("mobile/") else PREFIX.lstrip("/") + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"Prepared {len(files)} mobile assets for {VERSION}")


if __name__ == "__main__":
    build(Path(sys.argv[1]))
