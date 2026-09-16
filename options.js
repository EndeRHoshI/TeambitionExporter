import { loadDirectory, storeDirectory } from './directory-store.js';
import { readDiagnostics } from './diagnostics.js';
const $ = id => document.getElementById(id);
let config, last, selectedHandle;
function message(text) { $('message').textContent = text; }
async function showDirectory() {
  config = await loadDirectory();
  if (!config) { $('folder').textContent = '请选择任意可授权的保存目录。'; return; }
  const permission = await config.handle.queryPermission({ mode: 'readwrite' });
  $('folder').textContent = `保存父目录：${config.handle.name}；${permission === 'granted' ? '已授权' : '需要重新授权'}`;
  $('root-path').value = config.rootPath || '';
}
async function saveConfig(handle) {
  const rootPath = $('root-path').value.trim().replace(/\/+$/, '');
  if (rootPath && (!rootPath.startsWith('/') || rootPath.split('/').pop() !== handle.name)) throw new Error('请填写与所选文件夹名称一致的绝对路径');
  await storeDirectory({ handle, rootPath }); await showDirectory();
  message(rootPath ? '复制路径已保存；实际保存位置仍由上方所选目录决定。' : '已保存设置，不自动复制绝对路径；仍可正常导出。');
}
$('choose').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ id: 'teambition-save-directory', ...(config?.handle ? { startIn: config.handle } : {}), mode: 'readwrite' });
    const sameDirectory = config?.handle ? await handle.isSameEntry(config.handle) : false;
    if (!sameDirectory) $('root-path').value = '';
    selectedHandle = handle;
    $('folder').textContent = `已选择：${handle.name}。已授权，保存后即可导出。绝对路径可以不填。`;
    await saveConfig(handle);
  } catch (error) { message(error.name === 'AbortError' || error.name === 'NotAllowedError' ? '未完成目录授权，请选择另一个可授权目录或子文件夹。' : error.message); }
});
$('renew').addEventListener('click', async () => {
  try {
    if (!config) throw new Error('请先选择保存目录');
    const permission = await config.handle.requestPermission({ mode: 'readwrite' });
    message(permission === 'granted' ? '授权成功，可以重新导出。' : '未获得写入权限'); await showDirectory();
  } catch (error) { message(error.message); }
});
$('save-path').addEventListener('click', async () => { try { const handle = selectedHandle || config?.handle; if (!handle) throw new Error('请先选择文件夹'); await saveConfig(handle); } catch (error) { message(error.message); } });
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
Promise.all([showDirectory(), refresh()]).catch(e => message(e.message));
