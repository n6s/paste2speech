// Local workerd-only test harness. No bindings, provider calls or remote data.
import {verifiedPdfPages} from '../cloudflare/reader/pdf-admission.js';
import {readBounded} from '../cloudflare/prepared/google.js';
export default {async fetch(request){try{return Response.json({pages:await verifiedPdfPages(await readBounded(request,6*1024*1024))});}catch{return Response.json({rejected:true},{status:422});}}};
