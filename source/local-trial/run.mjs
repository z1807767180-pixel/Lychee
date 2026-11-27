import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {access,mkdir,mkdtemp,readFile,rename,writeFile,lstat,readdir,rmdir,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const app=dirname(dirname(fileURLToPath(import.meta.url)));
const port=48365,origin='http://127.0.0.1:'+port,edition='lychee-social-local-v1';
const {values}=parseArgs({options:{'no-open':{type:'boolean'},'data-dir':{type:'string'}}});
// Pass only ordinary operating-system paths to the server and its worker threads.
const operatingSystem=new Set(['SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','LANG','TZ','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']);
for(const name of Object.keys(process.env))if(!operatingSystem.has(name.toUpperCase()))delete process.env[name];
const {listen}=await import('../server/index.mjs');
const base=resolve(values['data-dir']||join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'LycheeLocalUiTrial'));
const data=join(base,'profile-v1'),web=join(app,'web');
const password='Lychee-Trial-8';
async function main(){
  await access(join(web,'mobile','index.html'));
  await mkdir(base,{recursive:true});
  if(!await exists(data))await prepare();
  const marker=JSON.parse(await readFile(join(data,'trial-profile.json'),'utf8'));
  if(marker.edition!==edition)throw Error('该目录已用于其他数据，请另选试用目录。');
  let service;
  try{service=await listen({host:'127.0.0.1',port,dataDir:data,webRoot:web,legacyDir:join(app,'legacy'),storage:'sqlite'});}
  catch(error){
    if(error.code!=='EADDRINUSE')throw error;
    const running=await fetch(origin+'/trial-id.json',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).catch(()=>null);
    if(running?.edition!==edition)throw Error('试用端口 48365 已被其他程序占用。');
    console.log('本地试用已在运行：'+origin+'/mobile/');
    if(!values['no-open'])openBrowser();
    return;
  }
  console.log('荔枝本地试用已就绪：'+origin+'/mobile/');
  console.log('切换试用角色：'+origin+'/trial.html');
  console.log('默认账号 青禾　口令 '+password+'\n试用数据：'+data+'\n输入 q 后回车，或按 Ctrl+C 结束本次试用。');
  if(!values['no-open'])openBrowser();
  let stopping=false;
  function onInput(chunk){if(String(chunk).trim().toLowerCase()==='q')void stop();}
  async function stop(){if(stopping)return;stopping=true;process.stdin.removeListener('data',onInput);process.stdin.pause();await service.close();}
  process.stdin.on('data',onInput);
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
function openBrowser(){
  const executable=join(process.env.SystemRoot||'C:\\Windows','System32','rundll32.exe');
  const p=spawn(executable,['url.dll,FileProtocolHandler',origin+'/trial.html?start=1'],{detached:true,windowsHide:true,stdio:'ignore'});
  p.on('error',()=>console.log('请在浏览器打开 '+origin+'/trial.html?start=1'));p.unref();
}
async function exists(path){try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}

async function prepare(){
  // Publish the completed fixture as one directory. A concurrent first launch
  // either sees this complete profile or finishes its own independent seed.
  const staging=await mkdtemp(join(base,'.lychee-seed-'));
  let published=false;
  try{
    const service=await listen({host:'127.0.0.1',dataDir:staging,webRoot:web,legacyDir:join(app,'legacy'),storage:'sqlite'});
    try{await seed(service.url);}finally{await service.close();}
    await writeFile(join(staging,'trial-profile.json'),JSON.stringify({edition,created:new Date().toISOString()})+'\n');
    try{await rename(staging,data);published=true;}
    catch(error){if(!await exists(data))throw error;}
  }finally{
    if(!published&&dirname(staging)===base&&/^\.lychee-seed-[a-zA-Z0-9]{6}$/.test(basename(staging)))await removeTemporary(staging);
  }
}
async function removeTemporary(path){
  const info=await lstat(path);
  if(info.isSymbolicLink())throw Error('试用临时目录含链接，已保留。');
  if(!info.isDirectory()){await unlink(path);return;}
  for(const entry of await readdir(path))await removeTemporary(join(path,entry));
  await rmdir(path);
}
async function seed(url){
  async function api(user,path,body){
    const response=await fetch(url+path,{method:body?'POST':'GET',headers:{origin:url,cookie:user.cookie||'','content-type':'application/json'},body:body&&JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw Error('创建试用场景失败（'+response.status+'）：'+(result.error||path));
    const cookie=response.headers.getSetCookie()[0];if(cookie)user.cookie=cookie.split(';')[0];
    return result;
  }
  const accounts=[];
  for(const [name,avatar] of [['青禾',0],['阿青',1],['小满',2],['栗子',3]]){
    const u={name,avatar};
    await api(u,'/api/v640/account',{mode:'register',name,password});
    u.id=(await api(u,'/api/v640/workspace')).account.id;accounts.push(u);
  }
  const [owner,friend,other,guest]=accounts;
  const act=(u,action,fields={})=>api(u,'/api/v8/social?accountId='+u.id,{action,...fields});
  const scoped=(u,g,route)=>'/g/'+g+'/api/for/'+u.id+'/'+route;
  for(const u of accounts){
    const home=await api(u,'/api/v8/social?accountId='+u.id);
    await api(u,scoped(u,home.accountToolsGardenId,'phone'),{type:'avatar',avatar:u.avatar});
    if(u===owner)continue;
    await act(owner,'friendRequest',{accountId:u.id});await act(u,'friendAccept',{accountId:owner.id});
  }
  const pig=(await act(owner,'groupCreate',{name:'猪圈',friendIds:[friend.id,other.id]})).id;
  const walk=(await act(owner,'groupCreate',{name:'周末散步团',friendIds:[friend.id,guest.id]})).id;
  for(const [g,members] of [[pig,[owner,friend,other]],[walk,[owner,friend,guest]]]){
    for(const u of members)await api(u,scoped(u,g,'phone'),{type:'avatar',avatar:u.avatar});
  }
  const inDays=n=>{const d=new Date();d.setDate(d.getDate()+n);d.setHours(16,0,0,0);return +d;};
  await act(owner,'goalSave',{title:'去公园写生',body:'带上速写本和铅笔。',due:inDays(1)});
  const groupText=(user,groupId,body)=>act(user,'message',{groupId,body,clientId:randomUUID()});
  await groupText(owner,pig,'刚去小院看过，树上的荔枝开始红了。');
  await groupText(friend,pig,'给你们看看今天摘的这一篮。');
  const picture=(await readFile(join(app,'trial-basket.jpg'))).toString('base64');
  await api(friend,scoped(friend,pig,'camp'),{type:'note',name:friend.name,avatar:friend.avatar,key:randomUUID(),picture,body:''});
  await groupText(other,pig,'周末一起去吧！我带茶。');
  await groupText(owner,walk,'明天下午去公园吗？');
  await groupText(guest,walk,'可以，我来找集合点。');
  await act(friend,'message',{friendId:owner.id,body:'写生那天我带一盒新颜料。',clientId:randomUUID()});
  await act(other,'post',{kind:'feed',body:'院子里的荔枝红了。等太阳落下去，再去树下走一圈。',clientId:randomUUID()});
  await act(friend,'post',{kind:'questions',title:'你最近在读哪本书？',body:'周末想去图书馆，想听听你们的推荐。',clientId:randomUUID()});
  for(const u of [friend,other]){await act(u,'water');await act(u,'gift',{friendId:owner.id,clientId:randomUUID()});}
  const result=await api(owner,'/api/v8/social?accountId='+owner.id);
  if(result.friends.length!==3||result.groups.length!==2||result.unread.feed!==1||result.unread.questions!==1||result.tree.fruit!==2)throw Error('初次试用场景校验失败。');
}
try{await main();}catch(error){console.error('本地试用未启动。'+error.message);process.exitCode=1;}

