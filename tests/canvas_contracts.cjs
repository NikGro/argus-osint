const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const production=()=>import(require('node:url').pathToFileURL(require('node:path').resolve('static/app.js')).href);

test('Production composition wires viewport zoom through the actual canvas input',async()=>{
 const m=await production(), app=m.createApplication();
 let updates=0;
 app.features.canvasRenderer.renderViewport=()=>updates++;
 app.features.canvasInput.zoomAt(100,100,1.2);
 assert.equal(updates,1);
 assert.equal(app.state.canvasState.pan.scale,1.2);
});

test('Feature construction rejects missing callbacks before gestures can run',async()=>{
 const m=await production();
 assert.throws(()=>m.instantiateFeature({name:'fixture',dependencies:['viewport'],create(){}},{}),/fixture.*viewport/);
});

test('Composition callbacks reference existing feature methods',async()=>{
 const m=await production(),app=m.createApplication();
 const owners=new Set(Object.values(app.features).flatMap(feature=>Object.keys(feature)));
 for(const feature of Object.values(m).filter(value=>value&&Array.isArray(value.dependencies)&&typeof value.create==='function'))
  for(const name of feature.dependencies) assert.ok(owners.has(name),feature.name+': missing owner for '+name);

});

test('Settings load failure leaves the prior view intact',async()=>{
 const m=await production(),state=m.createState();let fail,shown=false;
 const response=new Promise((resolve,reject)=>fail=reject);
 const impl=m.settingsFeature.create({...state,leaveWorkspace:async()=>{},show:()=>{shown=true;},api:()=>response});
 const opening=impl.settingsHome();await Promise.resolve();await Promise.resolve();assert.equal(shown,false);
 fail(Error('offline fixture'));await assert.rejects(opening,/offline fixture/);assert.equal(shown,false);
});
