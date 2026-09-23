import { captureTaskLink } from './task-link.js';
import { resetFeedback, finishFeedback, installFeedbackHandlers } from './feedback.js';
import { ROUTE_KEY, matchesDownload } from './download-match.js';
import { logEvent, readDiagnostics } from './diagnostics.js';

installFeedbackHandlers();

const preparedKey = url => `prepared-download:${url}`;
let routing = Promise.resolve();
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  routing = routing.catch(() => {}).then(async () => {
    let pending;
    let suggested = false;
    const finish = value => { if (!suggested) { suggested = true; suggest(value); } };
    try {
      const key = preparedKey(item.url);
      const prepared = (await chrome.storage.session.get(key))[key];
      // Always explicitly suggest our requested name; a bare suggest() can discard it.
      if (prepared && prepared.expires > Date.now()) {
        finish({ filename: prepared.filename, conflictAction: 'uniquify' });
        await logEvent(prepared.job, 'background', 'archive.filename-applied', { filename: prepared.filename, downloadId: item.id });
        return;
      }
      pending = (await chrome.storage.session.get(ROUTE_KEY))[ROUTE_KEY];
      if (!matchesDownload(item, pending)) {
        finish();
        if (pending?.job && pending.downloadId == null && pending.expires > Date.now()) {
          await logEvent(pending.job, 'background', 'native.not-matched', {
            actualName: String(item.filename || '').split(/[/\\]/).pop(), expectedName: pending.expectedName,
            url: item.finalUrl || item.url, referrer: item.referrer, startTime: item.startTime
          }, 'warn');
        }
        return;
      }
      // Cancel before releasing the filename callback: no individual attachment is saved.
      // The extension fetches the signed URL into memory and includes it in one ZIP.
      await chrome.downloads.cancel(item.id);
      const url = item.finalUrl || item.url;
      if (!/^https:\/\//.test(url)) throw new Error('附件返回的下载地址不是 HTTPS，无法打包');
      await chrome.storage.session.set({ [ROUTE_KEY]: { ...pending, downloadId: item.id, status: 'resolved', url, mime: item.mime } });
      finish();
      await logEvent(pending.job, 'background', 'native.url-captured', { downloadId: item.id, name: pending.expectedName, url });
    } catch (error) {
      if (pending?.job) {
        await chrome.storage.session.set({ [ROUTE_KEY]: { ...pending, status: 'failed', error: error.message } }).catch(() => {});
        await logEvent(pending.job, 'background', 'download.routing-failed', { message: error.message }, 'error');
      }
      finish();
    }
  });
  return true;
});

let starting = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'start-selected-export') {
    if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('src/save.html')) return;
    (async () => {
      const pending = (await chrome.storage.session.get('pendingSave')).pendingSave;
      if (!pending || pending.token !== message.token) throw new Error('保存窗口已失效，请重新点击插件图标');
      return exportTab(await chrome.tabs.get(pending.tabId), pending.token);
    })().then(respond, error => respond({ error: error.message }));
    return true;
  }

  const trusted = ['src/exporter.html', 'src/offscreen.html'].some(path => sender.url?.startsWith(chrome.runtime.getURL(path)));
  if (sender.id !== chrome.runtime.id || !trusted || message.target === 'offscreen') return;
  if (message.type.startsWith('runner-')) {
    (async () => {
      if (message.type === 'runner-log') { await logEvent(message.job, 'offscreen', message.event, message.details, message.level); return { ok: true }; }
      if (message.type === 'runner-diagnostics') return readDiagnostics(message.job);
      if (message.type === 'runner-route') return (await chrome.storage.session.get(ROUTE_KEY))[ROUTE_KEY];
      if (message.type === 'runner-heartbeat') {
        const active = (await chrome.storage.session.get('activeExport')).activeExport;
        if (active?.job === message.job) await chrome.storage.session.set({ activeExport: { ...active, expires: Date.now() + 60000 } }); return { ok: true };
      }
      if (message.type === 'runner-progress') {
        const active = (await chrome.storage.session.get('activeExport')).activeExport;
        if (active?.job !== message.job) return { ok: true };
        await chrome.action.setTitle({ title: message.text });
        if (active.progressToken) await chrome.runtime.sendMessage({ type: 'export-progress', token: active.progressToken, text: message.text, percent: message.percent ?? null, phase: message.phase }).catch(() => {});
        return { ok: true };
      }
      throw new Error('未知后台请求');
    })().then(respond, error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'prepare-download' || message.type === 'forget-download') {
    (async () => {
      if (!message.url?.startsWith(`blob:${chrome.runtime.getURL('')}`)) throw new Error('无效的本地下载地址');
      const key = preparedKey(message.url);
      if (message.type === 'forget-download') { await chrome.storage.session.remove(key); return { ok: true }; }
      if (!/^[A-Z][A-Z0-9]{0,31}-\d+\/[^/\\]+\.(zip|json)$/.test(message.filename) || message.filename.includes('..')) throw new Error('无效的归档文件名');
      await chrome.storage.session.set({ [key]: { filename: message.filename, job: message.job, expires: Date.now() + 30 * 60 * 1000 } });
      return { ok: true };
    })().then(respond, error => respond({ error: error.message }));
    return true;
  }
  if (message.type !== 'resolve-native-download') return;
  if (starting) { respond({ error: '另一项日志附件正在准备，请稍后重试。' }); return; }
  starting = true;
  (async () => {
    await logEvent(message.job, 'background', 'native.request', { index: message.index });
    const entry = (await chrome.storage.session.get(message.job))[message.job];
    const asset = entry?.data?.nativeAttachments?.[message.index];
    if (!asset || !entry.tabId) throw new Error('原问题单快照失效，请重新点击插件。');
    const old = (await chrome.storage.session.get(ROUTE_KEY))[ROUTE_KEY];
    if (old && old.expires > Date.now() && old.downloadId == null && old.status !== 'failed') throw new Error('另一项附件正在等待响应。');
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ [ROUTE_KEY]: {
      token, job: message.job, expectedName: asset.name, sourceUrl: entry.data.url,
      startedAt: Date.now(), expires: Date.now() + 45000, downloadId: null, extensionId: chrome.runtime.id, status: 'waiting'
    } });
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: entry.tabId }, args: [entry.data.url, entry.data.issueKey, asset.name, asset.occurrence],
        func: (sourceUrl, expectedIssueKey, expectedName, occurrence) => {
          if (location.href !== sourceUrl) throw new Error('原问题单页面已切换，请重新提取。');
          const root = [...document.querySelectorAll('#root-detail')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').at(-1);
          const issueKey = root && ([...root.querySelectorAll('[data-clipboard-text]')].map(el => el.getAttribute('data-clipboard-text')).find(value => /^[A-Z][A-Z0-9]{0,31}-\d+$/.test(value)) || root.innerText.match(/\b[A-Z][A-Z0-9]{0,31}-\d+\b/)?.[0]);
          if (!root || issueKey !== expectedIssueKey) throw new Error('已切换到另一条问题单，请重新点击插件导出。');
          const files = [...root.querySelectorAll('.file-content')]
            .filter(el => el.querySelector('.file-name')?.textContent.trim() === expectedName);
          const button = files[occurrence]?.querySelector('.next-icon-download');
          if (!button) throw new Error('没有找到对应附件的下载按钮');
          button.click();
          return true;
        }
      });
      if (!result[0]?.result) throw new Error('未能触发附件下载');
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

let creatingOffscreen;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL('src/offscreen.html');
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (contexts.length) return;
  if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({ url: 'src/offscreen.html', reasons: ['BLOBS'], justification: '收集问题单文件、写入本次选择的目录。' }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}
let actionBusy = false;
export async function exportTab(tab, progressToken = null) {
  if (!tab.id || actionBusy) return { error: '已有导出正在进行，请稍候' };
  actionBusy = true;
  const job = crypto.randomUUID();
  let ownsJob = false;
  try {
    const active = (await chrome.storage.session.get('activeExport')).activeExport;
    if (active && active.expires > Date.now()) { await chrome.action.setTitle({ title: '已有导出正在后台进行，请稍候' }); return; }
    await resetFeedback();
    await chrome.storage.session.set({ activeExport: { job, progressToken, expires: Date.now() + 60000 } }); ownsJob = true;
    await chrome.storage.local.set({ lastExport: { job, status: 'running', startedAt: new Date().toISOString() } });
    await chrome.action.setTitle({ title: '正在读取问题单' });
    await logEvent(job, 'background', 'extract.start', { sourceUrl: tab.url, sourceTabId: tab.id });
    const url = new URL(tab.url);
    if (url.protocol !== 'https:' || !['www.teambition.com', 'teambition.com'].includes(url.hostname)) throw new Error('请在 Teambition 网页中打开问题单详情，再点击插件');
    let data;
    if (/\/bug\/section\/all\/?$/.test(url.pathname)) {
      const links = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: captureTaskLink
      });
      const link = links[0]?.result;
      if (!link || !/^https:\/\/(?:www\.)?teambition\.com\/task\/[a-f\d]{24}$/i.test(link.url)) throw new Error('未取得有效任务链接');
      await logEvent(job, 'background', 'task-link.captured', { issueKey: link.issueKey, method: link.method });
      await chrome.tabs.update(tab.id, { url: link.url });
      // Chrome's load event does not mean the SPA detail has rendered yet.
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/extractor.js'] });
          const snapshot = results[0]?.result;
          if (snapshot?.scope === 'teambition-detail' && snapshot.issueKey === link.issueKey &&
              /\/task\/[a-f\d]{24}\/?$/i.test(new URL(snapshot.url).pathname) && snapshot.text?.trim()) {
            data = snapshot;
            break;
          }
        } catch { /* Navigation can destroy the old document mid-injection. */ }
      }
      if (!data) throw new Error('任务链接已打开，但对应问题详情尚未加载完成');
    } else {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/extractor.js'] });
      data = results[0]?.result;
    }
    if (data?.scope !== 'teambition-detail' || !/^[A-Z][A-Z0-9]{0,31}-\d+$/.test(data.issueKey || '') || !data.text?.trim()) throw new Error('当前页面没有打开可识别的问题单详情，请点击一条问题单并等待内容加载');
    await chrome.storage.session.set({ [job]: { data, tabId: tab.id } });
    await logEvent(job, 'background', 'extract.complete', { issueKey: data.issueKey, assets: data.assets.length, nativeAttachments: data.nativeAttachments?.length || 0 });
    await ensureOffscreen();
    const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'run-export', job, snapshot: data });
    if (!result || result.error) throw Object.assign(new Error(result?.error || '后台导出没有返回结果'), { code: result?.code });
    await logEvent(job, 'background', 'export.complete', result);
    await chrome.storage.local.set({ lastExport: { job, status: result.incomplete ? 'partial' : 'complete', ...result, finishedAt: new Date().toISOString() } });
    await finishFeedback(job, {
      tabId: tab.id,
      badge: result.incomplete ? '缺件' : '完成', color: result.incomplete ? '#b45309' : '#15803d', partial: result.incomplete,
      title: `已保存：${result.displayPath}，请到所选目录中查看。`
    });
    return result;
  } catch (error) {
    await logEvent(job, 'background', 'export.failed', { message: error.message, code: error.code, stack: error.stack }, 'error');
    await chrome.storage.local.set({ lastExport: { job, status: 'failed', error: error.message, code: error.code, finishedAt: new Date().toISOString() } });
    await finishFeedback(job, {
      tabId: tab.id,
      badge: error.code === 'DIRECTORY_REQUIRED' ? '设置' : '失败', color: '#b91c1c', error: error.message,
      title: `${error.message}。点击通知或右键图标打开选项查看详情。`
    });
    return { error: error.message };
  } finally {
    if (ownsJob) await chrome.storage.session.remove('activeExport');
    actionBusy = false;
  }
}

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try {
    const previous = (await chrome.storage.session.get('pendingSave')).pendingSave;
    if (previous?.windowId) {
      try { await chrome.windows.update(previous.windowId, { focused: true }); return; } catch {}
    }
    if (actionBusy) return;
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ pendingSave: { token, tabId: tab.id } });
    const parent = await chrome.windows.get(tab.windowId);
    const width = Math.min(520, parent.width || 520);
    const height = Math.min(480, parent.height || 480);
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL('src/save.html?token=' + token), type: 'popup', focused: true,
      width, height,
      left: Math.round((parent.left || 0) + ((parent.width || width) - width) / 2),
      top: Math.round((parent.top || 0) + ((parent.height || height) - height) / 2)
    });
    await chrome.storage.session.set({ pendingSave: { token, tabId: tab.id, windowId: window.id } });
  } catch (error) { await chrome.action.setTitle({ title: '无法打开保存窗口：' + error.message }); }
});
