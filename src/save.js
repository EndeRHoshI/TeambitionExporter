import { storeDirectory } from './directory-store.js';
const button = document.getElementById('save');
const status = document.getElementById('status');
const token = new URL(location.href).searchParams.get('token');
let exporting = false;
const progressArea = document.getElementById('progress-area');
const progressBar = document.getElementById('progress');
const progressLabel = document.getElementById('progress-label');
function renderProgress(percent, label) {
  progressArea.hidden = false;
  if (Number.isFinite(percent)) progressBar.value = Math.max(0, Math.min(100, percent));
  else progressBar.removeAttribute('value');
  progressLabel.textContent = label;
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!exporting || sender.id !== chrome.runtime.id || message.type !== 'export-progress' || message.token !== token) return;
  status.textContent = message.text;
  renderProgress(message.percent, message.phase === 'download' ? `当前附件下载进度${message.percent == null ? '：总大小未知' : '：' + message.percent + '%'}` : message.phase === 'wait' ? '等待页面返回下载地址' : message.phase === 'save' ? `文件保存进度：${message.percent}%` : '正在准备，请稍候…');
});
button.disabled = false;
status.textContent = '选择目录后开始导出。';
document.getElementById('settings').onclick = event => { event.preventDefault(); chrome.runtime.openOptionsPage(); };
button.onclick = async () => {
  button.disabled = true;
  try {
    window.focus();
    status.textContent = '请在系统目录选择窗口中选好目录；若 Chrome 随后询问查看或修改权限，请点允许。';
    // Keep the picker immediately inside the user gesture, before any await.
    const handle = await showDirectoryPicker({ id: 'teambition-save-directory', mode: 'readwrite', startIn: 'documents' });
    await storeDirectory({ handle });
    status.textContent = '正在导出，请保留此窗口和原问题单页面…';
    exporting = true;
    renderProgress(null, '正在读取问题单…');
    const result = await chrome.runtime.sendMessage({ type: 'start-selected-export', token });
    if (!result || result.error) throw new Error(result?.error || '导出没有返回结果');
    exporting = false;
    renderProgress(100, '');
    status.textContent = `${result.incomplete ? '已保存，但部分附件缺失' : '导出完成'}\n${result.displayPath}\n请到所选目录中查看文件，可以关闭此窗口。`;
    button.textContent = '关闭';
    button.onclick = () => window.close();
  } catch (error) {
    exporting = false;
    progressArea.hidden = true;
    status.textContent = error.name === 'AbortError' ? '已取消，未开始导出。可以重新选择目录。' : '未完成：' + error.message;
  } finally { button.disabled = false; }
};
