"""Render only the revised question home board."""
from pathlib import Path
from runpy import run_path
from PIL import Image, ImageDraw, ImageOps

out=Path(__file__).resolve().parent
ui=run_path(str(out.parent/'荔枝园/绘制园中事与问一问.py'))['start'].__globals__
start,btn,rect,label,icon,line,avatar,bottom=[ui[k] for k in ('start','btn','rect','label','icon','line','avatar','bottom')]
ink,green,muted,white,liner,pale=[ui[k] for k in ('ink','green','muted','white','liner','pale')]

start('荔枝园','问一问','我来问',True)
x,y,w,h=18,165,354,190
base=Image.new('RGB',(2*w,2*h),'#f5e6cc')
art=Image.open(ui['ART'].parents[1]/'client/diet-banner-v7.webp').convert('RGB')
aw,ah=art.size
art=art.crop((round(aw*.28),0,round(aw*.67),ah))
illustration=ImageOps.fit(art,(452,h*2),Image.Resampling.LANCZOS,centering=(.50,.52))
fade=Image.new('L',illustration.size)
fade.putdata([round(255*min(1,max(0,xx/130))) for yy in range(illustration.height) for xx in range(illustration.width)])
base.paste(illustration,(2*w-illustration.width,0),fade)
mask=Image.new('L',base.size)
ImageDraw.Draw(mask).rounded_rectangle((0,0,base.width-1,base.height-1),radius=26,fill=255)
ui['canvas'].paste(base,(x*2,y*2),mask)
label(34,191,'今晚吃什么？',26,ink,'bold')
btn(34,253,104,'问问大家')
label(45,311,'换一个',12,green,'bold')
icon('right',90,310,green)

label(19,385,'好友的问题',20,ink,'bold')
line([(137,398),(371,398)],liner)

rect(18,426,354,180,white,11,liner)
avatar(1,32,440,29);label(70,446,'阿青',14,ink,'bold');label(105,447,'问',13,muted)
label(355,449,'09:40',11,muted,'regular','rt')
label(32,487,'摘下来的荔枝，有什么保鲜办法？',17,ink,'bold')
rect(31,525,328,35,'#edf0e1',6)
label(42,535,'小满答',12.5,green,'bold');label(87,535,'我会挑出碰伤的，再装盒冷藏。',12.5,ink)
label(32,579,'查看 2 个回答',12.5,green,'bold');icon('right',120,577,green)

rect(18,620,354,127,white,11,liner)
avatar(3,32,634,29);label(70,640,'阿泽',14,ink,'bold');label(105,641,'问',13,muted)
label(355,643,'09:15',11,muted,'regular','rt')
label(32,674,'周六出门，哪条步道树荫多？',17,ink,'bold')
label(32,715,'还没人回答',12,muted);icon('edit',269,711,green);label(290,713,'写个答案',13,green,'bold')
bottom()
if __name__=='__main__':
    ui['canvas'].save(out.parent/'荔枝园/03-问一问-好友问题列表.png')
