const status=document.querySelector('#status');
async function send(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.detail||'Request failed');return result;}
async function refresh(){const r=await fetch('/api/account');const a=await r.json();document.querySelector('#balance').textContent=r.ok?`${a.balance.toLocaleString()} characters available; ${a.reserved.toLocaleString()} reserved.`:'Signed out.';}
document.querySelector('#seed').onclick=async()=>{await send('/api/test-login',{account:'test-reader-a'});await refresh();};
document.querySelector('#logout').onclick=async()=>{await send('/api/logout',{});await refresh();};
document.querySelector('#login').onsubmit=async event=>{event.preventDefault();const mail=document.querySelector('#mail');mail.hidden=true;try{await send('/api/billing/login/request',{email:document.querySelector('#email').value});const r=await fetch('/api/test-mail');const m=await r.json();if(!r.ok)throw Error('Simulated email unavailable');mail.href=m.url;mail.hidden=false;status.textContent='The simulated email is ready. Open its link in this browser.';}catch(error){status.textContent=error.message;}};
refresh();
