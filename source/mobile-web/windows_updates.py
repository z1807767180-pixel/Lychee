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


def download_page(version):
    tag = "windows-v" + version
    return f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>荔枝 Windows 下载</title>
<style>
body{{margin:0;background:#faf5e7;color:#244b41;font:17px/1.65 system-ui,sans-serif}}
main{{max-width:35em;margin:8vh auto;padding:1.5em}} h1{{line-height:1.2}}
section{{margin:1.2em 0;padding:1.2em;background:#fffcf4;border:1px solid #dacbb1;border-radius:14px}}
h2,p{{margin:0 0 .55em}} a{{display:inline-block;padding:.55em 1.15em;border-radius:9px;background:#245447;color:white;text-decoration:none}}
a:focus-visible{{outline:3px solid #b95734;outline-offset:3px}}
</style><main><h1>荔枝 Windows 版</h1><p>正式版 W{version} · Windows x64</p>
<section><h2>安装版</h2><p>原来用安装向导安装，请关闭荔枝后运行 MSI，用原来的 Windows 用户覆盖升级。</p>
<a href="{tag}/Lychee.msi" download>下载 MSI 安装包</a></section>
<section><h2>便携版</h2><p>原来直接双击 EXE 使用，请关闭荔枝，用新版替换原位置的 EXE，再从原位置打开。</p>
<a href="{tag}/Lychee.exe" download>下载便携 EXE</a></section></main></html>"""


class RepositoryRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        url = urlsplit(new_url)
        if (url.scheme != "https" or url.netloc != "release-assets.githubusercontent.com"
                or not RELEASE_PATH.fullmatch(url.path) or url.fragment):
            raise ValueError("Unexpected Windows release asset redirect")
        return super().redirect_request(request, response, code, message, headers, new_url)


def prepare_packages(manifest, root):
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
    if set(assets) != {"exe", "msi"}:
        raise ValueError("Need both Windows packages and a new output directory")
    opener = build_opener(RepositoryRedirect())
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
    return version, data


def prepare(manifest, output):
    if output.exists():
        raise ValueError("Windows update output directory already exists")
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        root = Path(tmp) / "windows-update"
        version, data = prepare_packages(manifest, root)
        for historical in ("8.1.1", "8.1.2"):
            if tuple(map(int, version.split("."))) > tuple(map(int, historical.split("."))):
                previous = manifest.with_name(f"stable-{historical}.json")
                if previous.is_file():
                    prepare_packages(previous, root)
        (root / "stable.json").write_bytes(data)
        (root / "download.html").write_text(download_page(version), encoding="utf8")
        root.rename(output)


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("manifest", type=Path)
    args.add_argument("output", type=Path)
    options = args.parse_args()
    prepare(options.manifest, options.output)
