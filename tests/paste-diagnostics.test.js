import test from 'node:test';
import assert from 'node:assert/strict';
import {pasteSignature,WEATHER_SOURCE} from '../public/paste-diagnostics.js';
test('paste diagnostic retains counts and fixed public sentence classifications, never arbitrary source',()=>{
 const secret='PRIVATE-CONTENT-DO-NOT-SHARE https://private.invalid/secret?credential=abc';
 const report=pasteSignature(secret+'\n'+WEATHER_SOURCE);
 assert.equal(report.grandJunctionLabel,true);assert.equal(report.saltLakeLabel,true);assert.equal(report.knownWeatherSentence,WEATHER_SOURCE);
 assert.ok(!JSON.stringify(report).includes(secret));assert.ok(!JSON.stringify(report).includes('private.invalid'));assert.ok(!JSON.stringify(report).includes('credential'));
 assert.equal(pasteSignature(secret).knownWeatherSentence,null);assert.equal(pasteSignature(null),null);
 for(const length of [20000,29294,30075])assert.equal(pasteSignature('x'.repeat(length)).characters,length);
});
