'use strict';

window.LycheeNotifications = (() => {
  const headings = {
    chat: '园中聊天', 'room-chat': '频道聊天', answer: '问一问 · 新回答',
    'question-reaction': '问一问 · 新回应', comment: '园中事 · 新评论',
    reaction: '园中事 · 新回应', reminder: '事项提醒', gift: '荔枝树 · 收到荔枝'
  };
  const title = row => headings[row.kind] || '园中消息';
  const scope = () => {
    const active = window.LycheeAccess?.scope;
    return active && active.accountId + '/' + active.gardenId;
  };
  const native = () => location.pathname === '/windows/workspace.html' ? window.chrome?.webview : null;
  const android = () => window.Capacitor?.getPlatform?.()==='android' ? window.Capacitor.Plugins?.LycheeAlerts : null;
  let pendingScroll;
  function open(row, actions) {
    if (pendingScroll) pendingScroll();
    const item = row.kind === 'room-chat' ? row.item?.split('/')[1] : row.item;
    if (item) {
      const observer = new MutationObserver(focus);
      const timeout = setTimeout(stop, 4500);
      function stop() {
        clearTimeout(timeout);observer.disconnect();pendingScroll=null;
      }
      function focus() {
        if(row.kind==='gift'){
          document.querySelector('.yard-basket[aria-expanded="false"]')?.click();
        }
        const target = document.querySelector('[data-notice-item="' + CSS.escape(item) + '"]');
        if (!target) return;
        stop();
        target.scrollIntoView({block:'center'});
        if (row.kind === 'answer' && !target.querySelector('.v61-answers')) {
          const button = [...target.querySelectorAll('button')].find(b => b.textContent.includes('条回答'));
          button?.click();
        }
      }
      pendingScroll=stop;
      observer.observe(document.body,{subtree:true,childList:true});
      requestAnimationFrame(focus);
    }
    if (row.kind === 'chat' || row.kind === 'room-chat') {
      actions.chat(row.kind === 'chat' ? 'main' : row.item.split('/')[0]).catch(()=>actions.page('notifications'));
    } else {
      actions.page(({reminder:'tasks',answer:'question','question-reaction':'question',comment:'feed',reaction:'feed',gift:'tree'})[row.kind] || 'notifications');
    }
  }

  function views({React,read,write}) {
    const {createElement:h,useState,useEffect,useRef} = React;
    function NotificationWatch({onOpen}) {
      const [notice,setNotice] = useState(null);
      const openRef = useRef(onOpen);
      openRef.current=onOpen;
      const owner=scope();
      useEffect(()=>{
        if (!owner) return undefined;
        const bridge=native(), phone=android();
        const seenKey='lychee.v7.delivered.'+owner;
        const records = new Map();
        let alive=true, busy=false, pushed=Boolean(window.LycheeWebPush?.enabled());
        let previous=null;
        const active=()=>alive && scope()===owner;
        let memory=[];
        function claim(id) {
          if (!active())return false;
          try { memory=JSON.parse(localStorage.getItem(seenKey)||'[]'); } catch {}
          if(memory.includes(id))return false;
          memory=[...memory.slice(-299),id];
          try {localStorage.setItem(seenKey,JSON.stringify(memory));} catch {}
          return true;
        }
        function show(row) {
          if (!active())return;
          setNotice(row);
          if (bridge) {
            const key=owner+'|'+row.id;
            bridge.postMessage('notify:show\n'+key+'\n'+(title(row)+' · '+row.body).slice(0,220));
          } else if (!phone && !pushed && document.hidden && window.Notification?.permission==='granted' && navigator.serviceWorker) {
            navigator.serviceWorker.getRegistration('/mobile/').then(sw=>{
              if (sw && active())return sw.showNotification(title(row),{
                body:row.body, tag:owner+'/'+row.id, data:{id:row.id,scope:owner}
              });
            }).catch(()=>{});
          }
        }
        async function tick() {
          if (!active() || busy)return;
          busy=true;
          try {
            const {notifications=[]}=await read('?v61=notifications');
            if(!active())return;
            records.clear();
            for (const row of notifications)records.set(row.id,row);
            const fresh=previous ? notifications.filter(row=>!row.read && !previous.has(row.id)).reverse() : [];
            previous=new Set(notifications.map(row=>row.id));
            function deliver() {
              const claimed=fresh.filter(row=>claim(row.id));
              if(phone)for(const row of claimed)phone.deliver({owner,id:row.id,created:row.created}).catch(()=>{});
              if(claimed.length)show(claimed[claimed.length-1]);
            }
            if(navigator.locks)await navigator.locks.request(seenKey,deliver);
            else deliver();
          } catch {} finally {busy=false;}
        }
        async function openId(id) {
          if(!active())return;
          let row=records.get(id);
          if(!row) {
            try {row=(await read('?v61=notifications')).notifications?.find(x=>x.id===id);} catch {}
          }
          if(!active())return;
          if(row)void write({type:'v61-read',id}).catch(()=>{});
          setNotice(null);
          openRef.current?.(row || null);
        }
        function fromNative(e) {
          if(e.data==='notify:poll')void tick();
          const prefix='notify:open\n'+owner+'|';
          if(typeof e.data==='string' && e.data.startsWith(prefix))void openId(e.data.slice(prefix.length));
        }
        function fromWorker(e) {
          if(e.data?.type==='lychee:open-notification' && e.data.scope===owner)void openId(e.data.id);
        }
        function fromHash() {
          const params=new URLSearchParams(location.hash.slice(1));
          if(!params.has('lychee-notice') || params.get('scope')!==owner)return;
          history.replaceState(null,'',location.pathname+location.search);
          void openId(params.get('lychee-notice'));
        }
        function refreshPush() {
          if(!phone && window.LycheeWebPush)Promise.resolve(window.LycheeWebPush.status()).then(s=>{if(active())pushed=s.enabled;}).catch(()=>{});
        }
        async function fromAndroid() {
          if(!phone || !active())return;
          try {
            const result=await phone.takeOpen({owner});
            if(result?.id && active())void openId(result.id);
          }catch{}
        }
        bridge?.addEventListener('message',fromNative);
        navigator.serviceWorker?.addEventListener('message',fromWorker);
        if(!bridge && !phone && navigator.serviceWorker && location.pathname.startsWith('/mobile/')){
          navigator.serviceWorker.register('/mobile/v61-sw.js',{scope:'/mobile/'}).catch(()=>{});
        }
        const wake=()=>{if(!document.hidden)void tick();};
        const click=e=>{if(e.detail)void openId(e.detail);};
        window.addEventListener('lychee:click-incoming',click);
        window.addEventListener('lychee:push-changed',refreshPush);
        if(phone) {
          window.addEventListener('lychee:android-open',fromAndroid);
          phone.bind({owner}).then(fromAndroid).catch(()=>{});
        }
        window.addEventListener('hashchange',fromHash);
        document.addEventListener('visibilitychange',wake);
        fromHash();refreshPush();void tick();
        const timer=setInterval(tick,8000);
        return ()=>{
          alive=false;clearInterval(timer);
          bridge?.removeEventListener('message',fromNative);
          bridge?.postMessage('notify:reset');
          navigator.serviceWorker?.removeEventListener('message',fromWorker);
          document.removeEventListener('visibilitychange',wake);
          window.removeEventListener('lychee:click-incoming',click);
          window.removeEventListener('lychee:push-changed',refreshPush);
          window.removeEventListener('lychee:android-open',fromAndroid);
          window.removeEventListener('hashchange',fromHash);
        };
      },[owner]);
      if(!notice)return null;
      return h('div',{role:'status',className:'v61-toast'},h('div',{className:'v61-grow'},h('strong',null,title(notice)),h('p',null,notice.body)),
        h('button',{type:'button',onClick:()=>window.dispatchEvent(new CustomEvent('lychee:click-incoming',{detail:notice.id}))},'查看'),
        h('button',{type:'button','aria-label':'关闭提醒',onClick:()=>setNotice(null)},'×'));
    }
    function Notifications({onOpen}) {
      const [rows,setRows]=useState([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
      const [push,setPush]=useState(null),[pending,setPending]=useState(false);
      const [permission,setPermission]=useState(window.Notification?.permission);
      const owner=scope();
      const mounted=useRef(false);
      async function refresh() {
        try {
          const {notifications=[]}=await read('?v61=notifications');
          if(mounted.current && scope()===owner){setRows(notifications);setLoaded(true);setError('');}
        }catch{if(mounted.current)setError('消息暂时没能加载。');}
      }
      useEffect(()=>{
        mounted.current=true;void refresh();
        const provider=android()||(!native()&&window.LycheeWebPush);
        if(provider)provider.status({owner}).then(s=>{if(mounted.current)setPush(s);}).catch(()=>{});
        const interval=setInterval(refresh,8000);
        return ()=>{mounted.current=false;clearInterval(interval);};
      },[owner]);
      async function mark(row,go) {
        try {
          if(!row.read)await write({type:'v61-read',id:row.id});
          if(!mounted.current || scope()!==owner)return;
          setRows(list=>list.map(r=>r.id===row.id?{...r,read:true}:r));
          if(go)onOpen?.(row);
        }catch{if(mounted.current)setError('暂时无法保存已读状态，请重试。');}
      }
      async function togglePush() {
        setPending(true);setError('');
        try {
          const provider=android()||window.LycheeWebPush;
          setPush(await (push.enabled?provider.disable({owner}):provider.enable({owner})));
          window.dispatchEvent(new Event('lychee:push-changed'));
        }catch(e){if(mounted.current)setError(e.message||'请检查系统通知权限。');}
        finally{if(mounted.current)setPending(false);}
      }
      const btn=(label,fn,disabled=false)=>h('button',{type:'button',className:'v61-pill',onClick:fn,disabled},label);
      return h('div',{className:'v61-wrap'},h('section',{className:'v61-card'},h('h2',null,'园中的消息'),
        btn('刷新',refresh),push?.supported && push.configured && btn(push.enabled?'关闭后台通知':'开启后台通知',togglePush,pending),
        !native()&&!android()&&push&&!push.configured&&permission==='default'&&
          btn('开启网页通知',async()=>{try{setPermission(await Notification.requestPermission());}catch{setError('请检查浏览器通知权限。');}})),
        error&&h('p',{role:'alert'},error),
        rows.map(row=>h('article',{className:'v61-card',key:row.id},
          h('div',{className:'v61-heading'},h('strong',null,title(row)),!row.read&&h('span',{className:'v61-unread'},'未读')),
          h('p',null,row.body),h('small',null,new Date(row.created).toLocaleString('zh-CN')),
          h('div',{className:'v61-row'},btn('查看',()=>mark(row,true)),!row.read&&btn('标为已读',()=>mark(row,false))))),
        loaded&&!rows.length&&h('p',{className:'v61-empty'},'暂时没有新消息'));
    }
    return {NotificationWatch,Notifications};
  }
  return {views,open};
})();
