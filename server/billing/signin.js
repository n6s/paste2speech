// The token stays out of request URLs, access logs, and third-party scripts.
const token=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
const base=location.pathname.replace(/\/signin\/?$/,'');
document.getElementById('back').href=base;
const button=document.getElementById('confirm');
const status=document.getElementById('status');
if(!token){button.disabled=true;status.textContent='Request a new sign-in link from speech usage.';}
button.onclick=async()=>{button.disabled=true;try{const response=await fetch(base+'/login/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const result=await response.json();if(!response.ok)throw Error(result.detail||'Sign-in failed.');location.replace(base);}catch(error){status.textContent=error.message;}};
