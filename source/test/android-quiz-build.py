"""Build an isolated friends debug shell in an ephemeral Android SDK workspace."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def replace_once(path, original, replacement):
    text = path.read_text(encoding="utf-8")
    if text.count(original) != 1:
        raise ValueError(f"QA fixture no longer matches {path.name}")
    path.write_text(text.replace(original, replacement), encoding="utf-8")


def build(folder):
    src = Path(__file__).resolve().parents[1] / "android"
    folder.mkdir(exist_ok=False)
    qa = folder / "shell"
    shutil.copytree(src, qa, ignore=shutil.ignore_patterns("node_modules", "build", ".gradle", "www", "__pycache__"))
    sys.path.insert(0, str(qa))
    from build import BOOT, lock_dependencies, run

    # Both the shell policy and the app's HTTPS connections still check the test host.
    authority = "127.0.0.1:18443"
    app = qa / "android/app"
    main = app / "src/main"
    java = main / "java/dev/lychee/pilot"
    replace_once(java / "MainActivity.java", '"lychee-link-check.onrender.com"', f'"{authority}"')
    replace_once(java / "ShellUpdates.java", '"https://lychee-link-check.onrender.com/android-update/"',
                 f'"https://{authority}/qa-update/"')
    replace_once(java / "ShellUpdates.java", '"https://github.com/"+REPO+"/releases/download/"',
                 f'"https://{authority}/qa-fallback/"')
    replace_once(app / "build.gradle", 'applicationId "dev.lychee.friends"', 'applicationId "dev.lychee.quizqa"')
    conf = qa / "capacitor.config.json"
    config = json.loads(conf.read_text(encoding="utf-8"))
    config["appId"] = "dev.lychee.quizqa"
    config["server"].update(url=f"https://{authority}/mobile/", hostname="127.0.0.1")
    config["android"]["webContentsDebuggingEnabled"] = True
    assert config["server"]["cleartext"] is False and config["android"]["allowMixedContent"] is False
    conf.write_text(json.dumps(config), encoding="utf-8")
    resources = main / "res"
    (resources / "raw").mkdir(exist_ok=True)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=Lychee Quiz QA", "-addext", "basicConstraints=critical,CA:TRUE",
                    "-keyout", "ca.key", "-out", "ca.pem"], cwd=folder, check=True)
    subprocess.run(["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1",
                    "-keyout", "server.key", "-out", "server.csr"], cwd=folder, check=True)
    (folder / "server.ext").write_text("subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n", encoding="ascii")
    subprocess.run(["openssl", "x509", "-req", "-days", "1", "-CA", "ca.pem", "-CAkey", "ca.key",
                    "-CAcreateserial", "-in", "server.csr", "-extfile", "server.ext", "-out", "server.pem"],
                   cwd=folder, check=True)
    shutil.copyfile(folder / "ca.pem", resources / "raw/quiz_test_ca.pem")
    (resources / "xml/quiz_network.xml").write_text(
        '<network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors>'
        '<certificates src="@raw/quiz_test_ca"/></trust-anchors></base-config></network-security-config>',
        encoding="utf-8")
    replace_once(main / "AndroidManifest.xml", "<application", '<application android:networkSecurityConfig="@xml/quiz_network"')
    (qa / "www").mkdir()
    (qa / "www/index.html").write_bytes(BOOT)
    lock_dependencies()
    run("node", qa / "node_modules/@capacitor/cli/bin/capacitor", "sync", "android")
    wrapper = qa / "android" / ("gradlew.bat" if os.name == "nt" else "gradlew")
    run(*([] if os.name == "nt" else ["bash"]), wrapper, "-p", qa / "android", "--no-daemon", ":app:assembleDebug")
    shutil.copyfile(app / "build/outputs/apk/debug/app-debug.apk", folder / "quiz-qa.apk")


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("new_directory", type=Path)
    build(cli.parse_args().new_directory.resolve())
