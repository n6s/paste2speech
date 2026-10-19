// Never treat a sign-in document or an HTTP refusal as malformed MP3 bytes.
export function rejectPreparedSignIn(response){
 if(response.status===401||response.status===403||response.headers.get('content-type')?.includes('text/html')||response.redirected&&/\/cdn-cgi\/access\//.test(response.url)){
  const error=Error('Sign-in may be required to retrieve saved audio. Open this same site in another tab, sign in if asked, then return and tap Resume. Existing audio is kept; no speech was regenerated.');error.authRequired=true;error.statusUnavailable=false;error.retry=false;throw error;
 }
}
export async function checkAudioResponse(response){
 rejectPreparedSignIn(response);if(response.ok)return;
 const body=await response.clone().json().catch(()=>null),code=body?.code;
 if(code==='saved_section_invalid'){const e=Error('A saved audio section failed its integrity check. No speech was regenerated.');e.invalidAudio=true;throw e;}
 if([404,410,422].includes(response.status)||code==='saved_section_missing'){
  const e=Error(response.status===422||code==='preparation_failed'?'Preparation stopped on the server. Previously saved audio is kept; tap Resume to check recovery.':'A saved audio section is unavailable or expired. No speech was regenerated.');e.audioUnavailable=true;e.retry=false;throw e;
 }
 const e=Error(`Audio download interrupted (${response.status}).`);e.retry=response.status>=500||[408,409,429].includes(response.status);throw e;
}
