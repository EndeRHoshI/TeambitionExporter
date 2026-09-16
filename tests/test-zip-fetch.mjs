import assert from 'node:assert/strict';
import { createZip, crc32 } from '../zip.js';
import { fetchFile } from '../fetch-file.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const bytes=new TextEncoder().encode('123456789');
assert.equal(crc32(bytes),0xcbf43926);
assert.throws(()=>createZip([{name:'../escape',data:bytes}]));
assert.throws(()=>createZip([{name:'same',data:bytes},{name:'same',data:bytes}]));
const folder=await mkdtemp(join(tmpdir(),'tb-zip-test-'));
try {
 const p=join(folder,'GXXE-10001.zip');
 await writeFile(p,new Uint8Array(await createZip([{name:'GXXE-10001/issue.md',data:'测试描述'},{name:'GXXE-10001/assets/log.rar',data:bytes}]).arrayBuffer()));
 const check=spawnSync('unzip',['-t',p],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr || check.stdout);
 assert.equal(spawnSync('unzip',['-p',p,'GXXE-10001/issue.md'],{encoding:'utf8'}).stdout,'测试描述');
 assert.deepEqual(new Uint8Array(spawnSync('unzip',['-p',p,'GXXE-10001/assets/log.rar']).stdout),bytes);
} finally {await rm(folder,{recursive:true,force:true});}
const reply=(body,headers,status=200)=>async()=>new Response(body,{status,headers});
await assert.rejects(fetchFile('https://example.com/log',{maxBytes:100,fetchImpl:reply('login',{'content-type':'text/html'})}),/网页/);
await assert.rejects(fetchFile('https://example.com/log',{maxBytes:100,fetchImpl:reply('<html>login',{'content-type':'application/octet-stream'})}),/HTML/);
await assert.rejects(fetchFile('https://example.com/log',{maxBytes:4,fetchImpl:reply('12345',{})}),/限额/);
await assert.rejects(fetchFile('https://example.com/log',{maxBytes:100,fetchImpl:reply('failed',{},403)}),/403/);
await assert.rejects(fetchFile('https://example.com/log',{maxBytes:100,expectedName:'log.rar',fetchImpl:reply('wrong',{})}),/RAR/);
const result=await fetchFile('https://example.com/log',{maxBytes:100,expectedName:'log.rar',fetchImpl:reply('Rar!test',{'content-type':'application/x-rar'})});
assert.equal(result.bytes,8);
console.log('PASS: standard unzip interoperability, CRC32, safe paths, HTTP/HTML/RAR validation, and streaming size limit.');
