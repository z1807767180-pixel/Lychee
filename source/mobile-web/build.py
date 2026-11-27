"""Prepare the mobile web distribution from the checked-out release sources."""
import re
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "source/android"))
from mobile_assets import pack_checkout
sys.path.insert(0, str(ROOT / 'source'))
from chat_build import journal, notifications, phone as mobile_chat
from release_notices import account_catalog, check_previous, phone_history, releases, workspace_gate
from windows_updates import prepare as prepare_windows_updates

SHARED = re.compile(rb"""(?<=[("'\x60])/((?:client|launch|scenes)/|windows/(?:team-share|workspace-nav)\.js|(?:app\.css|camp\.webp|meadow\.webp)\b)""")

SERVER_MODULES = (
    "soup-categories", "index", "accounts", "turso-accounts", "domains", "ai-quota", "diet-store", "diet-vision", "diet-vision-result",
    "notification-source", "notify-push", "notify-push-transport", "notices", "quiz-game", "quiz-rounds",
)


def build(out):
    with tempfile.TemporaryDirectory() as tmp:
        files = pack_checkout(Path(tmp) / "mobile.zip")
    shared_version = files["mobile/version.txt"].strip()
    rows = releases()
    version = rows[0]["version"]
    files["mobile/version.txt"] = (version + "\n").encode()
    prefix = f"/mobile/assets-{version}/"
    out.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        if name == "mobile/index.html":
            data = data.replace(shared_version, version.encode())
            marker = b'<link rel="apple-touch-icon"'
            if data.count(marker) != 1:
                raise ValueError("Missing iPhone home screen icon")
            data = data.replace(marker, b'<link rel="manifest" href="/mobile/app.webmanifest">\n' + marker)
            chat = f'<link rel="stylesheet" href="/mobile/chat.css?v={version}"><script defer src="/mobile/chat.js?v={version}"></script>\n'
            data = data.replace(marker, chat.encode() + marker)
        if name == "mobile/phone.js":
            data = phone_history(mobile_chat(data.decode()), rows).encode()
        if name == "client/garden.js":
            data = workspace_gate(data.decode()).encode()
        if name == "client/garden.css":
            data += b"\n.ga-notice p{white-space:pre-line}\n"
        if name == "mobile/journal.js":
            data = journal(data.decode()).encode()
        if name == "client/notify-v7.js":
            # Preserve native notification delivery. On the mobile site foreground chat uses the badge.
            data = notifications(data.decode()).encode()
        if Path(name).suffix in {".html", ".css", ".js"}:
            data = SHARED.sub(lambda m: prefix.encode() + m[1], data)
        target = out / (name if name.startswith("mobile/") else prefix.lstrip("/") + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (out / "mobile/app.webmanifest").write_bytes((HERE / "app.webmanifest").read_bytes())
    for name in ("chat.css", "chat.js"):
        shutil.copyfile(HERE / name, out / "mobile" / name)
    chat = out / "mobile/chat.js"
    chat.write_bytes((ROOT / "source/client/chat-inbox.js").read_bytes() + b"\n" + chat.read_bytes())
    if out.name == "www":
        if os.environ.get("RENDER") == "true":
            prepare_windows_updates(ROOT / "distribution/windows/stable.json", out / "windows-update")
        # Render copies the complete prepared/ directory. Keep service code outside www/.
        services = out.parent / "server-v7"
        services.mkdir()
        shutil.copyfile(ROOT / "source/server/circle-puzzles.json", services / "circle-puzzles.json")
        shutil.copyfile(ROOT / "source/server/quiz-bank.json", services / "quiz-bank.json")
        for module in SERVER_MODULES:
            src = ROOT / "source/server" / (module + ".mjs")
            target = services / src.name
            if module == "notices":
                target.write_text(account_catalog(src.read_text(encoding="utf8"), rows), encoding="utf8")
            else:
                shutil.copyfile(src, target)
    print(f"Prepared {sum(path.is_file() for path in out.rglob('*'))} mobile assets for {version}")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--check-release"]:
        check_previous(ROOT, sys.argv[2])
    else:
        build(Path(sys.argv[1]))
