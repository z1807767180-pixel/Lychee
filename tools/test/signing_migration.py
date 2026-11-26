"""Exercise the migration with a disposable key, never with project credentials."""
from contextlib import ExitStack
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import android_signing_backup as backup


def exercise(root):
    original = root / "original"
    original.mkdir()
    source = original / "Lychee-release.p12"
    old = secrets.token_hex(24)
    new = secrets.token_hex(24)
    backup.keytool(["-genkeypair", "-alias", "1", "-keyalg", "RSA", "-keysize", "2048",
                    "-validity", "2", "-dname", "CN=Disposable test", "-keystore", str(source),
                    "-storetype", "PKCS12", "-storepass:env", "FIXTURE_PASS"], {"FIXTURE_PASS": old})
    try:
        backup.verify(source, "1", old)
    except ValueError:
        pass
    else:
        raise AssertionError("Accepted a certificate other than the released APK signer")
    cert = backup.keytool(["-exportcert", "-alias", "1", "-keystore", str(source),
                           "-storepass:env", "FIXTURE_PASS"], {"FIXTURE_PASS": old}, capture=True).stdout
    original_hash = hashlib.sha256(source.read_bytes()).digest()
    target = root / "portable.p12"
    with ExitStack() as stack:
        stack.enter_context(patch.object(backup, "CERT", hashlib.sha256(cert).hexdigest()))
        stack.enter_context(patch.object(backup.getpass, "getpass", return_value=new))
        if os.name == "nt":
            ps = ("$ErrorActionPreference='Stop'; "
                  "$s=ConvertTo-SecureString $env:FIXTURE_PASS -AsPlainText -Force; "
                  "$s | ConvertFrom-SecureString | Set-Content -Encoding ascii password.dpapi")
            subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                           cwd=original, env={**os.environ, "FIXTURE_PASS": old}, check=True)
        else:
            stack.enter_context(patch.object(backup, "original_password", return_value=old))
        backup.export(original, target)
        assert hashlib.sha256(source.read_bytes()).digest() == original_hash
        shutil.rmtree(original)  # Only the disposable test fixture created above.
        backup.verify(target, "lychee", new)
    print("Recovered the test signing key with only the portable backup and its new password.")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        exercise(Path(temp))
