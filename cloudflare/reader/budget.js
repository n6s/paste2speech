import {CreditError} from '../prepared/ledger.js';
export function periods(now=Date.now()){
 const d=new Date(now),day=d.toISOString().slice(0,10),month=day.slice(0,7);
 return {day,month,dailyReset:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1)).toISOString(),monthlyReset:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString()};
}
export async function capacity(db,now=Date.now()){
 const p=periods(now),row=await db.prepare("SELECT daily,monthly,COALESCE((SELECT characters FROM provider_periods WHERE period=?),0) AS dayUsed,COALESCE((SELECT characters FROM provider_periods WHERE period=?),0) AS monthUsed FROM public_controls WHERE id='public'").bind(p.day,p.month).first();
 if(!row)throw Error('Speech budget unavailable');
 return {...p,dailyRemaining:Math.max(0,row.daily-row.dayUsed),monthlyRemaining:Math.max(0,row.monthly-row.monthUsed),available:row.dayUsed<row.daily&&row.monthUsed<row.monthly};
}
// The insertion is the durable, atomic permission for exactly one provider call.
// A duplicate or ambiguous acknowledgement must never issue another paid call.
export async function dispatchBudget(db,job,section,text,clock=Date.now){
 const now=typeof clock==='function'?clock():clock,p=periods(now);
 try{await db.prepare('INSERT INTO provider_attempts VALUES(?,?,?,?,?,?)').bind(job,section,[...text].length,p.day,p.month,now).run();}
 catch{throw new CreditError('Speech capacity is unavailable. No provider retry was made.',429);}
 if(typeof clock==='function'&&periods(clock()).day!==p.day)throw new CreditError('Speech budget period changed before dispatch. Start a new reading.',429);
}
export async function recordOperations(env,now=Date.now()){
 const db=env.LEDGER,cap=await capacity(db,now);
 const checks=[['daily-budget',cap.dailyRemaining<=250000],['monthly-budget',cap.monthlyRemaining<=1250000]];
 const row=await db.prepare("SELECT (SELECT COUNT(*) FROM reservations WHERE state='open' AND created<?) AS stuck,(SELECT COUNT(*) FROM webhook_events WHERE processed IS NULL AND received<?) AS webhooks,(SELECT COUNT(*) FROM payment_sync WHERE state='error') AS payments,(SELECT COUNT(*) FROM orders WHERE creation_state='submitting' AND transaction_id IS NULL AND created<?) AS uncertain,(SELECT COUNT(*) FROM reading_audit WHERE outcome='failed' AND created>?) AS failures").bind(now-900000,now-300000,new Date(now-300000).toISOString(),now-3600000).first();
 checks.push(['stuck-reservations',row.stuck>0],['delayed-webhooks',row.webhooks>0],['payment-errors',row.payments>0],['uncertain-purchases',row.uncertain>0],['speech-failures',row.failures>0]);
 for(const [kind,active] of checks){
  const prior=await db.prepare('SELECT active FROM operations_alerts WHERE kind=?').bind(kind).first();
  if(active){
   await db.prepare('INSERT INTO operations_alerts(kind,first_seen,last_seen,occurrences,active) VALUES(?,?,?,1,1) ON CONFLICT(kind) DO UPDATE SET last_seen=excluded.last_seen,occurrences=occurrences+1,active=1').bind(kind,now,now).run();
   if(!prior?.active)console.error(JSON.stringify({event:'reader_operational_alert',kind}));
  }else if(prior?.active){await db.prepare('UPDATE operations_alerts SET active=0,last_seen=? WHERE kind=?').bind(now,kind).run();console.log(JSON.stringify({event:'reader_operational_recovery',kind}));}
 }
}
