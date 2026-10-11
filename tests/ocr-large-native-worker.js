// Local workerd/R2/SQLite-DO proof only. Its synthetic dispatch flag is never
// imported by the live Worker and makes no provider or financial call.
import {proxyOcrSourceUpload} from '../cloudflare/reader/ocr-upload-proxy.js';
import {OcrSourceStore} from '../cloudflare/reader/ocr-source.js';import {verifyOcrSource} from '../cloudflare/reader/ocr-verification.js';import gateway from '../cloudflare/reader/ocr-source-gateway.js';
export class OcrSourceProbe {
 constructor(ctx,env){this.ctx=ctx;this.source=new OcrSourceStore(ctx.storage,env.ORIGINALS,{dispatchAuthorized:async tx=>await tx.get('synthetic-admission')===true});}
 async fetch(request){const url=new URL(request.url);try{
  if(url.pathname==='/create')return Response.json(await this.source.create(await request.json()));
  if(url.pathname==='/upload-state'){const r=await this.source.owned(request.headers.get('X-Ocr-Owner'));return Response.json({state:r.state,bytes:r.bytes,mime:r.mime});}
  if(url.pathname==='/upload')return Response.json(await this.source.upload('synthetic-owner',request));
  if(url.pathname==='/verify')return Response.json(await verifyOcrSource(this.source,'synthetic-owner',{measure:true}));
  if(url.pathname==='/synthetic-admit'){await this.ctx.storage.put('synthetic-admission',true);return Response.json({synthetic:true,providerCalls:0});}
  if(url.pathname==='/capability')return Response.json(await this.source.issueCapability());
  if(url.pathname==='/provider-source')return this.source.serve(request);
  if(url.pathname==='/revoke')return Response.json({deleted:await this.source.revoke('synthetic-owner')});
  if(url.pathname==='/status'){const r=await this.source.read(),head=await this.source.bucket.head(r.key);return Response.json({state:r.state,bytes:r.bytes,pages:r.pages,objectPresent:!!head,clearCapabilityStored:false});}
  return new Response('Not found',{status:404});
 }catch(error){return Response.json({rejected:true,code:error.code||'invalid_pdf',message:String(error.message)},{status:422});}}
 async alarm(){await this.source.cleanup();}
}
export default {async fetch(request,env){
 const url=new URL(request.url);if(url.pathname.startsWith('/v1/'))return gateway.fetch(request,{READER_MODE:'staging',OCR_SOURCE_GATEWAY_APPROVED:'1',OCR_JOBS:env.OCR_PROBE});const id=url.searchParams.get('id');if(!id||!/^[0-9a-f-]{36}$/.test(id))return new Response('Local proof',{status:200});const stub=env.OCR_PROBE.get(env.OCR_PROBE.idFromName(id));
 if(url.pathname==='/upload')return proxyOcrSourceUpload(request,stub,'synthetic-owner');
 return stub.fetch(request);
}};
