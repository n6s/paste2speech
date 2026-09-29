// Server-side only. Default Google speech: plain text, no SSML or rewrites.
const TOKEN_URL='https://oauth2.googleapis.com/token';
const SPEECH_URL='https://texttospeech.googleapis.com/v1/text:synthesize';
const encoder=new TextEncoder();
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function readBounded(response, maximum){
  const reader=response.body?.getReader();if(!reader)throw Error('Empty response');
  let length=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;
    if(length>maximum){await reader.cancel();throw Error('Response too large');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
export async function accessToken(accountJson,{fetcher=(...args)=>globalThis.fetch(...args),now=Date.now,includeExpiry=false}={}){
  let stage='credential parsing',httpStatus;
  try {
    const account=JSON.parse(accountJson);
    if(account.type!=='service_account' || typeof account.client_email!=='string' || !account.private_key)throw Error();
    // Endpoints and scope are fixed, never taken from a supplied key document.
    const seconds=Math.floor(now()/1000);
    const header=b64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
    const claims=b64url(encoder.encode(JSON.stringify({iss:account.client_email,
      scope:'https://www.googleapis.com/auth/cloud-platform',aud:TOKEN_URL,iat:seconds,exp:seconds+3600})));
    const pem=account.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    stage='key import';
    const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(`${header}.${claims}`));
    stage='token request';
    const response=await fetcher(TOKEN_URL,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${header}.${claims}.${b64url(new Uint8Array(signature))}`})});
    httpStatus=response.status;if(!response.ok)throw Error();
    stage='token response';
    const result=JSON.parse(new TextDecoder().decode(await readBounded(response,16384)));
    if(typeof result.access_token!=='string' || !result.access_token || result.token_type!=='Bearer')throw Error();
    // Cache only in Worker memory and only for a declared, bounded lifetime.
    const ttl=Number.isFinite(result.expires_in)?Math.max(0,Math.min(result.expires_in,3600)-60):0;
    return includeExpiry?{token:result.access_token,expires:now()+ttl*1000}:result.access_token;
  }catch(error){throw Error(`Google authorization failed during ${stage}${httpStatus?` (HTTP ${httpStatus})`:` (${['TypeError','DataError','OperationError'].includes(error.name)?error.name:'request error'})`}. No speech request was retried.`);}
}
export async function synthesize(text,voice,token,{fetcher=(...args)=>globalThis.fetch(...args)}={}){
  if(!['en-US-Wavenet-F','en-GB-Wavenet-F','en-US-Wavenet-D','en-GB-Wavenet-D'].includes(voice) || typeof text!=='string' ||
     !text.trim() || encoder.encode(text).length>5000)throw Error('Unsupported speech input');
  try {
    const response=await fetcher(SPEECH_URL,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(60000),
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({input:{text},voice:{languageCode:voice.slice(0,5),name:voice},
        audioConfig:{audioEncoding:'MP3',sampleRateHertz:24000}})});
    if(!response.ok)throw Error();
    const result=JSON.parse(new TextDecoder().decode(await readBounded(response,8*1024*1024)));
    if(typeof result.audioContent!=='string')throw Error();
    return Uint8Array.from(atob(result.audioContent),c=>c.charCodeAt(0));
  }catch{throw Error('Google speech failed. No automatic retry; the attempt may be billable.');}
}
