"""Produce both static launch documents from the same generated client, preserving gate order."""
from pathlib import Path
import argparse, re, shutil

def compose(source, out):
    shutil.copytree(source,out,dirs_exist_ok=True)
    target=out/'launch'
    target.mkdir(exist_ok=True)
    for name in ('start.js','start.css','windows-frame.js','windows-frame.css'):
        shutil.copyfile(Path(__file__).with_name(name),target/name)
    for entry in ('mobile/index.html','windows/workspace.html'):
        path=out/entry
        html=path.read_text('utf-8-sig')
        pattern=r'(<script\b[^>]*?\bsrc=["\x27])/client/garden\.js(\?v=[\d.]+)(["\x27][^>]*>)'
        html,count=re.subn(pattern,r'\g<1>/launch/start.js\2\3',html)
        if count!=1:raise ValueError(f'{entry}: expected one named client gate')
        typography=r'<link rel="stylesheet" href="/client/typography\.css(\?v=[\d.]+)">'
        html,count=re.subn(typography,r'<link rel="stylesheet" href="/launch/start.css\1">\g<0>',html)
        if count!=1: raise ValueError(f'{entry}: expected shared typography')
        html,count=re.subn(r'(<body\b[^>]*>)',r'\1<section id="lychee-launch" aria-label="启动荔枝"><img src="/mobile/icon.png" alt=""><h1>荔枝</h1><p role="status">正在打开荔枝…</p><button type="button" hidden>重试</button></section>',html,count=1)
        if count!=1: raise ValueError(entry)
        if entry.startswith('windows/'):
            html=html.replace('</head>','<link rel="stylesheet" href="/launch/windows-frame.css"><script defer src="/launch/windows-frame.js"></script></head>',1)
        path.write_text(html,encoding='utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();compose(a.source,a.output)
