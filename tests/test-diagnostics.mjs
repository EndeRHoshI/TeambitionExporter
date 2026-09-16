import assert from 'node:assert/strict';
import {logEvent,readDiagnostics,sanitize} from '../src/diagnostics.js';
const store={}; let failStorage=false;
globalThis.chrome={storage:{session:{async set(value){if(failStorage)throw Error('quota');Object.assign(store,value);},async get(key){if(failStorage)throw Error('unavailable');return key==null?store:{[key]:store[key]};}}},runtime:{getManifest(){return {version:'1.0.1'};}}};
const signed='https://user:pass@example.com/file.rar?Signature=secret&token=private#fragment';
const redacted=sanitize({url:signed,authorization:'Bearer hidden',nested:{cookie:'sid=hidden'},message:'下载失败 '+signed});
assert(!JSON.stringify(redacted).includes('secret'));
assert(!JSON.stringify(redacted).includes('private'));
assert(!JSON.stringify(redacted).includes('pass'));
assert.equal(redacted.url,'https://example.com/file.rar?[参数已隐藏]');
await Promise.all(Array.from({length:12},(_,index)=>logEvent('test-job',index%2?'background':'export-page','test.concurrent',{index,url:signed})));
await logEvent('different-job','background','other',{});
const report=await readDiagnostics('test-job');
assert.equal(report.events.length,12);
assert.equal(new Set(report.events.map(x=>x.details.index)).size,12);
assert.equal(report.version,'1.0.1');
assert(!JSON.stringify(report).includes('Signature='));
failStorage=true;
await logEvent('test-job','export-page','storage-fallback',{message:'test'},'error');
assert.equal((await readDiagnostics('test-job')).events.length,13);
assert((await readDiagnostics('test-job')).events.some(x=>x.event==='storage-fallback'));
console.log('PASS: concurrent frontend/background logs, URL redaction, job isolation, and copyable fallback when storage fails.');

const originalError = console.error; const messages = [];
try {
 console.error = (...args) => messages.push(args);
 await logEvent('readable-error', 'background', 'download.routing-failed', {message:'Download must be in progress',url:signed}, 'error');
 assert.equal(messages.length,1);
 assert.equal(messages[0].length,1);
 assert.match(messages[0][0], /download.routing-failed/);
 assert.match(messages[0][0], /Download must be in progress/);
 assert(!messages[0][0].includes('[object Object]'));
 assert(!messages[0][0].includes('Signature=secret'));
 assert.equal((await readDiagnostics('readable-error')).events[0].level,'error');
} finally {console.error = originalError;}
