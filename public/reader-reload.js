// Retire experimental cursors only. Paid part IDs remain reusable in this tab.
export function discardLegacyPositions(storage) {
 try {
  storage ||= globalThis.sessionStorage;
  for(let i=storage.length-1;i>=0;i--){
   const key=storage.key(i);
   if(key?.startsWith('paste2speech.position.'))storage.removeItem(key);
  }
 }catch{ /* Old cursors are ignored even if storage cannot be changed. */ }
}
