import {Inflate} from 'fflate';
export const WORD_BYTES=20*1024*1024,WORD_XML_BYTES=8*1024*1024,WORD_XML_TOTAL=24*1024*1024;
const fail=()=>{throw Error('This is not a supported, complete DOCX document. Your existing text is unchanged.');};
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function inspectWordArchive(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>WORD_BYTES)throw Error('Choose a DOCX file no larger than 20 MiB.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=n=>view.getUint16(n,true),u32=n=>view.getUint32(n,true);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))fail();const count=u16(end+10),size=u32(end+12),start=u32(end+16);if(!count||count>2048||start+size!==end)fail();
 let at=start,total=0,xmlTotal=0;const entries=new Map(),decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<count;i++){
  if(at+46>end||u32(at)!==0x02014b50)fail();const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),compressed=u32(at+20),expanded=u32(at+24),nameLength=u16(at+28),extra=u16(at+30),comment=u16(at+32),offset=u32(at+42);if(flags&65)throw Error('Password-protected Word files cannot be opened here. Save an unprotected DOCX copy first.');
  if(u16(at+34)||at+46+nameLength+extra+comment>end||offset+30>start||u32(offset)!==0x04034b50||u16(offset+8)!==method||u16(offset+6)!==flags)fail();
  const name=decoder.decode(bytes.subarray(at+46,at+46+nameLength)),localNameLength=u16(offset+26),localExtra=u16(offset+28),data=offset+30+localNameLength+localExtra;
  if(!name||name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').some(p=>p==='..'||p==='.')||entries.has(name)||data+compressed>start||decoder.decode(bytes.subarray(offset+30,offset+30+localNameLength))!==name||![0,8].includes(method))fail();
  if(!(flags&8)&&(u32(offset+14)!==crc||u32(offset+18)!==compressed||u32(offset+22)!==expanded))fail();
  total+=expanded;if(total>100*1024*1024)throw Error('The expanded Word archive exceeds the supported limit. Existing text is unchanged.');
  if(name.endsWith('.xml')||name.endsWith('.rels')){xmlTotal+=expanded;if(expanded>WORD_XML_BYTES||xmlTotal>WORD_XML_TOTAL)throw Error('The Word document XML exceeds the supported limit. Existing text is unchanged.');}
  entries.set(name,{name,method,crc,compressed,expanded,data});at+=46+nameLength+extra+comment;
 }
 if(at!==end||!entries.has('[Content_Types].xml')||!entries.has('_rels/.rels')||entries.has('word/vbaProject.bin'))fail();return entries;
}
export async function readWordXml(bytes,signal){
 const entries=inspectWordArchive(bytes),parts=new Map();let total=0;
 for(const entry of entries.values()){
  if(signal?.aborted)throw new DOMException('Import canceled.','AbortError');if(!entry.name.endsWith('.xml')&&!entry.name.endsWith('.rels'))continue;
  let length=0,crc=0xffffffff;const chunks=[];const add=chunk=>{length+=chunk.length;total+=chunk.length;if(length>entry.expanded||length>WORD_XML_BYTES||total>WORD_XML_TOTAL)throw Error('The expanded Word XML exceeds the supported limit. Existing text is unchanged.');for(const b of chunk)crc=crcTable[(crc^b)&255]^(crc>>>8);chunks.push(chunk.slice());};
  if(entry.method===0)add(bytes.subarray(entry.data,entry.data+entry.compressed));else {const inflate=new Inflate(chunk=>add(chunk));for(let at=0;at<entry.compressed;at+=1024){if(signal?.aborted)throw new DOMException('Import canceled.','AbortError');inflate.push(bytes.subarray(entry.data+at,entry.data+Math.min(at+1024,entry.compressed)),at+1024>=entry.compressed);if(at%32768===0)await new Promise(r=>setTimeout(r,0));}}
  if(length!==entry.expanded||((crc^0xffffffff)>>>0)!==entry.crc)fail();const output=new Uint8Array(length);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length;}const xml=new TextDecoder('utf-8',{fatal:true}).decode(output);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Word XML with entity declarations is unsupported. Existing text is unchanged.');parts.set(entry.name,xml);
 }
 return {parts,entries};
}
