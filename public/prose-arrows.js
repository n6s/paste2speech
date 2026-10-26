// Formatting in English prose, not mathematical interpretation. Ambiguous
// symbols, expressions, URLs and opaque cleanup sentinels remain unchanged.
export function proseArrows(text,expanded=false){
 return text.replace(/[^\r\n]+/g,line=>{
  const prefix=/^\s*(?:\d+[.)]|[A-Z]\))[ \t]+/.exec(line)?.[0]||'';
  const arrow=expanded?/[ \t]+(?:→|➡[\uFE0E\uFE0F]?|➜|➝|➞)[ \t]+/g:/[ \t]+→[ \t]+/g;
  const body=line.slice(prefix.length),parts=body.trim().split(arrow);
  if(parts.length<2)return line;
  const prose=part=>part.replace(/[.!?]$/,'').split(/[ \t]+\/[ \t]+/).every(value=>(expanded?/^[\p{L}][\p{L}\p{M} '\u2019-]*$/u:/^[A-Za-z][A-Za-z '\u2019-]*$/).test(value)&&value.trim().length>=2);
  const phrase=part=>(expanded?/[\p{L}\p{M}]+[ \t]+[\p{L}\p{M}]+/u:/[A-Za-z]+[ \t]+[A-Za-z]+/).test(part);
  if(!parts.every(prose)||!(parts.length===2?parts.every(phrase):parts.some(phrase)))return line;
  return prefix+body.replace(arrow,parts.length===2?' to ':', then ');
 });
}
