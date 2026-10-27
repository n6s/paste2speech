import{planTranslationDocument}from'./translation-document.js';
// The browser drives one bounded chunk at a time. Reload never starts inference.
export function documentTranslationClient({fetcher,scope,valid,onProgress,onBillingChange=()=>{},verifyScope=async()=>{}}){
 let document=null,plan=null,stop=false,owns=false;
 const request=async(action,extra={})=>{const response=await fetcher('/api/translation/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,scope:scope(),priceCreditsPer1000:4,...extra})});const value=await response.json();await verifyScope();if(['open','resume','pause'].includes(action)||action==='part'&&extra.text!==undefined)onBillingChange();if(!valid())throw Error('The account, source or target changed. Completed portions remain private to the original account.');if(!response.ok)throw Error(value.detail||'Translation could not be confirmed. Saved portions are kept.');return value;};
 const emit=parts=>{if(valid())onProgress({document,text:parts.join('\n\n'),partial:document.state!=='ready'});};
 const load=async()=>{const parts=[];for(let i=0;i<document.next;i++){if(!valid())return parts;const r=await request('part',{id:document.id,part:i});if(typeof r.text!=='string')throw Error('A saved portion could not be loaded. No regeneration was requested.');parts.push(r.text);}emit(parts);return parts;};
 return{
  async inspect(text,target,signal){stop=false;plan=await planTranslationDocument(text,target,{signal});if(!valid())return null;document=await request('lookup',{target,sourceHash:plan.hash,manifest:plan.manifest});if(document)await load();return document;},
  async run(text,target,signal){stop=false;owns=true;if(!plan||plan.text!==text||plan.target!==target)plan=await planTranslationDocument(text,target,{signal});if(!valid())return;
   document=await request('open',{requestId:crypto.randomUUID(),restartExpired:true,target,sourceHash:plan.hash,characters:plan.characters,manifest:plan.manifest,...(plan.characters<=30000?{legacySource:text}:{})});if(typeof document.legacyText==='string'){emit([document.legacyText]);return document;}let parts=await load();if(!valid()||stop)return;
   if(document.state==='paused')document=await request('resume',{id:document.id});
   while(valid()&&!stop&&document.state==='active'&&document.next<plan.chunks.length){const index=document.next;const r=await request('part',{id:document.id,part:index,text:plan.chunks[index].text});document=r;if(!valid()||stop)return;if(typeof r.text==='string'&&r.part===index){parts.push(r.text);emit(parts);}else{emit(parts);if(r.state==='active')throw Error('A portion is still processing. Pause and check this document; no duplicate request was sent.');break;}}
   emit(parts);return document;
  },
  async pause(){stop=true;if(owns&&document?.id){document=await request('pause',{id:document.id});return document;}},
  get current(){return document;}
 };
}
