(function(){
  'use strict';
  const columns={
    feed:{label:'园中事',summary:'好友的近况与评论',write:'发动态',empty:'还没有动态',body:'写下想和好友分享的事',image:'garden-feed.webp',response:'评论'},
    questions:{label:'问一问',summary:'好友提问，一起找答案',write:'发问',empty:'还没有提问',body:'补充问题，让好友更容易回答',image:'garden-question.webp',response:'回答'}
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
    const section=ui.h('section',null,'s8-garden-portals'),heading=ui.h('div',null,'s8-garden-inbox-head');
    const count=ui.home.unread.garden;
    heading.append(ui.h('h2','园内消息'),ui.h('small',count?count+' 条未读':'已全部读完'));
    section.append(heading);
    for(const [kind,column] of Object.entries(columns)){
      section.append(tile(ui,column.label,column.summary,column.image,()=>ui.go('feed',{kind}),ui.home.unread[kind]));
    }
    section.append(tile(ui,'约定','我的计划与共同计划','tile-goal.webp',()=>ui.go('goals')),
      tile(ui,'荔枝树','照料我的树，与好友互赠荔枝','tile-tree.webp',()=>ui.go('tree')));
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
  function byline(ui,item){
    const line=ui.h('div',null,'s8-garden-by');
    const person={id:item.authorId,name:item.name};
    const avatar=ui.avatar?ui.avatar(person):ui.h('span',Array.from(person.name)[0]||'荔','s8-garden-initial');
    avatar.classList.add('s8-garden-face');avatar.setAttribute('aria-hidden','true');
    const who=ui.h('span',null,'s8-garden-person');
    const stamp=ui.h('time',time(item.created));stamp.dateTime=new Date(item.created).toISOString();
    who.append(ui.h('strong',person.name),stamp);line.append(avatar,who);return line;
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
    if(ui.header)ui.header(column.label,write);
    else{const tools=ui.h('div',null,'s8-garden-toolbar');tools.append(write);ui.main.append(tools);}
    ui.main.append(compose);
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
      const by=byline(ui,item);
      if(item.unread&&ui.home.unread[kind])by.append(ui.h('span','未读','s8-badge'));
      card.append(by);
      if(item.title)card.append(ui.h('h3',item.title));
      if(item.body)card.append(ui.h('p',item.body));
      card.append(ui.h('small',item.replyCount+' 条'+column.response,'s8-garden-responses'));ui.main.append(card);
    }
  }
  function post(ui,data){
    const item=data.post,column=columns[item.kind],box=ui.h('article',null,'s8-panel s8-garden-detail');
    box.append(byline(ui,item));
    if(item.title)box.append(ui.h('h2',item.title));
    if(item.body)box.append(ui.h('p',item.body));
    const replies=ui.h('div',null,'s8-garden-replies'),heading=ui.h('div',null,'s8-heading');
    heading.append(ui.h('h2',column.response),ui.h('small',data.replies.length+' 条'));
    ui.main.append(box,heading,replies);
    const input=field(ui,item.kind==='questions'?'我的回答':'我的评论','textarea',2000);
    input.input.placeholder=item.kind==='questions'?'写下你的回答…':'说点什么…';
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
      const row=ui.h('article',null,'s8-garden-reply s8-garden-detail');
      const meta=byline(ui,r);
      if(r.replyTo && names.has(r.replyTo))meta.append(ui.h('small','回复 '+names.get(r.replyTo)));
      row.append(meta,ui.h('p',r.body));
      if(r.authorId!==ui.home.me.id){
        const reply=ui.btn('回复',()=>select(r),'s8-garden-direct');reply.setAttribute('aria-label','回复 '+r.name);row.append(reply);
      }
      if(r.id===ui.route.params.replyId){row.classList.add('s8-reply-target');row.tabIndex=-1;highlight=row;}
      replies.append(row);
    }
    const form=editor(ui,item.kind==='questions'?'发布回答':'发表评论',[input],(values,key)=>ui.mutate('reply',{postId:item.id,body:values[0],clientId:key,...(target?{replyTo:target.id}:{})}),
      async result=>{await ui.go('post',{id:item.id,kind:item.kind,replyId:result?.id??''});},()=>target?.id);
    form.prepend(context);ui.main.append(form);
    if(highlight)requestAnimationFrame(()=>{if(highlight.isConnected){highlight.focus({preventScroll:true});highlight.scrollIntoView({block:'nearest'});}});
  }
  function tree(ui,data){
    const t=data.tree,stage=Math.min(7,Math.max(0,Number(t.waterCount)||0));
    const box=ui.h('section',null,'s8-panel s8-tree-card');
    const image=picture(ui,'yard65-stage'+stage+'.webp','s8-tree-image');image.alt='小院里正在生长的荔枝树';
    const detail=ui.h('div',null,'s8-tree-care'),stats=ui.h('div',null,'s8-tree-stats');
    for(const [value,unit,label] of [[t.fruit,'颗','可赠荔枝'],[t.waterCount,'天','累计浇水']]){
      const stat=ui.h('div'),n=ui.h('strong',String(value));n.append(ui.h('small',unit));
      stat.append(ui.h('small',label),n);stats.append(stat);
    }
    detail.append(stats);
    const water=ui.btn(t.wateredToday?'今天已浇水':'浇水 · 收 1 颗荔枝',async()=>{
      if(water.disabled)return;water.disabled=true;
      try{await ui.mutate('water',{});await ui.repaint();}
      catch(error){ui.notice(error.message);water.disabled=false;}
    },'s8-primary');
    water.disabled=t.wateredToday;detail.append(water);box.append(image,detail);ui.main.append(box);
    if(t.fruit>0&&ui.home.friends.length){
      const picker=ui.h('select');
      const placeholder=ui.h('option','选择好友');placeholder.value='';picker.append(placeholder);picker.required=true;
      for(const f of ui.home.friends){const option=ui.h('option',f.name);option.value=f.id;picker.append(option);}
      const form=editor(ui,'赠送 1 颗荔枝',[{label:'赠给好友',input:picker}],([id],key)=>ui.mutate('gift',{friendId:id,clientId:key}),()=>ui.repaint());
      form.classList.add('s8-garden-gift');ui.main.append(form);
    }else if(!ui.home.friends.length)ui.main.append(ui.h('p','成为好友后，就可以互赠荔枝。','s8-muted'));
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
    const views={garden,feed,post,tree};
    if(views[view])views[view](ui,data);
  }});
})();

