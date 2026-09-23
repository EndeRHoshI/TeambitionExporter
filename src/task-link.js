// Serialized into the page's MAIN world. Keep this function self-contained.
export async function captureTaskLink() {
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const root = [...document.querySelectorAll('#root-detail')].filter(visible).at(-1);
  if (!root) throw new Error('未找到当前问题单详情');
  const issueKey = [...root.querySelectorAll('[data-clipboard-text]')]
    .map(el => el.getAttribute('data-clipboard-text')).find(text => /^[A-Z][A-Z0-9]*-\d+$/.test(text || ''));
  if (!issueKey) throw new Error('未找到当前问题单编号');
  // Confirmed in the user's DevTools: header > action-bar > button > i.next-icon-link.
  const buttons = [...new Set([...root.querySelectorAll('[class*="action-bar"] .next-icon-link')]
    .filter(visible).map(icon => icon.closest('button')).filter(Boolean))];
  if (buttons.length !== 1) throw new Error('无法唯一定位当前问题单的复制链接按钮');
  const normalize = value => {
    try {
      const url = new URL(String(value).trim());
      if (url.protocol !== 'https:' || !['www.teambition.com', 'teambition.com'].includes(url.hostname)) return '';
      const id = url.pathname.match(/(?:^|\/)task\/([a-f\d]{24})\/?$/i)?.[1];
      return id ? `${url.origin}/task/${id}` : '';
    } catch { return ''; }
  };
  let captured = '', method = '';
  const accept = (text, via) => { const url = normalize(text); if (url) { captured = url; method = via; } return Boolean(url); };
  const restore = [];
  const patch = (object, key, replacement) => {
    if (!object) return;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    try {
      Object.defineProperty(object, key, { configurable: true, writable: true, value: replacement });
      restore.push(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key]; });
    } catch {}
  };
  const clipboard = navigator.clipboard;
  const writeText = clipboard?.writeText;
  if (writeText) patch(clipboard, 'writeText', function(text) {
    if (accept(text, 'writeText')) return Promise.resolve();
    return writeText.call(this, text);
  });
  const execCommand = document.execCommand;
  if (execCommand) patch(document, 'execCommand', function(command, ...args) {
    if (String(command).toLowerCase() === 'copy') {
      const active = document.activeElement;
      const text = active && ['TEXTAREA', 'INPUT'].includes(active.tagName)
        ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? active.value.length)
        : document.getSelection()?.toString();
      if (accept(text, 'execCommand')) return true;
    }
    return execCommand.call(this, command, ...args);
  });
  // Read only data produced by this click, after application copy handlers ran.
  const onCopy = event => { queueMicrotask(() => accept(event.clipboardData?.getData('text/plain'), 'copy-event')); };
  document.addEventListener('copy', onCopy, true);
  try {
    buttons[0].click();
    const deadline = Date.now() + 2000;
    while (!captured && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (!captured) throw new Error('已点击复制链接按钮，但未捕获到任务地址');
    return { url: captured, issueKey, method };
  } finally {
    document.removeEventListener('copy', onCopy, true);
    for (const undo of restore.reverse()) undo();
  }
}
