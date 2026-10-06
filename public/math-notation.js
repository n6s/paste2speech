// Conservative, local-only recognition. This does not interpret or narrate math.
const environments=new Set(['math','displaymath','equation','equation*','align','align*','aligned','gather','gather*','gathered','multline','multline*','array','cases','matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','split']);
const escaped=(text,index)=>{let n=0;while(index>0&&text[--index]==='\\')n++;return n%2===1;};
function codeRanges(text){
 const ranges=[];let offset=0,fence;
 for(const line of text.split('\n')){
  const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(fence){if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.size&&!marker[2].trim()){ranges.push({start:fence.start,end:offset+line.length,kind:'code'});fence=null;}}
  else if(marker)fence={start:offset,char:marker[1][0],size:marker[1].length};
  else if(/^(?: {4}|\t)/.test(line))ranges.push({start:offset,end:offset+line.length,kind:'indent'});
  offset+=line.length+1;
 }
 if(fence)ranges.push({start:fence.start,end:text.length,kind:'code'});
 for(const pattern of [/(`+)[^`\n]*?\1/g,/(?:https?:\/\/|www\.)[^\s<>]+/gi])for(const match of text.matchAll(pattern))ranges.push({start:match.index,end:match.index+match[0].length,kind:'code'});
 return ranges.sort((a,b)=>a.start-b.start||b.end-a.end);
}
function bracesBalanced(body){let depth=0;for(let i=0;i<body.length;i++){if(body[i]!=='{'&&body[i]!=='}')continue;if(escaped(body,i))continue;if(body[i]==='{')depth++;if(body[i]==='}'&&--depth<0)return false;}return depth===0;}
function closing(text,start,delimiter){let end=text.indexOf(delimiter,start);while(end>=0&&escaped(text,end))end=text.indexOf(delimiter,end+delimiter.length);return end;}
function environmentEnd(text,start){
 const stack=[],pattern=/\\(begin|end)\{([A-Za-z]+\*?)\}/g;pattern.lastIndex=start;
 for(let match;(match=pattern.exec(text));){if(escaped(text,match.index))continue;if(match[1]==='begin')stack.push(match[2]);else if(stack.pop()!==match[2])return -1;if(!stack.length)return pattern.lastIndex;}
 return -1;
}
export function mathSpans(text){
 if(!text.includes('$')&&!text.includes('\\(')&&!text.includes('\\[')&&!text.includes('\\begin{'))return [];
 const ranges=codeRanges(text),spans=[];let rangeIndex=0;
 for(let i=0;i<text.length;){
  while(rangeIndex<ranges.length&&ranges[rangeIndex].end<=i)rangeIndex++;
  if(ranges[rangeIndex]?.start<=i){i=Math.max(i+1,ranges[rangeIndex].end);continue;}
  if(text[i]!=='$'&&!text.startsWith('\\(',i)&&!text.startsWith('\\[',i)&&!text.startsWith('\\begin{',i)){i++;continue;}
  if(escaped(text,i)){i++;continue;}
  let open,close,display=false,end;
  if(text.startsWith('\\begin{',i)){
   const match=/^\\begin\{([A-Za-z]+\*?)\}/.exec(text.slice(i));
   if(!match||!environments.has(match[1])){i++;continue;}
   end=environmentEnd(text,i);if(end<0)break;open=match[0];display=true;
  }else{
   if(text.startsWith('$$',i)){open=close='$$';display=true;}
   else if(text[i]==='$'){open=close='$';}
   else if(text.startsWith('\\(',i)){open='\\(';close='\\)';}
   else if(text.startsWith('\\[',i)){open='\\[';close='\\]';display=true;}
   else{i++;continue;}
   const at=closing(text,i+open.length,close);if(at<0){if(open!=='$')break;i+=open.length;continue;}end=at+close.length;
  }
  const body=text.slice(i+open.length,end-(close?.length||0));
  const dollarMath=open!=='$'||(!body.includes('\n')&&!body.includes('$')&&(/\\[A-Za-z]+/.test(body)||(!/[A-Za-z]{2,}/.test(body)&&(/[_^=+*/<>]/.test(body)||/[A-Za-z0-9]\s*-\s*[A-Za-z0-9]/.test(body)||/^\p{L}$/u.test(body.trim())))));
  let crossesCode=false;for(let n=rangeIndex;n<ranges.length&&ranges[n].start<end;n++){if(ranges[n].end>i&&ranges[n].kind!=='indent'){crossesCode=true;break;}}
  if(body.trim()&&bracesBalanced(body)&&dollarMath&&!crossesCode){spans.push({start:i,end,display});i=end;}else i+=open.length;
 }
 return spans;
}
export function transformMath(text,skip=false){
 const spans=mathSpans(text),values=[];let prefix='\uE010';while(text.includes(prefix))prefix+='\uE010';let result='',cursor=0;
 for(const span of spans){result+=text.slice(cursor,span.start);if(skip)result+=span.display?'\n\n':' ';else{values.push(text.slice(span.start,span.end));result+=`${prefix}${values.length-1}\uE011`;}cursor=span.end;}
 result+=text.slice(cursor);
 return {text:result,restore:value=>value.replace(new RegExp(prefix+'(\\d+)\uE011','g'),(_,index)=>values[Number(index)])};
}
