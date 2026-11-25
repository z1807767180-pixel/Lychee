/* Integrated by the phone shell with its React, photo compressor and authenticated API. */
window.createGardenJournal = function createGardenJournal({React,read,write,compress,Icon,share}){
  const h=React.createElement, {useState,useEffect,useRef,useLayoutEffect}=React;
  const Ai62=window.createGarden62(React,compress);
  const EmojiBar=window.createGarden61({React,read,write,Icon,share}).EmojiBar;
  const asset=k=>"/mobile/journal-"+k+".webp";
  const labels={love:"超喜欢",clap:"拍手",hug:"抱一抱"};
  const sampleAlbum=JSON.stringify(["周末爬山","2026-11-22"]);
  const sampleNames={wayne:"Wayne",pi:"皮皮",nan:"南汐"};
  const samples=()=>[
    {id:"desk",member:"wayne",body:"周一早上，桌上的花开了。",src:asset("flowers"),kind:"relay",prompt:"拍一张你的桌面",replies:2},
    {id:"game",member:"pi",body:"",kind:"poll",prompt:"今晚玩哪个？",options:["五子棋","海龟汤"],votes:[{choice:0,n:1},{choice:1,n:1}]},
    {id:"walk",member:"nan",body:"山顶的风好舒服。",src:asset("hike"),album:sampleAlbum}
  ].map((p,i)=>({created:Date.now()-(i+1)*600000,stickers:[],votes:[],options:[],...p}));
  const fresh=()=>({id:crypto.randomUUID(),body:"",picture:"",kind:"plain",prompt:"",options:["",""],album:""});
  const imageSrc=p=>p.src||(p.photo?"/api/phone?image="+encodeURIComponent(p.id):"");
  const titleOf=key=>key?JSON.parse(key)[0]:"";
  function glyph(k){return h("span",{"aria-hidden":true,className:"j-glyph"},({back:"‹",edit:"✎",example:"❔",chat:"",album:"▧",relay:"▧",poll:"▥",send:"↑",smile:"☺",more:"＋"})[k])}
  function Journal(props){
    const {demo=false,me,members,avatar,name,goal,back,chat,unread=0,initialAlbum=""}=props;
    const [stack,setStack]=useState(()=>[initialAlbum?{view:"album",album:initialAlbum}:{view:"feed"}]);
    const route=stack[stack.length-1], view=route.view;
    const [posts,P]=useState(()=>demo?samples():[]),[comments,C]=useState([]),[more,M]=useState(false),[loaded,L]=useState(demo);
    const [draft,D]=useState(fresh),[busy,B]=useState(false),[error,E]=useState(""),[picker,K]=useState(""),[reply,Q]=useState(""),[words,W]=useState("");
    const [photos,F]=useState([]),[nextPhotos,N]=useState(false),[detailLoaded,DL]=useState(false),[revision,R]=useState(0);
    const [demoPhotos,DP]=useState(()=>({desk:[{member:"pi",src:asset("plant")},{member:"nan",src:asset("coffee")}]}));
    const [albumPicker,AP]=useState(false),[menu,Menu]=useState(""),[edit,Edit]=useState(null),[favoritesOnly,Fav]=useState(false);
    const scroll=useRef(null),positions=useRef([]),restoring=useRef(0),lock=useRef(false),session=useRef(0),replyId=useRef(""),photoRetry=useRef(null);
    const scope=demo?"self":me;
    const author=id=>demo&&sampleNames[id]?sampleNames[id]:name(id==="self"?me:id);
    const face=id=>demo&&sampleNames[id]?"/mobile/face-"+({wayne:4,pi:6,nan:1})[id]+".webp":avatar(id==="self"?me:id);
    const mood=id=>demo&&id==="wayne"?"创作思考中":members.find(m=>m.id===(id==="self"?me:id))?.mood;
    const goalKey=demo?sampleAlbum:goal;
    const post=posts.find(p=>p.id===route.id);
    const go=(view,data={})=>{positions.current.push(scroll.current?.scrollTop||0);restoring.current=0;K("");Q("");E("");AP(false);Menu("");setStack(s=>[...s,{view,...data}])};
    const pop=()=>{if(lock.current)return;if(stack.length===1){back();return}restoring.current=positions.current.pop()||0;K("");Q("");E("");AP(false);Menu("");setStack(s=>s.slice(0,-1))};
    useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollTop=restoring.current},[stack]);
    async function loadFeed(older=false,refresh=false){
      if(demo)return;
      const token=++session.current;
      let before=older?posts.at(-1)?.cursor:null, pages=[], notes=[], batch;
      const count=refresh?Math.max(1,Math.ceil(posts.length/20)):1;
      for(let i=0;i<count;i++){batch=await read("?journal=1"+(before?"&before="+before:""));pages.push(...batch.posts);notes.push(...batch.comments);if(batch.posts.length<20)break;before=batch.posts.at(-1).cursor}
      if(token!==session.current)return;
      P(old=>older?[...old,...pages]:pages);C(old=>older?[...old,...notes]:notes);M(batch.posts.length===20);L(true);
    }
    useEffect(()=>{if(!demo)loadFeed().catch(e=>{E(e.message);L(true)});return ()=>{session.current++}},[]);
    async function job(fn){if(lock.current)return;lock.current=true;B(true);E("");try{await fn()}catch(err){E(err.message||"暂时连接不上，请重试")}finally{lock.current=false;B(false)}}
    function amend(fields){D(old=>({...old,...fields,id:crypto.randomUUID()}))}
    function update(id,apply){P(old=>old.map(x=>x.id===id?apply(x):x))}
    const plainPhoto=(member,src)=>({member,src});
    function mockAlbum(key){
      const photos=posts.filter(p=>p.album===key&&imageSrc(p)).map(p=>plainPhoto(p.member,imageSrc(p)));
      if(key===sampleAlbum)photos.push(plainPhoto("pi",asset("trail")),plainPhoto("wayne",asset("ridge")));
      return photos;
    }
    async function details(before){
      const key=view==="album"?"album":"relay";
      const q=encodeURIComponent(view==="album"?route.album:route.id);
      const r=await read("?"+key+"="+q+(before?"&before="+before:""));
      return r.photos.map(p=>({...p,src:"/api/phone?"+(key==="relay"?"relayImage":"image")+"="+p.id}));
    }
    useEffect(()=>{
      if(!["relay","album"].includes(view))return;
      let active=true;F([]);N(false);DL(false);
      if(demo){F(view==="relay"?demoPhotos[route.id]||[]:mockAlbum(route.album));DL(true)}
      else details().then(rows=>{if(active){F(rows);N(rows.length===30);DL(true)}}).catch(e=>{if(active)E(e.message)});
      return ()=>{active=false};
    },[view,route.id,route.album,revision,demoPhotos]);
    const btn=(text,fn,cls="",attrs={})=>h("button",{type:"button",onClick:fn,className:cls,disabled:busy,...attrs},text);
    function photoButton(src,alt,cls=""){return btn(h("img",{src,alt,loading:"lazy"}),()=>go("photo",{src,title:alt}),"j-image "+cls,{"aria-label":"查看"+alt})}
    const field=(label,val,change,max)=>h("input",{"aria-label":label,placeholder:label,value:val,maxLength:max,onChange:e=>change(e.target.value)});
    const upload=(text,onPick,cls="")=>h("label",{className:"j-upload "+cls},text,h("input",{type:"file",accept:"image/*",disabled:busy,"aria-label":text,onChange:e=>{const f=e.target.files[0];e.target.value="";if(f)job(async()=>onPick(await compress(f)))}}));
    async function publish(){
      const p={...draft,options:draft.kind==="poll"?draft.options.map(x=>x.trim()):[],prompt:draft.kind==="plain"?"":draft.prompt.trim()};
      if(demo){P(rows=>[{...p,member:"self",src:p.picture?"data:image/jpeg;base64,"+p.picture:"",created:Date.now(),votes:[],stickers:[],replies:0},...rows])}
      else {await write({type:"journal-post",...p});await loadFeed()}
      D(fresh());restoring.current=0;positions.current.pop();setStack(s=>s.slice(0,-1));
    }
    async function vote(p,choice){
      if(demo)update(p.id,x=>({...x,votes:[...x.votes.filter(v=>v.choice!==choice),{choice,n:(x.votes.find(v=>v.choice===choice)?.n||0)+1,mine:1}]}));
      else{await write({type:"journal-vote",post:p.id,choice});await loadFeed(false,true)}
    }
    async function sticker(p,key){
      const selected=p.stickers.find(s=>s.mine)?.sticker===key?"":key;
      if(demo)update(p.id,x=>({...x,stickers:selected?[{n:1,mine:1,sticker:selected}]:[]}));
      else{await write({type:"journal-sticker",post:p.id,sticker:selected});await loadFeed(false,true)}K("");
    }
    async function addPhoto(pic,src){
      if(demo){DP(s=>({...s,[post.id]:[plainPhoto("self",src||"data:image/jpeg;base64,"+pic),...(s[post.id]||[])]}));update(post.id,x=>({...x,replies:x.replies+1}))}
      else {
        const token=photoRetry.current?.pic===pic?photoRetry.current.id:crypto.randomUUID();
        photoRetry.current={pic,id:token};await write({type:"journal-photo",post:post.id,id:token,picture:pic});photoRetry.current=null;R(v=>v+1);await loadFeed(false,true);
      }
    }
    function openComposer(source=""){D({...fresh(),source:typeof source==="string"?source:""});go("compose")}
    function composer(){
      const {kind,body,picture,prompt,options,album}=draft;
      return h("div",{className:"j-compose"},draft.source&&h("p",{className:"v61-link"},"跟发 · "+(posts.find(x=>x.id===draft.source)?.body||"朋友的动态")),h("textarea",{"aria-label":"动态内容",placeholder:"今天想分享什么？",maxLength:1000,value:body,onChange:e=>amend({body:e.target.value})}),
        !demo&&h(Ai62.Assist,{label:"✦ AI 润色",prompt:()=>"润色以下动态，保持原意，不添加事实，直接给文案："+body,onUse:body=>amend({body:body.slice(0,1000)})}),
        h("div",{className:"j-images"},picture&&h("div",{className:"j-preview"},h("img",{src:"data:image/jpeg;base64,"+picture,alt:"待发布照片"}),btn("×",()=>amend({picture:"",album:""}),"",{"aria-label":"移除照片"})),upload(picture?"换照片":"＋ 照片",pic=>amend({picture:pic})),!demo&&h(Ai62.ImagePicker,{title:"生成动态配图",prompt:body?"为这段动态画配图："+body.slice(0,400):"温馨的荔枝园生活插画",onApply:picture=>amend({picture})})),
        h("h3",null,"邀请朋友"),h("div",{className:"j-kinds"},...["relay","poll"].map(k=>btn([glyph(k),k==="relay"?"照片接龙":"投票"],()=>amend({kind:kind===k?"plain":k}),"",{key:k,"aria-pressed":kind===k}))),
        kind!=="plain"&&h("div",{className:"j-fields"},field(kind==="relay"?"想邀请朋友拍什么？":"想问大家什么？",prompt,x=>amend({prompt:x}),80),
          kind==="poll"&&options.map((o,i)=>h("div",{key:i},field("选项 "+(i+1),o,x=>amend({options:options.map((v,j)=>j===i?x:v)}),30),options.length>2&&btn("移除",()=>amend({options:options.filter((_,j)=>i!==j)})))),
          kind==="poll"&&options.length<4&&btn("＋ 添加选项",()=>amend({options:[...options,""]})),
          kind==="relay"&&!picture&&h("small",null,"先放一张照片，朋友就能接着拍。")),
        h("div",{className:"j-assoc"},btn([glyph("album")," 关联约定",h("span",{key:"v"},album?titleOf(album):"选择 ›")],()=>AP(!albumPicker),"",{"aria-expanded":albumPicker}),
          albumPicker&&h("div",null,goalKey&&picture?btn(titleOf(goalKey),()=>{amend({album:goalKey});AP(false)}):h("small",null,!goalKey?"园里还没有约定。":"先选照片，再放进约定相册。"),album&&btn("取消关联",()=>{amend({album:""});AP(false)}))));
    }
    const valid=!!(draft.body.trim()||draft.picture||draft.kind==="poll")&&(draft.kind==="plain"||!!draft.prompt.trim())&&(draft.kind!=="relay"||!!draft.picture)&&(draft.kind!=="poll"||draft.options.every(s=>s.trim())&&new Set(draft.options.map(s=>s.trim())).size===draft.options.length);
    function poll(p){
      const voted=p.votes.some(v=>v.mine),sum=p.votes.reduce((s,v)=>s+v.n,0);
      return h("div",{className:"j-poll"},h("strong",null,p.prompt),p.options.map((opt,i)=>{const v=p.votes.find(v=>v.choice===i),pct=sum?Math.round(100*(v?.n||0)/sum):0;
        return btn([h("i",{key:"bar",style:{width:(voted?pct:0)+"%"}}),h("span",{key:"name"},(v?.mine?"✓ ":"")+opt),voted&&h("span",{key:"pct"},pct+"%")],()=>job(()=>vote(p,i)),"",{key:i,disabled:busy||voted})}),h("small",null,sum+" 人已投"));
    }
    function commentsBox(p,rows){
      return h("div",{className:"j-comments"},rows.map(c=>h("p",{key:c.id},h("b",null,author(c.member)+"　"),c.body)),h("form",{onSubmit:e=>{e.preventDefault();if(words.trim())job(async()=>{replyId.current||=crypto.randomUUID();if(demo)C(s=>[...s,{post:p.id,id:crypto.randomUUID(),member:"self",body:words.trim()}]);else{await write({type:"comment",post:p.id,id:replyId.current,body:words});await loadFeed(false,true)}W("");replyId.current=""})}},field("写评论",words,x=>{W(x);replyId.current=""},280),h("button",{disabled:busy||!words.trim()},"发送")));
    }
    function story(p){
      const src=imageSrc(p),notes=comments.filter(c=>c.post===p.id),m=mood(p.member),chosen=p.stickers.find(s=>s.mine),sCount=p.stickers.reduce((a,b)=>a+b.n,0),own=p.member===scope;
      const react=(emoji,active)=>job(async()=>{if(demo){update(p.id,x=>({...x,reactions:active?[...(x.reactions||[]),{member:scope,emoji}]:(x.reactions||[]).filter(r=>!(r.member===scope&&r.emoji===emoji))}));}else{await write({type:"v61-reaction",kind:"post",id:p.id,emoji,active});await loadFeed(false,true)}});
      const mutate=(type,values,local)=>job(async()=>{if(demo){if(type==="v61-post-delete")P(rows=>rows.filter(x=>x.id!==p.id));else update(p.id,x=>({...x,...local}));}else{await write({type,id:p.id,...values});await loadFeed(false,true)}Menu("");Edit(null)});
      const fav=()=>mutate("v61-favorite",{kind:"post",active:!p.favorite},{favorite:!p.favorite});
      const copy=()=>job(async()=>{if(!navigator.clipboard)throw Error("当前浏览器不支持复制");await navigator.clipboard.writeText(p.body||p.prompt||"");Menu("")});
      return h("article",{key:p.id,className:"j-story"},h("div",{className:"j-byline"},h("img",{src:face(p.member),alt:""}),h("div",null,h("b",null,author(p.member)),m&&h("span",{className:"j-mood"},m),h("small",null,new Date(p.created).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))),p.pinned&&h("small",{className:"v61-unread"},"置顶")),
        p.source&&h("div",{className:"v61-follow"},"↪ 跟发 · "+(posts.find(x=>x.id===p.source)?.body||"朋友的动态")),
        edit?.id===p.id?h("form",{className:"v61-form",onSubmit:e=>{e.preventDefault();mutate("v61-post-edit",{body:edit.body},{body:edit.body})}},h("textarea",{value:edit.body,onChange:e=>Edit({...edit,body:e.target.value}),maxLength:1000,"aria-label":"编辑动态内容"}),h("button",{className:"j-solid",disabled:busy},"保存"),btn("取消",()=>Edit(null))):p.body&&h("p",{className:"j-text"},p.body),src&&photoButton(src,"动态照片"),
        p.kind==="relay"&&btn([h("strong",{key:"t"},p.prompt),h("span",{key:"n"},"接一张 ›")],()=>go("relay",{id:p.id}),"j-relay-link"),
        p.kind==="poll"&&poll(p),p.album&&btn([glyph("album"),titleOf(p.album)+" · 约定相册 ›"],()=>go("album",{album:p.album}),"j-album-link"),
        p.album&&h("div",{className:"j-film"},(demo?mockAlbum(p.album).slice(0,3).map(x=>x.src):(p.albumPics||[]).map(id=>"/api/phone?image="+id)).map((src,i)=>h("img",{key:i,src,alt:"",loading:"lazy"}))),
        h("div",{className:"j-actions v61-j-actions"},h(EmojiBar,{rows:p.reactions||[],me:scope,name:author,onToggle:react}),btn([h(Icon,{key:"c",name:"聊",size:19}),notes.length||""],()=>{Q(reply===p.id?"":p.id);K("");W("");replyId.current=""},"v61-pill",{"aria-label":"评论","aria-expanded":reply===p.id}),btn([chosen?h("img",{key:"s",src:asset(chosen.sticker),alt:""}):"荔枝",sCount||""],()=>K(picker===p.id?"":p.id),"v61-pill",{"aria-label":"荔枝贴纸","aria-expanded":picker===p.id}),btn("···",()=>Menu(menu===p.id?"":p.id),"v61-menu-btn",{"aria-label":"更多操作","aria-expanded":menu===p.id})),
        picker===p.id&&h("div",{className:"j-stickers"},Object.entries(labels).map(([key,label])=>btn([h("img",{key:"i",src:asset(key),alt:""}),label],()=>job(()=>sticker(p,key)),"",{key,"aria-pressed":chosen?.sticker===key}))),
        menu===p.id&&h("div",{className:"v61-menu"},own&&btn("编辑动态",()=>{Edit({id:p.id,body:p.body||""});Menu("")}),own&&btn(p.pinned?"取消置顶":"置顶动态",()=>mutate("v61-post-pin",{pinned:!p.pinned},{pinned:!p.pinned})),btn(p.favorite?"取消收藏":"收藏动态",fav),btn("复制文字",copy),src&&h("a",{href:src,download:"荔枝照片.jpg"},"保存图片"),!own&&btn("跟发动态",()=>openComposer(p.id)),!demo&&share&&btn("分享到小队",()=>{if(confirm("分享到小队聊天？"))job(async()=>{await share("【园中事】"+(p.body||p.prompt||"照片动态"));Menu("")})}),own&&btn("删除动态",()=>{if(confirm("确定删除这条动态及其互动？"))mutate("v61-post-delete",{},{});},"v61-danger")),
        reply===p.id&&commentsBox(p,notes));
    }
    function grid(rows){return h("div",{className:"j-grid"},rows.map((row,i)=>h("figure",{key:row.id||i},photoButton(row.src,"相册照片"),h("figcaption",null,h("img",{src:face(row.member),alt:""}),author(row.member)))))}
    function detail(){
      const relay=view==="relay";
      return h("div",{className:"j-detail"},h("h2",null,relay?post?.prompt:titleOf(route.album)),relay&&post&&h("small",null,author(post.member)+" 发起 · "+(post.replies+1)+" 张照片"),
        relay&&post&&photoButton(imageSrc(post),"发起照片"),!detailLoaded&&!error&&h("p",null,"正在打开照片…"),grid(photos),detailLoaded&&!photos.length&&h("p",null,relay?"来接第一张照片吧。":"发布照片时，选「关联约定」就能放进这里。"),
        nextPhotos&&btn("更多照片",()=>job(async()=>{const rows=await details(photos.at(-1).cursor);F(s=>[...s,...rows]);N(rows.length===30)})));
    }
    if(view==="example")return h(Journal,{...props,demo:true,initialAlbum:"",back:pop,key:"garden-example"});
    const home=view==="feed", compose=view==="compose";
    const title=home?(demo?"园中事 · 例子":"园中事"):({compose:demo?"示例发布":"发园中事",relay:"照片接龙",album:"约定相册",photo:"看照片"})[view];
    return h("section",{className:"j-page"},h("div",{className:"j-nav"},
      h("div",{className:"j-leading"},btn(glyph("back"),pop,"j-back",{"aria-label":home&&demo?"退出例子":"返回"}),home&&!demo&&btn("例子",()=>go("example"),"j-example")),
      h("h1",null,title),h("div",{className:"j-trailing"},home&&btn([glyph("edit"),"发布"],()=>openComposer(),"j-solid",{"aria-label":"发布动态"}),home&&!demo&&btn(h(Icon,{name:"聊",size:20}),chat,"",{"aria-label":"小队聊天"+(unread?"，有未读消息":"")}),compose&&btn("发布",()=>job(publish),"j-solid",{disabled:busy||!valid}))),
      error&&h("div",{role:"alert",className:"j-error"},error," ",home?btn("刷新",()=>job(()=>loadFeed(false,true))):["relay","album"].includes(view)?btn("重试",()=>R(i=>i+1)):null),
      h("div",{className:"j-scroll",ref:scroll,key:view},home?h(React.Fragment,null,
        demo&&h("div",{className:"j-hint"},"在这里试试接龙、投票和贴纸。练习仅自己可见。"),
        !loaded&&!error&&h("p",null,"正在打开园中事…"),loaded&&!posts.length&&!error&&h("div",{className:"j-empty"},h("img",{src:asset("hug"),alt:""}),h("h2",null,"园里的第一条动态"),h("p",null,"拍张照片，或写一句今天的小事。"),btn("发布动态",()=>openComposer(),"j-solid")),h("div",{className:"v61-feed-tabs"},btn("全部动态",()=>Fav(false),"",{"aria-pressed":!favoritesOnly}),btn("我的收藏",()=>Fav(true),"",{"aria-pressed":favoritesOnly})),[...posts].filter(p=>!favoritesOnly||p.favorite).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.created-a.created).map(story),favoritesOnly&&!posts.some(p=>p.favorite)&&h("p",null,"暂时没有收藏动态"),more&&btn("更早的动态",()=>job(()=>loadFeed(true)))):compose?composer():view==="photo"?h("div",{className:"j-full"},h("img",{alt:route.title,src:route.src})):detail()),
      view==="relay"&&h("div",{className:"j-dock"},demo?btn("用示例照片接一张",()=>job(()=>addPhoto("",asset("plant"))),"j-solid"):upload("我也拍一张",pic=>addPhoto(pic),"j-solid")));
  }
  return Journal;
};
