import {unifiedEnabled} from './unified-wallet.js';
import {ocrRetailEnabled} from './ocr-policy.js';
import {readBounded} from '../prepared/google.js';
export async function verifyWebhook(request,secret,now=Date.now()){
 if(!secret)throw Error('Webhook unavailable');
 const fields=(request.headers.get('Paddle-Signature')||'').split(';').map(v=>v.trim().split('='));
 const timestamp=fields.find(([k])=>k==='ts')?.[1],signatures=fields.filter(([k])=>k==='h1').map(([,v])=>v);
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)throw Error('Invalid timestamp');
 const raw=await readBounded(request,262144),prefix=new TextEncoder().encode(timestamp+':'),message=new Uint8Array(prefix.length+raw.length);message.set(prefix);message.set(raw,prefix.length);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 let valid=false;
 for(const value of signatures)if(/^[a-f0-9]{64}$/.test(value||''))valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(value.match(/../g),h=>parseInt(h,16)),message)||valid;
 if(!valid)throw Error('Invalid signature');
 const event=JSON.parse(new TextDecoder().decode(raw));
 if(!/^evt_[a-z0-9]{26}$/.test(event.event_id||''))throw Error('Invalid event');
 const transaction=event.event_type?.startsWith('transaction.')?event.data?.id:event.event_type?.startsWith('adjustment.')?event.data?.transaction_id:null;
 if(!/^txn_[a-z0-9]{26}$/.test(transaction||''))return null;
 return {id:event.event_id,transaction};
}
export async function receiveWebhook(request,env,ctx){
 let event;try{event=await verifyWebhook(request,env.PADDLE_WEBHOOK_SECRET);}catch{return Response.json({detail:'Invalid webhook'}, {status:401});}
 if(event){
  if(unifiedEnabled(env)&&env.ENABLE_UNIFIED_PAYMENTS==='1'){
   try{await env.LEDGER.prepare('INSERT OR IGNORE INTO unified_webhook_events(id,transaction_id,received) VALUES(?,?,?)').bind(event.id,event.transaction,Date.now()).run();}catch{return Response.json({detail:'Retry delivery'},{status:503});}
   ctx.waitUntil(env.PAYMENTS.get(env.PAYMENTS.idFromName('unified-v1')).fetch('https://payments/unified',{method:'POST',body:JSON.stringify({action:'wake'})}));
  }

  try{await env.LEDGER.prepare('INSERT OR IGNORE INTO webhook_events(id,transaction_id,received) VALUES(?,?,?)').bind(event.id,event.transaction,Date.now()).run();}
  catch{return Response.json({detail:'Retry delivery'},{status:503});}
  if(ocrRetailEnabled(env)&&env.OCR_PAYMENTS){
   try{await env.LEDGER.prepare('INSERT OR IGNORE INTO ocr_webhook_events(id,transaction_id,received) VALUES(?,?,?)').bind(event.id,event.transaction,Date.now()).run();}catch{return Response.json({detail:'Retry delivery'},{status:503});}
   ctx.waitUntil(env.OCR_PAYMENTS.get(env.OCR_PAYMENTS.idFromName('coordinator')).fetch('https://payments/wake',{method:'POST',body:JSON.stringify({action:'wake'})}));
  }
  ctx.waitUntil(env.PAYMENTS.get(env.PAYMENTS.idFromName('coordinator')).fetch('https://payments/wake',{method:'POST',body:JSON.stringify({action:'wake'})}));
 }
 return Response.json({received:true});
}
