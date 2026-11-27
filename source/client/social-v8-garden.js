(function(){
  'use strict';
  const columns={
    feed:{label:'园中事',summary:'好友分享的近况',write:'发动态',empty:'还没有动态',body:'写下想和好友分享的事',image:'garden-feed.webp',response:'评论'},
    questions:{label:'问一问',summary:'好友的提问与回答',write:'发问',empty:'还没有提问',body:'补充问题，让好友更容易回答',image:'garden-question.webp',response:'回答'}
  };
  function time(stamp){
    const d=new Date(stamp),now=new Date(),digits=n=>String(n).padStart(2,'0');
    const clock=digits(d.getHours())+':'+digits(d.getMinutes());
    if(d.toDateString()===now.toDateString())return '今天 '+clock;
    return (d.getFullYear()===now.getFullYear()?'':d.getFullYear()+'年')+(d.getMonth()+1)+'月'+d.getDate()+'日 '+clock;
  }
  function picture(ui,file,cls){
    const img=ui.h('img',null,cls);img.src='/mobile/'+file;img.alt='';return img;
  }
  function tile(ui,label,summary,file,action,count=0){
    const el=ui.btn('',action,'s8-garden-row');
    const copy=ui.h('span',null,'s8-garden-copy');
    copy.append(ui.h('strong',label),ui.h('small',summary));el.append(picture(ui,file,'s8-photo'),copy);
    if(count){const badge=ui.h('span',String(count),'s8-badge');badge.setAttribute('aria-label',count+' 条未读');el.append(badge);}
    const arrow=ui.h('span','›','s8-garden-arrow');arrow.setAttribute('aria-hidden','true');el.append(arrow);
    return el;
  }
  function garden(ui){
    const section=ui.h('section',null,'s8-garden-portals');
    for(const [kind,column] of Object.entries(columns)){
      section.append(tile(ui,column.label,column.summary,column.image,()=>ui.go('feed',{kind}),ui.home.unread[kind]));
    }
    section.append(tile(ui,'约定','我的计划与共同计划','tile-goal.webp',()=>ui.go('goals')),
      tile(ui,'荔枝树','我的树与好友小院','tile-tree.webp',()=>ui.go('tree')));
    ui.main.append(section);
  }
  // A failed submission keeps its text and request ID. Retrying the same
  // content after a lost response reconciles with the first server write.
  function editor(ui,label,fields,send,onSuccess,recipient=()=>null){
    const form=ui.h('form',null,'s8-panel');
    for(const field of fields)form.append(ui.formField(field.label,field.input));
    const submit=ui.h('button',label,'s8-primary');submit.type='submit';
    form.append(submit);
    let key='',last='';
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      const origin=ui.route,values=fields.map(f=>f.input.value.trim()),payload=JSON.stringify([values,recipient()]);
      if(!key||payload!==last)key=window.LycheeSocialApi.requestId();
      last=payload;
      submit.disabled=true;
      try{const result=await send(values,key);if(ui.route===origin&&ui.main.isConnected)await onSuccess(result);}
      catch(error){if(ui.route===origin&&ui.main.isConnected)ui.notice(error.message||'暂时无法提交，请重试');}
      finally{submit.disabled=false;}
    });
    return form;
  }
  function field(ui,label,tag,max,required=true){
    const input=ui.h(tag);
    if(tag==='textarea')input.rows=3;
    input.required=required;input.maxLength=max;
    return {label,input};
  }
  function tree(ui,data){
    const t=data.tree,mine=data.mine!==false,owner=data.owner||ui.home.me;
    const stage=t.mature?7:t.progress===2?5:t.progress===1?3:t.waterCount?2:1;
    const cycle=['冒出新芽','长出嫩叶','枝头结果','荔枝成熟'][t.progress||0];
    ui.header(mine?'我的荔枝树':owner.name+'的小园');
    const scene=ui.h('section',null,'s8-yard-scene');scene.setAttribute('aria-label',owner.name+'的荔枝小园');
    const landscape=picture(ui,'yard65-stage'+stage+'.webp','s8-yard-landscape');landscape.alt=cycle+'的荔枝树';
    const stageTag=ui.h('div',null,'s8-yard-season');stageTag.append(ui.h('strong',cycle),ui.h('small',t.mature?'这一批已结果':'本轮浇水 '+t.progress+' / 3'));
    scene.append(landscape,stageTag);
    if(mine){const basket=ui.h('div',null,'s8-yard-basket');basket.append(picture(ui,'yard65-basket.webp'),ui.h('b','果篮 '+t.fruit+' 颗'));scene.append(basket);}
    const origin=ui.route,reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const waterDone=mine?t.wateredToday:data.helpedToday;
    if(!t.mature){
      const water=ui.btn('',async()=>{
        if(water.disabled)return;water.disabled=true;scene.classList.add('is-watering');
        try{
          const [result]=await Promise.all([ui.mutate('treeWater',mine?{}:{friendId:owner.id}),new Promise(done=>setTimeout(done,reduce?0:550))]);
          if(ui.route!==origin)return;await ui.repaint();ui.notice(result.mature?'枝头的荔枝熟了。':result.changed?'水浇好了，树又长大了一点。':'今天已经浇过水了。');
        }catch(e){if(ui.route===origin){ui.notice(e.message);water.disabled=false;scene.classList.remove('is-watering');}}
      },'s8-yard-water');
      const label=waterDone?'今天已浇水':mine?'给树浇水':'帮好友浇水';
      water.setAttribute('aria-label',label);water.disabled=waterDone;water.append(picture(ui,'yard65-can.webp'),ui.h('span',label));scene.append(water);
      const drops=ui.h('span',null,'s8-yard-drops');drops.setAttribute('aria-hidden','true');drops.append(ui.h('i'),ui.h('i'),ui.h('i'));scene.append(drops);
    }else{
      const key=window.LycheeSocialApi.requestId();
      const bunch=mine?ui.btn('',async()=>{
        if(bunch.disabled)return;bunch.disabled=true;scene.classList.add('is-picking');
        try{await Promise.all([ui.mutate('treeHarvest',{clientId:key}),new Promise(done=>setTimeout(done,reduce?0:370))]);if(ui.route===origin){await ui.repaint();ui.notice('3 颗荔枝已放进果篮。');}}
        catch(e){if(ui.route===origin){ui.notice(e.message);bunch.disabled=false;scene.classList.remove('is-picking');}}
      },'s8-yard-fruit'):ui.h('div',null,'s8-yard-fruit');
      if(mine)bunch.setAttribute('aria-label','采摘 3 颗成熟荔枝');
      for(let i=0;i<3;i++)bunch.append(picture(ui,'yard65-red.webp'));
      scene.append(bunch,ui.h('span',mine?'点枝头红果，收进果篮':'果子熟了，等主人来摘','s8-yard-hint'));
    }
    ui.main.append(scene);
    if(mine&&t.fruit>0&&ui.home.friends.length){
      const picker=ui.h('select');
      const placeholder=ui.h('option','选择好友');placeholder.value='';picker.append(placeholder);picker.required=true;
      for(const f of ui.home.friends){const option=ui.h('option',f.name);option.value=f.id;picker.append(option);}
      const form=editor(ui,'赠送 1 颗荔枝',[{label:'赠给好友',input:picker}],([id],key)=>ui.mutate('gift',{friendId:id,clientId:key}),()=>ui.repaint());
      form.classList.add('s8-garden-gift');ui.main.append(form);
    }else if(mine&&!ui.home.friends.length)ui.main.append(ui.h('p','成为好友后，就可以互访小园、互赠荔枝。','s8-muted'));
    if(mine&&ui.home.friends.length){
      ui.main.append(ui.h('h2','去好友的小园','s8-heading'));
      const visits=ui.h('div',null,'s8-visit-list');
      for(const f of ui.home.friends){const button=ui.btn('',()=>ui.go('tree',{id:f.id}),'s8-visit');button.append(ui.avatar(f),ui.h('span',f.name),ui.h('small','去看看 ›'));visits.append(button);}ui.main.append(visits);
    }
    ui.main.append(ui.h('h2','小园留言','s8-heading'));
    for(const note of data.notes||[]){const card=ui.h('article',null,'s8-panel s8-yard-note');card.append(window.LycheeGardenPosts.author(ui,note),ui.h('p',note.body));ui.main.append(card);}
    if(!data.notes?.length)ui.main.append(ui.h('p','小园里还没有留言。','s8-muted'));
    const note=field(ui,'写下留言','textarea',240);
    ui.main.append(editor(ui,'留言',[note],([body],key)=>ui.mutate('treeNote',{...(mine?{}:{friendId:owner.id}),body,clientId:key}),()=>ui.repaint()));
    if(!mine)return;
    ui.main.append(ui.h('h2','赠送记录','s8-heading'));
    if(!data.gifts.length)ui.main.append(ui.h('p','还没有收发记录','s8-muted'));
    const records=ui.h('div',null,'s8-gift-records');ui.main.append(records);
    for(const g of data.gifts){
      const row=ui.h('div',null,'s8-row s8-gift-row');
      const delivery=g.fromId===ui.home.me.id?'送给 '+g.toName:g.fromName+' 送给我';
      row.append(ui.h('b',delivery+' · '+g.amount+' 颗'),ui.h('small',time(g.created)));records.append(row);
    }
  }
  window.LycheeSocialGarden=Object.freeze({render(ui,view,data){
    if(['goals','goalDetail','goalEdit'].includes(view))return window.LycheeSocialPlans.render(ui,view);
    const views={garden,tree,...window.LycheeGardenPosts};
    if(views[view])views[view](ui,data);
  }});
})();

