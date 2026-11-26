"""Exercise the signed friends shell at Android entry points without a production account."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = "dev.lychee.friends"


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=25, stderr=subprocess.STDOUT).decode("utf8", "replace")


def find(label, click=False, timeout=100, retry_landing=False):
    deadline = time.monotonic() + timeout
    retry_at = time.monotonic() + 5
    visible = []
    while time.monotonic() < deadline:
        try:
            adb("shell", "uiautomator", "dump", "/sdcard/lychee-friends-ui.xml")
            nodes = ET.fromstring(adb("exec-out", "cat", "/sdcard/lychee-friends-ui.xml")).iter("node")
            visible = []
            for node in nodes:
                text = node.get("text") or node.get("content-desc") or ""
                if text:
                    visible.append(text)
                if label in text or label == "登录荔枝园" and "注册新账号" in text:
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
        except (ValueError,ET.ParseError,subprocess.SubprocessError):
            pass
        time.sleep(2)
    raise RuntimeError(f"Did not see {label}: {visible[:18]}")


def launch():
    adb("shell","am","force-stop",PACKAGE)
    adb("shell","am","start","-W","-n",PACKAGE+"/dev.lychee.pilot.MainActivity")


def offline(enable):
    adb("shell","cmd","connectivity","airplane-mode","enable" if enable else "disable")
    adb("shell","svc","wifi","disable" if enable else "enable")
    adb("shell","svc","data","disable" if enable else "enable")

def wait_for_public_https(target):
    # The device can retain an old VALIDATED entry after its default route disappears.
    for _ in range(15):
        try:
            print(adb("shell", "CLASSPATH=/data/local/tmp/friends-probe.jar",
                      "app_process", "/system/bin", "FriendsFeedProbe", target).strip(),flush=True)
            return
        except subprocess.CalledProcessError as error:
            print(error.output.decode("utf8", "replace").strip()[:300], flush=True)
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
            find("暂时打不开荔枝")
            find("检查安卓更新",click=True)
            find("暂时查不到更新",timeout=45)
            print("Verified offline startup and honest manual update result.")
        finally:
            offline(False)
    elif sys.argv[1] == "channel":
        try:
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
