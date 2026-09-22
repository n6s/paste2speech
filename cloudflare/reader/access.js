import {readBounded} from '../prepared/google.js';
const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const decode=s=>JSON.parse(new TextDecoder().decode(bytes(s)));
// No authentication bypass on a hosted origin, including workers.dev.
export async function privateAccess(request,env,{fetcher=fetch,now=Date.now}={}){
 const url=new URL(request.url);
 if(env.LOCAL_READER==='1')return url.origin==='http://127.0.0.1:8790';
 if(url.origin!==env.READER_ORIGIN||url.protocol!=='https:'||!env.ACCESS_AUD||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER||''))return false;
 try{
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token||token.length>16000)return false;
  const [h,p,s,...extra]=token.split('.');if(extra.length||!s)return false;
  const header=decode(h),claims=decode(p),seconds=Math.floor(now()/1000);
  if(header.alg!=='RS256'||claims.iss!==env.ACCESS_ISSUER||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUD)||!Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+30||(claims.nbf!=null&&claims.nbf>seconds))return false;
  const response=await fetcher(env.ACCESS_ISSUER+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return false;const jwks=JSON.parse(new TextDecoder().decode(await readBounded(response,64000)));
  const jwk=jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256');if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(s),new TextEncoder().encode(h+'.'+p));
 }catch{return false;}
}
