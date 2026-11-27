"""Prepare the current, offline-signed Android friends APK for the Lychee HTTPS origin."""
import base64
import hashlib
import io
import json
import re
import struct
import tempfile
from pathlib import Path
from zipfile import ZipFile


FRIENDS_CERTIFICATE = "19637a4493577f2f09de340464bed2775e9c3274486827c1c2073d131b0824e2"
ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
MAX_APK_BYTES = 128 * 1024 * 1024


def manifest_attributes(data):
    # Android ResourceTypes.h: read the string pool and the first XML start element.
    doc_type, offset, doc_size = struct.unpack_from("<HHI", data)
    if doc_type != 3 or offset < 8 or doc_size != len(data):
        raise ValueError("Invalid binary Android manifest")
    strings = []
    while offset < len(data):
        kind, header, size = struct.unpack_from("<HHI", data, offset)
        if not 8 <= header <= size <= len(data) - offset:
            raise ValueError("Invalid Android manifest chunk")
        chunk = data[offset:offset+size]
        offset += size
        if kind == 1:
            count, _, flags, start = struct.unpack_from("<IIII", chunk, 8)
            if count > (len(chunk)-header)//4:
                raise ValueError("Invalid Android manifest strings")
            for index in range(count):
                pos = start + struct.unpack_from("<I", chunk, header + index*4)[0]
                if flags & 0x100:
                    pos += 2 if chunk[pos] & 0x80 else 1
                    length = chunk[pos]
                    pos += 1
                    if length & 0x80:
                        length = ((length & 0x7f) << 8) | chunk[pos]
                        pos += 1
                    strings.append(chunk[pos:pos+length].decode("utf8"))
                else:
                    length = struct.unpack_from("<H", chunk, pos)[0]
                    pos += 2
                    if length & 0x8000:
                        length = ((length & 0x7fff) << 16) | struct.unpack_from("<H", chunk, pos)[0]
                        pos += 2
                    strings.append(chunk[pos:pos+length*2].decode("utf-16-le"))
        elif kind == 0x0102:
            _, tag, first, stride, count = struct.unpack_from("<IIHHH", chunk, header)
            if strings[tag] != "manifest" or stride < 20 or header + first + count*stride > size:
                raise ValueError("Missing Android manifest root")
            values = {}
            for index in range(count):
                at = header + first + index*stride
                namespace, name, _, _, _, value_type, value = struct.unpack_from("<IIIHBBI", chunk, at)
                key = (None if namespace == 0xffffffff else strings[namespace], strings[name])
                if key in values:
                    raise ValueError("Duplicate Android manifest attribute")
                values[key] = strings[value] if value_type == 3 else value
            return values
    raise ValueError("Missing Android manifest")


def field(data):
    length = struct.unpack_from("<I", data)[0]
    if length > len(data) - 4:
        raise ValueError("Truncated APK signing field")
    return data[4:4+length], data[4+length:]


def check_receipt(apk, receipt):
    digest = hashlib.sha256(apk).hexdigest()
    if digest != receipt["signedSha256"]:
        raise ValueError("Android APK does not match its signing receipt")
    block = base64.b64decode(receipt["signingBlock"], validate=True)
    at = receipt["insertAt"]
    if type(at) is not int or at < 0 or apk[at:at+len(block)] != block or not block.endswith(b"APK Sig Block 42"):
        raise ValueError("Android signing block differs from its receipt")
    # The receipt may include zipalign padding before the APK Signing Block.
    size = struct.unpack_from("<Q", block, len(block)-24)[0]
    start = len(block)-8-size
    if start < 0 or size < 24 or struct.unpack_from("<Q", block, start)[0] != size:
        raise ValueError("Invalid APK signing block size")
    pos, end = start+8, len(block)-24
    certs = []
    while pos < end:
        length, scheme = struct.unpack_from("<QI", block, pos)
        if not 4 <= length <= end-pos-8:
            raise ValueError("Invalid APK signing pair")
        pair = block[pos+12:pos+8+length]
        pos += 8+length
        if scheme == 0x7109871a:  # APK Signature Scheme v2
            signers, tail = field(pair)
            signer, others = field(signers)
            if others or tail:
                raise ValueError("Expected one Android friends signer")
            signed, _ = field(signer)
            _, rest = field(signed)
            certificates, _ = field(rest)
            leaf, _ = field(certificates)
            certs.append(hashlib.sha256(leaf).hexdigest())
    if certs != [FRIENDS_CERTIFICATE]:
        raise ValueError("Unexpected Android friends signing certificate")
    return digest


def download_page(version, path):
    return f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>荔枝安卓朋友版下载</title>
<style>
body{{margin:0;background:#faf5e7;color:#244b41;font:17px/1.65 system-ui,sans-serif}}
main{{max-width:35em;margin:8vh auto;padding:1.5em}} h1{{line-height:1.2}}
a{{display:inline-block;padding:.55em 1.15em;border-radius:9px;background:#245447;color:white;text-decoration:none}}
a:focus-visible{{outline:3px solid #b95734;outline-offset:3px}}
</style><main><h1>荔枝安卓朋友版</h1><p>正式版 V{version}</p>
<a href="{path}" download>下载安卓安装包</a><p>下载完成后打开 APK，按手机提示安装。已安装朋友版的用户可以直接覆盖升级。</p></main></html>"""


def prepare(release_path, packages, output):
    release = json.loads(release_path.read_bytes())
    version, note = release["version"], release["note"]
    if (not isinstance(version, str) or not re.fullmatch(r"(?:0|[1-9][0-9]?)(?:\.(?:0|[1-9][0-9]?)){2}", version)
            or not isinstance(note, str) or not note.strip() or len(note.encode("utf-16-le")) > 2000):
        raise ValueError("Invalid Android release version or notice")
    filename = f"Lychee-Friends-V{version}.apk"
    source = packages / filename
    if not 0 < source.stat().st_size <= MAX_APK_BYTES or output.exists():
        raise ValueError("Need the Android release APK and a new output directory")
    apk = source.read_bytes()
    digest = check_receipt(apk, json.loads((packages/"signature.json").read_bytes()))
    with ZipFile(io.BytesIO(apk)) as archive:
        info = archive.getinfo("AndroidManifest.xml")
        if info.file_size > 1024*1024:
            raise ValueError("Android manifest too large")
        attrs = manifest_attributes(archive.read(info))
    major, minor, patch = map(int, version.split("."))
    if (attrs.get((None,"package")) != "dev.lychee.friends" or attrs.get((ANDROID_NAMESPACE,"versionName")) != version
            or attrs.get((ANDROID_NAMESPACE,"versionCode")) != major*10000 + minor*100 + patch):
        raise ValueError("Android app identity or embedded version does not match the release")
    tag = "android-friends-v" + version
    feed = {"version": version, "note": note, "sha256": digest}
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        root = Path(tmp) / "android-update"
        directory = root / tag
        directory.mkdir(parents=True)
        (directory/filename).write_bytes(apk)
        (root/"current.json").write_text(json.dumps(feed, ensure_ascii=False, indent=2)+"\n", encoding="utf8")
        (root/"download.html").write_text(download_page(version,tag+"/"+filename), encoding="utf8")
        root.rename(output)
