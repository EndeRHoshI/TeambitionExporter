export async function fetchFile(url, { maxBytes, expectedName = '', onProgress = () => {}, fetchImpl = fetch } = {}) {
  if (!/^https:\/\//.test(url)) throw new Error('仅支持 HTTPS 附件地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  let reader;
  try {
    const response = await fetchImpl(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`附件请求失败：HTTP ${response.status}`);
    const mime = response.headers.get('content-type') || '';
    if (/text\/html|application\/xhtml/i.test(mime)) throw new Error('附件返回了网页，可能登录已失效或下载地址已过期');
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > maxBytes) throw new Error('附件超出本次剩余内存限额（整个包最多 256 MB）');
    if (!response.body) throw new Error('附件响应没有可读取的数据');
    reader = response.body.getReader();
    const chunks = []; let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error('附件超出本次剩余内存限额（整个包最多 256 MB）');
      chunks.push(value); onProgress(received, total);
    }
    if (!received) throw new Error('附件为空文件');
    const data = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    const prefix = new TextDecoder().decode(data.subarray(0, 100)).trim().toLowerCase();
    if (/^(<!doctype html|<html)/.test(prefix)) throw new Error('附件内容实际为 HTML 错误页');
    if (/\.rar$/i.test(expectedName) && (data[0] !== 0x52 || data[1] !== 0x61 || data[2] !== 0x72 || data[3] !== 0x21)) throw new Error('日志文件不是有效的 RAR 文件');
    return { data, mime, bytes: received };
  } finally {
    clearTimeout(timer);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
