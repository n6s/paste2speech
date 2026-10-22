import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistEntries,TemporaryPlaylist,mergePending,queuedPreparationPending} from '../public/temporary-playlist.js';
test('playlist order, navigation and retained readings use identical logical IDs without text deduplication',()=>{
 const records=[{id:'a',text:'Same text'},{id:'b',text:'Same text'},{id:'gone',text:'Removed'}];
 const pending=[{id:'c',state:'ready',text:'Pending'},{id:'a',text:'Stale handoff'}];
 const entries=playlistEntries({order:['c','b','a'],retired:['gone']},records,pending);
 assert.deepEqual(entries.map(item=>item.id),['c','b','a']);assert.equal(entries[2].saved,true);assert.equal(entries[1].text,entries[2].text);
});
test('retired membership wins over late pending and manifest writes',()=>{
 assert.deepEqual(playlistEntries({retired:['a']},[{id:'a',text:'late'}],[{id:'a',text:'late intake'}]),[]);
});
test('serialized playlist edits preserve original addition and queued metadata',async()=>{
 let value;const store={scope:'test',get:async()=>structuredClone(value),save:async(_,__,data)=>{value=structuredClone(data);}};
 const playlist=new TemporaryPlaylist(store);
 await Promise.all([playlist.edit(s=>s.order.push('a')),playlist.edit(s=>{s.order.push('b');s.pending.push({id:'b',createdAt:123,text:'private'});})]);
 assert.deepEqual(value.order,['a','b']);assert.equal(value.pending[0].createdAt,123);
 const restored=new TemporaryPlaylist(store);await restored.load();assert.deepEqual(restored.state,value);
});

import {ReadingQueue} from '../public/reading-queue.js';
test('metadata handoff consumes only its own pending ID, preserving the following item',async()=>{
 let selected;const queue=new ReadingQueue({start:item=>{selected=item.id;queue.items=queue.items.filter(p=>p.id!==item.id);return true;}});
 queue.playlist={entries:()=>queue.items,added:()=>{},selected:()=>selected,next:()=>queue.items[0]};
 const a=queue.reserve(),b=queue.reserve();queue.resolve(a.id,'First');queue.resolve(b.id,'Second');queue.advance();await new Promise(r=>setImmediate(r));
 assert.deepEqual(queue.items.map(item=>item.id),[b.id]);assert.equal(selected,a.id);
});

test('stale peer snapshots cannot regress ready text or resurrect removed queue entries',()=>{
 const old=[{id:'a',state:'ready',text:'Ready text',updatedAt:20},{id:'peer',state:'preparing',updatedAt:2}];
 const merged=mergePending(old,[{id:'a',state:'preparing',updatedAt:1},{id:'removed',state:'ready',updatedAt:30}],new Set(['a']),['removed']);
 assert.deepEqual(merged.map(item=>item.id),['peer','a']);assert.equal(merged[1].text,'Ready text');
});

test('saved successors advance only after completion, while manual navigation remains separate',async()=>{
 const opened=[];const queue=new ReadingQueue();queue.playlist={entries:()=>[{id:'saved'}],next:()=>({id:'saved',saved:true}),open:(item,options)=>opened.push({id:item.id,...options})};
 for(const state of ['playing','paused','failed'])queue.observe(state);await new Promise(r=>setImmediate(r));assert.equal(opened.length,0);
 queue.observe('done');await new Promise(r=>setImmediate(r));assert.deepEqual(opened,[{id:'saved',autoplay:true}]);
});

test('explicit queued replay overlays metadata only until that generation starts',()=>{
 const record={id:'a',text:'Queued',queueIntent:{engine:'google'}},pending={id:'a',text:'Queued',state:'ready',queuedReplay:true};
 assert.equal(playlistEntries({},[record],[pending])[0].saved,undefined);
 assert.equal(playlistEntries({},[{...record,queueStartedAt:1}],[pending])[0].saved,true);
 assert.deepEqual(playlistEntries({retired:['a']},[record],[pending]),[]);
});

test('only an untouched explicit queue intent authorizes initial preparation',()=>{
 const queued={queueIntent:{engine:'google'},records:[{state:'unprepared'}]};assert.equal(queuedPreparationPending(queued),true);
 for(const record of [{records:queued.records},{...queued,queueStartedAt:1},{...queued,records:[{state:'failed'}]},{...queued,records:[{state:'uncertain'}]},{...queued,records:[{state:'expired',id:'old'}]},{...queued,records:[{state:'unprepared',id:'admitted'}]}])assert.equal(queuedPreparationPending(record),false);
});
