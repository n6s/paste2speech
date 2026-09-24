import assert from 'node:assert/strict';
export function validateEnvironments(staging,production){
 assert.equal(staging.vars.READER_MODE,'staging');
 assert.equal(staging.vars.PRIVATE_READER,'1');
 assert.equal(staging.vars.LOCAL_READER,'0');
 assert.equal(staging.vars.MSE_STAGING,'1');
 assert.ok(staging.vars.ACCESS_ISSUER&&staging.vars.ACCESS_AUD);
 assert.equal(staging.vars.PADDLE_ENVIRONMENT,'sandbox');
 assert.equal(staging.vars.ENABLE_PAYMENTS,'1');
 assert.equal(staging.vars.MAX_LIFETIME_CHARACTERS,undefined);
 assert.equal(production.vars.READER_MODE,'production-trial');
 assert.equal(production.vars.PRIVATE_READER,'0');
 assert.equal(production.vars.LOCAL_READER,'0');
 assert.equal(production.vars.ENABLE_PAYMENTS,'0');
 assert.equal(production.vars.PROGRESSIVE_READER,'1');
 assert.equal(production.vars.MAX_LIFETIME_CHARACTERS,'100000');
 assert.ok(production.vars.TRIAL_EMAIL);
 assert.equal(staging.vars.ENABLE_LIVE_SYNTHESIS,'1');
 assert.equal(production.vars.ENABLE_LIVE_SYNTHESIS,'1');
 assert.notEqual(staging.name,production.name);
 assert.notEqual(staging.vars.READER_ORIGIN,production.vars.READER_ORIGIN);
 const productionDBs=new Set(production.d1_databases.map(d=>d.database_id));
 assert.ok(staging.d1_databases.every(d=>!productionDBs.has(d.database_id)),'Staging must use separate databases');
 const productionBuckets=new Set(production.r2_buckets.map(b=>b.bucket_name));
 assert.ok(staging.r2_buckets.every(b=>!productionBuckets.has(b.bucket_name)),'Staging must use separate audio storage');
}
export function assertStagingPromotion(staged,expected){
 assert.equal(staged.environment,'staging');
 assert.equal(staged.dirty,false,'Staging must be deployed from a clean commit');
 assert.equal(expected.dirty,false,'Release must be built from a clean commit');
 assert.equal(staged.commit,expected.commit,'Deploy this exact commit to staging before production');
 assert.equal(staged.configSHA256,expected.configSHA256,'Staging configuration differs from this release');
 assert.deepEqual(staged.assets,expected.assets,'Staging assets differ from this release');
}
