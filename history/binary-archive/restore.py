"""Restore original files from checksum-verified Git pack segments."""
import argparse
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT=Path(__file__).resolve().parent
def safe_path(name):
    p=PurePosixPath(name)
    reserved={'CON','AUX','NUL','PRN',*('COM'+str(n) for n in range(1,10)),*('LPT'+str(n) for n in range(1,10))}
    if (not name or str(p)!=name or p.is_absolute() or '..' in p.parts or any(c in name for c in '\\:*?"<>|') or
            any(v.endswith(('.',' ')) or v.split('.')[0].upper() in reserved for v in p.parts)):
        raise ValueError('Unsafe output path')
    return p

def select_rows(rows,selectors):
    if not selectors:return rows
    picked=[]
    for sel in selectors:
        if re.fullmatch('[0-9]{1,2}',sel) and 1<=int(sel)<=len(rows):matches=[rows[int(sel)-1]]
        else:
            matches=[r for r in rows if sel==r['path'] or
                     (re.fullmatch('[a-fA-F0-9]{8,64}',sel) and r['sha256'].startswith(sel.lower()))]
            if not matches:matches=[r for r in rows if PurePosixPath(r['path']).name==sel]
        if len(matches)!=1:raise ValueError('Unknown or ambiguous selector: '+sel+' (use an entry number, full relative path, or unique SHA-256 prefix)')
        if matches[0] not in picked:picked.append(matches[0])
    return picked

def copy_hashed(source,target):
    total=0
    digest=sha256()
    while chunk:=source.read(1024*1024):
        target.write(chunk)
        digest.update(chunk)
        total+=len(chunk)
    return total,digest.hexdigest()

def run():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--list',action='store_true')
    cli.add_argument('--select',action='append',default=[],metavar='ID_OR_PATH_OR_HASH')
    cli.add_argument('--out',type=Path,help='new output directory')
    args=cli.parse_args()
    index=json.loads((ROOT/'index.json').read_text('utf-8-sig'))
    if index['format']!=1:raise ValueError('Unsupported index')
    rows=index['originals']
    seen=set()
    for i,r in enumerate(rows,1):
        safe_path(r['path'])
        if r['path'].casefold() in seen or not re.fullmatch('[a-f0-9]{40}',r['gitBlob']) or not re.fullmatch('[a-f0-9]{64}',r['sha256']) or r['bytes']<0:
            raise ValueError('Invalid original metadata')
        seen.add(r['path'].casefold())
        if args.list:print(f"{i:02d}  {r['version']}  {r['type']}  {r['sha256']}  {r['path']}")
    if args.list:return
    if not args.out:cli.error('--out must name a new directory')
    chosen=select_rows(rows,args.select)
    out=args.out.resolve()
    if out.exists():cli.error('Output directory already exists')
    if not shutil.which('git'):cli.error('Install Git to restore the binary pack')
    out.parent.mkdir(parents=True,exist_ok=True)
    stage=out.parent/(out.name+'.restoring-'+uuid.uuid4().hex)
    stage.mkdir()
    try:
        with tempfile.TemporaryDirectory() as temp:
            tmp=Path(temp)
            repo=tmp/'repository'
            combined=tmp/'originals.pack'
            with combined.open('xb') as packed:
                for i,part in enumerate(index['parts'],1):
                    if part['path']!=f'originals.pack.{i:03d}':raise ValueError('Unexpected part path or order')
                    with (ROOT/part['path']).open('rb') as stream:
                        length,digest=copy_hashed(stream,packed)
                    if (length,digest)!=(part['bytes'],part['sha256']):raise ValueError('Corrupt '+part['path'])
            subprocess.run(['git','init','--quiet','--bare',str(repo)],check=True)
            git=['git','--git-dir='+str(repo)]
            with combined.open('rb') as fd:subprocess.run([*git,'index-pack','--strict','--stdin'],stdin=fd,stdout=subprocess.DEVNULL,check=True)
            for r in chosen:
                path=stage.joinpath(*safe_path(r['path']).parts)
                path.parent.mkdir(parents=True,exist_ok=True)
                with path.open('xb') as target, subprocess.Popen([*git,'cat-file','blob',r['gitBlob']],stdout=subprocess.PIPE) as proc:
                    length,digest=copy_hashed(proc.stdout,target)
                    if proc.wait()!=0 or (length,digest)!=(r['bytes'],r['sha256']):raise ValueError('Original mismatch: '+r['path'])
        if out.exists():raise FileExistsError(out)
        stage.rename(out)
        print(f'Restored and SHA-256 verified {len(chosen)} original files in {out}')
    finally:
        if stage.exists() and stage.resolve().parent==out.parent and stage.name.startswith(out.name+'.restoring-'):shutil.rmtree(stage)
if __name__=='__main__':
    try:run()
    except (ValueError,OSError,subprocess.CalledProcessError) as exc:sys.exit(str(exc))
