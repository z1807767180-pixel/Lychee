"""Prepare the mobile web distribution from the checked-out release sources."""
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "source/android"))
from mobile_assets import pack_checkout
from chat_build import journal, notifications, phone as mobile_chat, replace

RELEASE = {
    "version": "7.0.1", "audience": "phone", "date": "2026-11-26", "required": False,
    "title": "聊天图片与后台通知",
    "items": [["聊天", "照片按原比例自动显示，退出大图可回到原来的位置。"],
              ["后台通知", "从 iPhone 主屏幕打开荔枝，在通知中心开启后可接收系统提醒。"]],
}

SHARED = re.compile(rb"""(?<=[("'\x60])/((?:client|launch|scenes)/|windows/(?:team-share|workspace-nav)\.js|(?:app\.css|camp\.webp|meadow\.webp)\b)""")

SERVER_MODULES = (
    "index", "domains", "ai-quota", "diet-store", "diet-vision", "diet-vision-result",
    "notification-source", "notify-push", "notify-push-transport",
)


def build(out):
    with tempfile.TemporaryDirectory() as tmp:
        files = pack_checkout(Path(tmp) / "mobile.zip")
    shared_version = files["mobile/version.txt"].strip()
    version = RELEASE["version"]
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
            release = json.dumps(RELEASE, ensure_ascii=False)
            data = replace(mobile_chat(data.decode()), 'zf=[{"version":',
                           'zf=[' + release + ',{"version":').encode()
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
    if out.name == "www":
        # Render copies the complete prepared/ directory. Keep service code outside www/.
        services = out.parent / "server-v7"
        services.mkdir()
        for module in SERVER_MODULES:
            shutil.copyfile(ROOT / "source/server" / (module + ".mjs"), services / (module + ".mjs"))
    print(f"Prepared {sum(path.is_file() for path in out.rglob('*'))} mobile assets for {version}")


if __name__ == "__main__":
    build(Path(sys.argv[1]))
