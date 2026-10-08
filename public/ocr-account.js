const key='p2s.ocr.order';let busy=false,timer=null;
function elements(){
 let root=document.getElementById('ocr-account');if(root)return root;
 root=document.createElement('section');root.id='ocr-account';root.hidden=true;
 const title=document.createElement('h2');title.textContent='OCR page pack · sandbox';
 const offer=document.createElement('p');offer.textContent='$10 USD · 500 OCR pages. One-time purchase; no subscription or automatic refill. Purchased pages have no scheduled expiry. Taxes are shown at checkout.';
 const policy=document.createElement('p');policy.className='hint';policy.textContent='Sandbox policies are draft: blank pages, processing again after saved content expires, and refund rounding/debt await live approval. Failed or incomplete extraction uses 0 credits. Local extraction and saved replay use 0 credits. Speech credit is separate.';
 const balance=document.createElement('p');balance.id='ocr-balance';const status=document.createElement('p');status.id='ocr-payment-status';status.setAttribute('role','status');
 const buy=document.createElement('button');buy.id='buy-ocr';buy.textContent='Buy 500 OCR pages';buy.disabled=true;root.append(title,offer,policy,balance,buy,status);document.getElementById('message').before(root);return root;
}
export async function refreshOcr(s,api){
 const root=elements();root.hidden=!s.ocr;if(!s.ocr)return;
 const o=s.ocr;if(o.pendingOrder)sessionStorage.setItem(key,o.pendingOrder);else sessionStorage.removeItem(key);
 document.getElementById('ocr-balance').textContent=o.balance?`${o.balance.balance.toLocaleString()} OCR pages available · ${o.balance.held} held${o.balance.debt?` · ${o.balance.debt} pages of draft refund debt`:''}`:'Sign in to view OCR pages.';
 const buy=document.getElementById('buy-ocr');buy.disabled=busy||!o.configured||!window.Paddle;
 buy.onclick=async()=>{if(busy)return;busy=true;buy.disabled=true;try{const order=await api('order',{offer:'ocr'});sessionStorage.setItem(key,order.order);window.Paddle.Checkout.open({transactionId:order.transactionId,settings:{displayMode:'overlay',allowLogout:false,showAddDiscounts:false}});}catch(e){document.getElementById('ocr-payment-status').textContent=e.message;}finally{busy=false;await refreshOcr(await api('status'),api);}};
}
export async function reconcileOcr(api){
 const order=sessionStorage.getItem(key);if(!order)return true;
 const r=await api('reconcile',{order,offer:'ocr'});document.getElementById('ocr-payment-status').textContent=r.credited?'OCR purchase verified. Pages and any approved refund adjustment are reflected in your separate OCR balance.':'OCR purchase is still awaiting verification. Do not pay again.';if(r.credited)sessionStorage.removeItem(key);return r.credited;
}
export function confirmOcrPurchase(api){
 clearTimeout(timer);let tries=0;const check=async()=>{try{const done=await reconcileOcr(api);await refreshOcr(await api('status'),api);if(!done&&++tries<15)timer=setTimeout(check,2000);}catch(e){document.getElementById('ocr-payment-status').textContent=e.message;}};void check();
}
