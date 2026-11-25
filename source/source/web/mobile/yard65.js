window.createYard65 = function(React) {
  const h=React.createElement,{useEffect,useRef,useState}=React;
  const names=['小树苗','小树苗','长枝叶','长枝叶','开花','开花','结果','结果'];
  const sideName=side=>side==='right'?'右枝':'左枝';
  const asset=(key,props={})=>h('img',{src:'/mobile/yard65-'+key+'.webp',alt:'',draggable:false,...props});
  const button=(label,fn,cls='yard-btn',extra={})=>h('button',{type:'button',className:cls,onClick:fn,...extra},label);
  async function request(body) {
    const response=await fetch('/api/phone?v62=yard',{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'v62-yard',...body})}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'小院暂时连不上');
    return data;
  }
  return function Yard({me,members=[],back,tree:legacy}) {
    const [s,set]=useState(null),[panel,show]=useState(''),[side,choose]=useState('left');
    const [treeName,nameTree]=useState(''),[recipient,chooseRecipient]=useState(''),[note,write]=useState(''),[splash,setSplash]=useState(0);
    const [selected,selectFruit]=useState(null),[letter,setLetter]=useState(null),[msg,tell]=useState(''),[busy,setBusy]=useState(false);
    const lock=useRef(false),generation=useRef(0),card=useRef(null),alive=useRef(true);
    const who=id=>members.find(x=>x.id===id)?.name || (id===me?'我':'园友');
    async function reload() {
      const seq=++generation.current;
      try {const data=await request();if(alive.current && !lock.current && generation.current===seq)set(data);}
      catch(e){if(alive.current && generation.current===seq)tell(e.message);}
    }
    useEffect(()=>{
      alive.current=true;reload();
      const update=()=>{if(!document.hidden&&!lock.current)reload();};
      const timer=setInterval(update,45000);
      document.addEventListener('visibilitychange',update);
      return ()=>{alive.current=false;generation.current++;clearInterval(timer);document.removeEventListener('visibilitychange',update);};
    },[me]);
    const opener=useRef(null);
    useEffect(()=>{
      if(panel)card.current?.focus({preventScroll:true});
      else if(opener.current?.isConnected)opener.current.focus({preventScroll:true});
    },[panel]);
    async function act(action,params={},success='',next='') {
      if(lock.current)return;
      lock.current=true;generation.current++;setBusy(true);tell('');
      try {
        const data=await request({action,...params});
        if(!alive.current)return;
        set(data.state||data);
        if(action==='water')setSplash(n=>n+1);
        if(action==='open')setLetter(data.letter);
        if(action==='pick'){selectFruit({crop:params.crop,slot:params.slot});write('');}
        show(next);tell(success);
      } catch(e){if(alive.current)tell(e.message);lock.current=false;if(alive.current)await reload();}
      finally {lock.current=false;if(alive.current)setBusy(false);}
    }
    const nav=h('header',{className:'yard-nav'},button('←',back,'yard-back',{'aria-label':'返回'}),h('h2',null,'荔枝树'),s&&h('p',{className:'yard-stage'},'第 '+s.day+' 天 · '+names[s.stage]));
    if(!s)return h('section',{className:'yard65'},nav,h('div',{className:'yard-card'},msg||'正在走进小院…',msg&&button('重试',reload)));
    const ripe=s.fruit.filter(f=>f.ripe&&!f.picked);
    const unread=s.inbox.filter(f=>f.opened==null).length;
    const myRibbon=s.ribbons.find(r=>r.member===me);
    const freeSides=['left','right'].filter(x=>!s.ribbons.some(r=>r.value===x));
    const canTie=s.stage>=2 && !myRibbon && freeSides.length>0;
    const wing=s.stage===5;
    const humanRecipients=members.filter(x=>x.id!==me);
    const target=humanRecipients.some(x=>x.id===recipient)?recipient:humanRecipients[0]?.id;
    const held=s.held.find(f=>selected && f.crop===selected.crop&&f.slot===selected.slot)||s.held[0];
    const main=(text,fn,disabled=false)=>button(text,fn,'yard-main',{disabled:busy||disabled});
    const link=(text,fn)=>button(text,fn,'yard-link',{disabled:busy});
    const change=p=>{if(!panel&&p)opener.current=document.activeElement;show(p);tell('');};
    const firstSlot=()=>{if(ripe.length){const f=ripe[0];act('pick',{crop:s.crop,slot:f.slot},'','gift');}};
    const water=()=> s.stage>=2 ? change('water') : act('water',{side:'left'},'泥土湿润了，嫩叶轻轻舒展开。');
    const midText=r=>r.kind==='photo'?'拍到了花期的蝴蝶':r.kind==='ribbon'?'给'+sideName(r.value)+'系了布带':'给'+sideName(r.value)+'浇了水';
    const historyText=r=>r.kind==='water'&&s.stage<2?'给小树浇了水':midText(r);
    const pickButtons=s.stage>=6?s.fruit.filter(f=>!f.picked).map(f=>{
      const x=f.side==='left'?(f.slot===3?37:28):(f.slot===3?63:72);
      const y=f.slot===3?47:38;
      return button(asset(f.ripe?'red':'green'),()=>act('pick',{crop:s.crop,slot:f.slot},'','gift'),'yard-prop yard-fruit '+(f.ripe?'is-ripe':''),{key:'f'+f.slot,disabled:busy||!f.ripe,'aria-label':sideName(f.side)+(f.ripe?'，摘一颗熟荔枝':'，青荔枝'),style:{left:x+'%',top:y+'%'}});
    }):null;
    const care=()=>{
      if(ripe.length)return firstSlot();
      if(wing&&!s.photo)return change('photo');
      if(canTie){choose(freeSides[0]);return change('tie');}
      if(!s.watered)return water();
      if(!s.name)return change('name');
    };
    const careLabel=ripe.length?'摘熟果':wing&&!s.photo?'拍蝴蝶':canTie?'系布带':!s.watered?'浇水':!s.name?'挂树牌':'已浇水';
    const latest=s.records[0]?who(s.records[0].member)+historyText(s.records[0]):s.name?who(s.namedBy)+'挂上了「'+s.name+'」的树牌':'小苗刚栽好，等第一壶水。';
    const scene=h('div',{className:'yard-scene'},
      asset('stage'+s.stage,{className:'yard-land',alt:names[s.stage]+'时的小院，桌上摆着水壶、竹篮和手记'}),
      nav,
      s.name? h('span',{className:'yard-sign',title:s.name},s.name):button('取名',()=>change('name'),'yard-sign',{disabled:busy,'aria-label':'挂上树牌'}),
      ...s.ribbons.map(r=>asset('ribbon',{key:r.value,className:'yard-prop yard-ribbon '+r.value,title:who(r.member)+'扶的'+sideName(r.value)})),
      pickButtons,wing&&button(asset('butterfly'),()=>change('photo'),'yard-prop yard-butterfly',{'aria-label':'花间的蝴蝶'}),
      button(null,water,'yard-hit yard-can',{disabled:busy||s.watered,'aria-label':'给树浇水'}),
      splash>0&&h('span',{key:splash,className:'yard-splash','aria-hidden':true},'﹆ ﹆ ﹆'),
      button(h(React.Fragment,null,(s.inbox.length>0||s.held.length>0)&&h('span',{className:'yard-basketfruit'},asset('red'),s.inbox.length>0&&h('i',null,'✉')),h('span',{className:'yard-tag'},'竹篮'),unread>0&&h('b',{className:'yard-badge'},unread)),
        ()=>change('basket'),'yard-hit yard-basket '+(unread?'unread':''),{'aria-label':'我的竹篮'+(unread?'，有未读留言':''),'aria-expanded':panel==='basket'}),
      button(h('span',{className:'yard-tag'},'手记'),()=>change('records'),'yard-hit yard-notebook',{'aria-label':'翻开照料手记','aria-expanded':panel==='records'}),
      button(careLabel,care,'yard-glaze',{disabled:busy||careLabel==='已浇水'}));
    let controls;
    const close=()=>change('');
    const title=t=>h('div',{className:'yard-cardtitle'},h('h3',null,t),link('收起',close));
    const sideRow=(available)=>h('div',{className:'yard-sides'},['left','right'].map(x=>button(sideName(x),()=>choose(x),'yard-btn',{key:x,'aria-pressed':side===x,disabled:busy||!available.includes(x)})));
    if(panel==='name')controls=h(React.Fragment,null,title('给这棵小树取名'),h('input',{maxLength:12,value:treeName,onChange:e=>nameTree(e.target.value),placeholder:'例如：小满','aria-label':'树名'}),main('挂上树牌',()=>act('name',{value:treeName},'树牌挂好了。'),!treeName.trim()));
    else if(panel==='water'||panel==='tie'){
      const tie=panel==='tie';
      controls=h(React.Fragment,null,title(tie?'选一根枝条系上布带':'今天照料哪根枝？'),sideRow(tie?freeSides:['left','right']),main(tie?'系好布带':'给这根枝浇水',()=>act(tie?'ribbon':'water',{side},tie?'你的布带会一直留在这里。':'水珠沿着叶尖落了下来。'),tie&&!freeSides.includes(side)));
    }else if(panel==='photo')controls=h(React.Fragment,null,title('今天的小访客'),s.photo?h('p',null,who(s.photo)+'已经把蝴蝶留在了照料记录里。'):main('拍下来',()=>act('photo',{crop:s.crop},'蝴蝶的小像已存进照料记录。')));
    else if(panel==='gift' && held)controls=h(React.Fragment,null,title('送一颗荔枝'),
      h('label',null,'送给 ',h('select',{value:target||'',onChange:e=>chooseRecipient(e.target.value),disabled:busy},humanRecipients.map(m=>h('option',{key:m.id,value:m.id},m.name)))),
      h('textarea',{value:note,maxLength:120,rows:2,onChange:e=>write(e.target.value),placeholder:'在纸签上写句话…','aria-label':'纸签留言'}),
      main('系好纸签，送出',()=>act('send',{crop:held.crop,slot:held.slot,to:target,note},'留言荔枝已放进朋友的竹篮。'),!note.trim()||!target),
      link('自己先留着',()=>{close();tell('熟果收在你的竹篮里。');}));
    else if(panel==='basket')controls=h(React.Fragment,null,title('我的竹篮'),
      s.held.length>0&&main('给摘下的荔枝系纸签（'+s.held.length+'）',()=>{selectFruit(s.held[0]);write('');change('gift');}),
      !s.inbox.length&&!s.held.length&&h('p',null,'竹篮空着，等一颗荔枝。'),
      ...s.inbox.map(f=>button((f.opened==null?'✦ ':'')+who(f.picker)+' 留给你'+(f.opened==null?' · 拆纸签':' · 再读'),()=>act('open',{crop:f.crop,slot:f.slot},'','letter'),'yard-letterrow',{key:f.crop+':'+f.slot,disabled:busy})));
    else if(panel==='letter'&&letter)controls=h(React.Fragment,null,h('small',null,who(letter.picker)+' 留给你'),h('blockquote',null,letter.note),link('收起纸签',()=>change('basket')));
    else if(panel==='records'){
      const day=ms=>Math.floor((ms+28800000)/86400000),today=day(Date.now()),groups=new Map();
      for(const r of s.records){const k=day(r.at);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
      const dateLabel=k=>k===today?'今天':k===today-1?'昨天':new Date(k*86400000).toISOString().slice(0,10).replaceAll('-','.');
      controls=h(React.Fragment,null,title('照料手记'),
        ...Array.from(groups,([k,items])=>h('section',{key:k,className:'yard-day'},h('b',null,dateLabel(k)),...items.map(r=>h('p',{key:r.kind+':'+r.at+':'+r.member},h('strong',null,who(r.member)),historyText(r))))),
        s.namedBy&&h('p',{className:'yard-signentry'},who(s.namedBy)+'挂上了「'+s.name+'」的树牌'),
        !s.records.length&&!s.name&&h('p',null,'手记还空着。浇下第一壶水，这里就有了第一行。'),
        s.photo&&h('details',null,h('summary',null,'花期留影'),h('figure',{className:'yard-memory'},asset('stage5'),asset('butterfly'),h('figcaption',null,who(s.photo)+'拍下的花间访客'))),
        legacy&&legacy.age>0&&h('details',null,h('summary',null,'上一棵树的记录'),h('p',null,'树龄 '+legacy.age+' 天 · 已摘 '+legacy.picked+' 颗'),legacy.received&&h('p',null,'上次收到 '+who(legacy.received.sender)+' 送的荔枝')));
    }
    return h('section',{className:'yard65','data-stage':s.stage},scene,
      button(h(React.Fragment,null,h('i',{'aria-hidden':true},'❧'),h('span',null,msg||latest)),()=>change('records'),'yard-latest',{'aria-label':'最新照料：'+(msg||latest)+'，翻开手记'}),
      panel&&h('div',{ref:card,role:'region',tabIndex:-1,onKeyDown:e=>{if(e.key==='Escape')close();},className:'yard-card '+(panel==='records'?'yard-log':'')+(panel==='letter'?' yard-paper':''),'aria-label':panel==='records'?'照料手记':'庭院操作'},
        h('div',{className:'yard-page',key:panel},controls,msg&&h('small',{role:'status'},msg))));
  };
};

