/* Account goals and garden countdowns keep their original stores and membership checks. */
(function(){
  'use strict';
  const dateText=value=>new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  const isShared=plan=>plan?.source==='shared';
  function endpoint(ui,garden){
    return '/g/'+encodeURIComponent(garden)+'/api/for/'+encodeURIComponent(ui.home.me.id)+'/phone';
  }
  async function phone(ui,garden,body,query=''){
    const r=await fetch(endpoint(ui,garden)+query,{credentials:'same-origin',cache:'no-store',method:body?'POST':'GET',
      headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const d=await r.json();if(!r.ok)throw Error(d.error||'暂时无法保存');return d;
  }
  function art(ui,title,sub,empty=false){
    const box=ui.h('section',null,'s8-column-art s8-plan-art'+(empty?' is-empty':''));
    const copy=ui.h('div');copy.append(ui.h('h2',title),ui.h('p',sub));
    const im=ui.h('img');im.alt='';im.src='/mobile/tile-goal.webp';box.append(copy,im);return box;
  }
  function action(ui,label,run,cls){
    const button=ui.btn(label,async()=>{if(button.disabled)return;button.disabled=true;try{await run();}catch(e){ui.notice(e.message||'暂时未能保存');}finally{button.disabled=false;}},cls);
    return button;
  }
  function list(ui){
    const shared=ui.route.params.mode==='shared',mode=shared?'shared':'personal';
    const plans=(shared?ui.home.sharedGoals:ui.home.goals)||[];
    const create=()=>ui.go('goalEdit',{mode});
    ui.header('约定',(!shared||ui.home.groups.length)?ui.btn('＋ 新建',create):null);
    const tabs=ui.h('div',null,'s8-goal-tabs');
    for(const [key,title] of [['personal','我的计划'],['shared','共同计划']]){
      const tab=ui.btn(title,()=>ui.go('goals',{mode:key},true));tab.setAttribute('aria-pressed',String(mode===key));tabs.append(tab);
    }
    ui.main.append(tabs);
    ui.main.append(art(ui,plans.length?(shared?'大家的约定':'我的日程'):(shared?'还没有共同计划':'还没有个人计划'),
      plans.length?(shared?'来自已加入的群聊':plans.length+' 个个人约定'):(shared?(ui.home.groups.length?'为群里的朋友定个日子':'加入群聊后，就能和大家约个日子'):'把一次见面或想完成的事记在这里'),!plans.length));
    for(const p of plans){
      const b=ui.btn('',()=>ui.go('goalDetail',{id:p.id,mode}),'s8-plan-card');
      const d=new Date(p.due),calendar=ui.h('span',null,'s8-plan-day');
      const month=shared?Number(p.date.slice(5,7)):d.getMonth()+1,day=shared?Number(p.date.slice(8,10)):d.getDate();
      calendar.append(ui.h('small',month+'月'),ui.h('b',String(day)));
      const copy=ui.h('span');copy.append(ui.h('strong',p.title),ui.h('small',shared?p.groupName:dateText(p.due)));b.append(calendar,copy,ui.h('span','›'));ui.main.append(b);
    }
  }
  // There is at most one visible countdown per mounted account.
  function createClock(h){
    let timeout,clock,parts,target;
    function pause(){clearTimeout(timeout);}
    function stop(){
      pause();clock=null;parts=null;
      document.removeEventListener('visibilitychange',resume);
      window.removeEventListener('pagehide',pause);
      window.removeEventListener('pageshow',resume);
    }
    function tick(){
      pause();
      const remaining=Math.max(0,target-Date.now()),seconds=Math.ceil(remaining/1000);
      const values=[Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60];
      parts.forEach((node,i)=>{
        const text=String(values[i]).padStart(i?2:1,'0');
        if(node.textContent!==text)node.textContent=text;
      });
      if(remaining && !document.hidden)timeout=setTimeout(resume,remaining%1000||1000);
    }
    function resume(){if(clock?.isConnected)tick();else stop();}
    function show(due,compact=false){
      stop();target=Number(due);
      clock=h('span',null,compact?'s8-banner-clock':'s8-plan-clock');
      clock.setAttribute('role','timer');
      parts=['天','时','分','秒'].map(label=>{
        const n=h('b'),cell=h('span');cell.append(n,h('small',label));clock.append(cell);return n;
      });
      document.addEventListener('visibilitychange',resume);
      window.addEventListener('pagehide',pause);
      window.addEventListener('pageshow',resume);
      tick();return clock;
    }
    return {show,stop};
  }
  async function jpeg(file){
    if(!file||!file.type.startsWith('image/'))throw Error('请选择图片');
    const src=URL.createObjectURL(file),im=new Image();
    try{await new Promise((ok,no)=>{im.onload=ok;im.onerror=()=>no(Error('无法读取图片'));im.src=src;});
      for(const dim of [1000,700,480]){const r=Math.min(1,dim/Math.max(im.width,im.height)),c=document.createElement('canvas');
        c.width=Math.max(1,Math.round(im.width*r));c.height=Math.max(1,Math.round(im.height*r));
        const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);
        const img=c.toDataURL('image/jpeg',.78).split(',')[1];if(img&&img.length<=340000)return img;
      }throw Error('图片太大，请裁剪后再试');
    }finally{URL.revokeObjectURL(src);}
  }
  function album(ui,p){
    const box=ui.h('details',null,'s8-panel s8-plan-album');box.append(ui.h('summary','约定相册'));
    const grid=ui.h('div',null,'s8-album-grid'),hint=ui.h('p',null,'s8-muted'),key=JSON.stringify([p.title,p.date]);
    let first=true,busy=false,before='',finished=false;
    const more=action(ui,'查看更多照片',load);more.hidden=true;
    async function load(){
      if(busy||finished)return;busy=true;
      try{const result=await phone(ui,p.gardenId,null,'?album='+encodeURIComponent(key)+(before?'&before='+encodeURIComponent(before):''));
        if(!box.isConnected)return;
        for(const photo of result.photos){const im=ui.h('img');im.alt='约定相册照片';im.loading='lazy';im.src=endpoint(ui,p.gardenId)+'?image='+encodeURIComponent(photo.id);
          const link=ui.btn('',()=>{const layer=ui.h('div',null,'s8-image-preview'),full=ui.h('img');layer.setAttribute('role','dialog');layer.setAttribute('aria-label','约定照片');full.src=im.src;full.alt='约定照片';
            const close=ui.btn('关闭',()=>{layer.remove();link.focus();});layer.append(full,close);ui.main.append(layer);close.focus();});
          link.setAttribute('aria-label','查看照片');link.append(im);grid.append(link);}
        before=result.photos[result.photos.length-1]?.cursor||'';finished=result.photos.length<30;more.hidden=finished;
        hint.textContent=grid.childElementCount?'':'相册里还没有照片。';first=false;
      }finally{busy=false;}
    }
    box.ontoggle=()=>{if(box.open&&first)load().catch(e=>ui.notice(e.message));};
    const input=ui.h('input');input.type='file';input.accept='image/*';input.hidden=true;
    const send=ui.btn('添加照片',()=>input.click());
    input.onchange=async()=>{if(!input.files[0])return;send.disabled=true;
      try{await phone(ui,p.gardenId,{type:'journal-post',id:window.LycheeSocialApi.requestId(),body:'',picture:await jpeg(input.files[0]),kind:'plain',prompt:'',options:[],album:key});
        grid.replaceChildren();finished=false;before='';await load();}
      catch(e){ui.notice(e.message);}finally{send.disabled=false;input.value='';}
    };
    box.append(grid,hint,more,send,input);return box;
  }
  function detail(ui,plan){
    if(!plan){ui.header('约定详情');ui.main.append(art(ui,'此计划已不可用','返回约定列表查看其他计划',true));return;}
    const shared=isShared(plan),group=ui.home.groups.find(g=>g.id===plan.gardenId);
    const editable=plan.source!=='legacy'||!!group;
    ui.header(shared?'共同计划':'我的计划',editable?ui.btn('编辑',()=>ui.go('goalEdit',{id:plan.id,mode:shared?'shared':'personal'})):null);
    const head=art(ui,plan.title,shared?plan.groupName+' · '+plan.date:dateText(plan.due));
    const coverKey=shared&&group?'lychee.v640.'+ui.home.me.id+'.'+group.id+'.lychee.phone.'+group.selfSlot+'.goalCover':null;
    function applyCover(){const c=coverKey&&localStorage.getItem(coverKey);if(c&&/^\/9j\/[A-Za-z0-9+/=]+$/.test(c))head.style.backgroundImage='linear-gradient(90deg,#fffaf0ee,#fffaf06a),url("data:image/jpeg;base64,'+c+'")';}
    applyCover();ui.main.append(head,ui.clock.show(plan.due));
    if(plan.body)ui.main.append(ui.h('p',plan.body,'s8-panel s8-plan-body'));
    if(editable&&!shared)ui.main.append(action(ui,'删除个人约定',async()=>{if(!confirm('删除这个个人约定？'))return;
      if(plan.source==='legacy')await phone(ui,plan.gardenId,{type:'v61-goal-delete',id:plan.legacyId});else await ui.mutate('goalDelete',{id:plan.id});
      await ui.back();
    }));
    if(shared){ui.main.append(album(ui,plan));const menu=ui.h('details',null,'s8-panel');menu.append(ui.h('summary','约定背景'));
      const input=ui.h('input');input.type='file';input.accept='image/*';input.hidden=true;
      input.onchange=async()=>{try{if(input.files[0]&&coverKey){localStorage.setItem(coverKey,await jpeg(input.files[0]));applyCover();}}catch(e){ui.notice(e.message);}};
      menu.append(ui.btn('选择图片',()=>input.click()),input,ui.btn('AI 生图',()=>ui.go('tool',{dest:'ai-image',tab:'garden'})));ui.main.append(menu);
    }
  }
  function edit(ui,plan){
    const shared=isShared(plan)||ui.route.params.mode==='shared';ui.header(plan?'编辑约定':'新建约定');
    if(ui.route.params.id&&!plan){ui.main.append(art(ui,'此计划已不可用','请返回列表',true));return;}
    if(plan?.source==='legacy'&&!ui.home.groups.some(g=>g.id===plan.gardenId)){detail(ui,plan);return;}
    const form=ui.h('form',null,'s8-panel s8-plan-form'),title=ui.h('input'),date=ui.h('input'),note=ui.h('textarea');
    const picker=ui.h('select');let garden=plan?.gardenId||ui.route.params.groupId;
    if(shared&&!plan){const blank=ui.h('option','选择群聊');blank.value='';picker.append(blank);
      for(const g of ui.home.groups){const item=ui.h('option',g.name+((ui.home.sharedGoals||[]).some(p=>p.gardenId===g.id)?'（已有约定）':''));item.value=g.id;picker.append(item);}
      picker.required=true;if(garden)picker.value=garden;form.append(ui.formField('所属群聊',picker));}
    title.required=date.required=true;title.maxLength=shared?30:80;note.maxLength=300;date.type=shared?'date':'datetime-local';
    const fill=p=>{title.value=p?.title||'';note.value=p?.body||'';date.value=p?(shared?p.date:new Date(p.due-new Date(p.due).getTimezoneOffset()*60000).toISOString().slice(0,16)):'';};
    fill(plan);if(shared&&!plan)picker.onchange=()=>fill((ui.home.sharedGoals||[]).find(p=>p.gardenId===picker.value));
    form.append(ui.formField('约定名称',title),ui.formField(shared?'约定日期':'时间',date));
    if(!shared)form.append(ui.formField('备注',note));
    const submit=ui.h('button',plan?'保存修改':'保存约定','s8-primary');submit.type='submit';form.append(submit);
    const key=plan?.id||window.LycheeSocialApi.requestId();
    form.onsubmit=async e=>{e.preventDefault();if(submit.disabled)return;submit.disabled=true;
      try{if(shared){garden=plan?.gardenId||picker.value;await phone(ui,garden,{type:'goal',title:title.value,date:date.value});}
        else{const data={id:plan?.legacyId||key,title:title.value,body:note.value,due:new Date(date.value).getTime()};
          if(plan?.source==='legacy')await phone(ui,garden,{type:'v61-goal',...data});else await ui.mutate('goalSave',data);}
        await ui.back();
      }catch(error){ui.notice(error.message);}finally{submit.disabled=false;}
    };
    ui.main.append(form);
  }
  window.LycheeSocialPlans={createClock,render(ui,view){
    const plan=(ui.home.bannerGoals||ui.home.goals||[]).find(p=>p.id===ui.route.params.id);if(view==='goals')list(ui);else if(view==='goalDetail')detail(ui,plan);else edit(ui,plan);
  }};
})();
