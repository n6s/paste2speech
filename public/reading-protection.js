// A selected reading or export holds a shared browser lock. Pressure cleanup
// may take an exclusive lock only when no tab is using that reading. Locks
// survive timer suspension and are released by the browser when a tab closes.
// Without Web Locks, automatic cleanup stays disabled rather than guessing.
export class ReadingProtection {
  constructor({locks=globalThis.navigator?.locks}={}) {
    this.locks=locks;this.held=new Map();
  }
  get supported(){return typeof this.locks?.request==='function';}
  async key(scope,id){
    const bytes=new TextEncoder().encode(JSON.stringify([scope,id]));
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return 'paste2speech.reading.'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  async hold(scope,id){
    if(!this.supported)return ()=>{};
    const key=await this.key(scope,id);
    let entry=this.held.get(key);
    if(!entry){
      let ready,failed,release;
      const acquired=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
      const finished=new Promise(resolve=>release=resolve);
      entry={count:0,acquired,release};this.held.set(key,entry);
      entry.request=this.locks.request(key,{mode:'shared'},async()=>{ready();await finished;}).catch(error=>{failed(error);if(this.held.get(key)===entry)this.held.delete(key);});
    }
    entry.count++;
    try{await entry.acquired;}catch(error){entry.count--;throw error;}
    let released=false;
    return ()=>{
      if(released)return;released=true;
      if(--entry.count===0){if(this.held.get(key)===entry)this.held.delete(key);entry.release();}
    };
  }
  async exclusive(scope,id,operation){
    if(!this.supported)return {protected:true,reason:'cross-tab-protection-unavailable'};
    const key=await this.key(scope,id);
    return this.locks.request(key,{mode:'exclusive',ifAvailable:true},lock=>lock?operation():{protected:true,reason:'reading-in-use'});
  }
}
