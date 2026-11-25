"""Restore one named public source snapshot from a history ZIP."""
import argparse
from contextlib import nullcontext
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import uuid
from zipfile import ZipFile, is_zipfile

def relative(name):
    p=PurePosixPath(name)
    if not name or p.is_absolute() or str(p)!=name or any(c in name for c in '\\:*?"<>|') or '..' in p.parts or any(
        part.rstrip('. ')!=part or part.split('.')[0].upper() in {'CON','NUL','AUX','PRN',*('COM'+str(i) for i in range(1,10)),*('LPT'+str(i) for i in range(1,10))}
        for part in p.parts):
        raise ValueError('Unsafe snapshot path')
    return p

def run():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('version',nargs='?')
    cli.add_argument('dest',nargs='?',type=Path)
    cli.add_argument('--list',action='store_true')
    cli.add_argument('--archive',type=Path)
    args=cli.parse_args()
    source=args.archive or Path(sys.argv[0]).resolve()
    with (ZipFile(source) if is_zipfile(source) else nullcontext(None)) as z:
        read=z.read if z else lambda n:(source.parent/n).read_bytes()
        versions=json.loads(read('manifest.json'))['versions']
        if args.list:
            for key,rec in versions.items():print(key,len(rec['files']),rec['description'])
            return
        if args.version not in versions or not args.dest:cli.error('Choose a listed version and a new output directory')
        out=args.dest.resolve()
        if out.exists():cli.error('The output directory already exists')
        out.parent.mkdir(parents=True,exist_ok=True)
        stage=out.parent/(out.name+'.restoring-'+uuid.uuid4().hex)
        stage.mkdir()
        try:
            files=versions[args.version]['files']
            seen=set()
            for name,record in files.items():
                p=relative(name)
                if name.casefold() in seen:raise ValueError('Duplicate filename')
                seen.add(name.casefold())
                digest=record['sha256']
                if not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('Invalid digest')
                data=read('objects/'+digest)
                if sha256(data).hexdigest()!=digest or len(data)!=record['bytes']:raise ValueError('Content mismatch: '+name)
                target=stage.joinpath(*p.parts)
                target.parent.mkdir(parents=True,exist_ok=True)
                with target.open('xb') as f:f.write(data)
                if name.endswith('/gradlew'):target.chmod(0o755)
            if out.exists():raise FileExistsError(out)
            stage.rename(out)
            print(f'{args.version}: restored and verified {len(files)} files ({out})')
        finally:
            if stage.exists() and stage.resolve().parent==out.parent and stage.name.startswith(out.name+'.restoring-'):
                shutil.rmtree(stage)
if __name__=='__main__':run()
