"""Build one Windows EXE, its per-user MSI, and the matching independent mobile frontend."""
import sys, shutil, subprocess, argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
def run(*args):
    subprocess.run([str(a) for a in args],check=True,cwd=ROOT)
def build(out):
    out=out.resolve();out.mkdir(parents=True,exist_ok=True)
    run(sys.executable,ROOT/'build.py')
    run(sys.executable,ROOT/'launch/build.py',ROOT/'public',out/'site')
    icon=out/'lychee.ico'
    with Image.open(out/'site/mobile/icon.png') as img:
        img.convert('RGBA').save(icon,sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
    with ZipFile(out/'site.zip','w',ZIP_DEFLATED,compresslevel=5) as zipped:
        for f in sorted((out/'site').rglob('*')):
            if f.is_file():zipped.write(f,f.relative_to(out/'site'))
    run('powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',ROOT/'desktop/build.ps1','-SiteZip',out/'site.zip','-Icon',icon,'-OutputExe',out/'Lychee.exe')
    run(sys.executable,ROOT/'desktop/installer.py',out/'Lychee.exe',out/'Lychee.msi')
    run(sys.executable,ROOT/'desktop/verify-installer.py',out/'Lychee.msi',out/'Lychee.exe')
    destination=out/'mobile-static'
    shutil.copytree(ROOT/'static-host',destination,dirs_exist_ok=True)
    shutil.copytree(out/'site',destination/'public',dirs_exist_ok=True)
    for name in ('_routes.json','_headers'):
        shutil.copyfile(ROOT/'static-host'/name,destination/'public'/name)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('out',type=Path);build(p.parse_args().out)
