import {transformMath} from './math-notation.js';
// Deterministic transcription formatting. No generative rewriting or summaries.
export function plain(markdown) {
  const math=transformMath(String(markdown||''));
  return math.restore(math.text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^[ \t]*(?:(?:[-_*][ \t]*){3,}|[=─━—]{3,})[ \t]*$/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => label === url ? url : `${label} (${url})`)
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^\p{L}\p{N}\\])([*_])([^\n*_]+)\2(?=$|[^\p{L}\p{N}])/gu, '$1$3').replace(/`([^`]+)`/g, '$1').trim());
}

// A consecutive date list is structure, even when OCR labels it as prose.
// Only line-start month/day entries qualify; ordinary dates in sentences do not.
function preserveDateListLines(text) {
  const lines=text.split('\n');
  const date=line=>/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?[ \t]+\d{1,2}(?:[–-]\d{1,2})?[ \t]*[–-][ \t]*\S/i.test(line.trim());
  const heading=line=>{const title=line.trim(),words=title.match(/\p{L}+/gu)||[];return title.length<=100&&words.length>=2&&words.length<=12&&/\p{Lu}/u.test(title)&&!/\p{Ll}/u.test(title)&&!/[.!?…]["'”’)]?$/.test(title);};
  for(let start=0;start<lines.length;start++){
    if(!date(lines[start]))continue;
    let end=start+1;while(end<lines.length&&date(lines[end]))end++;
    if(end-start>=2){
      for(let i=start+1;i<end;i++)lines[i]='\n'+lines[i];
      if(end<lines.length&&heading(lines[end]))lines[end]='\n'+lines[end];
    }
    start=end-1;
  }
  return lines.join('\n');
}

function prose(value, verse=false) {
  const math=transformMath(plain(value)),text=math.text;
  if (verse) return math.restore(text);
  return math.restore(preserveDateListLines(text).split(/\n\s*\n/).map(part => part.replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2').replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim()).join('\n\n'));
}

export function tableText(markdown) {
  const rows = String(markdown || '').split('\n').filter(line => line.includes('|'))
    .map(line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim()));
  if (rows.length < 2 || !rows[1].every(cell => /^:?-{3,}:?$/.test(cell))) return {text: plain(markdown), uncertain:true};
  const headers = rows[0].map(plain);
  return {text:rows.slice(2).map(row => row.map((cell, i) => `${headers[i] || 'Column ' + (i+1)}: ${plain(cell.replace(/\\\|/g,'|'))}`).join('; ') + '.').join('\n\n'), uncertain:false};
}

function markdownBlocks(markdown) {
  const blocks=[];let pending=[];
  const flush=()=>{if(pending.length){const content=pending.join('\n');blocks.push({type:content.includes('|')?'table':'text',content});pending=[];}};
  for(const line of String(markdown||'').split('\n')){
    if(/^\s*#{1,6}\s/.test(line)){flush();blocks.push({type:'title',content:line});}
    else if(!line.trim()){flush();}
    else pending.push(line);
  }
  flush();return blocks;
}

export function reconstruct(raw) {
  const articles = [], notes = [], excluded = [];
  let current = null;
  const start = (title, page) => ({title:plain(title) || `Page ${page}`, pages:[page], parts:[], uncertain:[]});
  const flush = () => {
    if (current?.parts.length) articles.push({...current,text:current.parts.join('\n\n')});
    current = null;
  };
  for (const page of [...(raw.pages || [])].sort((a,b) => a.index-b.index)) {
    const number = page.index + 1;
    if (!Array.isArray(page.blocks) || !page.blocks.length) notes.push(`Page ${number}: layout blocks were absent; article grouping uses Markdown headings and needs verification.`);
    const blocks = page.blocks?.length ? page.blocks : markdownBlocks(page.markdown);
    if (!blocks.length) notes.push(`Page ${number}: no readable content returned.`);
    if (page.footer) excluded.push({page:number,type:'footer',text:plain(page.footer)});
    for (const block of blocks) {
      const type = block.type || 'text';
      if (['image','footer'].includes(type)) {if(type==='footer')excluded.push({page:number,type,text:plain(block.content)});continue;}
      if (type === 'header' && /^\s*\d+\s*$/.test(block.content || '')) {excluded.push({page:number,type,text:plain(block.content)});continue;}
      if(!plain(block.content).trim() && type!=='table')continue;
      if (type === 'title') {
        if (current?.parts.length) flush();
        if (!current) current = start(block.content,number);
        else current.title += ' - ' + plain(block.content);
        if(!current.pages.includes(number))current.pages.push(number);
        const score=block.confidence_scores?.minimum_content_confidence_score;
        if(typeof score==='number'&&score<0.9)current.uncertain.push(`Page ${number}: OCR marked this heading as uncertain (minimum score ${score.toFixed(2)}).`);
        continue;
      }
      if (!current) current = start(`Page ${number}`,number);
      if (!current.pages.includes(number))current.pages.push(number);
      let content = block.content || '';
      if (type === 'table') {
        const table = (page.tables || []).find(t => t.id === block.table_id);
        if(table)content = table.content || table.markdown || content;
        const converted = tableText(content);
        content = converted.text;
        if(converted.uncertain)current.uncertain.push(`Page ${number}: a table could not be confidently converted to labeled rows.`);
      } else content = prose(content,type==='list'||/haiku|poem|poetry/i.test(current.title));
      if (!content.trim()) continue;
      if (/\[[^\]]*tbl[^\]]*\]\([^)]*\)/i.test(content))current.uncertain.push(`Page ${number}: a table placeholder needs verification.`);
      const score = block.confidence_scores?.minimum_content_confidence_score;
      if(typeof score === 'number' && score < 0.9)current.uncertain.push(`Page ${number}: OCR marked this ${type} block as uncertain (minimum score ${score.toFixed(2)}).`);
      if (type === 'aside_text')notes.push(`Page ${number}: sidebar text retained in OCR reading order.`);
      // OCR blocks are explicit regions. Missing punctuation is not evidence
      // that separate regions (or pages) continue the same sentence.
      current.parts.push(content);
    }
  }
  flush();
  for(const article of articles)notes.push(...article.uncertain);
  if(excluded.length)notes.push(`Suppressed ${excluded.length} footer/page-number regions; originals remain in the raw OCR response.`);
  return {articles,notes:[...new Set(notes)],excluded};
}

export function exportText(articles, markdown=false) {
  return articles.map(a => `${markdown?'## ':''}${a.title}\n\n${a.text}`).join('\n\n') + '\n';
}

export function readingText(article) {
  // Diagnostics remain separate. Speech contains only the heading and source text.
  return `${article.title}.\n\n${article.text}`;
}

