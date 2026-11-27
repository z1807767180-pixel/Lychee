"""Build the shared client from bundled, verified release inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from chat_inbox_build import inbox_phone, inbox_journal
from notification_build import notification_journal, notification_phone, notification_v61, notification_yard

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source/web"
VERSION = "7.0.0"
CLIENT_BUILD = VERSION
TOOL_SCRIPTS = ("diet-foods-v7.js", "diet-recipes-v7.js", "diet-match-v7.js", "diet-estimate-v7.js", "diet-condiment-v7.js", "diet-v7.js", "wheel-v7.js", "quiz-v7.js",
                "notify-push-v7.js", "notify-v7.js")
TOOL_STYLES = ("diet-v7.css", "wheel-v7.css", "quiz-v7.css")
TOOL_IMAGES = ("diet-banner-v7.webp", "wheel-banner-v7.webp", "wheel-hub-v7.webp",
               "diet-card-v7.webp", "wheel-card-v7.webp", "quiz-card-v7.webp", "quiz-result-v7.webp")
SOCIAL_ART = tuple(f'social-{kind}-{skin}.webp' for kind in ('wall', 'wide', 'corner')
                   for skin in ('orchard', 'miffy', 'tutu', 'kitty'))
API_LITERAL = re.compile(r"""(?P<q>["'])(?P<path>/api/(?:camp|phone)[^"'\n]*?)(?P=q)""")


def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Unexpected release integration point: " + old[:75])
    return text.replace(old, new)


def bind_business(text):
    text = text.replace('"/api/account"', '"/api/v640/account"')
    text = API_LITERAL.sub(lambda m: "window.LycheeBusiness.api(" + m[0] + ")", text)
    return re.sub(r"\b(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(",
                  r"window.LycheeBusiness.\1.\2(", text)


def ai_tool_bundle(text):
    original_links = ("h('div',{className:'a62-quicklinks'},btn('提醒事项',()=>open('tasks')),"
                      "btn('约定倒计时',()=>open('goal')),btn('园中事',()=>open('feed')),"
                      "btn('问一问',()=>open('question')))")
    cards = """h('div',{className:'toolbox-shortcuts'},[
      ['tasks','提醒事项','/mobile/ai-icon-write.webp'],
      ['goal','约定倒计时','/mobile/tile-goal.webp'],
      ['question','问一问','/mobile/garden-question.webp'],
      ['focus','番茄钟','/mobile/ledger-clock.webp'],
      ['ledger','记账本','/mobile/ledger-stall.webp'],
      ['diet','照记饮食','/client/diet-card-v7.webp'],
      ['wheel','交给命运','/client/wheel-card-v7.webp']
    ].map(([page,title,artwork])=>h('button',{key:page,type:'button',onClick:()=>open(page)},
      h('img',{src:artwork,alt:''}),h('b',null,title))))"""
    text = once(text, original_links, cards)
    text = once(text, "const api=async(query='',body)=>{let r=",
                "const api=(query='',body)=>window.LycheeBusiness.performAi(body,async body=>{let r=")
    text = once(text, "return x};\nconst imgUrl=", "return x});\nconst imgUrl=")
    text = once(text, "if(!r.ok)throw Error(x.error||'暂时无法连接，请稍后重试');",
                "if(!r.ok){const error=Error(x.error||'暂时无法连接，请稍后重试');"
                "error.status=r.status;error.aiState=x.state;error.newAiRequest=r.headers.get('X-Lychee-AI-Retry')==='new';throw error;}")
    text = once(text, "'今日剩余 '+Math.max(0,status.limits[kind]-(status.used[kind]||0))+' '+(kind==='image'?'张':'次')",
                "window.LycheeBusiness.quotaLabel(status,kind)")
    text = once(text, "},body,\n    status && !status.image && h('small',null,'服务暂未配置'),",
                "},h(Quota,{status,kind:'image'}),body,")
    text = once(text, "  const suggestions = useRef(new Map());", """  const suggestions = useRef(new Map());
  const [viewOriginal, setViewOriginal] = useState(false);
  const submittedOptions = useRef(null);
  const imageJob = window.LycheeBusiness.useImageJob(React, api, image => {
    const item = {...submittedOptions.current,...image, prompt:image.prompt || prompt || ''};
    suggestions.current.set(item.id,item);
    setResult(item); setPrompt(item.prompt); setEditing(false); setHistory(null);
    setMessage('图片已生成。本次使用 1 次生图额度，查看或保存图片不会再次扣次数。');
  },refresh);""")
    start = text.index("    lock.current = true;\n    textarea.current?.blur();")
    end = text.index("\n  }\n  async function openHistory()", start)
    text = once(text, text[start:end], """    textarea.current?.blur();
    setMessage(''); setPanel('');submittedOptions.current={style,ratio};
    try { await imageJob.start({type:'v62-image',prompt:prompt.trim(),style,ratio,reference}); }
    catch (error) { setMessage(error.message); }""")
    text = once(text, "  } else if (busy) {\n    body = h('div',{className:'a62-loading',role:'status'},art('image-tile'),h('b',null,'正在为你创作中…'),h('small',null,'请保持页面打开。'),h('div',{className:'a62-progress'}));",
                "  } else if (imageJob.job) {\n    body = window.LycheeBusiness.imageJobPanel(React,imageJob,openHistory);")
    text = once(text, "h('a',{className:'a624-photo',href:original,target:'_blank',rel:'noopener','aria-label':'打开生成的原图'},",
                "h('button',{type:'button',className:'a624-photo',style:{width:'100%',padding:0},onClick:()=>setViewOriginal(true),'aria-label':'打开生成的原图'},")
    text = once(text, "h('a',{className:'a624-chip',href:original,target:'_blank',rel:'noopener'},'查看原图')",
                "btn('查看原图',()=>setViewOriginal(true),'a624-chip')")
    text = once(text, "},h(Quota,{status,kind:'image'}),body,",
                """},h(Quota,{status,kind:'image'}),body,
    !imageJob.job && imageJob.remaining()>0 && btn('查看其他待确认任务',imageJob.resume,'a62-plain'),
    viewOriginal && result && h(window.LycheeBusiness.OriginalImage,{React,src:imgUrl(result.id),download:imgUrl(result.id,true),onClose:()=>setViewOriginal(false)}),""")
    text = once(text, "imageJobPanel(React,imageJob,openHistory)", """imageJobPanel(React,{...imageJob,dismiss:()=>{
      setEditing(true);setMessage('');imageJob.dismiss();
    }},openHistory)""")
    text = once(text, "prompt,onUse}){const [busy,B]=useState(false)",
                "prompt,onUse}){const [status,refresh]=useStatus();const [busy,B]=useState(false)")
    text = once(text, "finally{B(false)}},'a62-button',{disabled:busy}),reply&&",
                "finally{B(false);refresh()}},'a62-button',{disabled:busy}),h(Quota,{status,kind:'chat'}),reply&&")
    return bind_business(text)



def soup_controls(text):
    start = '(0,H.jsx)("select",{value:s,"aria-label":'
    end = ',(0,H.jsx)("a",{href:"https://github.com/spoonnotfound/soupbase'
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError("Expected one soup draw form")
    first, last = text.index(start), text.index(end, text.index(start))
    text = once(text, text[first:last], 'H.jsx(SoupFilters,{genre:s,setGenre:f,data:o,busy:y,start:Q})')
    text = once(text, 'function u0({members:', (ROOT / 'client/soup-filters.js').read_text(encoding='utf8') + '\nfunction u0({members:')
    text = once(text, 'h("p",null,result.solution),',
                'h("p",null,result.solution),result.source&&h("details",null,h("summary",null,"题目出处"),'
                'h("small",null,result.source.author," · ",result.source.license,"　",result.source.note),'
                'h("p",null,h("a",{href:result.source.url,target:"_blank",rel:"noreferrer"},result.source.url))),')
    text = once(text, r'e.source.author," \xB7 Soupbase\u3000",e.source.note',
                'e.source.author," · ",e.source.license,"　",e.source.note')
    return once(text, 'https://github.com/spoonnotfound/soupbase/blob/main/content/LICENSE.md',
                'https://github.com/z1807767180-pixel/Lychee/blob/main/source/third-party/README.md')


def phone_bundle(text, mobile):
    text = soup_controls(text)
    text = once(text, 'GS={"ai-chat":', 'GS={quiz:"头脑王者",diet:"照记饮食",wheel:"交给命运","ai-chat":')
    text = once(text, 'PS=["gomoku"', 'PS=["quiz","gomoku"')
    text = once(text, 'src:"/mobile/"+(pe==="feed"', 'src:pe==="quiz"?"/client/quiz-card-v7.webp":"/mobile/"+(pe==="feed"')
    text = once(text, 'It=PS.some(O=>O===L)', 'It=L!=="quiz"&&PS.some(O=>O===L)')
    point = 'const windowsPages=Ee.useRef([])'
    text = once(text, point, """const [quizInvite,setQuizInvite]=Ee.useState(null);
        const embeddedTool=window.lycheeToolEntry, initialTool=Ee.useRef(false);
        Ee.useEffect(()=>{
          if(!embeddedTool||initialTool.current)return;
          initialTool.current=true;
          const dest=embeddedTool.detail;
          Za(["profile","settings","me","notifications","theme"].includes(dest)?"我":["feed","question","goal","tree"].includes(dest)?"园":"箱");
          if(dest==="circle")setSelectedCircle({id:"main",name:window.LycheeAccess.scope.gardenName});
          if(dest!=="me"&&dest!=="tools")De(dest);
          if(dest==="quiz"&&embeddedTool.match)setQuizInvite(embeddedTool.match);
        },[]);
        Ee.useEffect(()=>{function enter(event){Za("箱");De("quiz");setQuizInvite(event.detail)}
          window.addEventListener("lychee:quiz-invitation",enter);return ()=>window.removeEventListener("lychee:quiz-invitation",enter)},[]);
        """ + point)
    tool_stack = 'O=window.lycheeWorkspaceDetail(windowsPages.current,O);'
    text = once(text, tool_stack, tool_stack + """
          if(embeddedTool&&initialTool.current&&!embeddedTool.history&&O&&O!==embeddedTool.detail&&
             ["feed","goal","question","tree","quiz"].includes(O)){
            window.parent.postMessage({type:"lychee-social-nav",dest:O},location.origin);return;
          }
          """)
    text = once(text, 'openAlbumFromGoal(false);i(!1),C(""),y(O)', 'openAlbumFromGoal(false);setQuizInvite(null);i(!1),C(""),y(O)')
    text = once(text, 'className:"room-bubble",children:R.body', 'className:"room-bubble",children:window.LycheeQuizV7.chatCard(X.jsx,R)')
    detail = 'else if(L==="ledger"||L==="focus")'
    text = once(text, detail, 'else if(L==="quiz")Ca=A.jsx("section",{className:"ph-scroll quiz-scroll",children:A.jsx(window.LycheeQuizV7,{React:Ee,initialId:quizInvite,avatarFor:Da},String(windowsVisit))});'+detail)

    text = once(text, detail,
                'else if(L==="diet"||L==="wheel")Ca=A.jsx("section",{className:"ph-scroll v7-tool",'
                'children:A.jsx(L==="diet"?window.LycheeDietV7:window.LycheeWheelV7,'
                '{React:Ee,accountId:window.LycheeAccess.scope.accountId},L)});' + detail)
    text = once(text, 'o&&!o.ready&&(0,H.jsx)("small",{role:"status"',
                'o?.ready&&o.aiQuota&&(0,H.jsx)("small",{role:"status",children:window.LycheeBusiness.quotaLabel(o.aiQuota,"chat")}),'
                'o&&!o.ready&&(0,H.jsx)("small",{role:"status"')
    portrait = 'className:"profile-id","aria-label":"编辑个人资料和头像",onClick:()=>De("profile"),children:['
    text = once(text, portrait, portrait + '(0,A.jsx)("span",{className:"profile-edit-label","aria-hidden":true,children:"编辑资料"}),')
    reminder_row = 'ya("focus","提醒事项",()=>De("tasks")),'
    profile_rows = 'className:"profile-rows",children:['
    text = once(text, profile_rows + reminder_row, profile_rows)
    text = once(text, r'ya("ledger","\u6211\u7684\u8D26\u672C",()=>De("ledger")),'
                      r'ya("focus","\u756A\u8304\u949F",()=>De("focus")),', '')
    settings_rows = 'L==="settings"?(0,A.jsxs)(A.Fragment,{children:['
    text = once(text, settings_rows + reminder_row, settings_rows)
    first, second = "今天还没人说话。", "聊天记录每天北京时间零点清空。"
    escaped = "".join("\\u%04X" % ord(c) for c in first + second)
    text = once(text, '(0,X.jsx)("div",{className:"room-empty",children:"'+escaped+'"})',
                '(0,X.jsxs)("div",{className:"room-empty",children:['+
                ','.join('(0,X.jsx)("span",{children:"'+part+'"})' for part in (first,second))+']})')
    if mobile:
        text = once(text, '!L&&(0,A.jsx)("nav",{className:"bottom"',
                    '(!L||L==="quiz"||L==="diet"||L==="wheel")&&(0,A.jsx)("nav",{className:"bottom"')
        text = once(text, "window.renderLycheeWorkspaceNav({React:Ee,tab:m,detail:L,selectTab:Za,openDetail:De,restartDetail:()=>setWindowsVisit(n=>n+1)})", "null")
    original = 'A.jsx(CircleList,{unread:l,member:c,open:circle=>{setSelectedCircle(circle);De("circle")}})'
    integrated = ('window.LycheeAccess.renderCircles(Ee,{renderCover:options=>A.jsx(A62,{mode:"ImagePicker",...options}),open:()=>{'
                  'setSelectedCircle({id:"main",name:window.LycheeAccess.scope.gardenName||"圈内聊天",subtitle:window.LycheeAccess.scope.gardenSubtitle||""});De("circle")}}),'
                  'window.LycheeAccess.scope.gardenId==="legacy"&&' + original)
    text = once(text, original, integrated)
    text = once(text, 'const entries=creating?[creating,...(circles||[])]:circles||[];',
                'const entries=(circles||[]).filter(room=>room.id!=="main");if(circles&&!entries.length)return null;')
    text = once(text, 'h("div",{className:"circle-tools"},h("h2",null,"我的圈子"),\n'
                '      h("button",{type:"button",disabled:!!creating,onClick:()=>setCreating({id:crypto.randomUUID(),name:"",subtitle:"",isNew:true})},"＋ 新建圈子")),',
                'h("div",{className:"circle-tools"},h("h2",null,"历史频道")),h("p",null,"原荔枝园成员共享的旧频道"),')
    text = once(text, 'useState)(()=>xc(g+"read","")!==co.version)', 'useState)(false)')
    previous_release = {"version": "6.4.7", "audience": "phone", "date": "2026-11-25", "required": False,
               "title": "工具箱与生图", "items": [["工具箱", "在实用小工具里打开提醒事项、约定倒计时、问一问、番茄钟和记账本。园中事在荔枝园。"],
                                               ["生图", "可在生成记录查看原图。断线后可查询上次生图，确认没有可取回的图片时退回次数。"]]}
    release = {"version": VERSION, "audience": "phone", "date": "2026-11-26", "required": False,
               "title": "照记饮食与交给命运", "items": [
                   ["照记饮食", "在工具箱拍照记录一餐，回看每天的食物和营养。"],
                   ["交给命运", "填入自己的选项，转动转盘挑一个。"]]}
    history = ",".join(json.dumps(item, ensure_ascii=False) for item in (release, previous_release))
    text = once(text, 'zf=[{"version":"6.3.3"', 'zf=[' + history + ',{"version":"6.3.3"')
    text = once(text, '[4,1,6,0][a.members.find(pe=>pe.id===O)?.avatar??0]',
                '[4,1,6,0,2,3,5,7,8,9,10,11,12,13,14,15][a.members.find(pe=>pe.id===O)?.avatar??0]??4')
    text = once(text, 'L==="settings"?(0,A.jsxs)(A.Fragment,{children:[',
                'L==="settings"?(0,A.jsxs)(A.Fragment,{children:['
                'ya("settings","管理我的圈子",()=>window.LycheeAccess.openGardens()),'
                'ya("notice","账号公告",()=>window.LycheeAccess.openAnnouncement()),'
                '(0,A.jsx)("p",{className:"settings-version",children:"当前版本 "+document.body.dataset.clientBuild}),')
    text = once(text, '()=>{Ba(async()=>{await Jn("/api/account",{mode:"logout"}),location.reload()})}',
                '()=>window.LycheeAccess.logout()')
    text = notification_phone(text, once)
    if not mobile:
        text = inbox_phone(text, once, 'window.LycheeChatInbox', compact=False)
        marker = 'ya("settings","管理我的圈子",()=>window.LycheeAccess.openGardens()),'
        text = once(text, marker,
                    'window.LycheeDesktopUpdate&&ya("settings","检查更新",()=>window.LycheeDesktopUpdate.check()),'+marker)
    return bind_business(text)


def entry(text, mobile):
    application = "/mobile/phone.js" if mobile else "/windows/phone.js"
    original = '<script src="/mobile/phone.js?v=6.3.3" defer></script>' if mobile else '<script defer src="/windows/phone.js"></script>'
    includes = '<script defer src="/client/business-scope.js"></script>'
    includes += ''.join(f'<script defer src="/client/{n}"></script>' for n in
                        ('social-v8-api.js','social-v8-plans.js','social-v8-garden.js','social-appearance.js','social-chat.js','social-tools.js','social-personal.js','social-v8.js'))
    includes += ''.join(f'<script defer src="/client/{name}"></script>' for name in TOOL_SCRIPTS)
    styles = ''.join(f'<link rel="stylesheet" href="/client/{name}">' for name in (*TOOL_STYLES,'social-v8.css','social-v8-garden.css','social-tools.css'))
    if mobile:
        includes += '<script defer src="/windows/workspace-nav.js"></script><script defer src="/windows/team-share.js"></script>'
        text = text.replace('<link rel="manifest" href="/mobile/app.webmanifest">','<link rel="icon" href="/mobile/icon.png">')
    else:
        text = text.replace('/mobile/journal.js', '/windows/journal.js')
        includes += '<script defer src="/windows/chat-inbox.js"></script><script defer src="/windows/update-ui.js"></script>'
        styles += '<link rel="stylesheet" href="/windows/update-ui.css">'
    text = once(text, original, includes + f'<script defer src="/client/garden.js" data-app="{application}"></script>')
    text = (text.replace('<body>', f'<body data-app="{application}" data-client-build="{CLIENT_BUILD}">')
            .replace('content="6.3.3"', f'content="{VERSION}"')
            .replace('</head>', styles + '<link rel="stylesheet" href="/client/garden.css">'
                     '<link rel="stylesheet" href="/client/toolbox-cards.css">'
                     '<link rel="stylesheet" href="/client/responsive-text.css">'
                     '<link rel="stylesheet" href="/client/typography.css"></head>'))
    return re.sub(r'\b(src|href)="(/[^"?]+\.(?:js|css))(?:\?v=[^"]+)?"',
                  lambda m: f'{m[1]}="{m[2]}?v={CLIENT_BUILD}"', text)


def build(out):
    hashes = json.loads((ROOT / "source/manifest.json").read_text(encoding="utf8"))
    for name, expected in hashes.items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Changed release source: " + name)
    files = {p.relative_to(SOURCE).as_posix():p.read_bytes() for p in SOURCE.rglob("*") if p.is_file()}
    canonical_phone = (SOURCE / "windows/phone.js").read_text(encoding="utf8")
    for name in list(files):
        if name in ("windows/phone.js", "mobile/phone.js"):
            files[name] = phone_bundle(canonical_phone, name.startswith("mobile/")).encode()
        elif name in ("mobile/index.html", "windows/workspace.html"):
            files[name] = entry(files[name].decode(), name.startswith("mobile/")).encode()
        elif name == "mobile/v61.js":
            files[name] = bind_business(notification_v61(files[name].decode(), once)).encode()
        elif name == "mobile/v61-sw.js":
            files[name] = (ROOT / "client/notify-sw-v7.js").read_bytes()
        elif name == "mobile/journal.js":
            files[name] = bind_business(notification_journal(files[name].decode(), once)).encode()
        elif name == "mobile/yard65.js":
            files[name] = bind_business(notification_yard(files[name].decode(), once)).encode()
        elif name == "mobile/v62.js":
            files[name] = ai_tool_bundle(files[name].decode()).encode()
        elif name == "windows/workspace-nav.js":
            nav = once(files[name].decode(), "['五子棋', 'gomoku']", "['头脑王者', 'quiz'], ['五子棋', 'gomoku']")
            for item in ("['提醒事项与记事', 'tasks']", "['我的账本', 'ledger']", "['番茄钟', 'focus']"):
                nav = once(nav, item + ", ", "")
            files[name] = once(nav, "['全部工具', ''], ",
                               "['全部工具', ''], ['照记饮食', 'diet'], ['交给命运', 'wheel'], "
                               "['提醒事项', 'tasks'], ['番茄钟', 'focus'], ['记账本', 'ledger'], ").encode()
        elif name.endswith(".js"):
            files[name] = bind_business(files[name].decode()).encode()
    files["windows/chat-inbox.js"] = (ROOT / "client/chat-inbox.js").read_bytes()
    files["windows/journal.js"] = inbox_journal(files["mobile/journal.js"].decode(), once, compact=False).encode()
    files["mobile/version.txt"] = (VERSION+"\n").encode()
    for name in ("update-ui.js", "update-ui.css"):
        files["windows/" + name] = (ROOT / "desktop" / name).read_bytes()
    files["index.html"] = b'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/mobile/">'
    for name in ("business-scope.js", "garden.js", "garden.css", "toolbox-cards.css", "responsive-text.css", "typography.css",
                 'social-v8.js','social-v8-api.js','social-v8-plans.js','social-v8-garden.js','social-appearance.js','social-chat.js','social-tools.js','social-personal.js','social-v8.css','social-v8-garden.css','social-tools.css',*SOCIAL_ART,
                 *TOOL_SCRIPTS, *TOOL_STYLES, *TOOL_IMAGES):
        files["client/" + name] = (ROOT / "client" / name).read_bytes()
    font_files = sorted((ROOT / "client/fonts").rglob("*"))
    if not any(path.suffix == ".woff2" for path in font_files):
        raise ValueError("Missing bundled WOFF2 font")
    for path in font_files:
        if path.is_file():
            files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    for name, data in files.items():
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.is_file() or target.read_bytes() != data:
            target.write_bytes(data)
    receipt = {"version": VERSION, "files": {
        name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}}
    (out.parent / (out.name+"-build.json")).write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False)+"\n", encoding="utf8")
    print(f"{VERSION}: {len(files)} files -> {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ROOT / "public")
    out = parser.parse_args().out.resolve()
    if out == ROOT or ROOT.is_relative_to(out) or any(out.is_relative_to(ROOT / p) for p in ("source","legacy","server","client")):
        raise ValueError("Choose a separate build directory")
    build(out)
