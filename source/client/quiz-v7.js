(function () {
  'use strict';
  const ranks = ['青铜','白银','黄金','铂金','钻石','王者'];
  const letters = ['A','B','C','D'];
  const rank = n => ranks[Math.min(5,Math.floor(n/3))];
  const invitation = /^【头脑王者】邀请 (.+) 答五题\n对局编号：([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

  async function request(id, body, signal) {
    const scope = window.LycheeAccess.scope;
    const query = new URLSearchParams({accountId:scope.accountId,gardenId:scope.gardenId});
    if (id) query.set('id',id);
    const response = await fetch('/api/v7/quiz?'+query,{
      method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,
      headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw Error(data.error || '暂时连不上对局，请重试');
    return data;
  }

  function Quiz({React, initialId, avatarFor}) {
    const h = React.createElement, {useState,useRef,useEffect} = React;
    const [id,select] = useState(initialId || '');
    const [game,setGame] = useState(null), [lobby,setLobby] = useState(null);
    const [panel,setPanel] = useState('home'), [err,setError] = useState(''), [busy,setBusy] = useState(false);
    const [actionError,setActionError] = useState('');
    const [time,tick] = useState(Date.now()), [reload,refresh] = useState(0);
    const epoch = useRef(0), lock = useRef(false), offset = useRef(0), draft = useRef(null);
    const alive = useRef(true);
    useEffect(()=>{alive.current=true;return ()=>{alive.current=false;epoch.current++}},[]);
    function enter(next) {
      epoch.current++;setError('');setActionError('');setGame(null);setPanel('home');select(next);
      refresh(n=>n+1);
    }
    useEffect(()=>{if(initialId) enter(initialId)},[initialId]);
    function receive(data) {
      offset.current=data.serverTime-Date.now();
      tick(data.serverTime);setGame(data);
    }
    useEffect(()=>{
      let live=true, timer, controller;
      async function poll() {
        controller=typeof AbortController==='function'?new AbortController():undefined;
        const seen=epoch.current;
        try {
          if (!document.hidden && !lock.current) {
            const data=await request(id,null,controller?.signal);
            if(live && !lock.current && seen===epoch.current) {
              if(id) receive(data);else setLobby(data);
              setError('');
            }
          }
        } catch(error) {
          if(live && seen===epoch.current && error.name!=='AbortError') setError(error.message);
        } finally {if(live) timer=setTimeout(poll,id?850:4500)}
      }
      poll();
      return ()=>{live=false;clearTimeout(timer);controller?.abort()};
    },[id,reload]);
    useEffect(()=>{
      if(!id) return;
      let live=true;
      request('',null).then(data=>{if(live)setLobby(data)}).catch(()=>{});
      return ()=>{live=false};
    },[id,game?.status]);
    useEffect(()=>{
      if(game?.status!=='active') return;
      const timer=setInterval(()=>tick(Date.now()+offset.current),160);
      return ()=>clearInterval(timer);
    },[game?.status]);

    const members=lobby?.members || [], me=Number(lobby?.slot);
    const member=slot=>members.find(m=>Number(m.slot)===Number(slot));
    const name=slot=>member(slot)?.name || '园友';
    function button(label,fn,style,disabled) {
      return h('button',{type:'button',className:'qz-button '+(style||''),disabled,onClick:fn},label);
    }
    const avatar=slot=>h('img',{className:'qz-avatar',alt:'',src:avatarFor(Number(slot))});
    async function act(action,extra={}) {
      if(lock.current) return;
      lock.current=true;setBusy(true);setError('');setActionError('');
      const seen=++epoch.current;
      let match=id;
      if(action==='invite') {
        if(!draft.current || draft.current.guest!==extra.guest) draft.current={guest:extra.guest,id:crypto.randomUUID()};
        match=draft.current.id;
      }
      try {
        const data=await request('',{action,id:match,...extra});
        if(!alive.current || epoch.current!==seen) return;
        if(action==='invite') {
          draft.current=null;select(match);setPanel('home');
        }
        receive(data);
      } catch(error) {
        if(alive.current && epoch.current===seen) setActionError(error.message || '暂时连不上对局，请重试');
      } finally {lock.current=false;if(alive.current)setBusy(false)}
    }
    function reference(label,url) {
      if (!/Android.+; wv\)/.test(navigator.userAgent)) return h('a',{href:url,target:'_blank',rel:'noreferrer'},label);
      return h('details',{className:'qz-source'},h('summary',null,label),
        h('input',{type:'url',readOnly:true,value:url,'aria-label':'长按复制来源链接',onFocus:event=>event.target.select()}));
    }
    function rankings(full) {
      let previous, place=0;
      const shown=full?members:members.slice(0,3);
      return h('section',{className:'qz-card qz-ranks'},
        h('header',null,h('h3',null,'本园排行'),!full&&button('查看全部',()=>setPanel('ranks'),'link')),
        shown.length?shown.map((m,i)=>{
          if(previous!==m.stars){place=i+1;previous=m.stars}
          return h('div',{className:'qz-row',key:m.slot},h('b',{className:'qz-place'},m.played?place:'—'),
            avatar(m.slot),h('span',null,m.name),h('small',null,m.played?rank(m.stars)+' · '+m.stars+' 星':'未参赛'));
        }):h('p',null,'正在读取园友排名…'));
    }
    function lobbyView() {
      if(panel==='ranks') return h(React.Fragment,null,rankings(true),button('回到大厅',()=>setPanel('home')));
      if(panel==='select') return h('section',{className:'qz-card'},h('h2',null,'挑战哪位园友？'),
        members.filter(m=>Number(m.slot)!==me).map(m=>h('div',{className:'qz-row',key:m.slot},
          avatar(m.slot),h('span',null,m.name),button('挑战',()=>act('invite',{guest:Number(m.slot)}),'peach',busy))),
        members.length<2&&h('p',null,'还没有其他园友。邀请朋友加入这个园后，就可以一起答题。'),
        button('回到大厅',()=>setPanel('home'),'link'));
      return h(React.Fragment,null,h('img',{className:'qz-hero',src:'/client/quiz-card-v7.webp',alt:'两只荔枝园小动物正在答题'}),
        h('p',{className:'qz-sub'},'5 道题 · 每题 10 秒 · 末题双倍'),
        button('挑战园友',()=>setPanel('select'),'primary',!lobby),button('本园排行',()=>setPanel('ranks'),'plain'),
        !!lobby?.invitations.length&&h('section',{className:'qz-card'},h('h3',null,'我的对局'),lobby.invitations.map(g=>
          h('div',{className:'qz-row',key:g.id},h('span',null,name(me===g.host?g.guest:g.host)),
            button(g.status==='active'?'继续答题':me===g.host?'等待应战':'查看邀请',()=>enter(g.id),'link')))),
        rankings(false));
    }
    function board(g, clock) {
      return h('div',{className:'qz-board'},clock,[g.host,g.guest].map((slot,i)=>
        h('div',{key:slot,className:'qz-player'},avatar(slot),h('span',null,name(slot)),h('strong',null,g.scores?.[i]??0))));
    }
    function matchView(g) {
      const other=g.side===0?g.guest:g.host;
      if(g.status==='cancelled') return h('section',{className:'qz-card'},h('h2',null,'邀请已结束'),button('回到大厅',()=>enter(''),'primary'));
      if(g.status==='pending') return h('section',{className:'qz-card qz-invite'},avatar(other),
        h('h2',null,g.side===1?name(other)+' 向你发起挑战':'等待 '+name(other)+' 应战'),
        h('p',null,g.side===1?'接受后，两个人会一起开始答题。':'园友可在本园聊天或头脑王者大厅看到邀请。'),
        h('p',{className:'qz-sub'},'5 道题 · 每题 10 秒 · 末题双倍'),
        g.chatDelivered===false&&h('p',null,'聊天卡片发送失败，园友仍可从大厅查看邀请。'),
        g.side===1&&button('应战',()=>act('accept'),'primary',busy),
        button(g.side===1?'谢绝邀请':'取消邀请',()=>act('cancel'),'plain',busy),
        button('回到大厅',()=>enter(''),'link',busy));
      if(g.status==='done') {
        const draw=g.winner===null, win=g.winner===g.side;
        return h(React.Fragment,null,h('img',{className:'qz-result-art',src:'/client/quiz-result-v7.webp',alt:''}),
          h('h2',{className:'qz-result-title'},draw?'平局':win?'挑战胜利':'本局惜败'),board(g),
          h('section',{className:'qz-card'},h('h3',null,'本局星数'),[g.host,g.guest].map((slot,i)=>{
            const delta=g.starChanges?.[i]??0;
            return h('div',{className:'qz-row',key:slot},h('span',null,name(slot)),h('b',null,(delta>0?'+':'')+delta+' 星'));
          }),draw&&h('p',{className:'qz-sub'},'双方同分，没有奖励。')),
          button('再来一局',()=>act('invite',{guest:other}),'primary',busy),
          button('查看本园排行',()=>{enter('');setPanel('ranks')},'plain',busy),
          h('details',{className:'qz-card qz-review'},h('summary',null,'回看本局五道题'),
            g.review?.map((q,i)=>h('section',{key:i},h('b',null,(i+1)+'．'+q.prompt),h('p',null,'答案：'+q.answer),
              h('p',null,q.explanation),q.source&&reference('原始来源',q.source),
              q.license&&h('small',null,'　'+(q.sourceAuthor?q.sourceAuthor+' · ':'')+q.license)))));
      }
      const revealed=g.phase==='reveal', ready=g.phase==='ready';
      const count=Math.max(0,Math.min(10,Math.ceil((g.deadline-time)/1000)));
      return h(React.Fragment,null,board(g,h('span',{className:'qz-clock','aria-label':'剩余 '+count+' 秒'},ready?'…':count+' 秒')),
        h('div',{className:'qz-round'},h('b',null,'第 '+(g.round+1)+' / 5 题'),
        h('span',null,g.round===4?'末题双倍':g.question?.categoryName||'准备答题')),
        h('section',{className:'qz-card qz-question'},h('h2',null,g.question?.prompt||'准备开局…'),
          g.question?.options.map((option,i)=>{
            const mode=revealed&&i===g.answer?'correct':i===g.myChoice?'selected':'';
            return h('button',{type:'button',className:'qz-option '+mode,key:i,disabled:busy || ready || revealed || count===0 || g.myChoice!==null,
              onClick:()=>act('answer',{round:g.round,choice:i})},h('b',null,letters[i]),h('span',null,option),mode==='correct'?'✓':'');
          })),
        h('div',{className:'qz-feedback','aria-live':'polite'},revealed?
          h(React.Fragment,null,h('b',null,[0,1].map(i=>name(i===0?g.host:g.guest)+' '+(g.picks[i]?letters[g.picks[i].choice]+' · +'+g.picks[i].points:'超时 · 0')+' 分').join('　')),
            h('p',null,g.explanation),g.source&&reference('题目出处',g.source)) :
          g.myChoice!==null?'已锁定，等待对方':ready?'两位园友已就位':count===0?'时间到，正在揭晓':'选出你的答案'));
    }
    return h('main',{className:'qz','aria-label':'头脑王者'},(err||actionError)&&h('div',{role:'alert',className:'qz-error'},err||actionError,
      button('重试',()=>refresh(n=>n+1),'link'),id&&button('回到大厅',()=>enter(''),'link')),
      id?(game?matchView(game):h('p',null,'正在读取对局…')):lobbyView(),
      h('footer',null,reference('题库来源与许可','https://github.com/z1807767180-pixel/Lychee/blob/main/docs/design/头脑王者题库来源.md')));
  }
  Quiz.chatCard = function (jsx,note) {
    const match=invitation.exec(note.body);
    if(!match) return note.body;
    return jsx('button',{type:'button',className:'qz-chat',onClick:()=>window.dispatchEvent(new CustomEvent('lychee:quiz-invitation',{detail:match[2]})),
      children:'头脑王者 · 邀请 '+match[1]+' 答五题　查看对局 ›'});
  };
  window.LycheeQuizV7=Quiz;
})();
