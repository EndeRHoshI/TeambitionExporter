import { buildArchive } from './build-archive.js';
import { loadDirectory, checkDirectory, saveExport } from './directory-store.js';
const rpc = async (type, values = {}) => {
  const result = await chrome.runtime.sendMessage({ target: 'worker', type, ...values });
  if (result?.error) throw new Error(result.error);
  return result;
};
let busy = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen' || message.type !== 'run-export' || sender.id !== chrome.runtime.id) return;
  if (busy) { respond({ error: '已有后台导出正在进行' }); return; }
  busy = true;
  const job = message.job;
  const log = (event, details = {}, level = 'info') => rpc('runner-log', { job, event, details, level });
  const heartbeat = setInterval(() => { void rpc('runner-heartbeat', { job }).catch(() => {}); }, 20000);
  (async () => {
    const config = await checkDirectory(await loadDirectory(), log);
    await log('directory.ready', { name: config.handle.name, configuredPath: config.rootPath });
    const archive = await buildArchive(message.snapshot, {
      log,
      async progress(text, badge, details = {}) { await rpc('runner-progress', { job, text, ...details }); },
      async resolveNative(index) {
        const response = await rpc('resolve-native-download', { job, index });
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          const state = await rpc('runner-route', { job });
          if (!state || state.token !== response.token) throw new Error('附件下载跟踪已失效');
          if (state.status === 'failed') throw new Error(state.error);
          if (state.status === 'resolved') return state.url;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('没有捕获到附件地址，请保留原问题单');
      },
      diagnostics: () => rpc('runner-diagnostics', { job })
    });
    await rpc('runner-progress', { job, text: '正在写入已授权的导出目录', badge: '保存' });
    const saved = await saveExport(config, message.snapshot.issueKey, archive, async (done, total, name) => {
      await rpc('runner-progress', { job, text: `保存文件 ${done}/${total}：${name}`, percent: total ? Math.floor(done / total * 100) : 0, phase: 'save' });
    });
    await log('archive.saved', saved);
    let copied = false;
    try {
      if (!saved.path) {
        await log('clipboard.path-not-configured', { relativePath: saved.relativePath });
        return { ...saved, copied: false, incomplete: archive.incomplete, successful: archive.successful, failed: archive.failed };
      }
      const input = document.getElementById('clipboard'); input.value = saved.path; input.select();
      copied = document.execCommand('copy');
      if (!copied) throw new Error('后台剪贴板写入未成功');
      await log('clipboard.path-copied', { path: saved.path });
    } catch (error) { await log('clipboard.failed', { message: error.message }, 'warn'); }
    return { ...saved, copied, incomplete: archive.incomplete, successful: archive.successful, failed: archive.failed };
  })().then(respond, async error => {
    await log('export.failed', { message: error.message, code: error.code, stack: error.stack }, 'error').catch(() => {});
    respond({ error: error.message, code: error.code });
  }).finally(() => { clearInterval(heartbeat); busy = false; });
  return true;
});
