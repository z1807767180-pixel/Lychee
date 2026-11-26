import {createCipheriv,createECDH,createPrivateKey,hkdfSync,randomBytes,sign} from 'node:crypto';

const ecCurve='prime256v1';
const encode=bytes=>Buffer.from(bytes).toString('base64url');
const encodedJSON=obj=>encode(JSON.stringify(obj));
function decode(value,length){
  if(typeof value!=='string'||!/^[-_A-Za-z0-9]+$/.test(value))throw Error('推送密钥格式无效');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length!==length||encode(bytes)!==value)throw Error('推送密钥长度无效');
  return bytes;
}
export function subscriptionFields(sub){
  if(typeof sub?.endpoint!=='string'||sub.endpoint.length>1600)throw Error('推送地址无效');
  const url=new URL(sub.endpoint);
  const providers=['fcm.googleapis.com','updates.push.services.mozilla.com','push.apple.com','notify.windows.com'];
  const allowed=providers.some(host=>url.hostname===host)||
    ['.push.apple.com','.notify.windows.com'].some(suffix=>url.hostname.endsWith(suffix));
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed||url.pathname==='/')
    throw Error('当前推送服务尚未支持');
  const key=decode(sub.keys?.p256dh,65);
  if(key[0]!==4)throw Error('推送公钥无效');
  const check=createECDH(ecCurve);check.generateKeys();check.computeSecret(key);
  decode(sub.keys?.auth,16);
  return {endpoint:url.href,p256dh:sub.keys.p256dh,auth:sub.keys.auth};
}
export function vapidConfig(env){
  if(!env.LYCHEE_VAPID_PRIVATE_KEY||!env.LYCHEE_VAPID_SUBJECT)return null;
  const d=decode(env.LYCHEE_VAPID_PRIVATE_KEY,32), ec=createECDH(ecCurve);
  ec.setPrivateKey(d);
  const pub=ec.getPublicKey(),subject=new URL(env.LYCHEE_VAPID_SUBJECT);
  if(!['mailto:','https:'].includes(subject.protocol))throw Error('推送服务联系地址无效');
  const key=createPrivateKey({format:'jwk',key:{kty:'EC',crv:'P-256',d:encode(d),x:encode(pub.subarray(1,33)),y:encode(pub.subarray(33))}});
  return {key,subject:subject.href,publicKey:encode(pub)};
}
// A single RFC 8291 aes128gcm record. Only an opaque event pointer goes to the push service.
export function encryptPointer(subscription,notice){
  const remote=decode(subscription.p256dh,65),auth=decode(subscription.auth,16);
  const temp=createECDH(ecCurve),pub=temp.generateKeys(),salt=randomBytes(16);
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),remote,pub]);
  const ikm=hkdfSync('sha256',temp.computeSecret(remote),auth,info,32);
  const key=hkdfSync('sha256',ikm,salt,'Content-Encoding: aes128gcm\0',16);
  const nonce=hkdfSync('sha256',ikm,salt,'Content-Encoding: nonce\0',12);
  const cipher=createCipheriv('aes-128-gcm',key,nonce);
  const plain=Buffer.concat([Buffer.from(JSON.stringify(notice)),Buffer.from([2])]);
  if(plain.length>3900)throw Error('推送内容超过单条长度');
  const rs=Buffer.alloc(5);rs.writeUInt32BE(4096);rs[4]=pub.length;
  return Buffer.concat([salt,rs,pub,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
}
export async function sendPointer(config,subscription,pointer,fetcher=fetch){
  const endpoint=subscriptionFields({endpoint:subscription.endpoint,keys:subscription}).endpoint;
  const claims={aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:config.subject};
  const jwt=encodedJSON({alg:'ES256',typ:'JWT'})+'.'+encodedJSON(claims);
  const signature=sign('sha256',Buffer.from(jwt),{key:config.key,dsaEncoding:'ieee-p1363'});
  const headers={Authorization:'vapid t='+jwt+'.'+encode(signature)+', k='+config.publicKey,
    TTL:'3600','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'};
  const response=await fetcher(endpoint,{method:'POST',headers,body:encryptPointer(subscription,pointer),
    redirect:'error',signal:AbortSignal.timeout(6000)});
  await response.body?.cancel();
  return response.status;
}
