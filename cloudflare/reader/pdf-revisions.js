// Pinned pdf-lib provides PDF token/object/stream parsing. This bounded layer
// selects authoritative xref revisions; it never repairs missing offsets or
// executes document content, attachments, forms or JavaScript.
import {PDFParser,PDFObjectStreamParser,PDFXRefStreamParser,PDFRawStream,PDFName,PDFNumber,PDFArray,PDFDict,PDFRef,PDFNull} from 'pdf-lib';
const name=PDFName.of,word=s=>new TextEncoder().encode(s),xref=word('xref'),trailer=word('trailer'),endobj=word('endobj');
export async function readPdfRevisions({bytes,limits,budget,check,bound,structuralStream}){
 const parser=bound(PDFParser.forBytesWithOptions(bytes,100,true,false)),context=parser.context;
 const number=(v,max,min=0)=>{const n=v instanceof PDFNumber?v.asNumber():NaN;if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid PDF xref number');return n;};
 const fail=()=>{throw Error('Invalid PDF cross-reference structure');};
 const direct=v=>{if(v instanceof PDFRef)fail();if(v instanceof PDFArray)for(let i=0;i<v.size();i++)direct(v.get(i));};
 const structural=s=>{for(const key of ['Type','Size','Index','Prev','W','Filter','DecodeParms','N','First','Length'])if(s.dict.has(name(key)))direct(s.dict.get(name(key)));};
 const raw=offset=>{check();if(!Number.isSafeInteger(offset)||offset<1||offset>=bytes.length)fail();parser.bytes.moveTo(offset);if(!(bytes[offset]>=48&&bytes[offset]<=57))fail();const ref=parser.parseIndirectObjectHeader();if(!Number.isSafeInteger(ref.objectNumber)||ref.objectNumber<1||ref.objectNumber>=limits.xref||!Number.isSafeInteger(ref.generationNumber)||ref.generationNumber<0||ref.generationNumber>65535)fail();parser.skipWhitespaceAndComments();const object=parser.parseObject();parser.skipWhitespaceAndComments();if(!parser.matchKeyword(endobj)||!([undefined,0,9,10,12,13,32,40,41,60,62,91,93,123,125,47,37].includes(parser.bytes.peek())))fail();return {ref,object};};
 const sections=new Map(),seenOffsets=new Set();let revisionCount=0,entryCount=0,root=null,encrypted=false;
 function validate(entry,size){check();if(++entryCount>limits.nodes||entry.id<0||entry.id>=size||entry.id>=limits.xref)fail();if(entry.type===0){if(entry.offset>=limits.xref||entry.generation>65535)fail();}else if(entry.type===1){if(!entry.id||entry.offset<1||entry.offset>=bytes.length||entry.generation>65535)fail();}else if(entry.type===2){if(!entry.id||entry.offset<1||entry.offset>=limits.xref||entry.generation>=2048)fail();}else fail();return entry;}
 async function streamSection(offset){
  const {ref,object}=raw(offset);if(!(object instanceof PDFRawStream)||object.dict.get(name('Type'))!==name('XRef'))fail();structural(object);
  const dict=object.dict,size=number(dict.get(name('Size')),limits.xref,1),w=dict.get(name('W'));if(!(w instanceof PDFArray)||w.size()!==3)fail();const widths=Array.from({length:3},(_,i)=>number(w.get(i),8)),width=widths.reduce((a,b)=>a+b,0);if(!width)fail();
  const ranges=[],index=dict.get(name('Index'));if(index){if(!(index instanceof PDFArray)||index.size()%2||index.size()>2*limits.xref)fail();for(let i=0;i<index.size();i+=2)ranges.push([number(index.get(i),size),number(index.get(i+1),size)]);}else ranges.push([0,size]);
  let count=0;for(const [start,n]of ranges){if(start+n>size)fail();count+=n;if(count>limits.xref)fail();}
  const safe=await structuralStream(object,width);if(safe.contents.length!==count*width)fail();
  // pdf-lib uses 32-bit bitwise reads. Validate wide fields before handing them
  // over, so nonzero high bytes cannot wrap into a different valid reference.
  let cursor=0;const entries=new Map();for(const [start,n]of ranges)for(let i=0;i<n;i++){const values=widths.map((length,field)=>{let value=field===0&&!length?1:0;for(let j=0;j<length;j++){value=value*256+safe.contents[cursor++];if(!Number.isSafeInteger(value))fail();}return value;});const entry=validate({id:start+i,type:values[0],offset:values[1],generation:values[2]},size);if(entries.has(entry.id))fail();entries.set(entry.id,entry);}
  const decoded=PDFXRefStreamParser.forStream(safe).parseEntries();if(decoded.length!==entries.size)fail();let i=0;for(const entry of entries.values()){const decodedEntry=decoded[i++];if(decodedEntry.ref.objectNumber!==entry.id||decodedEntry.offset!==entry.offset||decodedEntry.ref.generationNumber!==entry.generation)fail();}
  return {dict,entries,ref,stream:true};
 }
 async function section(offset,streamOnly=false){
  if(seenOffsets.has(offset)||++revisionCount>limits.visited)fail();seenOffsets.add(offset);check();if(offset<1||offset>=bytes.length)fail();parser.bytes.moveTo(offset);
  if(streamOnly||!parser.matchKeyword(xref))return streamSection(offset);
  const entries=new Map();parser.skipWhitespaceAndComments();while(parser.bytes.peek()>=48&&parser.bytes.peek()<=57){const start=parser.parseRawInt();parser.skipWhitespaceAndComments();const count=parser.parseRawInt();if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<0||count<1||start+count>limits.xref)fail();for(let i=0;i<count;i++){check();parser.skipWhitespaceAndComments();const position=parser.parseRawInt();parser.skipWhitespaceAndComments();const generation=parser.parseRawInt();parser.skipWhitespaceAndComments();const type=parser.bytes.next();if(!Number.isSafeInteger(position)||!Number.isSafeInteger(generation)||position<0||generation<0||![102,110].includes(type)||![0,9,10,12,13,32,37].includes(parser.bytes.peek())||entries.has(start+i))fail();entries.set(start+i,{id:start+i,type:type===102?0:1,offset:position,generation});}parser.skipWhitespaceAndComments();}
  if(!parser.matchKeyword(trailer))fail();parser.skipWhitespaceAndComments();const dict=parser.parseDict(),size=number(dict.get(name('Size')),limits.xref,1);for(const entry of entries.values())validate(entry,size);
  return {dict,entries,stream:false};
 }
 const tail=new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-2048))),match=/startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);if(!match)fail();let offset=Number(match[1]);
 while(offset){const current=await section(offset),dict=current.dict;const hybrid=dict.get(name('XRefStm'));if(hybrid){if(current.stream)fail();const supplement=await section(number(hybrid,bytes.length-1,1),true);if(dict.has(name('Root'))&&supplement.dict.has(name('Root'))&&dict.get(name('Root')).toString()!==supplement.dict.get(name('Root')).toString())fail();for(const [id,entry]of supplement.entries)current.entries.set(id,entry);if(supplement.dict.has(name('Encrypt'))&&supplement.dict.get(name('Encrypt'))!==PDFNull)encrypted=true;if(!root&&!dict.has(name('Root'))&&supplement.dict.has(name('Root')))root=supplement.dict.get(name('Root'));}
  if(!root&&dict.has(name('Root'))){root=dict.get(name('Root'));if(!(root instanceof PDFRef))fail();}
  if(dict.has(name('Encrypt'))&&dict.get(name('Encrypt'))!==PDFNull)encrypted=true;
  for(const [id,entry]of current.entries)if(!sections.has(id))sections.set(id,entry);
  const previous=dict.get(name('Prev'));offset=previous?number(previous,bytes.length-1):0;
 }
 if(!root)fail();
 const cached=new Map(),containers=new Map(),loading=new Set(),structuralBuffers=new Set();
 async function container(id){if(containers.has(id))return containers.get(id);const entry=sections.get(id);if(!entry||entry.type!==1||entry.generation!==0)fail();const parsed=raw(entry.offset);if(parsed.ref.objectNumber!==id||parsed.ref.generationNumber!==0||!(parsed.object instanceof PDFRawStream)||parsed.object.dict.get(name('Type'))!==name('ObjStm'))fail();structural(parsed.object);
  const count=number(parsed.object.dict.get(name('N')),2048,1),first=number(parsed.object.dict.get(name('First')),2*1024*1024),safe=await structuralStream(parsed.object);if(first>=safe.contents.length)fail();const sub=bound(PDFObjectStreamParser.forStream(safe));const headers=sub.parseOffsetsAndObjectNumbers();if(headers.length!==count||sub.bytes.offset()>first||new Set(headers.map(h=>h.objectNumber)).size!==count)fail();for(let i=0;i<headers.length;i++){const h=headers[i];if(!Number.isSafeInteger(h.objectNumber)||h.objectNumber<1||h.objectNumber>=limits.xref||!Number.isSafeInteger(h.offset)||h.offset<0||first+h.offset>=safe.contents.length||i&&h.offset<=headers[i-1].offset)fail();}
  structuralBuffers.add(safe.contents.buffer);const value={sub,headers,first,safe};containers.set(id,value);return value;
 }
 async function load(ref){const key=ref.toString();if(cached.has(key))return cached.get(key);if(loading.has(key)||loading.size>=64)fail();loading.add(key);try{check();const entry=sections.get(ref.objectNumber);if(!entry||entry.type===0||ref.generationNumber!==(entry.type===2?0:entry.generation))fail();let object;if(entry.type===1){const parsed=raw(entry.offset);if(parsed.ref!==ref)fail();object=parsed.object;}else{const c=await container(entry.offset),header=c.headers[entry.generation];if(header?.objectNumber!==ref.objectNumber)fail();c.sub.bytes.moveTo(c.first+header.offset);object=c.sub.parseObject();c.sub.skipWhitespaceAndComments();const end=entry.generation+1<c.headers.length?c.first+c.headers[entry.generation+1].offset:c.safe.contents.length;if(c.sub.bytes.offset()>end||object instanceof PDFRawStream)fail();}cached.set(key,object);context.assign(ref,object);return object;}finally{loading.delete(key);}}
 async function resolve(value){const seen=new Set();while(value instanceof PDFRef){if(seen.has(value.toString())||seen.size>=64)fail();seen.add(value.toString());value=await load(value);}return value;}
 async function validateActive(){for(const [id,entry]of sections)if(id&&entry.type!==0)await load(PDFRef.of(id,entry.type===2?0:entry.generation));}
 return {context,root,encrypted,resolve,validateActive,revisionCount,xrefEntries:sections.size,structuralBuffers};
}
