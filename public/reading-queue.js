// Queue intent and handoff only. No speech, network requests, or paid retries happen here.
export class ReadingQueue {
  constructor({start, changed=()=>{}, removed=()=>{}}={}) {
    Object.assign(this,{start,changed,removed,items:[],sequence:0,armed:false,halted:false,scheduled:false,lastState:'idle',version:0});
  }
  reserve({title='Clipboard text',snapshot,placement='last',source='clipboard'}={}) {
    const limit=this.playlist?20:50;if(this.entries.length>=limit)throw Error(`The playlist has ${limit} readings. Remove one before adding another.`);
    const item={id:this.playlist ? crypto.randomUUID() : ++this.sequence,title,snapshot:structuredClone(snapshot),source,createdAt:Date.now(),updatedAt:Date.now(),state:'preparing'};
    placement==='next'?this.items.unshift(item):this.items.push(item);this.playlist?.added(item,placement);this.changed();return item;
  }
  get entries(){return this.playlist?.entries()||this.items;}
  has(id){return this.items.some(item=>item.id===id);}
  resolve(id,text){const item=this.items.find(item=>item.id===id);if(!item)return false;if(!text?.trim())return this.fail(id,'Nothing remains to read.');Object.assign(item,{text,state:'ready',error:'',updatedAt:Date.now()});this.changed();this.schedule();return true;}
  fail(id,message){const item=this.items.find(item=>item.id===id);if(!item)return false;Object.assign(item,{state:'error',error:message,updatedAt:Date.now()});this.changed();return false;}
  remove(id){if(this.playlist){void this.playlist.remove(id);return;}this.removePending(id);}
  removePending(id,{consumed=false}={}){const index=this.items.findIndex(item=>item.id===id);if(index<0)return;const [item]=this.items.splice(index,1);this.removed(item,{consumed});this.changed();this.schedule();}
  move(id,delta){if(this.playlist){void this.playlist.move(id,delta);return;}const index=this.items.findIndex(item=>item.id===id),next=index+delta;if(index<0||next<0||next>=this.items.length)return;[this.items[index],this.items[next]]=[this.items[next],this.items[index]];this.changed();this.schedule();}
  observe(state){if(state==='done'&&this.lastState!=='done'&&this.entries.length&&!this.halted){this.armed=true;this.schedule();}this.lastState=state;}
  stop(){this.retryingId=null;this.version++;this.halted=true;this.armed=false;}
  resume(){this.halted=false;}
  clear(){this.stop();const old=this.items;this.items=[];this.playlist?.clearPending?.(old);for(const item of old)this.removed(item);this.changed();}
  retry(id){const item=this.items.find(item=>item.id===id);if(this.starting||!item?.text?.trim()||!['error','ready'].includes(item.state))return false;Object.assign(item,{state:'ready',error:'',queuedReplay:true,updatedAt:Math.max(Date.now(),(item.updatedAt||0)+1)});this.retryingId=id;this.changed();this.advance();return true;}
  advance(){this.halted=false;this.armed=true;this.schedule();}
  schedule(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;void this.pump();});}
  async pump(){
    if(!this.armed||this.halted||this.starting)return;
    if(this.playlist){const next=this.items.find(item=>item.id===this.retryingId)||this.items.find(item=>item.queuedReplay&&item.id===this.playlist.selected())||this.playlist.next();if(!next)return; if(next.saved){this.armed=false;await this.playlist.open(next,{autoplay:true});return;}if(this.items[0]!==next){const index=this.items.indexOf(next);if(index<0)return;this.items.splice(index,1);this.items.unshift(next);}}
    if(this.items[0]?.state!=='ready')return;
    const item=this.items[0],version=this.version;this.armed=false;this.starting=true;this.changed();
    const current=()=>this.version===version&&!this.halted&&(this.items[0]===item||this.playlist?.selected()===item.id);
    try{const started=await this.start(item,current);if(started!==false&&current()){const index=this.items.indexOf(item);if(index>=0)this.items.splice(index,1);}}
    catch(error){if(current()){Object.assign(item,{state:'error',error:error.message||'This item could not start. No automatic retry was made.'});this.halted=true;}}
    finally{if(this.retryingId===item.id)this.retryingId=null;this.starting=false;this.changed();this.schedule();}
  }
}
