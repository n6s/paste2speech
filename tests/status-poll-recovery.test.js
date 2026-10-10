import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaylistSession} from '../public/playlist-session.js';

test('reader retries status outages against the saved job without recreating speech',async()=>{
 const posts=[],reads=[],connections=[];let failures=3;
 const session=new PlaylistSession([{chunks:['Already authorized speech.']}],'en-US-Wavenet-F',{
  retryStatus:true,sleep:async()=>{},connectionChanged:error=>connections.push(!!error),
  fetcher:async(path,options={})=>{
   if(path==='/api/billing/session')return Response.json({});
   if(path==='/api/readings'){posts.push(options.headers['Idempotency-Key']);return Response.json({id:posts[0]});}
   reads.push(path);if(failures-->0)throw new TypeError('Failed to fetch');
   return Response.json({state:'ready',total:1,completed:1,starts:[0],sections:[{}]});
  }
 });
 await session.prepare();assert.equal(posts.length,1);assert.equal(new Set(reads).size,1);
 assert.deepEqual(connections,[true,true,true,false]);assert.equal(session.records[0].state,'ready');
});

test('status retry classification separates network and temporary HTTP errors from terminal responses',async()=>{
 for(const code of [408,409,429,500,503,401,403,404,410]){
  const session=new PlaylistSession([],'v',{fetcher:async()=>new Response('',{status:code})});
  await assert.rejects(session.status('saved'),error=>error.statusUnavailable===(code>=500||[408,409,429].includes(code)));
 }
 const broken=new PlaylistSession([],'v',{fetcher:async()=>new Response('invalid JSON')});
 await assert.rejects(broken.status('saved'),error=>error.name==='SyntaxError'&&!error.statusUnavailable);
});

test('Stop interrupts offline status backoff without a replacement job',async()=>{
 let disconnected;const observed=new Promise(resolve=>disconnected=resolve),posts=[];
 const session=new PlaylistSession([{chunks:['Speech.']}],'v',{
  retryStatus:true,sleep:()=>new Promise(()=>{}),connectionChanged:error=>{if(error)disconnected();},
  fetcher:async(path,options={})=>{
   if(path==='/api/billing/session')return Response.json({});
   if(path==='/api/readings'){posts.push(options.headers['Idempotency-Key']);return Response.json({});}
   throw new TypeError('Offline');
  }
 });
 const preparing=session.prepare();await observed;session.stop();await preparing;
 assert.equal(posts.length,1);assert.ok(session.records[0].id);assert.equal(session.stopped,true);
});

test('expired server jobs remain terminal despite reader status retries',async()=>{
 const session=new PlaylistSession([{chunks:['Speech.']}],'v',{
  retryStatus:true,records:[{id:'existing'}],fetcher:async()=>Response.json({state:'expired'})
 });
 await assert.rejects(session.prepare(),/expired/);assert.equal(session.records[0].id,'existing');
});
