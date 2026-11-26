/* Food journal component shared by the web, desktop and native shells. */
(function (w) {
  'use strict';
  const keys=['kcal','protein','carbs','fat'];
  const labels={kcal:'热量',protein:'蛋白质',carbs:'碳水',fat:'脂肪'};
  const dayKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const localDate=key=>new Date(key+'T12:00:00');
  function shift(key,days) {const date=localDate(key);date.setDate(date.getDate()+days);return dayKey(date);}
  const {sums,entryItem,recipeRows,resolveItems,groupWeight,resizeGroup,plateWeight,resizePlate}=w.LycheeDietEstimateV7;
  const {search:searchFoods}=w.LycheeDietMatchV7;
  function CookedPortion({React,grams,label,apply,disabled,placeholder}){
    const rounded=grams==null?'':String(Math.round(grams*10)/10);
    const [value,setValue]=React.useState(rounded);
    React.useEffect(()=>setValue(rounded),[rounded]);
    function change(text){
      setValue(text);
      const weight=Number(text);
      if(weight>0&&weight<=10000)apply(weight);
    }
    return React.createElement('label',null,label,
      React.createElement('input',{type:'number',min:.1,max:10000,step:'any',inputMode:'decimal',value,disabled,placeholder,
        onChange:e=>change(e.target.value),onBlur:()=>setValue(rounded),onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur();}}));
  }
  function labelItem(label) {
    if(!label.name.trim()||keys.some(k=>label[k]===''||!Number.isFinite(Number(label[k]))||Number(label[k])<0))throw Error('请按包装填写名称、能量和三项营养数值');
    const unit=label.basis==='每份'?label.servingUnit:label.basis==='每100毫升'?'ml':'g';
    const base=label.basis==='每份'?Number(label.servingAmount):100;
    if(!Number.isFinite(base)||base<=0||base>10000)throw Error('请填写包装上每份的克数或毫升数');
    const per100=Object.fromEntries(keys.map(k=>[k,Number(label[k])*100/base/(k==='kcal'&&label.energyUnit==='kJ'?4.184:1)]));
    if(keys.some(k=>per100[k]>(k==='kcal'?1000:100)))throw Error('请核对标签单位和每份重量');
    return {name:label.name.trim(),foodId:'label',source:'本品包装标签',grams:base,unit,per100};
  }
  const blankLabel=()=>({name:'',basis:'每100克',energyUnit:'kcal',servingUnit:'g',servingAmount:'',kcal:'',protein:'',carbs:'',fat:''});
  function canvas(width,height) {
    const c=document.createElement('canvas');c.width=width;c.height=height;return c;
  }
  // Remove only a uniform background connected to the image border. Keep the photo on textured tables.
  function simpleSticker(c) {
    const g=c.getContext('2d',{willReadFrequently:true}), {width,height}=c;
    const frame=g.getImageData(0,0,width,height), p=frame.data;
    const hist=new Map(), border=[];
    for(let x=0;x<width;x+=2) border.push(x,(height-1)*width+x);
    for(let y=0;y<height;y+=2) border.push(y*width,y*width+width-1);
    for(const i of border) {
      const k=(p[i*4]>>5)*64+(p[i*4+1]>>5)*8+(p[i*4+2]>>5);
      hist.set(k,(hist.get(k)||0)+1);
    }
    const [mode,count]=[...hist].sort((a,b)=>b[1]-a[1])[0];
    if(count<border.length*.35) return c;
    const color=[(mode>>6)*32+16,((mode>>3)&7)*32+16,(mode&7)*32+16];
    const mask=new Uint8Array(width*height), queue=new Uint32Array(mask.length);
    let tail=0,head=0,shadowPass=false;
    function visit(i,from) {
      if(mask[i])return;
      const similar=[0,1,2].every(k=>Math.abs(p[i*4+k]-color[k])<=40);
      if(shadowPass){
        // A gradual neutral shadow can touch the edge of a pale tabletop.
        // Do not use it to re-enter a pale subject behind a dark rim.
        const [r,g,b]=p.subarray(i*4,i*4+3);
        if(similar||r>=color[0]||Math.max(r,g,b)-Math.min(r,g,b)>12||
           [0,1,2].some(k=>Math.abs(p[i*4+k]-p[from*4+k])>9))return;
      }else if(!similar)return;
      mask[i]=1;queue[tail++]=i;
    }
    for(const i of border)visit(i);
    function flood(){
      while(head<tail) {
        const i=queue[head++],x=i%width;
        if(x)visit(i-1,i);if(x<width-1)visit(i+1,i);
        if(i>=width)visit(i-width,i);if(i<mask.length-width)visit(i+width,i);
      }
    }
    flood();
    if(Math.max(...color)-Math.min(...color)<=16) {
      shadowPass=true;head=0;flood();
    }
    if(tail<mask.length*.12 || tail>mask.length*.88)return c;
    let left=width,top=height,right=0,bottom=0;
    for(let i=0;i<mask.length;i++){
      if(mask[i]){p[i*4+3]=0;continue;}
      const x=i%width,y=Math.floor(i/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    g.putImageData(frame,0,0);
    const cut=canvas(right-left+1,bottom-top+1);
    cut.getContext('2d').drawImage(c,left,top,cut.width,cut.height,0,0,cut.width,cut.height);
    return cut;
  }
  async function preparePhoto(file) {
    if(!file || file.size>25*1024*1024)throw Error('请选择 25 MB 以内的照片');
    const image=new Image(),url=URL.createObjectURL(file);
    try {
      image.src=url;await image.decode();
      function resized(max) {
        const scale=Math.min(1,max/Math.max(image.width,image.height));
        const c=canvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
        c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c;
      }
      const original=resized(900);let encoded=original.toDataURL('image/jpeg',.74);
      if(encoded.length>880000)encoded=resized(640).toDataURL('image/jpeg',.60);
      const sticker=simpleSticker(resized(360));
      let photo=sticker.toDataURL('image/webp',.84);
      if(photo.length>315000)photo=resized(260).toDataURL('image/jpeg',.68);
      return {image:encoded,photo};
    } finally {URL.revokeObjectURL(url);}
  }
  async function outlinedSticker(original,outline,fallback) {
    if(!Array.isArray(outline)||outline.length<8)return fallback;
    const image=new Image();image.src=original;await image.decode();
    const scale=Math.min(1,360/Math.max(image.width,image.height));
    const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
    const points=outline.map(([x,y])=>[x*width/1000,y*height/1000]);
    const doubleArea=points.reduce((s,[x,y],i)=>{const next=points[(i+1)%points.length];return s+x*next[1]-y*next[0];},0);
    const fraction=Math.abs(doubleArea)/(2*width*height);
    if(fraction<.04||fraction>.97)return fallback;
    const minX=Math.floor(Math.min(...points.map(p=>p[0]))),minY=Math.floor(Math.min(...points.map(p=>p[1])));
    const c=canvas(Math.max(1,Math.ceil(Math.max(...points.map(p=>p[0])))-minX),
      Math.max(1,Math.ceil(Math.max(...points.map(p=>p[1])))-minY));
    const ctx=c.getContext('2d');ctx.translate(-minX,-minY);
    ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);
    ctx.closePath();ctx.clip();ctx.drawImage(image,0,0,width,height);
    const sticker=c.toDataURL('image/webp',.84);
    return sticker.length<=315000?sticker:fallback;
  }
  function LycheeDietV7({React,accountId,gardenId,api,analyzePhoto}) {
    const {useState,useEffect,useRef}=React,h=React.createElement;
    const account=accountId||w.LycheeAccess?.scope?.accountId;
    const garden=gardenId||w.LycheeAccess?.scope?.gardenId;
    const [day,setDay]=useState(()=>dayKey(new Date())),[entries,setEntries]=useState([]);
    const [draft,setDraft]=useState(null),[query,setQuery]=useState(''),[status,setStatus]=useState('');
    const [busy,setBusy]=useState(''),[revision,refresh]=useState(0);
    const [label,setLabel]=useState(null),[foodSearch,setFoodSearch]=useState({});
    const [split,setSplit]=useState(null);
    const gallery=useRef(null),camera=useRef(null),active=useRef(0),pending=useRef(false);
    const catalog=w.LycheeDietFoodsV7||[],recipes=w.LycheeDietRecipesV7||[];
    async function call(route,date,body){
      if(api)return api(route,date,body);
      if(!account||!garden)throw Error('请先登录并进入荔枝园');
      const params=new URLSearchParams({accountId:account,gardenId:garden,day:date});
      const res=await fetch('/api/v7/diet/'+route+'?'+params,{credentials:'same-origin',cache:'no-store',
        method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) {
        const error=Error(data.error||'暂时无法连接饮食手帐');
        error.status=res.status;error.retryNew=res.headers.get('x-lychee-ai-retry')==='new';throw error;
      }
      return data;
    }
    useEffect(()=>{
      let live=true;active.current++;pending.current=false;
      setDraft(null);setLabel(null);setSplit(null);setFoodSearch({});setEntries([]);setStatus('');setBusy('loading');
      call('entries',day).then(r=>{if(live)setEntries(r.entries);})
        .catch(e=>{if(live)setStatus(e.message);}).finally(()=>{if(live)setBusy('');});
      return ()=>{live=false;active.current++;};
    },[account,garden,day,revision]);
    const today=dayKey(new Date()),weekday=(localDate(day).getDay()+6)%7,start=shift(day,-weekday);
    const [showWeek,setShowWeek]=useState(false),[weekReport,setWeekReport]=useState(null);
    useEffect(()=>{
      if(!showWeek)return;
      let live=true;
      setWeekReport(null);
      Promise.all(Array.from({length:7},async(_,n)=>{
        const date=shift(start,n);
        const {entries:meals}=await call('entries',date);
        return {date,count:meals.length,total:sums(meals.flatMap(e=>e.items))};
      })).then(days=>{if(live)setWeekReport({days});}).catch(error=>{
        if(live)setWeekReport({error:error.message});
      });
      return ()=>{live=false;};
    },[showWeek,start,account,garden,revision]);
    function fresh(){
      return {id:crypto.randomUUID(),day,revision:0,title:'',items:[],photo:''};
    }
    function edit(entry) {
      active.current++;setStatus('');setQuery('');setLabel(null);setSplit(null);setFoodSearch({});setDraft(entry?structuredClone(entry):fresh());
    }
    function close() {active.current++;setStatus('');setQuery('');setDraft(null);}
    function update(patch){setDraft(d=>({...d,...(patch.items?{weighedGrams:null}:{}),...patch}));}
    function modify(index,fn) {setDraft(d=>({...d,weighedGrams:null,items:d.items.map((row,i)=>i===index?fn(row):row)}));}
    function append(item) {
      setDraft(d=>d.items.length>=24?d:({...d,weighedGrams:null,items:[...d.items,item]}));
      setQuery('');
    }
    function addRecipe(recipe) {
      try{
        const rows=recipeRows(recipe,catalog,{groupId:crypto.randomUUID()});
        if(draft.items.length+rows.length>24)throw Error('这餐最多可记 24 项，请将其他菜另记一餐。');
        setDraft(d=>({...d,weighedGrams:null,title:d.title||recipe.name,items:[...d.items,...rows]}));
        setQuery('');setStatus('');
      }catch(e){setStatus(e.message);}
    }
    async function identify(image) {
      if(analyzePhoto)return analyzePhoto(image);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(image));
      const marker='lychee.diet.scan.'+account+'.'+garden+'.'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
      const requestId=sessionStorage.getItem(marker)||crypto.randomUUID();
      sessionStorage.setItem(marker,requestId);
      try{
        const result=await call('recognize',day,{image,requestId});
        sessionStorage.removeItem(marker);return result;
      }catch(error){
        if(error.retryNew||[400,401,403,404,413,429].includes(error.status))sessionStorage.removeItem(marker);
        throw error;
      }
    }
    async function take(file) {
      if(!file||pending.current)return;
      pending.current=true;
      const token=++active.current,base=draft||fresh();setDraft(base);setQuery('');setSplit(null);setStatus('');setBusy('photo');
      try{
        const {image,photo}=await preparePhoto(file);
        if(active.current!==token)return;
        setDraft({...base,photo});
        const answer=await identify(image);
        if(active.current!==token)return;
        const rows=resolveItems(answer.items,catalog,recipes);
        if(!rows.length){setStatus('照片里没有识别出食物，可以直接选择。');return;}
        if(rows.length>24){setStatus('这一餐识别出了超过 24 项，可分两条记录或手动添加。');return;}
        const sticker=await outlinedSticker(image,answer.outline,photo);
        if(active.current!==token)return;
        setDraft({...base,weighedGrams:null,photo:sticker,title:answer.title||'',items:rows});
        if(rows.some(r=>!r.foodId))setStatus('请给未匹配的食物选一个营养条目。');
      }catch(e){if(active.current===token)setStatus(e.message||'照片读取失败，请换一张试试');}
      finally{if(active.current===token){setBusy('');pending.current=false;}}
    }
    async function save() {
      if(!draft||pending.current||!draft.items.length)return;
      if(draft.items.some(i=>!i.foodId || !Number.isFinite(Number(i.grams)) || Number(i.grams)<=0 || Number(i.grams)>10000)){
        setStatus('请为每项食物选择条目并填入有效份量。');return;
      }
      pending.current=true;setBusy('save');setStatus('');const token=active.current;
      const item={...draft,title:draft.title.trim()||draft.items.map(i=>i.name).join('、').slice(0,120),
        items:draft.items.map(i=>({...i,grams:Number(i.grams)}))};
      try{const result=await call('entries',day,{entry:item});
        if(active.current!==token)return;
        setEntries(old=>[...old.filter(e=>e.id!==item.id),result.entry]);close();}
      catch(e){
        if(active.current!==token)return;
        if(e.status===409){
          try {const latest=await call('entries',day);if(active.current===token)setEntries(latest.entries);}
          catch {if(active.current===token)setStatus('请重新加载手帐，取回其他设备的修改');return;}
        }
        if(active.current===token)setStatus(e.message);
      }
      finally{pending.current=false;setBusy('');}
    }
    const button=(label,handler,className,rest={})=>h('button',{type:'button',onClick:handler,className,...rest},label);
    const imgInput=(ref,capture)=>h('input',{type:'file',ref,accept:'image/*',capture,hidden:true,onChange:e=>{
      const file=e.target.files[0];e.target.value='';void take(file);
    }});
    const photoButtons=h('div',{className:'diet-v7-actions'},
      button('拍照',()=>camera.current?.click(),'diet-v7-primary',{disabled:!!busy}),
      button('从相册选',()=>gallery.current?.click(),'diet-v7-soft',{disabled:!!busy}));
    const msg=status&&h('p',{className:'diet-v7-status',role:'status'},status);
    const wrap=(...nodes)=>h('section',{className:'diet-v7','aria-label':'照记饮食'},imgInput(camera,'environment'),imgInput(gallery),...nodes);
    if(draft) {
      const total=sums(draft.items);
      const incomplete=draft.items.filter(row=>!row.foodId).length;
      const net=plateWeight(draft.items,catalog);
      const showNet=net!==null&&(draft.photo||draft.items.length>1);
      function fitPlate(items,grams){
        const resized=resizePlate(items,grams,catalog);
        if(resized===items){
          setStatus('请核对净重和已填写的油酱量；净重需包含整盘食物。');
          return;
        }
        setDraft(d=>({...d,weighedGrams:grams,items:resized}));setStatus('');
      }
      function splitEditor(row) {
        if(split?.target!==row)return null;
        const hints=/奶茶|乳茶|茶饮|饮品/.test(row.name)?['鲜奶','茶','糖','粉圆']:['豆腐','熟面条','西兰花','鱼丸','芝麻酱','食用油'];
        const choices=split.query?searchFoods(split.query,catalog,6):[];
        return h('div',{className:'diet-v7-row diet-v7-split'},
          h('label',null,'查找这道菜里的食材',h('input',{value:split.query,onChange:e=>setSplit({...split,query:e.target.value})})),
          h('div',{className:'diet-v7-options'},...hints.map(n=>button(n,()=>setSplit({...split,query:n}),'diet-v7-soft',{key:n}))),
          h('div',{className:'diet-v7-options diet-v7-split-results'},...choices.map(f=>button(f.name,
            ()=>setSplit({...split,query:'',items:[...split.items,entryItem(f)]}),'diet-v7-soft',{key:f.id}))),
          ...split.items.map((p,n)=>h('label',{key:n},p.name+'（克）',h('input',{type:'number',min:.1,max:10000,step:'any',value:p.grams,
            onChange:e=>setSplit({...split,items:split.items.map((v,i)=>i===n?{...v,grams:e.target.value}:v)})}))),
          h('div',{className:'diet-v7-actions'},button('采用这些食材',()=>{
            if(draft.items.length-1+split.items.length>24){setStatus('这餐最多可记 24 项。');return;}
            const items=split.items.map(p=>({...p,grams:Number(p.grams)}));
            setDraft(d=>({...d,weighedGrams:null,items:d.items.flatMap(old=>old===row?items:[old])}));setSplit(null);setStatus('');
          },'diet-v7-soft',{disabled:!split.items.length||split.items.some(p=>!(Number(p.grams)>0&&Number(p.grams)<=10000))}),
          button('取消拆分',()=>setSplit(null),'diet-v7-text')));
      }
      const visibleOptions=(i,row)=>{
        const q=(foodSearch[i]??(row.foodId?'':row.name)).trim();
        const choices=searchFoods(q,catalog,30);
        const selected=catalog.find(f=>f.id===row.foodId);
        if(selected&&!choices.includes(selected))choices.unshift(selected);
        return choices;
      };
      function measuredPortion(row,i){
        if(row.recipeId||row.unit==='ml')return null;
        const food=catalog.find(f=>f.id===row.foodId);
        if(!(food?.measuredPortionGrams>0)||!food.measuredPortionUnit)return null;
        const unit=({'1 order':'一单','研究记录的一份成品':'一份'})[food.measuredPortionUnit]||food.measuredPortionUnit;
        return button('参考份量 · '+unit+'（'+food.measuredPortionGrams+'克）',
          ()=>modify(i,old=>({...old,grams:food.measuredPortionGrams})),'diet-v7-soft',{disabled:!!busy});
      }
      const labelField=(key,text,type='text')=>h('label',null,text,h('input',{type,value:label[key],step:type==='number'?'any':undefined,
        maxLength:100,onChange:e=>setLabel({...label,[key]:e.target.value})}));
      const labelChoice=(key,text,values)=>h('label',null,text,h('select',{value:label[key],onChange:e=>setLabel({...label,[key]:e.target.value})},
        ...values.map(v=>h('option',{key:v,value:v},v))));
      return wrap(h('div',{className:'diet-v7-top'},h('h2',null,draft.revision?'这一餐':'记一餐'),
        button('返回',close,'diet-v7-soft',{disabled:!!busy})),
        h('div',{className:'diet-v7-edit'},
          draft.photo&&h('img',{className:'diet-v7-preview',src:draft.photo,alt:'本餐照片'}),
          !draft.revision&&photoButtons,
          busy==='photo'&&h('p',{role:'status'},'正在读取照片与食物…'),msg,
          h('label',null,'餐名',h('input',{value:draft.title,maxLength:120,placeholder:'例如：地三鲜盖饭',disabled:!!busy,onChange:e=>update({title:e.target.value})})),
          showNet&&h(CookedPortion,{React,grams:draft.weighedGrams,label:'整盘可食净重（克）',placeholder:'可选，填写去掉餐具后的实称重量',
            disabled:!!busy,apply:g=>fitPlate(draft.items,g)}),
          !!draft.items.length&&h(w.LycheeDietCondimentV7,{React,items:draft.items,catalog,disabled:!!busy,onChange:items=>{
            if(draft.weighedGrams)fitPlate(items,draft.weighedGrams);
            else update({items});
          }}),
          ...Array.from(new Set(draft.items.map(r=>r.portionGroup).filter(Boolean))).map(id=>{
            const rows=draft.items.filter(r=>r.portionGroup===id);
            if(showNet&&draft.items.length===rows.length)return null;
            return h(CookedPortion,{key:id,React,grams:groupWeight(rows),disabled:!!busy,
              label:(rows[0].portionName||recipes.find(r=>r.id===rows[0].recipeId)?.name||'这道菜')+' · 食用熟重（克）',
              apply:weight=>update({items:resizeGroup(draft.items,id,weight)})});
          }),
          ...draft.items.map((row,i)=>h('div',{className:'diet-v7-row',key:i},
            h('div',{className:'diet-v7-row-head'},h('strong',null,row.name),
              button('移除',()=>update({items:draft.items.filter((_,n)=>i!==n)}),'diet-v7-text',{disabled:!!busy,'aria-label':'移除'+row.name})),
            h('label',null,'替换食物',h('input',{placeholder:'输入菜名查找',value:foodSearch[i]??(row.foodId?'':row.name),disabled:!!busy,
              onChange:e=>setFoodSearch({...foodSearch,[i]:e.target.value})})),
            h('label',null,'匹配食物',h('select',{value:row.foodId,disabled:!!busy,onChange:e=>{
              const f=catalog.find(f=>f.id===e.target.value);if(f)modify(i,old=>entryItem(f,old.unit==='ml'?undefined:old.grams));
            }},!row.foodId&&h('option',{value:''},'选择营养条目'),row.foodId==='label'&&h('option',{value:'label'},'本品包装标签'),
              ...visibleOptions(i,row).map(f=>h('option',{key:f.id,value:f.id},f.name)))),
            h('div',{className:'diet-v7-portion'},h('label',null,row.quantityNote|| (row.unit==='ml'?'份量（毫升）':'份量（克）'),h('input',{type:'number',inputMode:'decimal',min:0.1,max:10000,step:'any',value:typeof row.grams==='number'?Number(row.grams.toFixed(2)):row.grams,
              disabled:!!busy,onChange:e=>modify(i,old=>({...old,grams:e.target.value}))})),
              button('吃了半份',()=>modify(i,old=>({...old,grams:Math.max(.1,Math.round(Number(old.grams)*5)/10)})),'diet-v7-soft',{disabled:!!busy})),
            measuredPortion(row,i),
            !row.foodId&&button('填写本品标签',()=>{setSplit(null);setLabel({...blankLabel(),name:row.name,target:row,
              basis:row.unit==='ml'?'每100毫升':'每100克'});},'diet-v7-soft',{disabled:!!busy}),
            !row.foodId&&button('拆成食材',()=>{setLabel(null);setSplit({target:row,query:'',items:[]});},'diet-v7-soft',{disabled:!!busy}),
            splitEditor(row)))
          ,h('label',null,'添加食物',h('input',{placeholder:'搜索米饭、鸡蛋、馒头…',value:query,disabled:!!busy,onChange:e=>setQuery(e.target.value)})),
          h('div',{className:'diet-v7-options diet-v7-recipes'},...recipes.filter(r=>!query||[r.name,...r.aliases].some(n=>n.includes(query.trim())))
            .slice(0,6).map(r=>button(r.name,()=>addRecipe(r),'diet-v7-soft',{key:r.id,disabled:!!busy}))),
          h('div',{className:'diet-v7-options'},...searchFoods(query,catalog,8)
            .map(f=>button(f.name,()=>append(entryItem(f)),'diet-v7-soft',{key:f.id,disabled:!!busy||draft.items.length>=24}))),
          query.trim()&&button('按食材记「'+query.trim()+'」',()=>{
            const name=query.trim().slice(0,100),row={name,foodId:'',source:'',grams:'',per100:{kcal:0,protein:0,carbs:0,fat:0}};
            setDraft(d=>({...d,weighedGrams:null,title:d.title||name,items:[...d.items,row]}));setQuery('');setLabel(null);setSplit({target:row,query:'',items:[]});
          },'diet-v7-soft',{disabled:!!busy||draft.items.length>=24}),
          !label?button('按包装标签添加',()=>setLabel(blankLabel()),'diet-v7-soft',{disabled:!!busy||draft.items.length>=24}):
            h('div',{className:'diet-v7-row'},labelField('name','商品名称'),labelChoice('basis','标签口径',['每100克','每100毫升','每份']),
              label.basis==='每份'&&labelField('servingAmount','每份重量或容量','number'),label.basis==='每份'&&labelChoice('servingUnit','每份单位',['g','ml']),
              labelChoice('energyUnit','能量单位',['kcal','kJ']),
              ...keys.map(k=>labelField(k,k==='kcal'?'能量':labels[k]+'（克）','number')),
              h('div',{className:'diet-v7-actions'},button(label.target?'应用到这项':'添加到这餐',()=>{try{
                const row=labelItem(label);
                if(label.target){
                  const index=draft.items.indexOf(label.target);
                  if(index<0)throw Error('这项食物已更改，请重新选择要填写标签的食物');
                  modify(index,old=>({...row,grams:(old.unit||'g')===row.unit?old.grams:row.grams}));
                }else append(row);
                setLabel(null);setStatus('');
              }catch(e){setStatus(e.message);}},'diet-v7-soft'),
                button('取消',()=>setLabel(null),'diet-v7-text'))),
          incomplete?h('p',{className:'diet-v7-status'},'还有 '+incomplete+' 项待选食物，补全后显示本餐合计。'):
          h('div',{className:'diet-v7-macros'},...keys.map(k=>h('div',{key:k},h('small',null,labels[k]),
            h('strong',null,(k==='kcal'?Math.round(total[k]):Number(total[k].toFixed(1)))+(k==='kcal'?' kcal':' g'))))),
          button(busy==='save'?'正在保存…':'保存这一餐',save,'diet-v7-primary diet-v7-save',{disabled:!!busy||!draft.items.length||!!incomplete})));
    }
    const total=sums(entries.flatMap(e=>e.items));
    const cameraMark=h('span',{className:'diet-v7-camera','aria-hidden':true});
    const pickDay=date=>{setShowWeek(false);setDay(date);};
    const dayLabel=date=>Number(date.slice(5,7))+'月'+Number(date.slice(8))+'日';
    const browseDate=h('label',{className:'diet-v7-date',title:'选择日期'},'七天',
      h('input',{type:'date',value:day,'aria-label':'查看日期',onClick:e=>{try{e.currentTarget.showPicker?.();}catch{}},
        onChange:e=>{if(e.target.value)pickDay(e.target.value);}}));
    const dayButtons=Array.from({length:7},(_,n)=>{
      const d=shift(start,n);return button('周'+'一二三四五六日'[n],()=>pickDay(d),'diet-v7-day',
        {key:d,'aria-label':d,'aria-pressed':d===day,title:dayLabel(d)});
    });
    const report=h('section',{className:'diet-v7-paper diet-v7-report','aria-label':'七天饮食周报'},
      h('h3',null,dayLabel(start)+' 至 '+dayLabel(shift(start,6))),
      !weekReport?h('p',{role:'status'},'正在读取本周记录…'):weekReport.error?h('div',null,h('p',{role:'status'},weekReport.error),
        button('重新加载',()=>refresh(n=>n+1),'diet-v7-soft')):h(React.Fragment,null,
        h('div',{className:'diet-v7-summary'},h('span',null,'共计'),h('strong',null,Math.round(weekReport.days.reduce((a,d)=>a+d.total.kcal,0))),h('span',null,'千卡')),
        ...weekReport.days.map(({date,count,total:sum},n)=>button(h(React.Fragment,null,
          h('b',null,'周'+'一二三四五六日'[n]),h('span',null,dayLabel(date)),h('span',null,count?count+' 餐 · '+Math.round(sum.kcal)+' 千卡':'未记录')),
          ()=>pickDay(date),'diet-v7-report-day',{key:date}))));
    return wrap(h('img',{className:'diet-v7-banner',src:'/client/diet-banner-v7.webp',alt:'',width:644,height:147}),
      h('nav',{className:'diet-v7-week','aria-label':'本周日期'},browseDate,...dayButtons),
      h('div',{className:'diet-v7-top'},h('h2',null,showWeek?'饮食周报':day===today?'今日饮食':dayLabel(day)+'饮食'),
        button(h(React.Fragment,null,h('i',{className:'diet-v7-bars','aria-hidden':true}),showWeek?'返回日记':'周报'),
          ()=>setShowWeek(v=>!v),'diet-v7-soft diet-v7-report-toggle',{'aria-pressed':showWeek})),
      showWeek?report:h('div',{className:'diet-v7-paper'},h('div',{className:'diet-v7-summary'},
        h('span',null,'总计'),h('strong',null,Math.round(total.kcal)),h('span',null,'千卡')),
        busy==='loading'?h('p',{role:'status'},'正在翻开手帐…'):!entries.length&&!status?h('p',{className:'diet-v7-empty'},'这一天还没有记录',h('small',null,'拍下第一餐，就会出现在这里。')):null,
        h('div',{className:'diet-v7-stickers'},...entries.map(e=>button(h(React.Fragment,null,
          e.photo?h('img',{src:e.photo,alt:''}):h('span',{className:'diet-v7-no-photo','aria-hidden':true},cameraMark),
          h('span',{className:'diet-v7-caption'},h('b',null,e.title),h('small',null,Math.round(sums(e.items).kcal)+' 千卡'))),()=>edit(e),'diet-v7-sticker',{key:e.id}))),msg,
        status&&button('重新加载',()=>refresh(n=>n+1),'diet-v7-soft')),
      !showWeek&&button(h(React.Fragment,null,cameraMark,'拍照记一餐'),()=>{edit(null);camera.current?.click();},'diet-v7-primary diet-v7-add',{disabled:busy==='loading'}),
      h('small',{className:'diet-v7-note'},'热量和营养数据为估算值，仅供日常饮食记录参考。'));
  }
  w.LycheeDietV7=LycheeDietV7;
})(window);
