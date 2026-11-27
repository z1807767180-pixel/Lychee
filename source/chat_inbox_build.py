"""Wire the main room, channels and header to the account's chat inbox."""

def inbox_phone(text, replace, hook, compact=True):
    text = replace(text, 'function so({imageUrl=sc,', 'function so({roomId="main",imageUrl=sc,')
    text = replace(text, 'return h(so,{...chat,hideDaily:true,', 'return h(so,{...chat,roomId:circle.id,hideDaily:true,')
    text = replace(text, 'className:"room-log",ref:k', '"data-chat-room":roomId,"data-chat-through":L[0]?.created||0,className:"room-log",ref:k')
    text = replace(text, '"data-notice-item":R.id,className:"room-row"', '"data-notice-item":R.id,"data-chat-created":R.created,className:"room-row"')
    text = replace(text, 'let c=a.me,p=a.members.find', 'const chatBadge='+hook+'.useInbox(Ee,fu,Kt);let c=a.me,p=a.members.find')
    count = 'chatBadge.count>99?"99+":chatBadge.count' if compact else 'chatBadge.count'
    scroll_to_unread = "" if compact else """
      const log=[...document.querySelectorAll('[data-chat-room]')].reverse()
        .find(log=>log.dataset.chatRoom===room && log.getClientRects().length);
      if(log){
        log.scrollTop=log.scrollHeight;window.dispatchEvent(new Event('lychee:chat-refresh'));return;
      }"""
    point = 'function De(O){O=window.lycheeWorkspaceDetail'
    text = replace(text, point, '''function openChatBadge(){
      const room=chatBadge.firstRoom;''' + scroll_to_unread + '''
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
      children:[A.jsx(Ta,{name:"聊"}),chatBadge.count>0&&A.jsx("em",{children:''' + count + '''})]})''')
    # “我” originally hides the entire header; its chat shortcut must remain reachable.
    text = replace(text, 'className:"appbar"+(!L&&m==="\\u6211"?" visually-hidden":"")', 'className:"appbar"')
    return text


def inbox_journal(text, replace, compact=True):
    count = 'unread>99?"99+":unread' if compact else 'unread'
    return replace(text, 'home&&!demo&&btn(h(Icon,{name:"聊",size:20}),chat,"",{"aria-label":"小队聊天"+(unread?"，有未读消息":"")})',
                   '''!demo&&(home||unread>0)&&btn(h("span",{className:"mobile-journal-bubble"},
                    h(Icon,{name:"聊",size:20}),unread>0&&h("em",null,''' + count + ''')),chat,"",{"aria-label":"聊天，"+unread+"条未读"})''')
