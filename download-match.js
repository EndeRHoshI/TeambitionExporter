export const ROUTE_KEY = 'pendingNativeDownload';

function baseName(value) {
  return String(value || '').split(/[/\\]/).pop().normalize('NFC');
}

export function matchesDownload(item, pending, now = Date.now()) {
  if (!pending || pending.expires < now || pending.downloadId != null) return false;
  if (item.byExtensionId && item.byExtensionId !== pending.extensionId) return false;
  const started = Date.parse(item.startTime);
  if (!Number.isFinite(started) || started < pending.startedAt - 1000) return false;
  if (baseName(item.filename) !== baseName(pending.expectedName)) return false;
  try {
    // A download can omit its referrer. In that case accept only known file services.
    if (item.referrer) return new URL(item.referrer).origin === new URL(pending.sourceUrl).origin;
    const url = new URL(item.finalUrl || item.url);
    return url.protocol === 'https:' && (
      url.hostname === 'www.teambition.com' ||
      url.hostname.endsWith('.teambition.com') ||
      url.hostname.endsWith('.teambition.net') ||
      url.hostname === 'teambition-file.oss-cn-zhangjiakou.aliyuncs.com'
    );
  } catch { return false; }
}
