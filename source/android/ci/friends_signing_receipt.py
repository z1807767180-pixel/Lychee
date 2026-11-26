"""Store the public APK Signing Block so CI can verify an offline-signed artifact."""
from base64 import b64encode
from hashlib import sha256
import json
from pathlib import Path
import struct
import sys


def receipt(unsigned, signed):
    eocd = unsigned.rfind(b"PK\x05\x06")
    signed_eocd = signed.rfind(b"PK\x05\x06")
    if eocd < 0 or signed_eocd < eocd or len(unsigned) - eocd != len(signed) - signed_eocd:
        raise ValueError("Unexpected APK ZIP layout")
    before = struct.unpack_from("<I", unsigned, eocd + 16)[0]
    after = struct.unpack_from("<I", signed, signed_eocd + 16)[0]
    block = signed[before:after]
    if not block.endswith(b"APK Sig Block 42"):
        raise ValueError("Missing Android APK signing block")
    restored = bytearray(unsigned[:before] + block + unsigned[before:])
    struct.pack_into("<I", restored, eocd + len(block) + 16, after)
    if restored != signed:
        raise ValueError("Signed APK contains changes beyond its public signing block")
    return {"unsignedSha256":sha256(unsigned).hexdigest(), "signedSha256":sha256(signed).hexdigest(),
            "insertAt":before, "eocd":eocd, "signingBlock":b64encode(block).decode("ascii")}


if __name__ == "__main__":
    source, signed, output = map(Path, sys.argv[1:])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt(source.read_bytes(),signed.read_bytes()),separators=(",",":"))+"\n",encoding="utf8")
