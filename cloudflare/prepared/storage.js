// Page large arrays below Durable Object's per-value limit. Retain v1 reads.
const SIZE=100;
export async function loadJob(storage){
 const job=await storage.get('job');if(!job||job.storageVersion!==2)return job;
 const chunks=[],parts=[];
 for(let i=0;i<job.pageCount;i++){const page=await storage.get(`page:${i}`);if(!page)throw Error('Missing durable reading page');chunks.push(...page.chunks);parts.push(...page.parts);}
 return {...job,chunks,parts};
}
export async function saveJob(storage,job,alarm){
 await storage.transaction(async tx=>{
  const {chunks,parts,...meta}=job,pageCount=Math.ceil(chunks.length/SIZE);
  for(let i=0;i<pageCount;i++)await tx.put(`page:${i}`,{chunks:chunks.slice(i*SIZE,(i+1)*SIZE),parts:parts.slice(i*SIZE,(i+1)*SIZE)});
  const old=await tx.get('job');for(let i=pageCount;i<(old?.pageCount||0);i++)await tx.delete(`page:${i}`);
  await tx.put('job',{...meta,storageVersion:2,pageCount});
  if(alarm!==undefined)await tx.setAlarm(alarm);
 });
}
