// Conservative per-page routing, not a claim of transcription accuracy.
export function assessNativePage({text='',items=[],width=612,hasImages=false}={}) {
 const chars=[...text],letters=chars.filter(c=>/\p{L}/u.test(c)).length;
 const bad=chars.filter(c=>/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff]/u.test(c)).length;
 const words=text.match(/\p{L}+/gu)||[],singles=words.filter(w=>w.length===1).length;
 const substantial=items.filter(i=>i.str?.trim().length>=15&&Array.isArray(i.transform));
 const left=substantial.filter(i=>i.transform[4]<width*.4).length,right=substantial.filter(i=>i.transform[4]>width*.5).length;
 const reasons=[];
 if(!text.trim()&&hasImages)reasons.push('image-only page');
 else if(text.trim()&&(bad>Math.max(1,chars.length*.002)||letters<Math.min(8,chars.length*.25)||words.length>=20&&singles/words.length>.45))reasons.push('unreadable embedded text');
 if(left>=5&&right>=5)reasons.push('multiple-column reading order');
 return {needsOcr:reasons.length>0,reasons,characters:chars.length,badCharacters:bad,blank:!text.trim()&&!hasImages};
}
export function assessNativeDocument(pages) {
 const diagnostics=pages.map((p,i)=>({page:i+1,...assessNativePage(p)}));
 const text=pages.map(p=>p.text).filter(t=>t.trim()).join('\n\n');
 return {text,needsOcr:!text.trim()||diagnostics.some(p=>p.needsOcr),diagnostics};
}
