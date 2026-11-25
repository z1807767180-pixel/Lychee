import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {forward} from './shared/proxy.mjs';

const origin='https://mobile.example.test',api='https://service.example.test';
const ctx=(path,options={})=>({request:new Request(origin+path,options),env:{LYCHEE_API_ORIGIN:api}});
test('authenticated requests preserve the account session, response status and both cookies',async()=>{
  const request=ctx('/api/account',{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-lychee-account=sample'},body:'{"mode":"login"}'});
  const reply=await forward(request,async(url,opts)=>{
    assert.equal(url,api+'/api/account');assert.equal(opts.headers.get('origin'),api);
    assert.equal(opts.headers.get('cookie'),'__Host-lychee-account=sample');
    assert.deepEqual(await new Response(opts.body).json(),{mode:'login'});
    const h=new Headers();h.append('set-cookie','__Host-lychee-account=next; Secure; HttpOnly; Path=/');h.append('set-cookie','__Host-lychee=; Max-Age=0; Secure; Path=/');
    return new Response('ok',{headers:h});
  });
  assert.equal(reply.headers.getSetCookie().length,2);assert.equal(reply.headers.get('cache-control'),'private, no-store');
});
test('the static login form can request circle images without rewriting image bytes',async()=>{
 const path='/g/example/api/for/22/phone?picture=17';
 const reply=await forward(ctx(path),async url=>{assert.equal(url,api+path);return new Response(Uint8Array.of(0,127,255),{headers:{'content-type':'image/jpeg'}});});
 assert.deepEqual([...new Uint8Array(await reply.arrayBuffer())],[0,127,255]);assert.equal(reply.headers.get('content-type'),'image/jpeg');
});
test('foreign write origins and paths outside the API are rejected before contacting the service',async()=>{
 const unexpected=()=>{throw Error('unexpected network call');};
 assert.equal((await forward(ctx('/api/account',{method:'POST',headers:{origin:'https://other.example.test'}}),unexpected)).status,403);
 assert.equal((await forward(ctx('/mobile/index.html'),unexpected)).status,404);
});
