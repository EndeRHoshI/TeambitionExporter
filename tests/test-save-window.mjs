import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=(await readFile(new URL('../src/save.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
async function setup(path) {
 const elements=Object.fromEntries(['save','status','settings','progress-area','progress','progress-label'].map(id=>[id,{textContent:'',disabled:true,removeAttribute(name){delete this[name];}}]));
 const calls=[];let rejectCopy=false;let receive;
 const handle={async isSameEntry(){return true;}};
 const context={URL,location:{href:'chrome-extension://test/src/save.html?token=sample'},document:{getElementById:id=>elements[id]},
  async loadDirectory(){return {handle,rootPath:'/tmp/Exports'};},async storeDirectory(){},
  window:{focus(){},close(){calls.push('close');}},async showDirectoryPicker(){return handle;},
  chrome:{runtime:{id:'test',onMessage:{addListener(fn){receive=fn;}},async sendMessage(){
    receive({type:'export-progress',token:'other',text:'wrong',percent:99},{id:'test'});
    assert.notEqual(elements.status.textContent,'wrong');
    receive({type:'export-progress',token:'sample',text:'downloading',percent:50,phase:'download'},{id:'test'});
    assert.equal(elements.progress.value,50);assert.equal(elements.status.textContent,'downloading');
    receive({type:'export-progress',token:'sample',text:'unknown total',percent:null,phase:'download'},{id:'test'});
    assert.equal(elements.progress.value,undefined);
    return {path,displayPath:'Exports/GXXE-1',copied:true};},openOptionsPage(){}}},
  navigator:{clipboard:{async writeText(value){calls.push(value);if(rejectCopy)throw Error('blocked');}}}
 };
 vm.runInNewContext(code,context);
 await new Promise(resolve=>setImmediate(resolve));
 await elements.save.onclick();
 assert.equal(elements.progress.value,100);
 receive({type:'export-progress',token:'sample',text:'late',percent:20},{id:'test'});
 assert.notEqual(elements.status.textContent,'late');
 return {elements,calls,reject(){rejectCopy=true;},allow(){rejectCopy=false;}};
}
for (const oldPath of ['/tmp/Exports/GXXE-1', null]) {
 const result=await setup(oldPath);
 assert.equal(result.elements.save.textContent,'关闭');
 assert(!result.elements.status.textContent.includes('绝对路径'));
 assert(!result.elements.status.textContent.includes('复制'));
 await result.elements.save.onclick();
 assert.deepEqual(result.calls,['close']);
}
console.log('PASS: export progress and closing work without clipboard writes or path configuration.');
