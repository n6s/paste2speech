import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='work/wavenet-mp3-proof';
const manifests=JSON.parse(await readFile(`${root}/manifest.json`));
const results=[];
for(const manifest of manifests){
  const bytes=await readFile(`${root}/${manifest.voice}.mp3`);
  const began=performance.now();
  const response=await fetch('http://127.0.0.1:8787/',{method:'POST',
    headers:{'X-Section-Lengths':JSON.stringify(manifest.inspection.map(s=>s.bytes))},body:bytes});
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal(Number(response.headers.get('X-Audio-Duration')),manifest.duration);
  assert.deepEqual(JSON.parse(response.headers.get('X-Section-Starts')),manifest.starts);
  results.push({voice:manifest.voice,bytes:bytes.length,localRoundTripMs:performance.now()-began,
    duration:manifest.duration,identical:true});
}
const invalid=await fetch('http://127.0.0.1:8787/',{method:'POST',headers:{'X-Section-Lengths':'[3]'},body:'ID3'});
assert.equal(invalid.status,400);
await writeFile(`${root}/worker-results.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
