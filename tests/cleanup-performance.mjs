import assert from 'node:assert/strict';
import {cleanText} from '../public/text.js';
// Four times the reported clipboard size exposes quadratic retrying without
// relying on phone speed or tiny per-call timing differences.
const input='a'.repeat(120300);
const start=performance.now();
assert.equal(cleanText(input),input);
const ms=performance.now()-start;
assert.ok(ms<1000,`Unwrapped paragraph cleanup stalled: ${ms.toFixed(2)}ms`);
assert.equal(cleanText('First wrapped\nline without punctuation\ncontinues.\nNext sentence.'),'First wrapped line without punctuation continues.\nNext sentence.');
console.log(`PASS 120,300-character unwrapped cleanup: ${ms.toFixed(2)}ms; wrapped-line behavior retained.`);
