import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Browser} from '../../../../source/test/edge.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,'../../../..');
const images=new Map();
function asset(f){const path=f.startsWith('c:')?'source/client/'+f.slice(2):f.startsWith('s:')?'source/source/web/scenes/'+f.slice(2):'source/source/web/mobile/'+f;
  const id='/art/'+f.replaceAll(':','_');images.set(id,resolve(repo,path));return id;}
function img(f,cls=''){return '<img class="'+cls+'" alt="" src="'+asset(f)+'">';}
const svg={
 back:'<path d="m14.5 5-7 7 7 7"/>',next:'<path d="m9 6 6 6-6 6"/>',plus:'<path d="M12 5v14m-7-7h14"/>',
 list:'<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="18" r=".6"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-14 4h2m3 0h2m-7 3h2"/>',
 camera:'<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3"/>',press:'<path d="m9 5 10 7-10 7z"/>',
 check:'<path d="m5 12 4 4 10-10"/>',clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
 pen:'<path d="m5 15 10-11 4 4L9 19l-5 1zM13 6l4 4"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 19c0-7 12-7 12 0m0-13c5 0 5 6 1 6m1 2c3 0 5 2 5 5"/>',
 solo:'<circle cx="12" cy="8" r="3"/><path d="M5 20c0-8 14-8 14 0"/>',send:'<path d="m4 11 16-7-5 16-4-6zM11 14l5-6"/>',
 hist:'<path d="M3 6v5h5"/><path d="M4 10a8 8 0 1 1 2 8"/><path d="M12 7v5l4 2"/>',
 tune:'<path d="M3 7h7m5 0h6M3 17h12m5 0h1"/><circle cx="12" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
 picture:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><path d="m4 17 5-5 4 4 3-4 5 6"/>',
 spark:'<path d="m12 3 1.8 6.7L20 12l-6.2 2.1L12 21l-2-6.9L4 12l6-2.3z"/>'};
const ico=(n,w=19)=>'<svg width="'+w+'" height="'+w+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+svg[n]+'</svg>';
const btn=(t,ic='plus',quiet=false)=>'<div class="button '+(quiet?'quiet':'')+'">'+ico(ic)+'<b>'+t+'</b></div>';
const head=(t,r='')=>'<div class="sectionHead"><h2>'+t+'</h2>'+(r?'<small>'+r+'</small>':'')+'</div>';
const tabs=(opts,index=0)=>'<div class="tabs">'+opts.map((x,i)=>'<b class="'+(i===index?'sel':'')+'">'+x+'</b>').join('')+'</div>';
const cap=(t)=>'<div class="caption">'+t+'</div>';
const tag=(t)=>'<span class="tag">'+t+'</span>';
const lines=(rows)=>rows.map(([a,b,c])=>'<div class="line">'+a+'<span>'+b+'</span>'+(c?'<b>'+c+'</b>':'')+'</div>').join('');
const smallPic=(path)=>img(path,'thumb');
const cover=(f,cls='')=>'<div class="cover '+cls+'">'+img(f)+'</div>';
const pairGame=(solo,team)=>'<div class="pairGame"><div>'+ico('solo',21)+'<span><b>自己玩</b><small>'+solo+'</small></span></div><div>'+ico('users',21)+'<span><b>邀请好友</b><small>'+team+'</small></span></div></div>';
const sourceData=JSON.parse(await readFile(resolve(repo,'source/server/circle-puzzles.json'),'utf8'));
const soup=sourceData.soups.find(x=>x.id==='garden-ninth-address'),riddle=sourceData.riddles.find(x=>x.id==='garden-quick-index');
const pages=[];
function page(name,right,cls,body){pages.push({name,right,cls,body});}

const wheel='<div class="wheelScene"><div class="wheel"><span>看电影</span><span>散步</span><span>逛书店</span><span>打球</span>'+img('c:wheel-hub-v7.webp')+'</div><i class="needle"></i></div>';
page('交给命运','', 'fate',
  '<div class="questionHead"><span>本轮主题</span><h2>周末做什么？</h2>'+ico('pen')+'</div>'+wheel+btn('转动转盘','press')+head('我的选项','4 个选项')+
  '<div class="choiceGrid">'+['看电影','散步','逛书店','打球'].map((x,i)=>'<div><i style="--c:'+['#d49b83','#91aa95','#c19b58','#a5a4bc'][i]+'"></i>'+x+'</div>').join('')+'</div><div class="textAction">＋ 添加选项</div>');

const week=['一','二','三','四','五','六','日'].map((n,i)=>'<div class="day '+(i===4?'now':'')+'"><small>'+n+'</small><b>'+(22+i)+'</b><i class="'+([0,1,3,4].includes(i)?'logged':'')+'"></i></div>').join('');
page('照记饮食','', 'diet', '<div class="weekHead"><b>2026 年 6 月</b><span>'+ico('back',14)+' 本周 '+ico('next',14)+'</span></div><div class="week">'+week+'</div>'+
  '<div class="nutrition">'+img('c:diet-banner-v7.webp')+'<div class="nutSum"><span>今日摄入估算</span><p><strong>865</strong> 千卡</p></div><div class="macros">'+[['42','蛋白质'],['97','碳水'],['35','脂肪']].map(([n,v])=>'<div><small>'+v+'</small><b>'+n+' g</b></div>').join('')+'</div></div>'+
  btn('拍照记一餐','camera')+head('饮食记录','6 月 26 日 · 两餐')+
  '<div class="food"><i>早</i><div><b>燕麦牛奶、煮鸡蛋</b><small>08:10 · 早餐</small></div><strong>325 <small>千卡</small></strong></div><div class="food"><i>午</i><div><b>米饭、番茄炒蛋、青菜</b><small>12:20 · 午餐</small></div><strong>540 <small>千卡</small></strong></div>');

const taskRow=(name,time,done=false)=>'<div class="task '+(done?'done':'')+'"><i>'+(done?ico('check',13):'')+'</i><div><b>'+name+'</b><small>'+time+'</small></div></div>';
page('提醒事项','日历','tasks','<div class="dateHero"><div>'+cap('六月')+'<strong>26</strong><b>星期五</b></div><div class="dateCopy"><h2>今天要做的事</h2><p>还有 2 件待办</p></div>'+img('ai-icon-write.webp')+'</div>'+
 tabs(['全部','待完成','已完成'])+head('今天','6 月 26 日')+
 '<div class="taskList">'+taskRow('取预约的画材','10:30 提醒')+taskRow('给小满带一本书','17:00 提醒')+taskRow('浇阳台的薄荷','08:00 · 已完成',true)+'</div>'+head('明天','6 月 27 日')+
 '<div class="taskList">'+taskRow('整理本周照片','09:30 提醒')+'</div>'+btn('新建提醒','plus'));

page('番茄钟','设置','focus',tabs(['专注','短休息','长休息'])+'<div class="clockPlate">'+img('ledger-clock.webp')+'</div>'+
 '<div class="focusTask">'+ico('pen')+'<div><small>专注任务</small><b>读完今天的十页书</b></div>'+ico('next',15)+'</div>'+btn('开始专注','press')+
 head('今日专注','查看记录 ›')+'<div class="focusCount"><div><strong>2</strong> 个番茄</div><div><strong>50</strong> 分钟</div></div>');

page('记账本','', 'ledger', '<div class="ledgerSummary"><div class="month">2026 年 6 月　⌄</div><small>本月支出</small><p>¥ <strong>1,356.00</strong></p><div class="sumFoot"><span>收入 <b>4,800.00</b></span><span>结余 <b>3,444.00</b></span></div>'+img('ledger-stall.webp')+'</div>'+
 '<div class="dual">'+btn('记支出','pen')+btn('记收入','plus',true)+'</div>'+head('收支明细','全部类别　⌄')+
 '<div class="recordDay">6 月 26 日 <small>星期五</small></div>'+lines([[smallPic('ledger-cat0.webp'),'<b>园边小馆</b><small>餐饮 · 午餐</small>','−28.00'],[smallPic('ledger-cat1.webp'),'<b>公交车</b><small>交通 · 出行</small>','−2.00']])+
 '<div class="recordDay">6 月 25 日 <small>星期四</small></div>'+lines([[smallPic('ledger-cat0.webp'),'<b>水果摊</b><small>餐饮 · 水果</small>','−18.50']]));

const rankRow=(i,name,stars,face)=>'<div class="rank"><i>'+i+'</i>'+img('s:portrait-'+face+'.webp')+'<b>'+name+'</b><span>'+stars+'</span></div>';
page('头脑王者','', 'quiz', '<div class="quizStage">'+img('c:quiz-card-v7.webp')+'<div><span>好友问答对战</span><h2>来答五道题</h2></div></div>'+
 '<div class="rules"><div><b>5</b><span>道题</span></div><div><b>10</b><span>秒 / 题</span></div><div><b>×2</b><span>末题分数</span></div></div>'+btn('邀请好友对战','users')+head('好友排行','按段位与星数')+
 '<div class="ranking">'+rankRow(1,'阿青','黄金 · 7 星',1)+rankRow(2,'青禾','白银 · 4 星',0)+rankRow(3,'小满','青铜 · 2 星',2)+'</div>');

const board='<div class="wood">'+img('gomoku-shelf.webp')+'<div class="board"><div class="grid">'+[[3,3],[11,3],[7,7],[3,11],[11,11]].map(([x,y])=>'<i style="left:'+x/14*100+'%;top:'+y/14*100+'%"></i>').join('')+'</div></div></div>';
page('五子棋','', 'gomoku', '<div class="boardTitle"><h2>好友棋室</h2><span><i></i>等待开局</span></div>'+board+
 '<div class="seat"><div><i class="piece dark"></i><b>黑棋先手</b></div><span>对</span><div><b>白棋后手</b><i class="piece light"></i></div></div>'+btn('邀请好友入局','users')+head('对弈规则')+'<p class="plain">两人轮流落子，横、竖或斜线先连成五子的玩家获胜。好友接受邀请后，双方就座。</p>');

page('海龟汤','玩法', 'soup','<div class="detective">'+img('tile-soup.webp')+'<div>'+cap('海龟汤推理室')+'<h2>从汤面里<br>找真相</h2></div></div>'+
 pairGame('独自问主持','一起猜汤底')+'<div class="casePaper"><div class="caseTop">'+cap('题库汤面')+'<span>寓言</span></div><h2>'+soup.title+'</h2><p>'+soup.surface.replace('【寓言】','')+'</p></div>'+
 '<div class="note">'+ico('users')+'<span>邀请好友后，一起向主持提问，猜出汤底。</span></div>');

page('脑筋急转弯','', 'riddle','<div class="riddleScene">'+img('riddle-picnic.webp')+'</div>'+
 '<div class="riddleCard"><div class="caseTop">'+cap('题库一瞥')+'<span>常规 · 换个角度</span></div><h2>'+riddle.prompt+'</h2></div>'+pairGame('答题库里的题','和好友互相出题')+
 head('练习题库')+'<div class="decks"><span><b>常规</b><small>换个角度</small></span><span><b>进阶</b><small>情境思考</small></span><span><b>困难</b><small>逻辑推理</small></span></div>');

page('AI 助手','历史记录','aiChat', '<div class="chatArt">'+img('ai-chat-hero.webp')+'</div>'+
 '<div class="chatHello"><div class="helloTitle">'+img('ai-chat-tile.webp')+'<h2>有什么想聊的？</h2></div><span>今日问答剩余 18 / 20 次</span></div>'+
 '<div class="suggest">'+[['ai-icon-life.webp','想想周末怎么过'],['ai-icon-write.webp','帮我润色一段话'],['ai-icon-study.webp','一起理清学习思路']].map(([a,t])=>'<div>'+img(a)+'<b>'+t+'</b>'+ico('next',14)+'</div>').join('')+'</div>'+
 '<div class="chatComposer"><div class="composeText">周六想和朋友去野餐，可以准备些什么？</div><div class="composeFoot"><span>深度思考</span><span>联网搜索</span><b>'+ico('send',16)+'发送</b></div></div>');

page('AI 生图','生成记录','aiImage', '<div class="atelier">'+img('ai-image-hero.webp','atelierArt')+'<div class="sketch"><span class="sketchLabel">'+img('ai-image-tile.webp')+'画面描述</span><p>雨后的小院里，木桌上放着一篮刚摘的荔枝，远处有一只打盹的猫。</p><div class="paperFoot">'+ico('picture',15)+' 添加参考图</div></div>'+
 '<div class="imageSettings"><div><small>画面风格</small><b>温暖插画　⌄</b></div><div><small>画幅比例</small><b>1:1 方形　⌄</b></div></div>'+
 btn('生成图片','spark')+'</div><div class="limit">今日生图剩余 9 / 10 张</div>');

const navNames=['荔圈','荔枝园','工具箱','我'],navAssets=['chat','garden','tools','me'];
function phone(p){
  return '<article class="phone '+p.cls+'">'+img('c:social-corner-orchard.webp','orchardMark')+'<div class="status"><b>9:41</b><svg width="51" height="13" viewBox="0 0 51 13" fill="currentColor"><path d="M1 10h2v2H1zm4-2h2v4H5zm4-3h2v7H9zm4-3h2v10h-2zM19 4q6-5 12 0l-1.5 1.5q-4.5-3.5-9 0zm3 3q3-2.7 6 0l-3 4z"/><rect x="34" y="2" width="14" height="9" rx="2" fill="none" stroke="currentColor"/><rect x="36" y="4" width="10" height="5" rx="1"/><path d="M49 4h1v4h-1z"/></svg></div><header>'+ico('back',20)+'<h1>'+p.name+'</h1><span>'+p.right+'</span></header><main>'+p.body+'</main><nav>'+navNames.map((v,i)=>'<div class="'+(i===2?'active':'')+'"><i>'+img('nav-'+navAssets[i]+(i===2?'-on.webp':'-line.svg'))+([0,1].includes(i)?'<em>'+(i===0?4:2)+'</em>':'')+'</i><b>'+v+'</b></div>').join('')+'<div class="homebar"></div></nav></article>';
}

const css=await readFile(resolve(here,'设计.css'),'utf8');
const font1=asset('c:fonts/LXGW975YuanSC-500W.woff2'),font2=asset('c:fonts/LXGW975YuanSC-700W.woff2');
const screens=pages.map(phone);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const file=images.get(path);
  if(file){try{res.writeHead(200,{'Content-Type':({'.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'})[extname(file)]});res.end(await readFile(file));}catch{res.end();}return;}
  const index=Number(path.slice(1));if(!screens[index]){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset=utf-8><style>@font-face{font-family:Yuan;src:url("'+font1+'");font-weight:500}@font-face{font-family:Yuan;src:url("'+font2+'");font-weight:700}'+css+'</style>'+screens[index]+'</html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=new Browser();
try{
  await browser.open();await browser.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:false});
  for(const [i,p] of pages.entries()){
    await browser.call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'+i});
    for(let k=0;k<100 && !await browser.js('document.querySelector("h1")?.textContent==='+JSON.stringify(p.name));k++)await new Promise(r=>setTimeout(r,30));
    const proof=await browser.js('(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));const b=e=>e.getBoundingClientRect(),main=document.querySelector("main"),last=main.lastElementChild,nav=document.querySelector("nav");return {font:document.fonts.check("700 18px Yuan"),width:document.documentElement.scrollWidth,height:b(document.querySelector(".phone")).height,gap:Math.round(b(nav).top-b(last).bottom)}})()');
    if(proof.width!==390||proof.height!==844||proof.gap<4||!proof.font)throw Error(p.name+': '+JSON.stringify(proof));
    const shot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(resolve(here,String(i+1).padStart(2,'0')+'-'+p.name+'.png'),Buffer.from(shot.data,'base64'));
    console.log(p.name,proof.gap);
  }
}finally{await browser.close();server.close();}
