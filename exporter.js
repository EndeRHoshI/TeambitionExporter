import { logEvent, readDiagnostics, diagnosticPrefix } from './diagnostics.js';

const $ = id => document.getElementById(id);
let snapshot;
let absolutePath = '';
const job = new URL(location.href).searchParams.get('job');
const log = (event, details, level) => logEvent(job, 'export-page', event, details, level);
let diagnosticFolder = '';
let refreshQueue = Promise.resolve();
function refreshDiagnostics() {
  refreshQueue = refreshQueue.catch(() => {}).then(async () => {
    const report = await readDiagnostics(job);
    $('diagnostics-text').value = JSON.stringify(report, null, 2);
    $('diagnostics-summary').textContent = `排查日志（${report.events.length} 条）`;
  });
  return refreshQueue;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && Object.keys(changes).some(key => key.startsWith(diagnosticPrefix(job)))) void refreshDiagnostics();
});
window.addEventListener('error', event => { void log('page.error', { message: event.message, stack: event.error?.stack }, 'error'); });
window.addEventListener('unhandledrejection', event => { void log('page.unhandled-rejection', { message: event.reason?.message || String(event.reason), stack: event.reason?.stack }, 'error'); });

async function saveDiagnostics() {
  await log('diagnostics.save-start', { folder: diagnosticFolder });
  const report = await readDiagnostics(job);
  const filename = diagnosticFolder ? `${diagnosticFolder}/debug-log.json` : `Teambition/diagnostics-${job}.json`;
  const item = await saveText(JSON.stringify(report, null, 2), filename, 'application/json');
  $('diagnostics-status').textContent = `排查日志已保存：${item.filename}`;
  return item;
}
$('copy-diagnostics').addEventListener('click', async () => {
  await refreshDiagnostics();
  try {
    await navigator.clipboard.writeText($('diagnostics-text').value);
    $('diagnostics-status').textContent = '诊断信息已复制，直接粘贴给我即可。';
  } catch {
    $('diagnostics-panel').open = true;
    $('diagnostics-text').select();
    $('diagnostics-status').textContent = '请按 Command+C（Windows 按 Ctrl+C）复制选中的诊断信息。';
  }
});
$('save-diagnostics').addEventListener('click', async () => {
  $('save-diagnostics').disabled = true;
  try { await saveDiagnostics(); }
  catch (error) {
    await log('diagnostics.save-failed', { message: error.message }, 'error');
    $('diagnostics-status').textContent = '日志文件保存失败，请点击“一键复制诊断信息”。';
  } finally { $('save-diagnostics').disabled = false; }
});
const safeName = value => (value || '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 100) || 'file';

function assetName(asset, index) {
  let tail = new URL(asset.url).pathname.split('/').pop();
  try { tail = decodeURIComponent(tail); } catch {}
  let name = /\.[a-z\d]{1,8}$/i.test(asset.name) ? asset.name : tail || asset.name;
  if (!/\.[a-z\d]{1,8}$/i.test(name || '')) name = `${name || asset.kind}.bin`;
  return `${String(index + 1).padStart(3, '0')}-${safeName(name)}`;
}

async function download(url, filename) {
  await log('download.start', { url, filename });
  const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  await log('download.created', { downloadId: id, filename });
  return waitDownload(id);
}

async function waitDownload(id) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastState = '', lastProgressAt = 0;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id });
    if (!item) throw new Error('Chrome 下载记录不可用');
    const state = `${item.state}:${item.paused}:${item.danger}:${item.error || ''}`;
    if (state !== lastState || Date.now() - lastProgressAt > 30000) {
      await log('download.state', { downloadId: id, state: item.state, paused: item.paused, danger: item.danger, error: item.error, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes, filename: item.filename, mime: item.mime }, item.state === 'interrupted' ? 'error' : 'info');
      lastState = state; lastProgressAt = Date.now();
    }
    if (item.state === 'complete') return item;
    if (item.state === 'interrupted') throw new Error(item.error || '下载中断');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await chrome.downloads.cancel(id).catch(() => {});
  await log('download.timeout', { downloadId: id }, 'error');
  throw new Error('下载超过 10 分钟，已请求取消；可能存在未完成的临时文件');
}

async function downloadNative(index, filename) {
  await log('native.start', { index, filename });
  const response = await chrome.runtime.sendMessage({ type: 'start-native-download', job, index, filename });
  if (!response || response.error) throw new Error(response?.error || '无法启动日志下载');
  await log('native.waiting-for-download', { index, filename });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const pending = (await chrome.storage.session.get('pendingNativeDownload')).pendingNativeDownload;
    if (!pending || pending.token !== response.token) throw new Error('下载跟踪已失效，请重新提取');
    if (pending.downloadId != null) {
      const item = await waitDownload(pending.downloadId);
      const actual = item.filename.replace(/\\/g, '/');
      if (!actual.endsWith('/' + filename)) throw new Error(`文件保存位置与导出目录不同：${item.filename}`);
      return item;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('未匹配到日志下载记录。请检查是否登录失效、浏览器阻止下载，或服务器返回的文件名发生变化。');
}

async function saveText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try { return await download(url, filename); }
  finally { URL.revokeObjectURL(url); }
}

async function copyPath() {
  try {
    await navigator.clipboard.writeText(absolutePath);
    await log('clipboard.path-copied', { path: absolutePath });
  } catch (error) {
    await log('clipboard.failed', { message: error.message }, 'warn');
    throw error;
  }
}

$('copy').addEventListener('click', async () => {
  try { await copyPath(); $('status').textContent += '\n已复制目录绝对路径。'; }
  catch { $('path').select(); $('status').textContent += '\n自动复制失败，请按 Command+C（Windows 按 Ctrl+C）复制选中的路径。'; }
});

$('export').addEventListener('click', async () => {
  $('export').disabled = true;
  $('copy').disabled = true;
  absolutePath = '';
  $('path').value = '';
  $('save-diagnostics').disabled = true;
  diagnosticFolder = '';
  const startedAt = Date.now();
  try {
    const selected = [...document.querySelectorAll('.asset:not(.native-asset) input:checked')].map(input => snapshot.assets[Number(input.value)]);
    const taskId = new URL(snapshot.url).pathname.match(/\/task\/([^/]+)/)?.[1] || 'task';
    const folder = `Teambition/${safeName(taskId)}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}`;
    diagnosticFolder = folder;
    await log('export.start', { folder, selectedAssets: selected.length, selectedNativeAttachments: document.querySelectorAll('.native-asset input:checked').length });
    const results = [];
    for (let index = 0; index < selected.length; index++) {
      const asset = selected[index];
      const local = `assets/${assetName(asset, index)}`;
      $('status').textContent = `正在下载 ${index + 1}/${selected.length}：${asset.name || local}`;
      try {
        const item = await download(asset.url, `${folder}/${local}`);
        results.push({ ...asset, status: 'complete', local, actualPath: item.filename, mime: item.mime, bytes: item.fileSize });
      } catch (error) {
        await log('asset.failed', { filename: local, message: error.message }, 'error');
        results.push({ ...asset, status: 'failed', error: error.message });
      }
    }
    const native = [...document.querySelectorAll('.native-asset input:checked')].map(input => Number(input.value));
    for (let i = 0; i < native.length; i++) {
      const index = native[i];
      const asset = snapshot.nativeAttachments[index];
      const local = `assets/${String(selected.length + i + 1).padStart(3, '0')}-${safeName(asset.name)}`;
      $('status').textContent = `正在自动下载日志/附件 ${i + 1}/${native.length}：${asset.name}`;
      try {
        const item = await downloadNative(index, `${folder}/${local}`);
        results.push({ ...asset, status: 'complete', local, actualPath: item.filename, mime: item.mime, bytes: item.fileSize });
      } catch (error) {
        await log('native.failed', { filename: local, message: error.message }, 'error');
        results.push({ ...asset, status: 'failed', error: error.message });
      }
    }
    $('status').textContent = '正在保存问题描述与导出清单…';
    const text = $('text').value;
    const missing = snapshot.unresolvedAttachments || [];
    const summary = results.map(asset => asset.status === 'complete'
      ? `- [${asset.local}](${encodeURI(asset.local)})`
      : `- 下载失败：${asset.name || asset.url} — ${asset.error}`).join('\n') || '未选择附件。';
    const md = `# ${snapshot.title.replace(/[\r\n]/g, ' ')}\n\n来源：${snapshot.url}\n\n提取时间：${snapshot.capturedAt}\n\n## 页面文本\n\n${text}\n\n## 本地附件\n\n${summary}\n\n## 未下载的按钮型附件\n\n${missing.map(a => '- ' + a.name + '：' + a.reason).join('\n') || '未识别到。'}\n\n## 提取范围与限制\n\n${snapshot.limitations.map(line => '- ' + line).join('\n')}\n`;
    await saveText(JSON.stringify({ ...snapshot, text, exportResults: results }, null, 2), `${folder}/manifest.json`, 'application/json');
    const item = await saveText(md, `${folder}/issue.md`, 'text/markdown;charset=utf-8');
    absolutePath = item.filename.replace(/[/\\][^/\\]+$/, '');
    if (!absolutePath || absolutePath === item.filename) throw new Error('Chrome 未返回有效的绝对目录路径');
    $('path').value = absolutePath;
    $('copy').disabled = false;
    const failed = results.filter(asset => asset.status === 'failed').length;
    await log('export.complete', { path: absolutePath, successful: results.length - failed, failed, unresolved: missing.length, elapsedMs: Date.now() - startedAt });
    $('status').textContent = `已保存问题单文本。附件成功 ${results.length - failed} 个，失败 ${failed} 个。${failed ? '请查看 manifest.json 中的失败原因。' : ''}`;
    if (missing.length) $('status').textContent += `\n另有 ${missing.length} 个附件无法识别下载方式，详情已记录。`;
    try { await copyPath(); $('status').textContent += '\n目录绝对路径已复制，可直接粘贴给助手。'; }
    catch { $('status').textContent += '\n自动复制未成功，请点击“重新复制路径”。'; }
  } catch (error) {
    await log('export.failed', { message: error.message, stack: error.stack, elapsedMs: Date.now() - startedAt }, 'error');
    $('status').textContent = `导出未完成：${error.message}\n已下载的文件可能保留在 Chrome 下载目录的 Teambition 子目录中。`;
  } finally {
    try { await saveDiagnostics(); }
    catch (error) {
      await log('diagnostics.save-failed', { message: error.message }, 'error');
      $('diagnostics-status').textContent = '排查日志未能自动保存，请点击“一键复制诊断信息”。';
    }
    $('save-diagnostics').disabled = false;
    $('export').disabled = false;
  }
});

(async () => {
  await log('page.ready', { userAgent: navigator.userAgent, version: chrome.runtime.getManifest().version });
  await refreshDiagnostics();
  const entry = (await chrome.storage.session.get(job))[job];
  if (!entry || entry.error) {
    $('title').textContent = '无法提取';
    $('status').textContent = entry?.error || '提取快照已失效，请在问题单页面重新点击插件。';
    await log('snapshot.unavailable', { message: $('status').textContent }, 'error');
    return;
  }
  snapshot = entry.data;
  $('title').textContent = snapshot.title;
  $('source').textContent = snapshot.url;
  $('scope').textContent = snapshot.scope === 'teambition-detail'
    ? '提取范围：Teambition 问题单详情，包含已加载字段和动态。'
    : snapshot.scope === 'visible-dialog'
    ? '提取范围：当前可见弹窗。请核对是否为问题单详情。'
    : '提取范围：整个页面。可能包含侧栏和其他任务，请核对文本并删除无关内容。';
  $('text').value = snapshot.text;
  snapshot.assets.forEach((asset, index) => {
    const label = document.createElement('label');
    label.className = 'asset';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = index; input.checked = asset.selected;
    const text = document.createTextNode(` ${asset.kind} · ${asset.name || assetName(asset, index)}`);
    const url = document.createElement('span'); url.className = 'url'; url.textContent = asset.url;
    label.append(input, text, url); $('assets').append(label);
  });
  if (!snapshot.assets.length && !snapshot.nativeAttachments?.length) $('assets').textContent = '未识别到图片或可下载附件。';
  (snapshot.nativeAttachments || []).forEach((asset, index) => {
    const label = document.createElement('label'); label.className = 'asset native-asset';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = index; input.checked = true;
    label.append(input, document.createTextNode(` 自动下载日志/附件 · ${asset.name}`));
    $('assets').append(label);
  });
  for (const asset of snapshot.unresolvedAttachments || []) {
    const warning = document.createElement('p');
    warning.textContent = `未取得下载地址：${asset.name}。${asset.reason}`;
    $('assets').append(warning);
  }
  $('export').disabled = false;
  if (new URL(location.href).searchParams.get('auto') === '1') {
    history.replaceState(null, '', `exporter.html?job=${encodeURIComponent(job)}`);
    $('export').click();
  }
})().catch(async error => {
  $('status').textContent = `页面初始化失败：${error.message}。请复制诊断信息发给我。`;
  await log('page.init-failed', { message: error.message, stack: error.stack }, 'error');
  await refreshDiagnostics();
});
