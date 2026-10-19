const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const production=()=>import(pathToFileURL(require('node:path').resolve('static/app.js')).href);

test('Map preview priorities stay server-side while explicit quick actions retain their order',async()=>{
 const m=await production(),app=m.createApplication();
 app.state.pluginsState.dataTypes.set('location',{node:{map_preview_sources:[{id:'osm',enabled:true},{id:'google',enabled:true}],map_action_sources:[{id:'apple',enabled:true},{id:'google',enabled:false},{id:'osm',enabled:true}]}});
 const node={type:'location',data:{latitude:53.55,longitude:10}};
 const url=app.features.resources.mapsUrl(node,true);assert.match(url,/^\/api\/map-preview\?/);assert.match(url,/provider=osm/);
 assert.deepEqual(app.features.resources.resourceActions(node).map(item=>item.provider),['apple','osm']);
 assert.equal(app.features.resources.mapsUrl({type:'location',data:{}},true),null);
});
test('Clipboard remaps nested references but never rewrites research values',async()=>{
 const m=await production(),app=m.createApplication();
 const doc={nodes:[{id:'a',type:'value',data:{value:'a'},evidence:{}},{id:'b',type:'value',data:{value:'a'},evidence:{source_input:'a'}}],edges:[{id:'e',source:'a',target:'b'}],groups:[{id:'g',members:['a']},{id:'h',parent_id:'g',members:['b']}],runs:[]};
 const result=app.features.clipboard.remapDocument(doc,'origin');assert.notEqual(result.nodes[0].id,'a');assert.equal(result.nodes[1].data.value,'a');assert.equal(result.nodes[1].evidence.source_input,result.nodes[0].id);assert.equal(result.edges[0].target,result.nodes[1].id);assert.equal(result.groups[1].parent_id,result.groups[0].id);assert.equal(doc.nodes[0].id,'a');
});
test('Partial multi-image tool availability never accepts mixed types or excess inputs',async()=>{
 const m=await production(),app=m.createApplication(),action={inputs:['image'],min_inputs:2,max_inputs:2,same_type:true};
 const a={type:'image',data:{}},b={type:'image',data:{}},v={type:'video',data:{}};
 assert.equal(app.features.palette.actorIncompatible(action,[a],true),false);assert.equal(app.features.palette.actorIncompatible(action,[a]),true);assert.equal(app.features.palette.actorIncompatible(action,[a,b]),false);assert.equal(app.features.palette.actorIncompatible(action,[a,v],true),true);assert.equal(app.features.palette.actorIncompatible(action,[a,b,a]),true);
});
test('Preview geometry reserves space without modifying stored information',async()=>{
 const m=await production(),app=m.createApplication(),node={id:'v',type:'video',x:0,y:0,label:'Video',data:{file_id:'fixture'},display:{},tags:[]};
 app.features.tags.nodeBadgeHeight=()=>0;
 const compact=app.features.canvasRenderer.nodeRect(node);node.display.preview=true;const preview=app.features.canvasRenderer.nodeRect(node);assert.ok(preview.h>compact.h);assert.equal(preview.w,compact.w);assert.equal(node.data.file_id,'fixture');
});
test('Edited generated titles remain literal and default titles use one resolver',async()=>{
 const m=await production(),app=m.createApplication();
 const node={type:'value',label:'My exact title',data:{},evidence:{label_custom:true,label_key:'Neuer Wert',origin:'research'}};
 assert.equal(app.features.catalogue.nodeTitle(node),'My exact title');
});
test('Exact label masks preserve route geometry for long, steep and backwards connections',async()=>{
 const m=await production();for(const target of [{x:220,y:2000,w:210,h:76},{x:-500,y:20,w:210,h:76},{x:3500,y:40,w:210,h:76}]){
  const source={x:0,y:0,w:210,h:76},plain=m.routing.routeConnection(source,target,'A long label',[],[],{},120),masked=m.routing.routeConnection(source,target,'A long label',[],[],{label_clipping:'mask'},120);
  assert.equal(masked.path,plain.path);assert.ok(masked.maskBounds.w>0&&masked.maskBounds.h>0);assert.equal(masked.labelX,plain.labelX);
 }
});
