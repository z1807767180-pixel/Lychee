"""Rebuild both sides with one isolated MSI upgrade family and exact release HTML."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from zipfile import ZipFile

root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser()
p.add_argument('old',type=Path)
p.add_argument('new',type=Path)
p.add_argument('out',type=Path)
p.add_argument('--old-revision',required=True)
args=p.parse_args()
out=args.out.resolve()
out.mkdir(parents=True,exist_ok=True)
identity=out/'instance.txt'
if not identity.exists():
    identity.write_text(str(uuid4()),encoding='ascii')
instance=identity.read_text('ascii').strip()
archive=subprocess.check_output(['git','archive','--format=zip',args.old_revision,'source/desktop'],cwd=root)
with ZipFile(io.BytesIO(archive)) as files:
    files.extractall(out/'old-source')
ps="""$ErrorActionPreference='Stop'
$asm=[Reflection.Assembly]::LoadFile($env:LYCHEE_INPUT_EXE)
foreach($entry in @(@('Lychee.Site','site.zip'),@('Lychee.WindowIcon','lychee.ico'))){
  $stream=$asm.GetManifestResourceStream($entry[0])
  $writer=[IO.File]::Create((Join-Path $env:LYCHEE_OUTPUT_DIRECTORY $entry[1]))
  try{$stream.CopyTo($writer)}finally{$writer.Dispose();$stream.Dispose()}
}"""
for name,package,code in [('old',args.old,out/'old-source/source/desktop'),('new',args.new,root/'source/desktop')]:
    path=out/name
    path.mkdir(exist_ok=True)
    exe=(package/'Lychee.exe').resolve()
    manifest=json.loads((package/'stable.json').read_bytes())
    assert hashlib.sha256(exe.read_bytes()).hexdigest()==next(a['sha256'] for a in manifest['assets'] if a['kind']=='exe')
    env=dict(os.environ,LYCHEE_INPUT_EXE=str(exe),LYCHEE_OUTPUT_DIRECTORY=str(path))
    subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',ps],env=env,check=True)
    with ZipFile(path/'site.zip') as z:
        z.extractall(path/'site')
    subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(code/'build.ps1'),
                    '-SiteZip',str(path/'site.zip'),'-Icon',str(path/'lychee.ico'),'-OutputExe',str(path/'Lychee.exe'),
                    '-Version',manifest['version'],'-QaInstance',instance,'-Python',sys.executable],check=True)
    subprocess.run([sys.executable,str(code/'installer.py'),str(path/'Lychee.exe'),str(path/'Lychee.msi'),
                    '--version',manifest['version'],'--icon',str(path/'lychee.ico'),'--qa-instance',instance],check=True)
print(instance)

