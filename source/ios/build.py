"""Prepare the frozen mobile assets and build a device IPA without signing credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
VERSION = json.loads((ROOT.parent / 'public-build.json').read_text(encoding='utf8'))['version']
APP_ID = 'dev.lychee.pilot.ios'
sys.path.insert(0, str(ROOT.parent / 'android'))
from mobile_assets import pack_checkout


def prepare():
    with tempfile.TemporaryDirectory() as work:
        files = pack_checkout(Path(work) / 'mobile.zip')
    if files['mobile/version.txt'].strip() != VERSION.encode():
        raise ValueError('Unexpected mobile release')
    web = OUT / 'www'
    for name, data in files.items():
        path = web / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    verify_resources(web, files)
    return files


def verify_resources(web, expected):
    actual = {p.relative_to(web).as_posix():p.read_bytes() for p in web.rglob('*') if p.is_file()}
    if actual != expected:
        raise ValueError('The application resources differ from the checked-out release')


def icon_catalog():
    catalog = OUT / 'Assets.xcassets'
    icon = catalog / 'AppIcon.appiconset'
    icon.mkdir(parents=True, exist_ok=True)
    info = {'version':1, 'author':'xcode'}
    (catalog / 'Contents.json').write_text(json.dumps({'info':info}))
    (icon / 'Contents.json').write_text(json.dumps({'info':info,
        'images':[{'filename':'icon.png','idiom':'universal','platform':'ios','size':'1024x1024'}]}))
    subprocess.run(['sips','-z','1024','1024',OUT/'www/mobile/icon.png','--out',icon/'icon.png'], check=True)


def compile_app(simulator=False):
    sdk = 'iphonesimulator' if simulator else 'iphoneos'
    products = OUT / sdk
    subprocess.run(['xcodebuild','-project',ROOT/'Lychee.xcodeproj','-target','Lychee','-configuration','Release',
                    '-sdk',sdk,'CODE_SIGNING_ALLOWED=NO','CODE_SIGNING_REQUIRED=NO','ENABLE_USER_SCRIPT_SANDBOXING=YES',
                    'CONFIGURATION_BUILD_DIR='+str(products),'OBJROOT='+str(OUT/'obj'/sdk),'SYMROOT='+str(OUT/'sym'/sdk),
                    'ARCHS=arm64','ONLY_ACTIVE_ARCH=NO','build'],check=True)
    return products/'Lychee.app'


def export(app, files):
    verify_resources(app/'www',files)
    info = plistlib.loads((app/'Info.plist').read_bytes())
    if (info['CFBundleIdentifier'], info['CFBundleShortVersionString'], info['CFBundleSupportedPlatforms']) != (
            APP_ID,VERSION,['iPhoneOS']):
        raise ValueError('Device build identity mismatch')
    binary = app / info['CFBundleExecutable']
    executable = binary.read_bytes()
    magic, cpu, _, kind, count = struct.unpack_from('<5I', executable)
    if (magic,cpu,kind) != (0xfeedfacf,0x0100000c,2):
        raise ValueError('Expected a 64-bit ARM executable')
    offset = 32
    for _ in range(count):
        command, size = struct.unpack_from('<II',executable,offset)
        if size < 8 or offset+size > len(executable):
            raise ValueError('Invalid Mach-O load command')
        if command == 0x32:  # LC_BUILD_VERSION
            platform, _, sdk = struct.unpack_from('<III',executable,offset+8)
            if platform != 2 or sdk >> 16 < 26:
                raise ValueError('Expected the iPhoneOS 26 or later device SDK')
            break
        offset += size
    else:
        raise ValueError('Missing iOS build version')
    destination = OUT / 'export'
    destination.mkdir(parents=True, exist_ok=True)
    ipa = destination/f'Lychee-{VERSION}-iPhone-unsigned.ipa'
    with ZipFile(ipa,'w',compression=ZIP_DEFLATED) as archive:
        for path in sorted(app.rglob('*')):
            if path.is_file():
                archive.write(path,'Payload/Lychee.app/'+path.relative_to(app).as_posix())
    with ZipFile(ipa) as archive:
        if archive.testzip() or archive.read('Payload/Lychee.app/Lychee') != binary.read_bytes():
            raise ValueError('Invalid IPA')
    digest = hashlib.sha256(ipa.read_bytes()).hexdigest()
    (destination/'SHA256.txt').write_text(f'{digest}  {ipa.name}\n')
    print('Verified unsigned iPhone package:',digest,ipa.name)


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--prepare-only',action='store_true')
    args = cli.parse_args()
    frozen = prepare()
    print('Verified',len(frozen),'frozen mobile files',flush=True)
    if not args.prepare_only:
        icon_catalog()
        export(compile_app(),frozen)
