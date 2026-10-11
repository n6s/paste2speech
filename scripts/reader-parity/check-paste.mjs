// Use both reader builds when the public variant is present. Trial builds retain
// their historical controls; staging release preparation still covers staging.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const sites=['work/private-reader/site'];
if(/RELEASE\s*=\s*["']production-public["']/.test(readFileSync('work/production-reader/site/app.js','utf8')))sites.push('work/production-reader/site');
for(const site of sites)for(const test of ['tests/clipboard-fallback-browser.mjs','tests/paste-button-browser.mjs'])execFileSync('node',[test],{stdio:'inherit',env:{...process.env,READER_SITE:site}});
for(const test of ['tests/link-paste-browser.mjs','tests/paste-diagnostics-browser.mjs','tests/input-burst-browser.mjs'])execFileSync('node',[test],{stdio:'inherit'});
