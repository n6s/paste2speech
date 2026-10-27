// Playlist membership is independent of retained audio manifests. All mutations
// run inside TemporaryPlaylist.edit's account-scoped cross-tab lock.
export function migrateUnfinished(state,readings,pending=[]){
 if(state.version===2)return;
 const retired=new Set(state.retired||[]),byId=new Map([...readings,...pending].map(item=>[item.id,item]));
 for(const record of readings)if(record.finishedAt||record.playedAt)retired.add(record.id);
 state.order=[...new Set([...(state.order||[]),...byId.keys()])].filter(id=>byId.has(id)&&!retired.has(id));
 state.retired=[...retired];state.pending=[...new Map([...(state.pending||[]),...pending].map(item=>[item.id,item])).values()].filter(item=>!retired.has(item.id));
 state.version=2;state.currentId=null;state.playIntent='paused';
}
export function admitUnfinished(state,id,{after,last=true}={}){
 if(state.retired.includes(id)||state.order.includes(id))return false;
 const index=after?state.order.indexOf(after):-1;
 state.order.splice(!last&&index>=0?index+1:state.order.length,0,id);return true;
}
export function retireUnfinished(state,ids){
 const removing=new Set(ids),current=state.currentId,index=state.order.indexOf(current);
 const forward=index<0?null:state.order.slice(index+1).find(id=>!removing.has(id))||null;
 const boundary={before:state.order.slice(0,Math.max(0,index)).filter(id=>!removing.has(id)),after:index<0?[]:state.order.slice(index+1).filter(id=>!removing.has(id)),autoplay:state.playIntent==='playing'};
 state.order=state.order.filter(id=>!removing.has(id));state.pending=(state.pending||[]).filter(item=>!removing.has(item.id));
 state.retired=[...new Set([...state.retired,...ids])];
 for(const id of ids)if(state.started)delete state.started[id];
 if(removing.has(current)){state.anchor=boundary;state.currentId=null;state.playIntent='stopped';}
 return forward;
}

export function unfinishedTargets(state,currentId=state.currentId){
 const order=state.order||[],index=order.indexOf(currentId);
 if(index>=0)return {previous:order[index-1]||null,next:order[index+1]||null,index};
 const before=new Set(state.anchor?.before||[]),after=new Set(state.anchor?.after||[]);
 return {previous:order.filter(id=>before.has(id)).at(-1)||null,next:order.find(id=>after.has(id))||null,index:-1};
}
