import {UsageLedger,CreditError} from '../prepared/ledger.js';
// Separate tables and units: no OCR method mutates speech credit.
export class OcrLedger extends UsageLedger {
 async balance(account){const row=await this.query('SELECT balance,debt FROM ocr_accounts WHERE account=?',account).first();const held=await this.query("SELECT COALESCE(SUM(pages),0) AS held FROM ocr_attempts WHERE account=? AND state='held'",account).first();return {...(row||{balance:0,debt:0}),held:held.held};}
 async newOrder(account,offer){
  await this.query("INSERT INTO ocr_orders(id,account,created,environment,price_id,product_id,amount,currency,pages) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ocr_orders WHERE account=? AND status='pending')",crypto.randomUUID(),account,new Date().toISOString(),offer.environment,offer.price,offer.product,offer.amount,offer.currency,offer.pages,account).run();
  const order=await this.query("SELECT * FROM ocr_orders WHERE account=? AND status='pending'",account).first();
  if(order.price_id!==offer.price||order.product_id!==offer.product||order.environment!==offer.environment)throw new CreditError('Existing OCR purchase needs verification. Do not pay again.');return order;
 }
 async order(id,account){return this.query('SELECT * FROM ocr_orders WHERE id=? AND account=?',id,account).first();}
 async bindOrder(id,transaction){await this.query('UPDATE ocr_orders SET transaction_id=? WHERE id=? AND transaction_id IS NULL',transaction,id).run();}
 async pendingOrder(account){return (await this.query("SELECT id FROM ocr_orders WHERE account=? AND status='pending'",account).first())?.id||null;}
 async syncPayment(id,transaction,state,revoked=0){
  if(!Number.isSafeInteger(revoked)||revoked<0||revoked>500)throw new CreditError('Invalid OCR revocation');
  const existed=await this.query('SELECT id FROM ocr_grants WHERE id=?',transaction).first(),prior=await this.query('SELECT state,revoked FROM ocr_payment_sync WHERE order_id=?',id).first();
  if(prior?.state===state&&prior.revoked===revoked&&(state!=='completed'||existed)){await this.query('UPDATE ocr_payment_sync SET checked=? WHERE order_id=?',Date.now(),id).run();return false;}
  await this.query('INSERT INTO ocr_payment_commands VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,transaction,state,revoked,Date.now()).run();return state==='completed'&&!existed;
 }
 async paymentError(id){await this.query("INSERT INTO ocr_payment_sync(order_id,checked,state) VALUES(?,?,'error') ON CONFLICT(order_id) DO UPDATE SET checked=excluded.checked,state='error'",id,Date.now()).run();}
 async paymentStatus(account){return this.query("SELECT MAX(checked)/1000.0 AS lastChecked,COALESCE(MAX(state='error'),0) AS needsAttention,COALESCE(SUM(revoked),0) AS revokedPages FROM ocr_payment_sync s JOIN ocr_orders o ON o.id=s.order_id WHERE o.account=?",account).first();}
 async find(account,hash,model){return this.query(`SELECT * FROM ocr_attempts WHERE account=? AND model=? ${hash?'AND document_hash=?':''} ORDER BY created DESC LIMIT 1`,...[account,model,...(hash?[hash]:[])]).first();}
 async expireHolds(now){await this.query("INSERT INTO ocr_settlements(attempt,outcome,created) SELECT id,'uncertain',? FROM ocr_attempts WHERE state='held' AND deadline<=?",now,now).run();}
 async settle(id,outcome,now,cacheKey=null,expires=null){await this.query('INSERT INTO ocr_settlements(attempt,outcome,created,cache_key,expires) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ocr_settlements WHERE attempt=?)',id,outcome,now,cacheKey,expires,id).run();return this.query('SELECT * FROM ocr_attempts WHERE id=?',id).first();}
}
