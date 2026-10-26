import {build} from 'esbuild';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {gzipSync} from 'node:zlib';
export async function buildMathSpeech(root){
 await build({entryPoints:['public/math-speech-worker.js'],outfile:root+'/math-speech-worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,define:{global:'globalThis'},logLevel:'warning'});
 const packages=['@mathjax/src','speech-rule-engine','@xmldom/xmldom','wicked-good-xpath'];const licenses=[];
 for(const name of packages)licenses.push('=== '+name+' ===\n'+await readFile('node_modules/'+name+'/LICENSE','utf8'));
 await writeFile(root+'/math-speech-licenses.txt',licenses.join('\n\n'));
 const bytes=await readFile(root+'/math-speech-worker.js');await mkdir('work/math-prototype',{recursive:true});await writeFile('work/math-prototype/build-metrics.json',JSON.stringify({rawBytes:bytes.length,gzipBytes:gzipSync(bytes).length,lazyWorker:true,externalRuleRequests:0},null,2)+'\n');
}
