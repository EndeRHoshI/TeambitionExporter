const memory = new Map();
export const diagnosticPrefix = job => `diagnostic:${job}:`;

export function sanitize(value, key = '') {
  if (/cookie|authorization|password|secret|token|signature/i.test(key)) return '[已隐藏]';
  if (typeof value === 'string') return value.replace(/https?:\/\/[^\s"<>]+/g, raw => {
    try { const url = new URL(raw); return `${url.origin}${url.pathname}${url.search ? '?[参数已隐藏]' : ''}`; }
    catch { return '[无效网址]'; }
  });
  if (Array.isArray(value)) return value.map(item => sanitize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  return value;
}

export async function logEvent(job, source, event, details = {}, level = 'info') {
  if (!job) return;
  const entry = sanitize({ id: crypto.randomUUID(), time: new Date().toISOString(), source, level, event, details });
  const key = diagnosticPrefix(job) + entry.id;
  memory.set(key, entry);
  // Keep a fallback if storage is unavailable, without letting logging stop the export.
  if (memory.size > 1000) memory.delete(memory.keys().next().value);
  try { await chrome.storage.session.set({ [key]: entry }); }
  catch (error) { console.warn('诊断日志暂存失败', sanitize(error.message)); }
  // Chrome's extension error list stringifies object arguments as [object Object].
  console[level === 'error' ? 'error' : 'info'](`[Teambition 导出] ${JSON.stringify(entry)}`);
}

export async function readDiagnostics(job) {
  let saved = {};
  try { saved = await chrome.storage.session.get(null); } catch {}
  const prefix = diagnosticPrefix(job);
  const events = Object.entries({ ...Object.fromEntries(memory), ...saved })
    .filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)
    .sort((a, b) => a.time.localeCompare(b.time)).slice(-1000);
  return { version: chrome.runtime.getManifest().version, job, generatedAt: new Date().toISOString(), events };
}
