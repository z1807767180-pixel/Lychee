"""Export the existing Android signing key once, or check a portable PKCS12 backup."""
import argparse
import getpass
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

# Public SHA-256 certificate digest verified on the distributed Android 6.4.7 APK.
CERT = "054fd27dbf65d9c734589ba3be6ab280eed888417b179fd725da99667d73b948"
ROOT = Path(__file__).resolve().parents[1]


def keytool(args, passwords, capture=False):
    exe = shutil.which("keytool")
    if not exe:
        raise SystemExit("Install JDK 21 and put its bin directory on PATH.")
    return subprocess.run([exe, *args], env={**os.environ, **passwords}, check=True,
                          stdout=subprocess.PIPE if capture else None)


def verify(store, alias, password):
    common = ["-keystore", str(store), "-storetype", "PKCS12", "-alias", alias,
              "-storepass:env", "LYCHEE_CHECK_PASSWORD"]
    env = {"LYCHEE_CHECK_PASSWORD": password}
    cert = keytool(["-exportcert", *common], env, capture=True).stdout
    if hashlib.sha256(cert).hexdigest() != CERT:
        raise ValueError("This is not the certificate of the published Lychee APK.")
    # A certificate alone cannot sign a CSR. This tests actual private-key access.
    keytool(["-certreq", *common, "-keypass:env", "LYCHEE_CHECK_PASSWORD"], env, capture=True)


def original_password(folder):
    if os.name != "nt":
        raise SystemExit("Export on the original Windows account; verification works on other systems.")
    command = (
        "$ErrorActionPreference='Stop'; "
        "$s=(Get-Content -Raw -LiteralPath $env:LYCHEE_DPAPI_PATH).Trim() | ConvertTo-SecureString; "
        "[Console]::Write([Net.NetworkCredential]::new('', $s).Password)"
    )
    return subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                          env={**os.environ, "LYCHEE_DPAPI_PATH": str(folder / "password.dpapi")},
                          check=True, stdout=subprocess.PIPE).stdout.decode("ascii")


def export(folder, target):
    if target.is_relative_to(ROOT) or target.is_relative_to(folder):
        raise ValueError("Choose a private backup directory outside the repository and the original key folder.")
    if target.exists() or not target.parent.is_dir():
        raise ValueError("Choose a new file in an existing private backup directory.")
    source = folder / "Lychee-release.p12"
    old = original_password(folder)
    verify(source, "1", old)
    new = getpass.getpass("New backup password (at least 16 ASCII characters): ")
    if len(new) < 16 or not new.isascii() or not new.isprintable() or new != getpass.getpass("Confirm password: "):
        raise ValueError("Passwords differ or do not meet the backup password requirements.")
    with tempfile.TemporaryDirectory(dir=target.parent) as tmp:
        staged = Path(tmp) / "backup.p12"
        keytool(["-importkeystore", "-srckeystore", str(source), "-srcstoretype", "PKCS12",
                 "-srcalias", "1", "-srcstorepass:env", "LYCHEE_OLD_PASSWORD",
                 "-destkeystore", str(staged), "-deststoretype", "PKCS12", "-destalias", "lychee",
                 "-deststorepass:env", "LYCHEE_NEW_PASSWORD", "-destkeypass:env", "LYCHEE_NEW_PASSWORD",
                 "-noprompt"], {"LYCHEE_OLD_PASSWORD": old, "LYCHEE_NEW_PASSWORD": new})
        verify(staged, "lychee", new)
        # Exclusive creation avoids overwriting any backup that appeared during export.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
        with os.fdopen(os.open(target, flags, 0o600), "wb") as out:
            with staged.open("rb") as src:
                shutil.copyfileobj(src, out)
    verify(target, "lychee", new)
    print("Portable backup created and checked:", target)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    sub = cli.add_subparsers(dest="command", required=True)
    create = sub.add_parser("export")
    create.add_argument("original_folder", type=Path)
    create.add_argument("new_backup", type=Path)
    check = sub.add_parser("verify")
    check.add_argument("backup", type=Path)
    args = cli.parse_args()
    if args.command == "export":
        export(args.original_folder.resolve(), args.new_backup.resolve())
    else:
        verify(args.backup.resolve(), "lychee", getpass.getpass("Backup password: "))
        print("Verified the release certificate and private-key signing access.")


if __name__ == "__main__":
    main()
