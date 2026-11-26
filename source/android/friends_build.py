"""Build the online Android friends shell in a fresh Android source checkout."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
from zipfile import ZipFile

from build import BOOT, ROOT, lock_dependencies, run


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("output", type=Path)
    cli.add_argument("--version-override", help="Build an older local upgrade-test fixture")
    args = cli.parse_args()
    release = json.loads((ROOT / "friends-release.json").read_text(encoding="utf8"))
    version = args.version_override or release["version"]
    if not re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{1,2}", version) or not release["note"].strip():
        raise ValueError("Set the new Android version and release announcement together")
    major, minor, patch = map(int, version.split("."))
    code = major*10000 + minor*100 + patch
    www = ROOT / "www"
    www.mkdir(exist_ok=True)
    if any(p.is_file() and p.name != "index.html" for p in www.rglob("*")):
        raise ValueError("Use a clean checkout for the online shell")
    (www / "index.html").write_bytes(BOOT)
    lock_dependencies()
    run("node", ROOT / "node_modules/@capacitor/cli/bin/capacitor", "sync", "android")
    wrapper = ROOT / "android" / ("gradlew.bat" if os.name == "nt" else "gradlew")
    run(*([] if os.name == "nt" else ["bash"]), wrapper, "-p", ROOT / "android", "--no-daemon",
        f"-PlycheeCode={code}", f"-PlycheeVersion={version}", ":app:assembleRelease")
    apk = ROOT / "android/app/build/outputs/apk/release/app-release-unsigned.apk"
    with ZipFile(apk) as archive:
        config = json.loads(archive.read("assets/capacitor.config.json"))
        if config["appId"] != "dev.lychee.friends" or config["server"]["url"] != "https://lychee-link-check.onrender.com/mobile/":
            raise ValueError("Unexpected app or live origin")
        if not archive.read("classes.dex").startswith(b"dex\n") or archive.read("assets/public/index.html") != BOOT:
            raise ValueError("Missing shell code or bootstrap")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(apk, args.output)
    print(f"Built friends shell V{version} ({code})")


if __name__ == "__main__":
    main()
