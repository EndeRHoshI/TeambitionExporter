import assert from 'node:assert/strict';
import { matchesDownload, ROUTE_KEY } from '../src/download-match.js';
const now = Date.now(), sourceUrl = 'https://www.teambition.com/project/example/task/example';
const expectedName = 'Logs__20000101_000000_&data_db.rar';
const pending = {job:'sampleJob',sourceUrl,expectedName,startedAt:now,expires:now+45000,downloadId:null};
const item = {id:42,filename:'/Downloads/'+expectedName,startTime:new Date(now).toISOString(),referrer:sourceUrl,url:'https://teambition-file.oss-cn-zhangjiakou.aliyuncs.com/example.rar'};
assert(matchesDownload(item,pending,now));
for (const changed of [{filename:'another.rar'},{referrer:'https://other.example/'},{startTime:new Date(now-60000).toISOString()},{byExtensionId:'another-extension'},{startTime:'invalid'}]) assert(!matchesDownload({...item,...changed},pending,now));
assert(!matchesDownload(item,{...pending,expires:now-1},now));
assert(!matchesDownload(item,{...pending,downloadId:41},now));
assert(matchesDownload({...item,referrer:''},pending,now));
assert(!matchesDownload({...item,referrer:'',url:'https://teambition.com.evil.example/test.rar'},pending,now));
const state = {[ROUTE_KEY]:pending}, callbacks = {}, order = [];
let failCancel=false, injection;
globalThis.chrome={
 downloads:{onDeterminingFilename:{addListener(fn){callbacks.determine=fn;}},async cancel(id){order.push('cancel:'+id);if(failCancel)throw Error('cancel rejected');}},
 storage:{session:{async get(key){return key===null?state:{[key]:state[key]};},async set(value){Object.assign(state,value);},async remove(key){delete state[key];}}},
 runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener(fn){callbacks.message=fn;}}},
 action:{onClicked:{addListener(fn){callbacks.action=fn;}}},
 scripting:{async executeScript(options){injection=options;assert.equal(options.target.tabId,99);assert.equal(options.args[2],expectedName);return [{result:true}];}}
};
chrome.runtime.onStartup={addListener(){}};
chrome.runtime.onInstalled={addListener(){}};
chrome.runtime.openOptionsPage=async()=>{};
chrome.alarms={onAlarm:{addListener(){}},async create(){},async clear(){}};
chrome.notifications={onClicked:{addListener(){}},onButtonClicked:{addListener(){}},async create(){},async clear(){}};
await import('../src/background.js');
const determine=item=>new Promise(resolve=>callbacks.determine(item,value=>{order.push('suggest:'+item.id);resolve(value);}));
await determine(item);
assert.deepEqual(order,['cancel:42','suggest:42']);
assert.equal(state[ROUTE_KEY].status,'resolved');
assert.equal(state[ROUTE_KEY].url,item.url);
await determine({...item,id:43});assert(!order.includes('cancel:43'));
state[ROUTE_KEY]={...pending};failCancel=true;
await determine({...item,id:44});assert.equal(state[ROUTE_KEY].status,'failed');
assert.equal(state[ROUTE_KEY].url,undefined);failCancel=false;
const blob='blob:chrome-extension://test-extension/zip-id';
state['prepared-download:'+blob]={job:'sampleJob',filename:'GXXE-10001/GXXE-10001.zip',expires:now+60000};
const suggestion=await determine({id:45,url:blob,filename:'zip-id',byExtensionId:'test-extension'});
assert.equal(suggestion.filename,'GXXE-10001/GXXE-10001.zip');
assert(!order.includes('cancel:45'));
state.sampleJob={tabId:99,data:{url:sourceUrl,issueKey:'GXXE-10001',nativeAttachments:[{name:expectedName,occurrence:0}]}};
const invoke=message=>new Promise(resolve=>callbacks.message(message,{id:'test-extension',url:chrome.runtime.getURL('src/exporter.html?job=sampleJob')},resolve));
const response=await invoke({type:'resolve-native-download',job:'sampleJob',index:0});assert(response.token && !response.error);
const invalid=await invoke({type:'prepare-download',job:'sampleJob',url:blob,filename:'../../evil.zip'});assert(invalid.error);
console.log('PASS: source matching, cancel-before-filename callback, failed cancellation, archive filename preservation, and path validation.');

let visibleKey='GXXE-99999',clicks=0;
globalThis.location={href:sourceUrl};
globalThis.getComputedStyle=()=>({visibility:'visible'});
const fileName={textContent:expectedName,getClientRects(){return [{}];}}; const download={click(){clicks++;}}; const file={parentElement:null,getClientRects(){return [{}];},querySelector(selector){return selector.includes('file-name')?fileName:download;}}; fileName.parentElement=file;
const root={getClientRects(){return [{}];},get innerText(){return visibleKey;},querySelectorAll(selector){return selector==='[data-clipboard-text]'?[{getAttribute(){return visibleKey;}}]:selector.includes('file-name')?[fileName]:[file];}};
globalThis.document={querySelectorAll(){return [root];}};
assert.throws(()=>injection.func(...injection.args),/另一条问题单/);assert.equal(clicks,0);
visibleKey='GXXE-10001';assert.equal(injection.func(...injection.args),true);assert.equal(clicks,1);
console.log('PASS: switching issues at the same version-library URL is detected before clicking an attachment.');
visibleKey='QHFG-10002';
assert.equal(injection.func(sourceUrl,'QHFG-10002',expectedName,0),true);
assert.throws(()=>injection.func(sourceUrl,'GXXE-10001',expectedName,0),/另一条问题单/);
