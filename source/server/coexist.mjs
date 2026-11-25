import {createApp,serveRequest} from './index.mjs';
import {createTursoClient} from './turso-client.mjs';
import {oldCookie} from './accounts.mjs';

export function createV640Mount({origin,env=process.env,legacyDir}){
  let opening;
  let retryAfter=0;
  async function open(){
    const turso={url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN};
    const probe=await createTursoClient({...turso,legacyDir});
    try{
      const prepared=await probe.execute('SELECT ready FROM mc_v640_install WHERE id=1');
      if(Number(prepared.rows[0]?.ready)!==1)throw Error('Migration pending');
    }finally{probe.close();}
    return createApp({storage:'turso',turso,origin,legacyDir});
  }
  async function activeApp(){
    if(env.LYCHEE_MULTICLIENT_ENABLED!=='1'||Date.now()<retryAfter)return null;
    if(!opening)opening=open().catch(error=>{
      opening=undefined;retryAfter=Date.now()+10000;
      console.error('Lychee new service is unavailable:',error.name);
      throw error;
    });
    try{return await opening;}catch{return null;}
  }
  async function serve(req,res){
    const app=await activeApp();
    if(!app){res.writeHead(503,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','retry-after':'10'}).end(JSON.stringify({error:'新版服务正在准备中'}));return;}
    const url=new URL(req.url,origin);
    if(url.pathname==='/api/client-capabilities'&&url.searchParams.get('accountApi')!=='v640'){
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({
        protocol:1,version:'6.4.0',accountApi:'v640',privateGardens:false,accountNotices:false,updateRequired:true,
      }));
      return;
    }
    await serveRequest(app,req,res,origin);
  }
  serve.legacyAi=async request=>{
    const app=await activeApp();
    if(!app)return Response.json({error:'AI 服务正在准备中'},{status:503,headers:{'cache-control':'no-store'}});
    const headers=new Headers(request.headers);
    headers.set('cookie',(headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(oldCookie+'=')).join('; '));
    return app.handle(new Request(request,{headers}));
  };
  return serve;
}
