// Preserve all source characters; only section boundaries are added. No SSML,
// dictionary, number expansion, silence insertion, or pronunciation rewriting.
export function sections(text){
 if(typeof text!=='string'||!text.trim())throw Error('Paste some readable text first.');
 if(text.length>20000)throw Error('The private reader accepts up to 20,000 characters.');
 const result=[];let remaining=text;const encoder=new TextEncoder();
 while(encoder.encode(remaining).length>4500){
  let end=0,bytes=0;for(const character of remaining){const n=encoder.encode(character).length;if(bytes+n>4500)break;bytes+=n;end+=character.length;}
  const part=remaining.slice(0,end);let split=part.lastIndexOf('\n\n');
  if(split>part.length/2)end=split+2;else {split=part.lastIndexOf(' ');if(split>part.length/2)end=split+1;}
  const chunk=remaining.slice(0,end);if(!chunk.trim())throw Error('A section contains only whitespace.');
  result.push(chunk);remaining=remaining.slice(end);
 }
 if(remaining){if(!remaining.trim())result[result.length-1]+=remaining;else result.push(remaining);}
 if(result.length>32)throw Error('Too many sections.');return result;
}
