import assert from 'node:assert/strict';
import { matchesDownload, ROUTE_KEY } from '../download-match.js';
const now = Date.now();
const sourceUrl = 'https://www.teambition.com/project/example/task/example';
const expectedName = 'Logs__20260916_103825_&data_db.rar';
const pending = {sourceUrl, expectedName, startedAt:now, expires:now+45000, downloadId:null,filename:'Teambition/test/assets/001-log.rar'};
const item = {id:42,filename:'/Downloads/'+expectedName,startTime:new Date(now).toISOString(),referrer:sourceUrl,url:'https://files.example.test/download'};
assert(matchesDownload(item,pending,now));
assert(!matchesDownload({...item,filename:'another.rar'},pending,now));
assert(!matchesDownload({...item,referrer:'https://other.example/'},pending,now));
assert(!matchesDownload({...item,referrer:''},pending,now));
assert(matchesDownload({...item,referrer:'',url:'https://teambition-file.oss-cn-zhangjiakou.aliyuncs.com/test.rar'},pending,now));
assert(!matchesDownload({...item,referrer:'',url:'https://teambition.com.evil.example/test.rar'},pending,now));
assert(!matchesDownload(item,{...pending,expires:now-1},now));
assert(!matchesDownload(item,{...pending,downloadId:41},now));
assert(!matchesDownload({...item,startTime:new Date(now-60000).toISOString()},pending,now));
assert(!matchesDownload({...item,byExtensionId:'another-extension'},pending,now));
assert(!matchesDownload({...item,startTime:'invalid'},pending,now));
assert(matchesDownload({...item,filename:'C:\\Users\\Tester\\Downloads\\'+expectedName},pending,now));
const state = {[ROUTE_KEY]:pending};
const callbacks = {};
globalThis.chrome = {
 downloads:{onDeterminingFilename:{addListener(fn){callbacks.determine=fn;}}},
 storage:{session:{async get(key){return {[key]:state[key]};},async set(value){Object.assign(state,value);},async remove(key){delete state[key];}}},
 runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener(fn){callbacks.message=fn;}}},
 action:{onClicked:{addListener(fn){callbacks.action=fn;}}},
 scripting:{async executeScript(options){
   assert.equal(options.target.tabId,99);
   assert.equal(options.args[1],expectedName);
   return [{result:true}];
 }}
};
await import('../background.js');
const suggestion = await new Promise(resolve => callbacks.determine(item,resolve));
assert.equal(suggestion.filename,pending.filename);
assert.equal(state[ROUTE_KEY].downloadId,42);
const duplicate = await new Promise(resolve => callbacks.determine({...item,id:43},resolve));
assert.equal(duplicate,undefined);
state.sampleJob={tabId:99,data:{url:sourceUrl,nativeAttachments:[{name:expectedName,occurrence:0}]}};
const invoke = message => new Promise(resolve=>callbacks.message(message,{id:'test-extension',url:chrome.runtime.getURL('exporter.html?job=sampleJob')},resolve));
const response=await invoke({type:'start-native-download',job:'sampleJob',index:0,filename:'Teambition/test/assets/001-log.rar'});
assert(response.token && !response.error);
assert.equal(state[ROUTE_KEY].expectedName,expectedName);
const busy=await invoke({type:'start-native-download',job:'sampleJob',index:0,filename:'Teambition/test/assets/002-log.rar'});
assert(busy.error);
console.log('16 checks passed: filename/source/time matching, unrelated-download rejection, one-shot routing, and native-download start.');
