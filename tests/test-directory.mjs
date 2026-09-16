import assert from 'node:assert/strict';
import {checkDirectory,saveArchive} from '../src/directory-store.js';
const missing=()=>Object.assign(Error('missing'),{name:'NotFoundError'});
const files=new Map();let allow=true, failWrite=false, aborted=false;
const directory={async getFileHandle(name,opts={}){
 if(!files.has(name)){if(!opts.create)throw missing();files.set(name,new Blob([]));}
 return {async createWritable(){let pending;return {async write(blob){if(failWrite)throw Error('disk full');pending=blob;},async close(){files.set(name,pending);},async abort(){aborted=true;}};},async getFile(){return files.get(name);}};
}};
const config={rootPath:'/Users/test/Projects/客户资料',handle:{name:'客户资料',async queryPermission(){return allow?'granted':'prompt';},async getDirectoryHandle(name,opts){assert.equal(name,'GXXE-10001');assert(opts.create);return directory;}}};
await assert.rejects(checkDirectory(null),e=>e.code==='DIRECTORY_REQUIRED');
allow=false;await assert.rejects(checkDirectory(config),e=>e.code==='DIRECTORY_REQUIRED');allow=true;
await assert.rejects(checkDirectory({...config,rootPath:'/tmp/Wrong'}),/不一致/);
const blob=new Blob(['zip-data']);
let result=await saveArchive(config,'GXXE-10001','GXXE-10001.zip',blob);
assert.equal(result.path,'/Users/test/Projects/客户资料/GXXE-10001/GXXE-10001.zip');assert.equal(result.bytes,8);
result=await saveArchive(config,'GXXE-10001','GXXE-10001.zip',blob);assert(result.path.endsWith('GXXE-10001 (2).zip'));assert.equal(files.size,2);
failWrite=true;await assert.rejects(saveArchive(config,'GXXE-10001','GXXE-10001.zip',blob),/disk full/);assert(aborted);
await assert.rejects(saveArchive(config,'../escape','GXXE-10001.zip',blob),/无效/);
console.log('PASS: first-use and expired directory grants, path checks, no overwrite, write failures, and saved byte count.');

failWrite=false;
const relative=await saveArchive({...config,rootPath:''},'GXXE-10001','GXXE-10001.zip',blob);
assert.equal(relative.path,null);assert(relative.relativePath.startsWith('GXXE-10001/'));assert(relative.displayPath.startsWith('客户资料/'));assert.equal(relative.pathSource,'relative-only');
console.log('PASS: arbitrary directory names and handle-only authorization work without a configured absolute path.');

const {saveExport} = await import('../src/directory-store.js');
let failExpanded = false;
function fakeDirectory(name) {
 const nodes = new Map();
 return {name,nodes,async queryPermission(){return 'granted';},
  async getDirectoryHandle(name,options={}) {
   if (!nodes.has(name)) {if(!options.create)throw missing();nodes.set(name,fakeDirectory(name));}
   return nodes.get(name);
  },
  async getFileHandle(name) {
   return {async createWritable(){let value;return {
    async write(blob){if(failExpanded && name==='issue.md')throw Error('disk full');value=blob;},
    async close(){nodes.set(name,value);},async abort(){}
   };},async getFile(){return nodes.get(name);}};
  }
 };
}
const root=fakeDirectory('Exports');
const exportConfig={handle:root,rootPath:'/tmp/Exports'};
const archive={files:[
 {name:'GXXE-10001/issue.md',data:'中文问题描述'},
 {name:'GXXE-10001/assets/log.rar',data:new Uint8Array([82,97,114,0,255])}
]};
const expanded=await saveExport(exportConfig,'GXXE-10001',archive);
assert.equal(expanded.path,'/tmp/Exports/GXXE-10001');assert(expanded.expanded);
const first=root.nodes.get('GXXE-10001');
assert.equal(await first.nodes.get('issue.md').text(),'中文问题描述');
assert.deepEqual(new Uint8Array(await first.nodes.get('assets').nodes.get('log.rar').arrayBuffer()),new Uint8Array([82,97,114,0,255]));
assert(!first.nodes.has('GXXE-10001.zip'));
assert.equal(expanded.bytes,new Blob(['中文问题描述']).size+5);
const again=await saveExport({...exportConfig,rootPath:''},'GXXE-10001',archive);
assert.equal(again.path,null);assert.equal(again.relativePath,'GXXE-10001 (2)');
await assert.rejects(saveExport(exportConfig,'GXXE-10001',{...archive,files:[{name:'GXXE-10001/../escape',data:'bad'}]}),/路径无效/);
assert.equal(root.nodes.size,2);
failExpanded=true;
await assert.rejects(saveExport(exportConfig,'GXXE-10001',archive),/部分文件可能已保存.*导出未完成/);
assert(!root.nodes.get('GXXE-10001 (3)').nodes.has('GXXE-10001.zip'));
console.log('PASS: expanded files preserve UTF-8 and binary data, copy folder path, omit ZIP, avoid overwrite, reject traversal, and report partial writes.');

// Removing a child must neither replace the stored parent handle nor request permission.
failExpanded=false;
root.nodes.delete('GXXE-10001');
const recreated=await saveExport(exportConfig,'GXXE-10001',archive);
assert.equal(recreated.path,'/tmp/Exports/GXXE-10001');
assert.equal(exportConfig.handle,root);
const permissionEvents=[];
await checkDirectory(exportConfig,async(event,details)=>permissionEvents.push({event,details}));
assert.equal(permissionEvents[0].details.directoryName,'Exports');
assert.equal(permissionEvents[0].details.permission,'granted');
await assert.rejects(checkDirectory({...exportConfig,handle:{...root,async queryPermission(){return 'prompt';}}},async(event,details)=>permissionEvents.push({event,details})),e=>e.code==='DIRECTORY_REQUIRED' && e.message.includes('Exports'));
assert.equal(permissionEvents.at(-1).details.permission,'prompt');
console.log('PASS: deleted export child is recreated under the same parent; permission diagnostics identify parent and Chrome state.');
for(const key of ['QHFG-10002','APP2-123']) {
 const saved=await saveExport(exportConfig,key,{files:[{name:`${key}/issue.md`,data:'description'}]});
 assert.equal(saved.path,`/tmp/Exports/${key}`);
}
for(const key of ['../QHFG-1','QHFG-1/escape','2026-01','QHFG-']) {
 await assert.rejects(saveExport(exportConfig,key,{files:[]}),/编号无效/);
}
const savedProgress=[];
await saveExport(exportConfig,'TEST-10003',{files:[{name:'TEST-10003/issue.md',data:'ok'},{name:'TEST-10003/assets/log.txt',data:'log'}]},async(done,total,name)=>savedProgress.push({done,total,name}));
assert.equal(savedProgress[0].done,0);assert.equal(savedProgress.at(-1).done,2);assert.equal(savedProgress.at(-1).total,2);
