'use strict';
(() => {
  const bundle = document.currentScript?.dataset.app || document.body?.dataset.app;
  const app = document.getElementById('root');
  const hub = new EventTarget();
  const identity = typeof BroadcastChannel === 'function' ? new BroadcastChannel('lychee-account') : null;
  identity?.addEventListener('message', () => location.reload());
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  let state, overlay, card, message, trigger;
  let started = false, locked = false, dismissible = false, readSequence = 0;
  const idOf = v => v == null ? '' : String(v);
  const routeId = () => new URL(location.href).searchParams.get('garden');
  const member = id => state?.gardens.find(g => idOf(g.id) === idOf(id));
  const unread = () => state.notices.filter(n => !n.read);
  const owner = g => g.role === 'owner';

  async function request(path, payload) {
    const opts = {credentials:'same-origin', cache:'no-store', headers:{Accept:'application/json'}};
    if (payload) Object.assign(opts, {method:'POST',headers:{...opts.headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const r = await fetch(path, opts), data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = Error(typeof data.error === 'string' ? data.error : '操作未完成，请重试。'); e.status = r.status; throw e; }
    return data;
  }
  function apply(data) {
    if (!data?.account || !Array.isArray(data.gardens) || !Array.isArray(data.notices)) throw Error('园子资料未能加载，请重新连接。');
    if (started && state && idOf(state.account.id) !== idOf(data.account.id)) { location.reload(); throw Error('正在切换账号。'); }
    state = data;
    if (started) {
      const current=member(routeId());
      if (!current) { location.replace(location.pathname);return; }
      window.LycheeAccess.scope=Object.freeze({accountId:state.account.id,gardenId:current.id,gardenName:current.name,gardenSubtitle:current.subtitle});
    }
    hub.dispatchEvent(new Event('workspace'));
  }
  async function load() {
    const seq=++readSequence,data=await request('/api/v640/workspace');
    if (seq===readSequence) apply(data);
  }
  async function change(action, fields = {}) {
    readSequence++;
    const data = await request('/api/v640/workspace',{action,...fields});
    readSequence++;apply(data);return data;
  }

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function say(text, error = false) {
    if (!message) return;
    message.textContent = text; message.className = error ? 'ga-access-error' : 'ga-access-info'; message.hidden = !text;
  }
  async function task(fn) {
    if (locked) return;
    locked = true;
    const old = card;
    if (old) old.querySelectorAll('button').forEach(b => { b.disabled = true; });
    say('');
    try { await fn(); }
    catch (error) {
      if (error.status === 401 && state) { identity?.postMessage('changed'); location.reload(); return; }
      say(error.message === 'Failed to fetch' ? '连接中断，请检查网络后重试。' : error.message, true);
    } finally {
      locked = false;
      if (old && old === card) old.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }
  function button(text, fn, primary = false) {
    const b = el('button',text,primary ? 'ga-primary' : ''); b.type = 'button';
    b.addEventListener('click', () => task(fn)); return b;
  }
  function dismiss() {
    overlay?.remove(); overlay = card = message = null;
    if (app) app.inert = false;
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
    trigger = null; dismissible = false;
  }
  function frame(title, canClose = false) {
    if (!overlay) {
      trigger = document.activeElement; if (app) app.inert = true;
      overlay = el('section',null,'garden-access');
      overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-labelledby','ga-heading');
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dismissible && !locked) { e.preventDefault(); dismiss(); }
        if (e.key !== 'Tab') return;
        const nodes = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(n=>n.getClientRects().length);
        if (!nodes.length) return;
        if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement?.tagName === 'H1')) { e.preventDefault(); nodes.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault();nodes[0].focus(); }
      });
      document.body.append(overlay);
    }
    dismissible = canClose; card = el('div',null,'ga-card'); overlay.replaceChildren(card);
    const brand = el('div',null,'ga-brand'), icon = el('img'); icon.src='/mobile/icon.png'; icon.alt='';
    brand.append(icon,el('strong','荔枝园'));
    const heading=el('h1',title);heading.id='ga-heading';heading.tabIndex=-1;
    message=el('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.hidden=true;
    card.append(brand,heading,message);heading.focus({preventScroll:true});return card;
  }
  function actions(parent,...controls) { const line=el('div',null,'ga-actions');line.append(...controls);parent.append(line); }
  function field(form,label,name,type='text',autocomplete='off') {
    const wrap=el('label',label), input=el('input');input.name=name;input.type=type;input.required=true;input.autocomplete=autocomplete;
    wrap.append(input);form.append(wrap);return input;
  }
  function submit(form,name,fn) {
    const b=el('button',name,'ga-primary');b.type='submit';form.append(b);
    form.addEventListener('submit',e=>{e.preventDefault();task(fn);});
  }

  function auth(register=false) {
    state=undefined;const box=frame(register?'注册账号':'登录荔枝园'),form=el('form');
    const user=field(form,'用户名','username','text','username');user.autocapitalize='none';user.spellcheck=false;user.maxLength=14;
    const pass=field(form,'密码','password','password',register?'new-password':'current-password');pass.minLength=8;pass.maxLength=128;
    if(register)pass.placeholder='8–128 位';
    submit(form,register?'注册':'登录',async()=>{
      await request('/api/v640/account',{mode:register?'register':'login',name:user.value.trim(),password:pass.value});
      pass.value=''; identity?.postMessage('changed'); await bootstrap();
    });
    box.append(form);actions(box,button(register?'已有账号，去登录':'注册新账号',()=>auth(!register)));
  }
  async function logout() {
    await request('/api/v640/account',{mode:'logout'});identity?.postMessage('changed');location.replace(location.pathname);
  }
  function navigate(id,openRoom) {
    if (!member(id)) throw Error('当前账号无法进入这个园子。');
    const url=new URL(location.href);url.searchParams.set('garden',idOf(id));url.hash='';
    if (openRoom) sessionStorage.setItem('lychee.openRoom',JSON.stringify([idOf(state.account.id),idOf(id)]));
    if (url.href===location.href) location.reload(); else location.replace(url.href);
  }
  async function select(g,openRoom=false) { await change('switch',{gardenId:g.id});navigate(g.id,openRoom); }
  function gardenForm(kind,fromApp) {
    const create=kind==='create',box=frame(create?'创建私密园':'加入私密园',fromApp),form=el('form');
    const input=field(form,create?'园子名称':'园子邀请码',create?'gardenName':'inviteCode');
    let subtitle;
    if (create) {
      input.maxLength=40;
      subtitle=field(form,'小标签（选填）','subtitle');
      subtitle.required=false;subtitle.maxLength=80;
    } else { input.autocapitalize='none';input.spellcheck=false; }
    submit(form,create?'创建并进入':'加入并进入',async()=>{
      const data=await change(kind,create?{name:input.value.trim(),subtitle:subtitle.value.trim()}:{code:input.value.trim()});
      if (!member(data.activeGardenId)) throw Error('已提交，请返回园子列表查看。');
      navigate(data.activeGardenId,false);
    });
    box.append(form);actions(box,button('返回园子列表',()=>gardens(fromApp)));
  }
  async function invite(g,fromApp) {
    const box=frame('邀请成员',fromApp),info=el('div');
    box.append(el('p',g.name),info);
    actions(box,button('返回园子列表',()=>gardens(fromApp)));
    function show(codeValue,replaced=false) {
      if (!codeValue) throw Error('没有收到邀请码，请重试。');
      const code=el('code',codeValue,'ga-invite-code');code.tabIndex=0;
      info.replaceChildren(el('p','朋友可在「加入私密园」里输入这个码。多人可以使用同一个码。'),code);
      const controls=[];
      if(navigator.clipboard?.writeText) controls.push(button('复制邀请码',async()=>{await navigator.clipboard.writeText(codeValue);say('已复制邀请码');}));
      controls.push(button('更换邀请码',()=>{
        info.replaceChildren(el('p','换码后，原邀请码立即失效。已加入的成员可以继续使用园子。'));
        actions(info,button('确认换码',async()=>{
          const data=await change('rotateInvite',{gardenId:g.id});show(data.inviteCode,true);
        },true),button('保留原码',()=>show(codeValue)));
      }));
      actions(info,...controls);if(replaced)say('邀请码已更换');
    }
    try { const data=await change('invite',{gardenId:g.id});if(box===card)show(data.inviteCode); }
    catch(error){if(box===card){say(error.message,true);actions(info,button('重试',()=>invite(g,fromApp)));}}
  }
  function gardens(fromApp=started,note='') {
    const box=frame('我的私密园',fromApp);box.append(el('p',state.account.username));
    if(note) say(note);
    if(!state.gardens.length)box.append(el('p','还没有加入园子。可以创建自己的私密园，或使用朋友的邀请码加入。'));
    for(const g of state.gardens){
      const line=el('div',null,'ga-garden-row'),name=el('strong',g.name);
      name.append(el('small',owner(g)?'园主':'成员'));line.append(name);
      if(started&&idOf(g.id)===routeId())line.append(button('返回当前园',dismiss));
      else line.append(button('进入',()=>select(g)));
      line.append(button('邀请成员',()=>invite(g,fromApp)));
      box.append(line);
    }
    actions(box,button('创建私密园',()=>gardenForm('create',fromApp),true),button('加入私密园',()=>gardenForm('join',fromApp)));
    actions(box,...(fromApp?[button('返回应用',dismiss)]:[]),button('退出账号',logout));
  }
  function notices(required) {
    const box=frame('账号公告',!required&&started),items=required?unread():state.notices;
    if(!items.length)box.append(el('p','暂无公告。'));
    for(const n of items){
      const row=el('article',null,'ga-notice');row.append(el('h2',n.title),el('p',n.body));
      if(n.read)row.append(el('small','已读'));
      else row.append(button('标为已读',async()=>{
        await change('read',{noticeId:n.id});
        if(required&&!unread().length)await enter();else notices(required);
      },true));
      box.append(row);
    }
    if(!required)actions(box,button('返回应用',dismiss));else actions(box,button('退出账号',logout));
  }
  async function enter(){
    if(unread().length){notices(true);return;}
    const chosen=routeId();
    if(!chosen){if(member(state.activeGardenId))navigate(state.activeGardenId,false);else gardens(false);return;}
    const g=member(chosen);
    if(!g){gardens(false,'当前账号未加入此园，请选择自己的园子。');return;}
    if(!['/mobile/phone.js','/windows/phone.js'].includes(bundle))throw Error('客户端启动入口缺失。');
    dismiss();if(started)return;
    started=true;window.LycheeAccess.scope=Object.freeze({accountId:state.account.id,gardenId:g.id,gardenName:g.name,gardenSubtitle:g.subtitle});
    const script=el('script'),build=document.body.dataset.clientBuild;
    script.src=build?bundle+'?v='+encodeURIComponent(build):bundle;
    script.onerror=()=>{started=false;frame('未能加载荔枝园');actions(card,button('重新加载',()=>location.reload(),true));};
    document.head.append(script);
  }
  async function bootstrap(){
    try{await load();await enter();}
    catch(error){
      if(error.status===401){auth();return;}
      const box=frame('暂时无法连接荔枝园');say(error.message||'请检查网络连接。',true);
      actions(box,button('重新连接',bootstrap,true));
    }
  }
  async function openPanel(kind){
    const title=kind==='gardens'?'我的私密园':'账号公告';
    const box=frame(title,started);
    if(started)actions(box,button('返回应用',dismiss));
    await task(async()=>{await load();if(kind==='gardens')gardens(started);else notices(false);});
  }
  const openGardens=()=>openPanel('gardens'),openAnnouncement=()=>openPanel('notice');
  function GardenCard({React,g,open,renderCover}){
    const h=React.createElement, current=idOf(g.id)===routeId();
    const [draft,setDraft]=React.useState(null), [error,setError]=React.useState(''), [busy,setBusy]=React.useState(false);
    const pending=React.useRef(false);
    const [cover,setCover]=React.useState(()=>{
      try{return current?window.LycheeBusiness.localStorage.getItem('my-circle-cover')||'':'';}catch{return '';}
    });
    function enterRoom(){if(current)open();else{gardens(true);task(()=>select(g,true));}}
    function edit(){setError('');setDraft({name:g.name,subtitle:g.subtitle||'',revision:g.revision});}
    async function save(e){
      e.preventDefault();if(pending.current||!draft||!draft.name.trim())return;
      const name=draft.name.trim(), subtitle=draft.subtitle.trim();
      if(name===g.name&&subtitle===(g.subtitle||'')){setDraft(null);return;}
      pending.current=true;setBusy(true);setError('');
      try{await change('edit',{gardenId:g.id,name,subtitle,revision:draft.revision});setDraft(null);}
      catch(failure){setError(failure.message);if(failure.status===409)await load().catch(()=>{});}
      finally{pending.current=false;setBusy(false);}
    }
    function fieldLine(key,label,limit){
      return h('label',null,label,
        h('input',{'aria-label':label,placeholder:label,maxLength:limit,value:draft[key],required:key==='name',
          disabled:busy,autoFocus:key==='name',onChange:e=>setDraft({...draft,[key]:e.target.value})}));
    }
    const details=draft?
      h('form',{onSubmit:save,className:'ga-card-form'},
        fieldLine('name','圈名',40),fieldLine('subtitle','小标签',80),
        h('div',{className:'ga-card-actions'},
          h('button',{type:'submit',className:'ga-enter-room',disabled:busy||!draft.name.trim()},'保存'),
          h('button',{type:'button',className:'ga-quiet',disabled:busy,onClick:()=>{setDraft(null);setError('');}},'取消')),
        error&&h('small',{role:'alert'},error)):
      h('div',{className:'ga-card-info'},
        h('div',{className:'ga-card-heading'},
          h('h3',{className:'circle-name-line'},g.name),
          h('button',{className:'ga-edit circle-edit-action',type:'button','aria-label':'编辑'+g.name,onClick:edit},'编辑')),
        g.subtitle&&h('p',{className:'circle-sub-line'},g.subtitle),
        h('div',{className:'ga-card-actions'},
          h('button',{type:'button',className:'ga-enter-room',onClick:enterRoom},'进入圈子',h('span',{'aria-hidden':true},'→')),
          h('button',{type:'button',className:'ga-invite',onClick:()=>invite(g,true)},'邀请成员')));

    return h('article',{className:'ga-circle-entry','aria-label':g.name},
      h('div',{className:'ga-card-layout'},
        h('div',{className:'ga-art'},
          h('button',{type:'button',className:'ga-photo circle-picture','aria-label':'进入'+g.name,onClick:enterRoom},
            h('img',{className:'circle-banner',src:cover?'data:image/jpeg;base64,'+cover:'/mobile/break-room.webp',alt:''})),
          current&&h('small',{className:'ga-current'},'当前园'),
          current&&renderCover&&h('div',{className:'ga-cover-action a62-circle-cover'},renderCover({
            title:'生成圈子封面',prompt:'荔枝园风格的温馨圈子封面：'+g.name+' '+(g.subtitle||''),
            onApply:async picture=>{window.LycheeBusiness.localStorage.setItem('my-circle-cover',picture);setCover(picture);}
          }))),
        details));
  }
  function AddCircle({React}){
    const h=React.createElement,ref=React.useRef(null);
    const [expanded,setExpanded]=React.useState(false);
    React.useEffect(()=>{
      if(!expanded)return;
      const outside=e=>{if(!ref.current?.contains(e.target))setExpanded(false);};
      const escape=e=>{if(e.key==='Escape'){setExpanded(false);ref.current?.firstElementChild?.focus();}};
      document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
      return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
    },[expanded]);
    function option(label,fn){return h('button',{type:'button',onClick:()=>{setExpanded(false);ref.current?.firstElementChild?.focus();fn();}},label);}
    return h('div',{className:'ga-add',ref},
      h('button',{type:'button',className:'ga-add-trigger','aria-expanded':expanded,onClick:()=>setExpanded(!expanded)},
        h('span',{'aria-hidden':true},'＋'),'添加圈子'),
      expanded&&h('div',{className:'ga-add-panel'},
        option('创建私密园',()=>gardenForm('create',true)),option('加入私密园',()=>gardenForm('join',true)),option('管理园子',openGardens)));
  }
  function CircleList({React,open,renderCover}){
    const h=React.createElement;
    const [,rerender]=React.useReducer(n=>n+1,0);
    React.useEffect(()=>{
      const fn=()=>rerender();
      // A caption draft retains the revision opened by its editor.
      const refresh=()=>{if(!document.hidden&&!locked)load().catch(error=>{if(error.status===401)location.reload();});};
      const tick=setInterval(refresh,15000);
      hub.addEventListener('workspace',fn);window.addEventListener('focus',refresh);
      return()=>{clearInterval(tick);hub.removeEventListener('workspace',fn);window.removeEventListener('focus',refresh);};
    },[]);
    React.useEffect(()=>{
      let intent;try{intent=JSON.parse(sessionStorage.getItem('lychee.openRoom'));}catch{}
      if(Array.isArray(intent)&&intent[0]===idOf(state.account.id)&&intent[1]===routeId()){sessionStorage.removeItem('lychee.openRoom');open();}
    },[open]);
    return h('section',{className:'ga-circle-list','aria-label':'我的圈子'},
      h('header',{className:'ga-collection-heading'},h('h2',null,'我的圈子'),h(AddCircle,{React})),
      h('div',{className:'ga-cards'},state.gardens.map(g=>h(GardenCard,{key:g.id,React,g,open,renderCover}))));
  }
  function exitFromSettings(){
    const box=frame('退出账号',true);actions(box,button('重试',logout),button('返回应用',dismiss));
    return task(logout);
  }
  window.LycheeAccess={openGardens,openAnnouncement,logout:exitFromSettings,renderCircles:(React,{open,renderCover})=>React.createElement(CircleList,{React,open,renderCover}),scope:null};
  frame('连接荔枝园');bootstrap();
})();
