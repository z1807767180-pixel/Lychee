"""Join and independently verify the historical source ZIP from repository parts."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys
import uuid

ROOT=Path(__file__).resolve().parent
EXPECTED_SHA256='1d6fdc0085594f326786e0d22969061a7a76ff025aaf1ff0c9c8a1109750aa1c'
def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--out',type=Path,default=Path('lychee-historical-sources.zip'))
    args=cli.parse_args()
    out=args.out.resolve()
    if out.exists():cli.error('Output already exists; choose a new filename')
    index=json.loads((ROOT/'index.json').read_text('utf-8'))
    if index['sha256']!=EXPECTED_SHA256 or index['format']!=1:raise ValueError('Unexpected source archive index')
    out.parent.mkdir(parents=True,exist_ok=True)
    stage=out.with_name(out.name+'.assembling-'+uuid.uuid4().hex)
    full=sha256()
    total=0
    try:
        with stage.open('xb') as fd:
            for i,rec in enumerate(index['parts'],1):
                if rec['path']!=f'sources.zip.{i:03d}':raise ValueError('Wrong part order')
                data=(ROOT/rec['path']).read_bytes()
                if len(data)!=rec['bytes'] or sha256(data).hexdigest()!=rec['sha256']:raise ValueError('Damaged part '+rec['path'])
                fd.write(data)
                full.update(data)
                total+=len(data)
        if full.hexdigest()!=EXPECTED_SHA256 or total!=index['bytes']:raise ValueError('Joined archive fingerprint mismatch')
        if out.exists():raise FileExistsError(out)
        stage.rename(out)
    finally:
        if stage.is_file():stage.unlink()
    print(f'{full.hexdigest()}  {out} ({total} bytes)')
if __name__=='__main__':
    try:main()
    except (OSError,ValueError) as exc:sys.exit(str(exc))
