import {readFile, writeFile} from 'node:fs/promises';
import {assemble, captions} from './assemble.mjs';
const root = process.argv[2] || 'work/wavenet-mp3-proof';
const generated = JSON.parse(await readFile(`${root}/generated.json`));
const manifests = [];
for (const voice of [...new Set(generated.sections.map(s => s.voice))]) {
  const sections = generated.sections.filter(s => s.voice === voice);
  const bytes = await Promise.all(sections.map(s => readFile(`${root}/${s.file}`)));
  const timeline = assemble(bytes);
  const manifest = {voice, ...timeline, sections};
  await writeFile(`${root}/${voice}.mp3`, Buffer.concat(bytes));
  await writeFile(`${root}/${voice}.vtt`, captions(sections.map(s => s.text), timeline));
  await writeFile(`${root}/${voice}.json`, JSON.stringify(manifest, null, 2));
  manifests.push(manifest);
}
await writeFile(`${root}/manifest.json`, JSON.stringify(manifests, null, 2));
console.log(JSON.stringify(manifests.map(({voice,duration,starts,inspection})=>({voice,duration,starts,frames:inspection.reduce((n,s)=>n+s.frames,0)})),null,2));
