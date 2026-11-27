"""Exercise an Android update with only the official HTTPS host reachable on a disposable emulator."""
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import socket
import socketserver
import subprocess
import threading
import time
from zipfile import ZipFile

ORIGIN = "lychee-link-check.onrender.com"
HOST_PORT = 19491
spec = importlib.util.spec_from_file_location("friends_device", Path(__file__).with_name("android-friends-emulator.py"))
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)
adb, find = device.adb, device.find


class Tunnel(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline(2048).decode("ascii", errors="replace").strip().split()
        if len(line) != 3:
            return
        method, destination, _ = line
        while self.rfile.readline(2048).strip():
            pass
        allowed = method == "CONNECT" and destination.lower() == ORIGIN + ":443"
        record = {"destination": destination, "allowed": allowed, "sent": 0, "received": 0}
        self.server.records.append(record)
        if not allowed:
            self.wfile.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            return
        try:
            with socket.create_connection((ORIGIN, 443), timeout=15) as remote:
                self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                peers = (self.connection, remote)
                while True:
                    ready, _, _ = select.select(peers, [], [], 110)
                    if not ready:
                        return
                    for incoming in ready:
                        data = incoming.recv(65536)
                        if not data:
                            return
                        outgoing = remote if incoming is self.connection else self.connection
                        outgoing.sendall(data)
                        record["sent" if incoming is self.connection else "received"] += len(data)
        except OSError as error:
            record["networkError"] = type(error).__name__


def screenshot(path):
    with path.open("wb") as out:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=out, check=True, timeout=15)


def installed_version():
    return re.search(r"\bversionName=(\S+)", adb("shell", "dumpsys", "package", device.PACKAGE))[1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("baseline", type=Path, help="Local, release-mode, version-only older fixture")
    p.add_argument("target_version")
    p.add_argument("official_apk", type=Path)
    p.add_argument("evidence", type=Path)
    p.add_argument("--updater-code-apk",type=Path,help="Official app whose executable code must match the baseline fixture")
    p.add_argument("--prompt-prefix",choices=("V","A"),help="Prefix rendered by an older published updater")
    p.add_argument("--web-version",help="Verify the public /mobile/version.txt through the same HTTPS tunnel")
    a = p.parse_args()
    if not os.environ.get("ANDROID_SERIAL", "").startswith("emulator-") or adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise RuntimeError("Select a disposable emulator with ANDROID_SERIAL")
    if adb("shell", "id", "-u").strip() != "0":
        raise RuntimeError("Run adb root for this disposable emulator first")
    a.evidence.mkdir(parents=True, exist_ok=True)
    def dex_hashes(path):
        with ZipFile(path) as apk:
            return {n:hashlib.sha256(apk.read(n)).hexdigest() for n in apk.namelist() if n.endswith(".dex")}
    code = dex_hashes(a.baseline)
    assert code and code == dex_hashes(a.updater_code_apk or a.official_apk)
    assert "Success" in adb("install", "-r", str(a.baseline))
    old = installed_version()
    assert tuple(map(int,old.split("."))) < tuple(map(int,a.target_version.split(".")))
    uid = re.search(r"uid:(\d+)", adb("shell", "cmd", "package", "list", "packages", "-U", device.PACKAGE))[1]
    previous = adb("shell", "settings", "get", "global", "http_proxy").strip()
    records = []
    rules = []
    with socketserver.ThreadingTCPServer(("127.0.0.1", HOST_PORT), Tunnel) as server:
        server.daemon_threads = True
        server.records = records
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            adb("reverse", f"tcp:{HOST_PORT}", f"tcp:{HOST_PORT}")
            adb("shell", "settings", "put", "global", "http_proxy", f"127.0.0.1:{HOST_PORT}")
            for command, localhost in (("iptables", "127.0.0.1/32"), ("ip6tables", "::1/128")):
                rule = ["OUTPUT", "-m", "owner", "--uid-owner", uid, "!", "-d", localhost, "-j", "REJECT"]
                adb("shell", command, "-I", *rule)
                adb("shell", command, "-C", *rule)
                rules.append((command, rule))
            # Send an actual HTTPS CONNECT from the device to verify its proxy tunnel denies GitHub.
            command = f"(printf 'CONNECT github.com:443 HTTP/1.1\\r\\nHost: github.com:443\\r\\n\\r\\n'; sleep 2) | toybox nc -q 2 -w 5 127.0.0.1 {HOST_PORT}"
            denied = adb("shell",command)
            assert "403 Forbidden" in denied and any(r["destination"] == "github.com:443" and not r["allowed"] for r in records), (denied,records[-5:])
            adb("shell","appops","set",device.PACKAGE,"REQUEST_INSTALL_PACKAGES","allow")
            device.launch()
            prefix = a.prompt_prefix or ("A" if int(a.target_version.split(".")[0]) >= 8 else "V")
            find("可以更新到 "+prefix+a.target_version,timeout=170)
            screenshot(a.evidence/"01-offer.png")
            find("下载更新",click=True)
            find("Update",timeout=300)
            assert installed_version() == old
            screenshot(a.evidence/"02-system-confirmation.png")
            find("Update",click=True)
            deadline = time.monotonic()+90
            while installed_version() != a.target_version:
                if time.monotonic() > deadline:
                    raise RuntimeError("System did not install the approved update")
                time.sleep(1)
            path=adb("shell","pm","path",device.PACKAGE).strip().removeprefix("package:")
            actual=adb("shell","sha256sum",path).split()[0]
            expected=hashlib.sha256(a.official_apk.read_bytes()).hexdigest()
            assert actual == expected
            find("Open",click=True)
            find("登录荔枝园",retry_landing=True)
            screenshot(a.evidence/"03-updated.png")
            device.launch()
            find("登录荔枝园",retry_landing=True)
            screenshot(a.evidence/"04-official-cold-launch.png")
            assert sum(r["received"] for r in records if r["allowed"]) >= a.official_apk.stat().st_size
            report={"from":old, "to":a.target_version,"installedSha256":actual,
                    "platform":adb("shell","getprop","ro.build.fingerprint").strip(),
                    "appUid":uid,"testedUpdaterDex":code,"directIPv4AndIPv6Rejected":True,"systemConfirmationRequired":True,
                    "officialLoginVisible":True,"officialColdLaunchLoginVisible":True}
            if a.web_version:
                conn=http.client.HTTPSConnection("127.0.0.1",HOST_PORT,timeout=90)
                try:
                    conn.set_tunnel(ORIGIN,443)
                    conn.request("GET","/mobile/version.txt",headers={"Host":ORIGIN,"Cache-Control":"no-cache"})
                    response=conn.getresponse()
                    assert response.status==200
                    report["officialWebVersionViaTunnel"]=response.read(32).decode("ascii").strip()
                    assert report["officialWebVersionViaTunnel"]==a.web_version
                finally:
                    conn.close()
            (a.evidence/"result.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf8")
            print(json.dumps(report),flush=True)
        finally:
            (a.evidence/"network.json").write_text(json.dumps(records,indent=2)+"\n",encoding="utf8")
            for command, rule in reversed(rules):
                adb("shell", command, "-D", *rule)
            adb("shell","settings","put","global","http_proxy",previous if previous not in ("","null") else ":0")
            adb("reverse","--remove",f"tcp:{HOST_PORT}")
            server.shutdown()


if __name__ == "__main__":
    main()
