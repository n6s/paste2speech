import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
// Immutable upstream archives; hashes pin exactly what accompanies this build.
export async function copyEncoderSources(root) {
 const manifest=JSON.parse(await readFile('cloudflare/reader/licenses/sources.json','utf8'));
 for(const [name,version] of [['core',manifest.coreVersion],['ffmpeg',manifest.wrapperVersion]]) {
  const installed=JSON.parse(await readFile(`node_modules/@ffmpeg/${name}/package.json`,'utf8'));
  if(installed.version!==version)throw Error(`Update encoder sources for @ffmpeg/${name} ${installed.version}`);
 }
 await mkdir('work/encoder-sources',{recursive:true});await mkdir(root+'/licenses/sources',{recursive:true});
 for(const source of manifest.sources) {
  const cache='work/encoder-sources/'+source.file;let bytes;
  try{bytes=await readFile(cache);}catch(error){
   if(error.code!=='ENOENT')throw error;
   const response=await fetch(source.url,{signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw Error(`Source archive unavailable: ${source.name} (${response.status})`);
   bytes=Buffer.from(await response.arrayBuffer());
   if(createHash('sha256').update(bytes).digest('hex')!==source.upstreamSHA256)throw Error(`Upstream source archive hash differs: ${source.name}`);
   if(source.compression==='xz')bytes=execFileSync('xz',['-6','--stdout'],{input:gunzipSync(bytes),maxBuffer:64*1024*1024});
  }
  if(bytes.length!==source.bytes||createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error(`Source archive hash differs: ${source.name}`);
  await writeFile(cache,bytes);await copyFile(cache,root+'/licenses/sources/'+source.file);
 }
 return manifest.sources.map(source=>'licenses/sources/'+source.file);
}
