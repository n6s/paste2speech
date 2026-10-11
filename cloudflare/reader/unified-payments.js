import {unifiedEnabled,unifiedCustomerAllowed,PACK_UNITS} from './unified-wallet.js';
import {paymentConfig} from './modes.js';
import {paddleProvider} from './providers.js';
import {validPurchase,revokedCharacters} from '../prepared/payments.js';
export function unifiedPaymentConfig(env){
 if(!unifiedEnabled(env))throw Error('Unified wallet disabled');
 const config=paymentConfig({...env,PADDLE_PRICE_ID:env.PADDLE_UNIFIED_PRICE_ID,PADDLE_PRODUCT_ID:env.PADDLE_UNIFIED_PRODUCT_ID});
 if([env.PADDLE_PRICE_ID,env.PADDLE_OCR_PRICE_ID].includes(config.price)||[env.PADDLE_PRODUCT_ID,env.PADDLE_OCR_PRODUCT_ID].includes(config.product))throw Error('Unified catalog must be separate');
 const {characters,...rest}=config;return {...rest,units:PACK_UNITS,walletVersion:'unified-v1'};
}
export function unifiedCheckoutStatus(env,account,capacity,pendingOrder){
 let reason=null;
 try{unifiedPaymentConfig(env);}catch{reason='catalog';}
 if(!reason&&(env.ENABLE_UNIFIED_PAYMENTS!=='1'||env.ENABLE_PAYMENTS!=='1'))reason='paused';
 if(!reason&&!unifiedCustomerAllowed(env,account))reason='account';
 if(!reason&&!capacity?.available&&!pendingOrder)reason='capacity';
 return {configured:!reason,checkoutAvailable:!reason,checkoutUnavailableReason:reason};
}
export function unifiedProvider(env,fetcher=fetch){const config=unifiedPaymentConfig(env),provider=paddleProvider({...env,PADDLE_PRICE_ID:config.price,PADDLE_PRODUCT_ID:config.product},fetcher);return {...provider,config};}
export async function syncUnifiedOrder(ledger,order,provider){
 const c=provider.config;
 if(!c||!['sandbox','live'].includes(c.environment)||order.environment!==c.environment||order.price_id!==c.price||order.product_id!==c.product||order.amount!=='1000'||order.currency!=='USD'||order.units!==PACK_UNITS||order.wallet_version!=='unified-v1'||!/^txn_[a-z0-9]{26}$/.test(order.transaction_id))throw Error('Credit purchase configuration mismatch');
 const remote=await provider.transaction(order.transaction_id),state=remote.status;
 if(remote.id!==order.transaction_id||!['draft','ready','billed','paid','completed','canceled','past_due'].includes(state))throw Error('Invalid credit transaction');
 let revoked=0;if(state==='completed'){
  if(!validPurchase(remote,order)||remote.details.totals.subtotal!=='1000')throw Error('Credit purchase mismatch');
  revoked=revokedCharacters(remote,await provider.adjustments(remote.id),PACK_UNITS);
 }
 const added=await ledger.syncPayment(order.id,remote.id,state,revoked);return {credited:state==='completed',newCredit:added,status:state,revokedUnits:revoked,offer:'credits'};
}
