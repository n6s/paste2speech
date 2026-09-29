import {digest,CreditError,UsageLedger} from './ledger.js';
const random=()=>crypto.randomUUID()+crypto.randomUUID();
export function normalizeEmail(value){
 if(typeof value!=='string'||value.length>254||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value))throw new CreditError('Enter a valid email address.',422);
 return value.toLowerCase();
}
export class EmailIdentity extends UsageLedger {
 async request(email,source,ip,now=Date.now()){
  email=normalizeEmail(email);const token=random(),flow=random();
  try{await this.db.batch([
   this.query('DELETE FROM login_links WHERE expires<=?',now),
   this.query('DELETE FROM sessions WHERE expires<=?',now),
   this.query('DELETE FROM login_limits WHERE created<=?',now-86400000),
   this.query('INSERT INTO login_links VALUES(?,?,?,?,?,?,?,?)',await digest(token),email,await digest(flow),source||null,now+900000,now,'email:'+await digest(email),'ip:'+await digest(ip))
  ]);}catch(error){if(error.message.includes('login_rate_limited'))throw new CreditError('Too many sign-in requests. Please try again later.',429);throw error;}
  return {token,flow,email};
 }
 async cancel(token){await this.query('DELETE FROM login_links WHERE token_hash=?',await digest(token)).run();}
 async confirm(token,flow,now=Date.now()){
  if(typeof token!=='string'||token.length>100||typeof flow!=='string'||!flow||flow.length>100)throw new CreditError('Invalid sign-in link.',400);
  const session=random();
  try{await this.query('INSERT INTO login_confirmations VALUES(?,?,?,?,?)',await digest(token),await digest(flow),crypto.randomUUID(),await digest(session),now).run();}
  catch(error){
   if(error.message.includes('login_invalid'))throw new CreditError('This link expired, was already used, or belongs to another browser.',400);
   if(error.message.includes('login_account_conflict'))throw new CreditError('This browser has separate credit or a pending purchase. Use a separate browser profile to sign in.',409);
   throw error;
  }
  return session;
 }
}
