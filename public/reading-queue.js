// Tab-local intent only. No speech, network requests, or paid retries happen here.
export class ReadingQueue {
  constructor({start, changed=()=>{}, removed=()=>{}}={}) {
    Object.assign(this,{start,changed,removed,items:[],sequence:0,armed:false,halted:false,scheduled:false,lastState:'idle',version:0});
  }
  reserve({title='Clipboard text',snapshot,placement='last',source='clipboard'}={}) {
    if(this.items.length>=50)throw Error('The queue has 50 items. Remove an item before adding another.');
    const item={id:++this.sequence,title,snapshot:structuredClone(snapshot),source,state:'preparing'};
    placement==='next'?this.items.unshift(item):this.items.push(item);this.changed();return item;
  }
  has(id){return this.items.some(item=>item.id===id);}
  resolve(id,text){const item=this.items.find(item=>item.id===id);if(!item)return false;if(!text?.trim())return this.fail(id,'Nothing remains to read.');Object.assign(item,{text,state:'ready',error:''});this.changed();this.schedule();return true;}
  fail(id,message){const item=this.items.find(item=>item.id===id);if(!item)return false;Object.assign(item,{state:'error',error:message});this.changed();return false;}
  remove(id){const index=this.items.findIndex(item=>item.id===id);if(index<0)return;const [item]=this.items.splice(index,1);this.removed(item);this.changed();this.schedule();}
  move(id,delta){const index=this.items.findIndex(item=>item.id===id),next=index+delta;if(index<0||next<0||next>=this.items.length)return;[this.items[index],this.items[next]]=[this.items[next],this.items[index]];this.changed();this.schedule();}
  observe(state){if(state==='done'&&this.lastState!=='done'&&this.items.length&&!this.halted){this.armed=true;this.schedule();}this.lastState=state;}
  stop(){this.version++;this.halted=true;this.armed=false;}
  resume(){this.halted=false;}
  clear(){this.stop();const old=this.items;this.items=[];for(const item of old)this.removed(item);this.changed();}
  advance(){this.halted=false;this.armed=true;this.schedule();}
  schedule(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;void this.pump();});}
  async pump(){
    if(!this.armed||this.halted||this.starting||this.items[0]?.state!=='ready')return;
    const item=this.items[0],version=this.version;this.armed=false;this.starting=true;
    const current=()=>this.version===version&&!this.halted&&this.items[0]===item;
    try{const started=await this.start(item,current);if(started!==false&&current())this.items.shift();}
    catch(error){if(current()){Object.assign(item,{state:'error',error:error.message||'This item could not start. No automatic retry was made.'});this.halted=true;}}
    finally{this.starting=false;this.changed();this.schedule();}
  }
}
