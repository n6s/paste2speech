import {reviewedReaderLive} from './modes.js';
import {UnifiedWallet,assertUnifiedEnvironment} from './unified-wallet.js';
export const SUMMARY_CREDIT_UNITS=1000;
export const summaryPriced=env=>(env.READER_MODE==='staging'||reviewedReaderLive(env))&&env.SUMMARY_PRICE_CREDITS==='1'&&env.UNIFIED_CREDITS==='1';
export class SummaryCredits {
 constructor(env,now=Date.now){this.env=env;this.db=env.LEDGER;this.now=now;this.wallet=new UnifiedWallet(this.db,env);}
 query(sql,...values){return this.db.prepare(sql).bind(...values);}
 async check(){await assertUnifiedEnvironment(this.db,this.env);await this.query('SELECT id FROM summary_credit_attempts LIMIT 1').first();}
 async balance(account){return this.wallet.balance(account);}
 async read(id,account){return this.query('SELECT a.*,r.summary,r.expires FROM summary_credit_attempts a LEFT JOIN summary_credit_results r ON r.attempt=a.id WHERE a.id=? AND a.account=?',id,account).first();}
 hold(id,account,language,length,started,fingerprint){return this.query("INSERT INTO summary_credit_attempts(id,account,created,updated,deadline,language,length,fingerprint) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM summary_free_requests WHERE id=? AND account=? AND state='admitted')",id,account,started,started,started+120000,language,length,fingerprint,id,account);}
 async dispatch(id,account){const r=await this.query("UPDATE summary_credit_attempts SET dispatched=? WHERE id=? AND account=? AND state='held' AND dispatched IS NULL AND deadline>?",this.now(),id,account,this.now()).run();return r.meta?.changes===1;}
 async prepare(id,account,summary){const time=this.now();const r=await this.db.batch([this.query("INSERT INTO summary_credit_results(attempt,summary,expires) SELECT id,?,? FROM summary_credit_attempts WHERE id=? AND account=? AND state='held' AND dispatched IS NOT NULL AND deadline>=?",summary,time+86400000,id,account,time),this.query("UPDATE summary_credit_attempts SET state='prepared',updated=? WHERE id=? AND account=? AND state='held' AND deadline>=? AND EXISTS(SELECT 1 FROM summary_credit_results WHERE attempt=?)",time,id,account,time,id)]);return r[1].meta?.changes>0;}
 async release(id,account,state='canceled'){await this.db.batch([this.query("INSERT OR IGNORE INTO summary_free_requests(id,account,created,state) VALUES(?,?,?,'failed')",id,account,this.now()),this.query("UPDATE summary_credit_attempts SET state=?,updated=? WHERE id=? AND account=? AND state IN('held','prepared')",state,this.now(),id,account),this.query("UPDATE summary_free_requests SET state='failed' WHERE id=? AND account=? AND NOT EXISTS(SELECT 1 FROM summary_credit_attempts WHERE id=? AND state='ready')",id,account,id)]);return this.read(id,account);}
 async accept(id,account){await this.query("UPDATE summary_credit_attempts SET state='ready',updated=? WHERE id=? AND account=? AND state='prepared' AND deadline>=?",this.now(),id,account,this.now()).run();return this.read(id,account);}
 async expire(){const time=this.now();await this.db.batch([this.query("UPDATE summary_credit_attempts SET state='expired',updated=? WHERE state IN('held','prepared') AND deadline<?",time,time),this.query('DELETE FROM summary_credit_results WHERE expires<=?',time)]);}
}
export async function maintainSummaryCredits(env){if(summaryPriced(env))await new SummaryCredits(env).expire();}
