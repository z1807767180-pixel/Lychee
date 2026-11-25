import {createHmac} from 'node:crypto';
import {acceptanceSession,checkCapabilities,prepareTestGarden,requireThat,uuid,verifyProviders,verifyStoredPicture} from './acceptance-flow.mjs';
import {createTursoClient} from './turso-client.mjs';
import {createAcceptanceReceipts} from './acceptance-receipts.mjs';
import {verifyMemberEditing} from './acceptance-members.mjs';

const publicOrigin='https://lychee-link-check.onrender.com';
function localListener(value){
  const url=new URL(value);
  return url.origin===value&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Boolean(url.port);
}
function credentials(seed,origin){
  const derive=label=>createHmac('sha256',seed).update('lychee-v640-smoke-v1\n'+origin+'\n'+label).digest('hex');
  const tag=derive('username').slice(0,10),name='验收园-'+tag;
  const users=['甲','乙','丙'].map((label,i)=>({name:'验'+tag+label,password:derive('password-'+i)}));
  return {users,name};
}

// Only the existing listener's startup callback calls this function. All app
// traffic is sent to its loopback socket; Origin stays the app's canonical origin.
export async function runServerAcceptance({mode,env=process.env,origin,loopbackOrigin,legacyDir}={}){
  if(mode===undefined||mode==='')return {status:'disabled'};
  const modes=['prepare','ai','members','album'];
  const output={event:'lychee-release-smoke',mode:modes.includes(mode)?mode:'invalid',
    status:'stopped',gardenId:null,accounts:0,chat:0,image:0,soup:0,
    attempts:{chat:'unattempted',image:'unattempted',soup:'unattempted'}};
  let client,ledger,ownPrepare=false,ownPhase=false;
  try{
    requireThat(modes.includes(mode)&&env.LYCHEE_RELEASE_SMOKE===mode&&env.LYCHEE_MULTICLIENT_ENABLED==='1','not-enabled');
    requireThat(localListener(loopbackOrigin)&&(origin===publicOrigin||process.env.NODE_TEST_CONTEXT&&origin===loopbackOrigin),'invalid-listener');
    const seed=env.LYCHEE_QA_SEED;
    requireThat(typeof seed==='string'&&seed.length>=32&&!/\s/.test(seed)&&new Set(seed).size>=8,'invalid-seed');
    if(mode==='ai')requireThat(env.LYCHEE_ENABLE_PROVIDER_CALLS==='1'&&uuid(env.LYCHEE_RELEASE_SMOKE_GARDEN_ID)&&env.LYCHEE_RELEASE_SMOKE_GARDEN_ID===env.LYCHEE_PROVIDER_GARDEN_ID,'garden-gate');
    const session=()=>acceptanceSession({origin,transportOrigin:loopbackOrigin});
    await checkCapabilities(session);
    client=await createTursoClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,legacyDir});
    ledger=await createAcceptanceReceipts(client,{seed,mode:'run'});
    const {name,users}=credentials(seed,origin);
    if(mode==='prepare'){
      const claim=await ledger.claimPreparation();
      if(claim.acquired){
        ownPrepare=true;
        const saved=await prepareTestGarden({session,users,name});
        await ledger.finishPreparation(saved.garden,saved.owner.id);
        ownPrepare=false;output.gardenId=saved.garden;output.accounts=3;output.status='prepared';
      }else{
        const {preparation}=await ledger.status();
        requireThat(preparation.state==='ready'&&uuid(preparation.gardenId)&&uuid(preparation.ownerAccountId),'preparation-already-claimed');
        output.gardenId=preparation.gardenId;output.accounts=3;output.status='already-prepared';
      }
    }else if(mode==='album'){
      const {preparation}=await ledger.status();
      requireThat(preparation.state==='ready' && preparation.gardenId===env.LYCHEE_RELEASE_SMOKE_GARDEN_ID,'album-pilot');
      await verifyStoredPicture({session,owner:users[0],garden:preparation.gardenId,ownerId:preparation.ownerAccountId});
      output.status='verified';output.savedImageReadable=true;output.imageLimit=10;
    }else if(mode==='members'){
      const {preparation}=await ledger.status();
      const gardenId=env.LYCHEE_RELEASE_SMOKE_GARDEN_ID;
      Object.assign(output,await verifyMemberEditing({session,users,name,preparation,gardenId}));
      output.gardenId=gardenId;output.status='verified';
    }else{
      const {preparation,phase,attempts}=await ledger.status(),garden=env.LYCHEE_RELEASE_SMOKE_GARDEN_ID;
      requireThat(preparation.state==='ready'&&garden===preparation.gardenId&&uuid(preparation.ownerAccountId),'unprepared-garden');
      output.gardenId=garden;
      for(const kind of ['chat','image','soup']){
        output[kind]=Number(attempts[kind]==='succeeded');
        output.attempts[kind]=attempts[kind];
      }
      if(phase!=='unattempted')output.status='already-attempted';
      else{
        const owner={...users[0],id:preparation.ownerAccountId};
        await verifyProviders({session,saved:{garden,name,owner},beforeCalls:async()=>{
          const claim=await ledger.claimPhase(garden);requireThat(claim.acquired,'phase-claimed');ownPhase=true;
        },withAttempt:async(kind,operation)=>{
          const claim=await ledger.claimAttempt(kind,garden);
          requireThat(claim.acquired,'attempt-claimed');
          output.attempts[kind]='claimed';
          try{
            await operation();
            await ledger.finishAttempt(kind,garden,'succeeded');
            output[kind]=1;output.attempts[kind]='succeeded';
          }catch{
            output.attempts[kind]='uncertain';
            await ledger.finishAttempt(kind,garden,'uncertain');
            throw Error('Provider outcome uncertain.');
          }
        }});
        await ledger.finishPhase(garden,'succeeded');ownPhase=false;output.status='verified';
      }
    }
  }catch{
    if(ownPrepare)await ledger.markPreparationUncertain().catch(()=>{});
    if(ownPhase)await ledger.finishPhase(output.gardenId,'uncertain').catch(()=>{});
    output.status='stopped';
  }finally{try{client?.close();}catch{}}
  console.info(JSON.stringify(output));
  return output;
}
