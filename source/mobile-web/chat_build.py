"""Mobile-web-only adapters for the frozen React bundle."""

from chat_inbox_build import inbox_phone, inbox_journal
import tool_views


def replace(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Unexpected mobile chat integration point: " + old[:80])
    return text.replace(old, new)


def phone(text):
    text = replace(text, 'let ve=await fc(R);j===z.current', 'let ve=await window.LycheeMobileChat.preparePhoto(R,fc);j===z.current')
    text = replace(text, 'const encoded=await fc(await response.blob());', 'const encoded=await window.LycheeMobileChat.preparePhoto(await response.blob(),fc);')
    text = replace(text, '(0,X.jsx)("img",{src:imageUrl(e.id),alt:"\\u5F15\\u7528\\u56FE\\u7247"})',
                   'X.jsx(window.LycheeMobileChat.Photo,{React:je,src:imageUrl(e.id),quoted:true})')
    text = replace(text, 'let pt=L[0]?.id;', 'const Chat=window.LycheeMobileChat;let pt=L[0]?.id;')
    text = replace(text, 'function De(){ta.current&&k.current', 'function De(){!N&&ta.current&&k.current')
    start = text.index('(0,X.jsx)("img",{className:"room-avatar"')
    end = text.index('}),(0,X.jsxs)("div",{className:"room-content"', start)
    avatar_source = text[text.index('src:', start)+4:end]
    text = replace(text, text[start:end+2], 'X.jsx(Chat.Avatar,{React:je,name:R.name,src:' + avatar_source + '})')
    start = text.index('!!R.hasImage&&(0,X.jsx)("button",{className:"room-thumb"')
    end = text.index(',R.replyTo&&', start)
    text = replace(text, text[start:end], '!!R.hasImage&&X.jsx(Chat.Photo,{React:je,src:imageUrl(R.id),open:()=>B(R.id)})')
    text = replace(text, 'N&&Xa.get(N)?.hasImage&&(0,X.jsx)(nc,{src:imageUrl(N),onClose:()=>B("")},N)',
                   'N&&Xa.get(N)?.hasImage&&X.jsx(Chat.Viewer,{React:je,Lightbox:nc,src:imageUrl(N),close:()=>B(""),log:k},N)')
    text = replace(text, 'autoFocus:!0,onClick:a,children:"\\u2039', 'onClick:a,children:"\\u2039')
    text = replace(text, 'L.slice().reverse().map(R=>R.recalled?', 'L.slice().reverse().map((R,index,rows)=>X.jsxs(je.Fragment,{children:[Chat.timeLabel(je,R,rows[index-1]),R.recalled?')
    text = replace(text, 'note:Xa.get(R.replyTo)})]})]},R.id))]}', 'note:Xa.get(R.replyTo)})]})]},R.id)]},R.id))]}')
    return inbox_phone(text, replace, 'window.LycheeMobileChat')


def journal(text):
    return inbox_journal(text, replace)


def notifications(text):
    text = replace(text, 'setNotice(row);', "if(row.kind!=='chat' && row.kind!=='room-chat')setNotice(row);")
    text = replace(text, 'if(active())pushed=s.enabled;', "if(active()){pushed=s.enabled;window.dispatchEvent(new Event('lychee:push-ready'));}")
    text = replace(text, "const claimed=fresh.filter(row=>claim(row.id));", """const claimed=fresh.filter(row=>claim(row.id)).filter(row=>{
                if (!document.hidden && (row.kind==='chat'||row.kind==='room-chat')){
                  window.dispatchEvent(new Event('lychee:chat-refresh'));return false;
                }
                return true;
              });""")
    text = replace(text, "setRows(list=>list.map", "window.dispatchEvent(new Event('lychee:chat-refresh'));setRows(list=>list.map")
    text = replace(text, "if(!row) {", """if(!row) {
            try {row=(await read('?v61=notification&id='+encodeURIComponent(id))).notification;} catch {}
          }
          if(!row) {""")
    return replace(text, "btn('刷新',refresh),", """btn('刷新',refresh),
        push && !push.enabled && h('p',null,!push.supported?'iPhone 请将荔枝添加到主屏幕，从图标打开后开启后台通知。':!push.configured?'服务器尚未启用后台推送。':'开启后台通知后，回到主屏幕或锁屏也能收到园中消息。'),""")

def direct_runtime(files):
    """Expose existing feature components without mounting the original application."""
    source = tool_views.clock_ledger(phone(files["mobile/phone.js"].decode()))
    source = replace(source, 'function hc({compact:e=!1,phoneShell:a}){let[t,l]=(0,Y.useState)(null)',
                     'function hc({compact:e=!1,phoneShell:a}){let[t,l]=(0,Y.useState)(ctx.camp)')
    source = replace(source, '[L,y]=(0,Ee.useState)(""),[v,i]', '[L,y]=(0,Ee.useState)(ctx.dest),[v,i]')
    source = replace(source, '[selectedCircle,setSelectedCircle]=Ee.useState(null)',
                     '[selectedCircle,setSelectedCircle]=Ee.useState(ctx.dest==="circle"?{id:"main",name:ctx.groupName}:null)')
    source = replace(source, 'function De(O){O=window.lycheeWorkspaceDetail',
                     'function De(O){if(O!==ctx.dest){ctx.open(O);return;}O=window.lycheeWorkspaceDetail')
    source = replace(source, '[p,g]=(0,Ze.useState)(null);return!u||n?', '[p,g]=(0,Ze.useState)(ctx.gameMode||null);return!u||n?')
    source = replace(source, 'let[u,o]=(0,aa.useState)("bank")', 'let[u,o]=(0,aa.useState)(ctx.gameMode==="team"?"team":"bank")')
    source = replace(source, 'function HL(){let[e,a]=(0,Sa.useState)("warmup")', 'function HL(){let[e,a]=(0,Sa.useState)(ctx.deck||"warmup")')
    # The surrounding social shell owns the title, badges, all four tabs and theme.
    source = replace(source, 'document.documentElement.dataset.theme=yc[d].id;', 'if(ctx)return;document.documentElement.dataset.theme=yc[d].id;')
    start = source.index('return(0,A.jsxs)("main",{className:"garden-app"')
    end = source.index('}var Ee,A,co,PS', start)
    source = source[:start] + 'return A.jsxs(Ee.Fragment,{children:[(b||s)&&A.jsx("p",{role:"status",children:b||s}),Ca]})' + source[end:]
    boot = '(0,VS.createRoot)(document.getElementById("root")).render((0,XS.jsx)(hc,{compact:!0,phoneShell:Mc}))'
    source = replace(source, boot, '''const host=VS.createRoot(ctx.node),h=Ee.createElement;
      const back=()=>ctx.open(""),players=ctx.members||[];
      const common={me:ctx.slot,member:ctx.slot,members:players,avatarUrl:id=>ctx.avatar(players.find(p=>p.id===id)),
        back,exit:back,tutorialSeen:ctx.tutorialSeen,onTutorialSeen:()=>ctx.onTutorialSeen()};
      const dest=ctx.dest;
      let page;
      if(ctx.history&&dest==="quiz")page=h(window.LycheeQuizV7,{React:Ee,initialId:ctx.oldMatch||"",avatarFor:id=>ctx.avatar(ctx.camp.members.find(p=>String(p.id)===String(id)))});
      else if(ctx.history||["style","profile"].includes(dest))page=h(hc,{compact:true,phoneShell:Mc});
      else if(dest==="wheel"||dest==="diet")page=h(dest==="wheel"?window.LycheeWheelV7:window.LycheeDietV7,
        {React:Ee,accountId:ctx.scope.accountId,gardenId:ctx.scope.gardenId});
      else if(dest==="focus"||dest==="ledger")page=h(dest==="focus"?GardenFocus:GardenLedger,{day:ctx.day});
      else if(dest==="tasks"||dest==="notifications")page=h(V61Page,{mode:dest==="tasks"?"Tasks":"Notifications",onOpen:row=>ctx.openNotice(row)});
      else if(dest==="ai-chat"||dest==="ai-image")page=h(A62,{mode:dest==="ai-chat"?"Chat":"ImagePage",
        initialRatio:ctx.wallpaperMode?"9:16":undefined,onApply:picture=>ctx.wallpaper(picture)});
      else if(dest==="quiz")page=h(window.LycheeQuizV7,{React:Ee,initialId:ctx.match.id,friendPlay:ctx.friendPlay,avatarFor:id=>ctx.avatar(players.find(p=>p.id===String(id)))});
      else if(dest==="gomoku")page=h(vn,{...common,backLabel:"工具箱"});
      else if(dest==="soup")page=h(bn,common);
      else if(dest==="riddles")page=h(In,common);
      else throw Error("没有这个工具");
      host.render(page);unmount=()=>host.unmount();''')
    # Each mount captures the signed-in account and the exact garden/match. Async handlers
    # from a former page cannot later target a different account or game.
    modules = ["client/business-scope.js", "windows/team-share.js", "mobile/v62.js",
               "mobile/v61.js", "mobile/journal.js", "mobile/yard65.js", "client/quiz-v7.js",
               "client/wheel-v7.js", "client/diet-v7.js"]
    parts = ["globalThis.LycheeDirectRuntime=function(ctx){const window=ctx.window;let unmount;"]
    for name in modules:
        code = files[name].decode()
        if name == "mobile/v61.js":
            code = tool_views.tasks(code)
        elif name == "mobile/v62.js":
            code = tool_views.ai(code)
        elif name == "client/wheel-v7.js":
            code = replace(code, "const [expanded, setExpanded] = React.useState(false)", "const [expanded, setExpanded] = React.useState(true)")
        elif name == "client/diet-v7.js":
            code = tool_views.diet(code)
        elif name == "mobile/journal.js":
            code = journal(code)
        parts.append(code + "\n;")
        if name == "client/business-scope.js":
            parts.append('if(ctx.roomApi)window.LycheeBusiness.api=ctx.roomApi;')
    parts.extend([source, "\nreturn unmount;};"])
    return "\n".join(parts).encode()
