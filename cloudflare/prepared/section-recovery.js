import {inspectMp3} from './mp3.js';
export const sectionRecoveryEnabled=env=>env.READER_MODE==='staging'&&env.PRIVATE_READER==='1'&&env.SPEECH_SECTION_RECOVERY==='1';
const chars=chunks=>chunks.reduce((n,t)=>n+[...t].length,0);
export class RecoveryBlocked extends Error{constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
export async function verifiedSection(store,job,index){
 const meta=job.parts[index];if(!Number.isSafeInteger(meta?.bytes)||meta.bytes<=0||meta.bytes>32*1024*1024||!Number.isSafeInteger(meta.samples)||meta.samples<=0)throw new RecoveryBlocked('saved_section_invalid','Saved audio metadata could not be verified. No replacement speech was started.');const object=await store.get(`${job.id}/part-${index}`);
 if(!object)throw new RecoveryBlocked('saved_section_missing','A saved audio section is missing. No replacement speech was started.');
 if(object.size!==undefined&&object.size!==meta.bytes)throw new RecoveryBlocked('saved_section_invalid','A saved audio section could not be verified. No replacement speech was started.');
 const bytes=new Uint8Array(await object.arrayBuffer());let info;
 try{info=inspectMp3(bytes);}catch{throw new RecoveryBlocked('saved_section_invalid','A saved audio section could not be verified. No replacement speech was started.');}
 if(info.bytes!==meta.bytes||info.samples!==meta.samples)throw new RecoveryBlocked('saved_section_invalid','A saved audio section does not match its recorded timing. No replacement speech was started.');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(meta.sha256&&meta.sha256!==sha256)throw new RecoveryBlocked('saved_section_invalid','A saved audio section does not match its recorded digest. No replacement speech was started.');
 return {bytes,sha256};
}
// Read-only proof. Never reopen a settled reservation or retry a submitting marker.
export async function sectionRecovery(job,{store,receipt,usage,now=Date.now()}){
 if(job.state!=='failed'||job.expires<=now||!job.mseOptions)throw new RecoveryBlocked('recovery_unavailable','This interrupted part is not available for section recovery.');
 let prefix=0;while(job.parts[prefix]?.state==='ready')prefix++;
 if(job.parts.slice(prefix).some(p=>p.state!=='pending')||job.attempts!==prefix||job.submittedCharacters!==chars(job.chunks.slice(0,prefix)))throw new RecoveryBlocked('uncertain_attempt','A previous speech request is uncertain. Saved audio is kept; no new speech was started.');
 if(prefix>100||job.parts.slice(0,prefix).reduce((n,p)=>n+(p.bytes||0),0)>32*1024*1024)throw new RecoveryBlocked('recovery_limit','Saved audio needs a separate recovery review. No new speech was started.');
 if(job.parts.slice(0,prefix).some(p=>!/^[a-f0-9]{64}$/.test(p.sha256||'')))throw new RecoveryBlocked('legacy_integrity_unavailable','This saved audio predates integrity receipts and needs review. No replacement speech was started.');
 const reusedCharacters=chars(job.chunks.slice(0,prefix));
 if(!receipt||receipt.state!=='closed'||receipt.outcome!=='failed'||receipt.consumed!==reusedCharacters||usage.length!==prefix||usage.some((u,i)=>u.section!==i||u.characters!==chars([job.chunks[i]])))throw new RecoveryBlocked('settlement_unverified','The previous part’s settlement could not be verified. No new speech was started.');
 const sections=[];let samples=0;
 for(let index=0;index<prefix;index++){const part=job.parts[index],verified=await verifiedSection(store,job,index);sections.push({index,start:samples/24000,samples:part.samples,bytes:part.bytes,sha256:verified.sha256});samples+=part.samples;}
 const key=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['speech-section-recovery-v1',job.owner,job.id,prefix]))));key[6]=(key[6]&15)|64;key[8]=(key[8]&63)|128;const hex=[...key.slice(0,16)].map(n=>n.toString(16).padStart(2,'0')).join(''),nextRequestId=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 const inputDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({voice:job.voice,chunks:job.chunks}))))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {version:1,nextRequestId,inputDigest,id:job.id,voice:job.voice,reusedSections:prefix,reusedCharacters,remainingCharacters:chars(job.chunks.slice(prefix)),totalSections:job.chunks.length,expires:job.expires,
  prefix:{id:job.id,state:'ready',completed:prefix,total:prefix,sections,starts:sections.map(s=>s.start),duration:samples/24000,providerCost:job.submittedCharacters*4e-6,costIncomplete:!!job.costIncomplete}};
}
