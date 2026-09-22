import {trialMode,publicMode,customerAllowed} from './modes.js';
import {capacity} from './budget.js';
import {UsageLedger} from '../prepared/ledger.js';
import {syncOrder} from '../prepared/payments.js';
import {paddleProvider} from './providers.js';
const json=(data,status=200)=>Response.json(data,{status});
// A single coordinator serializes remote snapshots and transaction creation,
// preventing a slow stale refund response from overwriting a newer one.
export class PaymentCoordinator {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.tail=Promise.resolve();}
 serial(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
 async sync(ledger,order,provider){try{return await syncOrder(ledger,order,provider);}catch{await ledger.paymentError(order.id);throw Error('Payment status could not be verified. Please try again; do not pay again.');}}
 async alarm(){
  if(trialMode(this.env)||this.env.LOCAL_READER==='1')return;
  await this.ctx.storage.setAlarm(Date.now()+60000);
  await this.serial(async()=>{
   const ledger=new UsageLedger(this.env.LEDGER),provider=paddleProvider(this.env);
   const events=await ledger.query('SELECT * FROM webhook_events WHERE processed IS NULL AND next_attempt<=? ORDER BY received LIMIT 10',Date.now()).all();
   for(const event of events.results){
    try{
     let order=await ledger.query('SELECT * FROM orders WHERE transaction_id=?',event.transaction_id).first();
     if(!order){
      const remote=await provider.transaction(event.transaction_id);
      // Recover a lost create response only from authenticated provider evidence.
      order=await ledger.query("SELECT * FROM orders WHERE id=? AND transaction_id IS NULL AND creation_state='submitting' AND environment=?",remote.custom_data?.p2s_order||'',provider.config.environment).first();
      if(order){await ledger.bindOrder(order.id,event.transaction_id);order=await ledger.order(order.id,order.account);}
     }
     if(order)await this.sync(ledger,order,provider);
     await ledger.query('UPDATE webhook_events SET processed=? WHERE id=?',Date.now(),event.id).run();
    }catch{await ledger.query('UPDATE webhook_events SET attempts=attempts+1,next_attempt=? WHERE id=?',Date.now()+Math.min(3600000,60000*2**Math.min(event.attempts,6)),event.id).run();}
   }
   const rows=await ledger.query("SELECT o.* FROM orders o LEFT JOIN payment_sync s ON s.order_id=o.id WHERE o.transaction_id IS NOT NULL AND o.status<>'canceled' ORDER BY COALESCE(s.checked,0),o.created LIMIT 10").all();
   for(const row of rows.results)await this.sync(ledger,row,provider).catch(()=>{});
  });
 }
 async fetch(request){return this.serial(async()=>{
  try{
   const {action,account,id}=await request.json(),ledger=new UsageLedger(this.env.LEDGER),provider=paddleProvider(this.env);
   // A cron wake or frequent browser request must never postpone an already
   // scheduled reconciliation alarm.
   if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+(action==='wake'?1:60000));
   if(action==='wake')return json({scheduled:true});
   if(action==='reconcile'){
    const order=await ledger.order(id,account);if(!order?.transaction_id)return json({detail:'Unknown order'},404);
    return json(await this.sync(ledger,order,provider));
   }
   if(action!=='order')return json({},400);
   if(this.env.ENABLE_PAYMENTS!=='1')return json({detail:'New purchases are paused. Existing payments continue to reconcile.'},503);
   if(publicMode(this.env)){
    if(!customerAllowed(this.env,await ledger.account(account)))return json({detail:'Verify your email before purchasing.'},403);
    if(this.env.ENABLE_LIVE_SYNTHESIS!=='1'||!(await capacity(this.env.LEDGER)).available)return json({detail:'Speech capacity is temporarily full. Purchases are paused.'},429);
   }
   let order=await ledger.newOrder(account,provider.config);
   if(order.environment!==provider.config.environment)return json({detail:'This order belongs to another payment environment.'},409);
   if(!order.transaction_id){
    if(order.creation_state!=='new')return json({detail:'Purchase creation needs verification. Do not pay again. Contact rogerpbrown@gmail.com with your account email.'},409);
    await ledger.query("UPDATE orders SET creation_state='submitting' WHERE id=?",order.id).run();
    const remote=await provider.create(order);
    if(!/^txn_[a-z0-9]{26}$/.test(remote.id))throw Error('Invalid transaction');
    await ledger.bindOrder(order.id,remote.id);order=await ledger.order(order.id,account);
   }
   return json({order:order.id,transactionId:order.transaction_id});
  }catch{return json({detail:'Payment status could not be verified. Please try again; do not pay again.'},503);}
 });}
}
