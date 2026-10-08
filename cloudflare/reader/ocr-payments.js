import {paymentConfig} from './modes.js';
import {paddleProvider} from './providers.js';
import {validPurchase,revokedCharacters} from '../prepared/payments.js';
export const OCR_PACK_PAGES=500;
// Deliberately sandbox-only until live policies and launch are approved.
export function ocrPaymentConfig(env){
 if(env.READER_MODE!=='staging'||env.OCR_RETAIL_SANDBOX!=='1'||env.PADDLE_ENVIRONMENT!=='sandbox')throw Error('OCR retail sandbox is disabled');
 const config=paymentConfig({...env,LOCAL_READER:'0',PADDLE_PRICE_ID:env.PADDLE_OCR_PRICE_ID,PADDLE_PRODUCT_ID:env.PADDLE_OCR_PRODUCT_ID});
 if(config.price===env.PADDLE_PRICE_ID||config.product===env.PADDLE_PRODUCT_ID)throw Error('OCR catalog must be separate');
 const {characters,...rest}=config;return {...rest,pages:OCR_PACK_PAGES};
}
export function ocrProvider(env,fetcher=fetch){const config=ocrPaymentConfig(env),provider=paddleProvider({...env,LOCAL_READER:'0',PADDLE_PRICE_ID:config.price,PADDLE_PRODUCT_ID:config.product},fetcher);return {...provider,config};}
export async function syncOcrOrder(ledger,order,provider){
 const c=provider.config;
 if(!c||c.environment!=='sandbox'||order.environment!==c.environment||order.price_id!==c.price||order.product_id!==c.product||order.amount!=='1000'||order.currency!=='USD'||order.pages!==500||!/^txn_[a-z0-9]{26}$/.test(order.transaction_id))throw Error('OCR purchase configuration mismatch');
 const remote=await provider.transaction(order.transaction_id),state=remote.status;
 if(remote.id!==order.transaction_id||!['draft','ready','billed','paid','completed','canceled','past_due'].includes(state))throw Error('Invalid OCR transaction');
 let revoked=0;if(state==='completed'){if(!validPurchase(remote,order))throw Error('OCR purchase mismatch');revoked=revokedCharacters(remote,await provider.adjustments(remote.id),500);}
 const added=await ledger.syncPayment(order.id,remote.id,state,revoked);return {credited:state==='completed',newCredit:added,status:state,revokedPages:revoked,offer:'ocr'};
}
