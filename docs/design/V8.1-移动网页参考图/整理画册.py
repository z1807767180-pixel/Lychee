"""Create labelled reviews and a one-screen-per-page review PDF from final PNGs."""
from pathlib import Path
from io import BytesIO
from functools import lru_cache
from PIL import Image,ImageDraw,ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

ROOT=Path(__file__).resolve().parent
PREVIEW=ROOT/'分组预览'
PDF=ROOT/'荔枝8.1-手机逐屏画册.pdf'
ink,muted,ground,white='#263f34','#66745e','#eeeade','#fffaf0'


@lru_cache(maxsize=None)
def font(size,bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/'+('msyhbd.ttc' if bold else 'msyh.ttc'),size)


def screens(folder):
    result=[]
    for f in sorted(folder.rglob('*.png')):
        with Image.open(f) as im:
            if im.height>im.width*1.85 and im.width>=720:
                result.append(f)
    return result


def shortname(f):
    title=f.stem
    while title and (title[0].isdigit() or title[0] in ' -_、.'):
        title=title[1:]
    return title.replace('_',' · ')


def preview(name,group):
    if not group:
        return
    cols=2 if len(group)>1 else 1
    rows=(len(group)+cols-1)//cols
    cellwidth,cellheight=398,906
    image=Image.new('RGB',(cols*cellwidth+48,rows*cellheight+104),ground)
    draw=ImageDraw.Draw(image)
    draw.text((25,19),name,font=font(27,True),fill=ink)
    draw.text((26,56),'荔枝 8.1   /   移动网页设计稿',font=font(16),fill=muted)
    for i,path in enumerate(group):
        x=24+(i%cols)*cellwidth;y=92+(i//cols)*cellheight
        with Image.open(path) as screen:
            thumb=screen.convert('RGB')
            thumb.thumbnail((374,811),Image.Resampling.LANCZOS)
            image.paste(thumb,(x,y))
        title=shortname(path)
        draw.text((x,y+827),title,font=font(18 if len(title)>16 else 21,True),fill=ink)
    image.save(PREVIEW/(name+'.jpg'),quality=89,optimize=True)


def make_pdf(groups):
    pdf=Canvas(str(PDF),pagesize=(390,844),pageCompression=1)
    pdf.setTitle('荔枝 8.1 · 手机逐屏画册')
    page=0
    for chapter,files in groups:
        if not files:
            continue
        for i,path in enumerate(files):
            page+=1
            key=f'screen-{page}'
            if i==0:
                pdf.bookmarkPage(f'section-{page}')
                pdf.addOutlineEntry(chapter,f'section-{page}',0)
            pdf.bookmarkPage(key)
            page_title=shortname(path)
            if chapter=='个人与主题':
                page_title=shortname(path.parent)+' · '+page_title
            pdf.addOutlineEntry(page_title,key,1)
            with Image.open(path) as png:
                rgb=png.convert('RGB')
                rgb.thumbnail((843,1825),Image.Resampling.LANCZOS)
                jpg=BytesIO()
                rgb.save(jpg,format='JPEG',quality=90,subsampling=0,optimize=True)
                jpg.seek(0)
                pdf.drawImage(ImageReader(jpg),0,0,390,844)
            pdf.showPage()
    pdf.save()
    return page


if __name__=='__main__':
    PREVIEW.mkdir(exist_ok=True)
    garden=screens(ROOT/'荔枝园')
    tools=screens(ROOT/'工具箱')
    people=screens(ROOT/'个人与主题')
    preview('01 园中事与问一问',garden[:2])
    preview('02 发动态与评论', [f for f in garden if f.name[:2] in ('04','05','06','07')])
    preview('03 好友提问', [f for f in garden if f.name[:2] in ('03','02','08')])
    preview('03a 荔枝园入口与三种空状态', [f for f in garden if f.name[:2] in ('09','10','11','12')])
    for title,group in [('04 日常工具（一）',tools[:3]),('05 日常工具（二）',tools[3:5]),('06 一起玩',tools[5:9]),('07 AI 工具',tools[9:11])]:
        preview(title,group)
    # Each review set uses the same screen across themes or a small related path.
    if people:
        byparent={}
        for f in people:
            byparent.setdefault(f.parent,[]).append(f)
        for idx,(parent,group) in enumerate(byparent.items(),8):
            for n in range(0,len(group),4):
                suffix='' if len(group)<=4 else f'（{n//4+1}）'
                preview(f'{idx:02d} {shortname(parent)}{suffix}',group[n:n+4])
    groups=[('荔枝园',garden),('工具箱',tools),('个人与主题',people)]
    print('pages',make_pdf(groups),'garden',len(garden),'tools',len(tools),'account',len(people))
