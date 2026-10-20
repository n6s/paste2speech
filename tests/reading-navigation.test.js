import test from 'node:test';
import assert from 'node:assert/strict';
import {LongReadingTransport} from '../public/long-reading.js';
globalThis.location={href:'https://fixture/'};
test('saved reading metadata opens without waiting for full audio verification',async()=>{
 const transport=new LongReadingTransport(()=>{throw Error('No network expected');});
 let release;const hydrating=new Promise(resolve=>release=resolve),job={hydrating,status:null};
 transport.assets={scope:'owner',store:{},onChange(){},allow(){},register(){return job;},observe(id,status){job.status=status;}};
 const status={state:'ready',sections:[],starts:[],total:1};const record={id:'book',key:'book',scope:'owner',generation:'g',voice:'en-US-Wavenet-H',parts:[{chunks:['Text.']}],statuses:[status],records:[{id:'paid',state:'ready'}]};
 try{assert.equal(await Promise.race([transport.restoreLocal(record).then(()=>true),new Promise(resolve=>setImmediate(()=>resolve(false)))]),true);assert.equal(transport.localRestore.key,'book');}finally{release();}
});

import {splitReadingChunks} from '../public/playlist-plan.js';
test('explicit provider conversion borrows an existing live audio preparation without another admission',async()=>{
 const transport=new LongReadingTransport(()=>{throw Error('No upstream request expected');},{limit:()=>20000});transport.assets={scope:'owner'};
 const chunks=['Text.'],voice='en-US-Wavenet-H',parts=splitReadingChunks(chunks,[],20000),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({parts,voice}))))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const live={id:'original-paid-preparation',key:'paste2speech.video.'+hash,ownerScope:'owner'};transport.groups.set(live.id,live);transport.nextLogicalReading={id:'reading-seven',createdAt:1000};
 const result=await transport.fetch('https://fixture/api/readings',{method:'POST',body:JSON.stringify({chunks,voice})});assert.equal((await result.json()).id,live.id);assert.equal(transport.groups.size,1);assert.equal(live.logicalReading.id,'reading-seven');assert.equal(live.logicalReading.createdAt,1000);
});

test('conversion keeps logical identity when reusing an already-restored paid reading',async()=>{
 const transport=new LongReadingTransport(()=>{throw Error('No upstream request expected');});transport.assets={scope:'owner'};
 const group={id:'paid-nine',ownerScope:'owner',parts:[{chunks:['Same text.']}],session:{voice:'en-US-Wavenet-H'}};transport.localRestore=group;transport.nextLogicalReading={id:'reading-seven',createdAt:1000};
 const result=await transport.fetch('https://fixture/api/readings',{method:'POST',body:JSON.stringify({chunks:['Same text.'],voice:'en-US-Wavenet-H'})});assert.equal((await result.json()).id,'paid-nine');assert.equal(group.logicalReading.id,'reading-seven');assert.equal(transport.nextLogicalReading,null);
});

import {PersistentReadingAssets} from '../public/persistent-reading-assets.js';
test('account change immediately detaches old reading groups even with unfinished background verification',()=>{
 const transport=new LongReadingTransport(),assets=new PersistentReadingAssets(()=>{throw Error('No network expected');},{storeFactory:()=>({})});transport.assets=assets;assets.setScope('owner-a');let stopped=false;
 const group={id:'old',ownerScope:'owner-a',localSave:true,session:{stop(){stopped=true;}}};transport.groups.set(group.id,group);transport.localRestore=group;assets.setScope('owner-b');assert.equal(transport.groups.size,0);assert.equal(transport.localRestore,null);assert.equal(stopped,true);assert.equal(group.localSave,false);assets.dispose();
});
