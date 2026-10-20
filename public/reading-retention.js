// Device-local lifetimes. Listening never renews the original added time.
export const READING_LIFETIME = 24 * 60 * 60 * 1000;
export function removalReason(record, {now, currentId} = {}) {
  if (record.finishedAt) return record.id === currentId ? null : 'finished';
  const added = record.createdAt;
  return Number.isFinite(added) && added > 0 && now - added >= READING_LIFETIME ? 'expired' : null;
}
export class RetentionClock {
  constructor({wall=Date.now, elapsed=()=>performance.now(), storage=globalThis.localStorage}={}) {
    this.wall=wall;this.elapsed=elapsed;this.storage=storage;this.anchor=wall();this.started=elapsed();
    try{this.high=Math.max(this.anchor,Number(storage?.getItem('paste2speech.retention.clock'))||0);}catch{this.high=this.anchor;}
  }
  now(){
    this.high=Math.max(this.high,this.wall(),this.anchor+Math.max(0,this.elapsed()-this.started));
    try{this.storage?.setItem('paste2speech.retention.clock',String(this.high));}catch{}
    return this.high;
  }
}
