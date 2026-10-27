import{summarySourceFits}from'../../public/summary-limits.js';
import{SUMMARY_DOCUMENT_MODEL,summaryDigest}from'../../public/summary-document-plan.js';
import{SummaryDocuments}from'./summary-documents.js';
import{summaryDocumentProvider}from'./summary-document-provider.js';
import{SUMMARY_DOCUMENT_VERSION}from'../../public/summary-document-plan.js';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function body(request){const reader=request.body?.getReader();if(!reader)throw Error('Summary request required.');const chunks=[];let size=0;for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>524288){await reader.cancel();throw Error('Summary request exceeds the transport limit. Your full source is kept.');}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
export async function summaryDocumentResponse(request,env,account,{now=Date.now,ctx,provider}={}){
 if(env.READER_MODE!=='staging'||env.SUMMARY_DOCUMENT_SCHEMA!=='1')return reply({detail:'Not found.'},404);
 if(!account?.summaryVerified||account.email!==env.OWNER_EMAIL||account.enabled!==1)return reply({detail:'Verified staging account required.'},403);
 if(request.method!=='POST')return reply({detail:'Method not allowed.'},405);
 let input;try{input=await body(request);}catch(e){return reply({detail:e.message||'Invalid Summary request.'},422);}
 if(input.scope!==account.id||input.version!==SUMMARY_DOCUMENT_VERSION)return reply({detail:'Summary account or policy changed. Nothing was sent.'},409);
 const service=new SummaryDocuments(env,{now,provider:provider||((text,stage,preset)=>summaryDocumentProvider(env,text,stage,preset))});
 try{
  if(input.action==='legacy'){await service.check(account);if(typeof input.text!=='string'||!summarySourceFits(input.text)||!['brief','standard','detailed'].includes(input.preset))return reply({});const fingerprint=await summaryDigest(JSON.stringify([SUMMARY_DOCUMENT_MODEL,input.text,'general',input.preset]));const row=await service.q("SELECT a.state,r.summary,r.expires FROM summary_credit_attempts a LEFT JOIN summary_credit_results r ON r.attempt=a.id WHERE a.account=? AND a.fingerprint=? AND a.state IN('ready','held','prepared','uncertain') ORDER BY a.created DESC LIMIT 1",account.id,fingerprint).first();if(row?.state==='ready'&&row.expires>now()&&row.summary)return reply({text:row.summary,cached:true});if(row&&row.state!=='ready')return reply({blocked:true,detail:'The previous Summary outcome needs checking. No duplicate request was made.'});return reply({});}
  if(input.action==='quote')return reply(await service.quote(account,input));
  if(!['open','status','pause','result','step'].includes(input.action))return reply({detail:'Unknown Summary action.'},422);
  if(input.action==='open')return reply({document:await service.open(account,input)});
  if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id))return reply({detail:'Summary identity required.'},422);
  if(input.action==='status')return reply({document:await service.status(account,input.id)});
  if(input.action==='pause')return reply({document:await service.pause(account,input.id)});
  if(input.action==='result'){if(!Number.isSafeInteger(input.part)||input.part<0)return reply({detail:'Saved section required.'},422);return reply(await service.result(account,input.id,input.part));}
  // Admission and dispatch checks live in the coordinator. Keep an already admitted
  // operation alive after a disconnected caller, without starting any extra work.
  const work=service.step(account,input.id,input);ctx?.waitUntil(work.catch(()=>{}));return reply(await work);
 }catch(e){return reply({detail:/credit|capacity|quote|Source|source|Summary|summary|account/.test(e.message||'')?e.message:'Summary could not be checked. Existing work is kept; no automatic retry.'},409);}
}
