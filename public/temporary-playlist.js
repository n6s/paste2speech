// One ordered set of logical reading IDs. Audio jobs remain independently shared.
export function playlistEntries(state, readings, pending) {
  const retired = new Set(state.retired || []), byId = new Map();
  for (const record of readings) if ((!record.damaged||state.version===2) && !retired.has(record.id)) byId.set(record.id, {...record, saved:true, title:record.text?.trim().split(/\r?\n/)[0].replace(/[#*_`]/g,'').slice(0,72)||'Reading'});
  for (const item of pending) if (!retired.has(item.id) && (!byId.has(item.id)||item.queuedReplay&&byId.get(item.id).queueIntent&&!byId.get(item.id).queueStartedAt)) byId.set(item.id,item);
  if(state.version===2)for(const id of state.order||[])if(!retired.has(id)&&!byId.has(id))byId.set(id,{id,saved:true,damaged:true,title:'Reading unavailable'});
  const order = state.version===2 ? [...new Set(state.order||[])] : [...new Set([...(state.order || []), ...byId.keys()])];
  return order.filter(id=>byId.has(id)).map(id=>byId.get(id));
}
export function mergePending(existing, incoming, known, retired=[], saved=[]) {
  const removed=new Set([...retired,...saved]), current=new Map(existing.map(item=>[item.id,item]));
  const next=new Map(existing.filter(item=>!known.has(item.id)).map(item=>[item.id,item]));
  const rank={preparing:0,ready:1,error:2};
  for(const item of incoming){const old=current.get(item.id);next.set(item.id,old&&((old.updatedAt||0)>(item.updatedAt||0)||(old.updatedAt||0)===(item.updatedAt||0)&&(rank[old.state]||0)>(rank[item.state]||0))?old:item);}
  return [...next.values()].filter(item=>!removed.has(item.id));
}
export class TemporaryPlaylist {
  constructor(store,{key='temporary-playlist'}={}) { this.store=store;this.key=key;this.state={order:[],retired:[],pending:[]};this.tail=Promise.resolve(); }
  async load(){this.state=await this.store.get('usage',this.key)||this.state;return this.state;}
  edit(change){
    const run=async()=>{await this.load();change(this.state);await this.store.save('usage',this.key,{...this.state,id:this.key});return this.state;};
    const locked=()=>globalThis.navigator?.locks?navigator.locks.request('paste2speech-playlist:'+this.store.scope+(this.key==='temporary-playlist'?'':':'+this.key),run):run();
    return this.tail=this.tail.catch(()=>{}).then(locked);
  }
}

// Only the original, untouched queue intent can authorize first preparation.
// Existing, failed, expired or previously played audio needs its normal recovery path.
export function queuedPreparationPending(record){
 return !!record.queueIntent&&!record.queueStartedAt&&Array.isArray(record.records)&&record.records.length>0&&record.records.every(part=>part.state==='unprepared'&&!part.id);
}
