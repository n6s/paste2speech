// Keep the former public hostname on the same Worker during the domain move.
// Never forward tokens, arbitrary query strings, or API writes across origins.
export function legacyDomainResponse(request) {
 const url=new URL(request.url);
 if(url.hostname!=='speak.rogerpbrown.com')return null;
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, follow'};
 const account=['/signin','/api/billing','/api/billing/','/api/billing/signin','/billing'].includes(url.pathname);
 if(!['GET','HEAD'].includes(request.method)||(url.pathname.startsWith('/api/')&&!account))return Response.json({detail:'PasteToSpeech has moved. Open https://pastetospeech.com and sign in again. Old API requests cannot be replayed at the new address.'},{status:410,headers});
 if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /billing\nDisallow: /signin\nSitemap: https://pastetospeech.com/sitemap.xml\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
 const path=account?'/api/billing':['/pricing','/terms','/sitemap.xml'].includes(url.pathname)?url.pathname:'/';
 const target='https://pastetospeech.com'+path;
 // An explicit empty fragment prevents browsers inheriting old sign-in tokens.
 headers.Location=target+'#';
 delete headers['X-Robots-Tag'];
 return new Response(null,{status:301,headers});
}
