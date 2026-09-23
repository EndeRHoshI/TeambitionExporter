import assert from 'node:assert/strict';
import vm from 'node:vm';
import { captureTaskLink } from '../src/task-link.js';
const url = 'https://www.teambition.com/task/6aad09ae6391521400fc4ea0';
async function run(mode, count = 1) {
  let clicks = 0, writes = 0, commands = 0, tick = 0;
  const handlers = new Map();
  const clipboard = { writeText: async () => { writes++; } };
  const originalWrite = clipboard.writeText;
  const document = { activeElement: null, getSelection: () => ({ toString: () => url }),
    execCommand: () => { commands++; return false; },
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: type => handlers.delete(type),
    querySelectorAll: () => [root] };
  const originalExec = document.execCommand;
  const button = { click() {
    clicks++;
    if (mode === 'modern') void clipboard.writeText(url);
    if (mode === 'legacy') {
      document.activeElement = { tagName: 'TEXTAREA', value: url, selectionStart: 0, selectionEnd: url.length };
      document.execCommand('copy');
    }
    if (mode === 'event') {
      let value = '';
      handlers.get('copy')({ clipboardData: { getData: () => value } });
      value = url;
    }
    if (mode === 'throw') throw Error('click failed');
    if (mode === 'invalid') void clipboard.writeText('https://evil.example/task/6aad09ae6391521400fc4ea0');
  } };
  const root = { getClientRects: () => [{}], querySelectorAll(selector) {
    if (selector === '[data-clipboard-text]') return [{ getAttribute: () => 'GXXE-13498' }];
    assert.equal(selector, '[class*="action-bar"] .next-icon-link');
    return Array.from({length:count}, () => ({ getClientRects: () => [{}], closest: () => ({...button}) }));
  } };
  const context = { document, navigator: { clipboard }, URL, getComputedStyle: () => ({visibility:'visible'}),
    queueMicrotask, Date: { now: () => (tick += 1000) }, setTimeout: fn => setTimeout(fn, 0) };
  try {
    const result = await vm.runInNewContext(`(${captureTaskLink.toString()})()`, context);
    assert.equal(result.url, url); assert.equal(result.issueKey, 'GXXE-13498');
    assert.equal(clicks, 1); assert.equal(writes, 0); assert.equal(commands, 0);
  } finally {
    assert.equal(clipboard.writeText, originalWrite);
    assert.equal(document.execCommand, originalExec);
    assert.equal(handlers.size, 0);
    if (count !== 1) assert.equal(clicks, 0);
  }
}
await run('modern'); await run('legacy'); await run('event');
await assert.rejects(run('modern', 0), /唯一定位/);
await assert.rejects(run('modern', 2), /唯一定位/);
await assert.rejects(run('invalid'), /未捕获/);
await assert.rejects(run('throw'), /click failed/);
console.log('PASS: exact header selector; modern, legacy and copy-event capture; rejection and cleanup.');
