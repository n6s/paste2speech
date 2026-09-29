import {paymentConfig,production} from './modes.js';
import {readBounded} from '../prepared/google.js';
import {orderPrice} from '../prepared/payments.js';
async function responseJSON(response){
 if(!response.ok)throw Error('Provider request failed');
 return JSON.parse(new TextDecoder().decode(await readBounded(response,2000000)));
}
export function paddleProvider(env,fetcher=fetch){
 const config=paymentConfig(env);
 async function call(path,body){const result=await responseJSON(await fetcher(config.base+path,{method:body?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+env.PADDLE_API_KEY,'Content-Type':'application/json','Paddle-Version':'1'},...(body?{body:JSON.stringify(body)}:{})}));return result;}
 return {config,
 async create(order){if(order.environment!==config.environment)throw Error('Order environment mismatch');return (await call('/transactions',{items:[{price_id:orderPrice(order),quantity:1}],currency_code:'USD',collection_mode:'automatic',custom_data:{p2s_order:order.id}})).data;},
 async transaction(id){if(!/^txn_[a-z0-9]{26}$/.test(id))throw Error('Invalid transaction');return (await call('/transactions/'+id)).data;},
 async adjustments(id){
  if(!/^txn_[a-z0-9]{26}$/.test(id))throw Error('Invalid transaction');let rows=[],after='';
  for(let n=0;n<100;n++){
   const page=await call('/adjustments?transaction_id='+id+'&per_page=50&order_by=id[ASC]'+(after?'&after='+after:''));
   if(!Array.isArray(page.data))throw Error('Invalid adjustments');rows.push(...page.data);
   if(page.meta?.pagination?.has_more===false)return rows;
   const next=page.data.at(-1)?.id;if(page.meta?.pagination?.has_more!==true||!/^adj_[a-z0-9]{26}$/.test(next)||next===after)throw Error('Incomplete adjustments');after=next;
  }throw Error('Too many adjustments');
 }
 };
}
export async function sendLink(env,link,fetcher=fetch){
 if(env.ENABLE_EMAIL!=='1'||env.LOCAL_READER==='1'||!env.RESEND_API_KEY||!env.EMAIL_FROM)throw Error('Email delivery is disabled');
 const permanent=env.READER_ORIGIN+'/api/billing';
 await responseJSON(await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':await (await import('../prepared/ledger.js')).digest(link.token)},body:JSON.stringify({from:env.EMAIL_FROM,to:[link.email],subject:production(env)?'Sign in to PasteToSpeech':'Sign in to your private reader',text:'Open this link in the browser where you requested it, then confirm sign-in. It expires in 15 minutes and works once.\n\n'+permanent+'/signin#'+link.token+'\n\nYour permanent account page is '+permanent+'. If this link expires, request a fresh one there. Your balance remains in your account.\n\nIf you did not request this, ignore this email.'})}));
}
