"""Build one Windows EXE, its per-user MSI, and the matching independent mobile frontend."""
import sys, shutil, subprocess, argparse, json, uuid, hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from PIL import Image
from build_identity import WINDOWS_VERSION
ROOT=Path(__file__).resolve().parents[1]
def run(*args):
    subprocess.run([str(a) for a in args],check=True,cwd=ROOT)

def friend_package(out,version):
    installer=out/'Lychee.msi'
    name=f'Lychee-Windows-{version}.msi'
    instructions=(f'荔枝 Windows {version}\r\n\r\n'
                  f'解压缩后，双击 {name}。建议使用向导的默认位置；也可选择专用程序文件夹。\r\n'
                  '如果旧版的程序文件装在桌面，先到 Windows 设置 → 应用 → 已安装的应用，卸载 Lychee Desktop，再运行此安装包。账号和园区资料会保留。\r\n'
                  '完成后可从向导打开荔枝，或使用桌面、开始菜单的快捷方式。\r\n')
    target=out/f'Lychee-Windows-{version}-RC.zip'
    # Windows keeps a file's ACL on rename. Stage shareable files with the output directory's inherited ACL.
    scratch=out/('.lychee-share-'+uuid.uuid4().hex)
    scratch.mkdir()
    stage=scratch/target.name
    named_installer=scratch/name
    try:
        shutil.copyfile(installer,named_installer)
        with ZipFile(stage,'w',ZIP_DEFLATED) as bundle:
            bundle.write(named_installer,name)
            bundle.writestr('安装说明.txt',instructions.encode('utf-8-sig'))
        with ZipFile(stage) as bundle:
            if bundle.read(name)!=installer.read_bytes():
                raise ValueError('The share archive does not match the verified installer')
        named_installer.replace(out/name)
        stage.replace(target)
    finally:
        named_installer.unlink(missing_ok=True)
        stage.unlink(missing_ok=True)
        scratch.rmdir()

def build(out,qa_version=None,qa_instance=None,client_dir=None):
    if bool(qa_version)!=bool(qa_instance):
        raise ValueError('Test packages require both --qa-version and --qa-instance')
    if qa_instance: qa_instance=str(uuid.UUID(qa_instance))
    out=out.resolve();out.mkdir(parents=True,exist_ok=True)
    if client_dir:
        client_dir=client_dir.resolve()
    else:
        run(sys.executable,ROOT/'build.py')
        client_dir=ROOT/'public'
    version=qa_version or WINDOWS_VERSION
    receipt=json.loads((client_dir.parent/(client_dir.name+'-build.json')).read_text('utf8'))
    actual={file.relative_to(client_dir).as_posix() for file in client_dir.rglob('*') if file.is_file()}
    if actual!=set(receipt['files']) or any(hashlib.sha256((client_dir/name).read_bytes()).hexdigest()!=digest for name,digest in receipt['files'].items()):
        raise ValueError('Client files do not match their build receipt')
    run(sys.executable,ROOT/'launch/build.py',client_dir,out/'site')
    shared_version=receipt['version']
    if version!=shared_version:
        page=out/'site/windows/workspace.html'
        with page.open('rb') as f: html=f.read()
        marker=f'data-client-build="{shared_version}"'.encode()
        if html.count(marker)!=1:
            raise ValueError('Expected a single embedded Windows client version')
        page.write_bytes(html.replace(marker,f'data-client-build="{version}"'.encode()))
    icon=out/'lychee.ico'
    with Image.open(ROOT/'desktop/lychee-window.png') as img:
        if img.size!=(256,256) or img.mode!='RGBA' or img.getextrema()[3]!=(0,255):
            raise ValueError('The Windows icon must be a 256px transparent RGBA image')
        img.save(icon,sizes=[(n,n) for n in (16,20,24,32,40,48,64,96,128,256)])
    with ZipFile(out/'site.zip','w',ZIP_DEFLATED,compresslevel=5) as zipped:
        for f in sorted((out/'site').rglob('*')):
            if f.is_file():zipped.write(f,f.relative_to(out/'site'))
    run('powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',ROOT/'desktop/build.ps1','-SiteZip',out/'site.zip','-Icon',icon,'-OutputExe',out/'Lychee.exe',
        '-Version',version,'-Python',sys.executable,*(['-QaInstance',qa_instance] if qa_instance else []))
    run(sys.executable,ROOT/'desktop/installer.py',out/'Lychee.exe',out/'Lychee.msi','--version',version,'--icon',icon,
        *(['--qa-instance',qa_instance] if qa_instance else []))
    run(sys.executable,ROOT/'desktop/verify-installer.py',out/'Lychee.msi',out/'Lychee.exe','--wizard')
    if not qa_instance:
        run(sys.executable,ROOT/'desktop/update_feed.py','--version',version,'--packages',out,'--output',out/'stable.json')
        friend_package(out,version)
    destination=out/'mobile-static'
    shutil.copytree(ROOT/'static-host',destination,dirs_exist_ok=True)
    shutil.copytree(out/'site',destination/'public',dirs_exist_ok=True)
    for name in ('_routes.json','_headers'):
        shutil.copyfile(ROOT/'static-host'/name,destination/'public'/name)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('out',type=Path)
    p.add_argument('--qa-version');p.add_argument('--qa-instance')
    p.add_argument('--client-dir',type=Path,help='Use a separately built client and its adjacent build receipt')
    args=p.parse_args();build(args.out,args.qa_version,args.qa_instance,args.client_dir)
