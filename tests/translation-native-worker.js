import {translateWithGoogle} from '../cloudflare/reader/translation.js';
export default{async fetch(){
 let unsupported;try{new Request('https://synthetic.invalid/not-called',{redirect:'error'});}catch(error){unsupported=error.message;}
 let networkCalls=0;globalThis.fetch=()=>{networkCalls++;throw Error('External requests forbidden in this fixture');};
 const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const bytes=new Uint8Array(await crypto.subtle.exportKey('pkcs8',key.privateKey));const pem='-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...bytes))+'\n-----END PRIVATE KEY-----';
 const credential=JSON.stringify({type:'service_account',project_id:'paste-to-speech',client_email:'p2s-translation-staging@paste-to-speech.iam.gserviceaccount.com',private_key:pem});const requests=[];
 const result=await translateWithGoogle('Native runtime compatibility test.','eo',credential,{fetcher:async(url,options)=>{const request=new Request(url,options);requests.push({url,redirect:request.redirect});return Response.json(url.includes('oauth2')?{access_token:'synthetic-local-token',token_type:'Bearer',expires_in:3600}:{translations:[{translatedText:'Synthetic local native result.',detectedLanguageCode:'en'}]});}});
 return Response.json({unsupported,result,requests,networkCalls});
}};
