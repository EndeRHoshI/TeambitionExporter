import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
function img(name,{width=24,height=24,natural=581,rich=false,avatar=false,article=false}={}) {
 return {src:'https://example.com/'+name,currentSrc:'https://example.com/'+name,className:'',naturalWidth:natural,naturalHeight:natural,
 getClientRects(){return [{}];},getBoundingClientRect(){return {width,height};},getAttribute(){return null;},
 matches(){return rich;},closest(selector){return selector.includes('avatar')?(avatar?{}:null):(article?{}:null);}};
}
const images=[img('lADPDg7mW0kl4HPNAkXNAkU_581_581.jpg'),img('face.jpg',{width:240,height:240,avatar:true}),img('small-screenshot.png',{width:43,height:96,rich:true}),img('comment.png',{width:80,height:60,article:true}),img('large-screenshot.jpg',{width:400,height:300})];
const root={innerText:'GXXE-10001 description',getClientRects(){return [{}];},querySelector(){return {textContent:'Issue title'};},querySelectorAll(selector){return selector==='img'?images:selector==='[data-clipboard-text]'?[{getAttribute(){return 'GXXE-10001';}}]:[];}};
const document={body:root,title:'Issue',querySelectorAll(selector){return selector==='#root-detail'?[root]:[];}};
const result=vm.runInNewContext(await readFile(new URL('../src/extractor.js',import.meta.url),'utf8'),{document,location:{href:'https://www.teambition.com/project/a/task/b'},getComputedStyle(){return {visibility:'visible'};},URL});
assert.equal(result.assets.find(a=>a.url.endsWith('lADPDg7mW0kl4HPNAkXNAkU_581_581.jpg')).selected,false);
assert(!result.assets.some(a=>a.url.endsWith('face.jpg')));
assert(result.assets.find(a=>a.url.endsWith('small-screenshot.png')).selected);
assert(result.assets.find(a=>a.url.endsWith('comment.png')).selected);
assert(result.assets.find(a=>a.url.endsWith('large-screenshot.jpg')).selected);
assert.equal(result.assets.filter(a=>a.selected).length,3);
console.log('PASS: large-source tiny avatars excluded; small rich-text screenshots, comment images and displayed photos retained.');
const code=await readFile(new URL('../src/extractor.js',import.meta.url),'utf8');
for (const key of ['GXXE-10001','QHFG-10002','APP2-123']) {
 root.querySelectorAll=selector=>selector==='[data-clipboard-text]'?[{getAttribute(){return key;}}]:[];
 root.innerText='关联 GXXE-99999';
 const read=()=>vm.runInNewContext(code,{document,location:{href:'https://www.teambition.com/project/a/task/b'},getComputedStyle(){return {visibility:'visible'};},URL});
 assert.equal(read().issueKey,key);
 root.querySelectorAll=()=>[];root.innerText=key+' description';assert.equal(read().issueKey,key);
}
