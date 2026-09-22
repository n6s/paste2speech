import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root='work/wavenet-worker-proof/site';await mkdir(`${root}/samples`,{recursive:true});
let html=await readFile('scripts/wavenet-mp3-proof/index.html','utf8');
html=html.replaceAll('Private WaveNet MP3 proof','Private WaveNet Worker proof')
  .replace('Synthetic text only.','Local Worker, durable preparation and stored audio. Synthetic text only. Google pronunciation and pauses, with no overrides.')
  .replace('<option value="progressive">Cached progressive replay</option>','')
  .replace('<option value="live-progressive">Live synthetic progressive (paid, once)</option>','');
await writeFile(`${root}/index.html`,html);
await copyFile('scripts/wavenet-mp3-proof/proof.js',`${root}/proof.js`);
await copyFile('public/progressive-player.js',`${root}/progressive-player.js`);
await copyFile('work/wavenet-mp3-proof/manifest.json',`${root}/manifest.json`);
const manifest=JSON.parse(await readFile(`${root}/manifest.json`));
for(const voice of manifest)for(const s of voice.sections)await copyFile(`work/wavenet-mp3-proof/${s.file}`,`${root}/samples/${s.file}`);
console.log('Built local Worker proof with cached synthetic audio.');
for(const name of ['signin.html','signin.js','signin.css'])await copyFile(`server/billing/${name}`,`${root}/${name}`);
for(const name of ['account.html','account.js'])await copyFile(`scripts/wavenet-worker-proof/${name}`,`${root}/${name}`);
