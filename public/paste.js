// Parse in an inert template that is never attached to the page. Only the
// resulting Markdown enters the textarea; clipboard HTML never becomes live UI.
export function clipboardMarkdown(html, plain = '') {
  if (!html?.trim() || html.length > 2_000_000) return null;
  try {
    const template = document.createElement('template');
    template.innerHTML = html;
    // Match only simple, complete named Markdown links supplied by the source.
    // An empty HTML anchor for that same destination must not erase its label.
    const plainLinks = new Set();
    if (typeof plain === 'string' && plain.length <= 1_000_000) {
      for (const match of plain.matchAll(/(?<![\\!])\[([^\\\[\]\r\n]+)\]\((https?:\/\/[^\s()<>]+)\)/gi)) {
        if (/\p{L}|\p{N}/u.test(match[1])) plainLinks.add(match[2]);
      }
    }
    let missingLinkLabel = false;
    let codeMarker = '\uE100';
    while (html.includes(codeMarker) || template.content.textContent.includes(codeMarker)) codeMarker += '\uE100';
    const codeBlocks = [];
    const ignored = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'PICTURE', 'SVG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'INPUT']);
    const escape = text => text.replace(/\\/g, '\\\\').replace(/[`*_~\[\]]/g, '\\$&')
      .replace(/(^|\n)([ \t]*)([>#+\-]|\d+[.)])(?=\s|$)/g, '$1$2\\$3');
    const block = text => text.trim() ? '\n\n' + text.trim() + '\n\n' : '';
    const children = (node, depth) => [...node.childNodes].map(child => render(child, depth + 1)).join('');
    function render(node, depth = 0) {
      if (depth > 80) throw new Error('Clipboard nesting is too deep');
      if (node.nodeType === 3) return escape(node.textContent.replace(/\s+/g, ' '));
      if (node.nodeType !== 1 && node.nodeType !== 11) return '';
      if (node.nodeType === 11) return children(node, depth);
      const tag = node.tagName;
      if (ignored.has(tag) || node.hidden || node.getAttribute('aria-hidden') === 'true' || node.style.display === 'none' || node.style.visibility === 'hidden') return '';
      if (tag === 'BR') return '\n';
      if (tag === 'HR') return '\n\n---\n\n';
      if (tag === 'PRE') {
        const text = node.textContent.replace(/\r\n?/g, '\n');
        const runs = text.match(/`+/g) || [];
        const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
        const index = codeBlocks.push(`${fence}\n${text}\n${fence}`) - 1;
        return block(`${codeMarker}${index}\uE101`);
      }
      if (tag === 'CODE') {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        const fence = '`'.repeat(Math.max(1, ...(text.match(/`+/g) || []).map(run => run.length + 1)));
        return text ? `${fence}${text.includes('`') ? ' ' : ''}${text}${text.includes('`') ? ' ' : ''}${fence}` : '';
      }
      if (tag === 'UL' || tag === 'OL') {
        let number = Number.parseInt(node.getAttribute('start'), 10) || 1;
        const items = [...node.children].filter(child => child.tagName === 'LI').map(item => {
          if (tag === 'OL' && /^\d+$/.test(item.getAttribute('value') || '')) number = Number(item.getAttribute('value'));
          const marker = tag === 'OL' ? `${number++}. ` : '- ';
          const lines = children(item, depth).trim().split('\n');
          return marker + lines.map((line, i) => i && line ? '  ' + line : line).join('\n');
        });
        return block(items.join('\n'));
      }
      if (tag === 'TABLE') {
        // Email layout tables wrap whole paragraphs/lists. Flatten their cells
        // as blocks instead of inventing a data table and losing the content.
        const rows = [...node.querySelectorAll('tr')].filter(row => row.closest('table') === node);
        const layout = node.getAttribute('role') === 'presentation' || !node.querySelector('th') || !!node.querySelector('table, h1, h2, h3, h4, h5, h6, p, ul, ol');
        if (layout) return rows.map(row => [...row.children].filter(cell => /^(TD|TH)$/.test(cell.tagName)).map(cell => block(children(cell, depth))).join('')).join('');
        const cells = rows.map(row => [...row.children].filter(cell => /^(TD|TH)$/.test(cell.tagName)).map(cell => children(cell, depth).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
        if (!cells.length) return '';
        const width = Math.max(...cells.map(row => row.length));
        const line = row => '| ' + Array.from({length:width}, (_, i) => row[i] || '').join(' | ') + ' |';
        return block([line(cells[0]), line(Array(width).fill('---')), ...cells.slice(1).map(line)].join('\n'));
      }
      const content = children(node, depth);
      const heading = /^H([1-6])$/.exec(tag);
      const roleLevel = node.getAttribute('role') === 'heading' ? Number(node.getAttribute('aria-level') || 2) : 0;
      if (heading || roleLevel) return block('#'.repeat(heading ? Number(heading[1]) : Math.min(6, Math.max(1, roleLevel))) + ' ' + content.trim().replace(/\n+/g, ' '));
      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (!content.trim() && plainLinks.has(href)) missingLinkLabel = true;
        if (!/^(https?:\/\/|mailto:)/i.test(href) || /[\u0000-\u0020]/.test(href) || !content.trim()) return content;
        return `[${content.trim()}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
      }
      if (tag === 'BLOCKQUOTE') return block(content.trim().split('\n').map(line => '> ' + line).join('\n'));
      if (/^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|ADDRESS|FIGURE|FIGCAPTION|DL|DT|DD|LI)$/.test(tag)) return block(content);
      const wrap = marker => content.trim() ? content.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, before, inside, after) => before + marker + inside + marker + after) : content;
      if (tag === 'STRONG' || tag === 'B' || /^(bold|[6-9]00)$/.test(node.style.fontWeight)) return wrap('**');
      if (tag === 'EM' || tag === 'I' || node.style.fontStyle === 'italic') return wrap('*');
      if (tag === 'DEL' || tag === 'S') return wrap('~~');
      return content;
    }
    const markdown = render(template.content).replace(/\n{3,}/g, '\n\n').trim()
      .replace(new RegExp(codeMarker + '(\\d+)\uE101', 'g'), (_, index) => codeBlocks[Number(index)]);
    if (missingLinkLabel) return plain;
    return markdown && markdown.length <= 1_000_000 ? markdown : null;
  } catch {
    return null; // Let the browser perform its ordinary plain-text paste.
  }
}
