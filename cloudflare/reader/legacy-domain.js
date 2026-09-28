// Keep the former public hostname on the same Worker during the domain move.
// Never forward tokens, arbitrary query strings, or API writes across origins.
export function legacyDomainResponse(request) {
 const url=new URL(request.url);
 if(url.hostname!=='speak.rogerpbrown.com')return null;
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, follow'};
 const account=['/signin','/api/billing','/api/billing/','/api/billing/signin','/billing'].includes(url.pathname);
 if(!['GET','HEAD'].includes(request.method)||(url.pathname.startsWith('/api/')&&!account))return Response.json({detail:'PasteToSpeech has moved. Open https://pastetospeech.com and sign in again. Old API requests cannot be replayed at the new address.'},{status:410,headers});
 const path=account?'/api/billing':['/pricing','/terms'].includes(url.pathname)?url.pathname:'/';
 const target='https://pastetospeech.com'+path;
 headers['Content-Type']='text/html; charset=utf-8';
 headers['Content-Security-Policy']="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="6;url=${target}"><title>PasteToSpeech has moved</title><link rel="canonical" href="${target}"><style>body{font:20px/1.6 system-ui;max-width:640px;margin:12vh auto;padding:24px;background:#f7f5ef;color:#243c36}a{color:inherit}</style></head><body><main><h1>We have a new home.</h1><p>PasteToSpeech is now at <strong>pastetospeech.com</strong>.</p><p>The same reader, with an address of its own. Please update your bookmark.</p><p><a href="${target}">Continue to PasteToSpeech →</a></p><p>You’ll continue automatically in six seconds.</p><p>You may need to sign in again. Browser preferences and unfinished readings do not move between websites. For an old sign-in link, request a fresh link at the new address.</p></main></body></html>`;
 return new Response(request.method==='HEAD'?null:html,{headers});
}
