// Tab-local cursors contain no reading text. Storage failure must not break audio.
const prefix='paste2speech.position.';
export function readPosition(key, count, storage) {
 try {
  const p=JSON.parse((storage||globalThis.sessionStorage).getItem(prefix+key)||'null');
  if(p?.version!==1||!Number.isSafeInteger(p.index)||p.index<0||p.index>=count||!Number.isFinite(p.offset)||p.offset<0||!Number.isFinite(p.updated)||Date.now()-p.updated>=86400000)return null;
  return {...p,key};
 }catch{return null;}
}
export function writePosition(key,index,offset,storage) {
 try {(storage||globalThis.sessionStorage).setItem(prefix+key,JSON.stringify({version:1,index,offset,updated:Date.now()}));}catch{}
}
export function forgetPosition(key,storage) {try{if(key)(storage||globalThis.sessionStorage).removeItem(prefix+key);}catch{}}
