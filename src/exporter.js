import { logEvent, readDiagnostics, diagnosticPrefix } from './diagnostics.js';
import { createZip } from './zip.js';
import { fetchFile } from './fetch-file.js';

const $ = id => document.getElementById(id);
const job = new URL(location.href).searchParams.get('job');
const log = (event, details, level) => logEvent(job, 'export-page', event, details, level);
const safeName = value => (value || 'file').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 120) || 'file';
let snapshot, absolutePath = '', issueKey = '', busy = false;
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
window.addEventListener('unhandledrejection', event => { void log('page.unhandled-rejection', { message: event.reason?.message || String(event.reason) }, 'error'); });

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const prepared = await chrome.runtime.sendMessage({ type: 'prepare-download', job, url, filename });
    if (!prepared?.ok) throw new Error(prepared?.error || '无法设置归档文件名');
    await log('archive.download-start', { filename, bytes: blob.size });
    const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    const deadline = Date.now() + 10 * 60 * 1000;
    let previous = '';
    while (Date.now() < deadline) {
      const [item] = await chrome.downloads.search({ id });
      if (!item) throw new Error('Chrome 下载记录不可用');
      const state = `${item.state}:${item.filename}:${item.error || ''}`;
      if (state !== previous) { await log('archive.download-state', { id, state: item.state, filename: item.filename, error: item.error }); previous = state; }
      if (item.state === 'complete') return item;
      if (item.state === 'interrupted') throw new Error(item.error || 'ZIP 下载已中断');
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    await chrome.downloads.cancel(id).catch(() => {});
    throw new Error('保存 ZIP 超时');
  } finally {
    await chrome.runtime.sendMessage({ type: 'forget-download', url }).catch(() => {});
    URL.revokeObjectURL(url);
  }
}

async function resolveNative(index) {
  const response = await chrome.runtime.sendMessage({ type: 'resolve-native-download', job, index });
  if (!response || response.error) throw new Error(response?.error || '无法准备日志附件');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const pending = (await chrome.storage.session.get('pendingNativeDownload')).pendingNativeDownload;
    if (!pending || pending.token !== response.token) throw new Error('附件下载跟踪已失效');
    if (pending.status === 'failed') throw new Error(pending.error);
    if (pending.status === 'resolved') return pending.url;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('没有捕获到附件下载地址，请保留原问题单并复制诊断信息');
}

function assetName(asset, index) {
  let name = asset.name;
  if (!/\.[a-z\d]{1,8}$/i.test(name || '')) {
    let tail = new URL(asset.url).pathname.split('/').pop();
    try { tail = decodeURIComponent(tail); } catch {}
    name = tail || name || 'file';
  }
  if (!/\.[a-z\d]{1,8}$/i.test(name)) name += '.bin';
  return `${String(index + 1).padStart(3, '0')}-${safeName(name)}`;
}
async function copyPath() {
  try { await navigator.clipboard.writeText(absolutePath); await log('clipboard.path-copied', { path: absolutePath }); }
  catch (error) { await log('clipboard.failed', { message: error.message }, 'warn'); throw error; }
}
$('copy').addEventListener('click', async () => {
  try { await copyPath(); $('status').textContent += '\nZIP 路径已复制。'; }
  catch { $('path').select(); $('status').textContent += '\n请按 Command+C（Windows 按 Ctrl+C）复制路径。'; }
});
$('copy-diagnostics').addEventListener('click', async () => {
  await refreshDiagnostics();
  try { await navigator.clipboard.writeText($('diagnostics-text').value); $('diagnostics-status').textContent = '诊断信息已复制，粘贴给我即可。'; }
  catch { $('diagnostics-panel').open = true; $('diagnostics-text').select(); $('diagnostics-status').textContent = '请按 Command+C（Windows 按 Ctrl+C）复制。'; }
});
$('save-diagnostics').addEventListener('click', async () => {
  try {
    if (!issueKey) throw new Error('尚未识别问题单编号，请直接复制诊断信息');
    const report = await readDiagnostics(job);
    const item = await saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${issueKey}/debug-log.json`);
    $('diagnostics-status').textContent = `已保存：${item.filename}`;
  } catch (error) { $('diagnostics-status').textContent = error.message + '；也可以直接复制诊断信息。'; }
});

$('export').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  $('export').disabled = true; $('copy').disabled = true; $('save-diagnostics').disabled = true;
  absolutePath = ''; $('path').value = '';
  const startedAt = Date.now();
  try {
    if (!/^GXXE-\d+$/.test(issueKey)) throw new Error('没有找到 GXXE 问题单编号，请确认详情已完整加载后重新点击插件');
    const direct = [...document.querySelectorAll('.direct-asset input:checked')].map(input => snapshot.assets[Number(input.value)]);
    const native = [...document.querySelectorAll('.native-asset input:checked')].map(input => ({ ...snapshot.nativeAttachments[Number(input.value)], nativeIndex: Number(input.value) }));
    const assets = [...direct, ...native], files = [], results = [];
    let totalBytes = 0;
    await log('export.start', { issueKey, direct: direct.length, native: native.length });
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const name = asset.nativeIndex != null ? `${String(i + 1).padStart(3, '0')}-${safeName(asset.name)}` : assetName(asset, i);
      const local = `assets/${name}`;
      try {
        $('status').textContent = `正在收集 ${i + 1}/${assets.length}：${asset.name || name}`;
        const url = asset.nativeIndex != null ? await resolveNative(asset.nativeIndex) : asset.url;
        await log('asset.fetch-start', { name, url });
        let lastProgress = 0;
        const result = await fetchFile(url, { maxBytes: 256 * 1024 * 1024 - totalBytes, expectedName: name,
          onProgress(received, total) {
            $('status').textContent = `正在收集 ${i + 1}/${assets.length}：${name}\n${Math.round(received / 1024)} KB${total ? ' / ' + Math.round(total / 1024) + ' KB' : ''}`;
            if (Date.now() - lastProgress > 30000) { lastProgress = Date.now(); void log('asset.fetch-progress', { name, received, total }); }
          }
        });
        totalBytes += result.bytes;
        files.push({ name: `${issueKey}/${local}`, data: result.data });
        results.push({ name: asset.name || name, status: 'complete', local, bytes: result.bytes, mime: result.mime });
        await log('asset.collected', { name, bytes: result.bytes, mime: result.mime });
      } catch (error) {
        results.push({ name: asset.name || name, status: 'failed', error: error.message });
        await log('asset.failed', { name, message: error.message }, 'error');
      }
    }
    const failed = results.filter(result => result.status === 'failed').length;
    const unresolved = snapshot.unresolvedAttachments || [];
    const incomplete = failed > 0 || unresolved.length > 0;
    const archiveName = `${issueKey}${incomplete ? '-不完整' : ''}.zip`;
    const list = results.map(result => result.status === 'complete' ? `- [${result.local}](${encodeURI(result.local)})` : `- 未取得：${result.name} — ${result.error}`).join('\n');
    const md = `# ${issueKey} ${snapshot.title}\n\n来源：${snapshot.url}\n\n${incomplete ? '**本次导出不完整，请查看附件清单与排查日志。**\n\n' : ''}## 问题描述\n\n${$('text').value}\n\n## 附件\n\n${list || '没有选择附件。'}\n\n${unresolved.map(a => '- 无法识别的附件：' + a.name + ' — ' + a.reason).join('\n')}\n`;
    files.push({ name: `${issueKey}/issue.md`, data: md });
    // Export results contain local paths, not expiring signed URLs.
    files.push({ name: `${issueKey}/manifest.json`, data: JSON.stringify({ version: chrome.runtime.getManifest().version, issueKey, title: snapshot.title, url: snapshot.url, capturedAt: snapshot.capturedAt, text: $('text').value, complete: !incomplete, exportResults: results, unresolvedAttachments: unresolved, limitations: snapshot.limitations }, null, 2) });
    await log('archive.ready', { issueKey, files: files.length, totalBytes, failed, unresolved: unresolved.length });
    files.push({ name: `${issueKey}/debug-log.json`, data: JSON.stringify(await readDiagnostics(job), null, 2) });
    $('status').textContent = '正在生成 ZIP，只会保存这一个文件…';
    const zip = createZip(files);
    const item = await saveBlob(zip, `${issueKey}/${archiveName}`);
    absolutePath = item.filename;
    $('path').value = absolutePath; $('copy').disabled = false;
    await log('export.complete', { path: absolutePath, bytes: zip.size, failed, elapsedMs: Date.now() - startedAt });
    $('status').textContent = `${incomplete ? '已保存不完整归档' : '已保存完整归档'}：${archiveName}\n附件成功 ${results.length - failed} 个，失败 ${failed} 个。解压后得到 ${issueKey} 文件夹。`;
    if (!absolutePath.replace(/\\/g, '/').includes(`/${issueKey}/`)) {
      $('status').textContent += '\n浏览器改变了保存位置；压缩包内仍按问题单编号归档。';
      await log('archive.location-changed', { requested: `${issueKey}/${archiveName}`, actual: absolutePath }, 'warn');
    }
    try { await copyPath(); $('status').textContent += '\nZIP 绝对路径已复制，可直接粘贴给我。'; }
    catch { $('status').textContent += '\n请点击“复制 ZIP 路径”。'; }
    $('diagnostics-status').textContent = '打包前的排查日志已包含在 ZIP 中；“复制诊断信息”可取得包含最终保存结果的最新日志。';
  } catch (error) {
    await log('export.failed', { message: error.message, stack: error.stack }, 'error');
    $('status').textContent = `导出失败：${error.message}\n请点击“一键复制诊断信息”发给我。`;
  } finally {
    busy = false; $('export').disabled = false; $('save-diagnostics').disabled = false;
  }
});

(async () => {
  await log('page.ready', { userAgent: navigator.userAgent, version: chrome.runtime.getManifest().version });
  await refreshDiagnostics();
  const entry = (await chrome.storage.session.get(job))[job];
  if (!entry || entry.error) throw new Error(entry?.error || '提取快照已失效，请在问题单页面重新点击插件');
  snapshot = entry.data; issueKey = snapshot.issueKey || '';
  $('title').textContent = `${issueKey || '未识别编号'} · ${snapshot.title}`;
  $('source').textContent = snapshot.url;
  $('scope').textContent = `一次保存一个 ZIP，文件按 ${issueKey || '问题单编号'} 文件夹归档。`;
  $('text').value = snapshot.text;
  for (const [kind, assets] of [['direct', snapshot.assets], ['native', snapshot.nativeAttachments || []]]) {
    assets.forEach((asset, index) => {
      const label = document.createElement('label'); label.className = `asset ${kind}-asset`;
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = index; input.checked = kind === 'native' || asset.selected;
      label.append(input, document.createTextNode(` ${kind === 'native' ? '日志/附件' : asset.kind} · ${asset.name || assetName(asset, index)}`));
      $('assets').append(label);
    });
  }
  for (const asset of snapshot.unresolvedAttachments || []) {
    const warning = document.createElement('p'); warning.textContent = `无法识别：${asset.name}。${asset.reason}`; $('assets').append(warning);
  }
  $('export').disabled = false;
  if (new URL(location.href).searchParams.get('auto') === '1') {
    history.replaceState(null, '', `exporter.html?job=${encodeURIComponent(job)}`); $('export').click();
  }
})().catch(async error => {
  $('title').textContent = '无法提取'; $('status').textContent = error.message;
  await log('page.init-failed', { message: error.message, stack: error.stack }, 'error'); await refreshDiagnostics();
});
