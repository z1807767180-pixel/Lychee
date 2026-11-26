/* Mobile website chat. Media stays in this document and in its current garden. */
window.LycheeMobileChat = (() => {
  'use strict';
  const media = new Map();
  // Keep a standard JFXX JPEG thumbnail with the photo, so expiry and recall remain atomic.
  async function preparePhoto(file,compress){
    const encoded=await compress(file);
    try{
      const full=atob(encoded);
      if(!full.startsWith('\xff\xd8\xff\xe0') || full.slice(6,11)!=='JFIF\0')return encoded;
      const img=new Image();img.src='data:image/jpeg;base64,'+encoded;await img.decode();
      const scale=Math.min(1,256/Math.max(img.naturalWidth,img.naturalHeight));
      if(scale===1)return encoded;
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const thumb=atob(canvas.toDataURL('image/jpeg',0.62).split(',')[1]);
      if(thumb.length>18000 || thumb.length>=full.length/2)return encoded;
      const offset=4+full.charCodeAt(4)*256+full.charCodeAt(5);
      const length=thumb.length+8;
      const segment='\xff\xe0'+String.fromCharCode(length>>8,length&255)+'JFXX\0\x10'+thumb;
      if(Math.ceil((full.length+segment.length)/3)*4>384000)return encoded;
      return btoa(full.slice(0,offset)+segment+full.slice(offset));
    }catch{return encoded;}
  }
  const previewUrl=url=>url+'&preview=1';
  function acquire(url) {
    let entry = media.get(url);
    if (!entry) {
      const controller = new AbortController();
      entry = {users:0, controller};
      entry.promise = fetch(url, {credentials:'same-origin',signal:controller.signal}).then(async response => {
        if (!response.ok) throw Error('图片暂时无法读取');
        entry.full=response.headers.get('X-Lychee-Preview')!=='small';
        const blob = await response.blob();
        if (controller.signal.aborted || !blob.type.startsWith('image/')) throw Error('图片无效');
        entry.src = URL.createObjectURL(blob);
        return entry.src;
      }).catch(error => {
        if (media.get(url)===entry) media.delete(url);
        throw error;
      });
      media.set(url,entry);
    }
    entry.users++;
    return {promise:entry.promise, release() {
      if (--entry.users) return;
      entry.controller.abort();
      if (entry.src) URL.revokeObjectURL(entry.src);
      if (media.get(url)===entry) media.delete(url);
    }};
  }

  function useMedia(React,url,visible) {
    const [attempt,retry] = React.useReducer(n=>n+1,0);
    const [result,setResult] = React.useState(null);
    React.useEffect(()=>{
      if (!visible || !url) return;
      let live=true;
      const handle=acquire(url);
      handle.promise.then(src=>{if(live)setResult({url,attempt,src});},
        ()=>{if(live)setResult({url,attempt,error:true});});
      return ()=>{live=false;handle.release();};
    },[url,visible,attempt]);
    return [result?.url===url && result.attempt===attempt ? result : {}, retry];
  }

  function useNearby(React,ref) {
    const [near,setNear]=React.useState(false);
    React.useEffect(()=>{
      const root=ref.current?.closest('.room-log'), row=ref.current?.closest('.room-row')||ref.current;
      if (!root || !row || !('IntersectionObserver' in window)) {setNear(true);return;}
      const observer=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){setNear(true);observer.disconnect();}
      },{root,rootMargin:'120px 0px'});
      // A pending photo or quote can have no pixels of its own. Its message row is always laid out.
      observer.observe(row);
      return ()=>observer.disconnect();
    },[]);
    return near;
  }

  function Avatar({React,src,name}) {
    const h=React.createElement,ref=React.useRef(null);
    const [image,retry]=useMedia(React,src,useNearby(React,ref));
    const [broken,setBroken]=React.useState('');
    const failed=image.error || (image.src && broken===image.src);
    return h('button',{type:'button',className:'room-avatar mobile-chat-avatar',ref,
      disabled:!failed,'aria-label':failed?'重新加载'+name+'的头像':name+'的头像',onClick:retry},
      Array.from(name||'园')[0],image.src && !failed && h('img',{src:image.src,alt:'',onError:()=>setBroken(image.src)}));
  }

  function fitPhoto(element,width,height,quoted){
    if(!element || !width || !height)return;
    const log=element.closest('.room-log'),bounds=log?.getBoundingClientRect();
    const pinned=log && log.scrollHeight-log.scrollTop-log.clientHeight<12;
    const anchor=log && !pinned ? [...log.querySelectorAll('.room-row')].find(row=>row.getBoundingClientRect().bottom>bounds.top) : null;
    const before=anchor?.getBoundingClientRect().top;
    const limit=quoted?48:190,cap=quoted?50:250;
    element.style.setProperty('--photo-width',Math.min(limit,width,cap*width/height)+'px');
    element.style.aspectRatio=width+' / '+height;
    element.dataset.sized='true';
    // Preserve the reader's anchor even in browsers without scroll anchoring. At the bottom keep the latest message in view.
    if(pinned)log.scrollTop=log.scrollHeight;
    else if(anchor)log.scrollTop+=anchor.getBoundingClientRect().top-before;
  }

  function Photo({React,src,open,quoted=false}) {
    const h=React.createElement,ref=React.useRef(null);
    const [image,retry]=useMedia(React,previewUrl(src),useNearby(React,ref));
    const [broken,setBroken]=React.useState('');
    const failed=image.error || (image.src && broken===image.src);
    const img=image.src&&!failed?h('img',{alt:quoted?'引用图片':'聊天图片',src:image.src,
      onLoad:e=>fitPhoto(ref.current,e.currentTarget.naturalWidth,e.currentTarget.naturalHeight,quoted),
      onError:()=>setBroken(image.src)}):null;
    if(quoted)return h('span',{ref,className:'mobile-chat-quote'},img);
    return h('button',{type:'button',className:'mobile-chat-photo',ref,
      disabled:!failed&&!image.src,'aria-label':failed?'重新加载聊天图片':'打开聊天图片',onClick:failed?retry:open},
      failed?h('span',{className:'mobile-chat-retry'},'↻ 重试'):img);
  }

  function Viewer({React,Lightbox,src,log,close}) {
    const h=React.createElement,dialog=React.useRef(null),gesture=React.useRef(null),finish=React.useRef(null);
    const preview=previewUrl(src);
    const [image,retry]=useMedia(React,media.get(preview)?.full?preview:src,true);
    React.useLayoutEffect(()=>{
      const node=dialog.current,scroller=log.current,top=scroller?.scrollTop,focus=document.activeElement;
      const marker=crypto.randomUUID();
      let closing=false;
      history.pushState({...history.state,lycheePhoto:marker},'');
      node.showModal();
      function dismiss(){
        if(closing)return;
        closing=true;
        if(history.state?.lycheePhoto===marker)history.back();else close();
      }
      finish.current=dismiss;
      function back(){close();}
      window.addEventListener('popstate',back);
      return ()=>{
        window.removeEventListener('popstate',back);
        if(history.state?.lycheePhoto===marker)history.back();
        node.close();
        if(focus?.isConnected)focus.focus({preventScroll:true});
        if(scroller?.isConnected)scroller.scrollTop=top;
      };
    },[]);
    function start(e){
      if(!e.isPrimary || e.target.closest('button') || e.target.closest('[data-enlarged]')){gesture.current=null;return;}
      gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY};
    }
    function end(e){
      const point=gesture.current;
      gesture.current=null;
      if(!point||e.pointerId!==point.id)return;
      const dx=Math.abs(e.clientX-point.x),dy=e.clientY-point.y;
      if((dx<12 && Math.abs(dy)<12)||(dy>=56 && dy>dx*1.3))finish.current();
    }
    return h('dialog',{ref:dialog,className:'mobile-chat-viewer','aria-label':'查看聊天图片',
      onCancel:e=>{e.preventDefault();finish.current();},
      onPointerDownCapture:start,onPointerUpCapture:end,onPointerCancel:()=>{gesture.current=null;}},
      image.src?h(Lightbox,{src:image.src,onClose:()=>finish.current()}):
        h('div',{className:'mobile-photo-pending'},h('button',{onClick:()=>finish.current()},'返回聊天'),
          image.error?h('button',{onClick:retry},'重试图片'):'加载中…'));
  }

  function chinaTime(stamp){return new Date(stamp+8*3600000).toISOString();}
  function timeLabel(React,note,previous){
    const stamp=Number(note.created),prior=Number(previous?.created);
    if(!Number.isFinite(stamp)||stamp<=0)return null;
    const iso=chinaTime(stamp),day=iso.slice(0,10),cross=prior>0 && day!==chinaTime(prior).slice(0,10);
    if(prior>0 && !cross && stamp-prior<5*60000)return null;
    const date=!prior || cross || day!==chinaTime(Date.now()).slice(0,10) ? day+' ' : '';
    return React.createElement('time',{className:'mobile-chat-time',dateTime:new Date(stamp).toISOString()},date+iso.slice(11,16));
  }

  const empty={count:0,firstRoom:null};
  function presence(scope){
    const page=crypto.randomUUID(),query=new URLSearchParams({accountId:scope.accountId,gardenId:scope.gardenId});
    const route='/api/v7/push?'+query;
    let endpoint='',through=0,stopped=false,order=0,sequence=0;
    function send(visible){
      if(!endpoint)return;
      const body=JSON.stringify({action:'presence',page,endpoint,visible,through,sequence:++sequence});
      if(!visible && navigator.sendBeacon?.(route,new Blob([body],{type:'application/json'})))return;
      return fetch(route,{method:'POST',credentials:'same-origin',keepalive:!visible,
        headers:{'Content-Type':'application/json'},body}).catch(()=>{});
    }
    async function report(latest){
      if(stopped || !window.LycheeWebPush?.enabled())return;
      if(latest)through=Math.max(through,latest);
      const ticket=++order;
      if(!endpoint){
        try{
          const reg=await navigator.serviceWorker.getRegistration('/mobile/');
          const sub=await reg?.pushManager?.getSubscription();
          if(stopped||ticket!==order)return;
          endpoint=sub?.endpoint||'';
        }catch{return;}
      }
      if(!stopped)void send(!document.hidden);
    }
    const change=()=>{if(document.hidden){order++;void send(false);}else void report();};
    const leave=()=>{order++;void send(false);};
    document.addEventListener('visibilitychange',change);window.addEventListener('pagehide',leave);
    window.addEventListener('lychee:push-changed',change);
    window.addEventListener('lychee:push-ready',change);
    return {report,stop(){
      stopped=true;leave();document.removeEventListener('visibilitychange',change);
      window.removeEventListener('pagehide',leave);window.removeEventListener('lychee:push-changed',change);
      window.removeEventListener('lychee:push-ready',change);
    }};
  }
  function useInbox(React,read,write){
    const [badge,setBadge]=React.useState(empty);
    const access=window.LycheeAccess?.scope,owner=access?.accountId+'/'+access?.gardenId;
    React.useEffect(()=>{
      let live=true,busy=false,again=false,timer;
      setBadge(empty);
      if(!access?.accountId||!access.gardenId)return;
      const device=presence(access);
      const acknowledged=new Map();
      function current(){
        const rooms=[...document.querySelectorAll('[data-chat-room]')];
        return rooms.reverse().find(room=>room.getClientRects().length);
      }
      function readThrough(log){
        if(!log)return 0;
        if(log.scrollHeight-log.scrollTop-log.clientHeight<12)return Number(log.dataset.chatThrough);
        const bounds=log.getBoundingClientRect();
        for(const row of [...log.querySelectorAll('[data-chat-created]')].reverse()){
          const rect=row.getBoundingClientRect();
          if(rect.bottom<=bounds.bottom+1 && rect.bottom>bounds.top)return Number(row.dataset.chatCreated);
        }
        return 0;
      }
      async function refresh(){
        if(!live||document.hidden)return;
        if(busy){again=true;return;}
        busy=true;
        try{
          const log=current(),room=log?.dataset.chatRoom,through=readThrough(log);
          if(room && through>(acknowledged.get(room)||0) && !document.querySelector('dialog.mobile-chat-viewer[open]')){
            await write({type:'v61-chat-read',room,through});
            acknowledged.set(room,through);
          }
          if(!live)return;
          const {rooms}=await read('?v61=chat-inbox');
          if(live){
            setBadge({count:rooms.reduce((sum,item)=>sum+Number(item.unread),0),firstRoom:rooms[0]?.room});
            void device.report(Number(rooms[0]?.latest)||0);
          }
        }catch{}finally{
          busy=false;if(again&&live){again=false;schedule();}
        }
      }
      function schedule(){clearTimeout(timer);timer=setTimeout(refresh,60);}
      let last='';
      const observer=new MutationObserver(()=>{
        const log=current(),key=(log?.dataset.chatRoom||'')+'/'+(log?.dataset.chatThrough||'')+'/'+!!document.querySelector('dialog.mobile-chat-viewer[open]');
        if(key!==last){last=key;schedule();}
      });
      observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-chat-through','data-chat-room','open']});
      document.addEventListener('visibilitychange',schedule);
      const scrolled=e=>{if(e.target?.matches?.('[data-chat-room]'))schedule();};
      document.addEventListener('scroll',scrolled,true);
      window.addEventListener('lychee:chat-refresh',schedule);
      const poll=setInterval(refresh,8000);schedule();
      return ()=>{live=false;device.stop();observer.disconnect();clearInterval(poll);clearTimeout(timer);
        document.removeEventListener('visibilitychange',schedule);document.removeEventListener('scroll',scrolled,true);
        window.removeEventListener('lychee:chat-refresh',schedule);};
    },[owner]);
    return badge;
  }
  return {Avatar,Photo,Viewer,timeLabel,useInbox,preparePhoto};
})();
