(() => {
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')]
    .filter(el => visible(el) && el.innerText.trim().length > 80);
  const detail = [...document.querySelectorAll('#root-detail')].filter(visible).at(-1);
  const root = detail && visible(detail) ? detail : dialogs.at(-1) || document.body;
  const candidates = new Map();
  const filePattern = /\.(?:log|txt|zip|gz|tgz|tar|7z|rar|json|csv|xml|har|dmp|crash|pdf|docx?|xlsx?|png|jpe?g|gif|webp|mp4|mov)(?:$|[?#])/i;
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
  // Teambition renders issue-detail files and comment files with different class names.
  // Start from visible filename nodes, then walk up to the smallest card with a download control.
  const downloadSelector = '.next-icon-download,[aria-label*="下载" i],[title*="下载" i],[data-testid*="download" i],button[download]';
  const fileNameNodes = [...root.querySelectorAll('.file-name,[class*="file-name" i],[data-testid*="file-name" i]')].filter(visible);
  const fallbackNodes = [...root.querySelectorAll('*')].filter(el => visible(el) && el.children.length === 0 && filePattern.test(el.textContent.trim()) && el.textContent.trim().length < 160);
  const cards = new Map();
  for (const node of [...fileNameNodes, ...fallbackNodes]) {
    const name = (node.textContent || '').trim().split(/\n/)[0].trim();
    if (!name || !filePattern.test(name)) continue;
    let card = node;
    for (let depth = 0; depth < 6 && card && card !== root; depth++, card = card.parentElement) {
      if (card.querySelector?.(downloadSelector) || card.querySelector?.('a[href]')) break;
    }
    if (!card || card === root || cards.has(card)) continue;
    cards.set(card, name);
  }
  for (const [card, name] of cards) {
    if (card.querySelector?.('a[href]')) continue;
    const occurrence = fileCounts.get(name) || 0;
    fileCounts.set(name, occurrence + 1);
    const hasDownload = Boolean(card.querySelector?.(downloadSelector));
    if (name && hasDownload) nativeAttachments.push({ name, occurrence, kind: 'native-attachment' });
    else unresolvedAttachments.push({ name, reason: '页面未提供可识别的下载按钮或下载链接。' });
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
