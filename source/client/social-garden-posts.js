/* Friend-only garden posts and discussions. Uploads and reactions use the authenticated account. */
(() => {
  'use strict';
  const prompts=[
    ['今晚吃什么？','/client/garden-question-supper.webp'],
    ['周末去哪里走走？','/mobile/orchard-courtyard.jpg'],
    ['最近读到什么好书？','/mobile/garden-question.webp']
  ];
  const reactions=['⭐','❤️','👍','✈️'];
  const newId=()=>window.LycheeSocialApi.requestId();
  function picture(ui,src,alt,cls){
    const img=ui.h('img',null,cls);img.src=src;img.alt=alt;img.loading='lazy';return img;
  }
  function heading(ui,title,parent,art,action){
    ui.header(parent,action);
    const back=ui.main.closest('.s8')?.querySelector('.s8-header .s8-back');
    if(back)back.textContent='‹　'+parent;
    const top=ui.h('div',null,'g81-title');
    top.append(ui.h('h1',title),picture(ui,'/mobile/'+art,''));
    ui.main.append(top);
  }
  function observe(ui,fn){
    return async event=>{
      const b=event.currentTarget;
      if(b.disabled)return;b.disabled=true;
      try{await fn();}catch(e){ui.notice(e.message||'暂时无法保存，请重试。');}
      finally{b.disabled=false;}
    };
  }
  function face(ui,item,size=''){
    const img=ui.avatar({id:item.authorId,name:item.name});img.classList.add('g81-face');if(size)img.classList.add(size);return img;
  }
  function author(ui,item,asking=false){
    const block=ui.h('div',null,'g81-author');
    block.append(face(ui,item),ui.h('b',item.name),ui.h('small',asking?'问':''),ui.h('time',new Date(item.created).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})));
    return block;
  }
  function prompt(ui){
    const route=ui.route;
    const hero=ui.h('section',null,'g81-prompt'),title=ui.h('h2');
    let index=route.params.promptIndex||0,key=route.params.promptKey||newId();
    function show(){const [text,image]=prompts[index];title.textContent=text;hero.style.backgroundImage='url("'+image+'")';}
    const ask=ui.btn('问问大家',observe(ui,async()=>{
      route.params.promptKey=key;
      const result=await ui.mutate('post',{kind:'questions',title:prompts[index][0],body:'',clientId:key});
      delete route.params.promptKey;await ui.go('post',{kind:'questions',id:result.id});
    }),'s8-primary');
    const change=ui.btn('换一个  ›',()=>{index=(index+1)%prompts.length;route.params.promptIndex=index;key=newId();delete route.params.promptKey;show();},'g81-link');
    hero.append(title,ask,change);show();return hero;
  }
  function emptyState(ui,kind,write,hasPrompt){
    const question=kind==='questions',box=ui.h('section',null,'g81-empty '+(question?'is-question':'is-feed'));
    box.append(picture(ui,'/mobile/'+(question?'garden-question.webp':'garden-feed.webp'),''),
      ui.h('h2',question?'好友还没有提问':'好友还没有发布动态'),
      ui.h('p',question?'写下想问的事，好友可以来回答。':'发一张照片，和好友聊聊今天。'));
    if(!hasPrompt)box.append(ui.btn(question?'发个问题':'发条动态',write,'s8-primary'));
    return box;
  }
  function replyForm(ui,item,target,onSuccess){
    const form=ui.h('form',null,'g81-compose-reply');
    if(target){
      form.append(ui.h('b',(item.kind==='questions'?'追问':'回复')+target.name),ui.h('blockquote',target.body));
    }
    const toolbar=ui.h('div'),input=ui.h('textarea');
    input.rows=1;input.required=true;input.maxLength=2000;
    input.placeholder=target?'写给'+target.name+'…':item.kind==='questions'?'写下你的回答…':'说点什么…';
    const send=ui.h('button','发送','s8-primary');send.type='submit';
    toolbar.append(input,send);form.append(toolbar);
    let key=newId(),previous='';
    form.addEventListener('submit',async e=>{
      e.preventDefault();const value=input.value.trim();if(!value||send.disabled)return;
      if(previous!==value)key=newId();previous=value;send.disabled=true;
      try{await ui.mutate('reply',{postId:item.id,body:value,clientId:key,...(target?{replyTo:target.id}:{})});await onSuccess();}
      catch(err){ui.notice(err.message);}finally{send.disabled=false;}
    });
    return form;
  }
  function reactionIcon(ui,emoji){
    const file=emoji==='⭐'?'star':emoji==='❤️'?'heart':'';
    return file?picture(ui,'/client/garden-'+file+'.webp',emoji,'g81-emoji'):ui.h('span',emoji,'g81-unicode');
  }
  function reactionsBar(ui,item,write){
    const bar=ui.h('div',null,'g81-reactions'),picker=ui.h('div',null,'g81-picker');
    function button(emoji,count,mine){
      const b=ui.btn('',observe(ui,async()=>{
        await ui.mutate('postReact',{postId:item.id,emoji,active:!mine});await ui.repaint();
      }),'g81-reaction'+(mine?' mine':''));
      b.setAttribute('aria-label',emoji+(count?' '+count+' 人':''));b.setAttribute('aria-pressed',String(mine));
      b.append(reactionIcon(ui,emoji));if(count)b.append(ui.h('span',count));return b;
    }
    for(const e of item.reactions||[])bar.append(button(e.emoji,e.count,e.mine));
    for(const emoji of reactions)picker.append(button(emoji,0,!!item.reactions?.find(e=>e.emoji===emoji&&e.mine)));
    picker.hidden=true;
    const toggle=ui.btn('☺',()=>{picker.hidden=!picker.hidden;toggle.setAttribute('aria-expanded',String(!picker.hidden));},'g81-reaction g81-facebutton');
    toggle.setAttribute('aria-label','选择表情回应');toggle.setAttribute('aria-expanded','false');
    bar.append(toggle,picker,ui.btn('评论',write,'g81-link g81-commentlink'));return bar;
  }
  function feedCard(ui,item,full){
    const card=ui.h('article',null,'g81-feed'),comments=ui.h('div',null,'g81-comments'),compose=ui.h('div');
    card.append(author(ui,item));if(item.body)card.append(ui.h('p',item.body,'g81-body'));
    if(item.hasPhoto){
      const src='/api/v8/social?view=postPhoto&accountId='+encodeURIComponent(ui.home.me.id)+'&id='+encodeURIComponent(item.id);
      const link=ui.h('a');link.href=src;link.target='_blank';link.rel='noopener';
      link.append(picture(ui,src,'动态照片','g81-photo'));card.append(link);
    }
    function answer(target){
      compose.replaceChildren(replyForm(ui,item,target,()=>ui.repaint()));compose.querySelector('textarea').focus();
    }
    function show(rows){
      comments.replaceChildren();comments.hidden=!rows.length;
      const byId=new Map(rows.map(r=>[r.id,r]));
      for(const r of rows){
        const b=ui.btn('',()=>answer(r),'g81-comment');
        b.append(ui.h('b',r.name));
        if(r.replyTo&&byId.has(r.replyTo))b.append(ui.h('small',' 回复 '),ui.h('b',byId.get(r.replyTo).name));
        b.append(document.createTextNode('　'+r.body));comments.append(b);
        if(ui.route.params.replyId===r.id){b.classList.add('s8-reply-target');requestAnimationFrame(()=>b.scrollIntoView({block:'nearest'}));}
      }
      if(item.replyCount>rows.length)comments.append(ui.btn('展开其余 '+(item.replyCount-rows.length)+' 条评论',observe(ui,async()=>{
        const detail=await ui.api.read('post',{id:item.id});show(detail.replies);
      }),'g81-link'));
    }
    card.append(reactionsBar(ui,item,()=>answer(null)),comments,compose);show(full||item.preview||[]);return card;
  }
  function questionCard(ui,item){
    const box=ui.h('article',null,'g81-question'),open=()=>ui.go('post',{kind:'questions',id:item.id});
    box.append(author(ui,item,true),ui.btn(item.title||item.body,open,'g81-qtitle'));
    const first=item.preview?.[0];if(first){
      const peek=ui.btn('',open,'g81-answer-peek');peek.append(ui.h('b',first.name+'答'),ui.h('span',first.body));box.append(peek);
    }
    const footer=ui.h('div',null,'g81-qfoot');
    if(first)footer.append(ui.btn('查看 '+(item.answerCount??item.replyCount)+' 个回答  ›',open,'g81-link'));
    else footer.append(ui.h('small','还没人回答'),ui.btn('写个答案',()=>ui.go('post',{id:item.id,kind:'questions',answer:true}),'g81-link'));
    box.append(footer);return box;
  }
  function feed(ui,data){
    const kind=ui.route.params.kind,question=kind==='questions',write=()=>ui.go('feedCompose',{kind});
    heading(ui,question?'问一问':'园中事','荔枝园',question?'garden-question.webp':'nav-garden-on.webp',
      data.items.length||question?ui.btn(question?'我来问':'发动态',write,'s8-primary'):null);
    if(question){ui.main.append(prompt(ui),ui.h('h2','好友的问题','g81-subhead'));}
    if(data.repliesToMe?.length){
      const inbox=ui.h('details',null,'g81-inbox');inbox.append(ui.h('summary','回复我的（'+data.repliesToMe.length+'）'));
      for(const r of data.repliesToMe)inbox.append(ui.btn(r.name+' 回复了你：'+r.body,()=>ui.go('post',{id:r.postId,kind,replyId:r.id}),'g81-comment'));
      ui.main.append(inbox);
    }
    if(!data.items.length)ui.main.append(emptyState(ui,kind,write,question));
    for(const item of data.items)ui.main.append(question?questionCard(ui,item):feedCard(ui,item));
  }
  function compose(ui){
    const question=ui.route.params.kind==='questions',kind=question?'questions':'feed';
    heading(ui,question?'发问':'发动态',question?'问一问':'园中事',question?'garden-question.webp':'nav-garden-on.webp');
    const form=ui.h('form',null,'g81-compose'),title=ui.h('input'),body=ui.h('textarea');
    form.append(author(ui,{authorId:ui.home.me.id,name:ui.home.me.name,created:Date.now()}),ui.h('small','好友可见'));
    title.maxLength=120;title.required=question;body.maxLength=4000;body.rows=4;
    if(question)form.append(ui.formField('问题',title));
    form.append(ui.formField(question?'补充说明':'想和好友分享什么？',body));
    let photo='',working=false,key=newId(),last='';
    const submit=ui.h('button',question?'发布问题':'发布动态','s8-primary');submit.type='submit';
    if(!question){
      const picker=ui.h('input'),preview=ui.h('div'),toolbar=ui.h('div',null,'g81-compose-tools');
      picker.type='file';picker.accept='image/*';picker.hidden=true;
      const emojis=ui.h('div',null,'g81-compose-tools');emojis.hidden=true;
      for(const glyph of ['😊','❤️','👍','✨','🌿','🍴'])emojis.append(ui.btn(glyph,()=>{body.value=(body.value+glyph).slice(0,4000);body.focus();}));
      toolbar.append(ui.btn('＋ 手机图片',()=>picker.click(),'g81-link'),ui.btn('☺ 添加表情',()=>{emojis.hidden=!emojis.hidden;},'g81-link'));
      picker.onchange=async()=>{
        const file=picker.files[0];picker.value='';if(!file)return;
        working=true;submit.disabled=true;
        try{photo=await window.LycheeSocialChat.compress(file);
          preview.replaceChildren(picture(ui,'data:image/jpeg;base64,'+photo,'待发布照片','g81-photo'),ui.btn('移除图片',()=>{photo='';preview.replaceChildren();},'g81-link'));
        }catch(e){ui.notice(e.message);}finally{working=false;submit.disabled=false;}
      };
      form.append(preview,picker,toolbar,emojis);
    }
    form.append(submit);ui.main.append(form);
    form.onsubmit=async e=>{
      e.preventDefault();if(working||submit.disabled)return;
      const value={kind,title:question?title.value.trim():'',body:body.value.trim(),photo};
      if(!question&&!value.body&&!photo){ui.notice('请写点文字或选择一张图片。');return;}
      const hash=JSON.stringify(value);if(last!==hash)key=newId();last=hash;submit.disabled=true;
      try{await ui.mutate('post',{...value,clientId:key});await ui.back();}
      catch(err){ui.notice(err.message);}finally{submit.disabled=false;}
    };
  }
  function post(ui,data){
    const item=data.post,question=item.kind==='questions';
    heading(ui,question?'问题详情':'动态详情',question?'问一问':'园中事',question?'garden-question.webp':'nav-garden-on.webp');
    if(!question){ui.main.append(feedCard(ui,item,data.replies));return;}
    const hero=ui.h('article',null,'g81-detail');hero.append(ui.h('h2',item.title),author(ui,item));
    if(item.body)hero.append(ui.h('p',item.body));ui.main.append(hero);
    const replies=data.replies,byId=new Map(replies.map(r=>[r.id,r])),branches=new Map();
    for(const r of replies){
      const parent=branches.get(r.replyTo);
      if(parent)parent.children.push(r);
      const branch=parent||{reply:r,children:[]};branches.set(r.id,branch);
    }
    const answers=[...new Set(branches.values())],editor=ui.h('div');
    function respond(target,focus=true){
      editor.replaceChildren(replyForm(ui,item,target,()=>ui.repaint()));
      if(focus)editor.querySelector('textarea').focus();
    }
    ui.main.append(ui.h('h2',answers.length?answers.length+' 个回答':'回答','g81-subhead'));
    if(!answers.length){
      const empty=ui.h('div',null,'g81-empty-answer');
      empty.append(picture(ui,'/mobile/garden-question.webp',''),ui.h('h3','还没人回答'),ui.btn('写第一个回答',()=>respond(null),'s8-primary'));
      ui.main.append(empty);
    }
    let highlighted=null;
    for(const {reply,children} of answers){
      const row=ui.h('article',null,'g81-answer');row.append(author(ui,reply),ui.h('p',reply.body));
      if(reply.id===ui.route.params.replyId)highlighted=row;
      for(const child of children){
        const follow=ui.btn('',()=>respond(child),'g81-follow'),target=byId.get(child.replyTo);
        follow.append(ui.h('b',child.name+' 追问'+(target?.name||'')),ui.h('span',child.body));row.append(follow);
        if(child.id===ui.route.params.replyId)highlighted=follow;
      }
      row.append(ui.btn('追问'+reply.name,()=>respond(reply),'g81-link'));ui.main.append(row);
    }
    ui.main.append(editor);
    if(answers.length||ui.route.params.answer)respond(null,!!ui.route.params.answer);
    if(highlighted){highlighted.classList.add('s8-reply-target');requestAnimationFrame(()=>highlighted.scrollIntoView({block:'nearest'}));}
  }
  window.LycheeGardenPosts={feed,post,feedCompose:compose,author};
})();
