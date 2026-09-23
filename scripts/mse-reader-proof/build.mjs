import {mkdir,copyFile} from 'node:fs/promises';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const root='work/mse-reader-proof/site';
await mkdir(`${root}/samples`,{recursive:true});
for(const file of ['index.html','style.css','app.js','player.js'])await copyFile(`scripts/mse-reader-proof/${file}`,`${root}/${file}`);
await copyFile('cloudflare/prepared/mp3.js',`${root}/mp3.js`);
for(const sections of Object.values(fixtures))for(const {file} of sections)await copyFile(`tests/fixtures/wavenet/${file}`,`${root}/samples/${file}`);
console.log('Built cached-only MSE reader.');
