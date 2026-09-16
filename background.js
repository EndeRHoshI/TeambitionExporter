import { ROUTE_KEY, matchesDownload } from './download-match.js';
import { logEvent } from './diagnostics.js';

// Registered at worker startup so Chrome can wake the MV3 worker for a download.
let routing = Promise.resolve();
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  routing = routing.catch(() => {}).then(async () => {
    let pending;
    try {
      pending = (await chrome.storage.session.get(ROUTE_KEY))[ROUTE_KEY];
      if (!matchesDownload(item, pending)) {
        suggest();
        if (pending?.job && pending.downloadId == null && pending.expires > Date.now()) {
          await logEvent(pending.job, 'background', 'download.not-matched', {
            downloadId: item.id,
            filenameMatches: String(item.filename || '').split(/[/\\]/).pop() === pending.expectedName,
            actualName: String(item.filename || '').split(/[/\\]/).pop(), expectedName: pending.expectedName,
            url: item.finalUrl || item.url, referrer: item.referrer,
            hasReferrer: Boolean(item.referrer), initiatedByExtension: Boolean(item.byExtensionId),
            startTime: item.startTime
          }, 'warn');
        }
        return;
      }
      await chrome.storage.session.set({ [ROUTE_KEY]: { ...pending, downloadId: item.id } });
      suggest({ filename: pending.filename, conflictAction: 'uniquify' });
      await logEvent(pending.job, 'background', 'download.matched', { downloadId: item.id, filename: pending.filename, url: item.finalUrl || item.url, referrer: item.referrer });
    } catch (error) {
      suggest();
      await logEvent(pending?.job, 'background', 'download.routing-failed', { message: error.message }, 'error');
    }
  });
  return true;
});

let starting = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'start-native-download') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('exporter.html'))) return;
  if (starting) { respond({ error: '另一项日志下载正在启动，请稍后重试。' }); return; }
  starting = true;
  (async () => {
    await logEvent(message.job, 'background', 'native.request', { index: message.index, filename: message.filename });
    const entry = (await chrome.storage.session.get(message.job))[message.job];
    const asset = entry?.data?.nativeAttachments?.[message.index];
    if (!asset || !entry.tabId) throw new Error('原问题单快照失效，请重新点击插件。');
    if (!/^Teambition\/[\w-]+\/assets\/[^/\\]+$/.test(message.filename) || message.filename.includes('..')) {
      throw new Error('导出路径无效');
    }
    const old = (await chrome.storage.session.get(ROUTE_KEY))[ROUTE_KEY];
    if (old && old.expires > Date.now() && old.downloadId == null) throw new Error('另一项日志下载正在等待响应。');
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ [ROUTE_KEY]: {
      token, job: message.job, expectedName: asset.name, filename: message.filename, sourceUrl: entry.data.url,
      startedAt: Date.now(), expires: Date.now() + 45000, downloadId: null, extensionId: chrome.runtime.id
    } });
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: entry.tabId },
        args: [entry.data.url, asset.name, asset.occurrence],
        func: (sourceUrl, expectedName, occurrence) => {
          if (location.href !== sourceUrl) throw new Error('原问题单页面已切换，请重新提取。');
          const files = [...document.querySelectorAll('#root-detail .file-content')]
            .filter(el => el.querySelector('.file-name')?.textContent.trim() === expectedName);
          const file = files[occurrence];
          const button = file?.querySelector('.next-icon-download');
          if (!button) throw new Error('没有找到对应的日志下载按钮，页面结构可能已变化。');
          // Only this download control is clicked; never the neighboring remove control.
          button.click();
          return true;
        }
      });
      if (!result[0]?.result) throw new Error('未能触发日志下载');
      await logEvent(message.job, 'background', 'native.button-clicked', { name: asset.name, sourceTabId: entry.tabId });
      return { token };
    } catch (error) {
      const current = (await chrome.storage.session.get(ROUTE_KEY))[ROUTE_KEY];
      if (current?.token === token) await chrome.storage.session.remove(ROUTE_KEY);
      throw error;
    }
  })().then(respond, async error => {
    await logEvent(message.job, 'background', 'native.failed', { message: error.message, stack: error.stack }, 'error');
    respond({ error: error.message });
  }).finally(() => { starting = false; });
  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const job = crypto.randomUUID();
  await logEvent(job, 'background', 'extract.start', { sourceUrl: tab.url, sourceTabId: tab.id });
  try {
    const url = new URL(tab.url);
    if (url.hostname !== 'www.teambition.com' || !/\/task\/[^/]+/.test(url.pathname)) {
      throw new Error('请先在 Chrome 中登录并打开 Teambition 问题单详情。');
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ['extractor.js']
    });
    const data = results[0]?.result;
    if (!data?.text?.trim()) throw new Error('页面没有可读取的文本，请等待问题单加载后重试。');
    await chrome.storage.session.set({ [job]: { data, tabId: tab.id } });
    await logEvent(job, 'background', 'extract.complete', { scope: data.scope, textLength: data.text.length, assets: data.assets.length, nativeAttachments: data.nativeAttachments?.length || 0, unresolvedAttachments: data.unresolvedAttachments?.length || 0 });
  } catch (error) {
    await chrome.storage.session.set({ [job]: { error: error.message } });
    await logEvent(job, 'background', 'extract.failed', { message: error.message, stack: error.stack }, 'error');
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`exporter.html?job=${job}&auto=1`) });
});
