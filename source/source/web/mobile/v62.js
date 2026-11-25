/* Mobile AI tools. Private authenticated server routes; no provider identifiers in UI. */
window.createGarden62=function(React,compress){
const h=React.createElement,{useState,useEffect,useRef}=React;
const art=(name,props={})=>h('img',{src:'/mobile/ai-'+name+'.webp',alt:'',...props});
const btn=(label,onClick,cls='a62-button',extra={})=>h('button',{type:'button',className:cls,onClick,...extra},label);
const api=async(query='',body)=>{let r=await fetch('/api/phone'+query,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(240000)});let x=await r.json().catch(()=>({}));if(!r.ok)throw Error(x.error||'暂时无法连接，请稍后重试');return x};
const imgUrl=(id,download=false)=>'/api/phone?v62=image&id='+encodeURIComponent(id)+(download?'&download=1':'');
const ai=async(prompt)=>(await api('',{type:'v62-assist',prompt})).reply;
const styles=['清新生活','唯美风景','温暖插画','可爱治愈','自由创作'];
function useStatus(){const [s,S]=useState(null);const refresh=()=>api('?v62=status').then(S).catch(()=>{});useEffect(()=>{refresh()},[]);return[s,refresh]}
function Quota({status,kind}){return status?h('small',{className:'a62-quota'},status[kind]?'今日剩余 '+Math.max(0,status.limits[kind]-(status.used[kind]||0))+' '+(kind==='image'?'张':'次'):'服务暂未配置'):null}
function Tools({open}){return h('div',{className:'a62-tools'},art('tools-hero',{className:'a62-tools-hero'}),h('div',{className:'a62-tools-intro'},h('h2',null,'实用小工具'),h('p',null,'让生活更轻松一点 ♡')),h('div',{className:'a62-toolgrid'},[['chat','AI 助手','聊天、问答、创作与建议','ai-chat'],['image','AI 生图','描述想法，生成美好画面','ai-image']].map(([a,b,c,d])=>h('button',{type:'button',key:d,className:'a62-toolcard',onClick:()=>open(d)},art(a+'-tile'),h('div',null,h('b',null,b),h('small',null,c)),h('span',{'aria-hidden':true},'›')))),h('div',{className:'a62-quicklinks'},btn('提醒事项',()=>open('tasks')),btn('约定倒计时',()=>open('goal')),btn('园中事',()=>open('feed')),btn('问一问',()=>open('question'))))}
const cards=[['knowledge','百科问答','查询知识、了解世界',''],['chat','日常聊天','聊聊心情、分享想法','我想聊聊'],['study','知识学习','学习方法、技能提升','请帮我制定学习计划：'],['life','生活建议','饮食、健康、效率等','我想听听你的建议：'],['write','文案创作','写动态、祝福、计划、标题','帮我写一段文案：']];
function Chat(){const [status,refresh]=useStatus(),[id,I]=useState(()=>crypto.randomUUID()),[messages,M]=useState([]),[prompt,P]=useState(''),[busy,B]=useState(false),[error,E]=useState(''),[history,H]=useState(null),[thinking,T]=useState(true),[web,W]=useState(true);const lock=useRef(false),scroll=useRef(null),field=useRef(null);useEffect(()=>{if(messages.length||busy)scroll.current?.scrollIntoView({block:'end',behavior:'smooth'})},[messages,busy]);
async function send(){const value=prompt.trim();if(!value||lock.current)return;lock.current=true;B(true);E('');P('');M(old=>[...old,{role:'user',body:value}]);try{const r=await api('',{type:'v62-chat',id,prompt:value,thinking,web});M(old=>[...old,{role:'assistant',body:r.reply,sources:r.sources||[]}]);}catch(e){E(e.message);M(old=>old.slice(0,-1));P(value)}finally{B(false);lock.current=false;refresh()}}
async function showHistory(){try{H((await api('?v62=threads')).threads)}catch(e){E(e.message)}}
async function open(t){try{const r=await api('?v62=thread&id='+t.id);I(t.id);M(r.messages);P('');H(null);E('')}catch(e){E(e.message)}}
function reset(){I(crypto.randomUUID());M([]);P('');H(null);E('')}
return h('div',{className:'a62-page a62-chat'},h('div',{className:'a62-topactions'},Quota({status,kind:'chat'}),btn('◷ 历史记录',showHistory,'a62-plain',{disabled:busy}),btn('＋ 新对话',reset,'a62-plain',{disabled:busy})),history!==null?h('div',{className:'a62-history'},h('div',{className:'a62-heading'},h('h2',null,'对话记录'),btn('关闭',()=>H(null))),history.length?history.map(t=>h('div',{className:'a62-historyrow',key:t.id},btn(t.title,()=>open(t),'a62-historytitle'),btn('删除',async()=>{if(confirm('删除这段对话？'))try{await api('',{type:'v62-thread-delete',id:t.id});if(id===t.id)reset();await showHistory()}catch(e){E(e.message)}}))):h('p',null,'还没有对话记录。')):h(React.Fragment,null,h('div',{className:'a62-chatbody'},!messages.length&&!busy?h(React.Fragment,null,art('chat-hero',{className:'a62-hero'}),h('h2',{className:'a62-greeting'},'你好，我是你的 AI 助手 ♡'),h('p',{className:'a62-lead'},'我可以陪你聊天、解答问题、提供建议，\n也能帮你写文案、整理思路和制定计划～'),h('h3',{className:'a62-section-title'},'✦ 你可以试试：'),h('div',{className:'a62-suggestions'},cards.map(([icon,title,desc,pref])=>h('button',{key:icon,type:'button',onClick:()=>{P(pref);field.current?.focus()}},art('icon-'+icon),h('div',null,h('b',null,title),h('small',null,desc)))))):h(React.Fragment,null,h('div',{className:'a62-minihero'},art('chat-tile'),'AI 助手 · 随时为你解答'),messages.map((m,i)=>h('div',{key:i,className:'a62-msg '+m.role},h('p',null,m.body),m.role==='assistant'&&m.sources?.length>0&&h('div',{className:'a62-sources'},h('b',null,'参考来源'),m.sources.map(x=>h('a',{key:x.url,href:x.url,target:'_blank',rel:'noopener noreferrer'},x.title))),m.role==='assistant'&&btn('复制',()=>navigator.clipboard?.writeText(m.body).catch(()=>E('复制失败，请长按文字')),'a62-plain'))),busy&&h('p',{role:'status',className:'a62-thinking'},(thinking&&web?'正在思考并按需搜索…':thinking?'正在深度思考…':web?'正在回答并按需搜索…':'正在回答…'))),h('div',{ref:scroll})),error&&h('p',{className:'a62-error',role:'alert'},error),h('div',{className:'a62-modes'},btn('深度思考',()=>T(v=>!v),'a62-button',{'aria-pressed':thinking,disabled:busy}),btn('联网搜索',()=>W(v=>!v),'a62-button',{'aria-pressed':web,disabled:busy})),h('form',{className:'a62-composer',onSubmit:e=>{e.preventDefault();send()}},h('textarea',{ref:field,rows:1,value:prompt,onChange:e=>P(e.target.value),placeholder:'输入你想问的问题…',maxLength:5000,'aria-label':'输入消息'}),h('button',{className:'a62-send',type:'submit',disabled:busy||!prompt.trim(),'aria-label':'发送'},'➤')),h('small',{className:'a62-disclaimer'},web?'AI 会按需联网，重要信息请核对来源。':'本次不联网，实时信息可能不准确。')))}
function ImagePage({onApply, initial='', context=false,initialRatio}) {
  const [status, refresh] = useStatus();
  const [prompt, setPrompt] = useState(initial);
  const [style, setStyle] = useState('温暖插画');
  const [ratio, setRatio] = useState(initialRatio || (context ? '16:9' : '1:1'));
  const [reference, setReference] = useState('');
  const [panel, setPanel] = useState('');
  const [result, setResult] = useState(null);
  const [editing, setEditing] = useState(true);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState('');
  const textarea = useRef(null), lock = useRef(false), top = useRef(null);
  const choices = {'1:1':'方形','16:9':'横屏','9:16':'竖屏'};
  const suggestions = useRef(new Map());
  React.useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(118, Math.max(46, input.scrollHeight)) + 'px';
  }, [prompt, editing, history, busy]);
  useEffect(() => {
    if (result && !editing && history === null) top.current?.scrollIntoView({block:'start'});
  }, [result, editing, history]);
  async function generate() {
    if (!prompt.trim() || lock.current || uploading) return;
    lock.current = true;
    textarea.current?.blur();
    setBusy(true); setMessage(''); setPanel('');
    try {
      const image = await api('', {type:'v62-image',prompt:prompt.trim(),style,ratio,reference});
      const item = {...image,style,ratio};
      suggestions.current.set(item.id,item);
      setResult(item); setEditing(false);
    } catch (e) {setMessage(e.message);}
    finally {setBusy(false); lock.current=false; refresh();}
  }
  async function openHistory() {
    setMessage('');
    try {setHistory((await api('?v62=images')).images);}
    catch (e) {setMessage(e.message);}
  }
  function selectHistory(row) {
    const item = suggestions.current.get(row.id) || row;
    setResult(item); setPrompt(item.prompt); setReference(''); setPanel('');
    setStyle(item.style || '温暖插画'); setRatio(item.ratio || (initialRatio || (context ? '16:9' : '1:1')));
    setEditing(false); setHistory(null); setMessage('');
  }
  async function useImage() {
    if (!result || applying) return;
    setApplying(true); setMessage('');
    try {
      const response = await fetch(imgUrl(result.id));
      if (!response.ok) throw Error('图片暂时无法读取');
      await onApply(await compress(await response.blob()),result);
      if (!context) setMessage('图片已应用');
    } catch (e) {setMessage(e.message);}
    finally {setApplying(false);}
  }
  async function attach(event) {
    const input = event.target, file = input.files[0];
    if (!file) return;
    input.value = ''; setUploading(true); setMessage('');
    try {setReference(await compress(file));}
    catch (e) {setMessage(e.message);}
    finally {setUploading(false);}
  }
  const historyButton = btn('◷ 生成记录',openHistory,'a62-plain',{disabled:busy || uploading || applying});
  const toggle = (name,label) => btn(label + ' ﹀',()=>setPanel(panel === name ? '' : name),'a624-chip',{'aria-expanded':panel===name});
  let body;
  if (history !== null) {
    body = h('section',{className:'a62-history'},
      h('div',{className:'a62-heading'},h('h2',null,'生成记录'),btn('关闭',()=>setHistory(null))),
      history.length ? h('div',{className:'a62-gallery'},history.map(row=>h('button',{type:'button',key:row.id,onClick:()=>selectHistory(row)},
        h('img',{src:imgUrl(row.id),alt:''}),h('small',null,row.prompt)))) : h('p',null,'还没有生成记录。'));
  } else if (busy) {
    body = h('div',{className:'a62-loading',role:'status'},art('image-tile'),h('b',null,'正在为你创作中…'),h('small',null,'请保持页面打开。'),h('div',{className:'a62-progress'}));
  } else if (!editing && result) {
    const original = imgUrl(result.id);
    body = h(React.Fragment,null,
      h('div',{className:'a624-summary'},h('div',null,h('strong',null,result.prompt),result.style && h('small',null,result.style+' · '+result.ratio)),
        btn('✎ 编辑',()=>{setEditing(true);setPanel('');setMessage('');},'a624-chip',{disabled:applying})),
      h('a',{className:'a624-photo',href:original,target:'_blank',rel:'noopener','aria-label':'打开生成的原图'},
        h('img',{src:original,alt:'生成的图片',onError:()=>setMessage('预览加载失败，可点「查看原图」重试。')})),
      h('div',{className:'a624-actions'},
        h('a',{className:'a62-primary',href:imgUrl(result.id,true),download:'lychee-image.jpg'},'↓ 保存图片'),
        h('a',{className:'a624-chip',href:original,target:'_blank',rel:'noopener'},'查看原图')),
      h('div',{className:'a624-more'},onApply && btn(applying?'正在应用…':context?'使用这张图片':'应用到荔枝',useImage,'a62-plain',{disabled:applying}),
        btn('再来一张',generate,'a62-plain',{disabled:applying}),historyButton));
  } else {
    body = h(React.Fragment,null,
      h('div',{className:'a624-prompt'},
        h('textarea',{ref:textarea,rows:2,value:prompt,onChange:e=>setPrompt(e.target.value),placeholder:'描述你想生成的图片…',maxLength:500,'aria-label':'描述图片'}),
        h('div',{className:'a624-attachments'},
          h('label',null,uploading?'正在处理…':'＋ 参考图',h('input',{type:'file',accept:'image/*',onChange:attach,disabled:uploading})),
          reference && h(React.Fragment,null,h('img',{src:'data:image/jpeg;base64,'+reference,alt:'参考图'}),btn('移除',()=>setReference(''),'a62-plain')),
          h('small',null,prompt.length+' / 500'))),
      h('div',{className:'a624-switches'},toggle('style',style),toggle('ratio',ratio+' '+choices[ratio])),
      panel==='style' && h('div',{className:'a624-styles'},styles.map((name,i)=>h('button',{type:'button',key:name,'aria-pressed':name===style,onClick:()=>{setStyle(name);setPanel('');}},
        i<4 && art('style-'+i),h('span',null,i===4?'✦ '+name:name)))),
      panel==='ratio' && h('div',{className:'a624-ratios'},Object.entries(choices).map(([value,label])=>btn(value+' '+label,()=>{setRatio(value);setPanel('');},'a624-chip',{key:value,'aria-pressed':value===ratio}))),
      btn('生成图片',generate,'a62-primary',{disabled:uploading||!prompt.trim()}),
      h('div',{className:'a624-more'},result && btn('返回图片',()=>{setEditing(false);setMessage('');setPrompt(result.prompt);if(result.style)setStyle(result.style);if(result.ratio)setRatio(result.ratio);},'a62-plain'),historyButton));
  }
  return h('div',{ref:top,className:'a62-page a62-image a624-image'},body,
    status && !status.image && h('small',null,'服务暂未配置'),
    message && h('p',{role:'status',className:'a62-error'},message));
}


function ImagePicker({title='生成图片',prompt='',onApply,initialRatio}){const [open,O]=useState(false);return h(React.Fragment,null,btn('✦ AI 生成',()=>O(true),'a62-button'),open&&h('div',{className:'a62-modal',role:'dialog','aria-modal':true,'aria-label':title},h('div',{className:'a62-modalpanel'},h('div',{className:'a62-heading'},h('h2',null,title),btn('关闭',()=>O(false))),h(ImagePage,{context:true,initial:prompt,initialRatio,onApply:async(p)=>{await onApply(p);O(false)}}))))}
function Assist({label='✦ AI 帮我写',prompt,onUse}){const [busy,B]=useState(false),[reply,R]=useState(''),[error,E]=useState('');return h('div',{className:'a62-assist'},btn(busy?'正在思考…':label,async()=>{if(busy)return;const v=typeof prompt==='function'?prompt():prompt;if(!v)return;B(true);E('');try{R(await ai(v))}catch(e){E(e.message)}finally{B(false)}},'a62-button',{disabled:busy}),reply&&h('div',{className:'a62-answer'},h('small',null,'AI 建议'),h('p',null,reply),onUse&&btn('使用',()=>{onUse(reply);R('')}),btn('关闭',()=>R(''))),error&&h('p',{role:'alert',className:'a62-error'},error))}
return {Tools,Chat,ImagePage,ImagePicker,Assist,api,imgUrl};
};
