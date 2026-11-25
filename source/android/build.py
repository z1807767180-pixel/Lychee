"""Prepare and verify the release assets or build the actual Capacitor Gradle APK."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from zipfile import ZipFile
from mobile_assets import unpack

ROOT = Path(__file__).resolve().parent
PINS = {
    '@capacitor/android': 'sha512-N7TbddaZhB7R6mKEqxufkQCZFiCEdEABI9TULV9fRPfxdG7T/43VCZO4flaK1ZxE9hb6YGgFvF+ZtzNmlqZ5nQ==',
    '@capacitor/core': 'sha512-exWuVUuAz0WPOLI/N59wEROIyrds54IKtfE+gF2yKpQPnwBU9ecfnr0dREEKbxG4zctR/uVxJXNoR7lglFXwnw==',
    '@capacitor/cli': 'sha512-ASErzlycnPGMM/vK8wYlV217RCXZ0VOP0BhKb9phW+jTE61Z4fad51WU2Yi8MbtIDcKYiXsNfmN8Nr5PV5j43g==',
}
BOOT = b'<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>\xe8\x8d\x94\xe6\x9e\x9d</title></html>'


def run(*args):
    subprocess.run([str(i) for i in args], cwd=ROOT, check=True)


def lock_dependencies():
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    lock = ROOT/'package-lock.json'
    if not lock.is_file():
        run(npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--before=2026-11-25T00:00:00Z')
    entries = json.loads(lock.read_text('utf8'))['packages']
    for package, sri in PINS.items():
        record = entries['node_modules/'+package]
        if (record.get('version'),record.get('integrity')) != ('8.6.1',sri):
            raise ValueError('Unexpected Capacitor dependency '+package)
    for name, record in entries.items():
        if name and (not record.get('resolved','').startswith('https://registry.npmjs.org/') or not record.get('integrity')):
            raise ValueError('Unverified npm dependency '+name)
    run(npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund')


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--assets', type=Path, required=True)
    cli.add_argument('--sha256', required=True)
    cli.add_argument('--expected-build', required=True)
    cli.add_argument('--prepare-only', action='store_true')
    cli.add_argument('--unsigned-release', action='store_true')
    cli.add_argument('--out', type=Path)
    args = cli.parse_args()
    if not re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{1,2}',args.expected_build):
        cli.error('Expected a numeric client release')
    files = unpack(args.assets, args.sha256, args.expected_build)
    files['index.html'] = BOOT
    www = ROOT/'www'
    for path in www.rglob('*'):
        if path.is_file() and path.relative_to(www).as_posix() not in files:
            raise ValueError('Unexpected previous asset; choose a clean checkout: '+str(path))
    for name, data in files.items():
        path = www/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    if sha256((ROOT/'android/gradle/wrapper/gradle-wrapper.jar').read_bytes()).hexdigest() != '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172':
        raise ValueError('Unexpected Gradle wrapper')
    print(f'{args.expected_build}: verified {len(files)-1} mobile assets and prepared Capacitor webDir.',flush=True)
    if args.prepare_only: return
    if args.out is None: cli.error('--out is required for an APK build')
    lock_dependencies()
    run('node',ROOT/'node_modules/@capacitor/cli/bin/capacitor','sync','android')
    major,minor,patch = map(int,args.expected_build.split('.'))
    code = major*10000+minor*100+patch
    wrapper = ROOT/'android'/('gradlew.bat' if os.name=='nt' else 'gradlew')
    if args.unsigned_release:
        run(*([] if os.name=='nt' else ['bash']), wrapper, '-p', ROOT/'android', '--no-daemon',
            f'-PlycheeCode={code}', f'-PlycheeVersion={args.expected_build}', ':app:assembleRelease')
        apk = ROOT/'android/app/build/outputs/apk/release/app-release-unsigned.apk'
        with ZipFile(apk) as package:
            if not package.read('classes.dex').startswith(b'dex\n') or any(
                    package.read('assets/public/'+name) != expected for name,expected in files.items()):
                raise ValueError('Release code or bundled assets differ')
        args.out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(apk, args.out)
        print('Prepared release APK for offline signing:', sha256(apk.read_bytes()).hexdigest())
        return
    run(*([] if os.name=='nt' else ['bash']),wrapper,'-p',ROOT/'android','--no-daemon',
        f'-PlycheeCode={code}',f'-PlycheeVersion={args.expected_build}-debug',':app:assembleDebug')
    apk = ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'
    sdk = os.getenv('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT']
    tools = Path(sdk)/'build-tools/36.0.0'
    run(tools/('apksigner.bat' if os.name=='nt' else 'apksigner'),'verify','--verbose','--print-certs',apk)
    run(tools/('zipalign.exe' if os.name=='nt' else 'zipalign'),'-c','4',apk)
    aapt = tools/('aapt2.exe' if os.name=='nt' else 'aapt2')
    badging = subprocess.check_output([str(aapt),'dump','badging',str(apk)]).decode('utf8','replace')
    for value in ["name='dev.lychee.pilot'",f"versionName='{args.expected_build}-debug'","name='dev.lychee.pilot.MainActivity'"]:
        if value not in badging: raise ValueError('Unexpected APK identity: '+value)
    with ZipFile(apk) as package:
        for name, expected in files.items():
            if package.read('assets/public/'+name) != expected: raise ValueError('APK asset mismatch: '+name)
        config = json.loads(package.read('assets/capacitor.config.json'))
        if config['server'] != json.loads((ROOT/'capacitor.config.json').read_text('utf8'))['server']:
            raise ValueError('APK server settings differ')
        if not package.read('classes.dex').startswith(b'dex\n'): raise ValueError('Missing Android bytecode')
    args.out.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(apk,args.out)
    print('Verified APK SHA-256:',sha256(apk.read_bytes()).hexdigest())


if __name__=='__main__':
    main()
