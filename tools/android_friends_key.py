"""Private Windows signing for dev.lychee.friends. Only the certificate digest is public."""
import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
import getpass
import os
from pathlib import Path
import secrets
import subprocess

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

ALIAS = b"lychee-friends"
ROOT = Path(__file__).resolve().parents[1]
STORE = Path(os.environ["LOCALAPPDATA"]) / "LycheeSigning" / "FriendsAndroid"


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    buffer = ctypes.create_string_buffer(data)
    src = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    dst = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(src), None, None, None, None, 1, ctypes.byref(dst)):
        raise OSError("Windows could not open the current user's signing protection")
    try:
        return ctypes.string_at(dst.data, dst.size)
    finally:
        ctypes.memset(dst.data, 0, dst.size)
        ctypes.windll.kernel32.LocalFree(dst.data)


def save_new(path, data):
    with path.open("xb") as file:
        file.write(data)


def store_key(key, cert):
    password = secrets.token_urlsafe(48).encode()
    pfx = pkcs12.serialize_key_and_certificates(ALIAS, key, cert, None, serialization.BestAvailableEncryption(password))
    protection = protect(password)
    STORE.mkdir(parents=True, exist_ok=False)
    save_new(STORE / "unlock.dpapi", protection)
    save_new(STORE / "friends.p12", pfx)


def read_key():
    password = protect((STORE / "unlock.dpapi").read_bytes(), True)
    key, cert, _ = pkcs12.load_key_and_certificates((STORE / "friends.p12").read_bytes(), password)
    if not key or not cert or key.public_key() != cert.public_key():
        raise ValueError("Invalid signing identity")
    return key, cert, password


def main():
    parser = argparse.ArgumentParser()
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("init")
    for action in ("export", "restore"):
        sub = actions.add_parser(action)
        sub.add_argument("backup", type=Path)
        sub.add_argument("--certificate", required=True, help="Expected published certificate SHA-256")
    sign = actions.add_parser("sign")
    for arg in ("java", "jar", "unsigned", "output"):
        sign.add_argument(arg, type=Path)
    sign.add_argument("--certificate", required=True)
    args = parser.parse_args()
    if args.action == "init" and not STORE.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Lychee Friends Android Release")])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=1))
                .not_valid_after(now + timedelta(days=365*35)).sign(key, hashes.SHA256()))
        store_key(key, cert)
    if args.action == "restore":
        if STORE.exists():
            raise ValueError("The destination already has a signing directory")
        key, cert, _ = pkcs12.load_key_and_certificates(args.backup.read_bytes(), getpass.getpass("Backup password: ").encode())
        if cert.fingerprint(hashes.SHA256()).hex() != args.certificate.lower():
            raise ValueError("Different certificate")
        store_key(key, cert)
    key, cert, password = read_key()
    digest = cert.fingerprint(hashes.SHA256()).hex()
    if args.action != "init" and digest != args.certificate.lower():
        raise ValueError("Different certificate")
    if args.action == "export":
        target = args.backup.resolve()
        if target.is_relative_to(ROOT) or target.is_relative_to(STORE):
            raise ValueError("Choose a private location outside the project and signing directory")
        phrase = getpass.getpass("Independent backup password (16+ characters): ")
        if len(phrase) < 16 or phrase != getpass.getpass("Confirm password: "):
            raise ValueError("Invalid backup password")
        save_new(target, pkcs12.serialize_key_and_certificates(ALIAS,key,cert,None,serialization.BestAvailableEncryption(phrase.encode())))
        restored, certificate, _ = pkcs12.load_key_and_certificates(target.read_bytes(), phrase.encode())
        if not restored or certificate.fingerprint(hashes.SHA256()).hex() != digest:
            raise ValueError("Portable backup verification failed")
    if args.action == "sign":
        if args.output.exists():
            raise ValueError("Output already exists")
        subprocess.run([args.java, "-jar", args.jar, "sign", "--ks", STORE / "friends.p12", "--ks-key-alias", ALIAS.decode(),
                        "--ks-pass", "env:LYCHEE_FRIENDS_SIGN_PASSWORD", "--v1-signing-enabled", "false",
                        "--v2-signing-enabled", "true", "--v3-signing-enabled", "true", "--v4-signing-enabled", "false",
                        "--out", args.output, args.unsigned], check=True,
                       env={**os.environ, "LYCHEE_FRIENDS_SIGN_PASSWORD": password.decode()})
    print("Friends Android certificate SHA-256:", digest)


if __name__ == "__main__":
    main()
