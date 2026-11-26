"""Recover both exact Windows candidate files from the retained pre-release package."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
ZIP_NAME = "Lychee-Windows-7.0.3-RC.zip"
ZIP_SHA = "5ba1e3ab0f2ab88afc250e8af4f24e79cc31af9c0a73f1c49823881a1dd93664"


def restore(destination):
    archive = HERE / ZIP_NAME
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ZIP_SHA:
        raise ValueError("Candidate ZIP checksum mismatch")
    with ZipFile(archive) as source:
        msi = source.read("Lychee-Windows-7.0.3.msi")
    installer = runpy.run_path(str(HERE.parents[2] / "source/desktop/verify-installer.py"))
    with tempfile.TemporaryDirectory() as work:
        temp_msi = Path(work) / "Lychee.msi"
        temp_msi.write_bytes(msi)
        exe = installer["embedded_exe"](temp_msi)
    files = {"Lychee.msi": msi, "Lychee.exe": exe}
    destination.mkdir(parents=True, exist_ok=True)
    for item in json.loads((HERE / "candidate.json").read_text(encoding="utf8"))["assets"]:
        data = files[item["name"]]
        if len(data) != item["length"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Candidate file checksum mismatch: " + item["name"])
        target = destination / item["name"]
        if target.exists() and target.read_bytes() != data:
            raise FileExistsError(target)
    for name, data in files.items():
        target = destination / name
        if not target.exists():
            with target.open("xb") as output:
                output.write(data)
    print("Verified W7.0.3 candidate MSI and EXE in", destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    restore(parser.parse_args().destination)
