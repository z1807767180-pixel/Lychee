// Output at /mobile/v61-sw.js to update the existing registration in place.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function pointer(value){
  if(typeof value?.scope!=='string'||!/^[-\w]{1,100}\/[-\w]{1,100}$/.test(value.scope))return null;
  if(typeof value.id!=='string'||!value.id||value.id.length>220||/[\x00-\x1f]/.test(value.id))return null;
  return {scope:value.scope,id:value.id};
}
self.addEventListener('push',event=>{
  let target;
  try{target=pointer(event.data?.json());}catch{return;}
  if(!target)return;
  event.waitUntil(self.registration.showNotification('荔枝 · 新消息',{
    body:'点开查看园中的新消息',icon:'/mobile/icon.png',tag:target.scope+'/'+target.id,
    data:target,renotify:false
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const data=pointer(event.notification.data);
    const garden=data?.scope.split('/')[1];
    const route=new URL('/mobile/',self.location.origin);
    if(data){
      route.searchParams.set('garden',garden);
      route.hash=new URLSearchParams({'lychee-notice':data.id,scope:data.scope}).toString();
    }
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=clients.find(client=>{
      const url=new URL(client.url);
      return url.origin===route.origin&&['/mobile/','/mobile/index.html'].includes(url.pathname)&&
        (!data||url.searchParams.get('garden')===garden);
    });
    if(!existing){await self.clients.openWindow(route.href);return;}
    if(!data){await existing.focus();return;}
    // Preserve the target in the URL even if the page is still booting. A live
    // NotificationWatch handles hashchange; a cold one consumes it on mount.
    const next=new URL(existing.url);next.hash=route.hash;
    if(next.href===existing.url){
      await existing.focus();existing.postMessage({type:'lychee:open-notification',...data});return;
    }
    const navigated=await existing.navigate(next.href).catch(()=>null);
    if(navigated)await navigated.focus();else await self.clients.openWindow(route.href);
  })());
});
