// Runs only in the clicked frame following the user's context-menu invocation.
// Keep self-contained: Chrome serializes this function for the isolated world.
export function captureSelection(limit) {
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) {
    if (active.tagName === 'INPUT' && active.type === 'password') return null;
    if (typeof active.selectionStart === 'number' && active.selectionEnd > active.selectionStart) {
      const text = active.value.slice(active.selectionStart, active.selectionEnd);
      return text.length > limit ? {oversize: true} : {plain: text, text};
    }
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const plain = selection.toString();
  if (plain.length > limit) return {oversize: true};
  if (!plain.trim()) return null;
  const range = selection.getRangeAt(0);
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  let visits = 0, size = 0;
  const blocks = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|BLOCKQUOTE|H[1-6]|DL|DT|DD)$/;
  function walk(node, depth = 0) {
    if (++visits > 20_000 || depth > 100) throw new Error('Selection complexity');
    if (!range.intersectsNode(node)) return {text: '', plain: ''};
    if (node.nodeType === Node.TEXT_NODE) {
      let value = node.nodeValue.slice(node === range.startContainer ? range.startOffset : 0,
        node === range.endContainer ? range.endOffset : undefined);
      value = value.replace(/[\t\n\r\f ]+/g, ' ');
      size += value.length;
      if (size > limit) throw new Error('Selection size');
      return {text: value, plain: value};
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return {text: '', plain: ''};
    const tag = node.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|INPUT|TEXTAREA)$/.test(tag)) return {text: '', plain: ''};
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return {text: '', plain: ''};
    // Preserve literal indentation and table layout through Chrome's visible text.
    if (/^(PRE|TABLE)$/.test(tag) || /^(pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace)) throw new Error('Literal layout');
    if (tag === 'BR') return {text: '\n', plain: '\n'};
    const children = [...node.childNodes].map(child => walk(child, depth + 1));
    let text = children.map(part => part.text).join('');
    let raw = children.map(part => part.plain).join('');
    if (tag === 'LI') {
      const parent = node.parentElement;
      let marker = '- ';
      if (parent?.tagName === 'OL') {
        let ordinal = parent.hasAttribute('start') ? Number(parent.getAttribute('start')) : parent.reversed ? parent.children.length : 1;
        for (const sibling of parent.children) {
          if (++visits > 20_000) throw new Error('Selection complexity');
          if (sibling.tagName !== 'LI') continue;
          if (sibling.hasAttribute('value')) ordinal = Number(sibling.getAttribute('value'));
          if (sibling === node) break;
          ordinal += parent.reversed ? -1 : 1;
        }
        if (Number.isSafeInteger(ordinal)) marker = `${ordinal}. `;
      }
      let nesting = 0;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (++visits > 20_000) throw new Error('Selection complexity');
        if (ancestor.tagName === 'UL' || ancestor.tagName === 'OL') nesting++;
      }
      text = '\n' + '  '.repeat(Math.max(0, nesting - 1)) + marker + text.trim() + '\n';
      raw = '\n' + raw.trim() + '\n';
    } else if (tag === 'UL' || tag === 'OL') {
      text = '\n' + text.replace(/^\n+|\n+$/g, '').replace(/\n{2,}/g, '\n') + '\n';
      raw = '\n' + raw.trim() + '\n';
    } else if (blocks.test(tag) || /^(block|flex|grid|list-item)$/.test(style.display)) {
      text = '\n\n' + text.trim() + '\n\n';
      raw = '\n\n' + raw.trim() + '\n\n';
    }
    return {text, plain: raw};
  }
  try {
    let root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) root = root.parentElement;
    // Starting within a list item must retain its boundary marker as well.
    const item = root.closest?.('li');
    if (item) root = item;
    const result = walk(root);
    const text = result.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // Never add hidden/unselected content or guess when DOM layout differs.
    if (text.length <= limit && normalize(result.plain) === normalize(plain)) return {plain, text};
  } catch { /* Unsupported layouts retain native selected text. */ }
  return {plain, text: plain};
}

const normalized = text => text.replace(/\s+/gu, ' ').trim();
export function createMenuSelectionHandler(api, send, reject = error => ({error})) {
  let pending = Promise.resolve();
  return (info, tab) => {
    if (info.menuItemId !== 'read') return Promise.resolve();
    const fallback = typeof info.selectionText === 'string' ? info.selectionText : '';
    // Start capture immediately, before any await or reader tab activation. Queue
    // delivery separately so slow captures cannot reverse consecutive selections.
    let capture;
    try {
      capture = Number.isInteger(tab?.id) ? api.scripting.executeScript({
        target: {tabId: tab.id, frameIds: [Number.isInteger(info.frameId) ? info.frameId : 0]},
        func: captureSelection, args: [2_000_000],
      }) : Promise.resolve([]);
    } catch { capture = Promise.resolve([]); }
    const resolved = Promise.resolve(capture).catch(() => []);
    const operation = pending.then(async () => {
      let timer;
      const results = await Promise.race([resolved, new Promise(resolve => { timer = setTimeout(() => resolve([]), 1500); })]);
      clearTimeout(timer);
      const result = results?.[0]?.result;
      let text = fallback;
      if (result?.oversize) return reject('This selection is too large for the extension. Copy and paste it into PasteToSpeech instead.');
      else if (typeof result?.plain === 'string' && typeof result.text === 'string' &&
        result.text.length <= 2_000_000 && normalized(result.plain) === normalized(fallback)) text = result.text;
      return send(text);
    });
    pending = operation.catch(() => {});
    return operation;
  };
}
