import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,sep,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Browser} from '../../../../../source/test/edge.mjs';
const root=resolve('.'),src=dirname(fileURLToPath(import.meta.url)),out=dirname(src),local='/'+src.slice(root.length+1).replaceAll('\\','/')+'/';
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.woff2':'font/woff2','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),p=resolve(root,'.'+path);if(!p.startsWith(root+sep)||!([local,'/source/source/web/','/source/client/'].some(prefix=>path.startsWith(prefix))))throw Error();res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream'});res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port;
const screen={home:'01-荔圈首页',me:'02-我',chat:'03-猪圈群聊',clock:'04-番茄钟',profile:'05-个人资料编辑'};
const theme={orchard:'01-原味荔枝园',kitty:'02-凯蒂荔枝茶会',miffy:'03-米菲采荔枝',tutu:'04-图图树下'};
const extras={contacts:'01-我的好友',add:'02-添加好友',requests:'03-好友申请',style:'04-头像与主题',wallpaper:'05-AI聊天壁纸',friend:'06-好友资料',groupinfo:'07-群详情',plus:'08-群聊展开加号',emotes:'09-群聊展开表情',pinned:'10-回到置顶原消息',crop:'11-上传头像裁切',restore:'12-恢复主题壁纸',funStatus:'13-趣味状态候选'};
const browser=new Browser();
try{await browser.open();await browser.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  async function capture(page,skin,folder,file){
    await mkdir(join(out,folder),{recursive:true});
    await browser.call('Page.navigate',{url:base+encodeURI(local+'预览.html')+'?page='+page+'&theme='+skin});
    for(let n=0;n<70;n++){const ready=await browser.js('document.readyState==="complete"&&!!document.querySelector(".gesture")');if(ready)break;await new Promise(r=>setTimeout(r,50));}
    await browser.js('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))');
    await browser.js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const audit=await browser.js('({p:document.querySelector("#app").className,images:[...document.images].every(i=>i.naturalWidth>0),header:document.querySelector("h1")?.innerText,scroll:document.querySelector(".scroll")?.scrollHeight||0,space:document.querySelector(".scroll")?.clientHeight||0,body:document.body.scrollWidth,status:document.querySelector(".status").innerText})');
    if(!audit.images||!audit.header||!audit.p.includes('page-'+page)||audit.body!==390)throw Error(JSON.stringify(audit));
    const shot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(out,folder,file+'.png'),Buffer.from(shot.data,'base64'));console.log(page,skin,audit.scroll-audit.space);
  }
  for(const [key,folder] of Object.entries(screen))for(const [skin,label] of Object.entries(theme))await capture(key,skin,folder,label);
  for(const [page,file] of Object.entries(extras))await capture(page,'orchard','06-个人与群聊内页',file);
  if(browser.errors.length)throw Error(browser.errors.join('\n'));
}finally{await browser.close();await new Promise(r=>server.close(r));}
