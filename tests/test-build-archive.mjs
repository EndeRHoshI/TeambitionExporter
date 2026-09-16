import assert from 'node:assert/strict';
import {buildArchive} from '../build-archive.js';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const snapshot={issueKey:'GXXE-10001',title:'title',text:'description',url:'https://www.teambition.com/task/test',assets:[{url:'https://example.com/image.png',selected:true}],nativeAttachments:[{name:'log.rar'}]};
const events=[];
const hooks={async log(event){events.push(event);},async progress(){},async resolveNative(i){assert.equal(i,0);return 'https://example.com/log.rar';},async diagnostics(){return {events};},async fetchAsset(){return {data:new Uint8Array([1,2,3]),bytes:3,mime:'application/octet-stream'};}};
const dir=await mkdtemp(join(tmpdir(),'tb-builder-'));
try{
 const result=await buildArchive(snapshot,hooks);assert(!result.incomplete);assert.equal(result.successful,2);
 assert.equal(result.blob,undefined);assert.equal(result.filename,undefined);
 const manifest=JSON.parse(result.files.find(file=>file.name==='GXXE-10001/manifest.json').data);
 assert.equal(manifest.complete,true);assert.equal(manifest.exportResults.length,2);assert.equal(manifest.version,'1.0.0');
 const partial=await buildArchive(snapshot,{...hooks,async resolveNative(){throw Error('timeout');}});
 assert(partial.incomplete);assert.equal(JSON.parse(partial.files.find(file=>file.name.endsWith('/manifest.json')).data).complete,false);assert.equal(partial.failed,1);
}finally{await rm(dir,{recursive:true,force:true});}
console.log('PASS: background archive contents, native attachment resolution, and partial exports marked incomplete.');
