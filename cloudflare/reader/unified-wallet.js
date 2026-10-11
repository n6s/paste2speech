import {UsageLedger,CreditError} from '../prepared/ledger.js';
export const UNITS_PER_CREDIT=1000,OCR_PAGE_UNITS=2000,PACK_UNITS=1000000;
export function unifiedEnabled(env={}){
 if(env.UNIFIED_CREDITS!=='1')return false;
 if(env.READER_MODE!=='staging'||env.PADDLE_ENVIRONMENT!=='sandbox')throw Error('Unified wallet is staging-only');
 return true;
}
export async function unifiedCapacity(ledger){const b=await ledger.query('SELECT * FROM unified_capacity').first();return {...b,available:!!b&&b.reserved_cents+b.committed_cents+500<=b.cap_cents};}
export class UnifiedWallet extends UsageLedger {
 async balance(account){
  const row=await this.query('SELECT balance,debt FROM unified_wallets WHERE account=?',account).first();
  const held=await this.query("SELECT COALESCE(SUM(units),0) held FROM (SELECT remaining units FROM reservations WHERE account=? AND state='open' AND wallet_version='unified-v1' UNION ALL SELECT pages*2000 units FROM ocr_attempts WHERE account=? AND state='held' AND wallet_version='unified-v1')",account,account).first();
  return {...(row||{balance:0,debt:0}),held:held.held,unitsPerCredit:UNITS_PER_CREDIT,walletVersion:'unified-v1'};
 }
 async newOrder(account,offer){
  await this.query("INSERT INTO unified_orders(id,account,created,environment,price_id,product_id,amount,currency,units) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM unified_orders WHERE account=? AND status='pending')",crypto.randomUUID(),account,new Date().toISOString(),offer.environment,offer.price,offer.product,offer.amount,offer.currency,offer.units,account).run();
  const order=await this.query("SELECT * FROM unified_orders WHERE account=? AND status='pending'",account).first();
  if(order.price_id!==offer.price||order.product_id!==offer.product||order.environment!==offer.environment)throw new CreditError('Existing credit purchase needs verification. Do not pay again.');return order;
 }
 async order(id,account){return this.query('SELECT * FROM unified_orders WHERE id=? AND account=?',id,account).first();}
 async bindOrder(id,transaction){await this.query('UPDATE unified_orders SET transaction_id=? WHERE id=? AND transaction_id IS NULL',transaction,id).run();}
 async pendingOrder(account){return (await this.query("SELECT id FROM unified_orders WHERE account=? AND status='pending'",account).first())?.id||null;}
 async syncPayment(id,transaction,state,revoked=0){
  if(!Number.isSafeInteger(revoked)||revoked<0||revoked>PACK_UNITS)throw new CreditError('Invalid credit revocation');
  const existed=await this.query('SELECT id FROM unified_grants WHERE id=?',transaction).first(),prior=await this.query('SELECT state,revoked FROM unified_payment_sync WHERE order_id=?',id).first();
  if(prior?.state===state&&prior.revoked===revoked&&(state!=='completed'||existed)){await this.query('UPDATE unified_payment_sync SET checked=? WHERE order_id=?',Date.now(),id).run();return false;}
  await this.query('INSERT INTO unified_payment_commands VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,transaction,state,revoked,Date.now()).run();return state==='completed'&&!existed;
 }
 async paymentError(id){await this.query("INSERT INTO unified_payment_sync(order_id,checked,state) VALUES(?,?,'error') ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,state='error'",id,Date.now()).run();}
 async paymentStatus(account){return this.query("SELECT MAX(checked)/1000.0 lastChecked,COALESCE(MAX(state='error'),0) needsAttention,COALESCE(SUM(revoked),0) revokedUnits FROM unified_payment_sync s JOIN unified_orders o ON o.id=s.order_id WHERE o.account=?",account).first();}
}
