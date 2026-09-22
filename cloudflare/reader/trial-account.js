const $=id=>document.getElementById(id);
async function api(path,data){const response=await fetch('/api/billing/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(result.detail||'Account request failed.');return result;}
async function refresh(){
 const s=await api('status');$('identity').textContent=s.email?`Signed in as ${s.email}`:'Sign in to recover your account.';$('signin-form').hidden=!!s.email;$('logout').hidden=!s.email;$('send-link').disabled=!s.emailConfigured;
 $('email-help').textContent=s.emailConfigured?'Open the link in this browser. On another device, request a fresh link to recover your account.':'Email sign-in is not available yet. Browser voices remain free.';
 $('balance').textContent=s.account?`${s.account.balance.toLocaleString()} characters available${s.account.reserved?` · ${s.account.reserved.toLocaleString()} reserved`:''}`:'No trial credit';$('month').textContent=s.month+' · UTC';$('usage').replaceChildren();
 for(const row of s.usage){const p=document.createElement('p');p.textContent=`${(row.seconds/60).toFixed(1)} minutes generated · estimated provider cost $${row.providerCost.toFixed(5)}${row.incompleteCosts?' (incomplete)':''}`;$('usage').append(p);}if(!s.usage.length)$('usage').textContent='No generation recorded this month.';
}
async function action(fn){try{$('message').textContent='';await fn();}catch(e){$('message').textContent=e.message;}}
$('signin-form').onsubmit=e=>{e.preventDefault();action(async()=>{$('send-link').disabled=true;try{await api('login/request',{email:$('email').value.trim()});$('auth-message').textContent='Check your email for a sign-in link. Keep this browser open.';}finally{$('send-link').disabled=false;}});};
$('logout').onclick=()=>action(async()=>{await api('logout',{});await refresh();});$('refresh').onclick=()=>action(refresh);action(refresh);
