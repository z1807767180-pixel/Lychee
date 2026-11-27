"""Package the audited mobile candidate and its SQLite server for Windows x64."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
LICENSE_SHA = "148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5"
LEGACY = ("account.mjs", "camp.mjs", "chunk-ZIGCNLDY.mjs", "circle-route.mjs", "circles.mjs",
          "journal.mjs", "phone.mjs", "portrait.mjs", "theme-assets.json", "theme-assets.mjs",
          "v61.mjs", "v62.mjs", "yard65.mjs")
SERVER = ("index", "accounts", "domains", "ai-quota", "provider-config", "diet-store",
          "diet-vision", "diet-vision-result", "notification-source", "notify-push",
          "notify-push-transport", "image-receipts", "image-result", "quiz-game", "quiz-rounds",
          "social", "social-history", "social-store", "soup-categories", "notices", "turso-client")
ATTRIBUTIONS = ("README.md", "apache-2.0.txt", "gradle.txt", "hrana.txt", "js-base64.txt",
                "libsql-client.txt", "lucide.txt", "Microsoft.Web.WebView2-LICENSE.txt",
                "promise-limit.txt", "react.txt", "soup-attributions.json", "turtle-soup-MIT.txt", "ws.txt")


def digest(path):
    with path.open("rb") as stream:
        h = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
        return h.hexdigest()


def inventory(folder):
    result = {}
    for item in sorted(folder.rglob("*")):
        if item.is_symlink() or getattr(item.lstat(), "st_file_attributes", 0) & 1024:
            raise ValueError("Unexpected linked input: " + str(item))
        if item.is_file():
            result[item.relative_to(folder).as_posix()] = digest(item)
    return result


def copy(src, dst):
    if not src.is_file() or src.is_symlink():
        raise ValueError("Missing or linked release input: " + str(src))
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)


def package(args):
    node = Path(args.node or shutil.which("node") or "").resolve()
    version = subprocess.check_output([str(node), "-p", "process.platform+' '+process.arch+' '+process.version"], text=True).strip()
    if version != "win32 x64 v24.18.0" or digest(args.node_license) != LICENSE_SHA:
        raise ValueError("Expected Windows x64 Node 24.18.0 and its matching official LICENSE.")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lychee-local-distribution-", dir=out) as directory:
        work = Path(directory)
        # This official build path has no Render upload/download or deployment step.
        rebuilt = work / "checked-mobile"
        subprocess.run([sys.executable, str(SOURCE / "mobile-web/build.py"), str(rebuilt)], check=True)
        expected = inventory(rebuilt / "mobile")
        if not expected or inventory(args.site.resolve() / "mobile") != expected:
            raise ValueError("The selected candidate differs from this checkout's official mobile build.")
        folder = work / "distribution"
        web = folder / "app/web"
        for name in expected:
            copy(args.site / "mobile" / name, web / "mobile" / name)
        for name in SERVER:
            copy(SOURCE / "server" / (name + ".mjs"), folder / "app/server" / (name + ".mjs"))
        for name in ("quiz-bank.json", "circle-puzzles.json"):
            copy(SOURCE / "server" / name, folder / "app/server" / name)
        for name in LEGACY:
            copy(SOURCE / "legacy" / name, folder / "app/legacy" / name)
        for name in ATTRIBUTIONS:
            copy(SOURCE / "third-party" / name, folder / "third-party" / name)
        quiz_sources = SOURCE.parent / "docs/design/头脑王者题库来源.md"
        copy(quiz_sources, folder / "third-party/头脑王者题库来源.md")
        copy(node, folder / "runtime/node.exe")
        copy(args.node_license, folder / "runtime/NODE-LICENSE.txt")
        copy(HERE / "README.md", folder / "试用说明.md")
        copy(HERE / "run.mjs", folder / "app/local-trial/run.mjs")
        copy(HERE / "trial.html", web / "trial.html")
        (web / "trial-id.json").write_text('{"edition":"lychee-social-local-v1"}\n', encoding="utf-8")
        with Image.open(web / "mobile/orchard-basket.webp") as basket:
            basket.thumbnail((320, 320))
            basket.convert("RGB").save(folder / "app/trial-basket.jpg", quality=82)
        # Avoid preloading NODE_OPTIONS or arbitrary paths from another development project.
        cmd = ('@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\nset "NODE_OPTIONS="\r\n'
               'set "NODE_PATH="\r\nset "NODE_EXTRA_CA_CERTS="\r\n'
               '"%~dp0runtime\\node.exe" "%~dp0app\\local-trial\\run.mjs" %*\r\n'
               'if errorlevel 1 pause\r\n')
        (folder / "启动荔枝.cmd").write_bytes(cmd.encode("ascii"))
        manifest = inventory(folder)
        digest_id = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:10]
        name = "荔枝界面本地试用-Windows-x64-" + digest_id
        installed = out / name
        if installed.exists():
            if inventory(installed) != manifest:
                raise ValueError("The existing output was changed; choose a separate --out folder.")
        else:
            # Windows keeps the private ACL when moving a tempfile into another
            # directory. Fresh files here inherit the distribution folder's ACL.
            pending = out / (".preparing-" + uuid.uuid4().hex)
            shutil.copytree(folder, pending)
            pending.rename(installed)
        archive = out / (name + ".zip")
        if archive.exists():
            with zipfile.ZipFile(archive) as z:
                if set(z.namelist()) != set(manifest):
                    raise ValueError("Existing ZIP has different contents.")
                for entry, sha in manifest.items():
                    if hashlib.sha256(z.read(entry)).hexdigest() != sha:
                        raise ValueError("Existing ZIP differs from the checked package.")
        else:
            intermediate = work / "trial.zip"
            with zipfile.ZipFile(intermediate, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
                for entry in manifest:
                    z.write(installed / entry, entry)
            pending = out / (".zip-" + uuid.uuid4().hex)
            shutil.copyfile(intermediate, pending)
            pending.rename(archive)
        sha = digest(archive)
        archive.with_suffix(".sha256").write_text(sha + "  " + archive.name + "\n", encoding="utf-8")
        print(json.dumps({"zip": str(archive), "launcher": str(installed / "启动荔枝.cmd"), "sha256": sha,
                          "bytes": archive.stat().st_size, "files": len(manifest), "mobileFiles": len(expected)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, type=Path)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--node-license", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=SOURCE / ".local/ui-trial/发行")
    package(parser.parse_args())

