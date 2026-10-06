import {digest} from '../prepared/ledger.js';
// Check the live verified session itself: legacy and anonymous cookies never confer owner access.
export async function ownerAccess(db, token, email, now=Date.now()) {
 if(!email || !token || token.length>100)return false;
 return !!await db.prepare(`SELECT s.account FROM sessions s JOIN identities i ON i.account=s.account
 JOIN accounts a ON a.id=s.account WHERE s.token_hash=? AND s.expires>? AND s.kind='verified'
 AND i.email=? AND a.enabled=1`).bind(await digest(token),now,email).first();
}
