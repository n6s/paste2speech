import {digest} from '../prepared/ledger.js';
import {production} from './modes.js';

// Check the live verified session itself: legacy and anonymous cookies never confer owner access.
export async function ownerAccess(db, token, email, now=Date.now()) {
 if(!email || !token || token.length>100)return false;
 return !!await db.prepare(`SELECT s.account FROM sessions s JOIN identities i ON i.account=s.account
 JOIN accounts a ON a.id=s.account WHERE s.token_hash=? AND s.expires>? AND s.kind='verified'
 AND i.email=? AND a.enabled=1`).bind(await digest(token),now,email).first();
}
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
  all(`SELECT CASE WHEN email=? THEN 'owner' ELSE 'customers' END AS audience,COUNT(*) AS accounts
   FROM identities GROUP BY audience`,email),
  all(`SELECT CASE WHEN i.email=? THEN 'owner' ELSE 'customers' END AS audience,
   COUNT(DISTINCT r.account) AS activeAccounts,COUNT(*) AS readings,COALESCE(SUM(r.consumed),0) AS characters,
   SUM(r.state='closed' AND r.outcome='failed') AS failures,SUM(r.state='open') AS preparing
   FROM reservations r LEFT JOIN identities i ON i.account=r.account
   WHERE r.created>=? AND r.created<=? AND EXISTS(SELECT 1 FROM public_jobs p WHERE p.job=r.job)
   GROUP BY audience`,email,w.start,w.end),
  all(`SELECT CASE WHEN i.email=? THEN 'owner' ELSE 'customers' END AS audience,
   SUM(o.status='credited') AS purchases,SUM(o.status='credited' AND COALESCE(s.revoked,0)>0) AS reversedPurchases
   FROM orders o LEFT JOIN identities i ON i.account=o.account LEFT JOIN payment_sync s ON s.order_id=o.id
   WHERE o.created>=? AND o.created<=? AND o.environment=? GROUP BY audience`,
   email,new Date(w.start).toISOString(),new Date(w.end).toISOString(),production(env)?'live':'sandbox'),
  (production(env)?env.DB:db).prepare(`SELECT day,event,engine,SUM(count) AS count FROM daily_events
   WHERE day>=? AND day<=? AND event IN ('page_view','playback_start') GROUP BY day,event,engine ORDER BY day`)
   .bind(w.day,w.today).all(),
  db.prepare(`SELECT (SELECT COUNT(*) FROM webhook_events WHERE processed IS NULL AND received<?) AS delayedWebhooks,
   (SELECT COUNT(*) FROM payment_sync WHERE state='error') AS paymentErrors,
   (SELECT COUNT(*) FROM reservations WHERE state='open' AND created<?) AS stuckReadings`)
   .bind(now-300000,now-900000).first()
 ]);
 const groups={customers:{accounts:0,activeAccounts:0,readings:0,characters:0,failures:0,preparing:0,purchases:0,reversedPurchases:0},owner:{accounts:0,activeAccounts:0,readings:0,characters:0,failures:0,preparing:0,purchases:0,reversedPurchases:0}};
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
 if(path==='/api/owner/app.js')return response(`(${dashboardClient.toString()})();`,200,'text/javascript');
 if(path!=='/api/owner')return response('Not found',404,'text/plain');
 return response(page);
}
function dashboardClient(){
 const $=id=>document.getElementById(id),number=n=>Number(n||0).toLocaleString();
 async function refresh(){
  $('refresh').disabled=true;$('status').textContent='Loading…';$('results').hidden=true;
  try{
   const response=await fetch('/api/owner/report?period='+$('period').value,{cache:'no-store'});
   if(!response.ok)throw Error(response.status===403?'Your owner session has expired. Sign in again through Account.':'The report could not be loaded. Try Refresh.');
   const data=await response.json();$('environment').textContent=data.environment+' · private dashboard';
   $('status').textContent='Updated '+new Date(data.generatedAt).toLocaleString()+'. Reporting days use UTC.';
   const totals={page_view:0,playback_start:0};for(const row of data.events)totals[row.event]+=row.count;
   $('views').textContent=number(totals.page_view);$('plays').textContent=number(totals.playback_start);
   for(const audience of ['customers','owner'])for(const [key,value] of Object.entries(data.groups[audience])){
    const cell=document.querySelector(`[data-audience="${audience}"][data-metric="${key}"]`);if(cell)cell.textContent=number(value);
   }
   const body=$('days');body.replaceChildren();const days=new Map();
   for(const row of data.events){if(!days.has(row.day))days.set(row.day,{views:0,browser:0,google:0,kokoro:0});const day=days.get(row.day);if(row.event==='page_view')day.views+=row.count;else if(row.engine in day)day[row.engine]+=row.count;}
   for(const [day,values] of [...days].reverse()){
    const tr=document.createElement('tr');for(const value of [day,...Object.values(values)]){const td=document.createElement('td');td.textContent=typeof value==='number'?number(value):value;tr.append(td);}body.append(tr);
   }
   $('empty').hidden=days.size>0;
   $('health').textContent=`${number(data.health.stuckReadings)} preparations open over 15 minutes · ${number(data.health.delayedWebhooks)} payment notifications waiting over 5 minutes · ${number(data.health.paymentErrors)} payment sync errors`;
   $('results').hidden=false;
  }catch(error){$('status').textContent=error.message;}finally{$('refresh').disabled=false;}
 }
 $('refresh').addEventListener('click',refresh);$('period').addEventListener('change',refresh);refresh();
}
const metrics=[['accounts','Verified accounts · current total'],['activeAccounts','Accounts preparing WaveNet'],['readings','WaveNet preparations started'],['characters','Characters generated'],['failures','Failed preparations'],['preparing','Still preparing'],['purchases','Completed purchases'],['reversedPurchases','Purchases with reversed credit']];
const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PasteToSpeech · Private dashboard</title><style>
:root{font-family:system-ui,sans-serif;color:#20352e;background:#f3f6f2;color-scheme:light}body{max-width:940px;margin:auto;padding:28px 20px 60px}h1{font-size:2rem;margin:8px 0}h2{font-size:1.2rem}a{color:#246549}.eyebrow{color:#52665b}header nav{float:right}section{background:white;border:1px solid #d8e3d9;border-radius:14px;padding:22px;margin-top:20px}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:22px 0}select,button{font:inherit;padding:10px 14px;border:1px solid #8b9f90;border-radius:8px;background:white;color:inherit}button{cursor:pointer;background:#225e46;color:white}button:disabled{opacity:.6}.totals{display:flex;gap:48px;flex-wrap:wrap}.totals strong{display:block;font-size:2rem}p{line-height:1.55}.note{font-size:.9rem;color:#52665b}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:12px 10px;border-bottom:1px solid #e4ebe4}td:not(:first-child),th:not(:first-child){text-align:right}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #daaa25;outline-offset:3px}[hidden]{display:none!important}@media(max-width:500px){body{padding:20px 12px}section{padding:16px}th,td{padding:10px 6px;font-size:.9rem}}
</style></head><body><header><nav><a href="/">Reader</a> · <a href="/api/billing">Account</a></nav><div class="eyebrow" id="environment">PasteToSpeech · private dashboard</div><h1>Is anyone using it?</h1><p>Visits, listening activity, and customer purchases in one place.</p></header>
<div class="toolbar"><label for="period">Show</label><select id="period"><option value="today">Today</option><option value="week" selected>Last 7 days</option><option value="launch">Since launch day</option></select><button id="refresh">Refresh</button></div><p id="status" role="status" aria-live="polite">Loading…</p><main id="results" hidden>
<section><h2>Reader activity</h2><div class="totals"><div><strong id="views">—</strong>Page views</div><div><strong id="plays">—</strong>Playback starts</div></div><p class="note">Anonymous counts include your own visits and repeat activity. They are not unique people. Privacy opt-outs and blocked requests are absent. Statistics are retained for 90 days; older domains and private-reader visits may share these totals.</p></section>
<section><h2>Customers and your own activity</h2><div class="table-wrap"><table><thead><tr><th scope="col">Measure</th><th scope="col">Customers</th><th scope="col">You</th></tr></thead><tbody>${metrics.map(([key,label])=>`<tr><th scope="row">${label}</th><td data-audience="customers" data-metric="${key}">—</td><td data-audience="owner" data-metric="${key}">—</td></tr>`).join('')}</tbody></table></div><p class="note">Your verified owner account is separated; activity under other accounts remains in Customers. Verified accounts are current totals because signup dates were not recorded. WaveNet counts cover public-reader preparations, including separate parts of long readings, grouped by their start date. Characters and outcomes reflect their latest state.</p><p class="note">Purchases are grouped by order creation date and show current status. Reversed credit includes refunds or other payment reversals; completed purchases still include those orders. These are purchase counts, not net revenue. Use Paddle for financial totals.</p></section>
<section><h2>Daily reader activity</h2><div class="table-wrap"><table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Views</th><th scope="col">Browser starts</th><th scope="col">WaveNet starts</th><th scope="col">Kokoro starts</th></tr></thead><tbody id="days"></tbody></table></div><p id="empty" hidden>No recorded reader activity in this period.</p></section>
<section><h2>Needs attention · current</h2><p id="health"></p><p class="note">These checks include your account and all historical records, regardless of the selected period. A long preparation can legitimately remain open beyond 15 minutes.</p></section><p class="note">Today and Last 7 days use UTC calendar days, including today. Since launch day begins September 28, 2026 at 00:00 UTC and includes launch-day testing. Refresh loads a new read-only snapshot; this page does not poll automatically.</p></main><script src="/api/owner/app.js" defer></script></body></html>`;
