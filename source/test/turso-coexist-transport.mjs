// Loaded only into the child server and its garden workers by the coexistence test.
import {syncBuiltinESMExports} from 'node:module';
import {Server,Socket} from 'node:net';
import threads from 'node:worker_threads';

const originals={listen:Server.prototype.listen,connect:Socket.prototype.connect,fetch:globalThis.fetch};
const db=process.env.TEST_DATABASE_ORIGIN,app=process.env.TEST_APP_ORIGIN,provider=process.env.TEST_PROVIDER_ORIGIN;
const allowed=[db,app,provider].filter(Boolean).map(value=>{
  const url=new URL(value);
  if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||!url.port||url.origin!==value)throw Error('Loopback fixture required');
  return url;
});
Socket.prototype.connect=function(...args){
  const first=Array.isArray(args[0])?args[0][0]:args[0];
  const host=typeof first==='object'?first.host:args[1],port=typeof first==='object'?first.port:first;
  if(!allowed.some(url=>host===url.hostname&&String(port)===url.port))throw Error('Test blocked non-fixture socket');
  return originals.connect.apply(this,args);
};
const providerPaths=new Map([
  ['https://api.deepseek.com/chat/completions','/chat/completions'],
  ['https://ark.cn-beijing.volces.com/api/v3/images/generations','/api/v3/images/generations'],
]);
globalThis.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:input);
  if(providerPaths.has(url.href)&&provider)return originals.fetch(provider+providerPaths.get(url.href),{...init,redirect:'error'});
  if(url.origin!==db&&url.origin!==app)throw Error('Test blocked non-fixture fetch');
  const attempt=originals.fetch(input,{...init,redirect:'error'});
  if(threads.isMainThread&&url.origin===app){
    return attempt.then(result=>{
      process.send({route:url.pathname.split('/').at(-1),method:init?.method??'GET',status:result.status});
      return result;
    });
  }
  return attempt;
};
if(threads.isMainThread){
  Server.prototype.listen=function(port,host,...args){
    if(host!=='0.0.0.0')throw Error('Unexpected test listener');
    this.once('listening',()=>process.send({ready:this.address().port}));
    return originals.listen.call(this,port,'127.0.0.1',...args);
  };
  const AppWorker=threads.Worker;
  threads.Worker=class extends AppWorker{
    constructor(url,options){
      super(url,{...options,execArgv:['--import',import.meta.url],env:{...options.env,
        TEST_DATABASE_ORIGIN:db,TEST_APP_ORIGIN:app,...(provider?{TEST_PROVIDER_ORIGIN:provider}:{})}});
    }
  };
  syncBuiltinESMExports();
}
