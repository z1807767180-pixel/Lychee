/* Personal preferences retain the account's existing storage and scoped API. */
(() => {
  'use strict';
  const themes=['原味荔枝园','米菲采荔枝','图图树下','凯蒂荔枝茶会'];
  const actions=['休息','喝咖啡','挥手','犯困','疲惫'];
  const bannerKey=id=>'lychee.social.incoming.'+id;
  function enabled(id){return localStorage.getItem(bannerKey(id))!=='off';}
  async function displayName(home,element){
    try{
      const data=await personal(home,'camp?roster=circle-names'),profile=data.profiles?.find(p=>Number(p.slot)===1);
      if(element.isConnected&&profile?.name)element.textContent=profile.name;
    }catch{/* The account name remains available when profile data is offline. */}
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
      try{await store(await imageData(file,portrait));}catch(e){ui.notice(e.message);}finally{trigger.disabled=false;}
    };
    box.append(input,trigger);return box;
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
    for(let index=0;index<16;index++){
      const b=btn('',()=>save({type:'avatar',avatar:index}).catch(e=>ui.notice(e.message))),img=h('img');
      b.setAttribute('aria-label','选择头像 '+(index+1));img.src='/mobile/face-'+index+'.webp';img.alt='';b.append(img);list.append(b);
    }
    avatars.append(pick(ui,'上传自己的头像',true,picture=>save({type:'portrait',picture})));main.append(avatars);
    const panel=h('section',null,'s8-panel'),options=h('div',null,'s8-theme-picks');
    const buttons=themes.map((name,index)=>{
      const b=btn(name,()=>{
        prefs.set('theme',String(index));buttons.forEach((item,i)=>item.setAttribute('aria-pressed',String(i===index)));
      });
      b.setAttribute('aria-pressed',String(index===(parseInt(prefs.read('theme'),10)||0)));
      options.append(b);return b;
    });
    panel.append(h('h2','主题'),options);main.append(panel);
    const wall=h('section',null,'s8-panel');wall.append(h('h2','聊天壁纸'),pick(ui,'选择聊天壁纸',false,value=>{
      prefs.set('chatWallpaper',value);ui.notice('聊天壁纸已保存');
    }),btn('恢复主题背景',()=>{prefs.set('chatWallpaper','');ui.notice('已恢复主题背景');}));main.append(wall);
  }
  async function profile(ui){
    const {home,h,btn,main,formField}=ui;
    ui.header('个人资料');const panel=h('section',null,'s8-panel');main.append(panel);
    const face=btn('',()=>ui.go('style'),'s8-profile'),display=h('b',home.me.name);
    face.append(ui.avatar(home.me),display,h('small','更换头像 ›'));panel.append(face,h('small','登录账号 · '+home.me.name));
    try{
      const camp=await personal(home,'camp');
      if(!panel.isConnected)return;
      const me=camp.members?.find(m=>String(m.id)===String(camp.me));
      if(!me)throw Error('暂时无法读取自己的资料');
      display.textContent=me.name;
      const name=h('input');name.value=me.name;name.maxLength=14;name.required=true;
      const status=h('select'),signature=h('input');signature.value=me.mood||'';signature.maxLength=36;
      for(const action of actions){const o=h('option',action);o.value=action;status.append(o);}status.value=actions.includes(me.action)?me.action:'休息';
      const form=h('form'),save=h('button','保存资料','s8-primary');save.type='submit';
      form.append(formField('昵称',name),formField('趣味状态',status),formField('个性签名',signature),save);panel.append(form);
      form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;
        try{await personal(home,'camp',{type:'profile',name:name.value.trim(),avatar:Number(me.avatar),action:status.value,mood:signature.value.trim()});display.textContent=name.value.trim();ui.notice('个人资料已保存');}
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
  window.LycheeSocialPersonal={appearance,profile,notifications,enabled,displayName};
})();
