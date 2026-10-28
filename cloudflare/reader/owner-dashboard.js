import dashboardScript from './owner-dashboard-client.txt';
import {production} from './modes.js';

import {ownerAccess} from './owner-access.js';
export {ownerAccess} from './owner-access.js';
export function reportWindow(period, now=Date.now()) {
 const today=new Date(now).toISOString().slice(0,10);
 const start=period==='today'?Date.parse(today):period==='week'?Date.parse(today)-6*86400000:
 period==='launch'?Date.parse('2026-09-28T00:00:00Z'):NaN;
 if(!Number.isFinite(start))throw new Error('Unknown reporting period');
 return {start,end:now,day:new Date(start).toISOString().slice(0,10),today};
}
export async function ownerReport(env, period='week', now=Date.now()) {
 const w=reportWindow(period,now), db=env.LEDGER, email=env.OWNER_EMAIL;
 const all=(sql,...args)=>db.prepare(sql).bind(...args).all();
 // Each source is aggregated once. No per-customer queries, writes, text, or payment details.
 const [identities,readings,orders,events,health]=await Promise.all([
  all(`SELECT CASE WHEN lower(i.email)=lower(?) THEN 'owner' WHEN i.email IS NOT NULL THEN 'customers' ELSE 'unverified' END AS audience,COUNT(*) AS accounts
   FROM accounts a LEFT JOIN identities i ON i.account=a.id GROUP BY audience`,email),
  all(`SELECT CASE WHEN lower(i.email)=lower(?) THEN 'owner' WHEN i.email IS NOT NULL THEN 'customers' ELSE 'unverified' END AS audience,
   COUNT(DISTINCT r.account) AS activeAccounts,COUNT(*) AS readings,COALESCE(SUM(r.consumed),0) AS characters,
   SUM(r.state='closed' AND r.outcome='failed') AS failures,SUM(r.state='open') AS preparing
   FROM reservations r LEFT JOIN identities i ON i.account=r.account
   WHERE r.created>=? AND r.created<=? AND EXISTS(SELECT 1 FROM public_jobs p WHERE p.job=r.job)
   GROUP BY audience`,email,w.start,w.end),
  all(`WITH purchase_rows AS (
   SELECT 'speech:'||o.id AS fallback,o.transaction_id,o.account,o.created,o.environment,COALESCE(s.revoked,0)>0 AS reversed
    FROM orders o LEFT JOIN payment_sync s ON s.order_id=o.id WHERE o.status='credited'
   UNION ALL
   SELECT 'credits:'||o.id,o.transaction_id,o.account,o.created,o.environment,COALESCE(s.revoked,0)>0
    FROM unified_orders o LEFT JOIN unified_payment_sync s ON s.order_id=o.id WHERE o.status='credited'
   UNION ALL
   SELECT 'ocr:'||o.id,o.transaction_id,o.account,o.created,o.environment,COALESCE(s.revoked,0)>0
    FROM ocr_orders o LEFT JOIN ocr_payment_sync s ON s.order_id=o.id WHERE o.status='credited'
  ), purchases AS (
   SELECT MIN(account) AS account,COUNT(DISTINCT account) AS accountCount,MIN(created) AS created,MAX(reversed) AS reversed
   FROM purchase_rows WHERE environment=?
   GROUP BY CASE WHEN NULLIF(transaction_id,'') IS NOT NULL THEN 'transaction:'||transaction_id ELSE fallback END
  )
  SELECT CASE WHEN p.accountCount<>1 THEN 'unverified' WHEN lower(i.email)=lower(?) THEN 'owner'
   WHEN i.email IS NOT NULL THEN 'customers' ELSE 'unverified' END AS audience,
   COUNT(*) AS purchases,SUM(p.reversed) AS reversedPurchases
   FROM purchases p LEFT JOIN identities i ON i.account=p.account
   WHERE p.created>=? AND p.created<=? GROUP BY audience`,
   production(env)?'live':'sandbox',email,new Date(w.start).toISOString(),new Date(w.end).toISOString()),
  (production(env)?env.DB:db).prepare(`SELECT day,event,engine,SUM(count) AS count FROM daily_events
   WHERE day>=? AND day<=? AND event IN ('page_view','playback_start') GROUP BY day,event,engine ORDER BY day`)
   .bind(w.day,w.today).all(),
  db.prepare(`SELECT (SELECT COUNT(*) FROM (SELECT received,processed FROM webhook_events UNION ALL SELECT received,processed FROM unified_webhook_events UNION ALL SELECT received,processed FROM ocr_webhook_events) WHERE processed IS NULL AND received<?) AS delayedWebhooks,
   (SELECT COUNT(*) FROM (SELECT state FROM payment_sync UNION ALL SELECT state FROM unified_payment_sync UNION ALL SELECT state FROM ocr_payment_sync) WHERE state='error') AS paymentErrors,
   (SELECT COUNT(*) FROM reservations WHERE state='open' AND created<?) AS stuckReadings`)
   .bind(now-300000,now-900000).first()
 ]);
 const groups=Object.fromEntries(['customers','owner','unverified'].map(audience=>[audience,{accounts:0,activeAccounts:0,readings:0,characters:0,failures:0,preparing:0,purchases:0,reversedPurchases:0}]));
 for(const result of [identities,readings,orders])for(const {audience,...values} of result.results)Object.assign(groups[audience],values);
 return {generatedAt:new Date(now).toISOString(),environment:production(env)?'Production':'Staging',period,start:new Date(w.start).toISOString(),groups,events:events.results,health};
}
const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
export async function ownerResponse(request,env,token) {
 const url=new URL(request.url), path=url.pathname;
 const response=(body,status=200,type='text/html; charset=utf-8')=>new Response(request.method==='HEAD'?null:body,{status,headers:{...headers,'Content-Type':type}});
 if(!await ownerAccess(env.LEDGER,token,env.OWNER_EMAIL))return response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Private dashboard</title><h1>Private dashboard</h1><p>Sign in with the owner account, then return here.</p><a href="/api/billing">Open account sign-in</a></html>',403);
 if(!['GET','HEAD'].includes(request.method))return response('Method not allowed',405,'text/plain');
 if(path==='/api/owner/report'){
  const period=url.searchParams.get('period')||'week';
  if(!['today','week','launch'].includes(period))return response('{}',400,'application/json');
  return response(JSON.stringify(await ownerReport(env,period)),200,'application/json');
 }
 if(path==='/api/owner/app.js')return response(dashboardScript,200,'text/javascript');
 if(path!=='/api/owner')return response('Not found',404,'text/plain');
 return response(page);
}

const metrics=[['accounts','Accounts · current total'],['activeAccounts','Accounts with WaveNet preparations'],['readings','WaveNet preparations started'],['characters','WaveNet characters generated'],['failures','Failed preparations'],['preparing','Still preparing'],['purchases','Credited purchases · all credit systems'],['reversedPurchases','Purchases with reversed credit']];
const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PasteToSpeech · Private dashboard</title><style>
:root{font-family:system-ui,sans-serif;color:#20352e;background:#f3f6f2;color-scheme:light}body{max-width:940px;margin:auto;padding:28px 20px 60px}h1{font-size:2rem;margin:8px 0}h2{font-size:1.2rem}a{color:#246549}.eyebrow{color:#52665b}header nav{float:right}section{background:white;border:1px solid #d8e3d9;border-radius:14px;padding:22px;margin-top:20px}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:22px 0}select,button{font:inherit;padding:10px 14px;border:1px solid #8b9f90;border-radius:8px;background:white;color:inherit}button{cursor:pointer;background:#225e46;color:white}button:disabled{opacity:.6}.totals{display:flex;gap:48px;flex-wrap:wrap}.totals strong{display:block;font-size:2rem}p{line-height:1.55}.note{font-size:.9rem;color:#52665b}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:12px 10px;border-bottom:1px solid #e4ebe4}td:not(:first-child),th:not(:first-child){text-align:right}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #daaa25;outline-offset:3px}[hidden]{display:none!important}@media(max-width:500px){body{padding:20px 12px}section{padding:16px}th,td{padding:10px 6px;font-size:.9rem}}
</style></head><body><header><nav><a href="/">Reader</a> · <a href="/api/billing">Account</a></nav><div class="eyebrow" id="environment">PasteToSpeech · private dashboard</div><h1>Is anyone using it?</h1><p>Anonymous activity, verified accounts, and purchases in one place.</p></header>
<div class="toolbar"><label for="period">Show</label><select id="period"><option value="today">Today</option><option value="week" selected>Last 7 days</option><option value="launch">Since launch day</option></select><button id="refresh">Refresh</button></div><p id="status" role="status" aria-live="polite">Loading…</p><main id="results" hidden>
<section><h2>Anonymous reader activity</h2><div class="totals"><div><strong id="views">—</strong>Recorded page views</div><div><strong id="plays">—</strong>Recorded playback starts</div></div><p class="note">Anonymous counts include your own visits and repeat activity. They are not unique people. Privacy opt-outs and blocked requests are absent. Statistics are retained for 90 days. Hostnames were not recorded, so these totals cannot reliably separate production, older domains, and private readers. They cannot establish how many other people listened for free.</p></section>
<section><h2>Verified customers and account activity</h2><div class="table-wrap"><table><thead><tr><th scope="col">Measure</th><th scope="col">Verified customers</th><th scope="col">You</th><th scope="col">Unverified accounts</th></tr></thead><tbody>${metrics.map(([key,label])=>`<tr><th scope="row">${label}</th><td data-audience="customers" data-metric="${key}">—</td><td data-audience="owner" data-metric="${key}">—</td><td data-audience="unverified" data-metric="${key}">—</td></tr>`).join('')}</tbody></table></div><p class="note">Verified customers means verified identities other than your owner identity, not visitors or necessarily paying customers. Accounts without a verified identity are shown separately; they are not counted as customers. Account counts are current totals because signup dates were not recorded. WaveNet counts cover public-reader preparations, including separate parts of long readings, grouped by their start date. Characters and outcomes reflect their latest state.</p><p class="note">Purchases include speech, unified credits, and legacy OCR packs, grouped by order creation date and current credited status. Matching payment transaction IDs count once across systems; records without a transaction ID count separately. Purchases with any credit currently reversed are a subset, including partial refunds or other reversals, not additional purchases. Owner purchases are separated; conflicting ownership is unverified. Grants are excluded. These counts are not net revenue; use Paddle for financial totals.</p></section>
<section><h2>Daily reader activity</h2><div class="table-wrap"><table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Views</th><th scope="col">Browser starts</th><th scope="col">WaveNet starts</th><th scope="col">Kokoro starts</th></tr></thead><tbody id="days"></tbody></table></div><p id="empty" hidden>No recorded reader activity in this period.</p></section>
<section><h2>Needs attention · current</h2><p id="health"></p><p class="note">Payment checks cover speech, unified credits, and OCR. These checks include your account and all historical records, regardless of the selected period. A long preparation can legitimately remain open beyond 15 minutes.</p></section><p class="note">Today and Last 7 days use UTC calendar days, including today. Since launch day begins September 28, 2026 at 00:00 UTC and includes launch-day testing. Refresh loads a new read-only snapshot; this page does not poll automatically.</p></main><script src="/api/owner/app.js" defer></script></body></html>`;
