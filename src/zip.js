// ZIP STORE: PNG/RAR files are already compressed. No network library or dependency.
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(files, now = new Date()) {
  if (files.length > 65535) throw new Error('归档文件数量过多');
  const parts = [], central = [], seen = new Set();
  let offset = 0, centralSize = 0;
  const date = ((Math.max(1980, Math.min(now.getFullYear(), 2107)) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >>> 1);
  for (const file of files) {
    if (!file.name || file.name.startsWith('/') || file.name.includes('\\') || file.name.split('/').some(p => !p || p === '.' || p === '..') || seen.has(file.name)) throw new Error('归档包含重复或不安全的文件路径');
    seen.add(file.name);
    const name = encoder.encode(file.name), data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    if (!(data instanceof Uint8Array) || name.length > 65535 || offset + data.length + name.length + 30 >= 0xffffffff) throw new Error('文件超过 ZIP 支持的大小');
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(10, time, true); l.setUint16(12, date, true); l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const record = new Uint8Array(46 + name.length), c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true); record.set(name, 46);
    parts.push(local, data); central.push(record); offset += local.length + data.length; centralSize += record.length;
  }
  if (offset + centralSize >= 0xffffffff) throw new Error('归档过大');
  const end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true);
  v.setUint32(12, centralSize, true); v.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
