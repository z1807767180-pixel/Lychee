/* Device subscription for the mobile web client. Runs only after a garden is selected. */
(() => {
  let current=null;
  const supported=()=>location.pathname.startsWith('/mobile/')&&window.isSecureContext&&
    'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  function context(selected){
    const explicit=selected?.accountId?selected:null;
    if(!selected?.accountId)selected=window.LycheeAccess?.scope;
    if(!selected?.accountId||!selected.gardenId)throw Error('请先登录并选择荔枝园');
    return {explicit,key:selected.accountId+'/'+selected.gardenId,
      query:new URLSearchParams({accountId:selected.accountId,gardenId:selected.gardenId})};
  }
  async function api(scope,body){
    const res=await fetch('/api/v7/push?'+scope.query,{method:'POST',credentials:'same-origin',
      cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json();
    if(!res.ok)throw Error(data.error||'暂时无法设置推送');
    if(context(scope.explicit).key!==scope.key)throw Error('荔枝园已切换，请重试');
    return data;
  }
  function remember(scope,data){
    current={...data,key:scope.key,supported:supported()};
    return current;
  }
  async function status(selected){
    const scope=context(selected);
    if(!supported())return remember(scope,{configured:false,enabled:false});
    const registration=await navigator.serviceWorker.getRegistration('/mobile/');
    const sub=await registration?.pushManager?.getSubscription();
    return remember(scope,await api(scope,{action:'status',endpoint:sub?.endpoint}));
  }
  function decodeKey(key){
    return Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  }
  async function enable(selected){
    const scope=context(selected);
    if(!supported())throw Error('此入口不支持后台推送。iPhone 请从主屏幕打开荔枝。');
    // Safari requires the permission request to be inside the original button gesture.
    if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted')throw Error('请在系统设置中允许荔枝通知');
    const info=await api(scope,{action:'status'});
    if(!info.configured)throw Error('服务端尚未配置后台推送');
    await navigator.serviceWorker.register('/mobile/v61-sw.js',{scope:'/mobile/'});
    const reg=await navigator.serviceWorker.ready;
    const publicKey=decodeKey(info.publicKey);
    let sub=await reg.pushManager.getSubscription();
    if(sub?.options?.applicationServerKey&&
      !new Uint8Array(sub.options.applicationServerKey).every((value,index)=>value===publicKey[index])){
      await sub.unsubscribe();sub=null;
    }
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
    return remember(scope,await api(scope,{action:'subscribe',subscription:sub.toJSON()}));
  }
  async function disable(selected){
    const scope=context(selected);
    if(!supported())return remember(scope,{configured:false,enabled:false});
    const reg=await navigator.serviceWorker.getRegistration('/mobile/'),sub=await reg?.pushManager?.getSubscription();
    if(sub){
      await api(scope,{action:'unsubscribe',subscription:sub.toJSON()});
      await sub.unsubscribe();
    }
    return remember(scope,{configured:!!current?.configured,enabled:false});
  }
  function enabled(){
    try{return !!(current?.enabled&&current.key===context().key&&Notification.permission==='granted');}
    catch{return false;}
  }
  window.LycheeWebPush={supported,status,enable,disable,enabled};
})();
