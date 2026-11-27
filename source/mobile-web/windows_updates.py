"""Prepare verified Windows release assets for the existing Lychee HTTPS origin."""
import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


RELEASES = "https://github.com/z1807767180-pixel/Lychee/releases/download/"
RELEASE_PATH = re.compile(r"/github-production-release-asset/1471636015/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
MAX_PACKAGE = 256 * 1024 * 1024


class RepositoryRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        url = urlsplit(new_url)
        if (url.scheme != "https" or url.netloc != "release-assets.githubusercontent.com"
                or not RELEASE_PATH.fullmatch(url.path) or url.fragment):
            raise ValueError("Unexpected Windows release asset redirect")
        return super().redirect_request(request, response, code, message, headers, new_url)


def prepare(manifest, output):
    data = manifest.read_bytes()
    if len(data) > 16384:
        raise ValueError("Windows manifest too large")
    release = json.loads(data)
    version = release["version"]
    if (set(release) != {"schema", "version", "assets"} or type(release["schema"]) is not int
            or release["schema"] != 1
            or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version)
            or any(int(n) > limit for n, limit in zip(version.split("."), [255, 255, 65535]))
            or len(release["assets"]) != 2):
        raise ValueError("Invalid Windows stable release")
    assets = {row["kind"]: row for row in release["assets"]}
    if set(assets) != {"exe", "msi"} or output.exists():
        raise ValueError("Need both Windows packages and a new output directory")
    opener = build_opener(RepositoryRedirect())
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        root = Path(tmp) / "windows-update"
        tag = "windows-v" + version
        package_dir = root / tag
        package_dir.mkdir(parents=True)
        for kind, asset in assets.items():
            name = "Lychee." + kind
            length = asset["length"]
            if (asset["name"] != name or type(length) is not int or not 0 < length <= MAX_PACKAGE
                    or not re.fullmatch(r"[0-9a-f]{64}", asset["sha256"])):
                raise ValueError("Invalid Windows package metadata")
            request = Request(RELEASES + tag + "/" + name, headers={"User-Agent": "Lychee-release"})
            actual, digest = 0, hashlib.sha256()
            with opener.open(request, timeout=65) as response, (package_dir / name).open("xb") as package:
                if response.status != 200:
                    raise ValueError("Windows package is unavailable")
                while block := response.read(256 * 1024):
                    actual += len(block)
                    if actual > length:
                        raise ValueError("Windows package too large")
                    digest.update(block)
                    package.write(block)
            if actual != length or digest.hexdigest() != asset["sha256"]:
                raise ValueError("Windows package did not match the pinned release manifest")
        (root / "stable.json").write_bytes(data)
        root.rename(output)


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("manifest", type=Path)
    args.add_argument("output", type=Path)
    options = args.parse_args()
    prepare(options.manifest, options.output)
