"""Mobile-web-only adapters for the frozen React bundle."""


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
    text = replace(text, 'function so({imageUrl=sc,', 'function so({roomId="main",imageUrl=sc,')
    text = replace(text, 'return h(so,{...chat,hideDaily:true,', 'return h(so,{...chat,roomId:circle.id,hideDaily:true,')
    text = replace(text, 'className:"room-log",ref:k', '"data-chat-room":roomId,"data-chat-through":L[0]?.created||0,className:"room-log",ref:k')
    text = replace(text, '"data-notice-item":R.id,className:"room-row"', '"data-notice-item":R.id,"data-chat-created":R.created,className:"room-row"')
    text = replace(text, 'let c=a.me,p=a.members.find', 'const chatBadge=window.LycheeMobileChat.useInbox(Ee,fu,Kt);let c=a.me,p=a.members.find')
    point = 'function De(O){O=window.lycheeWorkspaceDetail'
    text = replace(text, point, '''function openChatBadge(){
      const room=chatBadge.firstRoom;
      if(!room||room==="main"){i(!v);return;}
      circleRequest().then(data=>{
        const match=data.circles.find(channel=>channel.id===room);
        if(match){setSelectedCircle(match);De("circle");}else De("notifications");
      }).catch(()=>De("notifications"));
    }''' + point)
    text = replace(text, 'chat:()=>i(true),unread:l,goal:', 'chat:openChatBadge,unread:chatBadge.count,goal:')
    start = text.index('(It||L==="question"||L==="feed"||!L&&m===')
    end = text.index(']})]}),(0,A.jsx)(Ic', start)
    text = replace(text, text[start:end+3], '''((!v&&L!=="circle")||chatBadge.count>0)&&A.jsxs("button",{
      type:"button",className:"bubble mobile-chat-badge","aria-label":"聊天，"+chatBadge.count+"条未读",
      onClick:openChatBadge,
      children:[A.jsx(Ta,{name:"聊"}),chatBadge.count>0&&A.jsx("em",{children:chatBadge.count>99?"99+":chatBadge.count})]})''')
    # “我” originally hides the entire header; its chat shortcut must remain reachable.
    text = replace(text, 'className:"appbar"+(!L&&m==="\\u6211"?" visually-hidden":"")', 'className:"appbar"')
    return text


def journal(text):
    return replace(text, 'home&&!demo&&btn(h(Icon,{name:"聊",size:20}),chat,"",{"aria-label":"小队聊天"+(unread?"，有未读消息":"")})',
                   '''!demo&&(home||unread>0)&&btn(h("span",{className:"mobile-journal-bubble"},
                    h(Icon,{name:"聊",size:20}),unread>0&&h("em",null,unread>99?"99+":unread)),chat,"",{"aria-label":"聊天，"+unread+"条未读"})''')


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
