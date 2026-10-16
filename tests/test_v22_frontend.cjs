'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {asset}=require('./frontend_modules.cjs');
const manifest=require('./fixtures/frontend-manifest.json');
let modulesPromise;
function productionModules(){
 return modulesPromise??=(async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'argus-module-tests-'));
  process.on('exit',()=>fs.rmSync(directory,{recursive:true,force:true}));
  const files=['ui.js','i18n.js','icons.js','form-sections.js','graph-routing.js','phone-countries.js','location-countries.js','searchable-select.js','app/state.js','app/compose.js','app/labels.js',...manifest.features.map(name=>'app/'+name+'.js')];
  fs.writeFileSync(path.join(directory,'package.json'),'{"type":"module"}');
  for(const name of files){const target=path.join(directory,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,asset(name,true));}
  const load=async name=>import(pathToFileURL(path.join(directory,name)).href);
  const {createState}=await load('app/state.js'),{composeFeatures}=await load('app/compose.js');
  const features=await Promise.all(manifest.features.map(async name=>(await load('app/'+name+'.js')).default));
  return {createState,composeFeatures,features};
 })();
}
test('Actual production ES modules compose without window commands or an implicit import cycle',async()=>{
 const {createState,composeFeatures,features}=await productionModules();
 const app=composeFeatures(createState(),features);
 assert.equal(typeof app.run,'function');assert.equal(typeof app.render,'function');assert.equal(typeof app.renderGroups,'function');assert.equal(typeof app.renderEdges,'function');assert.equal(typeof app.renderNodes,'function');
 assert.equal(globalThis.run,undefined);assert.equal(globalThis.project,undefined);
});
test('Editor instances isolate selection, queue, history and form state',async()=>{
 const {createState}=await productionModules(),first=createState(),second=createState();
 first.selected.add('one');first.actorQueue.push({id:'a'});first.undoStack.push({});first.activePluginForms.set('one',{});
 assert.equal(second.selected.size,0);assert.equal(second.actorQueue.length,0);assert.equal(second.undoStack.length,0);assert.equal(second.activePluginForms.size,0);
});
test('Composition rejects missing and duplicate command contracts before initialization',async()=>{
 const {composeFeatures}=await productionModules();
 assert.throws(()=>composeFeatures({},[{dependencies:['missing'],create:()=>({})}]),/Missing application command/);
 assert.throws(()=>composeFeatures({},[{dependencies:[],create:()=>({same(){}})},{dependencies:[],create:()=>({same(){}})}]),/Duplicate application command/);
});
test('Production reconciliation preserves local edits and remote research in the same graph',async()=>{
 const {createState,composeFeatures,features}=await productionModules(),app=composeFeatures(createState(),features);
 const base={nodes:[{id:'a',label:'Old',data:{value:'base'}}],edges:[],groups:[],runs:[],preferences:{}};
 const local=structuredClone(base);local.nodes[0].label='Edited';local.preferences.dismissed=true;
 const remote=structuredClone(base);remote.nodes.push({id:'research',type:'value',data:{value:'Result'}});remote.edges.push({id:'e',source:'a',target:'research'});
 const merged=app.mergeDocuments(base,local,remote);
 assert.equal(merged.nodes[0].label,'Edited');assert.equal(merged.nodes[1].data.value,'Result');assert.equal(merged.edges.length,1);assert.equal(merged.preferences.dismissed,true);assert.equal(base.nodes[0].label,'Old');
});
test('Production resource actions reject script and data URLs',async()=>{
 const {createState,composeFeatures,features}=await productionModules(),app=composeFeatures(createState(),features);
 assert.equal(app.safeLink('javascript:alert(1)'),null);assert.equal(app.safeLink('data:text/html,test'),null);assert.equal(app.safeLink('https://example.invalid/profile'),'https://example.invalid/profile');
});
test('Real group detach preserves data and removes stale empty wrappers',async()=>{
 const {createState,features}=await productionModules(),state=createState();state.project={document:{nodes:[{id:'a',type:'value',x:0,y:0},{id:'b',type:'value',x:0,y:150}],edges:[],groups:[{id:'outer',members:['a']},{id:'inner',parent_id:'outer',members:['b']}]}};
 const feature=features.find(f=>f.name==='groups'),callbacks=Object.fromEntries(feature.dependencies.map(name=>[name,()=>{}]));
 callbacks.nodeRect=n=>({...n,w:210,h:76});callbacks.freeNodeSpot=rect=>rect;const groups=feature.create({appState:state,...callbacks});groups.detachNodes(['b']);
 assert.equal(state.project.document.nodes.length,2);assert.equal(state.project.document.groups.some(g=>g.id==='inner'),false);assert.deepEqual(state.project.document.groups[0].members,['a']);
});
