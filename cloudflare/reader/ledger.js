import {UsageLedger,CreditError,digest,sourceCounts} from '../prepared/ledger.js';
export class ReaderLedger extends UsageLedger {
 async account(id){
  const account=await super.account(id);if(!account)return null;
  const pilot=await this.query('SELECT account FROM legacy_pilots WHERE account=?',id).first();
  const held=await this.query("SELECT COALESCE(SUM(remaining),0) AS reserved FROM reservations WHERE account=? AND state='open' AND metered=1",id).first();return {...account,legacyPilot:!!pilot,reserved:held.reserved};
 }
 async session(token,now=Date.now()){
  const current=await super.session(token,now);if(current||!token||token.length>100)return current;
  return this.query('SELECT a.id,a.label,a.balance,a.enabled FROM legacy_accounts l JOIN accounts a ON a.id=l.account WHERE l.token_hash=?',await digest(token)).first();
 }
 async logout(token){await super.logout(token);if(token)await this.query('DELETE FROM legacy_accounts WHERE token_hash=?',await digest(token)).run();}
 async settle(job){
  await super.settle(job);
  await this.query('INSERT INTO reading_audit VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET submitted=excluded.submitted,seconds=excluded.seconds,incomplete=excluded.incomplete,outcome=excluded.outcome',job.id,job.owner,job.created,job.voice,job.mode,job.submittedCharacters||0,job.parts.reduce((n,p)=>n+(p.samples||0)/24000,0),job.costIncomplete?1:0,job.state).run();
 }
 async summary(month,account=null){
  const rows=await this.query("SELECT 'google' AS provider,CASE WHEN mode='live' THEN 'reading' ELSE 'development' END AS kind,SUM(seconds) AS seconds,SUM(CASE WHEN mode='live' THEN submitted*0.000004 ELSE 0 END) AS providerCost,SUM(incomplete) AS incompleteCosts FROM reading_audit WHERE strftime('%Y-%m',created/1000,'unixepoch')=? AND (? IS NULL OR account=?) GROUP BY mode",month,account,account).all();
  const legacy=account?{results:[]}:await this.query("SELECT provider,kind,SUM(audio_seconds) AS seconds,SUM(provider_cost) AS providerCost,SUM(cost_incomplete) AS incompleteCosts FROM legacy_usage WHERE substr(created,1,7)=? GROUP BY provider,kind",month).all();
  return [...rows.results,...legacy.results];
 }
 async reserve(job,account,input){
  const identity=await this.account(account);
  if(!identity?.legacyPilot)await this.query('UPDATE accounts SET enabled=1 WHERE id=?',account).run();
  const counts=sourceCounts(input.chunks),total=counts.reduce((a,b)=>a+b,0);
  const fingerprint=await digest(JSON.stringify({voice:input.voice,chunks:input.chunks,mode:input.mode,scenario:''}));
  try{
   await this.query(`INSERT INTO reservations(job,account,fingerprint,plan,total,remaining,created,metered)
    SELECT ?,?,?,?,?,?,?,enabled FROM accounts WHERE id=? AND (enabled=0 OR balance>=?)
    AND NOT EXISTS(SELECT 1 FROM reservations WHERE job=?)`,job,account,fingerprint,JSON.stringify(counts),total,total,Date.now(),account,total,job).run();
  }catch(error){
   if(error.message?.includes('insufficient credit'))throw new CreditError('Your allowance is unavailable. Check your account.',402);
   // A committed debit can have a lost acknowledgement. Keep admission pending
   // so the durable recovery alarm can find that same reservation and settle it.
   throw error;
  }
  const row=await this.query('SELECT * FROM reservations WHERE job=?',job).first();
  if(!row)throw new CreditError('Not enough credit for this reading.',402);
  if(row.account!==account)throw new CreditError('Reading not found.',404);
  if(row.fingerprint!==fingerprint)throw new CreditError('This request key belongs to a different reading.');
  return row;
 }
 async assertOpen(job,account){
  const row=await this.query("SELECT job FROM reservations WHERE job=? AND account=? AND state='open' AND NOT EXISTS(SELECT 1 FROM account_debt WHERE account=? AND characters>0)",job,account,account).first();
  if(!row)throw new CreditError('The speech reservation is no longer available.');
 }
}
