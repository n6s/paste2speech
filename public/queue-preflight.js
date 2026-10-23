// Read-only account confirmation. It never admits speech or retries a request.
export async function checkQueuedAccount(snapshot,fetcher=globalThis.fetch.bind(globalThis)){
 if(snapshot.engine!=='google')return;
 if(!snapshot.scope)throw Error('Account checks were still loading when this item was added. Add it again after checking your account. No speech was started.');
 let response,config;
 try{response=await fetcher('/api/ocr/jobs/config',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}
 catch{throw Object.assign(Error('Connection or sign-in check failed. Text kept. No speech was started.'),{transientRead:true});}
 if(!response.ok)throw Object.assign(Error([401,403].includes(response.status)?'Sign in to PasteToSpeech in another tab, then retry Play. No speech was started.':'The account could not be confirmed. Open the queued text, then Play to retry. No speech was started.'),{transientRead:response.status>=500||[408,429].includes(response.status)});
 try{config=await response.json();}catch{throw Error('The account check returned an unreadable response. Sign in in another tab if needed, then press Play. No speech was started.');}
 if(config.consentScope!==snapshot.scope)throw Error('The account changed after this item was queued. Add it again for the current account. No speech was started.');
}
