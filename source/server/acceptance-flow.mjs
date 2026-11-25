import {randomUUID} from 'node:crypto';
export const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const imageId=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const account='/api/v640/account',workspace='/api/v640/workspace';
const capabilities='/api/client-capabilities?accountApi=v640';
export const requireThat=(value,code)=>{if(!value)throw new AcceptanceError(code);};
export class AcceptanceError extends Error {}

export function acceptanceSession({origin,transportOrigin=origin,beforePost=async()=>{}}){
  let cookie='';
  return async function call(path,{body,mark,expected=200}={}){
    requireThat(path.startsWith('/api/v640/')||path.startsWith('/g/')||path===capabilities,'invalid-route');
    if(body){
      requireThat(/^[a-z0-9-]+$/.test(mark??''),'required-ledger-entry');
      await beforePost(mark);
    }
    let response;
    try{
      response=await fetch(transportOrigin+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(130000),
        headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    }catch{throw new AcceptanceError('request-outcome-unknown');}
    requireThat(response.status===expected,'http-'+response.status);
    if(expected!==200){await response.body?.cancel();return;}
    const token=response.headers.getSetCookie().find(c=>c.startsWith('__Host-lychee-account='));
    if(token)cookie=token.split(';')[0];
    if(response.headers.get('content-type')?.startsWith('image/'))return new Uint8Array(await response.arrayBuffer());
    return response.json();
  };
}
const pinned=(g,id)=>'/g/'+g+'/api/for/'+id+'/';
const confirm=(s,u,g,name,role)=>s.account?.id===u.id&&s.account.username===u.name&&s.gardens?.length===1&&
  s.gardens[0].id===g&&s.gardens[0].name===name&&s.gardens[0].role===role&&s.activeGardenId===g;
const login=(call,u,mark)=>call(account,{mark,body:{mode:'login',name:u.name,password:u.password}});

export async function checkCapabilities(session){
  const result=await session()(capabilities);
  requireThat(result.version==='6.4.0'&&result.accountApi==='v640'&&result.privateGardens===true&&result.accountNotices===true,'capabilities-unavailable');
}
export async function prepareTestGarden({session,users,name}){
  const clients=users.map(()=>session());
  for(const [i,u] of users.entries()){
    await clients[i](account,{mark:'register-'+i,body:{mode:'register',name:u.name,password:u.password}});
    const s=await clients[i](workspace);
    requireThat(uuid(s.account?.id)&&s.account.username===u.name&&s.gardens?.length===0,'fresh-account-required');
    u.id=s.account.id;
  }
  const created=await clients[0](workspace,{mark:'create-garden',body:{action:'create',name}}),g=created.activeGardenId;
  requireThat(uuid(g)&&confirm(created,users[0],g,name,'owner'),'fresh-garden-required');
  const invited=await clients[0](workspace,{mark:'issue-invite',body:{action:'invite',gardenId:g}});
  requireThat(typeof invited.inviteCode==='string'&&invited.inviteCode.length>20,'invite-unavailable');
  const joined=await clients[1](workspace,{mark:'join-member',body:{action:'join',code:invited.inviteCode}});
  requireThat(confirm(joined,users[1],g,name,'member'),'join-failed');
  await clients[2](pinned(g,users[2].id)+'camp',{expected:403});
  const notice=created.notices?.find(n=>n.id==='release-6.4.0');
  requireThat(notice&&!notice.read,'new-notice-unavailable');
  await clients[0](workspace,{mark:'read-notice',body:{action:'read',noticeId:notice.id}});
  const key=randomUUID(),note='验收-'+name;
  await clients[0](pinned(g,users[0].id)+'camp',{mark:'save-note',body:{type:'note',key,name:users[0].name,avatar:0,body:note}});
  for(const [i,role] of ['owner','member'].entries()){
    const fresh=session(),u=users[i];
    await login(fresh,u,'relogin-'+i);
    const s=await fresh(workspace),roster=await fresh(pinned(g,u.id)+'camp?roster=lychee');
    requireThat(confirm(s,u,g,name,role)&&s.notices.find(n=>n.id===notice.id)?.read===(i===0),'relogin-readback-failed');
    requireThat(roster.notes?.some(n=>n.id==='chat.1.'+key&&n.body===note),'message-readback-failed');
  }
  return {name,garden:g,owner:users[0]};
}

export async function verifyProviders({session,saved,beforeCalls=async()=>{},withAttempt=(_,task)=>task()}){
  const {garden}=saved,call=session(),base=pinned(garden,saved.owner.id);
  await login(call,saved.owner,'ai-login');
  requireThat(confirm(await call(workspace),saved.owner,garden,saved.name,'owner'),'garden-or-identity-mismatch');
  const status=await call(base+'phone?v62=status'),room=base+'camp?soup=1&room=solo',initial=await call(room);
  requireThat(status.chat===true&&status.image===true&&initial.ready===true,'provider-readiness-failed');
  requireThat(!initial.round&&!Number(status.used?.chat)&&!Number(status.used?.image),'unused-pilot-required');
  await beforeCalls();
  await withAttempt('chat',async()=>{
    const thread=randomUUID();
    const chat=await call(base+'phone',{mark:'ai-chat',body:{type:'v62-chat',id:thread,prompt:'答好',thinking:false,web:false}});
    const history=await call(base+'phone?v62=thread&id='+thread);
    requireThat(typeof chat.reply==='string'&&chat.reply.trim()&&history.messages?.at(-1)?.body===chat.reply,'chat-readback-failed');
  });
  await withAttempt('image',async()=>{
    const picture=await call(base+'phone',{mark:'ai-image',body:{type:'v62-image',prompt:'荔枝',ratio:'1:1',style:'自由创作'}});
    requireThat(imageId(picture.id),'image-missing');
    const image=await call(base+'phone?v62=image&id='+picture.id);
    requireThat(image instanceof Uint8Array&&image.length>=100&&image[0]===255&&image[1]===216,'image-readback-failed');
  });
  await withAttempt('soup',async()=>{
    await call(base+'camp',{mark:'solo-local-start',body:{type:'soup',room:'solo',act:'start',round:0,filter:'全部'}});
    const round=(await call(room)).round;
    requireThat(Number.isSafeInteger(round?.id)&&round.id<0&&!round.turns?.length,'solo-round-unavailable');
    await call(base+'camp',{mark:'ai-soup',body:{type:'soup',room:'solo',act:'send',round:round.id,mode:'ask',body:'是人吗？',token:randomUUID()}});
    const observed=(await call(room)).round;
    requireThat(observed?.id===round.id&&observed.turns?.length===1&&['是','不是','部分正确','无关','无法确定'].includes(observed.turns[0].reply),'soup-readback-failed');
  });
}

// Read the earlier paid pilot's saved picture through a new session after an upgrade.
export async function verifyStoredPicture({session, owner, garden, ownerId}) {
  requireThat(uuid(garden)&&uuid(ownerId),'invalid-readback-garden');
  const call=session();
  await login(call,owner,'album-login');
  const state=await call(workspace);
  requireThat(state.account?.id===ownerId && state.account?.username===owner.name &&
    state.activeGardenId===garden && state.gardens?.some(g=>g.id===garden && g.role==='owner'),'album-owner');
  const base=pinned(garden,ownerId)+'phone';
  const status=await call(base+'?v62=status');
  requireThat(status.image===true && status.limits?.image===10 && Number.isInteger(status.remaining?.image) &&
    status.remaining.image>=0 && status.remaining.image<=10,'album-quota');
  const album=await call(base+'?v62=images');
  const picture=album.images?.find(row=>row.prompt==='荔枝' && imageId(row.id));
  requireThat(picture,'pilot-picture-missing');
  const body=await call(base+'?v62=image&id='+picture.id);
  requireThat(body instanceof Uint8Array && body.length>100 && body[0]===255 && body[1]===216,'pilot-picture-invalid');
}
