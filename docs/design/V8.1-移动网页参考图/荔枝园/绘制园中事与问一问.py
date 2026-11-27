"""Render the mobile 8.1 design boards, with no dependency on running the app."""
from pathlib import Path
from functools import lru_cache
import math
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter, ImageChops

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
ART = ROOT / 'source/source/web'
S = 2
W, H = 390, 844
paper, white, ink, green = '#fbf6ea', '#fffcf4', '#253e33', '#2e6951'
muted, liner, red, pale = '#64705f', '#dedbc8', '#b44d42', '#e3eedc'
navy, plum = '#4a514e', '#7f594f'


@lru_cache(maxsize=None)
def font(size, weight='regular'):
    path = {'regular':'msyh.ttc','bold':'msyhbd.ttc','serif':'simsun.ttc'}[weight]
    return ImageFont.truetype(str(Path('C:/Windows/Fonts') / path), round(S*size), index=0)


def rect(x, y, w, h, color, radius=0, outline=None):
    draw.rounded_rectangle((round(x*S),round(y*S),round((x+w)*S),round((y+h)*S)),round(radius*S),
                           fill=color,outline=outline,width=S)


def label(x,y,s,size=14,color=ink,weight='regular',anchor='lt'):
    draw.text((round(x*S),round(y*S)),s,font=font(size,weight),fill=color,anchor=anchor,stroke_width=0)


def line(points,fill=liner,width=1):
    draw.line([(round(x*S),round(y*S)) for x,y in points],fill=fill,width=max(1,round(S*width)),joint='curve')


def ellipse(x,y,w,h,color,outline=None,width=1):
    draw.ellipse((round(x*S),round(y*S),round((x+w)*S),round((y+h)*S)),fill=color,outline=outline,width=round(width*S))


def photo(path,x,y,w,h,r=0,focus=(.5,.5)):
    source=Image.open(path).convert('RGBA')
    im=ImageOps.fit(source,(round(w*S),round(h*S)),Image.Resampling.LANCZOS,centering=focus)
    mask=Image.new('L',im.size)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,im.width-1,im.height-1),radius=round(r*S),fill=255)
    canvas.paste(im,(round(x*S),round(y*S)),Image.composite(im.getchannel('A'),Image.new('L',im.size),mask))


def avatar(i,x,y,sz=40):
    photo(ART/f'scenes/portrait-{i}.webp',x,y,sz,sz,sz/2)


def icon(name,x,y,color=ink):
    if name=='back':
        line([(x+8,y+2),(x+2,y+9),(x+8,y+16)],color,1.8)
    elif name=='right':
        line([(x+3,y+2),(x+9,y+8),(x+3,y+14)],color,1.7)
    elif name=='edit':
        line([(x+2,y+13),(x+3,y+9),(x+11,y+1),(x+14,y+4),(x+6,y+12),(x+2,y+13)],color,1.4)
    elif name=='smile':
        ellipse(x,y,17,17,None,color,1.3)
        ellipse(x+4.5,y+5,1.7,2,color);ellipse(x+10.5,y+5,1.7,2,color)
        draw.arc((round((x+4)*S),round((y+6)*S),round((x+13)*S),round((y+13)*S)),8,173,fill=color,width=round(1.2*S))
    elif name=='speech':
        line([(x+2,y+1),(x+14,y+1),(x+16,y+3),(x+16,y+10),(x+14,y+12),(x+8,y+12),(x+4,y+16),(x+4,y+12),(x+1,y+11),(x+1,y+3),(x+2,y+1)],color,1.2)
    elif name in ('star','heart'):
        face=jelly(name)
        canvas.paste(face,(round((x-2)*S),round((y-2)*S)),face)
    elif name=='thumb':
        rect(x,y+6,4,11,'#63846a',1)
        coords=[(5,6),(9,3),(10,0),(12,0),(13,2),(12,6),(16,6),(17,8),(15,15),(13,17),(5,16)]
        draw.polygon([((x+dx)*S,(y+dy)*S) for dx,dy in coords],fill='#ddb680',outline='#99794e')
    elif name=='plus':
        line([(x+7,y+1),(x+7,y+13)],color,1.6);line([(x+1,y+7),(x+13,y+7)],color,1.6)
    elif name=='image':
        rect(x,y,20,16,None,3,color);ellipse(x+3,y+2.5,3,3,color)
        line([(x+2,y+13),(x+7,y+8),(x+11,y+11),(x+14,y+6),(x+18,y+11)],color,1.4)


@lru_cache(maxsize=2)
def jelly(name):
    """Paint soft-edged, embossed reaction glyphs from one mask at icon size."""
    n=112
    mask=Image.new('L',(n,n));pen=ImageDraw.Draw(mask)
    if name=='heart':
        points=[]
        for i in range(240):
            t=math.tau*i/240
            points.append((56+2.96*16*math.sin(t)**3,50-2.96*(13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t))))
        light,base,edge=(255,189,189),(237,70,88),(128,27,52)
    else:
        points=[]
        for i in range(10):
            a=i*math.pi/5-math.pi/2;r=49 if i%2==0 else 26
            points.append((56+r*math.cos(a),56+r*math.sin(a)))
        # Two rounds of corner cutting leave a plump star with readable lobes.
        for _ in range(2):
            seq=[]
            for i,p in enumerate(points):
                q=points[(i+1)%len(points)]
                seq.extend([(p[0]*.86+q[0]*.14,p[1]*.86+q[1]*.14),(p[0]*.14+q[0]*.86,p[1]*.14+q[1]*.86)])
            points=seq
        light,base,edge=(255,247,172),(255,182,44),(156,82,22)
    pen.polygon(points,fill=255)
    m=mask.filter(ImageFilter.GaussianBlur(.7)); body=Image.new('RGBA',(n,n));pix=body.load();mp=m.load()
    interior=m.filter(ImageFilter.GaussianBlur(6)).load()
    for yy in range(n):
        for xx in range(n):
            if not mp[xx,yy]:continue
            v=(xx*.28+yy*.72)/110
            a,b,t=(light,base,v/.5) if v<.5 else (base,edge,(v-.5)*1.85)
            rim=(1-interior[xx,yy]/255)*.52
            lightspot=.26*math.exp(-(((xx-38)/23)**2+((yy-32)/22)**2))
            rgb=[a[k]+(b[k]-a[k])*min(1,t) for k in range(3)]
            rgb=[c*(1-rim)+edge[k]*rim for k,c in enumerate(rgb)]
            pix[xx,yy]=tuple(round(c*(1-lightspot)+255*lightspot) for c in rgb)+(mp[xx,yy],)
    shine=Image.new('RGBA',(n,n))
    sh=ImageDraw.Draw(shine)
    sh.ellipse((25,23,44,31) if name=='heart' else (37,37,51,46),fill=(255,255,247,192))
    sh.ellipse((20,33,26,38) if name=='heart' else (35,45,40,50),fill=(255,254,221,150))
    shine=shine.filter(ImageFilter.GaussianBlur(1.4));shine.putalpha(ImageChops.multiply(shine.getchannel('A'),m))
    body=Image.alpha_composite(body,shine)
    shadow=Image.new('RGBA',(n,n));shadow.paste((132,77,48,85),(0,2,n,n+2),m.filter(ImageFilter.GaussianBlur(2.2)))
    return Image.alpha_composite(shadow,body).resize((22*S,22*S),Image.Resampling.LANCZOS)


def btn(x,y,w,s,style='green',icon_name=None):
    bg,fg=(green,'#ffffff') if style=='green' else (pale,green)
    rect(x,y,w,35,bg,17)
    if icon_name:
        icon(icon_name,x+12,y+10,fg);label(x+33,y+9,s,13,fg,'bold')
    else: label(x+w/2,y+9,s,13,fg,'bold','mt')


def start(section,title,action=None,question=False):
    global canvas,draw
    canvas=Image.new('RGB',(W*S,H*S),paper);draw=ImageDraw.Draw(canvas)
    label(21,12,'9:41',12,ink,'bold')
    for i in range(4):rect(321+i*4,21-i*2,2.5,3+i*2,ink,1)
    line([(343,17),(347,14),(351,17)],ink,1.8);line([(345,19),(347,17.7),(349,19)],ink,1.5)
    rect(357,14,17,9,None,2,ink);rect(359,16,12,5,green,1);rect(375,17,2,3,ink,1)
    if section:
        icon('back',17,49);label(36,51,section,13,green,'bold')
    if action:btn(290,41,82,action,'green','edit')
    label(18,93,title,33,ink,'bold')
    if question:
        photo(ART/'mobile/garden-question.webp',294,88,72,53,13)
    else:
        photo(ART/'mobile/nav-garden-on.webp',308,89,57,44,12)
    line([(18,148),(372,148)],liner)


def bottom(compose=None):
    if compose:
        rect(0,756,390,88,'#fffdf6')
        line([(0,756),(390,756)],liner)
        rect(16,771,290,42,'#f2f0e4',20)
        label(30,783,compose,14,muted);btn(315,774,59,'发送')
    else:
        rect(0,766,390,78,'#fffcf4')
        line([(0,766),(390,766)],liner)
        for j,(name,img) in enumerate([('荔圈','chat'),('荔枝园','garden'),('工具箱','tools'),('我','me')]):
            xx=48+98*j
            if j==1:rect(xx-24,772,48,26,pale,14)
            photo(ART/f'mobile/nav-{img}-on.webp',xx-12,773,25,22,2)
            label(xx,802,name,11.5,green if j==1 else muted,'bold' if j==1 else 'regular','mt')
    rect(141,832,108,4,ink,2)


def author(i,x,y,name,date):
    avatar(i,x,y,37);label(x+47,y+1,name,15,ink,'bold')
    label(x+47,y+24,date,11.5,muted)


def reactions(y):
    rect(21,y,50,31,'#dcebd7',15,'#a7bea5');icon('star',30,y+8);label(50,y+7,'2',14,green,'bold')
    rect(78,y,49,31,'#f4ecdf',15);icon('heart',87,y+8);label(108,y+7,'1',14,navy,'bold')
    rect(133,y,39,31,None,15,liner);icon('smile',144,y+7,muted)
    icon('speech',308,y+8,green);label(330,y+8,'评论',12,green)


def thread(y,fold=False,reply=False):
    rect(19,y,352,123 if fold else 96,'#f1f1e4',10)
    line([(31,y+12),(31,y+32)],'#b3c4a8',2.4)
    label(41,y+12,'小满',13,green,'bold');label(76,y+12,'这一篮看起来好甜！',13)
    label(41,y+43,'阿青',13,green,'bold');label(75,y+43,'回复',11,muted)
    label(106,y+43,'小满',13,green,'bold');label(140,y+43,'刚剥开，汁水好多。',13)
    if fold:
        line([(41,y+75),(349,y+75)],liner)
        label(41,y+86,'展开其余 4 条评论',12,green,'bold')
    else:
        label(41,y+72,'10:28',10,muted)


def post(filename,fold=False,target=False):
    start('荔枝园','园中事','发动态')
    author(1,20,168,'阿青','今天 10:16');label(369,180,'···',16,muted,'bold','rt')
    label(20,223,'今天的第一篮荔枝，留两串给大家。',16,ink,'bold')
    photo(OUT/'示例果照.jpg',20,259,350,216 if not target else 196,12)
    y=491 if not target else 470
    reactions(y);thread(y+43,fold)
    if target:
        rect(0,663,390,93,'#fffdf6')
        line([(18,667),(372,667)],liner)
        label(21,683,'回复小满',14,green,'bold')
        rect(20,710,350,34,'#f2f0e3',5)
        label(33,720,'小满　这一篮看起来好甜！',12,muted)
        bottom('也给你留了一串。')
    else:
        yy=685 if fold else 657
        line([(19,yy),(371,yy)],liner);author(3,20,yy+17,'阿泽','今天 09:52')
        label(20,yy+64,'晚点去园里散步，有人一起吗？',15)
        bottom()
    canvas.save(OUT/filename)


def question_detail():
    start('问一问','问题详情',question=True)
    rect(18,166,354,159,'#e9efdf',13)
    label(34,184,'摘下来的荔枝，有什么保鲜办法？',18,ink,'bold')
    avatar(1,34,225,25);label(67,230,'阿青',13,green,'bold');label(106,231,'今天 09:40',11,muted)
    label(34,274,'想给明天来玩的朋友留一份。',14)
    label(20,350,'2 个回答',20,ink,'bold');line([(117,362),(369,362)],liner)
    author(2,21,392,'小满','今天 09:52')
    label(25,449,'我会先挑出碰伤的，再用盒子装好冷藏。',15)
    rect(30,484,337,78,'#edf1e5',8)
    label(43,500,'阿青',13,green,'bold');label(79,500,'追问小满',12,muted)
    label(43,526,'枝条也一起留着吗？',14)
    label(25,578,'追问小满',13,green,'bold');line([(21,611),(369,611)],liner)
    author(3,21,631,'阿泽','今天 10:06')
    label(25,686,'我一般吃多少洗多少，挺方便。',15)
    label(25,724,'追问阿泽',13,green,'bold')
    bottom('写下你的回答…')
    canvas.save(OUT/'02-问一问-独立回答与追问.png')


def question_list():
    start('荔枝园','问一问','发问',True)
    questions=[('摘下来的荔枝，有什么保鲜办法？','想给明天来玩的朋友留一份。','阿青',1,'2 个回答','09:40'),
               ('周六出门，哪条步道树荫多？','想带家里人走一段平路。','阿泽',3,'还没人回答','09:15'),
               ('大家上次合影是用什么拍的？','照片的颜色很自然。','小满',2,'1 个回答','昨天')]
    for i,(title,detail,name,aid,status,time) in enumerate(questions):
        y=168+180*i
        rect(18,y,354,159,white,12,liner)
        label(33,y+16,title,17,ink,'bold');label(33,y+54,detail,14,muted)
        avatar(aid,33,y+102,28);label(70,y+109,name,13,ink,'bold')
        label(107,y+111,time,11,muted)
        wid=85 if i==1 else 68
        rect(352-wid,y+100,wid,30,pale if i!=1 else '#eeeadd',14)
        label(352-wid/2,y+108,status,11.5,green if i!=1 else muted,'bold','mt')
    bottom();canvas.save(OUT/'03-问一问-好友问题列表.png')


def compose_post():
    start('园中事','发动态')
    author(1,20,175,'阿青','好友可见')
    label(20,238,'今天的第一篮荔枝，留两串给大家。',16)
    photo(OUT/'示例果照.jpg',20,294,231,174,12)
    rect(265,294,100,174,'#f3f0e2',10,liner)
    icon('image',304,347,green);label(315,383,'手机图片',13,green,'regular','mt')
    line([(19,509),(371,509)],liner)
    icon('smile',23,536,green);label(52,538,'添加表情',14,green)
    btn(280,530,90,'发布动态')
    bottom();canvas.save(OUT/'06-园中事-发布照片动态.png')


def select_reaction():
    post('01-园中事-照片回应与两条互评.png')
    rect(111,436,169,46,'#fffdf6',19,'#bcc9b4')
    rect(122,443,38,31,pale,12);icon('star',132,450)
    icon('heart',173,450)
    icon('thumb',213,448)
    line([(246,451),(267,447),(257,467),(254,458),(246,451),(267,447),(254,458)],green,1.6)
    line([(158,482),(153,487),(148,482)],'#bcc9b4',1)
    canvas.save(OUT/'07-园中事-选择表情回应.png')


def ask():
    start('问一问','发问',question=True)
    author(1,20,173,'阿青','好友可见')
    label(21,255,'问题',15,green,'bold')
    rect(20,290,350,72,white,11,liner)
    label(34,314,'摘下来的荔枝，有什么保鲜办法？',16,ink,'bold')
    label(21,405,'补充说明',15,green,'bold')
    rect(20,442,350,146,white,11,liner)
    label(34,467,'想给明天来玩的朋友留一份。',15)
    btn(268,620,102,'发布问题')
    bottom();canvas.save(OUT/'08-问一问-发问.png')


def garden_hub():
    start(None,'荔枝园')
    entries=[('园中事','好友分享的近况','garden-feed.webp','1'),('问一问','好友的提问与回答','garden-question.webp','1'),
             ('约定','我的计划与共同计划','tile-goal.webp',None),('荔枝树','我的树与好友小院','tile-tree.webp',None)]
    for i,(name,sub,asset,count) in enumerate(entries):
        y=171+93*i
        rect(18,y,354,78,white,11,liner)
        photo(ART/'mobile'/asset,30,y+11,57,56,9)
        label(102,y+15,name,18,ink,'bold');label(102,y+46,sub,12.5,muted)
        if count:
            ellipse(313,y+27,22,22,red);label(324,y+31,count,12,white,'bold','mt')
        icon('right',346,y+31,muted)
    bottom()
    ellipse(153,770,17,17,red);label(161.5,773,'2',9.5,white,'bold','mt')
    canvas.save(OUT/'09-荔枝园-四个入口.png')


def empty_page(question=False):
    name='问一问' if question else '园中事'
    start('荔枝园',name,question=question)
    # A single illustrated, content-specific invitation. Borrow original app art.
    y=201
    rect(23,y,344,421,'#eef1e3' if question else '#f6eddb',19,liner)
    asset='garden-question.webp' if question else 'garden-feed.webp'
    photo(ART/'mobile'/asset,74,y+33,242,178,12)
    label(195,y+239,'好友还没有提问' if question else '好友还没有发布动态',20,ink,'bold','mt')
    label(195,y+287,'写下想问的事，好友可以来回答。' if question else '发一张照片，和好友聊聊今天。',13.5,muted,'regular','mt')
    btn(137,y+340,116,'发个问题' if question else '发条动态','green','edit')
    bottom()
    canvas.save(OUT/('11-问一问-零提问首页.png' if question else '10-园中事-零动态首页.png'))


def waiting_for_answers():
    start('问一问','问题详情',question=True)
    rect(18,166,354,159,'#e9efdf',13)
    label(34,184,'周六出门，哪条步道树荫多？',18,ink,'bold')
    avatar(3,34,225,25);label(67,230,'阿泽',13,green,'bold');label(106,231,'今天 09:15',11,muted)
    label(34,274,'想带家里人走一段平路。',14)
    label(20,350,'回答',20,ink,'bold');line([(80,362),(369,362)],liner)
    photo(ART/'mobile/garden-question.webp',145,410,100,82,11)
    label(195,520,'还没人回答',19,ink,'bold','mt')
    label(195,557,'熟悉附近的步道？和阿泽说说吧。',14,muted,'regular','mt')
    btn(127,617,136,'写第一个回答','green','edit')
    bottom();canvas.save(OUT/'12-问一问-已有提问零回答.png')


def render_empty_question(approved):
    global canvas,draw
    canvas=approved['ui']['canvas'].copy()
    draw=ImageDraw.Draw(canvas)
    rect(18,422,354,338,paper)
    photo(ART/'mobile/garden-question.webp',148,458,94,73,10)
    label(195,553,'好友还没有提问',19,ink,'bold','mt')
    label(195,592,'写下想问的事，好友可以来回答。',14,muted,'regular','mt')
    canvas.save(OUT/'11-问一问-零提问首页.png')


if __name__=='__main__':
    post('01-园中事-照片回应与两条互评.png')
    question_detail()
    from runpy import run_path
    approved=run_path(str(OUT.parent/'问一问首页候选/绘制首页.py'))
    approved['ui']['canvas'].save(OUT/'03-问一问-好友问题列表.png')
    post('04-园中事-多条评论折叠.png',True)
    post('05-园中事-定向回复.png',target=True)
    compose_post();select_reaction();ask();garden_hub();empty_page();empty_page(True);waiting_for_answers()
    render_empty_question(approved)
