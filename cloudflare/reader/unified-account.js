import {balanceCapacity,CAPACITY_ASSUMPTION} from '/balance-capacity.js';
const $=id=>document.getElementById(id),key='p2s.unified.order';let initialized=false,busy=false,timer,tries=0;
const fmt=u=>(u/1000).toLocaleString(undefined,{maximumFractionDigits:3});
$('capacity-assumption').textContent=CAPACITY_ASSUMPTION;$('pack-capacity').textContent=balanceCapacity(1000000)+'. Use it for listening, scanning, or a mix of both.';
function focusSection(){const target=document.getElementById(location.hash.slice(1));if(target?.matches('section[tabindex]')){target.focus();target.scrollIntoView({block:'start'});}}
window.addEventListener('hashchange',focusSection);focusSection();
async function api(path,data){const response=await fetch('/api/billing/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.detail||'Account request failed');return value;}
async function refresh(){
 const s=await api('status');if(!s.unified)throw Error('Shared credits are unavailable. Refresh this page.');
 $('identity').textContent=s.email?`Signed in as ${s.email}`:'Sign in to recover your balance on this device.';$('signin-form').hidden=!!s.email;$('logout').hidden=!s.email;$('send-link').disabled=!s.emailConfigured;
 $('capacity').textContent=s.wallet?balanceCapacity(s.wallet.balance):'Sign in to view your balance.';
 $('balance').textContent=s.wallet?`${fmt(s.wallet.balance)} credits available · ${fmt(s.wallet.held)} held`:'Sign in to view your exact balance.';
 $('payment-status').textContent=s.wallet?.debt?`${fmt(s.wallet.debt)} credits from a refund must be covered before new paid work.`:s.paymentStatus?.needsAttention?'Payment verification is delayed. Do not pay again.':s.configured?'Purchases and approved refunds update automatically.':({capacity:'New purchases are temporarily paused while processing capacity is full. Your existing credits remain available.',paused:'New purchases are temporarily paused. Your existing credits remain available.',account:s.sandbox?'Sign in with the verified staging owner account to purchase credits.':'Sign in with an eligible verified email to purchase credits.'}[s.checkoutUnavailableReason]||(s.sandbox?'Sandbox checkout is awaiting catalog setup. Staging test credits are available.':'Checkout is temporarily unavailable. Your existing balance is retained.'));
 $('buy').disabled=busy||!s.configured||!window.Paddle;
 if(s.pendingOrder)sessionStorage.setItem(key,s.pendingOrder);else sessionStorage.removeItem(key);
 $('month').textContent=s.month+' · UTC';$('usage').replaceChildren();for(const row of s.usage){const p=document.createElement('p');p.textContent=`${(row.seconds/60).toFixed(1)} minutes of WaveNet audio generated`; $('usage').append(p);}if(!s.usage.length)$('usage').textContent='No generation recorded this month.';
 if(s.configured&&window.Paddle&&!initialized){if(s.sandbox)Paddle.Environment.set('sandbox');Paddle.Initialize({token:s.clientToken,eventCallback:event=>{if(event.name==='checkout.completed'){tries=0;clearTimeout(timer);void confirm();}}});initialized=true;}return s;
}
async function reconcile(){const order=sessionStorage.getItem(key);if(!order)return true;const r=await api('reconcile',{offer:'credits',order});$('message').textContent=r.credited?'Purchase verified. Shared credits and approved refunds are reflected in your balance.':'Payment confirmation is pending. Do not pay again.';return r.credited;}
async function confirm(){try{const done=await reconcile();await refresh();if(!done&&++tries<15)timer=setTimeout(confirm,2000);}catch(e){$('message').textContent=e.message;}}
async function action(fn){if(busy)return;busy=true;$('buy').disabled=true;try{await fn();}catch(e){$('message').textContent=e.message;}finally{busy=false;await refresh().catch(e=>{$('message').textContent=e.message;});}}
$('buy').onclick=()=>action(async()=>{const o=await api('order',{offer:'credits'});sessionStorage.setItem(key,o.order);Paddle.Checkout.open({transactionId:o.transactionId,settings:{displayMode:'overlay',allowLogout:false,showAddDiscounts:false}});});
$('refresh').onclick=()=>action(async()=>{await reconcile();});
$('signin-form').onsubmit=event=>{event.preventDefault();void action(async()=>{await api('login/request',{email:$('email').value.trim()});$('auth-message').textContent='Check your email. Open the sign-in link in this browser within 15 minutes.';});};
$('logout').onclick=()=>action(async()=>{await api('logout',{});sessionStorage.removeItem(key);clearTimeout(timer);await api('session',{});});
await action(async()=>{await api('session',{});await refresh();await reconcile();});
