import {UnifiedWallet,unifiedEnabled,unifiedCapacity} from './unified-wallet.js';
import {unifiedProvider,syncUnifiedOrder} from './unified-payments.js';
import {ocrOwnerOnly,ocrCapacity} from './ocr-policy.js';
import {trialMode,publicMode,customerAllowed} from './modes.js';
import {capacity} from './budget.js';
import {UsageLedger} from '../prepared/ledger.js';
import {syncOrder} from '../prepared/payments.js';
import {paddleProvider} from './providers.js';
import {OcrLedger} from './ocr-ledger.js';
import {ocrProvider,syncOcrOrder} from './ocr-payments.js';
const json=(data,status=200)=>Response.json(data,{status});
// A single coordinator serializes remote snapshots and transaction creation,
// preventing a slow stale refund response from overwriting a newer one.
export class PaymentCoordinator {
 ledger(){return new UsageLedger(this.env.LEDGER);}
 provider(){return paddleProvider(this.env);}
 apply(ledger,order,provider){return syncOrder(ledger,order,provider);}
 query(ledger,sql,...args){return ledger.query(sql,...args);}
 async admit(ledger,account){
  if(publicMode(this.env)){if(!customerAllowed(this.env,await ledger.account(account)))return json({detail:'Verify your email before purchasing.'},403);if(this.env.ENABLE_LIVE_SYNTHESIS!=='1'||!(await capacity(this.env.LEDGER)).available)return json({detail:'Speech capacity is temporarily full. Purchases are paused.'},429);}
 }
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.tail=Promise.resolve();}
 serial(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
 async sync(ledger,order,provider){
  try{
   const result=await this.apply(ledger,order,provider),now=Date.now(),age=now-Date.parse(order.created);
   const delay=result.status==='completed'?86400000:age<900000?60000:age<86400000?300000:3600000;
   await this.query(ledger,'UPDATE payment_sync SET next_check=?,failures=0 WHERE order_id=?',result.status==='canceled'?0:now+delay,order.id).run();
   return result;
  }catch{
   await ledger.paymentError(order.id);
   const previous=await this.query(ledger,'SELECT failures FROM payment_sync WHERE order_id=?',order.id).first();
   const attempts=(previous?.failures||0)+1,delay=[60000,300000,900000,3600000][attempts-1];
   await this.query(ledger,'UPDATE payment_sync SET failures=?,next_check=? WHERE order_id=?',attempts,delay?Date.now()+delay:0,order.id).run();
   throw Error('Payment status could not be verified. Please try again; do not pay again.');
  }
 }
 async schedule(ledger){
  const row=await this.query(ledger,"SELECT MIN(due) AS due FROM (SELECT COALESCE(s.next_check,0) AS due FROM orders o LEFT JOIN payment_sync s ON s.order_id=o.id WHERE o.transaction_id IS NOT NULL AND o.status<>'canceled' AND COALESCE(s.failures,0)<5 UNION ALL SELECT next_attempt AS due FROM webhook_events WHERE processed IS NULL AND attempts<5)").first();
  if(row?.due==null){await this.ctx.storage.deleteAlarm?.();return;}
  const due=Math.max(Date.now()+1000,row.due),current=await this.ctx.storage.getAlarm();
  if(current===null||current>due)await this.ctx.storage.setAlarm(due);
 }
 async alarm(){
  if(this.constructor===PaymentCoordinator&&await this.ctx.storage.get?.('wallet_kind')==='unified-v1')return this.unifiedCoordinator().alarm();
  if(this.env.BACKGROUND_WORK_PAUSED==='1'){await this.ctx.storage.setAlarm(Date.now()+86400000);return;}
  if(trialMode(this.env)||this.env.LOCAL_READER==='1')return;
  if((await this.ctx.storage.get?.('payment_recovery')||0)>=5)return;
  await this.serial(async()=>{
   const ledger=this.ledger();
   try{
    const provider=this.provider();
    const events=await this.query(ledger,'SELECT * FROM webhook_events WHERE processed IS NULL AND attempts<5 AND next_attempt<=? ORDER BY received LIMIT 10',Date.now()).all();
    for(const event of events.results){
     try{
      let order=await this.query(ledger,'SELECT * FROM orders WHERE transaction_id=?',event.transaction_id).first();
      if(!order){
       const remote=await provider.transaction(event.transaction_id);
       order=await this.query(ledger,"SELECT * FROM orders WHERE id=? AND transaction_id IS NULL AND creation_state='submitting' AND environment=?",remote.custom_data?.p2s_order||'',provider.config.environment).first();
       if(order){await ledger.bindOrder(order.id,event.transaction_id);order=await ledger.order(order.id,order.account);}
      }
      if(order)await this.sync(ledger,order,provider);
      await this.query(ledger,'UPDATE webhook_events SET processed=? WHERE id=?',Date.now(),event.id).run();
     }catch{
      const delay=[60000,300000,900000,3600000][event.attempts]||86400000;
      await this.query(ledger,'UPDATE webhook_events SET attempts=attempts+1,next_attempt=? WHERE id=?',Date.now()+delay,event.id).run();
     }
    }
    const rows=await this.query(ledger,"SELECT o.* FROM orders o LEFT JOIN payment_sync s ON s.order_id=o.id WHERE o.transaction_id IS NOT NULL AND o.status<>'canceled' AND COALESCE(s.failures,0)<5 AND COALESCE(s.next_check,0)<=? ORDER BY COALESCE(s.next_check,0),o.created LIMIT 10",Date.now()).all();
    for(const row of rows.results)await this.sync(ledger,row,provider).catch(()=>{});
    await this.schedule(ledger);
    if(this.ctx.storage.delete)await this.ctx.storage.delete('payment_recovery');
   }catch{
    const failures=(await this.ctx.storage.get('payment_recovery')||0)+1;
    await this.ctx.storage.put('payment_recovery',failures);
    const delay=[60000,300000,900000,3600000][failures-1];
    if(delay)await this.ctx.storage.setAlarm(Date.now()+delay);else await this.ctx.storage.deleteAlarm();
    console.error(JSON.stringify({event:'payment_recovery',failures,stopped:!delay}));
   }
  });
 }
 unifiedCoordinator(){return this.unifiedDelegate ||= new UnifiedPaymentCoordinator(this.ctx,this.env);}
 async fetch(request){
  if(this.constructor===PaymentCoordinator&&new URL(request.url).pathname==='/unified'){if(!unifiedEnabled(this.env))return json({},404);await this.ctx.storage.put('wallet_kind','unified-v1');return this.unifiedCoordinator().fetch(new Request('https://payments/',request));}
  if(this.env.BACKGROUND_WORK_PAUSED==='1')return json({detail:'Payments are temporarily paused for maintenance.'},503);
  return this.serial(async()=>{
  try{
   const {action,account,id}=await request.json(),ledger=this.ledger(),provider=this.provider();
   // A cron wake or frequent browser request must never postpone an already
   // scheduled reconciliation alarm.
   if(action==='wake'){if((await this.ctx.storage.get?.('payment_recovery')||0)>=5)return json({scheduled:false,attention:true});await this.schedule(ledger);return json({scheduled:true});}
   await this.ctx.storage.delete?.('payment_recovery');
   if(action==='reconcile'){
    const order=await ledger.order(id,account);if(!order?.transaction_id)return json({detail:'Unknown order'},404);
    const result=await this.sync(ledger,order,provider);await this.schedule(ledger);return json(result);
   }
   if(action!=='order')return json({},400);
   if(this.env.ENABLE_PAYMENTS!=='1')return json({detail:'New purchases are paused. Existing payments continue to reconcile.'},503);
   const unavailable=await this.admit(ledger,account);if(unavailable)return unavailable;
   let order=await ledger.newOrder(account,provider.config);
   if(order.environment!==provider.config.environment)return json({detail:'This order belongs to another payment environment.'},409);
   if(!order.transaction_id){
    if(order.creation_state!=='new')return json({detail:'Purchase creation needs verification. Do not pay again. Contact rogerpbrown@gmail.com with your account email.'},409);
    await this.query(ledger,"UPDATE orders SET creation_state='submitting' WHERE id=?",order.id).run();
    const remote=await provider.create(order);
    if(!/^txn_[a-z0-9]{26}$/.test(remote.id))throw Error('Invalid transaction');
    await ledger.bindOrder(order.id,remote.id);order=await ledger.order(order.id,account);
   }
   await this.schedule(ledger);return json({order:order.id,transactionId:order.transaction_id});
  }catch{return json({detail:'Payment status could not be verified. Please try again; do not pay again.'},503);}
 });}
}

// Same serialization/recovery implementation, separate OCR tables and event intake.
export class OcrPaymentCoordinator extends PaymentCoordinator {
 ledger(){return new OcrLedger(this.env.LEDGER);}
 provider(){return ocrProvider(this.env);}
 apply(ledger,order,provider){return syncOcrOrder(ledger,order,provider);}
 query(ledger,sql,...args){return ledger.query(sql.replace(/\b(orders|payment_sync|webhook_events)\b/g,table=>'ocr_'+table),...args);}
 async admit(ledger,account){
  const session=await ledger.account(account);
  if(!session?.email||session.enabled!==1||publicMode(this.env)&&!customerAllowed(this.env,session)||(this.env.OCR_RETAIL_PROVIDER_MODE==='synthetic'||ocrOwnerOnly(this.env))&&session.email!==this.env.OWNER_EMAIL)return json({detail:'Verify your email before purchasing OCR pages.'},403);
  if(this.env.ENABLE_OCR_PAYMENTS!=='1'||this.env.ENABLE_DOCUMENT_OCR!=='1'||!(this.env.OCR_RETAIL_PROVIDER_MODE==='synthetic'||this.env.OCR_RETAIL_PROVIDER_MODE==='live'&&this.env.MISTRAL_API_KEY))return json({detail:'OCR purchases are paused.'},503);
  const b=await ocrCapacity(ledger);if(!b.available&&!await ledger.pendingOrder(account))return json({detail:'OCR capacity is temporarily full.'},429);
 }
}

export class UnifiedPaymentCoordinator extends PaymentCoordinator {
 ledger(){return new UnifiedWallet(this.env.LEDGER);}
 provider(){return unifiedProvider(this.env);}
 apply(ledger,order,provider){return syncUnifiedOrder(ledger,order,provider);}
 query(ledger,sql,...args){return ledger.query(sql.replace(/\b(orders|payment_sync|webhook_events)\b/g,table=>'unified_'+table),...args);}
 async admit(ledger,account){
  const a=await ledger.account(account);
  if(!a?.email||a.enabled!==1||a.email!==this.env.OWNER_EMAIL)return json({detail:'Verify the staging owner email before purchasing credits.'},403);
  const capacity=await unifiedCapacity(ledger);if(!capacity.available&&!await ledger.pendingOrder(account))return json({detail:'Shared-credit purchase capacity is temporarily full.'},429);
  if(this.env.ENABLE_UNIFIED_PAYMENTS!=='1')return json({detail:'Shared-credit checkout is awaiting sandbox catalog setup.'},503);
 }
}
