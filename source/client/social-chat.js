/* The group attachment and recall controls use the existing member-scoped
   chat protocol. Direct messages continue to use their separate endpoint. */
(function(){
  'use strict';
  const favorites=['😊','🥰','😂','👍','❤️','🌱','🎉','🍵','📷','🙌','✨','🍃'];
  const categories=/* original-emoji-categories */ [];
  const stickers=['喝杯茶','打个盹','加油呀','去打球','嗨','太棒了'];
  const lines={back:'M14 4 6 12l8 8', dots:'M4 12h.2m7.8 0h.2m7.8 0h.2',plus:'M12 4v16M4 12h16',smile:'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-4 8h.1m7.9 0h.1M8 14q4 5 8 0',photo:'M3 5h18v14H3zM4 17l5-5 4 4 3-3 4 4M15 9h.2',game:'M7 8h10c3 0 4 2 5 8 0 3-2 4-4 1l-2-2H8l-2 2c-2 3-4 2-4-1 1-6 2-8 5-8Zm0 3v4m-2-2h4m6-1h.1m3 2h.1',pin:'m8 3 9 0-2 3v4l3 3v1H6v-1l3-3V6zM12 14v7'};
  function icon(name){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width',name==='dots'?'3.5':'1.65');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
    path.setAttribute('d',lines[name]);svg.appendChild(path);return svg;
  }
  function fitKeyboard(){
    const shell=document.querySelector('.s8[data-chat=true]'),vp=window.visualViewport;
    if(!shell||!vp)return;
    const open=vp.scale===1 && shell.querySelector('.s8-inputbar textarea')===document.activeElement && window.innerHeight-vp.height>80;
    shell.classList.toggle('s8-keyboard',open);
    if(open){shell.style.setProperty('--s8-vv-height',vp.height+'px');shell.style.setProperty('--s8-vv-top',vp.offsetTop+'px');}
  }
  if(window.visualViewport){window.visualViewport.addEventListener('resize',fitKeyboard);window.visualViewport.addEventListener('scroll',fitKeyboard);}
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
    const openDetails=()=>group?ui.go('members',{id}):ui.openPerson(id);
    const details=btn('',openDetails,'s8-room-details');
    details.setAttribute('aria-label',group?'群详情':'好友资料');details.append(icon('dots'));header(title,details);
    const back=main.closest('.s8').querySelector('.s8-back');
    if(back){back.setAttribute('aria-label','返回');const label=h('span',back.textContent,'s8-room-back-label');back.replaceChildren(icon('back'),label);}
    const titleNode=main.closest('.s8').querySelector('.s8-header h1'),titleButton=btn('',openDetails,'s8-room-title');
    titleButton.append(h('span',title,'s8-room-name'));
    if(group)titleButton.append(h('span','（'+data.members.length+'）','s8-room-count'));
    titleButton.setAttribute('aria-label',group?title+'，'+data.members.length+'位成员，查看群资料':title+'，查看资料');
    titleNode.replaceChildren(titleButton,h('small',group?'群聊':'私聊','s8-room-meta'));
    const log=h('section',null,'s8-log');log.setAttribute('aria-label','聊天记录');main.append(log);
    const draft=drafts.get(key)||{text:'',picture:'',id:null};
    async function scoped(body){const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'操作失败，请重试');}}
    let menu;
    function closeMenu(){if(menu)menu.remove();menu=null;}
    function showImage(src){const overlay=h('div',null,'s8-image-preview');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','聊天原图');const photo=h('img');photo.alt='聊天原图';photo.src=src;const close=btn('关闭',()=>overlay.remove());overlay.append(photo,close);main.append(overlay);close.focus();}
    function safePhoto(msg){
      if(!msg.imageUrl)return false;
      if(group)return msg.imageUrl.startsWith(endpoint+'?image=');
      const url=new URL(msg.imageUrl,location.origin),query=url.searchParams;
      return url.origin===location.origin && url.pathname==='/api/v8/social' && query.get('view')==='dmPhoto' && query.get('accountId')===me && query.get('id')===id && query.get('messageId')===msg.id;
    }
    let previous;const messages=new Map();
    const items=data.messages.slice();
    const outside=group&&data.pin&&!items.some(m=>m.id===data.pin.id);
    if(outside)items.push(data.pin);
    if(outside)items.sort((a,b)=>a.created-b.created||(a.seq||0)-(b.seq||0));
    for(const msg of items){
      const divider=window.LycheeSocialApi.chatDivider(previous,msg.created,300000);previous=msg.created;if(divider)log.append(h('time',divider,'s8-time'));
      const mine=msg.authorId===me,row=h('article',null,'s8-msg'+(mine?' mine':''));
      row.dataset.message=msg.id;messages.set(msg.id,msg);
      const member=group&&data.members.find(m=>m.id===msg.authorId);
      const person=mine?home.me:(group?member||home.friends.find(f=>f.id===msg.authorId):data.friend);
      if(person&&person.id===msg.authorId){
        const chip=btn('',()=>ui.openPerson(person.id,member?id:undefined),'s8-chat-person');
        chip.setAttribute('aria-label','查看'+person.name+'的资料');chip.append(avatar(person));row.append(chip);
      }else row.append(avatar(msg));
      row.append(h('small',person?.name||msg.name||'园友','s8-sender'));
      if(safePhoto(msg)){
        const button=btn('',()=>showImage(msg.imageUrl),'s8-photo-button');const im=h('img');im.src=msg.imageUrl;im.alt='聊天图片';im.loading='lazy';button.append(im);row.append(button);
      }
      if(msg.body&&(!msg.imageUrl||msg.body!=='[图片]'))row.append(h('p',msg.body));
      const invite=!group&&window.LycheeSocialTools?.invitation(msg.body);
      if(invite)row.append(btn('查看游戏邀请',()=>ui.go('tool',invite)));
      if(group&&/^【头脑王者】/.test(msg.body||''))row.append(btn('查看对局',()=>ui.legacyGame(id,(msg.body.match(/对局编号：([\da-f-]{36})/i)||[])[1])));
      row.tabIndex=0;log.append(row);
    }
    if(group&&data.pin){
      const pin=btn('',locate,'s8-room-pin'),target=Array.from(log.querySelectorAll('.s8-msg')).find(el=>el.dataset.message===data.pin.id);
      pin.append(icon('pin'),h('b','置顶'),h('span',(data.pin.name?data.pin.name+'：':'')+data.pin.body),h('i','›'));
      main.closest('.s8').querySelector('.s8-header').after(pin);
      function locate(){if(!target)return;target.classList.add('s8-highlight');target.scrollIntoView({block:'center'});target.focus({preventScroll:true});setTimeout(()=>target.classList.remove('s8-highlight'),1800);}
      if(ui.route.params.locate){delete ui.route.params.locate;requestAnimationFrame(locate);}
    }
    function actions(row){
      if(!row)return;const msg=messages.get(row.dataset.message);if(!msg)return;
      closeMenu();menu=h('div',null,'s8-message-menu');
      if(group&&data.group.role==='owner'&&msg.body!=='消息已撤回'){
        const remove=msg.id===data.pin?.id;
        menu.append(btn(remove?'取消置顶':'置顶这条消息',async()=>{try{await ui.mutate('pinGroupMessage',{groupId:id,messageId:msg.id,remove});await ui.repaint();}catch(e){notice(e.message);}}));
      }
      if(msg.body&&navigator.clipboard)menu.append(btn('复制',async()=>{try{await navigator.clipboard.writeText(msg.body);closeMenu();}catch{notice('未能复制，可以选中文字复制。');}}));
      if(group&&msg.authorId===me&&meInGroup&&msg.body!=='消息已撤回')menu.append(btn('撤回',async()=>{try{await scoped({type:'recall',id:msg.source==='legacy'?msg.id:'chat.'+meInGroup.slot+'.'+msg.id});await ui.repaint();}catch(e){notice(e.message);}}));
      if(menu.childElementCount){menu.append(btn('关闭',closeMenu));row.append(menu);}
    }
    log.oncontextmenu=e=>{e.preventDefault();actions(e.target.closest('.s8-msg'));};
    log.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();actions(e.target.closest('.s8-msg'));}};
    let press,startX,startY;
    const cancel=()=>clearTimeout(press);
    log.addEventListener('touchstart',e=>{cancel();if(e.touches.length!==1||e.target.closest('.s8-chat-person'))return;startX=e.touches[0].clientX;startY=e.touches[0].clientY;const row=e.target.closest('.s8-msg');press=setTimeout(()=>{if(row?.isConnected)actions(row);},550);},{passive:true});
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
    function resize(){area.style.height='38px';area.style.height=Math.min(114,Math.max(38,area.scrollHeight+2))+'px';}
    area.oninput=()=>{draft.text=area.value;remember();resize();update();};
    async function pickImage(blob){draft.picture=await jpeg(blob);remember();update();toggle('');}
    file.onchange=async()=>{try{if(file.files[0])await pickImage(file.files[0]);}catch(e){notice(e.message);}file.value='';};
    const palette=btn('',()=>toggle('emoji'),'s8-compose-icon');palette.append(icon('smile'));palette.setAttribute('aria-label','选表情');
    const plus=btn('',()=>toggle('more'),'s8-compose-icon');plus.append(icon('plus'));plus.setAttribute('aria-label','更多聊天操作');
    function selectSymbol(symbol){const start=area.selectionStart,end=area.selectionEnd;if(area.value.length-(end-start)+symbol.length>area.maxLength)return;area.setRangeText(symbol,start,end,'end');area.dispatchEvent(new Event('input'));}
    function showSymbols(name){
      tray.replaceChildren();const grid=h('div',null,'s8-symbols');
      if(name==='荔枝贴纸'){
        stickers.forEach((label,i)=>{const src='/mobile/sticker-'+i+'.jpg',b=btn('',async()=>{
          try{const res=await fetch(src);if(!res.ok)throw Error('贴纸未能加载');await pickImage(await res.blob());}catch(e){notice(e.message);}
        });b.setAttribute('aria-label',label);const im=h('img');im.src=src;im.alt=label;im.loading='lazy';b.append(im);grid.append(b);});
      }else{
        const symbols=name==='常用'?favorites:categories.find(pair=>pair[0]===name)[1].split(' ');
        for(const symbol of symbols)grid.append(btn(symbol,()=>selectSymbol(symbol)));
      }
      const tabs=h('div',null,'s8-emoji-tabs');
      for(const label of ['常用',...categories.map(pair=>pair[0]),'荔枝贴纸']){const b=btn(label,()=>showSymbols(label));b.setAttribute('aria-pressed',String(name===label));tabs.append(b);}
      tray.append(grid,tabs);const active=tabs.querySelector('[aria-pressed=true]');tabs.scrollLeft=Math.max(0,active.offsetLeft-tabs.offsetLeft-70);
    }
    function toggle(tab){
      const next=tray.dataset.open===tab?'':tab;tray.dataset.open=next;tray.replaceChildren();palette.setAttribute('aria-expanded',String(next==='emoji'));plus.setAttribute('aria-expanded',String(next==='more'));
      if(next){area.blur();}if(next==='emoji')showSymbols('常用');
      if(next==='more')for(const [name,label,action] of [['photo','发图片',()=>file.click()],['smile','表情',()=>toggle('emoji')],['game','一起玩',()=>ui.go('chatGames')]]){
        const b=btn('',action);const tile=h('span',null,'s8-action-tile');tile.append(icon(name));b.append(tile,h('span',label));tray.append(b);
      }
    }
    area.onfocus=()=>{if(tray.dataset.open)toggle('');fitKeyboard();};
    area.onblur=()=>main.closest('.s8')?.classList.remove('s8-keyboard');
    composer.addEventListener('submit',async e=>{e.preventDefault();if(send.disabled)return;const text=area.value.trim();if(!text&&!draft.picture)return;
      if(draft.picture&&text.length>200){notice('带图片的消息说明限 200 字');return;}
      const requestId=draft.id||window.LycheeSocialApi.requestId();draft.id=requestId;drafts.set(key,draft);send.disabled=true;area.readOnly=true;
      try{if(group&&draft.picture)await scoped({type:'note',name:home.me.name,avatar:0,key:requestId,body:text,picture:draft.picture});
        else await ui.mutate('message',{...(group?{groupId:id}:{friendId:id}),body:text,clientId:requestId,...(draft.picture?{picture:draft.picture}:{})});
        drafts.delete(key);if(composer.isConnected)await ui.repaint();
      }catch(error){notice(error.message);}finally{send.disabled=false;area.readOnly=false;}});
    bar.append(area,palette,plus,send);composer.append(attachment,bar,tray,file);const shell=main.closest('.s8');shell.insertBefore(composer,shell.querySelector('.s8-nav'));resize();update();
  }
  window.LycheeSocialChat={display,compress:jpeg};
})();
