export const defaults = { markdown: true, citations: true, urls: true, code: true, tables: true, emoji: false };

export function cleanText(input, options = defaults) {
  let text = input.replace(/\r\n?/g, '\n');
  // Consume fenced blocks, including unfinished pasted blocks.
  text = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*(?:\n|$)|$(?![\s\S]))/gm,
    block => options.code ? '\n' : block);
  if (options.code) text = text.replace(/^(?:(?: {4}|\t)[^\n]*(?:\n|$))+/gm, '\n');
  if (options.citations) text = text
    .replace(/\uE200[\s\S]*?\uE201/g, '')
    .replace(/[^]*/g, '')
    .replace(/【[^】]*(?:†|turn\d|source)[^】]*】/gi, '')
    .replace(/\[\^\d+\](?::[^\n]*)?/g, '')
    .replace(/\b(?:turn\d+(?:search|view|fetch|file|news)\d+)\b/g, '');
  if (options.tables) {
    const lines = text.split('\n');
    const separator = line => /^\s*\|?\s*:?-{3,}:?\s*\|[\s|:\-]*$/.test(line);
    const skip = new Set();
    for (let i = 1; i < lines.length; i++) if (separator(lines[i]) && lines[i-1].includes('|')) {
      skip.add(i-1); skip.add(i);
      for (let j = i+1; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) skip.add(j);
    }
    text = lines.filter((_, i) => !skip.has(i)).join('\n');
  }
  if (options.markdown || options.urls) text = text.replace(/!?\[([^\]]*)\]\(([^\s)]*)(?:\s+"[^"]*")?\)/g,
    (_, label, url) => options.urls ? label : `${label} (${url})`);
  if (options.urls) text = text.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '').replace(/<\s*>/g, '');
  if (options.markdown) text = text
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\[[ xX]\]\s*/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/!?(\[([^\]]+)\])\[[^\]]*\]/g, '$2')
    .replace(/^\s*\[[^\]]+\]:\s+.*$/gm, '')
    .replace(/(`+)([^`]+)\1/g, '$2')
    .replace(/(\*\*|__|~~)([\s\S]+?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^\n*_]+)[*_](?=\s|[.,!?;:]|$)/g, '$1$2');
  if (options.emoji) text = text.replace(/(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu, '');
  return text.replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function chunkText(text, limit = 180) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining) {
    let cut = remaining.length;
    if (cut > limit) {
      const head = remaining.slice(0, limit + 1);
      const breaks = [...head.matchAll(/[.!?;:]\s|\n/g)];
      cut = breaks.length ? breaks.at(-1).index + 1 : head.lastIndexOf(' ');
      if (cut < limit / 3) cut = limit;
      // Do not split a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/.test(remaining[cut - 1])) cut--;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks.filter(Boolean);
}
