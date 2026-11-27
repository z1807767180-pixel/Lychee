'use strict';
window.LycheeChatInbox=(()=>{
  const empty={count:0,firstRoom:null};
  function useInbox(React,read,write,presence){
    const [badge,setBadge]=React.useState(empty);
    const access=window.LycheeAccess?.scope,owner=access?.accountId+'/'+access?.gardenId;
    React.useEffect(()=>{
      let live=true,busy=false,again=false,timer;
      setBadge(empty);
      if(!access?.accountId||!access.gardenId||window.lycheeToolEntry?.privateTools)return;
      const device=presence?.(access);
      const desktop=location.pathname==='/windows/workspace.html';
      const bridge=desktop && window.chrome?.webview;
      let windowActive=false;
      function focused(){return bridge?windowActive:document.hasFocus();}
      function nativeState(event){
        if(event.data==='notify:active'||event.data==='notify:inactive'){
          windowActive=event.data==='notify:active';schedule();
        } else if(event.data==='notify:poll')schedule();
      }
      const acknowledged=new Map();
      function current(){
        const rooms=[...document.querySelectorAll('[data-chat-room]')];
        return rooms.reverse().find(room=>room.getClientRects().length);
      }
      function readThrough(log){
        if(!log)return 0;
        const bounds=log.getBoundingClientRect();
        if(desktop){
          const x=(Math.max(0,bounds.left)+Math.min(innerWidth,bounds.right))/2;
          const y=(Math.max(0,bounds.top)+Math.min(innerHeight,bounds.bottom))/2;
          if(!log.contains(document.elementFromPoint(x,y)))return 0;
        }
        if(log.scrollHeight-log.scrollTop-log.clientHeight<12)return Number(log.dataset.chatThrough);
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
          const rows=through?log.querySelectorAll('[data-chat-created="'+through+'"]'):[];
          const lastId=rows[rows.length-1]?.dataset.noticeItem;
          const previous=acknowledged.get(room);
          const changed=through>0 && (!previous || through>previous.through ||
            (through===previous.through && lastId!==previous.id));
          if(room && changed && (!desktop || focused()) && !document.querySelector('dialog.mobile-chat-viewer[open],.room-lightbox')){
            await write({type:'v61-chat-read',room,through});
            acknowledged.set(room,{through,id:lastId});
          }
          if(!live)return;
          const {rooms}=await read('?v61=chat-inbox');
          if(live){
            setBadge({count:rooms.reduce((sum,item)=>sum+Number(item.unread),0),firstRoom:rooms[0]?.room});
            void device?.report(Number(rooms[0]?.latest)||0);
          }
        }catch{}finally{
          busy=false;if(again&&live){again=false;schedule();}
        }
      }
      function schedule(){clearTimeout(timer);timer=setTimeout(refresh,60);}
      let last='';
      const observer=new MutationObserver(()=>{
        const log=current(),key=(log?.dataset.chatRoom||'')+'/'+(log?.dataset.chatThrough||'')+'/'+!!document.querySelector('dialog.mobile-chat-viewer[open],.room-lightbox');
        if(key!==last){last=key;schedule();}
      });
      observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-chat-through','data-chat-room','open']});
      document.addEventListener('visibilitychange',schedule);
      const scrolled=e=>{if(e.target?.matches?.('[data-chat-room]'))schedule();};
      document.addEventListener('scroll',scrolled,true);
      window.addEventListener('lychee:chat-refresh',schedule);
      if(bridge){bridge.addEventListener('message',nativeState);bridge.postMessage('notify:state');}
      if(desktop)window.addEventListener('focus',schedule);
      const poll=setInterval(refresh,8000);schedule();
      return ()=>{live=false;device?.stop();
        if(bridge)bridge.removeEventListener('message',nativeState);
        if(desktop)window.removeEventListener('focus',schedule);observer.disconnect();clearInterval(poll);clearTimeout(timer);
        document.removeEventListener('visibilitychange',schedule);document.removeEventListener('scroll',scrolled,true);
        window.removeEventListener('lychee:chat-refresh',schedule);};
    },[owner]);
    return badge;
  }
  return {useInbox};
})();
