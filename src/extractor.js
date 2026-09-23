(() => {
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')]
    .filter(el => visible(el) && el.innerText.trim().length > 80);
  const detail = [...document.querySelectorAll('#root-detail')].filter(visible).at(-1);
  const root = detail && visible(detail) ? detail : dialogs.at(-1) || document.body;
  const candidates = new Map();
  function add(raw, name, kind, selected) {
    if (!raw) return;
    let url;
    try { url = new URL(raw, location.href); } catch { return; }
    // blob URLs belong to the source page and cannot reliably be downloaded after leaving it.
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (candidates.has(url.href)) {
      if (selected) candidates.get(url.href).selected = true;
      return;
    }
    candidates.set(url.href, { url: url.href, name: name || '', kind, selected });
  }
  for (const img of root.querySelectorAll('img')) {
    if (!visible(img)) continue;
    const rect = img.getBoundingClientRect();
    // Intrinsic dimensions can be huge even for a 24px avatar. Use visible size
    // only as a fallback; rich-text images may intentionally be tiny thumbnails.
    const large = rect.width >= 180 && rect.height >= 100;
    const richText = img.matches('[data-testid="cangjie-image"]') || Boolean(img.closest('article,[data-cangjie-editor],[data-slate-editor],[class*="rich-text"],[class*="markdown"]'));
    const src = img.getAttribute('data-src') || img.currentSrc || img.src;
    const avatar = /avatar|profile|logo|emoji/i.test(`${src} ${img.className}`) || Boolean(img.closest('[class*="avatar" i],[data-role*="avatar" i],[class*="emoji" i]'));
    if (avatar) continue;
    add(src, img.alt || img.title, 'image', richText || large);
  }
  for (const a of root.querySelectorAll('a[href]')) {
    if (!visible(a)) continue;
    const name = a.getAttribute('download') || a.innerText.trim() || a.title;
    const file = a.hasAttribute('download') || filePattern.test(a.href) || filePattern.test(name);
    add(a.href, name, file ? 'attachment' : 'link', file);
  }
  const fileCounts = new Map();
  const nativeAttachments = [];
  const unresolvedAttachments = [];
  // Comment cards often split the filename over several text nodes (for example
  // "app 日志" and ".zip") and do not render a download icon until hovered.
  const downloadSelector = '.next-icon-download,[aria-label*="下载" i],[title*="下载" i],[data-testid*="download" i],button[download]';
  const filePattern = /\.(?:log|txt|zip|gz|tgz|tar|7z|rar|json|csv|xml|har|dmp|crash|pdf|docx?|xlsx?|png|jpe?g|gif|webp|mp4|mov)(?:$|[?#])/i;
  const sizePattern = /\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)\b/i;
  const compact = text => text.replace(/[\s\u200b\ufeff]+/g, ' ').replace(/\s*\.(?=[a-z\d]{1,8}\b)/gi, '.').trim();
  const filenameFrom = text => {
    const value = compact(text);
    const match = value.match(/(?:^|\s)([^\n]{1,140}\.(?:log|txt|zip|gz|tgz|tar|7z|rar|json|csv|xml|har|dmp|crash|pdf|docx?|xlsx?|png|jpe?g|gif|webp|mp4|mov))(?:\s|$)/i);
    return match?.[1]?.trim() || (filePattern.test(value) ? value.split(/\s+/).find(part => filePattern.test(part)) : '');
  };
  const cardFor = node => {
    let card = node;
    for (let depth = 0; depth < 8 && card && card !== root; depth++, card = card.parentElement) {
      const text = card.innerText || card.textContent || '';
      if (sizePattern.test(text) && filenameFrom(text)) return card;
      if (card.querySelector?.(downloadSelector) || card.querySelector?.('a[href]')) return card;
    }
    return null;
  };
  const cards = new Map();
  const scanNodes = [...root.querySelectorAll('.file-name,[class*="file-name" i],[data-testid*="file-name" i]'), ...root.querySelectorAll('*')];
  for (const node of scanNodes.filter(visible)) {
    const text = node.innerText || node.textContent || '';
    if (!text || text.length > 240 || (!filePattern.test(compact(text)) && !/^\.[a-z\d]{1,8}$/i.test(text.trim()))) continue;
    const card = cardFor(node);
    const name = card && filenameFrom(card.innerText || card.textContent || '');
    if (card && name && !cards.has(card)) cards.set(card, name);
  }
  for (const [card, name] of cards) {
    if (card.querySelector?.('a[href]')) continue;
    const occurrence = fileCounts.get(name) || 0;
    fileCounts.set(name, occurrence + 1);
    if (card.querySelector?.(downloadSelector) || card.querySelector?.('[role="button"]') || card.tagName === 'BUTTON') {
      if (!nativeAttachments.some(item => item.name === name)) nativeAttachments.push({ name, occurrence: 0, kind: 'native-attachment' });
    } else if (!unresolvedAttachments.some(item => item.name === name)) {
      unresolvedAttachments.push({ name, reason: '页面未提供可识别的下载按钮或下载链接。' });
    }
  }
  return {
    issueKey: [...root.querySelectorAll('[data-clipboard-text]')].map(el => el.getAttribute('data-clipboard-text')).find(value => /^[A-Z][A-Z0-9]{0,31}-\d+$/.test(value)) || root.innerText.match(/\b[A-Z][A-Z0-9]{0,31}-\d+\b/)?.[0] || '',
    title: root.querySelector('[data-role="object-content"] [contenteditable]')?.textContent.trim() || document.title,
    url: location.href,
    capturedAt: new Date().toISOString(),
    scope: root === document.body ? 'whole-page' : root === detail ? 'teambition-detail' : 'visible-dialog',
    text: root.innerText,
    assets: [...candidates.values()],
    unresolvedAttachments,
    nativeAttachments,
    limitations: [
      '仅提取当前已加载且可见的 DOM 文本、评论附件和 img/a 链接；未加载、折叠、虚拟滚动、iframe、canvas、CSS 背景图片可能遗漏。',
      '图片可能是缩略图；下载完成仅表示 Chrome 完成传输，仍需确认文件不是登录页或错误页。',
      '日志仅指问题单中可下载的日志附件或可见日志文本，不会自动收集应用运行日志。'
    ]
  };
})()
