// Public promotion exercises the actual public build with isolated fixture APIs.
import {readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const site='work/production-reader/site';
assert.match(await readFile(site+'/app.js','utf8'),/var PERSISTENT_AUDIO = true;/);
await access(site+'/local-audio-sw.js');
for(const file of ['tests/persistent-audio-ui-browser.mjs','tests/temporary-playlist-browser.mjs','tests/reading-retention-browser.mjs'])
 execFileSync('node',[file],{stdio:'inherit',env:{...process.env,READER_SITE:site}});
console.log('PASS public persistent audio: real public assets, verified storage/reload/MP4 reuse, unified playlist and fixed retention; isolated fixtures, no provider calls.');
