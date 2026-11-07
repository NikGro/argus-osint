const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const production=()=>import(require('node:url').pathToFileURL(require('node:path').resolve('static/app.js')).href);

test('Production composition wires viewport zoom through the actual canvas input',async()=>{
 let updates=0;
 const m=await production(), app=m.createApplication(undefined,{renderViewport:()=>updates++});
 app.features.canvasInput.zoomAt(100,100,1.2);
 assert.equal(updates,1);
 assert.equal(app.state.canvasState.pan.scale,1.2);
});

test('Default zoom shows 100 % at the smaller working scale',async()=>{
 const zoom=await import(require('node:url').pathToFileURL(require('node:path').resolve('static/app/zoom.js')).href);
 const m=await production(), app=m.createApplication(undefined,{renderViewport(){}});
 assert.equal(app.state.canvasState.pan.scale,zoom.ZOOM_BASE);
 assert.equal(Math.round(zoom.scaleToPercent(app.state.canvasState.pan.scale)),100);
 app.features.canvasInput.zoomAt(0,0,99);
 assert.equal(app.state.canvasState.pan.scale,zoom.MAX_SCALE);
});

test('Feature construction rejects missing callbacks before gestures can run',async()=>{
 const m=await production();
 assert.throws(()=>m.instantiateFeature({name:'fixture',dependencies:['viewport'],create(){}},{}),/fixture.*viewport/);
});

test('Composition callbacks reference existing feature methods',async()=>{
 const m=await production(),app=m.createApplication();
 const owners=new Set([...Object.values(app.features).flatMap(feature=>Object.keys(feature)),...m.viewCommands]);
 for(const feature of Object.values(m).filter(value=>value&&Array.isArray(value.dependencies)&&typeof value.create==='function'))
  for(const name of feature.dependencies) assert.ok(owners.has(name),feature.name+': missing owner for '+name);

});

test('View commands are supplied by the view, not implemented by features',async()=>{
 const m=await production(),app=m.createApplication();
 for(const name of m.viewCommands) assert.equal(Object.values(app.features).some(feature=>name in feature),false,name);
});
