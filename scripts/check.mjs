import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for (const folder of ['src','scripts']) {
 for (const name of readdirSync(resolve(root,folder))) {
  if (!/\.(?:js|mjs)$/.test(name)) continue;
  const result=spawnSync(process.execPath,['--check',resolve(root,folder,name)],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
 }
}
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
for (const path of [manifest.background.service_worker,manifest.options_ui.page,...Object.values(manifest.icons),...Object.values(manifest.action.default_icon)]) {
 assert(existsSync(resolve(root,path)),`Missing manifest resource: ${path}`);
}
for (const name of readdirSync(resolve(root,'src'))) {
 const text=readFileSync(resolve(root,'src',name),'utf8');
 const references=name.endsWith('.html')?[...text.matchAll(/<script[^>]+src="([^"]+)"/g)]:[...text.matchAll(/(?:from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/g)];
 for (const [,path] of references)assert(existsSync(resolve(root,'src',path)),`Missing resource in ${name}: ${path}`);
}
console.log('Syntax, manifest resources, HTML scripts and module imports verified.');
