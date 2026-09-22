// Compatibility with server/billing.py and server/payment_sync.py. Provider
// responses are evidence only; the ledger is the sole authority for credit.
export const PACK_CHARACTERS=1000000;
export const PRICE='pri_01m32vvy2sptegx6arebyvxh37';
export const LEGACY_PRICE='pri_01m32geyt53f5h9nxqfhqbt19x';
export const PRODUCT='pro_01m32gd3hj94whqywcvmyta74b';
export const orderPrice=order=>order.characters===3000000?LEGACY_PRICE:PRICE;
export function validPurchase(data,order){
 try{const item=data.items[0],price=item.price;
 return data.id===order.transaction_id&&data.status==='completed'&&data.custom_data?.p2s_order===order.id&&
 data.currency_code==='USD'&&data.subscription_id==null&&data.items.length===1&&item.quantity===1&&
 price.id===orderPrice(order)&&price.product_id===PRODUCT&&price.billing_cycle==null&&
 price.unit_price.amount==='1000'&&price.unit_price.currency_code==='USD'&&Object.keys(price.unit_price).length===2&&
 data.discount_id==null&&data.details.totals.discount==='0';
 }catch{return false;}
}
function money(value){if(typeof value!=='string'||!/^\d{1,12}$/.test(value))throw Error('Invalid money amount');return BigInt(value);}
export function revokedCharacters(transaction,adjustments,characters=PACK_CHARACTERS){
 if(!Number.isSafeInteger(characters)||characters<=0||characters>3000000)throw Error('Invalid allowance');
 const principal=money(transaction.details.totals.subtotal);if(principal<=0n)throw Error('Invalid principal');
 const seen=new Set();let refunded=0n;
 for(const row of adjustments){
  if(!/^adj_[a-z0-9]{26}$/.test(row.id)||seen.has(row.id))throw Error('Invalid adjustment');seen.add(row.id);
  if(row.transaction_id!==transaction.id||row.currency_code!=='USD')throw Error('Adjustment mismatch');
  if(['pending_approval','rejected','reversed'].includes(row.status))continue;
  if(row.status!=='approved')throw Error('Unknown adjustment status');
  if(['chargeback_reverse','credit_reverse','chargeback_warning','chargeback_warning_reverse'].includes(row.action))continue;
  if(!['refund','credit','chargeback'].includes(row.action))throw Error('Unknown adjustment action');
  refunded+=money(row.totals.subtotal);
 }
 const result=(refunded*BigInt(characters)+principal-1n)/principal;
 return Number(result>BigInt(characters)?BigInt(characters):result);
}
export async function syncOrder(ledger,order,provider){
 const txn=order.transaction_id;if(!/^txn_[a-z0-9]{26}$/.test(txn))throw Error('Invalid transaction');
 const remote=await provider.transaction(txn),state=remote.status;
 if(remote.id!==txn||!['draft','ready','billed','paid','completed','canceled','past_due'].includes(state))throw Error('Invalid payment state');
 let revoked=0;
 if(state==='completed'){
  if(!validPurchase(remote,order))throw Error('Purchase mismatch');
  revoked=revokedCharacters(remote,await provider.adjustments(txn),order.characters);
 }
 const added=await ledger.syncPayment(order.id,txn,state,revoked);
 return {credited:state==='completed',newCredit:added,status:state,revokedCharacters:revoked};
}
