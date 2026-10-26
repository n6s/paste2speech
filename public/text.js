import {transformMath} from './math-notation.js';
import {proseArrows} from './prose-arrows.js';
export const defaults = { markdown: true, citations: true, urls: true, code: true, tables: true, emoji: false, joinLines: true };

// Split structure before any destructive cleanup. Code is always opaque.
const fenceStart = line => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const symbolListStart = line => /^( *)([-+*▸▹►▻▶]|\d+[.)]|[A-Z]\))([ \t\u00a0]+)(\S.*)$/.exec(line);
const atxHeading = line => /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(line);
const underline = line => /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
const indented = line => /^(?: {4}|\t)/.test(line);

function tableCells(line) {
  // Backtick spans containing pipes have ambiguous dialect-specific semantics.
  if (line.includes('`')) return null;
  const cells = []; let cell = ''; let lastPipe = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) {
      const next = line[++i]; cell += next === '|' ? '|' : '\\' + next;
    } else if (line[i] === '|') { cells.push(cell.trim()); cell = ''; lastPipe = i; }
    else cell += line[i];
  }
  cells.push(cell.trim());
  if (lastPipe < 0) return null;
  if (/^[ \t]*\|/.test(line)) cells.shift();
  if (!line.slice(lastPipe + 1).trim()) cells.pop();
  return cells;
}

function blocks(text, proseSymbols = true, expanded = false) {
  const listStart = proseSymbols ? expanded ? line => /^( *)([-+*]|(?:[▸▹►▻▶▷][\uFE0E\uFE0F]?)+|\d+[.)]|[A-Z]\))([ \t\u00a0]+)(\S.*)$/.exec(line) : symbolListStart : line => /^( *)([-+*]|\d+[.)]|[A-Z]\))([ \t\u00a0]+)(\S.*)$/.exec(line);
  const lines = text.split('\n'); const result = [];
  const push = (type, start, end, extra = {}) => result.push({type, text: lines.slice(start, end).join('\n'), ...extra});
  for (let i = 0; i < lines.length;) {
    const start = i; const line = lines[i]; const fence = fenceStart(line);
    if (fence) {
      const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \t]*$');
      i++; while (i < lines.length && !close.test(lines[i])) i++;
      const body = lines.slice(start + 1, i).join('\n');
      if (i < lines.length) i++;
      push('code', start, i, {body}); continue;
    }
    if (indented(line) && !listStart(line)) {
      i++; while (i < lines.length && ((indented(lines[i]) && !listStart(lines[i])) || (!lines[i].trim() && indented(lines[i + 1] || '')))) i++;
      push('code', start, i, {body: lines.slice(start, i).join('\n')}); continue;
    }
    const separator = tableCells(lines[i + 1] || '');
    if (line.includes('|') && separator?.length && separator.every(cell => /^:?-+:?$/.test(cell))) {
      let end = i + 2;
      while (end < lines.length && lines[end].trim() && lines[end].includes('|')) end++;
      const rows = [line, ...lines.slice(i + 2, end)].map(tableCells);
      const valid = rows.every(row => row && (expanded || row.length === separator.length)) && rows[0]?.length === separator.length;
      const emptyLayout = valid && rows.every(row => row.every(cell => !decodeEntityText(cell).trim()));
      if (emptyLayout || (expanded && valid && separator.length > 1) || separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
        i = end;
        push('table', start, i, {rows: valid ? rows : null, emptyLayout}); continue;
      }
    }
    const heading = atxHeading(line);
    if (heading || (line.trim() && !listStart(line) && underline(lines[i + 1] || ''))) {
      i += heading ? 1 : 2;
      push('heading', start, i, {body: heading ? heading[1].replace(/[ \t]+#+[ \t]*$/, '') : line}); continue;
    }
    const list = listStart(line);
    if (list) {
      i++;
      // Only indented continuations belong to this item; nested items start new blocks.
      while (i < lines.length && lines[i].trim() && !listStart(lines[i]) && !fenceStart(lines[i]) && !atxHeading(lines[i]) && /^ +/.exec(lines[i])?.[0].length > list[1].length) i++;
      let body = (/^(?:\d|[A-Z]\))/.test(list[2]) ? list[2] + ' ' : '') + list[4].replace(/^\[([ xX])\][ \t]*/, (_, mark) => mark === ' ' ? 'Unchecked: ' : 'Checked: ');
      body += lines.slice(start + 1, i).map(value => '\n' + value.trimStart()).join('');
      push('list', start, i, {body}); continue;
    }
    // Prose lines may be combined only with other prose lines.
    if (result.at(-1)?.type === 'prose') result.at(-1).text += '\n' + line;
    else push('prose', i, i + 1);
    i++;
  }
  return result;
}

export function cleanText(input, options = defaults, {proseSymbols=true,urlLabels=true,expanded=true}={}) {
  const text = input.replace(/\r\n?/g, '\n');
  if (!Object.values(options).some(Boolean)) return text;
  options={...options,proseSymbols,urlLabels,expanded};
  const math=transformMath(text,options.math===true);
  const rendered = blocks(math.text, proseSymbols, expanded).flatMap(block => {
    const separate = value => options.markdown || options.joinLines ? '\n' + value + '\n' : value;
    if (block.type === 'code') return options.code ? '\n' : ['\n', {literal: options.markdown ? block.body : block.text}, '\n'];
    if (block.type === 'table') {
      if (options.tables) return '\n';
      if (!block.rows) return separate(block.text);
      if (block.emptyLayout) return separate(cleanInline(block.text, {...options, markdown: false}));
      if (!options.markdown) return separate(cleanInline(block.text, options));
      return separate(block.rows.map(row => row.map(cell => cleanInline(cell, options)).join('; ')).join('\n\n'));
    }
    let source=options.markdown&&block.body!==undefined?block.body:block.text;
    // HTML-to-Markdown preserves literal punctuation with escapes. Only trim
    // decorative edge wrappers inside an already structural heading.
    if(expanded&&options.markdown&&block.type==='heading')source=source.replace(/^(?:\\\*)+[ \t]*(?:\\#[ \t]+)?([\s\S]+?)[ \t]*(?:\\\*)+$/,'$1').replace(/^\\#[ \t]+/,'');
    let value = cleanInline(source, {...options, emoji: false});
    if (options.joinLines && (block.type === 'prose' || block.type === 'list')) value = joinProseLines(value, block.type === 'prose');
    // Preserve emoji as a heading cue before applying the removal preference.
    if (options.emoji) value = cleanInline(value, {emoji: true,expanded:options.expanded}, false);
    return block.type === 'prose' ? value : separate(value);
  });
  // Normalize layout around blocks without ever normalizing the contents of code.
  let output = ''; let pending = '';
  for (const part of rendered) {
    if (typeof part === 'string') pending += (pending ? '\n' : '') + part;
    else {
      const gap = pending.replace(/\n{3,}/g, '\n\n');
      output += (output ? gap : gap.replace(/^\n+/, '')) + part.literal;
      pending = '\n';
    }
  }
  const tail = pending.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  return math.restore(output + (output ? tail : tail.replace(/^\n+/, '')));
}

const entityPattern = /&(?:#x[0-9a-f]+|#[0-9]+|nbsp|amp|quot|apos|lt|gt);/gi;
function decodeEntity(entity) {
  const named = {nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'};
  if (entity[1] !== '#') return named[entity.slice(1, -1).toLowerCase()];
  const hex = entity[2].toLowerCase() === 'x';
  const point = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
    ? String.fromCodePoint(point) : entity;
}
function decodeEntityText(text) { return text.replace(entityPattern, decodeEntity); }

// Decode before cleanup, shielding decoded/escaped Markdown punctuation so it
// stays literal. The prefix cannot collide with either original or decoded text.
function inlineLiterals(text, markdown) {
  let prefix = '\uE000';
  const decoded = decodeEntityText(text);
  while (text.includes(prefix) || decoded.includes(prefix)) prefix += '\uE000';
  const literals = [];
  const shield = value => { literals.push(value); return `${prefix}${literals.length - 1}\uE001`; };
  if (markdown) text = text.replace(/(`+)([^`]+)\1/g, (_, fence, code) => shield(code));
  if (markdown) text = text.replace(/\\~(?=[ \t]*\$?[0-9])/g, '~');
  if (markdown) text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, char) => shield(char));
  text = text.replace(entityPattern, entity => {
    const value = decodeEntity(entity);
    return /[\\*_~`[\]()!>#|+-]/.test(value) ? shield(value) : value;
  });
  return {text, shield, restore: value => value.replace(new RegExp(prefix + '(\\d+)\uE001', 'g'), (_, index) => literals[Number(index)])};
}

// Currency-only cardinal expansion avoids a year-style reading of four digits.
export function currencyNumberWords(value) {
  const [integer, fraction] = value.replace(/,/g, '').split('.');
  const digits = integer.replace(/^0+(?=\d)/, '');
  if (digits.length > 18) return null;
  const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const scales = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];
  const groups = [];
  for (let end = digits.length, scale = 0; end > 0; end -= 3, scale++) {
    let n = Number(digits.slice(Math.max(0, end - 3), end));
    if (!n) continue;
    const words = [];
    if (n >= 100) { words.push(small[Math.floor(n / 100)], 'hundred'); n %= 100; }
    if (n >= 20) { words.push(tens[Math.floor(n / 10)]); n %= 10; }
    if (n) words.push(small[n]);
    if (scales[scale]) words.push(scales[scale]);
    groups.unshift(words.join(' '));
  }
  return (groups.join(' ') || 'zero') + (fraction ? ' point ' + [...fraction].map(d => small[Number(d)]).join(' ') : '');
}

function proseAmounts(text) {
  return text.replace(
    /(^|[\s([{:;,"“‘])(~[ \t]*)?\$((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?)([MB])(?=$|[\s,;:!?)}\]"”’]|\.(?![\w/]))/g,
    (match, prefix, about, amount, scale) => {
      const words = currencyNumberWords(amount);
      return words === null ? match : `${prefix}${about ? 'about ' : ''}${words} ${scale === 'M' ? 'million' : 'billion'} dollars`;
    }
  );
}

// Only an entire URL-shaped link label is shortened. URL parses the actual
// hostname (including IDN/IPv6 and ports); prose and email labels stay prose.
function urlLabelHostname(label) {
  const value=label.trim();
  if(/[\s<>]/u.test(value)||!/^(?:https?:\/\/|\/\/|www\.|(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::[0-9]+)?(?:[/?#]|$))/iu.test(value))return null;
  try {
    const url=new URL(/^https?:\/\//i.test(value)?value:value.startsWith('//')?'https:'+value:'https://'+value);
    return /^https?:$/.test(url.protocol)&&url.hostname?url.hostname.replace(/\.$/,''):null;
  }catch{return null;}
}

function cleanInline(text, options, decode = true) {
  const literal = decode ? inlineLiterals(text, options.markdown) : {text, restore: value => value};
  const linkLabel=label=>{const host=options.urlLabels===false?null:urlLabelHostname(label);return host?literal.shield(host):label;};
  // Discretionary hyphens and stray BOMs are copy artifacts in prose.
  // Keep joiners, directional marks, and literal code untouched.
  text = literal.text.replace(/[\u00ad\ufeff]/g, '');
  // Named ChatGPT links carry prose, unlike citation-only reference tokens.
  // Extract their display text before generic reference/URL removal can erase it.
  if (options.markdown || options.citations || options.urls) text = text.replace(
    /\uE200(?:link|cite)\uE202([^\uE200-\uE202]*)\uE202([^\uE200-\uE202]*)\uE201/g,
    (token, url, label) => {
      if (!/^(?:https?:\/\/|www\.)[^\s<>]+$/i.test(url) || !label.trim()) return token;
      return options.urls ? linkLabel(label) : `${label} (${url})`;
    }
  );
  if (options.citations) text = text
    .replace(/\uE200[\s\S]*?\uE201/g, '')
    .replace(/[^]*/g, '')
    .replace(/【[^】]*(?:†|turn\d|source)[^】]*】/gi, '')
    .replace(/\[\^\d+\](?::[^\n]*)?/g, '')
    .replace(/\b(?:turn\d+(?:search|view|fetch|file|news)\d+)\b/g, '');
  if (options.markdown || options.urls) text = text.replace(/!?\[((?:\[[^\[\]\r\n]*\]|[^\[\]\r\n])*)\]\(([^\s)]*)(?:\s+"[^"]*")?\)/g,
    (_, label, url) => options.urls ? linkLabel(label) : `${label} (${url})`);
  if(options.markdown&&options.urls)text=text.replace(/!?(\[([^\]]+)\])\[[^\]]*\]/g,(_,token,label)=>linkLabel(label));
  if (options.urls) text = text.replace(/(?:https?:\/\/|www\.)[^\s<>\uE200-\uE202]+/gi, '').replace(/<\s*>/g, '');
  if (options.markdown) text = text
    .replace(/^ {0,3}>[ \t]?/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/!?(\[([^\]]+)\])\[[^\]]*\]/g, '$2')
    .replace(/^\s*\[[^\]]+\]:\s+.*$/gm, '')
    .replace(/(`+)([^`]+)\1/g, '$2')
    .replace(/(\*\*|__|~~)([\s\S]+?)\1/g, (token,mark,body,offset,whole)=>options.expanded&&mark==='**'&&/^\s+[\p{L}\p{N}]+\s+$/u.test(body)&&/(?:^|\s)(?:[+-]?\p{N}+(?:\.\p{N}+)?|\p{L})\s*$/u.test(whole.slice(0,offset))&&/^\s*(?:[+-]?\p{N}+(?:\.\p{N}+)?|\p{L})(?:\s|$)/u.test(whole.slice(offset+token.length))?token:body)
    .replace(options.expanded?/(^|\s)[*_]([^\s*_](?:[^\n*_]*[^\s*_])?)[*_](?=\s|[.,!?;:]|$)/g:/(^|\s)[*_]([^\n*_]+)[*_](?=\s|[.,!?;:]|$)/g, '$1$2');
  if (options.markdown) {
    // Skip URLs and path-like tokens; the tilde must introduce a prose number.
    text = text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi).map((part, index) => index % 2 ? part : proseAmounts(part).replace(
      /(^|[\s([{:;,"“‘])~[ \t]*(?=\$?[0-9]+(?:\.[0-9]+)?(?:%?)(?=$|[\s,;:!?)}\]"”’]|\.(?![\w/])))/g,
      '$1about '
    )).join('');
  }
  if(options.markdown&&options.expanded)text=text
    .replace(/^[ \t]*(?:\*{1,}|_{2,})[ \t]*([^\n]*[\p{L}][^\n]*?)[ \t]*(?:\*{1,}|_{2,})[ \t]*$/gmu,'$1')
    .replace(/^ {0,3}#{1,6}[ \t\u00a0]+/gm,'').replace(/^ {0,3}#{2,6}(?=\p{L})/gmu,'');
  if(options.markdown&&options.proseSymbols!==false)text=proseArrows(text,options.expanded);
  if(options.emoji&&options.expanded)text=text
    .replace(/(^|\n)[ \t]*(?:[▸▹►▻▶▷➤➜➝➞➔➡→][\uFE0E\uFE0F]?)+[ \t]+(?=[\p{L}\p{M}]{2,}[ \t]+[\p{L}\p{M}]{2,})/gu,'$1')
    .replace(/((?:[\p{L}][\p{L}\p{M}]+[ \t]+){2})(?:[▸▹►▻▶▷][\uFE0E\uFE0F]?)+(?=[ \t]+[\p{L}][\p{L}\p{M}]+)/gu,'$1');
  text = literal.restore(text);
  if (options.emoji) text = text.replace(/(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu, '');
  return text.replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Only protect predictable continuations; ambiguous sentence endings stay with Intl.
function protectedBoundary(before, after) {
  const next = after.trimStart();
  if (/^\d+\.$/.test(before.trim())) return true;
  if (/(?:^|[\s“‘"'(\[{])(?:Mr|Mrs|Ms|Dr|Prof|Rev|Fr|Sr|Jr)\.$/i.test(before.trimEnd())) return /^\p{L}/u.test(next);
  if (/(?:^|[\s“‘"'(\[{])[A-HJ-Z]\.$/.test(before.trimEnd())) return /^[A-Z]\p{L}*/u.test(next);
  return /(?:^|[\s“‘"'(\[{])(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|No)\.$/i.test(before.trimEnd()) && /^\d/.test(next);
}

export function chunkText(text, limit = 500) {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError('Chunk limit must be an integer of at least 2.');
  const chunks = [];
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
  // Preserve headings and other line boundaries before finding sentences.
  for (const line of text.split(/\r\n?|\n/)) {
    const sentences = [];
    for (const part of segmenter ? Array.from(segmenter.segment(line), part => part.segment) : [line]) {
      if (sentences.length && protectedBoundary(sentences.at(-1), part)) sentences[sentences.length - 1] += part;
      else sentences.push(part);
    }
    for (const sentence of sentences) {
      let remaining = sentence.trim();
      while (remaining) {
        let cut = remaining.length;
        if (cut > limit) {
          const head = remaining.slice(0, limit + 1);
          const breaks = [...head.matchAll(segmenter ? /[,;:]\s/g : /[.!?;:]\s/g)].filter(match =>
            !protectedBoundary(remaining.slice(0, match.index + 1), remaining.slice(match.index + 1)));
          const phraseCut = breaks.length ? breaks.at(-1).index + 1 : -1;
          const spaces = [...head.matchAll(/\s/g)];
          const wordCut = spaces.length ? spaces.at(-1).index : -1;
          cut = phraseCut >= limit / 3 ? phraseCut : wordCut > 0 ? wordCut : limit;
          // Only oversized unbroken tokens need a hard cut; keep surrogate pairs intact.
          if (/[\uD800-\uDBFF]/.test(remaining[cut - 1])) cut--;
        }
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
    }
  }
  return chunks.filter(Boolean);
}

// Repair hard wraps from PDF prose without removing paragraph boundaries.
export function joinWrappedLines(input) {
  const text = input.replace(/\r\n?/g, '\n');
  if (blocks(text).every(block => block.type === 'prose')) return joinProseLines(text);
  return cleanText(text, {...Object.fromEntries(Object.keys(defaults).map(key => [key, false])), joinLines: true});
}

function joinProseLines(input, detectTitles = true) {
  if (detectTitles) {
    const lines = input.split('\n');
    input = lines.map((line, index) => {
      const title = line.trim();
      const next = lines[index + 1] || '';
      // Copied newsletter quizzes lose Markdown, but keep their Q1 · labels.
      // Start those question lines separately while still joining their wraps.
      if (/^Q[0-9]+[ \t\u00a0]*·[ \t\u00a0]*\S/u.test(title)) return '\n' + line;
      // Short all-caps labels followed by mixed-case prose are likely headings.
      // A single word needs an emoji-led next line to avoid splitting acronyms.
      const words = title.match(/\p{L}+/gu) || [];
      const singleTitle = words.length === 1 && words[0].length >= 2 && /^\s*\p{Extended_Pictographic}/u.test(next);
      const heading = title.length <= 100 && (words.length >= 2 || singleTitle) && words.length <= 12
        && /\p{Lu}/u.test(title) && !/\p{Ll}/u.test(title)
        && !/[.!?…]["'”’)}\]]*$/.test(title)
        && /\p{Lu}/u.test(next) && /\p{Ll}/u.test(next);
      return heading ? '\n' + line + '\n' : line;
    }).join('\n').replace(/^\n+|\n+$/g, '');
  }
  // Start once per line: an unanchored scan retries the whole remaining line
  // at every character when a long clipboard paragraph has no newline.
  return input.replace(/\r\n?/g, '\n').replace(
    /^([^\n]*\S)[ \t]*\n[ \t]*(?=\S)/gm,
    (match, line) => /[.!?…]["'”’)}\]]*$/.test(line.trimEnd()) ? match : line.trimEnd() + ' '
  );
}

// Count Unicode code points, matching the WaveNet credit ledger. Separators
// between chunks are not submitted and must not inflate the reading count.
export function readingCharacters(original, chunks) {
  const before = [...original].length;
  const submitted = chunks.reduce((total, chunk) => total + [...chunk].length, 0);
  return {before, submitted, saved: Math.max(0, before - submitted)};
}
