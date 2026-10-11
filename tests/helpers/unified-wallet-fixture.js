import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ReaderLedger} from '../../cloudflare/reader/ledger.js';
import {UnifiedWallet} from '../../cloudflare/reader/unified-wallet.js';
import {unifiedPaymentConfig} from '../../cloudflare/reader/unified-payments.js';
const now=Date.now(),txn='txn_'+'u'.repeat(26),price='pri_'+'u'.repeat(26),product='pro_'+'u'.repeat(26);
function fixture(environment='staging'){
 const live=environment!=='staging';
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA recursive_triggers=ON');for(const f of readdirSync('cloudflare/reader/migrations').filter(f=>f.endsWith('.sql')&&(environment==='production'||f<'0017')).sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+f,'utf8'));if(!live)sql.exec(readFileSync('cloudflare/reader/staging-migrations/0010_unified_wallet.sql','utf8'));
 sql.exec("INSERT INTO accounts(id,label,enabled,balance) VALUES('a','A',1,12345),('b','B',1,987);INSERT INTO identities VALUES('a@example.invalid','a'),('b@example.invalid','b');INSERT INTO ocr_accounts VALUES('a',17,0);INSERT INTO ocr_business_budget VALUES('sandbox-retail',1000,0)");
 let lose=null;const db={prepare(s){let values=[];const q={bind(...v){values=v;return q;},async first(){return sql.prepare(s).get(...values)||null;},async all(){return {results:sql.prepare(s).all(...values)};},async run(){const result=sql.prepare(s).run(...values);if(lose&&s.startsWith(lose)&&result.changes){lose=null;throw Error('lost acknowledgement');}return {success:true,meta:{changes:result.changes}};},execute(){return {meta:{changes:sql.prepare(s).run(...values).changes}};}};return q;},async batch(rows){sql.exec('BEGIN');try{const results=rows.map(q=>q.execute());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={LEDGER:db,UNIFIED_CREDITS:'1',READER_MODE:'staging',PADDLE_ENVIRONMENT:'sandbox',PADDLE_API_KEY:'pdl_sdbx_apikey_fake',PADDLE_CLIENT_TOKEN:'test_fake',PADDLE_UNIFIED_PRICE_ID:price,PADDLE_UNIFIED_PRODUCT_ID:product,PADDLE_PRICE_ID:'pri_'+'s'.repeat(26),PADDLE_PRODUCT_ID:'pro_'+'s'.repeat(26),PADDLE_OCR_PRICE_ID:'pri_'+'o'.repeat(26),PADDLE_OCR_PRODUCT_ID:'pro_'+'o'.repeat(26),ENABLE_PAYMENTS:'1',ENABLE_UNIFIED_PAYMENTS:'1',OWNER_EMAIL:'a@example.invalid',OCR_RETAIL_SANDBOX:'1',OCR_RETAIL_PROVIDER_MODE:'synthetic',ENABLE_DOCUMENT_OCR:'1'};
 if(live)Object.assign(env,{UNIFIED_LIVE_APPROVED:'1',READER_MODE:'production-public',PADDLE_ENVIRONMENT:'live',PADDLE_API_KEY:'pdl_live_apikey_synthetic',PADDLE_CLIENT_TOKEN:'live_synthetic',PUBLIC_LAUNCH_OPEN:'1',PRIVATE_READER:'0',LOCAL_READER:'0',READER_ORIGIN:'https://pastetospeech.com',OCR_RETAIL_LIVE_APPROVED:'1',OCR_RETAIL_PROVIDER_MODE:'live',MISTRAL_API_KEY:'isolated-fixture-only',ENABLE_LIVE_SYNTHESIS:'1'});
 const cache=new Map();env.AUDIO={put:async(k,v)=>cache.set(k,v),get:async k=>cache.has(k)?{json:async()=>JSON.parse(cache.get(k))}:null,delete:async k=>cache.delete(k)};
 const wallet=new UnifiedWallet(db,env),speech=new ReaderLedger(db,env);
 const grant=(units,account='a',id=crypto.randomUUID())=>sql.prepare("INSERT INTO unified_events(id,account,kind,reference,delta,created) VALUES(?,?,'test-grant','isolated-fixture',?,?)").run(id,account,units,now);
 const ocr=(id,pages=1)=>sql.prepare("INSERT INTO ocr_attempts(id,account,document_hash,model,mime,pages,name,created,updated,deadline,wallet_version) VALUES(?,'a',?,'fixture','application/pdf',?,'fixture',?,?,?,'unified-v1')").run(id,id.padEnd(64,'a'),pages,now,now,now+300000);
 return {sql,db,env,wallet,speech,grant,ocr,cache,loseAck(prefix){lose=prefix;}};
}
const input={voice:'en-US-Wavenet-F',chunks:['abc','de'],mode:'live'};
const legacy=f=>[f.sql.prepare("SELECT balance FROM accounts WHERE id='a'").get().balance,f.sql.prepare("SELECT balance FROM ocr_accounts WHERE account='a'").get().balance];
async function purchase(f,id=txn){const config=unifiedPaymentConfig(f.env);let order=await f.wallet.newOrder('a',config);await f.wallet.bindOrder(order.id,id);order=await f.wallet.order(order.id,'a');let adjustments=[];
 const remote={id,status:'completed',custom_data:{p2s_order:order.id},currency_code:'USD',subscription_id:null,items:[{quantity:1,price:{id:price,product_id:product,billing_cycle:null,unit_price:{amount:'1000',currency_code:'USD'}}}],details:{totals:{discount:'0',subtotal:'1000'}}};
 const provider={config,transaction:async()=>remote,adjustments:async()=>adjustments};return {order,provider,remote,setRefund(cents,id='r'){adjustments=[{id:'adj_'+id.repeat(26),transaction_id:order.transaction_id,currency_code:'USD',status:'approved',action:'refund',totals:{subtotal:String(cents)}}];}};
}

export {fixture,purchase,input,legacy,now,txn,price,product};
