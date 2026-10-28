import {reviewedReaderLive,customerAllowed} from './modes.js';
// One versioned public rollout flag keeps the Free-plan binding budget bounded.
// Staging retains independent flags; trial/local/unreviewed deployments stay off.
export const PUBLIC_READER_FEATURES='reader-2026-10-28';
const promoted=new Set(['SUMMARY_DOCUMENT_SCHEMA','PODCAST_PLAYLIST','MATH_SPEECH_PREVIEW','TRANSLATION_UI','TRANSLATION_BILLING_SCHEMA','TRANSLATION_DOCUMENT_SCHEMA','TRANSLATION_LIVE_APPROVED']);
export const publicReaderFeatures=env=>reviewedReaderLive(env)&&env.LOCAL_READER!=='1'&&env.READER_FEATURES_VERSION===PUBLIC_READER_FEATURES;
export const readerFeature=(env,name)=>env.LOCAL_READER!=='1'&&(env.READER_MODE==='staging'?env[name]==='1':publicReaderFeatures(env)&&promoted.has(name)&&env[name]!=='0');
export const featureCustomer=(env,account,verified)=>account?.[verified]===true&&account.enabled===1&&(env.READER_MODE==='staging'?!!account.email&&account.email===env.OWNER_EMAIL:publicReaderFeatures(env)&&customerAllowed(env,account));
// Rate-limit new document admissions, not status/result reads or each portion.
export async function featureAdmissionLimit(env,account){
 if(!publicReaderFeatures(env))return true;
 return !!env.READING_LIMIT&&(await env.READING_LIMIT.limit({key:'feature:'+account.id})).success===true;
}
