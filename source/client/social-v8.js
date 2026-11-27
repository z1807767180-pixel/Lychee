/* The four main sections share one authenticated account and one navigation stack. */
(() => {
  'use strict';
  const tabs=[['home','荔圈','chat'],['garden','荔枝园','garden'],['tools','工具箱','tools'],['me','我','me']];
  const toolLinks=[['wheel','交给命运','/client/wheel-card-v7.webp'],['diet','照记饮食','/client/diet-card-v7.webp'],['goal','约定倒计时','/mobile/tile-goal.webp'],['question','问一问','/mobile/garden-question.webp'],['tasks','提醒事项','/mobile/ai-icon-write.webp'],['focus','番茄钟','/mobile/ledger-clock.webp'],['ledger','记账本','/mobile/ledger-stall.webp'],['tree','荔枝树','/mobile/tile-tree.webp'],['quiz','头脑王者','/client/quiz-card-v7.webp'],['gomoku','五子棋','/mobile/tile-gomoku.webp'],['soup','海龟汤','/mobile/tile-soup.webp'],['riddles','脑筋急转弯','/mobile/tile-riddles.webp'],['ai-chat','AI 助手','/mobile/ai-chat-hero.webp'],['ai-image','AI 生图','/mobile/ai-image-hero.webp']];
  function h(tag,text,className){
    const node=document.createElement(tag);if(text!=null)node.textContent=text;
    if(className)node.className=className;return node;
  }
  function btn(label,fn,className){
    const b=h('button',label,className);b.type='button';b.addEventListener('click',fn);return b;
  }
  function photo(src,alt=''){const image=h('img',null,'s8-photo');image.src=src;image.alt=alt;return image;}
  function formField(label,input){const l=h('label',label,'s8-field');l.append(input);return l;}
  function heading(text,action){const box=h('div',null,'s8-heading');box.append(h('h2',text));if(action)box.append(action);return box;}
  function row(name,preview,open,art,meta={}){
    const b=btn('',open,'s8-row');b.setAttribute('aria-label',name);
    const avatar=art?photo(art):h('span',Array.from(name)[0]||'荔','s8-photo s8-avatar');
    const copy=h('span',null,'s8-copy'),title=h('strong',name);
    if(meta.kind)title.append(h('span',meta.kind,'s8-type'));copy.append(title,h('small',preview||''));
    const end=h('span',null,'s8-end');if(meta.time)end.append(h('small',meta.time));
    if(meta.unread)end.append(h('b',String(meta.unread),'s8-badge'));
    b.append(avatar,copy,end);return b;
  }
  const timeOf=stamp=>new Date(stamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  function listTime(stamp){if(!stamp)return '';const date=new Date(stamp);return date.toDateString()===new Date().toDateString()?timeOf(stamp):date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});}
  function mount(root,account,access,initialGroup){
    const api=window.LycheeSocialApi.connect(account.id),shell=h('div',null,'s8');
    const appearance=window.LycheeSocialAppearance.make(shell,account.id);
    const bar=h('header',null,'s8-header'),scroll=h('div',null,'s8-scroll'),main=h('section',null,'s8-content');
    const alert=h('div',null,'s8-alert'),nav=h('nav',null,'s8-nav');
    nav.setAttribute('aria-label','主导航');alert.setAttribute('role','status');scroll.append(main);shell.append(bar,alert,scroll,nav);root.replaceChildren(shell);
    let home=null,route={view:'home',params:{}},sequence=0,timer,snapshot='',busy=false,activeData;
    const stack=[],drafts=new Map(),unreadPositions=new Map();let navState='';
    const bridge=document.body.dataset.app==='/windows/phone.js'?window.chrome?.webview:null;
    let nativeActive=false,refreshing=false,disposeTool=null;
    const foreground=()=>!document.hidden&&(!bridge||nativeActive);
    const calling=fn=>async(...args)=>{try{return await fn(...args);}catch(error){if(error.status===401){location.reload();return;}notice(error.message||'暂时无法连接，请重试。');}};
    function notice(msg){alert.textContent=msg||'';}
    async function mutate(action,fields){return api.write(action,fields);}
    function go(view,params={},replace=false){
      if(disposeTool){disposeTool();disposeTool=null;}
      if(route.view==='style')appearance.refresh(true);
      shell.querySelector('.s8-room-pin')?.remove();
      shell.querySelector('.s8-composer')?.remove();
      if(!replace)stack.push(route);route={view,params};sequence++;snapshot='';scroll.scrollTop=0;notice('');
      return refresh(true);
    }
    function back(){const prev=stack.pop()||{view:'home',params:{}};return go(prev.view,prev.params,true);}
    function tab(view){stack.length=0;return go(view,{},true);}
    function section(){
      if(['garden','post','feed','feedCompose','tree','goals','goalDetail','goalEdit'].includes(route.view))return 'garden';
      if(['tools','tool','history'].includes(route.view))return route.params.tab||'tools';
      if(['me','settings','friends','friendAdd','friendRequests','friendProfile','profile','funStatus','style','wallRestore','notifications','notices'].includes(route.view))return 'me';
      return 'home';
    }
    function drawNav(){
      const u=home?.unread||{};
      const state=[section(),u.garden,u.groups,u.private].join('/');if(state===navState)return;navState=state;
      nav.replaceChildren(...tabs.map(([view,name,icon])=>{
        const b=btn('',()=>tab(view)),image=photo('/mobile/nav-'+icon+(view===section()?'-on.webp':'-line.svg'));
        b.append(image,document.createTextNode(name));b.setAttribute('aria-label',name);
        if(view===section())b.setAttribute('aria-current','page');
        const count=view==='garden'?u.garden:view==='home'?(u.groups||0)+(u.private||0):0;
        if(count)b.append(h('b',String(count),'s8-badge'));return b;
      }));
    }
    function header(title,action){
      bar.replaceChildren();
      if(!tabs.some(t=>t[0]===route.view))bar.append(btn('‹ 返回',back,'s8-back'));
      bar.append(h('h1',title));if(action)bar.append(action);
    }
    async function loadData(view,params){
      if(['group','members','inviteGroup','groupPhotos'].includes(view))return api.read('group',{id:params.id});
      if(view==='dm'||view==='post'||view==='friendProfile')return api.read(view,{id:params.id});
      if(view==='feed')return api.read(view,{kind:params.kind});
      if(view==='tree')return api.read('tree',params.id?{id:params.id}:{});
      if(view==='notices')return access.listNotices();
      return null;
    }
    async function mark(view,params,data){
      if(!foreground()||!data||!['group','dm','feed'].includes(view))return;
      const key=view+':'+(params.id||params.kind),marker=String(data.through||0)+'/'+String(data.legacyThrough||0);
      if(unreadPositions.get(key)===marker||marker==='0/0')return;
      const scope=view==='group'?{groupId:params.id}:view==='dm'?{friendId:params.id}:{kind:params.kind};
      await api.write('read',{...scope,through:data.through||0,legacyThrough:data.legacyThrough||0});
      unreadPositions.set(key,marker);
    }
    const ui={h,btn,go,back,api,main,mutate,formField,notice,header,prefs:appearance,avatar:appearance.avatar,legacy:(gardenId,detail)=>legacy(gardenId,detail,true),legacyGame:(id,match)=>match?legacy(id,'quiz',true,match):go('tool',{dest:'quiz'}),repaint:()=>refresh(true)};
    Object.defineProperties(ui,{home:{get:()=>home},route:{get:()=>route}});
    async function refresh(force=false){
      const token=++sequence,{view,params}=route,key=JSON.stringify(route);refreshing=true;
      try{
        const details=!force&&view==='notices'?activeData:await loadData(view,params);
        if(token!==sequence||!shell.isConnected)return;
        const chat=view==='dm'||view==='group';
        const editing=!force&&shell.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select');
        if(!editing||chat)await mark(view,params,details);
        const latest=await api.read('home');
        if(token!==sequence||!shell.isConnected)return;
        if(bridge&&home&&!foreground()){
          const previous=new Map([...home.groups,...home.friends].map(c=>[c.id,c.unread]));
          if([...latest.groups,...latest.friends].some(c=>c.unread>(previous.get(c.id)||0)))bridge.postMessage('notify:attention');
        }
        if(home&&!force&&foreground()&&window.LycheeSocialPersonal.enabled(account.id))incoming(latest);
        home=latest;activeData=details;appearance.apply(latest,details?.group?details:null,chat);drawNav();
        const signature=JSON.stringify([key,home,details]);
        if(!force&&(signature===snapshot||editing&&!chat||['tool','style','profile','funStatus','friendAdd','feedCompose','wallRestore','notifications','notices','goalEdit','joinGroup','createGroup'].includes(view)))return;
        snapshot=signature;const position=scroll.scrollTop,atEnd=scroll.scrollHeight-position-scroll.clientHeight<60;
        render(view,params,details,chat&&!force&&!!shell.querySelector('.s8-composer'));
        appearance.refresh();
        if(view==='group'||view==='dm'){if(force||atEnd)scroll.scrollTop=scroll.scrollHeight;else scroll.scrollTop=position;}
        else if(!force)scroll.scrollTop=position;
      }catch(error){
        if(token!==sequence||!shell.isConnected)return;
        if(error.status===401){location.reload();return;}
        if(force){header('荔圈');main.replaceChildren(h('p',error.message,'s8-panel'),btn('重试',()=>refresh(true)));}
        else notice(error.message||'暂时无法刷新');
        if(error.status===403&&window.lycheeShellSettings&&!window.lycheeAndroidShellVersion&&!main.querySelector('.s8-upgrade')){
          const a=h('a','检查安卓更新','s8-upgrade');a.href='lychee-android://settings/update';main.append(h('p','此安卓版本需要升级才能打开新版荔圈。'),a);
        }
      }finally{
        if(token===sequence){refreshing=false;clearTimeout(timer);if(shell.isConnected)timer=setTimeout(()=>document.hidden||busy?refreshDeferred():refresh(false),['group','dm'].includes(view)?4000:12000);}
      }
    }
    function refreshDeferred(){clearTimeout(timer);if(shell.isConnected)timer=setTimeout(()=>document.hidden||busy?refreshDeferred():refresh(false),4000);}
    function form(actionLabel,fields,run){
      const f=h('form',null,'s8-panel'),b=h('button',actionLabel,'s8-primary');b.type='submit';f.append(...fields,b);
      f.addEventListener('submit',calling(async ev=>{ev.preventDefault();if(busy)return;busy=true;b.disabled=true;try{await run();}finally{busy=false;b.disabled=false;}}));return f;
    }
    function input(type,limit,value=''){const i=h('input');i.type=type;i.value=value;if(limit)i.maxLength=limit;return i;}
    function incoming(latest){
      const changed=(collection,old)=>collection.find(c=>c.unread>(old.find(p=>p.id===c.id)?.unread||0));
      const group=changed(latest.groups,home.groups),friend=changed(latest.friends,home.friends);
      let title,open;
      if(group&&!(route.view==='group'&&route.params.id===group.id)){title=group.name+' 有新群消息';open=()=>go('group',{id:group.id});}
      else if(friend&&!(route.view==='dm'&&route.params.id===friend.id)){title=friend.name+' 发来新消息';open=()=>go('dm',{id:friend.id});}
      else if(latest.unread.garden>home.unread.garden){title='荔枝园有新消息';open=()=>tab('garden');}
      if(!open)return;
      alert.replaceChildren(btn(title+'　查看',open),btn('关闭',()=>notice('')));
    }
    function homeView(){
      const actions=h('div',null,'s8-plus-menu');actions.hidden=true;
      const create=btn('＋',()=>{actions.hidden=!actions.hidden;create.setAttribute('aria-expanded',String(!actions.hidden));},'s8-header-icon');
      create.setAttribute('aria-label','创建或加入群聊');create.setAttribute('aria-expanded','false');
      actions.append(btn('创建群聊',()=>go('createGroup')),btn('加入群聊',()=>go('joinGroup')));
      header('荔圈',create);main.append(actions);
      const choices=home.bannerGoals||home.goals,goal=choices.find(g=>g.id===home.selectedGoalId)||(choices.length===1?choices[0]:null);
      const picker=h('div',null,'s8-panel');picker.hidden=true;
      const card=btn('',()=>{if(choices.length>1){picker.hidden=!picker.hidden;card.setAttribute('aria-expanded',String(!picker.hidden));}else go('goals');},'s8-card s8-hero');
      const content=h('span');content.append(h('small','我的约定'),h('b',goal?goal.title:(choices.length?'选择展示的约定':'暂无约定')));
      if(goal){const d=new Date(goal.due);content.append(h('span',(d.getMonth()+1)+'月'+d.getDate()+'日'+(goal.source==='shared'?'　'+goal.groupName:'　'+timeOf(goal.due))));}
      card.append(content,h('i','›','s8-hero-arrow'));const threads=h('div',null,'s8-thread-list');main.append(card,picker,heading('最近消息'),threads);
      if(choices.length>1){
        card.setAttribute('aria-expanded','false');
        picker.append(h('h2','选择首页展示的约定'));
        for(const option of choices)picker.append(row(option.title,option.groupName||'我的计划',calling(async()=>{await mutate('goalSelect',{id:option.id});await refresh(true);})));
      }
      const chats=[...home.groups.map(g=>({...g,group:true})),...home.friends];
      chats.sort((a,b)=>(b.lastMessage?.created||0)-(a.lastMessage?.created||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
      for(const c of chats){
        const last=c.lastMessage,kind=c.group?'群聊':'私聊';
        const summary=last?(c.group&&last.name?last.name+'：':'')+last.body:(c.group?'还没有群消息':'开始和好友聊天');
        const b=row(c.name,summary,()=>go(c.group?'group':'dm',{id:c.id}),c.group?c.cover:null,{kind,unread:c.unread,time:listTime(last?.created)});
        if(!c.group)b.firstChild.replaceWith(appearance.avatar(c));b.dataset.conversation=c.id;threads.append(b);
      }
      if(!chats.length)main.append(h('p','还没有会话。可以添加好友或创建群聊。','s8-panel'));
    }
    function joinGroup(){
      header('加入群聊');const code=input('text',64);code.required=true;code.autocapitalize='none';code.spellcheck=false;
      main.append(form('加入群聊',[formField('群邀请码',code)],async()=>{
        const id=await access.joinGroup(code.value.trim());await go('group',{id},true);
      }));
    }
    function friends(view){
      if(view==='friendAdd'){
        header('添加好友');const target=input('text',14),result=h('section');target.required=true;target.autocomplete='off';
        main.append(form('查找好友',[formField('对方的账号名',target)],async()=>{
          const {match}=await api.read('friendLookup',{name:target.value.trim()});
          result.replaceChildren(heading('搜索结果'));
          if(!match){result.append(h('p','没有找到这个账号。','s8-panel'));return;}
          const box=h('div',null,'s8-panel s8-contact');box.append(appearance.avatar(match),h('strong',match.name));result.append(box);
          const existing=home.friends.some(f=>f.id===match.id),request=home.requests.find(r=>r.id===match.id);
          if(existing)box.append(btn('好友资料',()=>go('friendProfile',{id:match.id})));
          else if(request)box.append(btn(request.direction==='incoming'?'处理申请':'已申请',()=>go('friendRequests')));
          else box.append(btn('发申请',calling(async()=>{await mutate('friendRequest',{accountId:match.id});await go('friendRequests',{},true);})));
        }),result);return;
      }
      if(view==='friendRequests'){
        header('好友申请');
        for(const req of home.requests){const box=h('div',null,'s8-panel s8-contact');box.append(appearance.avatar(req),h('strong',req.name),h('small',req.direction==='incoming'?'想加你为好友':'已发送申请'));
          if(req.direction==='incoming')for(const [label,action] of [['同意','friendAccept'],['忽略','friendDecline']])box.append(btn(label,calling(async()=>{await mutate(action,{accountId:req.id});await refresh(true);})));main.append(box);}
        if(!home.requests.length)main.append(h('p','暂无好友申请。','s8-panel'));return;
      }
      header('我的好友');main.append(row('添加好友','查找对方的账号名',()=>go('friendAdd'),'/mobile/nav-chat-on.webp'),row('好友申请','待处理 '+home.requests.filter(r=>r.direction==='incoming').length+' 条',()=>go('friendRequests'),'/mobile/ai-icon-write.webp'),heading('联系人'));
      for(const f of home.friends){const button=row(f.name,'查看资料',()=>go('friendProfile',{id:f.id}));button.firstChild.replaceWith(appearance.avatar(f));main.append(button);}
      if(!home.friends.length)main.append(h('p','双方同意后，好友会出现在这里。','s8-panel'));
    }
    function groupForm(id,data){
      const creating=!id,title=input('text',40);title.required=true;header(creating?'创建群聊':'邀请好友');
      const fields=creating?[formField('群名称',title)]:[],checks=[],clientId=window.LycheeSocialApi.requestId();
      const members=new Set((data?.members||[]).map(m=>m.id));fields.push(h('h3','从好友中选择'));
      for(const f of home.friends.filter(x=>!members.has(x.id))){
        const cb=input('checkbox');cb.value=f.id;const l=h('label',null,'s8-check');l.append(cb,document.createTextNode(f.name));fields.push(l);checks.push(cb);
      }
      main.append(form(creating?'创建':'邀请加入',fields,async()=>{const friendIds=checks.filter(x=>x.checked).map(x=>x.value);
        const result=creating?await mutate('groupCreate',{name:title.value,friendIds,clientId}):await mutate('groupInvite',{groupId:id,friendIds});
        await go('group',{id:creating?result.id:id},true);}));
    }
    function members(id,data){
      header('群详情',btn('邀请好友',()=>go('inviteGroup',{id})));const card=h('div',null,'s8-group-card');card.append(photo(data.group.cover),h('h2',data.group.name),h('small',data.members.length+' 位成员'));main.append(card,heading('群成员'));
      for(const m of data.members){const box=h('div',null,'s8-row');box.append(appearance.avatar(m),h('strong',m.name),h('small',m.role==='owner'?'群主':'成员'));
        if(m.friendStatus==='none')box.append(btn('加好友',calling(async()=>{await mutate('friendRequest',{accountId:m.id});await refresh(true);})));
        if(m.friendStatus==='outgoing')box.append(h('small','已申请'));
        if(m.friendStatus==='incoming')box.append(btn('同意好友申请',calling(async()=>{await mutate('friendAccept',{accountId:m.id});await refresh(true);})));
        if(m.friendStatus==='friend')box.append(btn('私聊',()=>go('dm',{id:m.id})));
        main.append(box);
      }
      if(data.pin)main.append(row('置顶消息',data.pin.body,()=>go('group',{id,locate:true})));
      main.append(row('聊天图片','最近聊天中的图片',()=>go('groupPhotos',{id}),'/mobile/garden-feed.webp'));
      main.append(btn('退出群聊',calling(async()=>{if(confirm('退出此群？现有好友关系会保留。')){await mutate('groupLeave',{groupId:id});await tab('home');}})));
    }
    function legacy(gardenId,detail,history=false,match){
      if(detail==='history'||detail==='garden')return go('history',{id:gardenId});
      return go('tool',{gardenId,dest:detail,history,match,tab:section()});
    }
    function tools(){
      header('工具箱');
      const sections=[['日常工具',['wheel','diet','tasks','focus','ledger']],['一起玩',['quiz','gomoku','soup','riddles']],['AI 工具',['ai-chat','ai-image']]];
      for(const [label,destinations] of sections){
        const grid=h('div',null,'s8-grid');main.append(heading(label),grid);
        for(const dest of destinations){const [,title,art]=toolLinks.find(x=>x[0]===dest);const button=btn('',()=>openTool(dest),'s8-tool');button.append(photo(art),h('b',title));grid.append(button);}
      }
    }
    function openTool(dest){
      if(dest==='tree')return go('tree');if(dest==='goal')return go('goals');if(dest==='question')return go('feed',{kind:'questions'});
      return go('tool',{dest});
    }
    function me(settings=false){
      header(settings?'设置':'我');
      if(!settings){
        const profile=btn('',()=>go('profile'),'s8-profile s8-hero'),identity=window.LycheeSocialPersonal.identity(ui,profile);main.append(profile);void identity.load();
        main.append(row('我的好友',home.friends.length+' 位好友',()=>go('friends'),'/mobile/nav-chat-on.webp'),heading('设置'),
          row('提醒与通知','消息提醒与通知记录',()=>go('notifications'),'/mobile/ai-icon-write.webp'),
          row('头像与主题','头像、主题和聊天壁纸',()=>go('style'),'/mobile/face-0.webp'),
          row('账号公告','近期更新与历史公告',()=>go('notices'),'/mobile/tile-goal.webp'),
          row('设置','版本、检查更新与账号',()=>go('settings'),'/mobile/nav-me-on.webp'));
        return;
      }
      const win=document.body.dataset.app==='/windows/phone.js',android=window.lycheeAndroidShellVersion,webVersion=document.body.dataset.clientBuild;
      const block=h('section',null,'s8-panel'),label=android?'安卓 A'+android:(win?'Windows W':'手机网页 V')+webVersion;
      block.append(h('h2','当前版本'),h('p',label,'settings-version'));
      if(android){block.append(h('small','手机网页 V'+webVersion));const link=h('a','检查安卓更新','s8-upgrade');link.href='lychee-android://settings/update';block.append(link);}
      if(win&&window.LycheeDesktopUpdate)block.append(btn('检查更新',()=>window.LycheeDesktopUpdate.check()));
      if(!win){
        const status=h('p','','s8-muted'),check=btn(android?'检查网页更新':'检查更新',calling(async()=>{
          const r=await fetch('/mobile/version.txt',{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw Error('暂时无法检查网页更新，请稍后重试。');
          const version=(await r.text()).trim();if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('暂时无法确认网页版本。');
          status.replaceChildren();if(version===webVersion)status.textContent='已是最新版本 V'+version;
          else status.append(document.createTextNode('新版本 V'+version+'　'),btn('刷新更新',()=>location.reload()));
        }));block.append(check,status);
      }
      main.append(block,row('账号公告','查看更新历史',()=>go('notices'),'/mobile/tile-goal.webp'),btn('退出登录',()=>access.logout()));
    }
    function noticesView(data){
      header('账号公告');
      for(const note of data||[]){
        const card=h('article',null,'s8-panel');card.append(h('h2',note.title),h('p',note.body,'s8-notice-text'));
        if(note.read)card.append(h('small','已读'));
        else card.append(btn('标为已读',calling(async()=>{await access.readNotice(note.id);await refresh(true);})));
        main.append(card);
      }
      if(!data?.length)main.append(h('p','暂无公告。','s8-panel'));
    }
    function render(view,params,data,keepComposer=false){
      shell.querySelector('.s8-room-pin')?.remove();
      if(!keepComposer)shell.querySelector('.s8-composer')?.remove();
      main.replaceChildren();main.style.height='';shell.dataset.view=view;scroll.classList.remove('s8-has-legacy');if(view==='home')return homeView();
      if(['goals','goalEdit','goalDetail'].includes(view))return window.LycheeSocialGarden.render(ui,view,home);
      if(view==='joinGroup')return joinGroup();if(['friends','friendRequests','friendAdd'].includes(view))return friends(view);
      if(view==='friendProfile')return window.LycheeSocialPersonal.friend(ui,data);
      if(view==='wallRestore')return window.LycheeSocialPersonal.restore(ui);
      if(view==='createGroup'||view==='inviteGroup')return groupForm(params.id,data);
      if(view==='members')return members(params.id,data);
      if(view==='groupPhotos'){
        header('聊天图片');const endpoint=window.LycheeSocialAppearance.endpoint(home.me.id,params.id,'camp')+'?image=';
        const items=data.messages.filter(m=>m.imageUrl?.startsWith(endpoint)&&m.body!=='消息已撤回');
        if(!items.length)main.append(h('p','最近聊天中暂无图片。','s8-panel'));
        const gallery=h('div',null,'s8-room-photos');for(const msg of items){
          const link=h('a');link.href=msg.imageUrl;link.target='_blank';link.rel='noopener';link.append(photo(msg.imageUrl,msg.name+'的群聊图片'));gallery.append(link);
        }main.append(gallery);return;
      }
      if(view==='group'||view==='dm')return window.LycheeSocialChat.display(ui,view,params.id,data,drafts,keepComposer);
      if(view==='tools')return tools();if(view==='me'||view==='settings')return me(view==='settings');
      if(view==='style')return window.LycheeSocialPersonal.appearance(ui);
      if(view==='profile')return window.LycheeSocialPersonal.profile(ui);
      if(view==='funStatus')return window.LycheeSocialPersonal.funStatus(ui);
      if(view==='notifications')return window.LycheeSocialPersonal.notifications(ui);
      if(view==='notices')return noticesView(data);
      if(view==='tool'){disposeTool=window.LycheeSocialTools.mount(ui,params);return;}
      if(view==='history'){
        const group=home.groups.find(g=>g.id===params.id);header(group?group.name+' · 原圈资料':'原圈资料');
        if(!group){main.append(h('p','你已不在这个群里。'));return;}
        for(const [detail,label] of [['circle','原群聊与照片'],['feed','原圈园中事'],['question','原圈问一问'],['goal','原圈约定'],['tree','原圈荔枝树'],['album','原圈相册'],['me','原圈个人资料和记录'],['tools','原圈工具箱']]){
          main.append(row(label,group.name,()=>legacy(group.id,detail,true)));
        }
        return;
      }
      header(({garden:'荔枝园',feed:params.kind==='questions'?'问一问':'园中事',post:params.kind==='questions'?'问题与回答':'动态与评论',tree:'我的荔枝树'})[view]);
      window.LycheeSocialGarden.render(ui,view,data||home);
    }
    if(bridge){
      bridge.addEventListener('message',event=>{
        if(!shell.isConnected)return;
        if(event.data==='notify:active')nativeActive=true;
        else if(event.data==='notify:inactive')nativeActive=false;
        else if(event.data!=='notify:poll')return;
        if(!busy&&!refreshing&&home)void refresh();
      });
      bridge.postMessage('notify:state');
    }
    if(initialGroup)route={view:'group',params:{id:initialGroup}};
    refresh(true);
    return {go,home:()=>tab('home')};
  }
  window.LycheeSocial={mount};
})();
