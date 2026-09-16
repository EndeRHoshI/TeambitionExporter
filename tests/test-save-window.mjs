import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=(await readFile(new URL('../src/save.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
async function setup(path) {
 const elements=Object.fromEntries(['save','status','settings'].map(id=>[id,{textContent:'',disabled:true}]));
 const calls=[];let rejectCopy=false;
 const handle={async isSameEntry(){return true;}};
 const context={URL,location:{href:'chrome-extension://test/src/save.html?token=sample'},document:{getElementById:id=>elements[id]},
  async loadDirectory(){return {handle,rootPath:'/tmp/Exports'};},async storeDirectory(){},
  window:{focus(){},close(){calls.push('close');}},async showDirectoryPicker(){return handle;},
  chrome:{runtime:{async sendMessage(){return {path,displayPath:'Exports/GXXE-1',copied:true};},openOptionsPage(){}}},
  navigator:{clipboard:{async writeText(value){calls.push(value);if(rejectCopy)throw Error('blocked');}}}
 };
 vm.runInNewContext(code,context);
 await new Promise(resolve=>setImmediate(resolve));
 await elements.save.onclick();
 return {elements,calls,reject(){rejectCopy=true;},allow(){rejectCopy=false;}};
}
const success=await setup('/tmp/Exports/GXXE-1');
assert.equal(success.elements.save.textContent,'复制路径并关闭');
assert.equal(success.calls.length,0);
await success.elements.save.onclick();assert.deepEqual(success.calls,['/tmp/Exports/GXXE-1','close']);
const retry=await setup('/tmp/Exports/GXXE-1');retry.reject();
await retry.elements.save.onclick();assert(!retry.calls.includes('close'));assert.match(retry.elements.status.textContent,/复制路径失败/);assert.equal(retry.elements.save.disabled,false);
retry.allow();await retry.elements.save.onclick();assert.equal(retry.calls.at(-1),'close');
const noPath=await setup(null);assert.equal(noPath.elements.save.textContent,'关闭');await noPath.elements.save.onclick();assert.deepEqual(noPath.calls,['close']);
console.log('PASS: close button copies even if already copied; waits for clipboard success; stays open on failure; never fabricates an absolute path.');
