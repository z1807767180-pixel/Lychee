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
import unittest
import uuid


DESKTOP = Path(__file__).resolve().parents[1] / "desktop"
PAYLOAD = {}
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
      if(op.StartsWith("policy ")){
        var feed=typeof(WindowsUpdateFeed);
        var hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static;
        if(op=="policy qa"){
          var payload=Convert.FromBase64String(Console.ReadLine());
          feed.GetMethod("Parse",hidden).Invoke(null,new object[]{payload,null});
          return 0;
        }
        var check=feed.GetMethod("RedirectAllowed",hidden);
        Console.WriteLine((bool)check.Invoke(null,new object[]{origin,new Uri(op.Substring(7)),null}));
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
        elif self.path == "/windows-update/repository":
            body = json.dumps(cfg.get("repo",{"id":1471636015,"full_name":"z1807767180-pixel/Lychee",
                                               "private":False,"default_branch":"main"})).encode()
            headers = {}
            status = cfg.get("repo_status",200)
        elif self.path.startswith("/windows-update/repository/releases?per_page=20&page="):
            page = int(self.path.rsplit("=",1)[-1])
            body = json.dumps(cfg.get("pages",{}).get(page,[])).encode()
            headers = cfg.get("page_headers",{}).get(page,{})
            status = cfg.get("page_status",{}).get(page,200)
        else:
            kind = self.path.partition("?")[0].rsplit(".", 1)[-1]
            if kind not in PAYLOAD or self.path.partition("?")[0] != "/windows-update/windows-v"+cfg.get("expected_version","7.0.1")+"/Lychee."+kind:
                self.send_error(404)
                return
            body = cfg.get("body", PAYLOAD[kind])
            headers = cfg.get("headers", {})
            status = cfg.get("status", 200)
            if cfg.get("redirect") and "?" not in self.path:
                headers = {"Location": cfg["redirect"]}
                status, body = 302, b""
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
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

    def test_package_redirects_and_retry(self):
        path = "/windows-update/windows-v7.0.1/Lychee.exe"
        for target in ["https://example.invalid/Lychee.exe", "/another/path", "http://127.0.0.1:9"+path]:
            self.http.model["redirect"] = target
            self.request("exe", ok=False)
        self.http.model["redirect"] = path+"?download=1"
        self.request("exe")
        self.assertIn(path+"?download=1", self.http.model["paths"])

    def test_official_cdn_policy_without_an_external_request(self):
        import base64
        path = "https://release-assets.githubusercontent.com/github-production-release-asset/1471636015/"+str(uuid.uuid4())
        self.assertEqual(self.request("policy "+path+"?signed=test"),"True")
        for bad in [path.replace("1471636015","7"),path.replace("https:","http:"),path.replace(".com/",".com.invalid/"),
                    path.replace(".com/",".com:1443/"),path+"#fragment",path.replace("https://","https://user@")]:
            self.assertEqual(self.request("policy "+bad),"False")
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

    def test_missing_manifest_requires_verified_repository_and_complete_stable_windows_list(self):
        def release(n,tag,assets=(),**flags):
            return {"id":n,"tag_name":tag,"draft":False,"prerelease":False,
                    "assets":[{"name":name} for name in assets],**flags}
        cfg = self.http.model
        cfg.update(manifest_status=404)
        self.assertEqual(self.request(),"current")
        self.assertEqual(cfg["paths"],["/windows-update/stable.json","/windows-update/repository",
                                       "/windows-update/repository/releases?per_page=20&page=1"])
        cfg["pages"]={1:[release(1,"windows-v6.4.7"),release(2,"v7.0.0",["Lychee.msi"]),
                         release(3,"android-v9.0.0",["Lychee.apk"]),release(4,"windows-v8.0.0",prerelease=True)]}
        self.assertEqual(self.request(),"current")
        cfg["pages"][1].append(release(5,"v7.1.0",["Lychee.exe"]))
        self.request(ok=False)
        cfg["pages"]={1:[release(i,"android-v8.0.0") for i in range(1,21)],2:[release(21,"windows-v7.0.1")]}
        self.request(ok=False)
        self.assertTrue(cfg["paths"][-1].endswith("page=2"))
        cfg["pages"][2]=[]
        self.assertEqual(self.request(),"current")
        cfg["pages"]={1:[release(1,"android-v9.0.0")],2:[release(2,"windows-v7.5.0")]}
        cfg["page_headers"]={1:{"Link":'<https://example.invalid/not-followed>; rel="next"'}}
        self.request(ok=False)
        cfg.update(pages={},page_headers={},page_status={1:403})
        self.request(ok=False)
        cfg.update(page_status={},repo_status=404)
        self.request(ok=False)
        cfg.update(repo_status=200,repo={"id":123,"full_name":"another/repo","private":False,"default_branch":"main"})
        self.request(ok=False)

    def test_damaged_manifest_and_unreachable_origin_do_not_report_current(self):
        cfg = self.http.model
        for status,body in [(500,b""),(403,b""),(200,b"bad JSON")]:
            cfg.update(paths=[],manifest_status=status,manifests=[body])
            self.request(ok=False)
            self.assertEqual(cfg["paths"],["/windows-update/stable.json"])
        cfg.update(manifest_status=404,pages={1:[{"id":1,"tag_name":"windows-vNext","draft":False,"prerelease":False,"assets":[]}]})
        self.request(ok=False)
        cfg["pages"]={1:{"message":"not available"}}
        self.request(ok=False)
        cfg.update(paths=[],disconnect="/windows-update/stable.json")
        self.request(ok=False)
        self.assertEqual(set(cfg["paths"]),{"/windows-update/stable.json"})
        cfg.update(disconnect="/windows-update/repository/releases?per_page=20&page=1",pages={})
        self.request(ok=False)

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
