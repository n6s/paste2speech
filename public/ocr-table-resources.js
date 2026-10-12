// Resolve only resources embedded in this provider page. Never fetch a link.
// The saved provider JSON remains unchanged; this is derived presentation.
export function assembleOcrPage(page,{maxCharacters=20_000_000}={}){
 if(!page||typeof page!=='object'||page.tables!==undefined&&!Array.isArray(page.tables)||page.blocks!==undefined&&!Array.isArray(page.blocks))throw Error('Unsupported scan page resources');
 const resources=new Map(),notes=new Set(),unresolved=new Set();let budget=maxCharacters;
 for(const table of page.tables||[]){if(!table||typeof table.id!=='string')continue;const content=typeof table.content==='string'?table.content:table.markdown;if(typeof content!=='string')continue;if(resources.has(table.id)&&resources.get(table.id)!==content)throw Error('Ambiguous scan table resource');resources.set(table.id,content);}
 const tableReference=href=>resources.has(href)?href:resources.has(href.replace(/^\.\//,''))?href.replace(/^\.\//,''):null;
 function expand(value,stack=new Set(),depth=0){const text=String(value||''),parts=[];let at=0;const add=part=>{budget-=part.length;if(budget<0)throw Error('Assembled scan text exceeds the supported bound');parts.push(part);};
  for(const m of text.matchAll(/!?\[([^\]]*)\]\(<?([^\s()]+)>?(?:\s+"[^"]*")?\)/g)){const href=m[2].replace(/>$/,''),id=tableReference(href);if(!id){if(/^(?:\.\/)?tbl[-_][^/\s]+\.(?:md|html)$/i.test(href)){unresolved.add(href);notes.add('A referenced table was not included in the saved response.');}continue;}add(text.slice(at,m.index));if(stack.has(id)||depth>=16){unresolved.add(id);notes.add('A cyclic or excessively nested table reference could not be assembled.');add(m[0]);}else{const next=new Set(stack);next.add(id);add(expand(resources.get(id),next,depth+1));}at=m.index+m[0].length;}
  add(text.slice(at));return parts.join('');
 }
 const tables=(page.tables||[]).map(t=>typeof t?.id==='string'&&resources.has(t.id)?{...t,content:expand(resources.get(t.id),new Set([t.id]))}:t);
 const blocks=(page.blocks||[]).map(b=>{if(!b||typeof b!=='object')return b;const id=b.type==='table'&&resources.has(b.table_id)?b.table_id:null;return {...b,content:expand(id?resources.get(id):b.content,id?new Set([id]):new Set())};});
 return {page:{...page,markdown:typeof page.markdown==='string'?expand(page.markdown):page.markdown,header:page.header?expand(page.header):page.header,footer:page.footer?expand(page.footer):page.footer,blocks,tables},notes:[...notes],unresolved:[...unresolved]};
}
