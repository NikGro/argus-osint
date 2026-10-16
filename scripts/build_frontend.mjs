/** Deterministic production bundle also imported by the restricted Node test runner. */
import {build} from 'esbuild';
import prettier from 'prettier';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const digest=data=>createHash('sha256').update(data).digest('hex');
const result=await build({entryPoints:[path.join(root,'static/main.js')],bundle:true,format:'esm',target:'es2022',write:false});
const config=await prettier.resolveConfig(path.join(root,'static/app.js'));
const bundle=await prettier.format(result.outputFiles[0].text,{...config,filepath:'app.js'});
const sources={};
async function visit(directory){for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(!['app.js','build-manifest.json'].includes(entry.name)){sources[path.relative(root,file).split(path.sep).join('/')]=digest(await fs.readFile(file));}}}
await visit(path.join(root,'static'));
const manifest=JSON.stringify({sources,bundle_sha256:digest(bundle)},null,2)+'\n';
if(process.argv.includes('--check')){
 if(await fs.readFile(path.join(root,'static/app.js'),'utf8')!==bundle || await fs.readFile(path.join(root,'static/build-manifest.json'),'utf8')!==manifest)throw Error('Frontend bundle is stale; run npm run build');
}else{
 await fs.writeFile(path.join(root,'static/app.js'),bundle);
 await fs.writeFile(path.join(root,'static/build-manifest.json'),manifest);
}
