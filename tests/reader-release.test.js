import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateEnvironments,assertStagingPromotion} from '../scripts/reader-release-policy.mjs';
const staging=JSON.parse(readFileSync('cloudflare/reader/wrangler.staging.jsonc','utf8'));
const production=JSON.parse(readFileSync('cloudflare/reader/wrangler.production.jsonc','utf8'));
test('shared release keeps storage, access, payments and production allowance isolated',()=>{
 validateEnvironments(staging,production);
 for(const mutate of [s=>{s.d1_databases=production.d1_databases;},s=>{s.r2_buckets=production.r2_buckets;},s=>{s.vars.PADDLE_ENVIRONMENT='live';},s=>{s.vars.PRIVATE_READER='0';}]){const s=structuredClone(staging);mutate(s);assert.throws(()=>validateEnvironments(s,production));}
 for(const vars of [{ENABLE_PAYMENTS:'1'},{READER_MODE:'production-public'},{MAX_LIFETIME_CHARACTERS:'200000'}])assert.throws(()=>validateEnvironments(staging,{...production,vars:{...production.vars,...vars}}));
});
test('production promotion rejects a different revision, configuration, dirty build or assets',()=>{
 const release={environment:'staging',commit:'abc',dirty:false,configSHA256:'config',assets:{'index.html':'html','app.js':'js'}};
 assertStagingPromotion(release,release);
 for(const difference of [{environment:'production'},{commit:'old'},{dirty:true},{configSHA256:'changed'},{assets:{'app.js':'other'}}])assert.throws(()=>assertStagingPromotion({...release,...difference},release));
 assert.throws(()=>assertStagingPromotion(release,{...release,dirty:true}));
});
