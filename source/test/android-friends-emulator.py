"""Exercise the signed friends shell at Android entry points without a production account."""
import re
import os
from pathlib import Path
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = "dev.lychee.friends"


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=25, stderr=subprocess.STDOUT).decode("utf8", "replace")

def hierarchy():
    raw = adb("exec-out", "uiautomator", "dump", "/dev/tty")
    start, end = raw.find("<hierarchy"), raw.rfind("</hierarchy>")
    if start >= 0 and end >= start:
        return ET.fromstring(raw[start:end+len("</hierarchy>")])
    path = "/sdcard/lychee-friends-ui.xml"
    reply = adb("shell", "uiautomator", "dump", path)
    if "dumped to:" not in reply:
        raise ValueError(f"No UI hierarchy: {raw[-220:]} / {reply[-220:]}")
    return ET.fromstring(adb("exec-out", "cat", path))

def diagnostics():
    for name, args, match in [
        ("window", ["shell","dumpsys","window"], r"mCurrentFocus|mFocusedApp|mShowingLockscreen"),
        ("activity", ["shell","dumpsys","activity","activities"], r"topResumedActivity|mResumedActivity"),
        ("power", ["shell","dumpsys","power"], r"mWakefulness=|Display Power:"),
        ("network", ["shell","dumpsys","connectivity"], r"Active default network:"),
        ("crash", ["logcat","-b","crash","-d","-t","50"], r"."),
    ]:
        try:
            lines = [s.strip() for s in adb(*args).splitlines() if re.search(match,s)]
            print(f"{name}: {lines[-12:]}",flush=True)
        except subprocess.SubprocessError as error:
            print(name, type(error).__name__,flush=True)

def find(label, click=False, timeout=100, retry_landing=False):
    labels = (label,) if isinstance(label, str) else label
    deadline = time.monotonic() + timeout
    retry_at = time.monotonic() + 5
    visible = []
    last_error = "none"
    node_sample = []
    while time.monotonic() < deadline:
        try:
            nodes = list(hierarchy().iter("node"))
            node_sample = [(n.get("package"), n.get("class")) for n in nodes[:12]]
            current = [n.get("text") or n.get("content-desc") for n in nodes]
            if any(current):
                visible = [text for text in current if text]
            for node in nodes:
                text = node.get("text") or node.get("content-desc") or ""
                if any(item in text for item in labels) or label == "登录荔枝园" and "注册新账号" in text:
                    if click:
                        a,b,c,d=map(int,re.findall(r"\d+",node.get("bounds")))
                        adb("shell","input","tap",str((a+c)//2),str((b+d)//2))
                    return
                if text == "Close app" and "Pixel Launcher" in " ".join(visible):
                    a,b,c,d=map(int,re.findall(r"\d+",node.get("bounds")))
                    adb("shell","input","tap",str((a+c)//2),str((b+d)//2))
                    break
                if retry_landing and text == "重试" and time.monotonic() >= retry_at:
                    a,b,c,d=map(int,re.findall(r"\d+",node.get("bounds")))
                    adb("shell","input","tap",str((a+c)//2),str((b+d)//2))
                    retry_at = time.monotonic()+12
                    print("Retried the official landing page after a transient connection failure.", flush=True)
                    break
        except (ValueError,ET.ParseError,subprocess.SubprocessError) as error:
            last_error = f"{type(error).__name__} {error} {getattr(error,'output',b'')!r}"[:450]
        time.sleep(2)
    diagnostics()
    raise RuntimeError(f"Did not see {label}: {visible[:18]}, nodes={node_sample}, last dump={last_error}")


def launch():
    # Keep the ephemeral test screen interactive throughout the network transition.
    adb("shell","svc","power","stayon","true")
    adb("shell","input","keyevent","KEYCODE_WAKEUP")
    adb("shell","wm","dismiss-keyguard")
    adb("shell","am","force-stop",PACKAGE)
    result = adb("shell","am","start","-W","-n",PACKAGE+"/dev.lychee.pilot.MainActivity")
    if "Status: ok" not in result:
        raise RuntimeError(f"Android did not launch the app: {result}")


def offline(enable):
    adb("shell","cmd","connectivity","airplane-mode","enable" if enable else "disable")
    adb("shell","svc","wifi","disable" if enable else "enable")
    adb("shell","svc","data","disable" if enable else "enable")
    if enable:
        deadline=time.monotonic()+25
        while time.monotonic()<deadline:
            state = adb("shell","dumpsys","connectivity")
            if re.search(r"Active default network:\s*(none|null)\b",state,re.I):
                return
            if "Active default network:" not in state:
                routes = adb("shell","ip","route","show","table","all")
                if not re.search(r"^default\s", routes, re.M):
                    return
            time.sleep(1)
        diagnostics()
        raise RuntimeError("Android did not drop its default network before the offline test")

def wait_for_public_https(target):
    # The device can retain an old VALIDATED entry after its default route disappears.
    failures = 0
    deadline = time.monotonic() + 330
    while time.monotonic() < deadline:
        try:
            print(adb("shell", "CLASSPATH=/data/local/tmp/friends-probe.jar",
                      "app_process", "/system/bin", "FriendsFeedProbe", target).strip(),flush=True)
            return
        except subprocess.CalledProcessError as error:
            detail = error.output.decode("utf8", "replace").strip()[:300]
            print(detail, flush=True)
            if "Previous published version is still cached" in detail:
                time.sleep(12)
                continue
            failures += 1
            if failures >= 15:
                break
            time.sleep(2)
    raise RuntimeError(f"The Android device could not connect to {target}")


if __name__ == "__main__":
    if sys.argv[1] == "first-install":
        adb("install",sys.argv[2])
        wait_for_public_https("landing")
        launch()
        find("登录荔枝园",retry_landing=True)
        print("Verified first installation and official login screen.")
        try:
            offline(True)
            launch()
            find(("暂时打不开荔枝", "网络未连接"))
            find("检查安卓更新",click=True)
            find("暂时查不到更新",timeout=45)
            print("Verified offline startup and honest manual update result.")
        finally:
            offline(False)
    elif sys.argv[1] == "channel":
        try:
            # This fresh emulator has no user account. Discard cached online HTML
            # before exercising the native offline entry point a second time.
            assert "Success" in adb("shell","pm","clear",PACKAGE)
            offline(True)
            launch()
            find("暂时打不开荔枝")
            offline(False)
            wait_for_public_https(sys.argv[2])
            # Allow the startup check made in airplane mode to complete, independently
            # of the manual check a user makes after reconnecting.
            time.sleep(12)
            find("检查安卓更新",click=True)
            find("没有更高版本",timeout=60)
            print("Verified the installed V"+sys.argv[2]+" app checks the published channel.")
        finally:
            offline(False)
    elif sys.argv[1] == "upgrade":
        old, new, apk = sys.argv[2:]
        adb("uninstall", PACKAGE)
        if tuple(map(int, old.split("."))) >= (8, 0, 1):
            # These public updaters support the official origin on Android 9 and newer.
            # The dedicated test also verifies the installed bytes and a cold launch.
            serial=adb("get-serialno").strip()
            assert serial.startswith("emulator-") and adb("shell","getprop","ro.kernel.qemu").strip()=="1"
            adb("root")
            adb("wait-for-device")
            signed=Path("out")/f"Lychee-Friends-V{new}.apk"
            evidence=Path(os.environ.get("RUNNER_TEMP","."))/"official-origin-upgrade"
            subprocess.run([sys.executable,str(Path(__file__).with_name("android-origin-upgrade.py")),
                            apk,new,str(signed),str(evidence),"--updater-code-apk",apk],
                           check=True,env={**os.environ,"ANDROID_SERIAL":serial})
            sys.exit(0)
        adb("install", apk)
        assert "versionName="+old in adb("shell","dumpsys","package",PACKAGE)
        # Grant the emulator the same source permission a user grants in Settings.
        # The system package installer still requires its own confirmation below.
        adb("shell","appops","set",PACKAGE,"REQUEST_INSTALL_PACKAGES","allow")
        wait_for_public_https(new)
        launch()
        # The update prompt is rendered by the installed shell, before Android replaces it.
        prefix = "A" if int(old.split(".")[0]) >= 8 else "V"
        find("可以更新到 "+prefix+new)
        find("下载更新",click=True)
        find("Update",click=True,timeout=120)
        deadline=time.monotonic()+60
        while "versionName="+new not in adb("shell","dumpsys","package",PACKAGE):
            if time.monotonic()>deadline:
                raise RuntimeError("Android did not install the downloaded update")
            time.sleep(1)
        print(f"Android reports V{new} installed over V{old}.", flush=True)
        find("Open",click=True,timeout=45)
        find("登录荔枝园",retry_landing=True)
        print(f"Installed the public update from V{old} to V{new} through the old app and the system installer.")
