import { readDiagnostics } from './diagnostics.js';
const $ = id => document.getElementById(id);
let last;
function message(text) { $('message').textContent = text; }
async function refresh() {
  last = (await chrome.storage.local.get('lastExport')).lastExport;
  $('last').textContent = !last ? '尚无导出记录' : last.error || `${last.status === 'running' ? '正在后台导出' : last.status === 'partial' ? '已保存，但有附件缺失' : '已保存'}\n${last.displayPath || last.relativePath || ''}`;
  $('logs').value = last?.job ? JSON.stringify(await readDiagnostics(last.job), null, 2) : '没有诊断日志';
}
$('refresh').addEventListener('click', () => { void refresh().catch(e => message(e.message)); });
$('copy-log').addEventListener('click', async () => {
  await refresh();
  try { await navigator.clipboard.writeText($('logs').value); message('诊断信息已复制'); }
  catch { $('logs').select(); message('请按 Command+C 复制选中的诊断信息'); }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.lastExport) void refresh().catch(() => {}); });
refresh().catch(e => message(e.message));
