"""Integrate the shared notification UI with the existing garden screens."""


def notification_phone(text, once):
    route = """row => {
      if (!row) { De("notifications"); return; }
      window.LycheeNotifications.open(row, {
        page:De,
        chat:async room => {
          if (room === "main") {
            setSelectedCircle({id:"main",name:window.LycheeAccess.scope.gardenName||"圈内聊天"});
          } else {
            const data=await circleRequest();
            const channel=data.circles.find(c=>c.id===room);
            if(!channel) { De("notifications");return; }
            setSelectedCircle(channel);
          }
          De("circle");
        }
      });
    }"""
    text = once(text, 'mode:"NotificationWatch",me:c,onOpen:()=>De("notifications")',
                'mode:"NotificationWatch",me:c,onOpen:' + route)
    text = once(text, 'onTasks:()=>De("tasks"),onFeed:()=>De("feed"),onQuestions:()=>De("question")',
                'onOpen:' + route)
    return once(text, 'className:"room-row"+(R.id.split',
                '"data-notice-item":R.id,className:"room-row"+(R.id.split')


def notification_v61(text, once):
    start = text.index(' function Notifications(')
    end = text.index(' return{EmojiBar,Clock,', start)
    text = text[:start] + ' const {Notifications,NotificationWatch}=window.LycheeNotifications.views({React,read,write});\n' + text[end:]
    text = once(text, "className:'v61-card v61-question',key:q.id",
                "className:'v61-card v61-question','data-notice-item':q.id,key:q.id")
    text = once(text, "return h('article',{className:'v61-card',key:x.id}",
                "return h('article',{className:'v61-card','data-notice-item':x.id,key:x.id}")
    return text


def notification_journal(text, once):
    return once(text, 'key:p.id,className:"j-story"', 'key:p.id,"data-notice-item":p.id,className:"j-story"')


def notification_yard(text, once):
    return once(text, "{key:f.crop+':'+f.slot,disabled:busy}",
                "{key:f.crop+':'+f.slot,'data-notice-item':f.crop+':'+f.slot,disabled:busy}")
