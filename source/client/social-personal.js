/* Personal preferences retain the account's existing storage and scoped API. */
(() => {
  'use strict';
  const themes=['原味荔枝园','米菲采荔枝','图图树下','凯蒂荔枝茶会'];
  const themeArt=['orchard-courtyard.jpg','hd-theme-1.webp','hd-theme-2.webp','hd-theme-3.webp'];
  const themeSkins=['orchard','miffy','tutu','kitty'];
  const actions=['休息','喝咖啡','挥手','犯困','疲惫'];
  const bannerKey=id=>'lychee.social.incoming.'+id;
  function enabled(id){return localStorage.getItem(bannerKey(id))!=='off';}
  function identity(ui,box,edit=true){
    const {h,home}=ui,person=home.me,details=h('span',null,'s8-identity'),line=h('span'),name=h('b',person.name),state=h('i'),signature=h('small');
    line.append(name,state);details.append(line,signature);if(edit)details.append(h('small','编辑资料 ›','s8-edit-link'));
    box.append(ui.avatar(person),details);
    return {show(data){if(!data)return;name.textContent=data.name||person.name;state.textContent=data.action||'';signature.textContent=data.mood||'';},
      async load(){try{const [camp,choice]=await Promise.all([personal(home,'camp'),ui.api.read('myStatus')]);const own=camp.members?.find(m=>String(m.id)===String(camp.me));if(box.isConnected&&own)this.show({...own,action:choice.status??own.action});}catch{/* Keep the authenticated account label offline. */}}};
  }
  async function personal(home,route,body){
    const url=window.LycheeSocialAppearance.endpoint(home.me.id,home.accountToolsGardenId,route);
    const options={credentials:'same-origin',cache:'no-store'};
    if(body){options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(body);}
    const response=await fetch(url,options),data=await response.json();
    if(!response.ok)throw Error(data.error||'个人资料暂时不可用');return data;
  }
  async function imageData(file,portrait){
    if(!file||!file.type.startsWith('image/'))throw Error('请选择一张图片');
    const url=URL.createObjectURL(file),img=new Image();
    try{
      await new Promise((ok,fail)=>{img.onload=ok;img.onerror=()=>fail(Error('无法打开这张图片'));img.src=url;});
      const c=document.createElement('canvas'),ctx=c.getContext('2d');
      if(portrait){
        c.width=c.height=320;const side=Math.min(img.width,img.height);
        ctx.drawImage(img,(img.width-side)/2,(img.height-side)/2,side,side,0,0,320,320);
      }else{
        const ratio=Math.min(1,1200/Math.max(img.width,img.height));
        c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));ctx.drawImage(img,0,0,c.width,c.height);
      }
      for(const quality of [.8,.65,.5,.35]){
        const saved=c.toDataURL('image/jpeg',quality).split(',')[1];
        if(saved&&saved.length<=(portrait?160000:900000))return saved;
      }
      throw Error('图片太大，请选择一张较小的图片');
    }finally{URL.revokeObjectURL(url);}
  }
  function pick(ui,label,portrait,store){
    const input=ui.h('input');input.type='file';input.accept='image/*';input.hidden=true;
    const box=ui.h('div',null,'s8-actions');
    const trigger=ui.btn(label,()=>input.click());input.onchange=async()=>{
      const file=input.files[0];input.value='';if(!file)return;trigger.disabled=true;
      try{if(portrait)await cropPortrait(ui,file,store);else await store(await imageData(file,false));}catch(e){ui.notice(e.message);}finally{trigger.disabled=false;}
    };
    box.append(input,trigger);return box;
  }
  async function cropPortrait(ui,file,store){
    if(!file.type.startsWith('image/'))throw Error('请选择一张图片');
    const {h,btn}=ui,src=URL.createObjectURL(file),im=new Image();
    try{await new Promise((ok,fail)=>{im.onload=ok;im.onerror=()=>fail(Error('无法读取这张图片'));im.src=src;});}finally{URL.revokeObjectURL(src);}
    if(!ui.main.isConnected||ui.route.view!=='style')return;
    const dialog=h('section',null,'s8-crop-modal'),panel=h('div',null,'s8-panel'),canvas=h('canvas'),slider=h('input');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','裁切头像');canvas.setAttribute('aria-label','拖动照片调整头像取景');
    canvas.width=canvas.height=320;slider.type='range';slider.min='1';slider.max='3';slider.step='.02';slider.value='1';
    let x=.5,y=.5,drag=null;
    function draw(){const side=Math.min(im.width,im.height)/Number(slider.value);canvas.getContext('2d').drawImage(im,x*(im.width-side),y*(im.height-side),side,side,0,0,320,320);}
    slider.oninput=draw;canvas.onpointerdown=event=>{canvas.setPointerCapture(event.pointerId);drag={px:event.clientX,py:event.clientY,x,y};};
    canvas.onpointermove=event=>{if(!drag)return;const side=Math.min(im.width,im.height)/Number(slider.value),scale=side/canvas.clientWidth;
      x=Math.min(1,Math.max(0,drag.x-(event.clientX-drag.px)*scale/Math.max(1,im.width-side)));
      y=Math.min(1,Math.max(0,drag.y-(event.clientY-drag.py)*scale/Math.max(1,im.height-side)));draw();};
    canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
    const save=btn('保存头像',async()=>{save.disabled=true;
      try{let encoded;for(const q of [.83,.65,.45]){encoded=canvas.toDataURL('image/jpeg',q).split(',')[1];if(encoded.length<=160000)break;}
        if(!encoded||encoded.length>160000)throw Error('图片太大，请换一张重试');await store(encoded);dialog.remove();
      }catch(e){ui.notice(e.message);}finally{save.disabled=false;}
    },'s8-primary');
    panel.append(h('h2','裁切头像'),canvas,ui.formField('缩放',slider),save,btn('取消',()=>dialog.remove()));dialog.append(panel);ui.main.append(dialog);draw();save.focus();
  }
  function appearance(ui){
    const {h,btn,main,home,prefs}=ui,identity=home.me.id;
    ui.header('头像与主题');
    const avatars=h('section',null,'s8-panel'),list=h('div',null,'s8-avatar-list');
    const present=h('div',null,'s8-profile-line');present.append(prefs.avatar(home.me),h('h2','我的头像'));avatars.append(present,list);
    async function save(body){
      await personal(home,'phone',body);
      if(ui.home.me.id!==identity)return;
      prefs.refresh(true);ui.notice('头像已保存');
    }
    const more=btn('更多预设头像',()=>{list.classList.toggle('expanded');more.textContent=list.classList.contains('expanded')?'收起头像':'更多预设头像';});
    for(let index=0;index<16;index++){
      const b=btn('',()=>save({type:'avatar',avatar:index}).catch(e=>ui.notice(e.message))),img=h('img');
      b.setAttribute('aria-label','选择头像 '+(index+1));img.src='/mobile/face-'+index+'.webp';img.alt='';b.append(img);list.append(b);
    }
    avatars.append(more,pick(ui,'上传头像',true,picture=>save({type:'portrait',picture})));main.append(avatars);
    const panel=h('section',null,'s8-panel'),options=h('div',null,'s8-theme-picks');
    const buttons=themes.map((name,index)=>{
      const b=btn('',()=>{
        prefs.set('theme',String(index));buttons.forEach((item,i)=>item.setAttribute('aria-pressed',String(i===index)));
      });
      b.setAttribute('aria-pressed',String(index===(parseInt(prefs.read('theme'),10)||0)));
      const preview=h('img');preview.src='/mobile/'+themeArt[index];preview.alt='';b.append(preview,h('b',name));return b;
    });
    for(const index of [0,3,1,2])options.append(buttons[index]);panel.append(h('h2','界面主题'),options);main.append(panel);
    const wall=h('section',null,'s8-panel');wall.append(h('h2','聊天壁纸'),btn('AI 生成壁纸',()=>ui.go('tool',{dest:'ai-image',tab:'me',wallpaper:true})),pick(ui,'从手机选择图片',false,value=>{
      prefs.set('chatWallpaper',value);ui.notice('聊天壁纸已保存');
    }),btn('恢复当前主题壁纸',()=>ui.go('wallRestore')));main.append(wall);
  }
  function restore(ui){
    const {main,h,btn,prefs}=ui,index=Math.max(0,Math.min(3,Number(prefs.read('theme'))||0));ui.header('恢复主题壁纸');
    const image=h('img',null,'s8-wall-preview');image.src='/client/social-wall-'+themeSkins[index]+'.webp';image.alt=themes[index]+'聊天壁纸预览';
    main.append(h('h2',themes[index]),image,btn('恢复'+themes[index]+'壁纸',async()=>{prefs.set('chatWallpaper','');await ui.back();ui.notice('已恢复当前主题壁纸');},'s8-primary'),btn('保留现有壁纸',ui.back));
  }
  async function funStatus(ui){
    const {main,h,btn}=ui;ui.header('趣味状态');const identityCard=h('section',null,'s8-profile s8-hero'),preview=identity(ui,identityCard,false),choices=h('div',null,'s8-status-choices');
    main.append(identityCard,h('h2','选择状态','s8-subheading'),choices);
    try{
      const [camp,saved]=await Promise.all([personal(ui.home,'camp'),ui.api.read('myStatus')]);
      if(!choices.isConnected)return;
      const own=camp.members.find(m=>String(m.id)===String(camp.me));if(!own)throw Error('暂时无法读取资料');
      let selected=saved.status??own.action??'休息';const options=['去采风','看书中','喝茶中','忙一会','听音乐',''];
      if(!options.includes(selected))options.unshift(selected);
      const buttons=options.map(value=>btn(value||'不展示',()=>{selected=value;draw();}));
      function draw(){preview.show({...own,action:selected});buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(options[i]===selected)));}
      choices.append(...buttons);draw();const save=btn('保存状态',async()=>{save.disabled=true;try{await ui.mutate('myStatus',{status:selected});await ui.back();ui.notice('趣味状态已保存');}catch(e){ui.notice(e.message);}finally{save.disabled=false;}},'s8-primary');main.append(save);
    }catch(e){if(choices.isConnected)ui.notice(e.message);}
  }
  function friend(ui,data){
    const {main,h,btn}=ui,p=data.person,rel=p.friendStatus;
    const self=rel==='self',isFriend=rel==='friend',names={self:'我',friend:'已是好友',outgoing:'已申请',incoming:'待处理',none:'同群成员'};
    ui.header(self?'我的资料':'个人资料');
    const card=h('section',null,'s8-profile s8-hero'),info=h('span',null,'s8-identity');
    info.append(h('b',p.name),h('small',names[rel]||''));
    if(p.status)info.append(h('i',p.status));if(p.mood)info.append(h('small',p.mood));
    card.append(ui.avatar(p),info);main.append(card);
    const controls=h('div',null,'s8-actions');
    function action(label,cmd){
      const b=btn(label,async()=>{
        b.disabled=true;
        try{await ui.mutate(cmd,{accountId:p.id});await ui.repaint();}catch(e){ui.notice(e.message);b.disabled=false;}
      },'s8-primary');controls.append(b);
    }
    if(self)controls.append(btn('编辑资料',()=>ui.go('profile'),'s8-primary'));
    else if(isFriend)controls.append(btn('发消息',()=>ui.go('dm',{id:p.id}),'s8-primary'));
    else if(rel==='incoming'){action('同意好友申请','friendAccept');action('忽略申请','friendDecline');}
    else if(rel==='none')action('加好友','friendRequest');
    main.append(controls);
    if(data.canSeeFeed){
      const open=()=>ui.go('feed',{kind:'feed',authorId:p.id,name:p.name,tab:ui.route.params.tab||'me'});
      const feed=btn('',open,'s8-profile-feed'),top=h('span');top.append(h('strong','园中事'),h('span','›'));feed.append(top);
      const previews=h('span',null,'s8-feed-preview');
      for(const post of data.posts||[]){
        if(post.photoUrl){const im=h('img');im.src=post.photoUrl;im.alt=post.body||'动态照片';im.loading='lazy';previews.append(im);}
        else previews.append(h('span',post.body||post.title||'动态','s8-preview-text'));
      }
      if(!previews.childElementCount)previews.append(h('small','暂无动态'));feed.append(previews);main.append(feed);
    }
    if(data.groups.length){main.append(h('h2','共同群聊','s8-subheading'));for(const group of data.groups)main.append(btn(group.name,()=>ui.go('group',{id:group.id}),'s8-friend-group'));}

  }
  async function profile(ui){
    const {home,h,btn,main,formField}=ui;
    ui.header('个人资料');const panel=h('section',null,'s8-panel');main.append(panel);
    const face=btn('',()=>ui.go('style'),'s8-profile s8-hero'),preview=identity(ui,face,false);
    face.setAttribute('aria-label','更换头像');panel.append(face,h('small','登录账号 · '+ui.accountName),btn('查看我的名片',()=>ui.openPerson(home.me.id)));
    try{
      const [camp,savedStatus]=await Promise.all([personal(home,'camp'),ui.api.read('myStatus')]);
      if(!panel.isConnected)return;
      const me=camp.members?.find(m=>String(m.id)===String(camp.me));
      if(!me)throw Error('暂时无法读取自己的资料');
      const chosen=savedStatus.status??me.action;preview.show({...me,action:chosen});
      const draft=ui.route.params.editDraft||{},name=h('input');name.value=draft.name??me.name;name.maxLength=14;name.required=true;
      const signature=h('input');signature.value=draft.signature??me.mood??'';signature.maxLength=36;
      const status=btn(chosen||'不展示',()=>{ui.route.params.editDraft={name:name.value,signature:signature.value};ui.go('funStatus');});
      const form=h('form'),save=h('button','保存资料','s8-primary');save.type='submit';
      form.append(formField('昵称',name),formField('趣味状态',status),formField('个性签名',signature),save);panel.append(form);
      form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;
        try{await personal(home,'camp',{type:'profile',name:name.value.trim(),avatar:Number(me.avatar),action:actions.includes(me.action)?me.action:'休息',mood:signature.value.trim()});if(panel.isConnected)delete ui.route.params.editDraft;preview.show({name:name.value.trim(),action:chosen,mood:signature.value.trim()});ui.notice('个人资料已保存');}
        catch(e){ui.notice(e.message);}finally{save.disabled=false;}
      };
    }catch(e){if(panel.isConnected)ui.notice(e.message);}
  }
  function notifications(ui){
    const {home,h,btn,main}=ui;ui.header('提醒与通知');
    const panel=h('section',null,'s8-panel'),switcher=h('input');switcher.type='checkbox';switcher.checked=enabled(home.me.id);
    switcher.onchange=()=>localStorage.setItem(bannerKey(home.me.id),switcher.checked?'on':'off');
    const label=h('label',null,'s8-check');label.append(switcher,document.createTextNode('应用内新消息提醒'));
    panel.append(h('h2','消息提醒'),label);main.append(panel);
    const web=window.LycheeWebPush;
    if(web?.supported()&&home.groups.length){
      const system=h('section',null,'s8-panel'),select=h('select'),status=h('p','','s8-muted');
      const localKey='lychee.social.push-group.'+home.me.id;
      for(const g of home.groups){const option=h('option',g.name);option.value=g.id;select.append(option);}
      if(home.groups.some(g=>g.id===localStorage.getItem(localKey)))select.value=localStorage.getItem(localKey);
      const scope=()=>({accountId:home.me.id,gardenId:select.value});
      let checked=null;const toggle=btn('读取推送设置…',async()=>{
        if(!checked)return;toggle.disabled=select.disabled=true;
        try{const context=scope();const value=await (checked.enabled?web.disable(context):web.enable(context));localStorage.setItem(localKey,context.gardenId);draw(value);window.dispatchEvent(new Event('lychee:push-changed'));}
        catch(e){status.textContent=e.message;toggle.disabled=false;}finally{select.disabled=false;}
      });
      function draw(value){checked=value;toggle.textContent=value.enabled?'关闭此群后台推送':'开启此群后台推送';toggle.disabled=!value.configured;status.textContent=value.configured?'':'此入口暂未提供后台推送';}
      async function read(){const id=select.value;toggle.disabled=true;checked=null;
        try{const value=await web.status(scope());if(select.value===id)draw(value);}catch(e){if(select.value===id)status.textContent=e.message;}}
      select.onchange=read;system.append(h('h2','设备后台推送'),ui.formField('群聊',select),toggle,status);main.append(system);void read();
    }
    panel.append(btn('查看已有提醒',()=>ui.go('tool',{dest:'notifications',tab:'me'})));
  }
  window.LycheeSocialPersonal={appearance,profile,friend,restore,identity,funStatus,notifications,enabled};
})();
