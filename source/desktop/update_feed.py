"""Generate the local Windows stable.json from the final, matching EXE and MSI."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid
from build_identity import guid


LIMIT = 256 * 1024 * 1024


def describe(path):
    length = path.stat().st_size
    if not 0 < length <= LIMIT:
        raise ValueError(f"Package size outside the supported range: {path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"kind": path.suffix[1:], "name": path.name, "length": length, "sha256": digest.hexdigest()}


def exe_company(exe):
    lib = ctypes.WinDLL("version")
    size = lib.GetFileVersionInfoSizeW(str(exe), None)
    if not size:
        raise ValueError("EXE has no Windows version resource")
    data = ctypes.create_string_buffer(size)
    if not lib.GetFileVersionInfoW(str(exe), 0, size, data):
        raise ValueError("Cannot read EXE version resource")
    value, length = ctypes.c_void_p(), wintypes.UINT()
    def query(key):
        if not lib.VerQueryValueW(data, key, ctypes.byref(value), ctypes.byref(length)):
            raise ValueError(f"EXE version resource is missing {key}")
    query(r"\VarFileInfo\Translation")
    if length.value < 4 or length.value % 4:
        raise ValueError("Invalid EXE version translations")
    words = list((wintypes.WORD * (length.value//2)).from_address(value.value))
    companies = set()
    for index in range(0, len(words), 2):
        query(r"\StringFileInfo\%04x%04x\CompanyName" % tuple(words[index:index+2]))
        companies.add(ctypes.wstring_at(value.value).strip())
    return companies


def check_versions(exe, msi, version, instance):
    # Release builds already use Windows Installer and msilib to produce the per-user MSI.
    import msilib
    database = msilib.OpenDatabase(str(msi), msilib.MSIDBOPEN_READONLY)
    view = database.OpenView("SELECT `Property`, `Value` FROM `Property`")
    view.Execute(None)
    properties = {}
    while record := view.Fetch():
        properties[record.GetString(1)] = record.GetString(2)
    upgrade = guid("upgrade", instance)
    expected = {"ProductVersion": version, "ProductCode": guid("product/"+version,instance),
                "UpgradeCode": upgrade, "Manufacturer": "Lychee",
                "ProductName": "Lychee Desktop" + (" QA "+instance if instance else "")}
    if any(properties.get(key) != value for key,value in expected.items()):
        raise ValueError("MSI product identity or version does not match this release")
    if exe_company(exe) != {"Lychee / " + upgrade}:
        raise ValueError("EXE CompanyName does not match this release identity")
    buf = ctypes.create_unicode_buffer(80)
    size = wintypes.DWORD(len(buf))
    get_version = ctypes.WinDLL("msi").MsiGetFileVersionW
    get_version.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD),
                            wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    get_version.restype = wintypes.UINT
    if get_version(str(exe), buf, ctypes.byref(size), None, None) or buf.value != version + ".0":
        raise ValueError("EXE file version does not match the requested version")


def generate(packages, version, output, instance=None):
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,4})", version):
        raise ValueError("Expected a canonical X.Y.Z version")
    if any(part > maximum for part, maximum in zip(map(int, version.split(".")), [255, 255, 65535])):
        raise ValueError("Version exceeds Windows Installer limits")
    if output.name != "stable.json":
        raise ValueError("Manifest output must be named stable.json")
    if instance:
        instance = str(uuid.UUID(instance))
        roots = [Path(tempfile.gettempdir()).resolve(), Path(__file__).resolve().parents[1] / ".local"]
        if not any(output.resolve().is_relative_to(root) for root in roots):
            raise ValueError("QA manifests may only be staged under the system temp directory or source/.local")
    exe, msi = (packages.resolve() / name for name in ("Lychee.exe", "Lychee.msi"))
    assets = [describe(exe), describe(msi)]
    check_versions(exe, msi, version, instance)
    subprocess.run([sys.executable, "-E", str(Path(__file__).with_name("verify-installer.py")), str(msi), str(exe)],
                   check=True)
    if [describe(exe), describe(msi)] != assets:
        raise ValueError("Packages changed during verification. Rebuild the manifest.")
    manifest = {"schema": 1, "version": version, "assets": assets}
    if instance:
        manifest["qaInstance"] = instance
    content = json.dumps(manifest, indent=2) + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    filename = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, encoding="utf-8",
                                         newline="\n", delete=False) as staged:
            filename = staged.name
            staged.write(content)
            staged.flush()
            os.fsync(staged.fileno())
        os.replace(filename, output)
    finally:
        if filename:
            Path(filename).unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--packages", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--qa-instance", help="UUID of this isolated local QA installation")
    args = parser.parse_args()
    try:
        generate(args.packages, args.version, args.output, args.qa_instance)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Update manifest was not generated: {error}\n")
