import { fetchFile } from './fetch-file.js';
const safeName = value => (value || 'file').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 120) || 'file';
export async function buildArchive(snapshot, { log, progress, resolveNative, diagnostics, fetchAsset = fetchFile }) {
  const issueKey = snapshot.issueKey;
  if (!/^[A-Z][A-Z0-9]{0,31}-\d+$/.test(issueKey)) throw new Error('没有找到问题单编号，请等待问题单详情完整加载');
  const assets = [...snapshot.assets.filter(a => a.selected), ...(snapshot.nativeAttachments || []).map((asset, nativeIndex) => ({ ...asset, nativeIndex }))];
  const files = [], results = []; let totalBytes = 0;
  await log('export.start', { issueKey, assets: assets.length });
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    let name = asset.name;
    if (!/\.[a-z\d]{1,8}$/i.test(name || '')) {
      let tail = asset.url ? new URL(asset.url).pathname.split('/').pop() : name;
      try { tail = decodeURIComponent(tail); } catch {}
      name = tail || 'file';
    }
    if (!/\.[a-z\d]{1,8}$/i.test(name)) name += '.bin';
    const local = `assets/${String(i + 1).padStart(3, '0')}-${safeName(name)}`;
    try {
      await progress(`准备附件 ${i + 1}/${assets.length}：${name}（等待下载地址或服务器响应）`, `${i + 1}/${assets.length}`);
      const url = asset.nativeIndex != null ? await resolveNative(asset.nativeIndex) : asset.url;
      await log('asset.fetch-start', { name, url });
      const result = await fetchAsset(url, { maxBytes: 256 * 1024 * 1024 - totalBytes, expectedName: name,
        async onProgress(received, total) {
          const size = bytes => (bytes / 1024 / 1024).toFixed(2) + ' MB';
          const percent = total > 0 ? Math.min(100, Math.floor(received / total * 100)) : null;
          await progress(`下载附件 ${i + 1}/${assets.length}：${name}\n已下载 ${size(received)}${total ? ' / ' + size(total) : '（总大小未知）'}`, '', { percent, phase: 'download', received, total });
        }
      });
      totalBytes += result.bytes;
      files.push({ name: `${issueKey}/${local}`, data: result.data });
      results.push({ name, status: 'complete', local, bytes: result.bytes, mime: result.mime });
      await log('asset.collected', { name, bytes: result.bytes, mime: result.mime });
    } catch (error) {
      results.push({ name, status: 'failed', error: error.message });
      await log('asset.failed', { name, message: error.message }, 'error');
    }
  }
  const failed = results.filter(a => a.status === 'failed').length;
  const unresolved = snapshot.unresolvedAttachments || [], incomplete = failed > 0 || unresolved.length > 0;
  const list = results.map(a => a.status === 'complete' ? `- [${a.local}](${encodeURI(a.local)})` : `- 未取得：${a.name} — ${a.error}`).join('\n');
  files.push({ name: `${issueKey}/issue.md`, data: `# ${issueKey} ${snapshot.title}\n\n来源：${snapshot.url}\n\n${incomplete ? '**本次导出不完整。**\n\n' : ''}## 问题描述\n\n${snapshot.text}\n\n## 附件\n\n${list}\n\n${unresolved.map(a => '- 无法识别：' + a.name).join('\n')}\n` });
  files.push({ name: `${issueKey}/manifest.json`, data: JSON.stringify({ version: '1.0.0', issueKey, title: snapshot.title, url: snapshot.url, capturedAt: snapshot.capturedAt, text: snapshot.text, complete: !incomplete, exportResults: results, unresolvedAttachments: unresolved, limitations: snapshot.limitations }, null, 2) });
  await log('archive.ready', { issueKey, files: files.length, failed, totalBytes });
  files.push({ name: `${issueKey}/debug-log.json`, data: JSON.stringify(await diagnostics(), null, 2) });
  await progress('文件已收集，准备保存', '保存');
  return { files, incomplete, failed, successful: results.length - failed };
}
