import {CreditError} from './ledger.js';

// The caller must durably store the job AND a recovery alarm before invoking
// this function, and serialize admission with creation/cancellation/expiry.
// A committed reservation with a lost response is safe to look up again using
// the same job ID; this function never starts synthesis.
export async function admitJob(job,{ledger,save,afterReserve=async()=>{}}){
  if(job.admission!=='pending'||job.state!=='preparing')return;
  let reservation;
  try{reservation=await ledger.reserve(job.id,job.owner,job);}
  catch(error){
    if(!(error instanceof CreditError)||error.status!==402)throw error;
    job.admission='rejected';job.state='failed';job.error=error.message;
    await save(job);return;
  }
  await afterReserve();
  job.admission='accepted';
  if(reservation.state!=='open'){
    job.state='failed';job.error='This reservation was already settled. Start a new reading.';
  }
  await save(job);
}
