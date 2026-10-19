// Local-only decoding: no uploads, persistence, markup parsing or encoding guesses.
export const TEXT_MAX_BYTES=20*1024*1024,TEXT_MAX_CHARACTERS=20_000_000;
const stopped=signal=>{if(signal?.aborted)throw new DOMException('Import canceled.','AbortError');};
export async function extractPlainText(file,signal){
 stopped(signal);
 if(!Number.isSafeInteger(file.size)||file.size<1)throw Error('This text file is empty. Existing text is unchanged.');
 if(file.size>TEXT_MAX_BYTES)throw Error('Choose a text file no larger than 20 MiB. Existing text is unchanged.');
 const reader=file.stream().getReader(),parts=[];let bytes=0,characters=0,header=new Uint8Array(),decoder,encoding='UTF-8';
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 const add=value=>{characters+=value.length;if(characters>TEXT_MAX_CHARACTERS)throw Error('The text exceeds 20,000,000 characters. Existing text is unchanged.');if(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(value))throw Error('This file contains binary or unsupported control characters. Export it as UTF-8 plain text.');parts.push(value);};
 const start=()=>{
  if(header.length>=4&&(header[0]===255&&header[1]===254&&header[2]===0&&header[3]===0||header[0]===0&&header[1]===0&&header[2]===254&&header[3]===255))throw Error('UTF-32 text is not supported. Export it as UTF-8 plain text.');
  if(header[0]===255&&header[1]===254)encoding='UTF-16LE';else if(header[0]===254&&header[1]===255)encoding='UTF-16BE';
  decoder=new TextDecoder(encoding,{fatal:true});add(decoder.decode(header,{stream:true}));header=null;
 };
 try{
  while(true){stopped(signal);const {value,done}=await reader.read();stopped(signal);if(done)break;
   bytes+=value.byteLength;if(bytes>TEXT_MAX_BYTES||bytes>file.size)throw Error('The text file exceeds its supported size. Existing text is unchanged.');
   if(!decoder){const needed=Math.min(4-header.length,value.length),next=new Uint8Array(header.length+needed);next.set(header);next.set(value.subarray(0,needed),header.length);header=next;if(header.length<4)continue;start();if(needed<value.length)add(decoder.decode(value.subarray(needed),{stream:true}));}
   else add(decoder.decode(value,{stream:true}));
  }
  if(bytes!==file.size)throw Error('The text file could not be read completely. Existing text is unchanged.');
  if(!decoder)start();add(decoder.decode());stopped(signal);
  const text=parts.join('').replace(/\r\n?/g,'\n');if(!text.trim())throw Error('This text file has no readable text. Existing text is unchanged.');
  return {text,encoding,notes:[encoding+' text decoded locally. Line breaks and tabs are retained; no file was uploaded and no credits were used.']};
 }catch(error){stopped(signal);if(error instanceof TypeError)throw Error('The text could not be decoded as UTF-8 or BOM-marked UTF-16. Export it as UTF-8 plain text.');throw error;}
 finally{signal?.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
