"""Exercise the native helper, old/new executables, and rollback in a temporary directory."""
import hashlib
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

base = Path(__file__).resolve().parents[1]
csc = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
fixture = r'''
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
[assembly: AssemblyProduct("Lychee QA fixture")]
[assembly: AssemblyFileVersion("VERSION")]
[assembly: AssemblyCompany("Lychee / FAMILY")]
internal static class WindowsInstallationIdentity {
    public const string ComponentId = "COMPONENT", UpgradeCode = "FAMILY", ProductName = "Lychee Desktop QA INSTANCE";
    public const bool IsTestBuild = IS_TEST;
}
static class Entry {
    static int Main(string[] a) {
        int code;
        if (WindowsUpdateApply.TryRun(a, out code)) return code;
        string root = Environment.GetEnvironmentVariable("LYCHEE_TEST_ROOT");
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        if (a.Length > 0 && a[0] == "check-msi") {
            try { WindowsUpdateApply.Installer.CheckPackage(a[1], a[2], a[3]); return 0; }
            catch (Exception) { return 5; }
        }
        if (a.Length > 0 && a[0] == "hold") {
            File.WriteAllText(Path.Combine(root, "holding"), "");
            while (!File.Exists(Path.Combine(root, "release"))) Thread.Sleep(30);
            return 0;
        }
        if (a.Length > 0 && a[0] == "update") {
            try {
                WindowsUpdateApply.Start(a[1],a[2],a[3],"exe",exe,true,"http://127.0.0.1:19191/");
                return 0;
            } catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 5; }
        }
        if (a.Length != 2 || a[0] != "--test-local" || a[1] != "http://127.0.0.1:19191/") return 28;
        bool recovered = WindowsUpdateApply.ConsumeRecoveryNotice();
        if (WindowsUpdateApply.ConsumeRecoveryNotice()) return 29;
        File.AppendAllText(Path.Combine(root, "opened"), "VERSION|" + exe + "|" + recovered + Environment.NewLine);
        if (FAIL) return 11;
        WindowsUpdateApply.ConfirmReady();
        Thread.Sleep(1700);
        return 0;
    }
}
'''


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wait_for(predicate):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.08)
    raise TimeoutError('Update did not finish')


def run():
    sys.path.insert(0, str(base / 'desktop'))
    import installer
    instance = str(uuid.uuid4())
    family = installer.guid('upgrade', instance)
    component = installer.guid('component/main', instance)
    with tempfile.TemporaryDirectory(prefix="lychee-update-apply-") as temp:
        root = Path(temp)
        app_dir = root / "Portable copy with spaces"
        app_dir.mkdir()
        target = app_dir / "My Lychee.exe"
        env = dict(os.environ, TEMP=temp, TMP=temp, LYCHEE_TEST_ROOT=temp)
        def compile_app(name, version, identity=family, fail=False, qa=True):
            src = root / (name + '.cs')
            src.write_text(fixture.replace('VERSION', version).replace('FAMILY', identity)
                           .replace('COMPONENT', component).replace('INSTANCE', instance).replace('FAIL', str(fail).lower())
                           .replace('IS_TEST', str(qa).lower()), encoding='utf-8')
            out = root / (name + '.exe')
            subprocess.run([csc, '/nologo', '/platform:x64', '/warn:0', '/codepage:65001',
                            '/out:' + str(out), src, base / 'desktop/WindowsUpdateApply.cs'], check=True)
            return out

        old = compile_app('old', '7.0.0.0')
        new = compile_app('new', '7.0.1.0')
        broken = compile_app('broken', '7.0.1.0', fail=True)
        foreign = compile_app('foreign', '7.0.1.0', identity='{' + str(uuid.uuid4()).upper() + '}')
        prod = compile_app('prod', '7.0.0.0', qa=False)
        msi = root / 'identity-check.msi'
        installer.build(new, msi, '7.0.1', instance)
        old_product = installer.guid('product/7.0.0', instance)
        new_product = installer.guid('product/7.0.1', instance)
        for exe, version, previous, expected in [(old, '7.0.1', old_product, 0),
                                                  (old, '7.0.0', old_product, 5),
                                                  (old, '7.0.1', new_product, 5),
                                                  (foreign, '7.0.1', old_product, 5)]:
            checked = subprocess.run([exe, 'check-msi', msi, version, previous], env=env)
            assert checked.returncode == expected, 'MSI identity/version guard did not match the package'
        sentinel = app_dir / 'existing-user-data'
        sentinel.write_bytes(b'stored user data')
        def install(package, sha=None):
            return subprocess.run([target, 'update', package, sha or digest(package), '7.0.1'],
                                  env=env, capture_output=True, timeout=45).returncode

        shutil.copy2(prod, target)
        assert install(new) == 5, 'production build must reject the loopback feed'
        shutil.copy2(old, target)
        assert install(new, '0' * 64) == 5, 'invalid payload digest accepted'
        assert install(foreign) == 5, 'different build family accepted'
        assert install(old) == 5, 'mismatched payload version accepted'
        with subprocess.Popen([target, 'hold'], env=env) as other:
            try:
                wait_for(lambda: (root / 'holding').exists())
                assert install(new) == 5, 'another instance of this exact executable was running'
            finally:
                (root / 'release').touch()
                other.wait(timeout=8)
        assert digest(target) == digest(old)

        # A second, identically named portable copy must survive both operations.
        other_dir = root / 'different folder'
        other_dir.mkdir()
        other_copy = other_dir / target.name
        shutil.copy2(old, other_copy)
        (root / 'holding').unlink()
        (root / 'release').unlink()
        with subprocess.Popen([other_copy, 'hold'], env=env) as unrelated:
            try:
                wait_for(lambda: (root / 'holding').exists())
                for package, expected, opened in [(broken, old, ['7.0.1.0','7.0.0.0']), (new, new, ['7.0.1.0'])]:
                    journal = root / 'opened'
                    journal.unlink(missing_ok=True)
                    assert install(package) == 0, 'parent did not hand off'
                    wait_for(lambda: journal.exists() and len(journal.read_text().splitlines()) == len(opened))
                    assert journal.read_text().splitlines() == [
                        version + '|' + str(target) + ('|True' if version == '7.0.0.0' else '|False')
                        for version in opened]
                    wait_for(lambda: not any((root / 'LycheeWindowsUpdates').glob('*/helper.exe')))
                    assert digest(target) == digest(expected) and digest(other_copy) == digest(old)
                    assert sentinel.read_bytes() == b'stored user data'
                    assert {p.name for p in app_dir.iterdir()} == {target.name, sentinel.name}
                    # The fixture holds its process briefly after confirming startup.
                    time.sleep(1.9)
            finally:
                (root / 'release').touch()
                unrelated.wait(timeout=8)
        print('Verified portable replacement and rollback, exact original name/path, live-copy exclusion, '
              'unrelated copy and user data, version+identity+SHA-256, loopback restriction, relaunch and cleanup. '
              'Verified MSI family, product code, component and version using read-only Windows Installer APIs.')


if __name__ == '__main__':
    run()
