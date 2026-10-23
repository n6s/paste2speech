// Conservative per-page routing, not a claim of transcription accuracy.
export function assessNativePage({text='',items=[],width=612,hasImages=false}={}) {
 const chars=[...text],letters=chars.filter(c=>/\p{L}/u.test(c)).length;
 const bad=chars.filter(c=>/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff]/u.test(c)).length;
 const words=text.match(/\p{L}+/gu)||[],singles=words.filter(w=>w.length===1).length;
 // Font/style changes split one visual line into several PDF text items.
 // Columns require a repeated empty horizontal gutter, not right-hand fragments.
 const lines=[],buckets=new Map();
 for(const item of items){
  if(!item.str?.trim()||!Array.isArray(item.transform)||!Number.isFinite(item.width)||item.width<=0)continue;
  const [,,,,x,y]=item.transform;if(!Number.isFinite(x)||!Number.isFinite(y))continue;
  const tolerance=Math.max(2,Math.min(4,Math.abs(item.transform[3]||0)*.25));
  const key=Math.floor(y/4);let line;
  for(const nearby of [key-1,key,key+1]){line=buckets.get(nearby)?.find(line=>Math.abs(line.y-y)<=tolerance);if(line)break;}
  if(!line){lines.push(line={y,spans:[]});const bucket=buckets.get(key)||[];bucket.push(line);buckets.set(key,bucket);}line.spans.push([x,x+item.width]);
 }
 const rows=lines.map(line=>{const spans=line.spans.sort((a,b)=>a[0]-b[0]),merged=[];for(const span of spans){const last=merged.at(-1);if(last&&span[0]-last[1]<width*.04)last[1]=Math.max(last[1],span[1]);else merged.push([...span]);}return {y:line.y,spans:merged};});
 let columns=false;
 for(let gutter=width*.3;gutter<=width*.7;gutter+=width*.02){
  const half=width*.025;
  const split=rows.filter(({spans:row})=>row.some(([a,b])=>a<gutter-half&&b<=gutter-half)&&row.some(([a,b])=>a>=gutter+half&&b>gutter+half)&&!row.some(([a,b])=>a<gutter+half&&b>gutter-half));
  const side=right=>rows.filter(({spans})=>!spans.some(([a,b])=>a<gutter+half&&b>gutter-half)&&spans.some(([a,b])=>right?a>=gutter+half:b<=gutter-half));
  const left=side(false),right=side(true);
  const low=Math.max(Math.min(...left.map(r=>r.y)),Math.min(...right.map(r=>r.y))),high=Math.min(Math.max(...left.map(r=>r.y)),Math.max(...right.map(r=>r.y)));
  const bridges=rows.filter(({y,spans})=>y>=low&&y<=high&&spans.some(([a,b])=>a<gutter+half&&b>gutter-half)).length;
  if(split.length>=5||left.length>=5&&right.length>=5&&high-low>=48&&bridges<=Math.max(1,(left.length+right.length)*.15)){columns=true;break;}
 }
 const reasons=[];
 if(!text.trim()&&hasImages)reasons.push('image-only page');
 else if(text.trim()&&(bad>Math.max(1,chars.length*.002)||letters<Math.min(8,chars.length*.25)||words.length>=20&&singles/words.length>.45))reasons.push('unreadable embedded text');
 if(columns)reasons.push('multiple-column reading order');
 return {needsOcr:reasons.length>0,reasons,characters:chars.length,badCharacters:bad,blank:!text.trim()&&!hasImages};
}
export function assessNativeDocument(pages) {
 const diagnostics=pages.map((p,i)=>({page:i+1,...assessNativePage(p)}));
 const text=pages.map(p=>p.text).filter(t=>t.trim()).join('\n\n');
 return {text,needsOcr:!text.trim()||diagnostics.some(p=>p.needsOcr),diagnostics};
}
