import assert from 'node:assert/strict';
const callbacks={},session={},local={},badges=[],titles=[];
let documents=0, runs=0, directoryError=false;
const snapshot={issueKey:'GXXE-10001',text:'description',scope:'teambition-detail',assets:[],nativeAttachments:[]};
const storage=values=>({async get(key){return key===null?{...values}:{[key]:values[key]};},async set(v){Object.assign(values,v);},async remove(k){delete values[k];}});
globalThis.chrome={
 runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({version:'1.0.0'}),
  onMessage:{addListener(fn){callbacks.message=fn;}},async getContexts(){return documents?[{}]:[];},
  async sendMessage(msg){assert.equal(msg.target,'offscreen');assert.equal(msg.type,'run-export');runs++;
   if(directoryError)return {error:'请先设置 Documents',code:'DIRECTORY_REQUIRED'};
   return {path:'/Users/test/Documents/GXXE-10001/GXXE-10001.zip',bytes:100,copied:true,incomplete:false};}},
 offscreen:{async createDocument(options){assert.equal(options.url,'offscreen.html');assert.deepEqual(options.reasons,['BLOBS','CLIPBOARD']);documents++;}},
 action:{onClicked:{addListener(fn){callbacks.click=fn;}},async setBadgeText(v){badges.push(v.text);},async setTitle(v){titles.push(v.title);},async setBadgeBackgroundColor(){}},
 downloads:{onDeterminingFilename:{addListener(){}}},storage:{session:storage(session),local:storage(local)},
 scripting:{async executeScript(){return [{result:snapshot}];}},
 tabs:{async create(){throw Error('后台导出不应创建标签页');}}
};
chrome.runtime.onStartup={addListener(){}};
chrome.runtime.onInstalled={addListener(){}};
chrome.runtime.openOptionsPage=async()=>{};
chrome.alarms={onAlarm:{addListener(){}},async create(){},async clear(){}};
chrome.notifications={onClicked:{addListener(){}},onButtonClicked:{addListener(){}},async create(){},async clear(){}};
const {exportTab}=await import('../background.js');
const tab={id:5,windowId:7,url:'https://www.teambition.com/project/a/task/b'};
await exportTab(tab);assert.equal(local.lastExport.status,'complete');assert.equal(documents,1);assert.equal(runs,1);assert.equal(badges.at(-1),'');assert(!session.activeExport);
await exportTab(tab);assert.equal(documents,1);assert.equal(runs,2);
directoryError=true;await exportTab(tab);assert.equal(badges.at(-1),'');assert.equal(local.lastExport.code,'DIRECTORY_REQUIRED');assert(!session.activeExport);
directoryError=false;
for (const url of ['https://www.teambition.com/project/a/plugin/b/repo/c/version/d','https://teambition.com/project/a/plugin/b/repo/c/version/d']) {
 await exportTab({...tab,url});assert.equal(local.lastExport.status,'complete');
}
assert.equal(runs,5);
snapshot.scope='whole-page';await exportTab(tab);assert.equal(runs,5);assert.match(local.lastExport.error,/没有打开可识别/);snapshot.scope='teambition-detail';
snapshot.issueKey='';await exportTab(tab);assert.equal(runs,5);snapshot.issueKey='GXXE-10001';
await exportTab({...tab,url:'https://teambition.com.evil.example/task/b'});assert.equal(runs,5);
session.activeExport={job:'other',expires:Date.now()+60000};await exportTab(tab);assert.equal(runs,5);
console.log('PASS: no tabs created, offscreen reused, directory setup failure surfaced, duplicate export blocked.');

const {resetFeedback}=await import('../feedback.js');await resetFeedback();

delete session.activeExport;
let openedWindow;
chrome.windows={async get(id){assert.equal(id,7);return {left:-1400,top:40,width:1200,height:900};},async create(options){openedWindow=options;return {id:9};},async update(id,options){assert.equal(id,9);assert(options.focused);}};
await callbacks.click(tab);
assert.equal(openedWindow.type,'popup');assert(openedWindow.url.includes('save.html?token='));
assert.equal(session.pendingSave.tabId,5);
const savedToken=session.pendingSave.token;
await callbacks.click({...tab,id:6});assert.equal(session.pendingSave.token,savedToken);
console.log('PASS: toolbar opens one save window and retains original source tab when refocused.');
const invokeSave=(token,sender={id:'test',url:'chrome-extension://test/save.html?token='+token})=>new Promise(resolve=>{
 const accepted=callbacks.message({type:'start-selected-export',token},sender,resolve);
 if(accepted!==true)resolve({ignored:true});
});
assert((await invokeSave('wrong')).error.includes('失效'));
assert((await invokeSave(savedToken,{id:'other',url:'chrome-extension://test/save.html'})).ignored);
chrome.tabs.get=async id=>{assert.equal(id,5);return tab;};
const completed=await invokeSave(savedToken);assert.equal(completed.copied,true);
await resetFeedback();
console.log('PASS: only the current save window can start export; source tab is retrieved from the stored request.');

assert.equal(openedWindow.left,-1060);assert.equal(openedWindow.top,250);assert.equal(openedWindow.focused,true);assert(badges.every(text=>text===''));
