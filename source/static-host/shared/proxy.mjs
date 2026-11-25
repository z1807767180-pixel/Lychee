/* API requests share the public frontend's origin. The browser keeps the session
   cookie for that frontend; the backend still authenticates every request. */
export async function forward(context, send=fetch) {
  const request=context.request;
  const url=new URL(request.url);
  if(!/^\/(?:api\/|g\/[a-zA-Z0-9-]{1,64}\/api\/)/.test(url.pathname))return new Response(null,{status:404});
  if(!['GET','HEAD','POST'].includes(request.method))return new Response(null,{status:405});
  if(request.method==='POST' && request.headers.get('origin')!==url.origin)return new Response(null,{status:403});
  const upstream=new URL(context.env.LYCHEE_API_ORIGIN||'https://lychee-link-check.onrender.com');
  if(upstream.protocol!=='https:' || upstream.username || upstream.password || upstream.origin===url.origin)
    return Response.json({error:'服务地址配置无效'},{status:503});
  upstream.pathname=url.pathname;upstream.search=url.search;
  const headers=new Headers();
  for(const name of ['accept','content-type','cookie'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
  if(request.method==='POST')headers.set('origin',upstream.origin);
  let response;
  try {
    response=await send(upstream.href,{method:request.method,headers,redirect:'manual',
      ...(request.method==='POST'?{body:request.body,duplex:'half'}:{}),cf:{cacheEverything:false,cacheTtl:0}});
  }catch {return Response.json({error:'暂时连不上荔枝服务'},{status:503,headers:{'cache-control':'no-store'}});}
  if(response.status>=300 && response.status<400)return new Response(null,{status:503,headers:{'cache-control':'no-store'}});
  const returned=new Headers({'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'});
  if(response.headers.has('content-type'))returned.set('content-type',response.headers.get('content-type'));
  if(url.searchParams.get('v62')==='image'&&url.searchParams.has('download')){
    const attachment=response.headers.get('content-disposition');
    if(attachment==='attachment; filename="lychee-image.jpg"'||attachment==='attachment; filename="lychee-image.png"')returned.set('content-disposition',attachment);
  }
  if(response.headers.has('retry-after'))returned.set('retry-after',response.headers.get('retry-after'));
  if(response.headers.get('x-lychee-ai-retry')==='new')returned.set('x-lychee-ai-retry','new');
  const cookies=response.headers.getSetCookie?.() ?? response.headers.getAll?.('Set-Cookie') ?? [];
  for(const cookie of cookies)returned.append('set-cookie',cookie);
  return new Response(response.body,{status:response.status,headers:returned});
}
