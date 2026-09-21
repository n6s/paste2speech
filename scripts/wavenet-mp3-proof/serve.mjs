// Loopback-only harness. Explicit --live enables at most one paid run per mode,
// with fixed synthetic input. This is not a production endpoint or auth design.
import http from 'node:http';
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {assemble, captions} from './assemble.mjs';

const root = 'work/wavenet-mp3-proof';
const manifests = JSON.parse(await readFile(`${root}/manifest.json`));
const live = process.argv.includes('--live');
const python = process.env.P2S_PROBE_PYTHON || '/home/roger/workarea/paste2speech/work/google-wavenet-audition/venv/bin/python';
const jobs = new Map();
let counter = 0;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const json = (res, status, data) => {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function status(job) {
  const contiguous = [];
  for (const b of job.parts) {if(!b)break;contiguous.push(b);}
  const timeline = contiguous.length ? assemble(contiguous) : {starts:[],duration:0};
  return {state:job.error?'failed':job.done?'ready':'preparing',...timeline,total:8,error:job.error};
}
async function prepare(job, voice, mode, paid) {
  const source = manifests.find(m=>m.voice===voice);
  job.texts = source.sections.map(s=>s.text);
  if (paid) {
    const output = `${root}/live-${mode}`;
    await mkdir(output,{recursive:true});
    const process = spawn(python,['scripts/wavenet-mp3-proof/generate.py','--generate','--voice',voice,'--output',output],{stdio:['ignore','pipe','ignore']});
    let lines = '', chain = Promise.resolve();
    process.stdout.on('data', data => {
      lines += data;
      const chunks = lines.split('\n'); lines = chunks.pop();
      for(const line of chunks.filter(Boolean)) chain = chain.then(async()=>{
        const info=JSON.parse(line);
        job.parts[info.index] = await readFile(`${output}/${voice}-${String(info.index).padStart(2,'0')}.mp3`);
        // Validate BEFORE making bytes available to streaming clients.
        assemble([job.parts[info.index]]);
      });
    });
    const code = await new Promise(resolve=>process.on('close',resolve));
    await chain;
    if(code!==0)throw Error('Synthetic generation stopped; no retry.');
  } else {
    const start = performance.now();
    const origin = Math.min(...source.sections.map(s=>s.sentSeconds));
    await Promise.all(source.sections.map(async section=>{
      await sleep(Math.max(0,(section.readySeconds-origin)*1000-(performance.now()-start)));
      job.parts[section.index]=await readFile(`${root}/${section.file}`);
    }));
  }
  if(job.parts.filter(Boolean).length!==8)throw Error('Incomplete preparation');
  job.timeline = assemble(job.parts);
  job.bytes = Buffer.concat(job.parts);
  job.done = true;
  job.readyMs = performance.now()-job.started;
  if(paid){
    const output=`${root}/live-${mode}`;
    await writeFile(`${output}/reading.mp3`,job.bytes);
    await writeFile(`${output}/reading.vtt`,captions(job.texts,job.timeline));
    await writeFile(`${output}/timeline.json`,JSON.stringify(job.timeline,null,2));
  }
}
const server = http.createServer(async (req,res)=>{
  try {
    if(req.headers.host!=='127.0.0.1:8786'){res.writeHead(403).end();return;}
    const url = new URL(req.url,'http://127.0.0.1:8786');
    if(req.method==='POST' && req.headers.origin!=='http://127.0.0.1:8786'){res.writeHead(403).end();return;}
    if(req.method==='POST' && url.pathname==='/api/readings') {
      let body='';for await(const part of req){body+=part;if(body.length>10000)throw Error('Body too large');}
      const input=JSON.parse(body), mode=input.provider==='full'?'full':'progressive';
      const voice=input.voice==='en-GB-Wavenet-F'?input.voice:'en-US-Wavenet-F';
      if(input.provider.startsWith('live-') && !live)return json(res,403,{detail:'Paid runs disabled. Select a cached replay.'});
      const paid=live && input.provider.startsWith('live-');
      const actualMode=paid?(input.provider==='live-full'?'full':'progressive'):mode;
      if(paid){
        try{await access(`${root}/live-${actualMode}/attempt.json`);return json(res,409,{detail:'Paid run already attempted. Use cached replay.'});}catch{}
        if([...jobs.values()].some(j=>j.paid && j.mode===actualMode))return json(res,409,{detail:'Paid run already started.'});
      }
      const id=String(++counter),job={id,parts:[],done:false,started:performance.now(),mode:actualMode,paid};
      jobs.set(id,job);
      job.preparation=prepare(job,voice,actualMode,paid).catch(()=>{job.error='Preparation failed. No automatic retry.';});
      if(actualMode==='full')await job.preparation;
      return json(res,200,{id});
    }
    if(req.method==='POST' && url.pathname==='/metrics') {
      let body='';for await(const p of req){body+=p;if(body.length>200000)throw Error('Too large');}
      const data=JSON.parse(body);
      await writeFile(`${root}/browser-${Date.now()}.json`,JSON.stringify(data,null,2));
      return json(res,200,{saved:true});
    }
    const match=url.pathname.match(/^\/api\/readings\/(\d+)(.*)$/);
    if(match){
      const job=jobs.get(match[1]);if(!job)return json(res,404,{});
      if(req.method==='DELETE')return json(res,200,{}); // cached proof records retained
      if(!match[2])return json(res,200,{...status(job),readyMs:job.readyMs});
      if(match[2]==='/download/vtt'){
        if(!job.done)return json(res,409,{});
        res.writeHead(200,{'Content-Type':'text/vtt'});return res.end(captions(job.texts,job.timeline));
      }
      if(match[2]==='/audio' || match[2]==='/download/mp3') {
        if(job.done){
          const bytes=job.bytes, range=req.headers.range;
          const headers={'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'no-store'};
          if(range){
            const parsed=/^bytes=(\d+)-(\d*)$/.exec(range);
            if(!parsed){res.writeHead(416).end();return;}
            const start=Number(parsed[1]),end=parsed[2]?Math.min(Number(parsed[2]),bytes.length-1):bytes.length-1;
            if(start>end){res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`}).end();return;}
            res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${bytes.length}`});
            return res.end(bytes.subarray(start,end+1));
          }
          res.writeHead(200,{...headers,'Content-Length':bytes.length});return res.end(bytes);
        }
        res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store'});
        for(let i=0;i<8;i++){
          while(!job.parts[i] && !job.error && !res.destroyed)await sleep(10);
          if(job.error || res.destroyed)return res.end();
          res.write(job.parts[i]);
        }
        return res.end();
      }
    }
    const sample=url.pathname.match(/^\/samples\/(en-(?:US|GB)-Wavenet-F)-(0[0-7])\.mp3$/);
    if(sample){res.writeHead(200,{'Content-Type':'audio/mpeg'});return res.end(await readFile(`${root}/${sample[1]}-${sample[2]}.mp3`));}
    const files={'/':['scripts/wavenet-mp3-proof/index.html','text/html'],
      '/proof.js':['scripts/wavenet-mp3-proof/proof.js','text/javascript'],
      '/progressive-player.js':['public/progressive-player.js','text/javascript'],
      '/manifest.json':[`${root}/manifest.json`,'application/json']};
    const file=files[url.pathname];
    if(file){res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});return res.end(await readFile(file[0]));}
    res.writeHead(404).end();
  }catch {if(!res.headersSent)json(res,500,{detail:'Proof request failed'});else res.end();}
});
server.listen(8786,'127.0.0.1',()=>console.log(`Private proof: http://127.0.0.1:8786 (paid synthetic runs ${live?'enabled, maximum two':'disabled'})`));
