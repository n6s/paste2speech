// Only cron and operator-populated D1 rows can reach this path. No public route.
export async function runMaintenance(env,now=Date.now()){
 if(env.MAINTENANCE_QUEUE_ENABLED!=='1')return;
 const rows=await env.LEDGER.prepare("SELECT * FROM reader_maintenance WHERE state='pending' AND next_attempt<=? ORDER BY updated,object_id LIMIT 5").bind(now).all();
 for(const row of rows.results){
  let result;
  try{
   const id=/^[a-f0-9]{64}$/.test(row.object_id)?env.JOBS.idFromString(row.object_id):env.JOBS.idFromName(row.object_id);
   const response=await env.JOBS.get(id).fetch('https://job/maintenance',{method:'POST',body:JSON.stringify({action:row.action})});
   if(!response.ok)throw Error('maintenance_response');
   result=await response.json();
  }catch{result={attention:true,code:'maintenance_request_failed'};}
  const attempts=row.attempts+1;
  const state=result.attention?'attention':row.action==='inspect'||result.done?'done':attempts>=100?'attention':'pending';
  await env.LEDGER.prepare('UPDATE reader_maintenance SET state=?,next_attempt=?,attempts=?,result=?,updated=? WHERE object_id=?').bind(state,now+60000,attempts,JSON.stringify(result),now,row.object_id).run();
 }
}
