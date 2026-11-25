"""Select only static mobile launch assets and verify their release identity."""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import argparse
import re
from urllib.parse import urlsplit
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ENTRY = 'mobile/index.html'
ROOT_FILES = {'app.css', 'camp.webp', 'meadow.webp', 'windows/workspace-nav.js', 'windows/team-share.js'}
EXTENSIONS = {'.html', '.js', '.css', '.jpg', '.png', '.webp', '.svg', '.woff2', '.txt'}



def allowed(name):
    return bool(re.fullmatch(r'(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)+', name)
                and Path(name).suffix in EXTENSIONS
                and (name in ROOT_FILES or name.startswith(('mobile/', 'client/', 'scenes/', 'launch/'))))


class EntryAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = set()
        self.client = None
        self.build = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'body':
            self.client, self.build = attrs.get('data-app'), attrs.get('data-client-build')
        for key in ('src', 'href'):
            if key in attrs and attrs[key].startswith('/'):
                self.files.add(urlsplit(attrs[key]).path.lstrip('/'))


def validate(files, expected):
    doc = EntryAssets()
    doc.feed(files[ENTRY].decode('utf-8-sig'))
    if (doc.client, doc.build) != ('/mobile/phone.js', expected):
        raise ValueError('Expected launch document '+expected)
    required = {'launch/start.js', 'client/garden.js', 'client/business-scope.js', 'mobile/phone.js',
                'client/fonts/LXGW975YuanSC-500W.woff2', 'client/fonts/LXGW975YuanSC-700W.woff2',
                'client/fonts/OFL.txt', 'mobile/icon.png'} | doc.files
    if required - files.keys() or 'launch/start.js' not in doc.files:
        raise ValueError('Missing launch assets: '+str(sorted(required - files.keys())))
    if b'accountApi=v640' not in files['launch/start.js']:
        raise ValueError('Missing versioned account capability probe')
    for name in files:
        if not allowed(name):
            raise ValueError('Unexpected APK input: '+name)


def pack(source, output, expected):
    source = source.resolve()
    files = {}
    for path in sorted(source.rglob('*')):
        name = path.relative_to(source).as_posix()
        if allowed(name) and path.is_file() and path.resolve().is_relative_to(source):
            files[name] = path.read_bytes()
    validate(files, expected)
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'w') as archive:
        for name, data in files.items():
            archive.writestr(ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data, compress_type=ZIP_DEFLATED)
    return files


def unpack(path, digest, expected):
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError('Static asset ZIP digest differs from the approved input')
    with ZipFile(path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 240_000_000 or len(archive.namelist()) > 500:
            raise ValueError('Unexpected static asset size')
        names = archive.namelist()
        if len(set(names)) != len(names) or not all(map(allowed, names)):
            raise ValueError('Unexpected or repeated input path')
        files = {name: archive.read(name) for name in names}
    validate(files, expected)
    return files



if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--site', required=True, type=Path)
    cli.add_argument('--out', required=True, type=Path)
    cli.add_argument('--expected-build', required=True)
    args = cli.parse_args()
    pack(args.site, args.out, args.expected_build)
    digest = sha256(args.out.read_bytes()).hexdigest()
    files = unpack(args.out, digest, args.expected_build)
    print(f'{len(files)} verified mobile files, SHA-256 {digest}')
