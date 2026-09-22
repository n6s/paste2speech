export const publicMode=env=>env.READER_MODE==='production-public';
export const trialMode=env=>env.READER_MODE==='production-trial';
export const production=env=>publicMode(env)||trialMode(env);
export const verifiedCustomer=account=>!!account?.email&&account.enabled===1&&!account.legacyPilot;
export const customerAllowed=(env,account)=>verifiedCustomer(account)&&(env.PUBLIC_LAUNCH_OPEN==='1'||!!env.LAUNCH_TEST_EMAIL&&account.email===env.LAUNCH_TEST_EMAIL);
export function paymentConfig(env){
 const live=publicMode(env),environment=live?'live':'sandbox';
 if(trialMode(env)||env.LOCAL_READER==='1'||env.PADDLE_ENVIRONMENT!==environment)throw Error('Payment environment is not configured');
 const prefix=live?'pdl_live_apikey_':'pdl_sdbx_apikey_';
 if(!env.PADDLE_API_KEY?.startsWith(prefix)||!env.PADDLE_CLIENT_TOKEN?.startsWith(live?'live_':'test_'))throw Error('Payment credentials do not match environment');
 const price=env.PADDLE_PRICE_ID,product=env.PADDLE_PRODUCT_ID;
 if(!/^pri_[a-z0-9]{26}$/.test(price||'')||!/^pro_[a-z0-9]{26}$/.test(product||''))throw Error('Payment catalog is not configured');
 return {environment,price,product,amount:'1000',currency:'USD',characters:1000000,base:live?'https://api.paddle.com':'https://sandbox-api.paddle.com'};
}
