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
    const bar=h('header',null,'s8-header'),scroll=h('div',null,'s8-scroll'),main=h('section',null,'s8-content');
    const alert=h('div',null,'s8-alert'),nav=h('nav',null,'s8-nav');
    nav.setAttribute('aria-label','主导航');alert.setAttribute('role','status');scroll.append(main);shell.append(bar,alert,scroll,nav);root.replaceChildren(shell);
    let home=null,route={view:'home',params:{}},sequence=0,timer,snapshot='',busy=false,activeData;
    const stack=[],drafts=new Map(),unreadPositions=new Map();
    const calling=fn=>async(...args)=>{try{return await fn(...args);}catch(error){if(error.status===401){location.reload();return;}notice(error.message||'暂时无法连接，请重试。');}};
    function notice(msg){alert.textContent=msg||'';}
    async function mutate(action,fields){return api.write(action,fields);}
    function go(view,params={},replace=false){
      if(!replace)stack.push(route);route={view,params};sequence++;snapshot='';scroll.scrollTop=0;notice('');
      return refresh(true);
    }
    function back(){const prev=stack.pop()||{view:'home',params:{}};return go(prev.view,prev.params,true);}
    function tab(view){stack.length=0;return go(view,{},true);}
    function section(){
      if(['garden','post','feed','tree'].includes(route.view))return 'garden';
      if(['tools','selectGroup','legacy'].includes(route.view))return route.params.tab||'tools';
      if(['me','settings'].includes(route.view))return 'me';
      return 'home';
    }
    function drawNav(){
      const u=home?.unread||{};
      nav.replaceChildren(...tabs.map(([view,name,icon])=>{
        const b=btn('',()=>tab(view)),image=photo('/mobile/nav-'+icon+'-on.webp');
        b.append(image,document.createTextNode(name));b.setAttribute('aria-label',name);
        if(view===section())b.setAttribute('aria-current','page');
        const count=view==='garden'?u.garden:view==='home'?(u.groups||0)+(u.private||0):0;
        if(count)b.append(h('b',String(count),'s8-badge'));return b;
      }));
    }
    function header(title,action){
      bar.replaceChildren();
      if(!tabs.some(t=>t[0]===route.view))bar.append(btn('‹ 返回',back,'s8-back'));
      else{const logo=photo('/mobile/icon.png');logo.className='s8-logo';bar.append(logo);}
      bar.append(h('h1',title));if(action)bar.append(action);
    }
    async function loadData(view,params){
      if(['group','members','inviteGroup'].includes(view))return api.read('group',{id:params.id});
      if(view==='dm'||view==='post')return api.read(view,{id:params.id});
      if(view==='feed')return api.read(view,{kind:params.kind});
      if(view==='tree')return api.read('tree');
      return null;
    }
    async function mark(view,params,data){
      if(!data||!['group','dm','feed'].includes(view))return;
      const key=view+':'+(params.id||params.kind),marker=String(data.through||0)+'/'+String(data.legacyThrough||0);
      if(unreadPositions.get(key)===marker||marker==='0/0')return;
      const scope=view==='group'?{groupId:params.id}:view==='dm'?{friendId:params.id}:{kind:params.kind};
      await api.write('read',{...scope,through:data.through||0,legacyThrough:data.legacyThrough||0});
      unreadPositions.set(key,marker);
    }
    const ui={h,btn,go,api,main,mutate,formField,notice,legacy:(gardenId,detail)=>legacy(gardenId,detail,true),repaint:()=>refresh(true)};
    Object.defineProperties(ui,{home:{get:()=>home},route:{get:()=>route}});
    async function refresh(force=false){
      const token=++sequence,{view,params}=route,key=JSON.stringify(route);
      try{
        const details=await loadData(view,params);
        if(token!==sequence||!shell.isConnected)return;
        await mark(view,params,details);
        const latest=await api.read('home');
        if(token!==sequence||!shell.isConnected)return;
        home=latest;activeData=details;drawNav();
        const signature=JSON.stringify([key,home,details]);
        if(!force&&(signature===snapshot||main.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select')||view==='legacy'))return;
        snapshot=signature;const position=scroll.scrollTop;
        render(view,params,details);
        if(!force)scroll.scrollTop=position;
      }catch(error){
        if(token!==sequence||!shell.isConnected)return;
        if(error.status===401){location.reload();return;}
        if(force){header('荔圈');main.replaceChildren(h('p',error.message,'s8-panel'),btn('重试',()=>refresh(true)));}
        else notice(error.message||'暂时无法刷新');
        if(error.status===403&&window.lycheeShellSettings&&!window.lycheeAndroidShellVersion&&!main.querySelector('.s8-upgrade')){
          const a=h('a','检查安卓更新','s8-upgrade');a.href='lychee-android://settings/update';main.append(h('p','此安卓版本需要升级才能打开新版荔圈。'),a);
        }
      }finally{
        if(token===sequence){clearTimeout(timer);if(shell.isConnected)timer=setTimeout(()=>document.hidden||busy?refreshDeferred():refresh(false),['group','dm'].includes(view)?4000:12000);}
      }
    }
    function refreshDeferred(){clearTimeout(timer);if(shell.isConnected)timer=setTimeout(()=>document.hidden||busy?refreshDeferred():refresh(false),4000);}
    function form(actionLabel,fields,run){
      const f=h('form',null,'s8-panel'),b=h('button',actionLabel,'s8-primary');b.type='submit';f.append(...fields,b);
      f.addEventListener('submit',calling(async ev=>{ev.preventDefault();if(busy)return;busy=true;b.disabled=true;try{await run();}finally{busy=false;b.disabled=false;}}));return f;
    }
    function input(type,limit,value=''){const i=h('input');i.type=type;i.value=value;if(limit)i.maxLength=limit;return i;}
    function homeView(){
      header(home.me.name+'的首页',btn('好友',()=>go('friends')));
      const goal=home.goals.find(g=>g.due>=Date.now())||home.goals[0],date=goal?new Date(goal.due):new Date();
      const card=btn('',()=>go('goals'),'s8-card');
      const day=h('span',String(date.getDate()),'s8-day');day.prepend(h('small',(date.getMonth()+1)+'月'));
      const content=h('span');content.append(h('small','我的约定'+(goal?' · '+timeOf(goal.due):'')),h('b',goal?goal.title:'添加个人约定'));card.append(day,content);
      main.append(card,heading('最近消息',btn('创建群聊',()=>go('createGroup'))));
      const chats=[...home.groups.map(g=>({...g,group:true})),...home.friends];
      chats.sort((a,b)=>(b.lastMessage?.created||0)-(a.lastMessage?.created||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
      for(const c of chats){
        const last=c.lastMessage,kind=c.group?'群聊':'私聊';
        const summary=last?(c.group&&last.name?last.name+'：':'')+last.body:(c.group?'还没有群消息':'开始和好友聊天');
        const b=row(c.name,summary,()=>go(c.group?'group':'dm',{id:c.id}),c.group?c.cover:null,{kind,unread:c.unread,time:listTime(last?.created)});
        b.dataset.conversation=c.id;main.append(b);
      }
      if(!chats.length)main.append(h('p','还没有会话。可以添加好友或创建群聊。','s8-panel'));
      main.append(btn('使用邀请码加入原群',()=>access.join()));
    }
    function goals(id){
      header('我的约定');const current=home.goals.find(g=>g.id===id);
      for(const g of home.goals){
        const box=h('article',null,'s8-panel');box.append(h('h3',g.title),h('small',new Date(g.due).toLocaleString('zh-CN')),h('p',g.body||''));
        if(g.source==='legacy'){
          if(home.groups.some(group=>group.id===g.gardenId))box.append(btn('查看原圈约定',()=>legacy(g.gardenId,'goal',true)));
        }else box.append(btn('编辑',()=>go('goals',{id:g.id})),btn('删除',calling(async()=>{if(confirm('删除这个个人约定？')){await mutate('goalDelete',{id:g.id});await go('goals',{},true);}})));
        main.append(box);
      }
      const title=input('text',80,current?.title),due=input('datetime-local'),body=input('text',300,current?.body);
      title.required=due.required=true;
      if(current){const d=new Date(current.due);due.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
      const key=current?.id||window.LycheeSocialApi.requestId();
      main.append(form(current?'保存修改':'添加约定',[formField('约定名称',title),formField('时间',due),formField('备注',body)],async()=>{await mutate('goalSave',{id:key,title:title.value,body:body.value,due:new Date(due.value).getTime()});await go('goals',{},true);}));
    }
    function friends(){
      header('好友');const target=input('text',14);target.required=true;
      main.append(form('发送好友申请',[formField('对方的账号名',target)],async()=>{await mutate('friendRequest',{name:target.value.trim()});await refresh(true);}));
      for(const req of home.requests){const box=h('div',null,'s8-panel');box.append(h('strong',req.name),h('small',req.direction==='incoming'?' 想加你为好友':' 已发送申请'));
        if(req.direction==='incoming')for(const [label,action] of [['同意','friendAccept'],['拒绝','friendDecline']])box.append(btn(label,calling(async()=>{await mutate(action,{accountId:req.id});await refresh(true);})));main.append(box);}
      main.append(heading('我的好友'));for(const f of home.friends)main.append(row(f.name,'私聊',()=>go('dm',{id:f.id})));
      if(!home.friends.length)main.append(h('p','双方同意后，好友会出现在这里。','s8-muted'));
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
      header(data.group.name+' · 成员',btn('邀请好友',()=>go('inviteGroup',{id})));
      for(const m of data.members){const box=h('div',null,'s8-row');box.append(h('strong',m.name),h('small',m.role==='owner'?'群主':'成员'));
        if(m.friendStatus==='none')box.append(btn('加好友',calling(async()=>{await mutate('friendRequest',{accountId:m.id});await refresh(true);})));
        if(m.friendStatus==='outgoing')box.append(h('small','已申请'));
        if(m.friendStatus==='incoming')box.append(btn('同意好友申请',calling(async()=>{await mutate('friendAccept',{accountId:m.id});await refresh(true);})));
        if(m.friendStatus==='friend')box.append(btn('私聊',()=>go('dm',{id:m.id})));
        main.append(box);
      }
      main.append(btn('退出群聊',calling(async()=>{if(confirm('退出此群？现有好友关系会保留。')){await mutate('groupLeave',{groupId:id});await tab('home');}})));
    }
    function room(view,id,data){
      const group=view==='group',key=view+':'+id;
      header(group?data.group.name:data.friend.name,group?btn('群成员',()=>go('members',{id})):null);
      if(group){
        const actions=h('div',null,'s8-actions');actions.append(btn('图片、表情与撤回',()=>legacy(id,'circle',true)),btn('一起玩',()=>legacy(id,'quiz')),btn('原圈资料',()=>legacy(id,'history',true)));
        main.append(actions);
      }
      let previous;
      for(const msg of data.messages){
        const divider=window.LycheeSocialApi.chatDivider(previous,msg.created,5*60000);previous=msg.created;
        if(divider)main.append(h('time',divider,'s8-time'));
        const bubble=h('article',null,'s8-msg'+(msg.authorId===home.me.id?' mine':''));
        if(group)bubble.append(h('small',msg.name));bubble.append(h('p',msg.body||'群聊附件'));
        if(group&&typeof msg.imageUrl==='string'&&msg.imageUrl.startsWith('/g/'+encodeURIComponent(id)+'/api/for/'+encodeURIComponent(home.me.id)+'/')){
          const image=h('img');image.alt='群聊图片';image.loading='lazy';image.style.maxWidth='100%';image.src=msg.imageUrl;
          bubble.append(image);
        }
        if(group&&/^【头脑王者】/.test(msg.body||''))bubble.append(btn('查看对局',()=>legacy(id,'quiz',false,(msg.body.match(/对局编号：([\da-f-]{36})/i)||[])[1])));
        main.append(bubble);
      }
      if(!data.messages.length)main.append(h('p','还没有消息。','s8-muted'));
      const draft=drafts.get(key)||{text:'',id:null},area=h('textarea');area.rows=1;area.maxLength=2000;area.placeholder='写消息…';area.setAttribute('aria-label','消息内容');area.value=draft.text;
      area.oninput=()=>{draft.text=area.value;draft.id=null;drafts.set(key,draft);};
      const f=form('发送',[area],async()=>{const text=area.value.trim();if(!text)return;
        draft.id=draft.id||window.LycheeSocialApi.requestId();drafts.set(key,draft);
        await mutate('message',{...(group?{groupId:id}:{friendId:id}),body:text,clientId:draft.id});drafts.delete(key);await refresh(true);scroll.scrollTop=scroll.scrollHeight;});
      f.className='s8-composer';main.append(f);
    }
    function legacy(gardenId,detail,history=false,match){
      if(detail==='history'||detail==='garden')return go('history',{id:gardenId});
      return go('legacy',{id:gardenId,detail,history,match,tab:section()});
    }
    function tools(){
      header('工具箱');
      const games=new Set(['quiz','gomoku','soup','riddles']);
      for(const [label,isGame] of [['日常工具',false],['一起玩',true]]){
        const grid=h('div',null,'s8-grid');
        main.append(heading(label),grid);
        for(const [dest,title,art] of toolLinks){
          if(games.has(dest)!==isGame)continue;
          const button=btn('',()=>openTool(dest),'s8-tool');
          button.append(photo(art),h('b',title));grid.append(button);
        }
      }
      main.append(btn('全部原有工具',()=>legacy(home.accountToolsGardenId,'tools')));
    }
    function openTool(dest){
      if(dest==='tree')return go('tree');if(dest==='goal')return go('goals');if(dest==='question')return go('feed',{kind:'questions'});
      if(['quiz','gomoku','soup','riddles'].includes(dest))return go('selectGroup',{dest});
      return legacy(home.accountToolsGardenId,dest);
    }
    function embed(params){
      const tool=toolLinks.find(([id])=>id===params.detail);
      header(tool?.[1]||({circle:'群聊图片、表情与撤回',me:'头像、主题与更多',album:'原圈相册',notifications:'提醒与通知',profile:'个人资料',history:'原圈资料',feed:'原圈园中事',question:'原圈问一问',tree:'原圈荔枝树',goal:'原圈约定',settings:'设置'}[params.detail]||'荔枝'));
      const frame=h('iframe',null,'s8-legacy'),url=new URL(location.pathname,location.origin);
      url.searchParams.set('garden',params.id);url.searchParams.set('s8tool',params.detail);
      if(params.history)url.searchParams.set('history','1');if(params.match)url.searchParams.set('match',params.match);
      frame.title=bar.querySelector('h1').textContent;frame.src=url.href;main.style.height='100%';main.append(frame);
    }
    function me(settings=false){
      header(settings?'设置':'我');
      if(!settings){
        main.append(heading(home.me.name),btn('个人资料',()=>legacy(home.accountToolsGardenId,'profile')),btn('我的约定',()=>go('goals')),btn('好友',()=>go('friends')),btn('提醒与通知',()=>legacy(home.accountToolsGardenId,'notifications')),btn('头像、主题与更多',()=>legacy(home.accountToolsGardenId,'me')),btn('设置',()=>go('settings')));
        main.append(heading('原圈资料'));for(const g of home.groups)main.append(row(g.name,'旧帖、共同约定和原圈记录',()=>legacy(g.id,'history',true),g.cover));
        return;
      }
      const win=document.body.dataset.app==='/windows/phone.js',android=window.lycheeAndroidShellVersion;
      const webVersion=document.body.dataset.clientBuild;
      const version=h('p',android?'安卓 A'+android:(win?'Windows W':'手机网页 V')+webVersion,'settings-version');
      main.append(version);if(android)main.append(h('small','手机网页 V'+webVersion));
      if(window.LycheeDesktopUpdate)main.append(btn('检查更新',()=>window.LycheeDesktopUpdate.check()));
      main.append(btn('账号公告',()=>access.announcements()),btn('退出账号',()=>access.logout()));
    }
    function render(view,params,data){
      main.replaceChildren();main.style.height='';scroll.classList.toggle('s8-has-legacy',view==='legacy');if(view==='home')return homeView();
      if(view==='goals')return goals(params.id);if(view==='friends')return friends();
      if(view==='createGroup'||view==='inviteGroup')return groupForm(params.id,data);
      if(view==='members')return members(params.id,data);
      if(view==='group'||view==='dm')return room(view,params.id,data);
      if(view==='tools')return tools();if(view==='me'||view==='settings')return me(view==='settings');
      if(view==='legacy')return embed(params);
      if(view==='history'){
        const group=home.groups.find(g=>g.id===params.id);header(group?group.name+' · 原圈资料':'原圈资料');
        if(!group){main.append(h('p','你已不在这个群里。'));return;}
        for(const [detail,label] of [['circle','原群聊与照片'],['feed','原圈园中事'],['question','原圈问一问'],['goal','原圈约定'],['tree','原圈荔枝树'],['album','原圈相册'],['me','原圈个人资料和记录'],['tools','原圈工具箱']]){
          main.append(row(label,group.name,()=>legacy(group.id,detail,true)));
        }
        return;
      }
      if(view==='selectGroup'){header('选择群聊');for(const g of home.groups)main.append(row(g.name,g.memberCount+' 位成员',()=>legacy(g.id,params.dest),g.cover));if(!home.groups.length)main.append(btn('创建群聊',()=>go('createGroup')));return;}
      header(({garden:'荔枝园',feed:params.kind==='questions'?'问一问':'园中事',post:'详情',tree:'我的荔枝树'})[view]);
      window.LycheeSocialGarden.render(ui,view,data||home);
    }
    window.addEventListener('message',event=>{
      const frame=main.querySelector('iframe');
      if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin||!event.data||event.data.type!=='lychee-social-nav')return;
      const dest=event.data.dest;
      if(dest==='back')return back();
      if(['feed','question','goal','tree'].includes(dest)){
        if(dest==='feed'||dest==='question')return go('feed',{kind:dest==='feed'?'feed':'questions'});
        return go(dest==='goal'?'goals':'tree');
      }
      if(dest==='quiz')return go('selectGroup',{dest});
    });
    if(initialGroup)route={view:'group',params:{id:initialGroup}};
    refresh(true);
    return {go,home:()=>tab('home')};
  }
  window.LycheeSocial={mount};
})();
