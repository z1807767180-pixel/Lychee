from pathlib import Path
import base64, hashlib, json, struct, sys
signature = json.loads(Path(sys.argv[2]).read_text())
original = Path(sys.argv[1]).read_bytes()
def check(data, key):
    if hashlib.sha256(data).hexdigest() != signature[key]:
        raise ValueError('APK digest mismatch: ' + key)
check(original, 'unsignedSha256')
block = base64.b64decode(signature['signingBlock'], validate=True)
start, end = signature['insertAt'], signature['eocd']
if original[end:end+4] != b'PK\x05\x06' or struct.unpack_from('<I', original, end+16)[0] != start:
    raise ValueError('Original ZIP layout changed')
result = bytearray(original[:start] + block + original[start:])
struct.pack_into('<I', result, end + len(block) + 16, start + len(block))
check(result, 'signedSha256')
Path(sys.argv[3]).write_bytes(result)
