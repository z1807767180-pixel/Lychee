(function(){
  'use strict';
  const columns={
    feed:{label:'园中事',write:'发动态',empty:'还没有动态',body:'写下想和好友分享的事',image:'garden-feed.webp'},
    questions:{label:'问一问',write:'提问题',empty:'还没有提问',body:'补充问题，让好友更容易回答',image:'garden-question.webp'}
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
  function tile(ui,label,file,action,count){
    const el=ui.btn('',action,'s8-row s8-garden-row');
    el.append(picture(ui,file,'s8-photo'),ui.h('strong',label));
    if(count)el.append(ui.h('span',String(count),'s8-badge'));
    return el;
  }
  function oldGardens(ui){
    if(!ui.home.groups.length)return;
    const details=ui.h('details',null,'s8-panel'),summary=ui.h('summary','原圈资料');
    details.append(summary);
    for(const g of ui.home.groups)details.append(ui.btn(g.name,()=>ui.legacy(g.id,'garden'),'s8-row'));
    ui.main.append(details);
  }
  function garden(ui){
    const box=ui.h('div',null,'s8-panel s8-columns');
    for(const [kind,column] of Object.entries(columns)){
      box.append(tile(ui,column.label,column.image,()=>ui.go('feed',{kind}),ui.home.unread[kind]));
    }
    ui.main.append(box,tile(ui,'我的荔枝树','tile-tree.webp',()=>ui.go('tree')));
    oldGardens(ui);
  }
  // A failed submission keeps its text and request ID. Retrying the same
  // content after a lost response reconciles with the first server write.
  function editor(ui,label,fields,send,onSuccess){
    const form=ui.h('form',null,'s8-panel');
    for(const field of fields)form.append(ui.formField(field.label,field.input));
    const submit=ui.h('button',label,'s8-primary');submit.type='submit';
    form.append(submit);
    let key='',last='';
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(submit.disabled)return;
      const values=fields.map(f=>f.input.value.trim()),payload=JSON.stringify(values);
      if(!key||payload!==last)key=window.LycheeSocialApi.requestId();
      last=payload;
      submit.disabled=true;
      try{const result=await send(values,key);await onSuccess(result);}
      catch(error){ui.notice(error.message||'暂时无法提交，请重试');}
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
  function feed(ui,data){
    const kind=ui.route.params.kind==='questions'?'questions':'feed',column=columns[kind];
    const compose=ui.h('div');
    let open=false;
    const write=ui.btn(column.write,()=>{
      if(open){compose.replaceChildren();open=false;write.setAttribute('aria-expanded','false');return;}
      const fields=[];
      if(kind==='questions')fields.push(field(ui,'问题','input',120));
      fields.push(field(ui,kind==='questions'?'补充说明（选填）':column.body,'textarea',4000,kind!=='questions'));
      const form=editor(ui,kind==='questions'?'发布问题':'发布动态',fields,async(values,key)=>{
        const title=kind==='questions'?values[0]:'',body=kind==='questions'?values[1]:values[0];
        return ui.mutate('post',{kind,title,body,clientId:key});
      },async result=>{
        if(result?.id)await ui.go('post',{id:result.id,kind});
        else await ui.repaint();
      });
      open=true;write.setAttribute('aria-expanded','true');compose.replaceChildren(form);fields[0].input.focus();
    },'s8-primary');
    write.setAttribute('aria-expanded','false');
    const heading=ui.h('div',null,'s8-heading');
    heading.append(ui.h('h2',column.label),write);ui.main.append(heading,compose);
    if(data.repliesToMe?.length){
      const inbox=ui.h('details',null,'s8-panel s8-replies-inbox');
      inbox.append(ui.h('summary','回复我的（'+data.repliesToMe.length+'）'));
      for(const r of data.repliesToMe){
        const btn=ui.btn('',()=>ui.go('post',{id:r.postId,kind,replyId:r.id}),'s8-row');
        const text=ui.h('div');text.append(ui.h('strong',r.name+' 回复了你'),ui.h('p',r.body),ui.h('small',time(r.created)));
        btn.append(text);inbox.append(btn);
      }
      ui.main.append(inbox);
    }
    if(!data.items.length)ui.main.append(ui.h('p',column.empty,'s8-muted'));
    for(const item of data.items){
      const card=ui.btn('',()=>ui.go('post',{id:item.id,kind}),'s8-garden-post s8-panel');
      const by=ui.h('div',null,'s8-garden-by');
      by.append(ui.h('strong',item.name),ui.h('small',time(item.created)));
      if(item.unread)by.append(ui.h('span','未读','s8-badge'));
      card.append(by);
      if(item.title)card.append(ui.h('h3',item.title));
      if(item.body)card.append(ui.h('p',item.body));
      card.append(ui.h('small',item.replyCount+' 条回复'));ui.main.append(card);
    }
  }
  function post(ui,data){
    const item=data.post,box=ui.h('article',null,'s8-panel s8-garden-detail');
    const info=ui.h('div',null,'s8-garden-by');info.append(ui.h('b',item.name),ui.h('small',time(item.created)));box.append(info);
    if(item.title)box.append(ui.h('h2',item.title));
    if(item.body)box.append(ui.h('p',item.body));
    const replies=ui.h('div'),heading=ui.h('h2','回复（'+data.replies.length+'）','s8-heading');
    ui.main.append(box,heading,replies);
    const input=field(ui,'回复内容','textarea',2000);
    let target=null,highlight;
    const context=ui.h('div',null,'s8-actions'),status=ui.h('span',null,'s8-muted');
    const reset=ui.btn('取消指定回复',()=>select(null));
    function select(reply){
      target=reply;status.textContent=reply?'回复 '+reply.name:'';
      context.hidden=!reply;input.input.focus();
    }
    context.append(status,reset);context.hidden=true;
    const names=new Map([[item.id,item.name],...data.replies.map(r=>[r.id,r.name])]);
    for(const r of data.replies){
      const row=ui.h('article',null,'s8-panel s8-garden-detail');
      const meta=ui.h('div',null,'s8-garden-by');
      meta.append(ui.h('strong',r.name),ui.h('small',time(r.created)));
      if(r.replyTo && names.has(r.replyTo))meta.append(ui.h('small','回复 '+names.get(r.replyTo)));
      row.append(meta,ui.h('p',r.body));
      if(r.authorId!==ui.home.me.id)row.append(ui.btn('回复 '+r.name,()=>select(r)));
      if(r.id===ui.route.params.replyId){row.classList.add('s8-reply-target');row.tabIndex=-1;highlight=row;}
      replies.append(row);
    }
    const form=editor(ui,'发送回复',[input],(values,key)=>ui.mutate('reply',{postId:item.id,body:values[0],clientId:key,...(target?{replyTo:target.id}:{})}),
      async result=>{await ui.go('post',{id:item.id,kind:item.kind,replyId:result?.id??''});});
    form.prepend(context);ui.main.append(form);
    if(highlight)requestAnimationFrame(()=>{if(highlight.isConnected){highlight.focus({preventScroll:true});highlight.scrollIntoView({block:'nearest'});}});
  }
  function tree(ui,data){
    const t=data.tree,stage=Math.min(7,Math.max(0,Number(t.waterCount)||0));
    const box=ui.h('section',null,'s8-panel s8-tree-card');
    box.append(picture(ui,'yard65-stage'+stage+'.webp','s8-tree-image'));
    const title=ui.h('div');title.append(ui.h('h2','我的荔枝树'),ui.h('p','可赠荔枝 '+t.fruit+' 颗 · 已浇水 '+t.waterCount+' 天'));box.append(title);
    const water=ui.btn(t.wateredToday?'今天已浇水':'浇水 · 收 1 颗荔枝',async()=>{
      if(water.disabled)return;water.disabled=true;
      try{await ui.mutate('water',{});await ui.repaint();}
      catch(error){ui.notice(error.message);water.disabled=false;}
    },'s8-primary');
    water.disabled=t.wateredToday;box.append(water);ui.main.append(box);
    if(t.fruit>0&&ui.home.friends.length){
      const picker=ui.h('select');
      const placeholder=ui.h('option','选择好友');placeholder.value='';picker.append(placeholder);picker.required=true;
      for(const f of ui.home.friends){const option=ui.h('option',f.name);option.value=f.id;picker.append(option);}
      ui.main.append(editor(ui,'赠送 1 颗荔枝',[{label:'赠给好友',input:picker}],([id],key)=>ui.mutate('gift',{friendId:id,clientId:key}),()=>ui.repaint()));
    }else if(!ui.home.friends.length)ui.main.append(ui.h('p','成为好友后，就可以互赠荔枝。','s8-muted'));
    ui.main.append(ui.h('h2','赠送记录','s8-heading'));
    if(!data.gifts.length)ui.main.append(ui.h('p','还没有收发记录','s8-muted'));
    for(const g of data.gifts){
      const row=ui.h('div',null,'s8-row s8-gift-row');
      const delivery=g.fromId===ui.home.me.id?'送给 '+g.toName:g.fromName+' 送给我';
      row.append(ui.h('b',delivery+' · '+g.amount+' 颗'),ui.h('small',time(g.created)));ui.main.append(row);
    }
  }
  window.LycheeSocialGarden=Object.freeze({render(ui,view,data){
    const views={garden,feed,post,tree};
    if(views[view])views[view](ui,data);
  }});
})();

