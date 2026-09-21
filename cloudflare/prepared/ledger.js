const encode=new TextEncoder();
export const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export const sourceCounts=chunks=>chunks.map(text=>[...text].length);
export class CreditError extends Error {constructor(message,status=409){super(message);this.status=status;}}
export class UsageLedger {
  constructor(db){this.db=db;}
  query(sql,...values){return this.db.prepare(sql).bind(...values);}
  async session(token,now=Date.now()){
    if(typeof token!=='string'||token.length>100)return null;
    return this.query('SELECT a.id,a.label,a.balance,a.enabled FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.token_hash=? AND s.expires>?',await digest(token),now).first();
  }
  // Call only after an authoritative identity check. The local harness uses
  // seeded synthetic identities; this method is not a public login endpoint.
  async issueSession(account,now=Date.now()){
    const token=crypto.randomUUID()+crypto.randomUUID();
    await this.query('INSERT INTO sessions(token_hash,account,expires) VALUES(?,?,?)',await digest(token),account,now+3600000).run();
    return token;
  }
  async logout(token){if(token)await this.query('DELETE FROM sessions WHERE token_hash=?',await digest(token)).run();}
  async account(id){
    return this.query("SELECT id,label,balance,enabled,(SELECT COALESCE(SUM(remaining),0) FROM reservations WHERE account=accounts.id AND state='open') AS reserved FROM accounts WHERE id=?",id).first();
  }
  async receipt(job,account){return this.query('SELECT job,total,remaining,state,outcome,consumed,released FROM reservations WHERE job=? AND account=?',job,account).first();}
  async reserve(job,account,input){
    const counts=sourceCounts(input.chunks),total=counts.reduce((a,b)=>a+b,0);
    const fingerprint=await digest(JSON.stringify({voice:input.voice,chunks:input.chunks,mode:input.mode,scenario:input.proofScenario||''}));
    // Trigger debit and insert are atomic. INSERT ... SELECT prevents duplicate
    // requests from running the balance-check trigger a second time.
    await this.query(`INSERT INTO reservations(job,account,fingerprint,plan,total,remaining,created)
      SELECT ?,?,?,?,?,?,? FROM accounts WHERE id=? AND enabled=1 AND balance>=?
      AND NOT EXISTS(SELECT 1 FROM reservations WHERE job=?)`,job,account,fingerprint,JSON.stringify(counts),total,total,Date.now(),account,total,job).run();
    const row=await this.query('SELECT * FROM reservations WHERE job=?',job).first();
    if(!row)throw new CreditError('Not enough test credit for this reading.',402);
    if(row.account!==account)throw new CreditError('Reading not found.',404);
    if(row.fingerprint!==fingerprint)throw new CreditError('This request key belongs to a different reading.');
    return row;
  }
  async assertOpen(job,account){
    const row=await this.query("SELECT job FROM reservations r JOIN accounts a ON r.account=a.id WHERE r.job=? AND r.account=? AND r.state='open' AND a.enabled=1",job,account).first();
    if(!row)throw new CreditError('The speech reservation is no longer available.');
  }
  async settle(job){
    if(!['ready','failed','cancelled','expired'].includes(job.state))return;
    const row=await this.query('SELECT * FROM reservations WHERE job=? AND account=?',job.id,job.owner).first();
    if(!row)throw new CreditError('Missing speech reservation.');
    if(row.state==='closed')return;
    const plan=JSON.parse(row.plan),statements=[];
    if(job.parts.length!==plan.length)throw new CreditError('Reservation plan mismatch.');
    for(let index=0;index<plan.length;index++)if(job.parts[index].state==='ready'){
      statements.push(this.query(`INSERT INTO usage(job,section,characters) SELECT ?,?,?
        WHERE NOT EXISTS(SELECT 1 FROM usage WHERE job=? AND section=?)`,job.id,index,plan[index],job.id,index));
    }
    statements.push(this.query("UPDATE reservations SET released=remaining,remaining=0,state='closed',outcome=? WHERE job=? AND account=? AND state='open'",job.state,job.id,job.owner));
    // D1 batch is transactional: no partial success-charge/refund commit.
    await this.db.batch(statements);
  }
}
