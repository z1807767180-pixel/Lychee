"""Mobile-web-only adapters for the frozen React bundle."""

from chat_inbox_build import inbox_phone, inbox_journal


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
