"""Compile the actual .NET Framework updater and exercise it against an isolated HTTP fixture."""
from concurrent.futures import ThreadPoolExecutor
import copy
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import socket
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid


DESKTOP = Path(__file__).resolve().parents[1] / "desktop"
PAYLOAD = {}
RAW = "/windows-update/stable.json"
MANIFEST = {"schema": 1, "version": "7.0.1", "assets": []}
HARNESS = """
using System;
using System.IO;
using System.Linq;
[assembly: System.Reflection.AssemblyFileVersion("7.0.0.0")]
internal static class Fixture {
  static int Main(string[] args) {
    try {
      var origin=new Uri(args[args.Length-1]);
      var release=WindowsUpdateFeed.CheckAsync(origin).GetAwaiter().GetResult();
      string op=Console.ReadLine();
      if(op=="check"){ Console.WriteLine(release==null ? "current" : release.Version+" "+release.Assets.Count);return 0; }
      if(op=="policy qa"){
        var feed=typeof(WindowsUpdateFeed);
        var hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static;
        var payload=Convert.FromBase64String(Console.ReadLine());
        feed.GetMethod("Parse",hidden).Invoke(null,new object[]{payload,null});
        return 0;
      }
      string[] words=op.Split(' ');
      var file=WindowsUpdateFeed.DownloadAsync(release,words[0],origin).GetAwaiter().GetResult();
      try {
        if(!WindowsUpdateFeed.VerifyDownloaded(file))return 3;
        if(words.Length>1){
          byte[] bytes=File.ReadAllBytes(file.Path);bytes[0]^=1;File.WriteAllBytes(file.Path,bytes);
          if(WindowsUpdateFeed.VerifyDownloaded(file))return 4;
        }
        Console.WriteLine(file.Version+" "+file.Kind+" "+file.Length+" "+file.Sha256);
      }finally{File.Delete(file.Path);Directory.Delete(Path.GetDirectoryName(file.Path));}
      return 0;
    }catch(Exception e){Console.Error.WriteLine(e.GetType().Name+" "+e.Message);return 2;}
  }
}
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        cfg = self.server.model
        cfg["paths"].append(self.path)
        if cfg.get("disconnect") == self.path:
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if self.path == "/windows-update/stable.json":
            seq = cfg["manifests"]
            body = seq.pop(0) if len(seq) > 1 else seq[0]
            if isinstance(body, dict):
                body = json.dumps(body).encode()
            headers = cfg.get("manifest_headers", {})
            status = cfg.get("manifest_status", 200)
        else:
            kind = self.path.rsplit(".",1)[-1]
            wanted = "/windows-update/windows-v"+cfg.get("expected_version","7.0.1")+"/Lychee."+kind
            if kind not in PAYLOAD or self.path!=wanted:
                self.send_error(404)
                return
            body = cfg.get("body",PAYLOAD[kind])
            headers = cfg.get("headers",{})
            status = cfg.get("status",200)
        if cfg.get("slow_headers"): time.sleep(cfg["slow_headers"])
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        if cfg.get("slow_body"): time.sleep(cfg["slow_body"])
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


class WindowsFeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.work = Path(cls.temp.name)
        cls.app = cls.work / "fixture.exe"
        harness = cls.work / "Fixture.cs"
        harness.write_text(HARNESS, encoding="utf-8")
        csc = cls.csc = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
        subprocess.run([csc, "/nologo", "/codepage:65001", "/reference:System.Runtime.Serialization.dll",
                        "/reference:System.Net.Http.dll", "/out:" + str(cls.app),
                        str(DESKTOP / "WindowsUpdateFeed.cs"), str(harness)], check=True)
        # Inert binaries contain genuine Win32 file-version resources and Windows Installer metadata.
        inert = cls.work / "inert.cs"
        inert.write_text("class Inert {static void Main(){}}")
        exe = cls.work / "Lychee.exe"
        cls.instance = str(uuid.uuid4())
        identity = cls.work / "identity.cs"
        subprocess.run([sys.executable,DESKTOP/"build_identity.py",identity,"--version","7.0.1","--qa-instance",cls.instance],check=True)
        subprocess.run([csc,"/nologo","/out:"+str(exe),str(inert),str(identity)], check=True)
        msi = cls.work / "Lychee.msi"
        subprocess.run([sys.executable,DESKTOP/"installer.py",exe,msi,"--version","7.0.1","--qa-instance",cls.instance],check=True)
        for kind,path in [("exe",exe),("msi",msi)]:
            body = PAYLOAD[kind] = path.read_bytes()
            MANIFEST["assets"].append({"kind":kind,"name":path.name,"length":len(body),"sha256":sha256(body).hexdigest()})
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.http.server_close)
        cls.addClassCleanup(cls.http.shutdown)
        cls.origin = f"http://127.0.0.1:{cls.http.server_port}/"

    def setUp(self):
        self.http.model = {"manifests": [copy.deepcopy(MANIFEST)], "paths": []}

    def request(self, op="check", *, args=None, ok=True):
        result = subprocess.run([self.app, *(args if args is not None else ["--test-local", self.origin])],
                                input=(op+"\n").encode(), capture_output=True, timeout=15,
                                env={**os.environ, "TEMP": str(self.work), "TMP": str(self.work)})
        self.assertEqual(result.returncode, 0 if ok else 2, result.stderr)
        return result.stdout.decode("ascii").strip()

    def test_both_verified_packages_and_last_minute_tamper_check(self):
        self.assertEqual(self.request(), "7.0.1 2")
        for kind, body in PAYLOAD.items():
            with self.subTest(kind=kind):
                expected = f"7.0.1 {kind} {len(body)} {sha256(body).hexdigest()}"
                self.assertEqual(self.request(kind+" tamper"), expected)
        self.assertEqual(self.http.model["paths"].count("/windows-update/stable.json"), 5)

    def test_never_follows_redirects_even_to_the_same_file(self):
        path="/windows-update/windows-v7.0.1/Lychee.exe"
        for target in [path+"?download=1","https://github.com/example","//127.0.0.1:9/file","/other"]:
            self.http.model.update(paths=[],status=302,headers={"Location":target})
            self.request("exe",ok=False)
            self.assertEqual(self.http.model["paths"],[RAW,RAW,path])

    def test_production_manifest_rejects_test_instance(self):
        import base64
        payload = json.dumps({**MANIFEST,"qaInstance":self.instance}).encode()
        self.request("policy qa\n"+base64.b64encode(payload).decode("ascii"),ok=False)

    def test_changed_manifest_including_unselected_package(self):
        for mutate in [lambda m: m.update(version="7.0.2"),
                       lambda m: m["assets"][1].update(sha256="0"*64)]:
            first, second = copy.deepcopy(MANIFEST), copy.deepcopy(MANIFEST)
            mutate(second)
            self.http.model.update(manifests=[first, second], paths=[])
            self.request("exe", ok=False)
            self.assertEqual(self.http.model["paths"], ["/windows-update/stable.json"]*2)

    def test_digest_length_and_body_limits(self):
        for cfg in [{"body": b"x"*len(PAYLOAD["exe"])}, {"body": PAYLOAD["exe"][:-1]},
                    {"body": PAYLOAD["exe"]+b"!"}, {"headers": {"Content-Length":"9999999999"}},
                    {"status": 206}, {"headers": {"Content-Encoding":"gzip"}}]:
            self.http.model = {"paths":[], "manifests":[MANIFEST], **cfg}
            self.request("exe", ok=False)
            self.assertEqual(self.http.model["paths"],[RAW,RAW,"/windows-update/windows-v7.0.1/Lychee.exe"])
        self.assertFalse(list(self.work.rglob("*.partial")))

    def test_hash_correct_but_version_or_file_type_wrong(self):
        for kind in PAYLOAD:
            fake = copy.deepcopy(MANIFEST)
            body = PAYLOAD["msi" if kind=="exe" else "exe"]
            asset = next(a for a in fake["assets"] if a["kind"] == kind)
            asset.update(sha256=sha256(body).hexdigest(),length=len(body))
            self.http.model.update(manifests=[fake],body=body,expected_version="7.0.1")
            self.request(kind,ok=False)
            wrong = copy.deepcopy(MANIFEST)
            wrong["version"] = "7.0.2"
            self.http.model.update(manifests=[wrong],body=PAYLOAD[kind],expected_version="7.0.2")
            self.request(kind,ok=False)

    def test_manifest_schema_paths_bounds_and_test_origin(self):
        for mutate in [lambda d: d.update(schema=2), lambda d: d.update(version="7.0.01"), lambda d: d.update(version="7.0.1.0"),
                       lambda d: d["assets"].pop(), lambda d: d["assets"].append(d["assets"][0]),
                       lambda d: d["assets"][0].update(kind="msi", name="Lychee.msi"),
                       lambda d: d["assets"][0].update(name="../Lychee.exe"), lambda d: d["assets"][1].update(length=268435457),
                       lambda d: d["assets"][0].update(sha256="f"), lambda d: d.update(url="https://example.invalid/")]:
            value = copy.deepcopy(MANIFEST)
            mutate(value)
            self.http.model.update(manifests=[value])
            self.request(ok=False)
        self.http.model.update(manifests=[b"x"*16385])
        self.request(ok=False)
        for args in [[self.origin], ["--test-local",self.origin+"nested/"], ["--test-local","http://localhost:9/"]]:
            self.request(args=args, ok=False)
        self.http.model.update(manifests=[MANIFEST], manifest_status=302, manifest_headers={"Location":"/other"})
        self.request(ok=False)

    def test_concurrent_downloads_are_independent(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.request, ["exe", "exe"]))
        self.assertEqual(results[0], results[1])

    def test_official_manifest_unavailable_or_invalid_never_tries_alternate(self):
        for status,body,headers in [(404,b"",{}),(403,b"",{}),(429,b"",{}),(503,b"",{}),
                                    (302,b"",{"Location":"https://github.com/example"}),(200,b"bad JSON",{})]:
            self.http.model.update(paths=[],manifest_status=status,manifests=[body],manifest_headers=headers)
            self.request(ok=False)
            self.assertEqual(self.http.model["paths"],[RAW])
        self.http.model.update(paths=[],disconnect=RAW)
        self.request(ok=False)
        self.assertEqual(set(self.http.model["paths"]),{RAW})

    def test_slow_headers_and_body_stay_on_official_path(self):
        for mode in ["slow_headers","slow_body"]:
            self.http.model={"paths":[],"manifests":[MANIFEST],mode:0.30}
            self.request("msi")
            self.assertEqual(self.http.model["paths"],[RAW,RAW,"/windows-update/windows-v7.0.1/Lychee.msi"])

    def test_both_package_kinds_fail_closed_on_official_outage(self):
        for kind in PAYLOAD:
            asset="/windows-update/windows-v7.0.1/Lychee."+kind
            for status in [404,429,503]:
                self.http.model.update(paths=[],status=status)
                self.request(kind,ok=False)
                self.assertEqual(self.http.model["paths"],[RAW,RAW,asset])
        self.assertFalse(list(self.work.rglob("*.partial")))

    def test_generator_checks_both_versions_and_payload_before_atomic_replace(self):
        output = self.work / "staged" / "stable.json"
        def generate(version, packages, *identity):
            return subprocess.run([sys.executable, DESKTOP/"update_feed.py", "--packages", packages,
                                   "--version", version, "--output", output, *identity], capture_output=True)
        qa = ["--qa-instance",self.instance]
        result = generate("7.0.1", self.work, *qa)
        self.assertEqual(result.returncode,0,result.stderr)
        generated = json.loads(output.read_text(encoding="utf8"))
        self.assertEqual(generated,{**MANIFEST,"qaInstance":self.instance})
        self.http.model["manifests"] = [generated]
        self.assertEqual(self.request(),"7.0.1 2")
        previous = output.read_bytes()
        for version,options in [("7.0.2",qa),("7.0.1",[]),("7.0.1",["--qa-instance",str(uuid.uuid4())])]:
            self.assertNotEqual(generate(version,self.work,*options).returncode,0)
        self.assertEqual(output.read_bytes(),previous)
        changed = self.work / "mismatch"
        changed.mkdir()
        (changed/"Lychee.exe").write_bytes(PAYLOAD["exe"]+b"changed after packing")
        (changed/"Lychee.msi").write_bytes(PAYLOAD["msi"])
        self.assertNotEqual(generate("7.0.1",changed,*qa).returncode,0)
        self.assertEqual(output.read_bytes(),previous)

    def test_generator_requires_the_production_identity_on_both_packages(self):
        package = self.work / "production-shape"
        package.mkdir()
        identity, exe, msi = (package/name for name in ["identity.cs","Lychee.exe","Lychee.msi"])
        subprocess.run([sys.executable,DESKTOP/"build_identity.py",identity,"--version","7.0.1"],check=True)
        subprocess.run([self.csc,"/nologo","/out:"+str(exe),str(self.work/"inert.cs"),str(identity)],check=True)
        subprocess.run([sys.executable,DESKTOP/"installer.py",exe,msi,"--version","7.0.1"],check=True)
        output = package/"stable.json"
        command = [sys.executable,DESKTOP/"update_feed.py","--packages",package,"--version","7.0.1","--output",output]
        completed = subprocess.run(command,capture_output=True)
        self.assertEqual(completed.returncode,0,completed.stderr)
        self.assertNotIn("qaInstance",json.loads(output.read_bytes()))
        previous = output.read_bytes()
        exe.write_bytes(PAYLOAD["exe"])
        completed = subprocess.run(command,capture_output=True)
        self.assertNotEqual(completed.returncode,0)
        self.assertIn(b"EXE CompanyName",completed.stderr)
        self.assertEqual(output.read_bytes(),previous)


if __name__ == "__main__":
    unittest.main()
