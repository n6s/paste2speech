// Formatting in English prose, not mathematical interpretation. Ambiguous
// symbols, expressions, URLs and opaque cleanup sentinels remain unchanged.
export function proseArrows(text){
 return text.replace(/[^\r\n]+/g,line=>{
  const prefix=/^\s*(?:\d+[.)]|[A-Z]\))[ \t]+/.exec(line)?.[0]||'';
  const body=line.slice(prefix.length),parts=body.trim().split(/[ \t]+→[ \t]+/);
  if(parts.length<2)return line;
  const prose=part=>part.replace(/[.!?]$/,'').split(/[ \t]+\/[ \t]+/).every(value=>/^[A-Za-z][A-Za-z '\u2019-]*$/.test(value)&&value.trim().length>=2);
  const phrase=part=>/[A-Za-z]+[ \t]+[A-Za-z]+/.test(part);
  if(!parts.every(prose)||!(parts.length===2?parts.every(phrase):parts.some(phrase)))return line;
  return prefix+body.replace(/[ \t]+→[ \t]+/g,parts.length===2?' to ':', then ');
 });
}
