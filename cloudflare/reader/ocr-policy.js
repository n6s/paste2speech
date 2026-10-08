import {publicMode} from './modes.js';
export const ocrRetailEnabled=env=>env.READER_MODE==='staging'?env.OCR_RETAIL_SANDBOX==='1':publicMode(env)&&env.OCR_RETAIL_LIVE_APPROVED==='1';
export const ocrOwnerOnly=env=>env.READER_MODE==='staging'&&env.OCR_STAGE_OWNER_ONLY!=='0';
export const reservationCents=pages=>Math.ceil(pages*.8);
export async function ocrCapacity(ledger){const b=await ledger.query('SELECT * FROM ocr_capacity').first();return {...b,available:!!b&&b.reserved_cents+b.committed_cents+500<=b.cap_cents};}
export async function providerPermit(ledger,env,account,hash,pages=1){
 if(env.READER_MODE!=='staging')return null;
 return ledger.query('SELECT p.* FROM ocr_provider_permits p JOIN identities i ON i.email=p.owner_email WHERE i.account=? AND p.enabled=1 AND p.calls<p.max_calls AND p.reserved_cents+?<=p.cap_cents AND p.max_pages>=? AND (p.document_hash IS NULL OR p.document_hash=?) ORDER BY p.document_hash IS NULL LIMIT 1',account,reservationCents(pages),pages,hash||'').first();
}
