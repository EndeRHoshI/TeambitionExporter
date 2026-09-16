const DB = 'teambition-export-settings';
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadDirectory() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('directory');
      request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function storeDirectory(config) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(config, 'directory');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function checkDirectory(config, report = async () => {}) {
  const permission = config?.handle ? await config.handle.queryPermission({ mode: 'readwrite' }) : 'not-selected';
  await report('directory.permission', { directoryName: config?.handle?.name || null, configuredPath: config?.rootPath || null, permission }).catch(() => {});
  if (!config?.handle) throw Object.assign(new Error('请在导出窗口点击“选择目录并导出”，选择保存目录并允许写入'), { code: 'DIRECTORY_REQUIRED' });
  if (permission !== 'granted') throw Object.assign(new Error(`保存父目录“${config.handle.name}”${permission === 'denied' ? '的写入权限被拒绝' : '需要 Chrome 再次确认写入权限'}，请在导出窗口重新点击“选择目录并导出”，选择可用目录并允许写入`), { code: 'DIRECTORY_REQUIRED' });
  const rootPath = (config.rootPath || '').trim().replace(/\/+$/, '');
  if (rootPath && (!rootPath.startsWith('/') || rootPath.split('/').pop() !== config.handle.name)) throw new Error('选项中的绝对路径与所选文件夹名称不一致，请修正');
  return config;
}
export async function saveArchive(config, issueKey, filename, blob) {
  await checkDirectory(config);
  if (!/^[A-Z][A-Z0-9]{0,31}-\d+$/.test(issueKey) || !/^[A-Z][A-Z0-9]{0,31}-\d+(?:-不完整)?\.zip$/.test(filename)) throw new Error('问题单编号或 ZIP 文件名无效');
  const directory = await config.handle.getDirectoryHandle(issueKey, { create: true });
  // Preserve previous exports. A single offscreen worker serializes exports.
  let candidate = filename;
  for (let i = 0; i < 10000; i++) {
    candidate = i ? filename.replace(/\.zip$/, ` (${i + 1}).zip`) : filename;
    try { await directory.getFileHandle(candidate); }
    catch (error) { if (error.name === 'NotFoundError') break; throw error; }
    if (i === 9999) throw new Error('同名导出文件过多，请整理该问题单目录');
  }
  const file = await directory.getFileHandle(candidate, { create: true });
  const writer = await file.createWritable();
  try { await writer.write(blob); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
  const saved = await file.getFile();
  if (saved.size !== blob.size) throw new Error('ZIP 保存后的大小与生成结果不一致');
  const rootPath = (config.rootPath || '').trim().replace(/\/+$/, '');
  return { path: rootPath ? `${rootPath}/${issueKey}/${candidate}` : null, relativePath: `${issueKey}/${candidate}`, displayPath: `${config.handle.name}/${issueKey}/${candidate}`, bytes: saved.size, pathSource: rootPath ? 'user-configured-directory' : 'relative-only' };
}

// Write the original archive entries directly; no external unzip app is needed.
export async function saveExport(config, issueKey, archive, onProgress = async () => {}) {
  await checkDirectory(config);
  if (!/^[A-Z][A-Z0-9]{0,31}-\d+$/.test(issueKey)) throw new Error('问题单编号无效');
  const entries = archive.files.map(file => {
    const parts = file.name.split('/');
    if (parts.shift() !== issueKey || !parts.length || parts.some(p => !p || p === '.' || p === '..' || /[\\:\u0000-\u001f]/.test(p))) throw new Error('导出文件路径无效');
    return { parts, blob: new Blob([file.data]) };
  });
  let folder;
  for (let i = 0; i < 10000; i++) {
    const name = i ? `${issueKey} (${i + 1})` : issueKey;
    try { await config.handle.getDirectoryHandle(name); }
    catch (error) {
      if (error.name === 'NotFoundError') { folder = name; break; }
      if (error.name !== 'TypeMismatchError') throw error;
    }
  }
  if (!folder) throw new Error('同名导出目录过多，请整理后重试');
  const directory = await config.handle.getDirectoryHandle(folder, { create: true });
  const write = async (parent, name, blob) => {
    const handle = await parent.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try { await writer.write(blob); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
    if ((await handle.getFile()).size !== blob.size) throw new Error('文件保存后的大小不一致：' + name);
  };
  try {
    let completed = 0;
    for (const entry of entries) {
      await onProgress(completed, entries.length, entry.parts.join('/'));
      let parent = directory;
      for (const segment of entry.parts.slice(0, -1)) parent = await parent.getDirectoryHandle(segment, { create: true });
      await write(parent, entry.parts.at(-1), entry.blob);
      completed++;
      await onProgress(completed, entries.length, entry.parts.join('/'));
    }
  } catch (error) {
    throw new Error(`目录 ${folder} 中部分文件可能已保存，导出未完成：${error.message}`);
  }
  const rootPath = (config.rootPath || '').trim().replace(/\/+$/, '');
  return { path: rootPath ? `${rootPath}/${folder}` : null,
    relativePath: folder, displayPath: `${config.handle.name}/${folder}`, bytes: entries.reduce((sum, entry) => sum + entry.blob.size, 0),
    expanded: true, pathSource: rootPath ? 'user-configured-directory' : 'relative-only' };
}
