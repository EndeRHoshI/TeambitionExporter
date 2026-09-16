import { loadDirectory, storeDirectory } from './directory-store.js';
const button = document.getElementById('save');
const status = document.getElementById('status');
const token = new URL(location.href).searchParams.get('token');
let previous;
loadDirectory().then(config => { previous = config; }).catch(() => {}).finally(() => {
  button.disabled = false;
  status.textContent = '每次选择目录即可，无需提前到选项中重新授权。';
});
document.getElementById('settings').onclick = event => { event.preventDefault(); chrome.runtime.openOptionsPage(); };
button.onclick = async () => {
  button.disabled = true;
  try {
    window.focus();
    status.textContent = '请在系统目录选择窗口中选好目录；若 Chrome 随后询问查看或修改权限，请点允许。';
    // Keep the picker immediately inside the user gesture, before any await.
    const handle = await showDirectoryPicker({ id: 'teambition-save-directory', mode: 'readwrite', startIn: 'documents' });
    const same = previous?.handle ? await handle.isSameEntry(previous.handle).catch(() => false) : false;
    await storeDirectory({ handle, rootPath: same ? previous.rootPath || '' : '' });
    previous = { handle, rootPath: same ? previous.rootPath || '' : '' };
    status.textContent = '正在导出，请保留此窗口和原问题单页面…';
    const result = await chrome.runtime.sendMessage({ type: 'start-selected-export', token });
    if (!result || result.error) throw new Error(result?.error || '导出没有返回结果');
    status.textContent = `${result.incomplete ? '已保存，但部分附件缺失' : '导出完成'}\n${result.path || result.displayPath}\n${result.path ? '点击下方按钮，复制文件夹路径并关闭窗口。' : '未设置父目录绝对路径，无法复制完整路径；文件已保存，可以关闭窗口。'}`;
    button.textContent = result.path ? '复制路径并关闭' : '关闭';
    button.onclick = async () => {
      if (!result.path) { window.close(); return; }
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(result.path);
        window.close();
      } catch (error) {
        status.textContent = `文件已保存，但复制路径失败：${error.message}\n${result.path}\n请重试，或手动复制上方路径。`;
      } finally { button.disabled = false; }
    };
  } catch (error) {
    status.textContent = error.name === 'AbortError' ? '已取消，未开始导出。可以重新选择目录。' : '未完成：' + error.message;
  } finally { button.disabled = false; }
};
