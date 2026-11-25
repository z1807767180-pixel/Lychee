'use strict';

// Original business bundles call these helpers after the membership gate has mounted.
window.LycheeBusiness = (() => {
  function scope() {
    const active = window.LycheeAccess?.scope;
    if (!active?.accountId || !active?.gardenId) throw Error('请先登录并选择圈子');
    return active;
  }
  function api(path) {
    const {accountId, gardenId} = scope();
    return '/g/' + encodeURIComponent(gardenId) + '/api/for/' + encodeURIComponent(accountId) + path.slice(4);
  }
  function store(area) {
    function key(name) {
      const {accountId, gardenId} = scope();
      return 'lychee.v640.' + encodeURIComponent(accountId) + '.' + encodeURIComponent(gardenId) + '.' + name;
    }
    return {
      getItem(name) { return window[area].getItem(key(name)); },
      setItem(name, value) { window[area].setItem(key(name), value); },
      removeItem(name) { window[area].removeItem(key(name)); }
    };
  }
  const aiActions=new Set(['v62-chat','v62-assist','v62-image']);
  async function performAi(body,send){
    if(!aiActions.has(body?.type))return send(body);
    if(body.type==='v62-image' && body.requestId)return send(body);
    const active=scope();
    const bytes=new TextEncoder().encode(JSON.stringify([active.accountId,active.gardenId,body]));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const key='lychee.ai-request.'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    const requestId=window.sessionStorage.getItem(key)||crypto.randomUUID();
    window.sessionStorage.setItem(key,requestId);
    try{
      const result=await send({...body,requestId});
      window.sessionStorage.removeItem(key);
      return result;
    }catch(error){
      if(error.newAiRequest)window.sessionStorage.removeItem(key);
      throw error;
    }
  }
  function quotaLabel(status,kind){
    const name=kind==='image'?'生图':'问答',unit=kind==='image'?'张':'次';
    const limit=Number(status?.limits?.[kind]);
    if(!Number.isFinite(limit))return '正在读取额度…';
    const remaining=status.remaining?.[kind]??Math.max(0,limit-(status.used?.[kind]||0));
    return remaining?'今日'+name+'剩余 '+remaining+' / '+limit+' '+unit:'今日'+name+'额度已用完，北京时间零点恢复';
  }

  // Each submitted job has its own marker. Separate tabs never overwrite one another.
  function imageMarkers(){
    const {accountId,gardenId}=scope();
    const prefix='lychee.image-job.'+encodeURIComponent(accountId)+'.'+encodeURIComponent(gardenId)+'.';
    return {
      pending(){
        return Object.keys(localStorage).filter(k=>k.startsWith(prefix))
          .sort((a,b)=>Number(localStorage[b])-Number(localStorage[a])).map(k=>k.slice(prefix.length));
      },
      add(id){localStorage.setItem(prefix+id,String(Date.now()));},
      remove(id){localStorage.removeItem(prefix+id);}
    };
  }

  function useImageJob(React,request,onReady,onChange){
    const {useState,useRef,useEffect}=React;
    const [markers]=useState(imageMarkers);
    const [job,setJob]=useState(()=>{
      const id=markers.pending()[0];
      return id?{id,state:'lookup'}:null;
    });
    const current=useRef(job), mounted=useRef(false), callbacks=useRef(null);
    callbacks.current={onReady,onChange};
    function change(next){current.current=next;setJob(next);}
    function matches(id){return mounted.current && current.current?.id===id;}
    function accept(id,data){
      if(!matches(id))return;
      if(data?.id && (!data.state||data.state==='ready')){
        change(null);
        callbacks.current.onReady(data);
        markers.remove(id);
        callbacks.current.onChange();
      }else if(data?.state==='refunded'){
        change({id,state:'refunded'});
        callbacks.current.onChange();
      }else if(data?.state==='pending'||data?.state==='missing'){
        change({id,state:data.state,delay:Math.min(30000,Math.max(2000,Number(data.retryAfterMs)||5000))});
      }else{
        change({id,state:'unknown'});
      }
    }
    useEffect(()=>{
      mounted.current=true;
      return ()=>{mounted.current=false;};
    },[]);
    useEffect(()=>{
      if(!job || ['refunded','declined'].includes(job.state))return;
      let active=true,timer;
      async function check(){
        try{
          const answer=await request('?v62=image-status&requestId='+encodeURIComponent(job.id));
          if(active && current.current===job)accept(job.id,answer);
        }catch{
          if(active&&current.current===job&&matches(job.id))change({id:job.id,state:'offline',delay:15000});
        }
      }
      if(!['unknown','missing'].includes(job.state))timer=setTimeout(check,job.state==='lookup'?0:job.delay||3500);
      return ()=>{active=false;clearTimeout(timer);};
    },[job]);
    useEffect(()=>{
      const online=()=>{const j=current.current;if(j&&!['refunded','declined'].includes(j.state))change({id:j.id,state:'lookup'});};
      window.addEventListener('online',online);
      return ()=>window.removeEventListener('online',online);
    },[]);
    async function start(body){
      if(current.current)return;
      const id=crypto.randomUUID();
      markers.add(id);
      change({id,state:'sending'});
      try{
        const answer=await request('',{...body,requestId:id});
        if(!matches(id))return;
        if(!answer?.id&&!answer?.state)change({id,state:'lookup'});
        else accept(id,answer);
      }
      catch(error){
        if(!matches(id))return;
        if(error.aiState==='refunded'||error.newAiRequest)accept(id,{state:'refunded'});
        else if([400,401,403,404,413,415,422,429].includes(error.status)||
          (error.status===503&&/未配置|未启用|未开通|尚未就绪/.test(error.message))){
          markers.remove(id);
          change({id,state:'declined',message:error.message});
        }
        else change({id,state:'lookup'});
      }
    }
    function dismiss(){
      if(!current.current)return;
      markers.remove(current.current.id);
      resume();
    }
    function resume(){const id=markers.pending()[0];change(id?{id,state:'lookup'}:null);}
    return {job,start,resume,dismiss,remaining:()=>markers.pending().length,
      check(){const j=current.current;if(j)change({id:j.id,state:'lookup'});}};
  }

  function imageJobPanel(React,handle,history){
    const {job}=handle;
    if(!job)return null;
    const h=React.createElement;
    const messages={
      sending:'正在提交生图任务，可以离开页面，回来后继续查看。',
      lookup:'正在查询上一次生图结果…',
      pending:'正在生图，可以离开页面。查询进度不会再次生成或扣次数。',
      offline:'暂时连不上服务。恢复连接后会继续查询原任务，不会重新生图。',
      missing:'暂未查到这次任务。可以稍后再查，也可以在生成记录中查看已完成的图片。',
      unknown:'服务暂未提供这次任务的进度，请到生成记录中查看。',
      refunded:'这次生图未完成，次数已退回。可以重新编辑后发起新任务。',
      declined:job.message
    };
    const btn=(name,action)=>h('button',{type:'button',className:'a624-chip',onClick:action},name);
    const terminal=['refunded','declined'].includes(job.state);
    return h('section',{className:'a62-history'},h('p',{role:'status'},messages[job.state]),
      h('div',{className:'a624-more'},
        !terminal&&btn('查询生图结果',handle.check),btn('◷ 生成记录',history),
        (terminal||['missing','unknown'].includes(job.state))&&btn(terminal?'返回编辑':'结束本次查询',handle.dismiss)));
  }

  function OriginalImage({React,src,download,onClose}){
    const h=React.createElement,dialog=React.useRef(null);
    React.useEffect(()=>{const el=dialog.current;el.showModal();return ()=>{if(el.open)el.close();};},[]);
    return h('dialog',{ref:dialog,'aria-label':'查看原图',onCancel:e=>{e.preventDefault();onClose();},
      style:{width:'min(94vw, 1040px)',maxWidth:'94vw',maxHeight:'92dvh',padding:'10px',boxSizing:'border-box',border:'1px solid #cfbda5',borderRadius:'16px',background:'#fffaf1'}},
      h('div',{className:'a62-heading'},h('b',null,'原图'),h('button',{type:'button',className:'a624-chip',onClick:onClose},'关闭原图')),
      h('img',{src,alt:'生成的原图',style:{display:'block',width:'100%',height:'auto',maxHeight:'68dvh',objectFit:'contain'}}),
      h('a',{className:'a624-chip',href:download,download:'lychee-image.jpg'},'↓ 保存图片'));
  }
  return {api,performAi,quotaLabel,useImageJob,imageJobPanel,OriginalImage,localStorage:store('localStorage'),sessionStorage:store('sessionStorage')};
})();
