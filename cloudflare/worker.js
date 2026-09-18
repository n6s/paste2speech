const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const empty=()=>new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
const encoder=new TextEncoder();
async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function signingKey(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function ticketSignature(secret,id,expires){return [...new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(`${id}:${expires}`)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function validTicket(t,secret){
 if(!t||typeof t.id!=='string'||!/^[a-f0-9-]{36}$/.test(t.id)||!Number.isSafeInteger(t.expires)||t.expires<Date.now()||t.expires>Date.now()+3600000||typeof t.signature!=='string'||!/^[a-f0-9]{64}$/.test(t.signature))return false;
 return crypto.subtle.verify('HMAC',await signingKey(secret),new Uint8Array(t.signature.match(/../g).map(h=>parseInt(h,16))),encoder.encode(`${t.id}:${t.expires}`));
}
async function body(request,limit){
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('content');
 const reader=request.body?.getReader();if(!reader)throw Error('body');
 let n=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit){await reader.cancel();throw Error('size');}chunks.push(value);}
 const bytes=new Uint8Array(n);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function validEvent(data){
 if(!data||Array.isArray(data)||Object.keys(data).some(k=>!['event','engine','category','release','duration'].includes(k)))return false;
 return ['page_view','playback_start','kokoro_ready','kokoro_failure'].includes(data.event)&&['none','browser','kokoro'].includes(data.engine)&&['none','download','generation'].includes(data.category)&&/^[a-zA-Z0-9._-]{1,40}$/.test(data.release)&&Number.isInteger(data.duration)&&data.duration>=0&&data.duration<=300000;
}
export function validFeedback(data){
 return data&&typeof data.message==='string'&&data.message.trim().length>=10&&data.message.length<=3000&&typeof data.email==='string'&&data.email.length<=254&&(!data.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))&&typeof data.website==='string'&&!data.website&&((data.message.match(/https?:\/\//gi)||[]).length<=3)&&Object.keys(data).every(k=>['message','email','website','ticket'].includes(k));
}
export async function deliver(env,id){
 const now=Date.now();
 const claim=await env.DB.prepare("UPDATE feedback SET status='sending',attempts=attempts+1,lease_until=? WHERE id=? AND attempts<5 AND (status='pending' OR (status='sending' AND lease_until<?)) RETURNING id,message,email").bind(now+120000,id,now).first();
 if(!claim)return;
 try{
  const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:`Paste to Speech · new feedback\nReport ${claim.id}\n\n${claim.message}\n\nReply email: ${claim.email||'Not supplied'}\n\nVisitor-submitted content. Automated investigation and Telegram replies are not enabled yet. Discuss proposed changes in Codex.`,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok||!result.ok)throw Error('delivery');
  await env.DB.prepare("UPDATE feedback SET status='sent',telegram_message_id=?,lease_until=0 WHERE id=?").bind(result.result.message_id,id).run();
 }catch{
  await env.DB.prepare("UPDATE feedback SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,lease_until=? WHERE id=?").bind(now+300000,id).run();
 }
}
export default {
 async fetch(request,env,ctx){
  const origin=request.headers.get('origin');
  const privateOrigin=origin==='https://pop-os.tailbd091c.ts.net';
  const api=new URL(request.url).pathname.startsWith('/api/');
  if(!privateOrigin||!api)return this.handle(request,env,ctx);
  const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  const response=await this.handle(request,env,ctx);
  const result=new Response(response.body,response);
  for(const [key,value] of Object.entries(headers))result.headers.set(key,value);
  return result;
 },
 async handle(request,env,ctx){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  const origin=request.headers.get('origin');
  if(origin!==env.PUBLIC_ORIGIN && origin!=='https://pop-os.tailbd091c.ts.net' && !(request.method==='GET'&&request.headers.get('sec-fetch-site')==='same-origin'))return json({error:'Origin not allowed'},403);
  const route=url.pathname;
  if(!['/api/events','/api/feedback','/api/feedback-ticket'].includes(route))return json({error:'Not found'},404);
  const isEvent=route==='/api/events';
  const limiter=isEvent?env.EVENT_LIMIT:env.FEEDBACK_LIMIT;
  if(limiter && !(await limiter.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'})).success)return json({error:'Please try later'},429);
  try{
   if(route==='/api/feedback-ticket'&&request.method==='GET'){
    const id=crypto.randomUUID(),expires=Date.now()+3600000;
    return json({id,expires,signature:await ticketSignature(env.FEEDBACK_SECRET,id,expires)});
   }
   if(request.method!=='POST')return json({error:'Method not allowed'},405);
   const data=await body(request,isEvent?512:16000);
   if(isEvent){
    if(!validEvent(data))return json({error:'Invalid event'},400);
    if(request.headers.get('dnt')==='1'||request.headers.get('sec-gpc')==='1')return empty();
    await env.DB.prepare('INSERT INTO daily_events(day,event,engine,category,release,count,duration_ms) VALUES(?,?,?,?,?,1,?) ON CONFLICT(day,event,engine,category,release) DO UPDATE SET count=count+1,duration_ms=duration_ms+excluded.duration_ms').bind(new Date().toISOString().slice(0,10),data.event,data.engine,data.category,data.release,data.duration).run();
    return empty();
   }
   if(!validFeedback(data)||!await validTicket(data.ticket,env.FEEDBACK_SECRET))return json({error:'Invalid feedback'},400);
   const digest=await hash(new Date().toISOString().slice(0,10)+'\n'+data.message.trim().toLowerCase());
   await env.DB.prepare('INSERT OR IGNORE INTO feedback(id,created_at,message,email,digest) VALUES(?,?,?,?,?)').bind(data.ticket.id,Date.now(),data.message.trim(),data.email.trim(),digest).run();
   ctx.waitUntil(deliver(env,data.ticket.id));
   return json({saved:true},202);
  }catch{return json({error:'Temporarily unavailable. Please retry or use email.'},503);}
 },
 async scheduled(_event,env,ctx){
  ctx.waitUntil((async()=>{
   const now=Date.now();
   await env.DB.batch([
    env.DB.prepare('DELETE FROM feedback WHERE created_at<?').bind(now-90*86400000),
    env.DB.prepare('DELETE FROM daily_events WHERE day<?').bind(new Date(now-90*86400000).toISOString().slice(0,10)),
   ]);
   const rows=await env.DB.prepare("SELECT id FROM feedback WHERE attempts<5 AND status IN ('pending','sending') AND lease_until<? LIMIT 10").bind(now).all();
   for(const row of rows.results)await deliver(env,row.id);
  })());
 }
};
