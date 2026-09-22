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
  if(this.env.ENABLE_PAYMENTS!=='1'||this.env.LOCAL_READER==='1')return;
  await this.ctx.storage.setAlarm(Date.now()+60000);
  await this.serial(async()=>{
   const ledger=new UsageLedger(this.env.LEDGER),provider=paddleProvider(this.env);
   const rows=await ledger.query("SELECT o.* FROM orders o LEFT JOIN payment_sync s ON s.order_id=o.id WHERE o.transaction_id IS NOT NULL AND o.status<>'canceled' ORDER BY COALESCE(s.checked,0),o.created LIMIT 10").all();
   for(const row of rows.results)await this.sync(ledger,row,provider).catch(()=>{});
  });
 }
 async fetch(request){return this.serial(async()=>{
  try{
   const {action,account,id}=await request.json(),ledger=new UsageLedger(this.env.LEDGER),provider=paddleProvider(this.env);
   await this.ctx.storage.setAlarm(Date.now()+60000);
   if(action==='wake')return json({scheduled:true});
   if(action==='reconcile'){
    const order=await ledger.order(id,account);if(!order?.transaction_id)return json({detail:'Unknown order'},404);
    return json(await this.sync(ledger,order,provider));
   }
   if(action!=='order')return json({},400);
   let order=await ledger.newOrder(account);
   if(!order.transaction_id){
    if(order.creation_state!=='new')return json({detail:'Purchase creation needs verification. Do not pay again.'},409);
    await ledger.query("UPDATE orders SET creation_state='submitting' WHERE id=?",order.id).run();
    const remote=await provider.create(order);
    if(!/^txn_[a-z0-9]{26}$/.test(remote.id))throw Error('Invalid transaction');
    await ledger.bindOrder(order.id,remote.id);order=await ledger.order(order.id,account);
   }
   return json({order:order.id,transactionId:order.transaction_id});
  }catch{return json({detail:'Payment status could not be verified. Please try again; do not pay again.'},503);}
 });}
}
