/* Theme preferences retain the original account/garden storage keys. Portraits
   are resolved only through the reader's own tools or the open group's API. */
(function(){
  'use strict';
  const skins=['orchard','miffy','tutu','kitty'];
  const field=(account,garden,slot,name)=>'lychee.v640.'+account+'.'+garden+'.lychee.phone.'+slot+'.'+name;
  const endpoint=(account,garden,route)=>'/g/'+encodeURIComponent(garden)+'/api/for/'+encodeURIComponent(account)+'/'+route;
  const face=n=>'/mobile/face-'+n+'.webp';
  function fallback(id){let n=0;for(const c of String(id))n=(n*31+c.charCodeAt(0))>>>0;return face(n%16);}
  function make(shell,account){
    let home,room,scope,skin='',wall=null;
    const palettes=new Map(),loading=new Set();
    function read(name){
      if(!home)return null;
      const slot=room?.members?.find(m=>m.id===account)?.slot;
      const personal=localStorage.getItem(field(account,home.accountToolsGardenId,1,name));
      if(personal!==null)return personal;
      const legacy=slot?localStorage.getItem(field(account,scope,slot,name)):null;
      if(legacy!==null){try{localStorage.setItem(field(account,home.accountToolsGardenId,1,name),legacy);}catch{/* Storage may be full. */}}
      return legacy;
    }
    function apply(latest,group,chat){
      home=latest;room=group;scope=group?.group?.id;
      const number=Math.max(0,Math.min(3,parseInt(read('theme'),10)||0));
      skin=skins[number];shell.dataset.skin=skin;shell.dataset.chat=String(chat);
      const custom=chat&&read('chatWallpaper');
      const bg=chat?(custom&&/^\/9j\/[A-Za-z0-9+/=]+$/.test(custom)?'data:image/jpeg;base64,'+custom:'/client/social-wall-'+skin+'.webp'):'';
      shell.dataset.customWall=String(!!bg && bg.startsWith('data:image/'));
      if(wall!==bg){
        wall=bg;
        if(bg){const wide=bg.startsWith('data:image/')?bg:'/client/social-wide-'+skin+'.webp';shell.style.setProperty('--s8-chat-wall','url("'+bg+'")');shell.style.setProperty('--s8-chat-wide','url("'+wide+'")');}
        else {shell.style.removeProperty('--s8-chat-wall');shell.style.removeProperty('--s8-chat-wide');}
      }
    }
    function path(id){
      const mine=id===account&&palettes.get(home?.accountToolsGardenId)?.icons[1];
      const member=room?.members?.find(m=>m.id===id),groupIcon=member&&palettes.get(scope)?.icons[member.slot];
      return mine||groupIcon||fallback(id);
    }
    function avatar(person){const id=person.authorId||person.id||person.name||'荔';const im=document.createElement('img');im.className='s8-photo s8-person';im.alt='';im.dataset.person=id;im.src=path(id);return im;}
    async function load(garden,force){
      const prior=palettes.get(garden);if(!garden||loading.has(garden)||(!force&&prior&&Date.now()-prior.time<90000))return;
      loading.add(garden);
      try{
        const url=endpoint(account,garden,'phone'),r=await fetch(url,{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;
        const data=await r.json(),icons={};
        for(const [slot,index] of Object.entries(data.avatars||{}))if(Number.isInteger(index)&&index>=0&&index<16)icons[slot]=face(index);
        for(const [slot,rev] of Object.entries(data.portraits||{}))if(/^\d+$/.test(slot)&&/^[a-f0-9]{64}$/.test(rev))icons[slot]=url+'?portrait='+slot+'&rev='+rev;
        palettes.set(garden,{icons,time:Date.now()});
        if(shell.isConnected)for(const im of shell.querySelectorAll('.s8-person')){const next=path(im.dataset.person);if(im.getAttribute('src')!==next)im.src=next;}
      }catch{/* A missing picture never interferes with opening a conversation. */}finally{loading.delete(garden);}
    }
    function refresh(force=false){if(home){void load(home.accountToolsGardenId,force);if(scope)void load(scope,force);}}
    function set(name,value){
      if(!home||!['theme','chatWallpaper'].includes(name))return;
      localStorage.setItem(field(account,home.accountToolsGardenId,1,name),value);
      apply(home,room,shell.dataset.chat==='true');
    }
    return {apply,avatar,refresh,read,set};
  }
  window.LycheeSocialAppearance={make,endpoint};
})();
