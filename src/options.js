import { loadDirectory, storeDirectory } from './directory-store.js';
import { readDiagnostics } from './diagnostics.js';
const $ = id => document.getElementById(id);
let last;
function message(text) { $('message').textContent = text; }
async function showCopyPath() {
  const config = await loadDirectory();
  $('root-path').value = config?.rootPath || '';
}
$('save-path').addEventListener('click', async () => {
  try {
    const config = await loadDirectory();
    if (!config?.handle) throw new Error('请先点击插件图标，在导出窗口选择一次目录，再来填写复制路径');
    const rootPath = $('root-path').value.trim().replace(/\/+$/, '');
    if (rootPath && (!rootPath.startsWith('/') || rootPath.split('/').pop() !== config.handle.name)) throw new Error(`请填写与最近选择的目录“${config.handle.name}”一致的绝对路径`);
    await storeDirectory({ ...config, rootPath });
    await showCopyPath();
    message(rootPath ? '复制路径已保存；每次导出的实际保存位置仍由目录选择器决定。' : '已关闭自动复制绝对路径，仍可正常导出。');
  } catch (error) { message(error.message); }
});
async function refresh() {
  last = (await chrome.storage.local.get('lastExport')).lastExport;
  $('last').textContent = !last ? '尚无导出记录' : last.error || `${last.status === 'running' ? '正在后台导出' : last.status === 'partial' ? '已保存，但有附件缺失' : '已保存'}\n${last.path || last.displayPath || ''}${last.path ? '' : '\n未填写绝对路径也不影响保存；可选填后用于后续自动复制路径。'}`;
  $('copy-path').disabled = !last?.path;
  $('logs').value = last?.job ? JSON.stringify(await readDiagnostics(last.job), null, 2) : '没有诊断日志';
}
$('refresh').addEventListener('click', () => { void refresh().catch(e => message(e.message)); });
$('copy-path').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(last.path); message('文件夹路径已复制'); } catch (error) { message(error.message); }
});
$('copy-log').addEventListener('click', async () => {
  await refresh();
  try { await navigator.clipboard.writeText($('logs').value); message('诊断信息已复制'); }
  catch { $('logs').select(); message('请按 Command+C 复制选中的诊断信息'); }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.lastExport) void refresh().catch(() => {}); });
Promise.all([showCopyPath(), refresh()]).catch(e => message(e.message));
