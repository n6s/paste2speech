import {fixture} from './unified-wallet-fixture.js';
import {readFileSync,readdirSync} from 'node:fs';
import {PUBLIC_READER_FEATURES} from '../../cloudflare/reader/reader-features.js';
export function publicFeaturesFixture({migrate=true}={}){
 const f=fixture('production');
 for(const name of readdirSync('cloudflare/reader/migrations').filter(n=>n>='0018'&&n<'0025').sort())f.sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));
 Object.assign(f.env,JSON.parse(readFileSync('cloudflare/reader/wrangler.public.jsonc','utf8')).vars,{READER_FEATURES_VERSION:PUBLIC_READER_FEATURES,AI:{},READING_LIMIT:{limit:async()=>({success:true})}});
 f.grant=(units,account='a')=>f.sql.prepare("INSERT INTO unified_events(id,account,kind,reference,delta,created) VALUES(?,?,'purchase','isolated-synthetic-fixture',?,?)").run(crypto.randomUUID(),account,units,Date.now());
 f.account={id:'a',email:'a@example.invalid',enabled:1,summaryVerified:true,translationVerified:true,translationScope:'scope-a'};
 f.other={...f.account,id:'b',email:'b@example.invalid',translationScope:'scope-b'};
 f.migrate=()=>{for(const name of readdirSync('cloudflare/reader/migrations').filter(n=>n>='0025').sort())f.sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));};
 if(migrate)f.migrate();return f;
}
