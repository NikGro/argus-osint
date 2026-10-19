'use strict';
// Import the actual shipped ESM bundle, including its real factory closures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
let modules;
const production=()=>modules??=import(require('node:url').pathToFileURL(path.join(__dirname,'../static/app.js')).href);
const doc=()=>({nodes:[],edges:[],groups:[],runs:[],report_notes:''});
function feature(module,name,state,ports={}){
 const descriptor=module[name];return descriptor.create({...state,...Object.fromEntries(descriptor.dependencies.map(key=>[key,()=>{}])),...ports});
}
test('Shipped application composes real modules without window commands',async()=>{
 const m=await production(),app=m.createApplication();
 assert.equal(typeof app.features.actors.run,'function');assert.equal(typeof app.features.canvasRenderer.render,'function');assert.equal(globalThis.run,undefined);
});
test('Domain stores are independent across editor instances',async()=>{
 const m=await production(),a=m.createState(),b=m.createState();
 a.selectionState.selected.add('a');a.executionState.actorQueue.push({});a.historyState.undoStack.push({});a.pluginsState.activePluginForms.set('a',{});
 assert.equal(b.selectionState.selected.size,0);assert.equal(b.executionState.actorQueue.length,0);assert.equal(b.historyState.undoStack.length,0);assert.equal(b.pluginsState.activePluginForms.size,0);
 assert.ok(Object.values(a).every(store=>Object.keys(store).length<=15));
});
test('Real UID factory supports LAN HTTP without randomUUID',async()=>{
 const m=await production(),app=m.createApplication();const old=globalThis.crypto;
 Object.defineProperty(globalThis,'crypto',{value:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},configurable:true});
 try{const ids=new Set(Array.from({length:1000},()=>app.features.shell.uid()));assert.equal(ids.size,1000);for(const id of ids)assert.match(id,/^[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/);}
 finally{Object.defineProperty(globalThis,'crypto',{value:old,configurable:true});}
});
test('Resource actions reject executable schemes and proxy remote previews',async()=>{
 const m=await production(),resources=m.createApplication().features.resources;
 assert.equal(resources.safeLink('javascript:alert(1)'),null);assert.equal(resources.safeLink('data:text/html,test'),null);
 assert.equal(resources.safeLink('https://example.invalid/profile'),'https://example.invalid/profile');
 assert.match(resources.safeResourceUrl('https://example.invalid/a.png'),/^\/api\/media\?url=/);
});
test('Real group detach preserves nodes and prunes empty nested wrappers',async()=>{
 const m=await production(),s=m.createState();s.workspaceState.project={document:{...doc(),nodes:[{id:'a',type:'value',x:0,y:0},{id:'b',type:'value',x:0,y:150}],groups:[{id:'outer',members:['a']},{id:'inner',parent_id:'outer',members:['b']}]}};
 const groups=feature(m,'groupsFeature',s,{nodeRect:n=>({...n,w:210,h:76}),freeNodeSpot:rect=>rect});groups.detachNodes(['b']);
 assert.equal(s.workspaceState.project.document.nodes.length,2);assert.equal(s.workspaceState.project.document.groups.some(g=>g.id==='inner'),false);assert.deepEqual(s.workspaceState.project.document.groups[0].members,['a']);
});
for(const side of ['left','right','top','bottom'])test('Manual '+side+' port remains on node boundary',async()=>{
 const {routing}=await production();const point=routing.portPosition({x:10,y:20,w:210,h:76},side);
 assert.ok(point.x>=10&&point.x<=220);assert.ok(point.y>=20&&point.y<=96);assert.ok([10,220].includes(point.x)||[20,96].includes(point.y));
});
test('Curve splitting preserves endpoints and shared midpoint',async()=>{
 const {routing}=await production(),points=[{x:0,y:0},{x:50,y:0},{x:50,y:100},{x:100,y:100}];
 const [left,right]=routing.splitCubic(points,.5);assert.deepEqual(left[0],points[0]);assert.deepEqual(right[3],points[3]);assert.deepEqual(left[3],right[0]);
});
function setupSave(m,api){
 const s=m.createState();s.workspaceState.project={id:'fixture',title:'Fixture',revision:1,document:doc()};s.workspaceState.lastServerSnapshot=structuredClone(doc());s.workspaceState.lastServerTitle='Fixture';s.persistenceState.dirty=true;
 const old=globalThis.document;globalThis.document={querySelectorAll:()=>[]};
 const impl=feature(m,'persistenceFeature',s,{$:()=>({value:'Fixture'}),api});
 return {s,impl,cleanup(){clearTimeout(s.persistenceState.autosaveTimer);globalThis.document=old;}};
}
test('Successful autosave advances baseline only to the canonical server result',async()=>{
 const m=await production(),saved={id:'fixture',title:'Fixture',revision:2,document:{...doc(),schema_version:1}};
 const {s,impl,cleanup}=setupSave(m,async(path,body)=>{assert.match(path,/\/reconcile$/);assert.equal(body.persist,true);return saved;});
 try{await impl.save();assert.equal(s.workspaceState.project.revision,2);assert.deepEqual(s.workspaceState.lastServerSnapshot,saved.document);assert.equal(s.persistenceState.dirty,false);}finally{cleanup();}
});
test('Failed autosave preserves baseline and unsaved edits for retry',async()=>{
 const m=await production(),{s,impl,cleanup}=setupSave(m,async()=>{throw Error('offline');});const before=structuredClone(s.workspaceState.lastServerSnapshot);
 try{await assert.rejects(impl.save(),/offline/);assert.deepEqual(s.workspaceState.lastServerSnapshot,before);assert.equal(s.persistenceState.dirty,true);}finally{cleanup();}
});
test('Archived workspace never submits edits',async()=>{
 const m=await production();let called=false;const {s,impl,cleanup}=setupSave(m,async()=>{called=true;});s.workspaceState.project.archived_at='fixture';
 try{await impl.save();assert.equal(called,false);}finally{cleanup();}
});
test('Every declared callback has an explicit composition owner',async()=>{
 const m=await production(),app=m.createApplication();
 for(const feature of Object.values(app.features))for(const callback of Object.values(feature))assert.equal(typeof callback,'function');
 assert.ok(app.features.groups && app.features.actors && app.features.tags); assert.equal(app.features.nodeRenderer,undefined);
});
