/* Mount tool components in the social content area. The enclosing shell owns navigation. */
(() => {
  'use strict';
  const titles={wheel:'交给命运',diet:'照记饮食',tasks:'提醒事项',focus:'番茄钟',ledger:'记账本',
    quiz:'头脑王者',gomoku:'五子棋',soup:'海龟汤',riddles:'脑筋急转弯','ai-chat':'AI 助手','ai-image':'AI 生图',
    circle:'群聊与照片',album:'原圈相册',profile:'个人资料',style:'头像与主题',notifications:'提醒与通知',
    feed:'原圈园中事',question:'原圈问一问',goal:'原圈约定',tree:'原圈荔枝树',garden:'原荔枝园',me:'原圈个人资料',tools:'原圈工具箱',notice:'公告',settings:'设置',scene:'人物场景'};
  const art={quiz:'/client/quiz-card-v7.webp',gomoku:'/mobile/tile-gomoku.webp',soup:'/mobile/tile-soup.webp',riddles:'/mobile/tile-riddles.webp'};
  // These editorial previews refer to two existing cards in circle-puzzles.json.
  const previews={"soup": {"label": "题库汤面 · 寓言", "title": "被搬走的第九户", "text": "我出发送件时，整条街有九户。九年半后，我终于到了最远那户：屋子还在，住户也没搬，却不能再算第九户。我给她拍了张近照，寄回第三户。第三户等这张照片等了好多年。"}, "riddles": {"label": "题库一瞥 · 常规", "text": "小夏只翻开一本书的最后几页，就知道「荔枝」这个词在书里哪五页出现过。她翻到了什么？"}};
  const ranks=['青铜','白银','黄金','铂金','钻石','王者'];
  const runtimeUrl=new URL('social-tools-runtime.js',document.currentScript.src);
  runtimeUrl.search=new URL(document.currentScript.src).search;
  let loading;
  function loadRuntime(){
    if(window.LycheeDirectRuntime)return Promise.resolve(window.LycheeDirectRuntime);
    if(!loading)loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=runtimeUrl.href;
      script.onload=()=>{if(window.LycheeDirectRuntime)resolve(window.LycheeDirectRuntime);else{loading=null;reject(Error('工具组件未加载'));}};
      script.onerror=()=>{loading=null;script.remove();reject(Error('工具未能打开，请重试'));};
      document.head.append(script);
    });
    return loading;
  }
  function invitation(body){
    if(typeof body!=='string')return null;
    const m=/^【一起玩】([^\n]+)\n好友对局：([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.exec(body);
    const dest=m&&Object.keys(art).find(key=>titles[key]===m[1]);
    return dest?{dest,match:m[2]}:null;
  }
  function scopedWindow(scope){
    const values={LycheeAccess:{...window.LycheeAccess,scope},lycheeToolEntry:null};
    return new Proxy(values,{get(target,key){
      if(Object.hasOwn(target,key))return target[key];
      const value=window[key];
      return ['addEventListener','removeEventListener','dispatchEvent','getComputedStyle','matchMedia','postMessage','open','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','setInterval','clearInterval'].includes(key)&&typeof value==='function'?value.bind(window):value;
    }});
  }
  function mount(ui,params){
    const {dest}=params,{h,btn,main,api}=ui,me=ui.home.me,history=!!params.history;
    let disposed=false,generation=0,unmount,poll,ticking=false,selected=params.match||'',stage='loading',writing=false;
    let lastView='',inviteDraft;
    const panel=(text,cls='s8-panel')=>h('p',text,cls);
    const section=()=>h('section',null,'s8-panel s8-play-panel');
    const button=(label,fn,primary=false)=>btn(label,fn,primary?'s8-primary':'s8-quiet');
    const alive=token=>!disposed&&token===generation;
    function clear(){
      generation++;clearTimeout(poll);poll=null;
      if(unmount){unmount();unmount=null;}
      main.replaceChildren();lastView='';
    }
    function fail(error,retry){
      if(disposed)return;
      const box=section();box.setAttribute('role','alert');
      box.append(panel(error.message||'暂时无法打开'),button('重试',retry));main.replaceChildren(box);
    }
    function back(){(ui.back||(()=>ui.go(history?'history':'tools',history?{id:params.gardenId}:{},true)))();}
    function open(next){
      if(!next){back();return;}
      if(!history){
        if(next==='feed'||next==='question'){ui.go('feed',{kind:next==='feed'?'feed':'questions'});return;}
        if(next==='goal'){ui.go('goals');return;}
        if(next==='tree'){ui.go('tree');return;}
      }
      if(Object.hasOwn(titles,next))ui.go('tool',{...params,dest:next,match:undefined});
    }
    function avatar(person){return ui.avatar({id:person?.accountId||person?.id,name:person?.name||''}).src;}
    function roomPath(path){
      const query=new URLSearchParams({view:selected?'playRoom':'playPractice',accountId:me.id});
      if(selected)query.set('match',selected);else query.set('game',dest);
      // A few original components append the room or cursor to the final empty query value.
      const split=path.indexOf('?');
      return '/api/v8/social?'+query+(split<0?'':'&'+path.slice(split+1));
    }
    async function direct(match=null,practice=false,deck='warmup'){
      clear();stage='component';const token=generation;
      const box=h('div',null,'s8-direct-tool garden-app');box.dataset.dest=dest;box.dataset.skin=main.closest('.s8')?.dataset.skin||'orchard';main.append(box);
      try{
        const gardenId=params.gardenId||ui.home.accountToolsGardenId;
        const garden=ui.home.groups.find(g=>g.id===gardenId);
        if(history&&!garden)throw Error('你不在这个群聊中');
        const scope={accountId:me.id,gardenId,gardenName:garden?.name||me.name};
        const runtime=await loadRuntime();
        if(!alive(token))return;
        const ctx={dest,wallpaperMode:params.wallpaper===true,node:box,scope,window:scopedWindow(scope),avatar,history,open,oldMatch:history?params.match:null,groupName:scope.gardenName,
          day:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),openNotice:row=>{
            if(!row)return open('notifications');
            window.LycheeNotifications?.open(row,{page:open,chat:()=>ui.go('home'),refresh:()=>{}});
          },wallpaper:async picture=>{
            if(!confirm('将这张图片设为我的聊天背景？'))throw Error('已取消应用');
            if(ui.prefs?.set)ui.prefs.set('chatWallpaper',picture);
            else localStorage.setItem('lychee.v640.'+me.id+'.'+gardenId+'.lychee.phone.1.chatWallpaper',picture);
          }};
        if(history||['profile','style'].includes(dest)){
          const url='/g/'+encodeURIComponent(gardenId)+'/api/for/'+encodeURIComponent(me.id)+'/camp?roster=lychee';
          const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
          if(!r.ok)throw Error('暂时无法读取圈内资料');ctx.camp=await r.json();
        }
        if(match||practice){
          const row=match||{host:me.id,hostName:me.name},scopeMatch=selected;
          ctx.roomApi=dest==='quiz'?null:(path=>{
            if(!path.startsWith('/api/camp'))throw Error('此页面只能访问当前游戏');
            if(!alive(token)||selected!==scopeMatch)throw Error('对局已关闭');
            return roomPath(path);
          });
          ctx.deck=deck;ctx.slot=me.id===row.host?'1':'2';ctx.gameMode=practice?'solo':'team';ctx.match=match;
          ctx.members=[{id:'1',accountId:row.host,name:row.hostName},...(match?[{id:'2',accountId:row.guest,name:row.guestName}]:[])];
          const tutorial='lychee.soup.tutorial.'+me.id;
          ctx.tutorialSeen=localStorage.getItem(tutorial)==='1';
          ctx.onTutorialSeen=()=>{localStorage.setItem(tutorial,'1');if(alive(token))direct(match,practice,deck);};
          if(dest==='quiz')ctx.friendPlay={
            back:()=>lobby(),ranks:()=>lobby('ranks'),again:()=>sendInvite(row.host===me.id?row.guest:row.host),
            async request(id,body){
              if(!id&&!body)return {members:ctx.members.map(p=>({...p,slot:Number(p.id)})),slot:Number(ctx.slot)};
              const next=body?await api.write('playMove',{id:row.id,choice:body.choice,round:body.round}):await api.read('playMatch',{id:row.id});
              if(!next.quiz)throw Error('对局尚未开始');return next.quiz;
            }
          };
        }
        if(!alive(token))return;
        unmount=runtime(ctx);
        if(match&&dest!=='quiz'){
          const footer=h('div',null,'s8-play-footer');
          footer.append(button('回到游戏大厅',()=>lobby()),button('结束这场对局',()=>{if(confirm('结束双方的这场对局？'))respond('leave');}));
          main.append(footer);monitorRoom(match.id,token);
        }else if(practice)main.append(button('返回游戏大厅',()=>lobby()));
      }catch(error){if(alive(token))fail(error,()=>direct(match,practice,deck));}
    }
    function monitorRoom(id,token){
      poll=setTimeout(async()=>{
        if(!alive(token))return;
        try{if(!document.hidden){
          const current=await api.read('playMatch',{id});
          if(alive(token)&&current.status!=='active'){showMatch(current);return;}
        }}catch(error){if(alive(token)&&error.status===403){fail(error,()=>lobby());return;}}
        if(alive(token))monitorRoom(id,token);
      },6500);
    }
    function hero(){
      const box=h('div',null,'s81-game-hero s81-hero-'+dest);
      if(dest==='gomoku'){
        const heading=h('div',null,'s81-line-head');heading.append(h('h2','好友棋室'),h('small','双人对弈'));
        const tray=h('div',null,'s81-chess-tray'),board=h('div',null,'s81-chess-board');board.setAttribute('aria-hidden','true');
        for(const [x,y] of [[3,3],[11,3],[7,7],[3,11],[11,11]]){
          const star=h('i');star.style.left=(100*x/14)+'%';star.style.top=(100*y/14)+'%';board.append(star);
        }
        tray.append(board);const seats=h('div',null,'s81-game-seats');
        seats.append(h('b','●　黑棋先手'),h('span','对'),h('b','白棋后手　○'));box.append(heading,tray,seats);return box;
      }
      const img=h('img');img.src=dest==='riddles'?'/mobile/riddle-picnic.webp':art[dest];img.alt='';box.append(img);
      if(dest==='riddles')return box;
      const body=h('div',null,'s81-game-caption');
      if(dest==='quiz')body.append(h('small','好友问答对战'),h('h2','来答五道题'));
      else body.append(h('small','海龟汤推理室'),h('h2','从汤面里找真相'));
      box.append(body);return box;
    }
    function preview(){
      const q=previews[dest],box=h('article',null,'s81-game-paper');
      box.append(h('small',q.label));if(q.title)box.append(h('h3',q.title));
      box.append(h('p',q.text));return box;
    }
    function lobbyActions(){
      const modes=h('div',null,'s81-game-actions');
      if(previews[dest]){
        const solo=button('',()=>direct(null,true)),invite=button('',()=>lobby('friends'),true);
        solo.append(h('b','自己玩'),h('small',dest==='soup'?'独自问主持':'答题库里的题'));
        invite.append(h('b','邀请好友'),h('small',dest==='soup'?'一起猜汤底':'和好友互相出题'));
        modes.append(solo,invite);
      }else modes.append(button(dest==='quiz'?'邀请好友对战':'邀请好友入局',()=>lobby('friends'),true));
      return modes;
    }
    function showRanks(ranking){
      const box=section();box.append(h('h3','好友排行'));
      for(const p of ranking){
        const row=h('div',null,'s8-play-person');row.append(h('small',p.played?String(1+ranking.findIndex(x=>x.played&&x.stars===p.stars)):'—'),ui.avatar(p),h('b',p.name),h('small',p.played?ranks[Math.min(5,Math.floor(p.stars/3))]+' · '+p.stars+' 星':'未参赛'));box.append(row);
      }
      return box;
    }
    function drawLobby(data,mode){
      const sig=JSON.stringify([mode,data,ui.home.friends]);
      if(sig===lastView)return;lastView=sig;
      if(mode==='ranks'){main.replaceChildren(showRanks(data.ranking),button('返回游戏大厅',()=>lobby()));return;}
      const box=section();box.append(h('h3',mode==='friends'?'选择好友':'好友对局'));
      if(mode==='friends'){
        for(const f of ui.home.friends){const b=button('',()=>sendInvite(f.id));b.className='s8-play-person';b.append(ui.avatar(f),h('b',f.name),h('span','邀请'));box.append(b);}
        if(!ui.home.friends.length)box.append(panel('暂无可邀请好友','s8-muted'));
        box.append(button('返回大厅',()=>lobby()));main.replaceChildren(hero(),box);return;
      }
      const layout=h('section',null,'s81-game-lobby');layout.dataset.game=dest;layout.append(hero());
      if(dest==='quiz'){
        const rules=h('div',null,'s81-game-rules');
        for(const [n,label] of [['5','道题'],['10','秒 / 题'],['×2','末题分数']]){
          const item=h('div');item.append(h('b',n),h('small',label));rules.append(item);
        }
        layout.append(rules);
      }
      if(dest==='riddles')layout.append(preview());
      layout.append(lobbyActions());
      if(!ui.home.friends.length)layout.append(panel('暂无可邀请好友','s8-muted'));
      if(data.matches.length){
        for(const row of data.matches){
          const other=row.host===me.id?row.guestName:row.hostName;
          box.append(button((row.status==='active'?'正在进行':row.side?'收到邀请':'等待接受')+' · '+other,()=>enter(row.id)));
        }
        layout.append(box);
      }
      if(dest==='quiz')layout.append(showRanks(data.ranking));
      if(dest==='soup')layout.append(preview(),panel('邀请好友后，一起向主持提问，猜出汤底。','s81-game-note'));
      if(dest==='gomoku')layout.append(h('h3','对弈规则'),panel('两人轮流落子，横、竖或斜线先连成五子的玩家获胜。好友接受邀请后，双方就座。','s81-game-note'));
      if(dest==='riddles'){
        const decks=h('div',null,'s81-game-decks');
        for(const [key,title,sub] of [['warmup','常规','换个角度'],['advanced','进阶','情境思考'],['hard','困难','逻辑推理']]){
          const pick=button('',()=>direct(null,true,key));pick.append(h('b',title),h('small',sub));decks.append(pick);
        }
        layout.append(h('h3','练习题库'),decks);
      }
      main.replaceChildren(layout);
    }
    async function sendInvite(friendId){
      if(writing)return;writing=true;const token=generation;
      if(!inviteDraft||inviteDraft.friendId!==friendId)inviteDraft={id:window.LycheeSocialApi.requestId(),friendId,game:dest};
      try{const row=await api.write('playInvite',inviteDraft);inviteDraft=null;if(alive(token))enter(row.id);}
      catch(error){if(alive(token))ui.notice(error.message||'邀请未发出');}
      finally{writing=false;}
    }
    async function respond(decision){
      if(writing)return;writing=true;const token=generation;
      try{const row=await api.write('playRespond',{id:selected,decision});if(alive(token))showMatch(row);}
      catch(error){if(alive(token))ui.notice(error.message||'暂时无法回应');}
      finally{writing=false;}
    }
    function showMatch(row){
      if(disposed)return;
      if(row.game!==dest){fail(Error('邀请与游戏不匹配'),()=>lobby());return;}
      if(row.status==='active'||row.status==='done'&&row.quiz){direct(row);return;}
      if(lastView===row.status)return;lastView=row.status;
      const box=section(),other=row.host===me.id?row.guestName:row.hostName;
      if(row.status==='pending'){
        box.append(h('h2',row.side?other+' 邀请你一起玩':'已邀请 '+other),panel(row.side?'接受后开始本局。':'等待好友接受邀请。','s8-muted'));
        if(row.side)box.append(button('接受邀请',()=>respond('accept'),true));
        box.append(button(row.side?'拒绝邀请':'取消邀请',()=>respond(row.side?'decline':'cancel')));
      }else{if(unmount){unmount();unmount=null;}clearTimeout(poll);box.append(h('h2',row.status==='done'?'对局已结束':'邀请已结束'));}
      box.append(button('返回游戏大厅',()=>lobby()));main.replaceChildren(hero(),box);
    }
    async function sync(mode,token){
      if(!alive(token)||ticking)return;
      ticking=true;
      try{
        if(stage==='lobby'){const data=await api.read('playLobby',{game:dest});if(alive(token))drawLobby(data,mode);}
        else if(stage==='match'){const row=await api.read('playMatch',{id:selected});if(alive(token))showMatch(row);}
      }catch(error){if(alive(token))fail(error,()=>selected?enter(selected):lobby(mode));}
      finally{ticking=false;if(alive(token)&&['lobby','match'].includes(stage))poll=setTimeout(()=>sync(mode,token),selected?1800:5000);}
    }
    function begin(kind,mode){
      clear();stage=kind;const token=generation;
      function check(){if(!alive(token))return;if(ticking){poll=setTimeout(check,120);return;}sync(mode,token);}
      check();
    }
    function lobby(mode='home'){selected='';begin('lobby',mode);}
    function enter(id){selected=id;begin('match');}
    ui.header(titles[dest]||'工具箱');
    if(!Object.hasOwn(titles,dest))main.append(panel('没有这个工具'));
    else if(!history&&Object.hasOwn(art,dest)){if(selected)enter(selected);else lobby();}
    else direct();
    return ()=>{disposed=true;clear();};
  }
  window.LycheeSocialTools={mount,invitation,title:dest=>titles[dest]};
})();
