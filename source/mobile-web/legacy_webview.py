"""Compile public web assets for the oldest tested Android WebView at build time."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile


def prepare_legacy_webview(mobile):
    source = Path(__file__).resolve().parent / "compat"
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("Install Node.js with npm to build the mobile web client")
    with tempfile.TemporaryDirectory(prefix="lychee-mobile-compat-") as directory:
        work = Path(directory)
        for name in ("package.json", "package-lock.json", "compile.cjs", "browser.cjs"):
            shutil.copyfile(source / name, work / name)
        subprocess.run([npm, "ci", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"],
                       cwd=work, check=True)
        subprocess.run(["node", "compile.cjs", Path(mobile).resolve()], cwd=work, check=True)
