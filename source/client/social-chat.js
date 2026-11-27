/* The group attachment and recall controls use the existing member-scoped
   chat protocol. Direct messages continue to use their separate endpoint. */
(function(){
  'use strict';
  const emoji=['😀','😊','🥰','😂','👍','❤️','🌱','🎉','🍵','📷','🙌','✨'];
  async function jpeg(file){
    if(!file||!file.type.startsWith('image/'))throw Error('请选择图片');
    const url=URL.createObjectURL(file),img=new Image();
    try{
      await new Promise((ok,fail)=>{img.onload=ok;img.onerror=()=>fail(Error('无法读取这张图片'));img.src=url;});
      for(const edge of [1024,800,640,480]){
        const ratio=Math.min(1,edge/Math.max(img.width,img.height)),c=document.createElement('canvas');
        c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));
        const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
        const picture=c.toDataURL('image/jpeg',.78).split(',')[1];if(picture&&picture.length<=384000)return picture;
      }
      throw Error('图片较大，请裁剪后重试');
    }finally{URL.revokeObjectURL(url);}
  }
  function display(ui,view,id,data,drafts,keepComposer){
    const {h,btn,home,main,header,avatar,notice}=ui,group=view==='group',me=home.me.id;
    const meInGroup=group&&data.members.find(m=>m.id===me),key=view+':'+id;
    const endpoint=window.LycheeSocialAppearance.endpoint(me,id,'camp');
    const title=group?data.group.name:data.friend.name;
    header(title,group?btn('群成员',()=>ui.go('members',{id})):null);
    const top=document.createElement('small');top.className='s8-room-meta';top.textContent=group?'群聊 · '+data.members.length+' 位成员':'私聊';
    main.closest('.s8').querySelector('.s8-header h1').append(top);
    const log=h('section',null,'s8-log');log.setAttribute('aria-label','聊天记录');main.append(log);
    const draft=drafts.get(key)||{text:'',picture:'',id:null};
    async function scoped(body){const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'操作失败，请重试');}}
    let menu;
    function closeMenu(){if(menu)menu.remove();menu=null;}
    function showImage(src){const overlay=h('div',null,'s8-image-preview');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','群聊原图');const photo=h('img');photo.alt='群聊原图';photo.src=src;const close=btn('关闭',()=>overlay.remove());overlay.append(photo,close);main.append(overlay);close.focus();}
    let previous;const messages=new Map();
    for(const msg of data.messages){
      const divider=window.LycheeSocialApi.chatDivider(previous,msg.created,300000);previous=msg.created;if(divider)log.append(h('time',divider,'s8-time'));
      const mine=msg.authorId===me,row=h('article',null,'s8-msg'+(mine?' mine':''));
      row.dataset.message=msg.id;messages.set(msg.id,msg);row.append(avatar(msg));row.append(h('small',(msg.name||'园友')+(mine?' · 我':''),'s8-sender'));
      if(msg.imageUrl&&group&&msg.imageUrl.startsWith(endpoint+'?image=')){
        const button=btn('',()=>showImage(msg.imageUrl),'s8-photo-button');const im=h('img');im.src=msg.imageUrl;im.alt='群聊图片';im.loading='lazy';button.append(im);row.append(button);
      }
      if(msg.body&&(!msg.imageUrl||msg.body!=='[图片]'))row.append(h('p',msg.body));
      if(group&&/^【头脑王者】/.test(msg.body||''))row.append(btn('查看对局',()=>ui.legacyGame(id,(msg.body.match(/对局编号：([\da-f-]{36})/i)||[])[1])));
      row.tabIndex=0;log.append(row);
    }
    function actions(row){
      if(!row)return;const msg=messages.get(row.dataset.message);if(!msg)return;
      closeMenu();menu=h('div',null,'s8-message-menu');
      if(msg.body&&navigator.clipboard)menu.append(btn('复制',async()=>{try{await navigator.clipboard.writeText(msg.body);closeMenu();}catch{notice('未能复制，可以选中文字复制。');}}));
      if(group&&msg.authorId===me&&meInGroup&&msg.body!=='消息已撤回')menu.append(btn('撤回',async()=>{try{await scoped({type:'recall',id:msg.source==='legacy'?msg.id:'chat.'+meInGroup.slot+'.'+msg.id});await ui.repaint();}catch(e){notice(e.message);}}));
      if(menu.childElementCount){menu.append(btn('关闭',closeMenu));row.append(menu);}
    }
    log.oncontextmenu=e=>{e.preventDefault();actions(e.target.closest('.s8-msg'));};
    log.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();actions(e.target.closest('.s8-msg'));}};
    let press,startX,startY;
    const cancel=()=>clearTimeout(press);
    log.addEventListener('touchstart',e=>{cancel();if(e.touches.length!==1)return;startX=e.touches[0].clientX;startY=e.touches[0].clientY;const row=e.target.closest('.s8-msg');press=setTimeout(()=>{if(row?.isConnected)actions(row);},550);},{passive:true});
    log.addEventListener('touchmove',e=>{if(Math.abs(e.touches[0].clientX-startX)+Math.abs(e.touches[0].clientY-startY)>10)cancel();},{passive:true});
    log.addEventListener('touchend',cancel);log.addEventListener('touchcancel',cancel);
    if(!data.messages.length)log.append(h('p','还没有消息。','s8-muted'));
    // A background poll can update the timeline without disturbing IME composition.
    if(keepComposer)return;
    const composer=h('form',null,'s8-composer'),tray=h('div',null,'s8-chat-tray'),bar=h('div',null,'s8-inputbar'),area=h('textarea');
    const attachment=h('div',null,'s8-draft-photo'),file=h('input');file.type='file';file.accept='image/*';file.hidden=true;
    area.rows=1;area.maxLength=2000;area.placeholder='发消息…';area.setAttribute('aria-label','消息内容');area.value=draft.text;
    const send=h('button','发送','s8-primary');send.type='submit';
    const remember=()=>{draft.id=null;drafts.set(key,draft);};
    function update(){send.hidden=!draft.text.trim()&&!draft.picture;attachment.replaceChildren();if(draft.picture){const im=h('img');im.src='data:image/jpeg;base64,'+draft.picture;im.alt='待发送图片';attachment.append(im,btn('移除图片',()=>{draft.picture='';remember();update();}));}}
    area.oninput=()=>{draft.text=area.value;remember();update();};file.onchange=async()=>{try{if(file.files[0]){draft.picture=await jpeg(file.files[0]);remember();update();}}catch(e){notice(e.message);}file.value='';};
    const palette=btn('☺',()=>toggle('emoji'),'s8-compose-icon');palette.setAttribute('aria-label','选表情');
    const plus=btn('＋',()=>toggle('more'),'s8-compose-icon');plus.setAttribute('aria-label','更多聊天操作');
    function toggle(tab){const next=tray.dataset.open===tab?'':tab;tray.dataset.open=next;tray.replaceChildren();
      if(next==='emoji')for(const symbol of emoji)tray.append(btn(symbol,()=>{const start=area.selectionStart,end=area.selectionEnd;area.setRangeText(symbol,start,end,'end');area.dispatchEvent(new Event('input'));tray.replaceChildren();tray.dataset.open='';area.focus();}));
      if(next==='more'&&group){tray.append(btn('发图片',()=>file.click()),btn('一起玩',()=>ui.legacyGame(id)),btn('原群聊与照片',()=>ui.legacy(id,'circle')));}
    }
    composer.addEventListener('submit',async e=>{e.preventDefault();if(send.disabled)return;const text=area.value.trim();if(!text&&!draft.picture)return;
      if(draft.picture&&text.length>200){notice('带图片的消息说明限 200 字');return;}
      const requestId=draft.id||window.LycheeSocialApi.requestId();draft.id=requestId;drafts.set(key,draft);send.disabled=true;area.readOnly=true;
      try{if(draft.picture)await scoped({type:'note',name:home.me.name,avatar:0,key:requestId,body:text,picture:draft.picture});
        else await ui.mutate('message',{...(group?{groupId:id}:{friendId:id}),body:text,clientId:requestId});
        drafts.delete(key);if(composer.isConnected)await ui.repaint();
      }catch(error){notice(error.message);}finally{send.disabled=false;area.readOnly=false;}});
    bar.append(area,palette);if(group)bar.append(plus);bar.append(send);composer.append(attachment,tray,bar,file);const shell=main.closest('.s8');shell.insertBefore(composer,shell.querySelector('.s8-nav'));update();
  }
  window.LycheeSocialChat={display};
})();
