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
  const unresolvedAttachments = [...root.querySelectorAll('.file-content')]
    .filter(visible)
    .filter(el => !el.querySelector('a[href]'))
    .map(el => {
      const name = el.querySelector('.file-name')?.textContent.trim() || el.innerText.trim();
      const occurrence = fileCounts.get(name) || 0;
      fileCounts.set(name, occurrence + 1);
      if (root === detail && name && el.querySelector('.next-icon-download')) {
        nativeAttachments.push({ name, occurrence, kind: 'native-attachment' });
        return null;
      }
      return { name, reason: '页面未提供可识别的下载按钮或下载链接。' };
    }).filter(Boolean);
  const commentText = root.innerText.includes('所有动态') ? root.innerText.split('所有动态').slice(1).join('所有动态') : '';
  const commentLines = commentText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const manualCommentAttachments = [];
  for (let i = 0; i < commentLines.length; i++) {
    const line = commentLines[i];
    const joined = line + ((/^\.[a-z\d]{1,8}$/i.test(commentLines[i + 1] || '')) ? commentLines[++i] : '');
    const match = joined.match(/([^\n]{1,120}\.(?:log|txt|zip|gz|tgz|tar|7z|rar|json|csv|xml|har|dmp|crash|pdf|docx?|xlsx?|png|jpe?g|gif|webp|mp4|mov))$/i);
    const name = match?.[1]?.trim().replace(/\s+/g, ' ');
    if (name && !manualCommentAttachments.includes(name) && !nativeAttachments.some(a => a.name === name)) manualCommentAttachments.push(name);
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
    manualCommentAttachments,
    limitations: [
      '仅提取当前已加载的 DOM 文本和 img/a 链接；未加载、折叠、虚拟滚动、iframe、canvas、CSS 背景图片和仅由按钮触发的附件可能遗漏。',
      '图片可能是缩略图；下载完成仅表示 Chrome 完成传输，仍需确认文件不是登录页或错误页。',
      '日志仅指问题单中可下载的日志附件或可见日志文本，不会自动收集应用运行日志。'
    ]
  };
})()
