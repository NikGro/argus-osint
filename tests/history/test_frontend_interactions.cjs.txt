'use strict';
const assert = require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const {routing}=require('./frontend_modules.cjs');
const source=require('./frontend_source.cjs');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const groupHelpers=section('function groupDescendantIds(', 'async function createGroupFromSelection(');
function evaluate(code,context={}){context.ArgusRouting=routing;if(!context.measureEdgeText)context.measureEdgeText=text=>String(text).length*6;if(!context.nodeBadgeHeight)Object.assign(context,vm.runInNewContext(section('function nodeBadgeRows(', 'function renderNodeBadges(')+'\n({nodeBadgeRows,nodeBadgeHeight});',{appSettings:{tags:[]},t:x=>x,measureEdgeText:context.measureEdgeText}));if(!context.curvePath)Object.assign(context,vm.runInNewContext(section('function cubicPoint(', 'function routeConnection(')+'\n({curvePath,curveLabelGap});',{ArgusRouting:routing}));if(!context.automaticBoundary)context.automaticBoundary=vm.runInNewContext(section('function automaticBoundary(', 'function connectionGeometry(')+'\nautomaticBoundary;',{ArgusRouting:routing});if(!context.dataTypes)context.dataTypes=new Map();if(!context.newNodeLabel)context.newNodeLabel=()=>'';if(!context.mapSources)context.mapSources=()=>[{id:'google'},{id:'apple'},{id:'osm'}];if(!context.selectedEdges)context.selectedEdges=new Set();if(!context.resourceActions)context.resourceActions=vm.runInNewContext(section('function resourceActions(', 'function displayControls(')+'\nresourceActions;',{mapSources:context.mapSources});if(!context.measureEdgeText)context.measureEdgeText=text=>String(text).length*6;if(!context.locationDisplayLines)context.locationDisplayLines=vm.runInNewContext(section('function formatLocation(', 'function fitNodeText(')+'\nlocationDisplayLines;',{measureEdgeText:context.measureEdgeText,t:x=>x});if(!('selectedGroups' in context))context.selectedGroups=new Set();if(!('connecting' in context))context.connecting=null;if(!('cancelConnection' in context))context.cancelConnection=()=>{};return vm.runInNewContext(groupHelpers+code,context);}
test('Typed text fields preserve postal codes, coordinates and empty optional numbers',()=>{
 const read=evaluate(section('function readField(', 'function editFields(')+'\nreadField;',{fieldName:x=>x});
 assert.equal(read({type:'text',value:'00123'},'','postal_code'),'00123');
 assert.equal(read({type:'number',value:'0'},null,'latitude'),0);
 assert.equal(read({type:'number',value:''},null,'longitude'),null);
 assert.equal(read({type:'checkbox',checked:true},false,'enrich'),true);
 assert.equal(JSON.stringify(read({value:'GitHub\n\n Reddit '},[],'sites')),JSON.stringify(['GitHub','Reddit']));
});
test('Editing selected fields preserves unedited structured metadata',()=>{
 const apply=evaluate(section('function applyFields(', 'function toggleGroup(')+'\napplyFields;',{structuredClone});
 const input={value:'old',metadata:{id:'kept'},extra:{city:'old'}};
 const result=apply(input,[{path:['value'],read:()=> 'new'},{path:['extra','city'],read:()=> 'Hamburg'}]);
 assert.equal(result.metadata.id,'kept');assert.equal(result.extra.city,'Hamburg');assert.equal(input.value,'old');
});
test('Dragging a collapsed group moves all its members at the current zoom',()=>{
 const context={project:{document:{nodes:[{id:'a',x:20,y:30},{id:'b',x:100,y:90},{id:'outside',x:500,y:500}]}},drag:null,pinchGesture:null,gestureBlocked:false,pan:{scale:2},changed:0,render(){},change(){this.changed++}};
 context.change=()=>context.changed++;
 context.drag={kind:'group',positions:[{id:'a',x:20,y:30},{id:'b',x:100,y:90}],startX:0,startY:0,moved:false};
 evaluate(section('function updateDrag(', 'function inspect(')+'\nupdateDrag({clientX:100,clientY:40});',context);
 assert.deepEqual(context.project.document.nodes,[{id:'a',x:70,y:50},{id:'b',x:150,y:110},{id:'outside',x:500,y:500}]);
 assert.equal(context.changed,1);
});
test('Group toggles do not turn clicks into canvas dragging',()=>{
 let changes=0,renders=0,inspected=null;
 const toggle=evaluate(section('function toggleGroup(', 'function moveGroup(')+'\ntoggleGroup;',{busy:false,makeRoomForGroup:()=>{},change:()=>changes++,render:()=>renders++,inspectGroup:g=>inspected=g});
 const group={collapsed:true};toggle(group);assert.equal(group.collapsed,false);assert.equal(inspected,group);assert.equal(changes,1);assert.equal(renders,1);
 assert.ok(source.includes("event.target.closest('.node,.group')"));
 assert.ok(source.includes("toggle.addEventListener('pointerdown',e=>e.stopPropagation())"));
});
test('Home filters separate archived projects and normalize search accents',()=>{
 const search=evaluate(section('function searchText(', 'function renderProjects(')+'\nsearchText;');
 assert.equal(search('Québec'),'quebec');assert.equal(search('ARGUS'),'argus');
});
test('Cleanup produces distinct finite positions for cyclic graphs',()=>{
 const layout=evaluate(section('function layoutPositions(', 'function arrangeProject(')+'\nlayoutPositions;');
 const units=[{id:'a',w:220,h:76},{id:'b',w:220,h:76},{id:'c',w:220,h:76}];
 for(const mode of ['grid','radial','hierarchical']){const positions=layout(units,[['a','b'],['b','a']],mode);assert.equal(positions.size,3);assert.equal(new Set([...positions.values()].map(p=>`${p.x},${p.y}`)).size,3);for(const p of positions.values())assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
});
test('Clipboard remaps graph references without changing actual information values',()=>{
 let id=0;const remap=evaluate(section('function remapDocument(', 'function textEditing(')+'\nremapDocument;',{structuredClone,uid:()=> 'new'+(++id)});
 const doc={nodes:[{id:'a',data:{value:'a'}},{id:'b',data:{value:'b'}}],edges:[{id:'e',source:'a',target:'b'}],groups:[{id:'g',members:['a','b']}],runs:[]};
 const out=remap(doc,'origin');assert.equal(out.nodes[0].data.value,'a');assert.notEqual(out.nodes[0].id,'a');assert.equal(out.edges[0].source,out.nodes[0].id);assert.equal(out.groups[0].members[1],out.nodes[1].id);assert.equal(doc.nodes[0].id,'a');
});
test('Clipboard selection excludes unrelated nodes and crossing edges',()=>{
 const copy=evaluate(section('function clipboardDocument(', 'function remapDocument(')+'\nclipboardDocument;',{structuredClone});
 const doc={nodes:[{id:'a'},{id:'b'},{id:'c'}],edges:[{source:'a',target:'b'},{source:'b',target:'c'}],groups:[{id:'g',members:['a','b','c']}],runs:[]};
 const out=copy(doc,new Set(['a','b']));assert.equal(out.nodes.length,2);assert.equal(out.edges.length,1);assert.equal(out.groups[0].members.length,2);
});
test('Deleting a group removes its members and crossing edges, and undo restores everything',()=>{
 const original={nodes:[{id:'a',data:{}},{id:'b',data:{}},{id:'outside',data:{}}],edges:[{id:'e',source:'a',target:'b'},{id:'cross',source:'b',target:'outside'}],groups:[{id:'g',members:['a','b'],collapsed:true},{id:'other',members:['outside']}],runs:[]};
 const context={project:{title:'Test',document:structuredClone(original)},busy:false,selectedGroup:'g',selected:new Set(),structuredClone,undoStack:[],redoStack:[],lastSnapshot:{title:'Test',document:structuredClone(original)},lastHistoryScope:'',lastHistoryAt:0,historyMuted:false,dirtyNodes:new Set(),$(){return {value:'',disabled:false}},render(){},inspect(){},change(scope){context.recordHistory(scope)},t:x=>x};
 evaluate(section('function projectSnapshot(', 'function clipboardDocument(')+'\n'+section('function deleteGroup(', 'async function transform(')+'\nthis.recordHistory=recordHistory;deleteSelection();',context);
 assert.deepEqual(context.project.document.nodes.map(n=>n.id),['outside']);assert.equal(context.project.document.edges.length,0);assert.deepEqual(context.project.document.groups.map(g=>g.id),['other']);assert.equal(context.undoStack.length,1);
 evaluate("applyHistory('undo');",context);assert.deepEqual(context.project.document,original);
 evaluate("applyHistory('redo');",context);assert.equal(context.project.document.nodes.length,1);
});
test('Connection geometry attaches to the facing boundaries and centers labels on the curve',()=>{
 const geometry=evaluate(section('function connectionGeometry(', 'function render(')+'\nconnectionGeometry;');
 const a={x:0,y:0,w:210,h:76},right={x:500,y:0,w:210,h:76},down={x:0,y:300,w:210,h:76};
 const r=geometry(a,right);assert.equal(r.sx,210);assert.equal(r.tx,500);assert.equal(r.labelX,355);
 const d=geometry(a,down);assert.equal(d.sy,76);assert.equal(d.ty,300);assert.equal(d.labelX,105);assert.ok(Number.isFinite(d.labelY));
});
test('Concurrent document merge retains local edits and remote action results',()=>{
 const merge=evaluate(section('function mergeValue(', 'async function save(')+'\nmergeDocuments;',{structuredClone});
 const base={nodes:[{id:'a',label:'old',data:{unit:'1'}}],edges:[],groups:[],runs:[],report_notes:''},local=structuredClone(base),remote=structuredClone(base);
 local.nodes[0].label='edited';local.nodes[0].data.unit='2';remote.nodes[0].data.country='Germany';remote.runs.push({id:'run'});remote.nodes.push({id:'new',data:{}});
 const result=merge(base,local,remote);assert.equal(result.nodes[0].label,'edited');assert.equal(result.nodes[0].data.unit,'2');assert.equal(result.nodes[0].data.country,'Germany');assert.equal(result.nodes.length,2);assert.equal(result.runs.length,1);
});

test('Value editors expose the same single value field regardless of plugin output',()=>{
 const edit=evaluate(section('function editableNodeData(', 'function inspectorAvailability(')+'\neditableNodeData;',{templates:{value:{value:''},url:{value:''}},structuredClone});
 assert.equal(JSON.stringify(edit({type:'value',data:{value:'x',semantic_key:'legacy',width:12}})),JSON.stringify({value:'x'}));
 assert.equal(JSON.stringify(edit({type:'url',data:{value:'https://example.com',service:'legacy'}})),JSON.stringify({value:'https://example.com'}));
});
test('Selection rectangles select visible nodes and collapsed-group members and retain shift selection',()=>{
 const select=evaluate(section('function nodeRect(', 'function noteInk(')+section('function boxSelection(', 'function canvasPointerDown(')+'\nboxSelection;',{groupBounds:()=>({x:300,y:100,w:220,h:76})});
 const doc={nodes:[{id:'visible',x:0,y:0},{id:'hidden',x:999,y:999},{id:'outside',x:1000,y:0}],groups:[{id:'g',collapsed:true,members:['hidden']}]};
 const selected=select(doc,{x:0,y:0,w:400,h:150},new Set(['outside']));assert.deepEqual([...selected].sort(),['hidden','outside','visible']);
 assert.deepEqual([...select(doc,{x:600,y:200,w:20,h:20},new Set())],[]);
});
test('Zoom preserves the point under the cursor and clamps extreme zoom levels',()=>{
 const context={pan:{x:10,y:20,scale:1},render(){}};
 evaluate(section('function zoomAt(', 'function zoomStep(')+'\nzoomAt(100,100,2);',context);
 assert.equal(context.pan.scale,2);assert.equal((100-context.pan.x)/2,90);assert.equal((100-context.pan.y)/2,80);
 evaluate('zoomAt(100,100,99);',context);assert.equal(context.pan.scale,2.5);
 evaluate('zoomAt(100,100,0);',context);assert.equal(context.pan.scale,.15);
});
test('Two-finger gestures combine panning and zooming without moving data nodes',()=>{
 const context={pan:{x:10,y:20,scale:1},touchPointers:new Map(),pinchGesture:null,gestureBlocked:false,drag:{kind:'nodes'},render(){},removeSelectionFrame(){},$:()=>({getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){}})};
 evaluate(section('function touchMetrics(', 'function bind(')+'\nthis.handle=touchGestureEvent;',context);
 const event=(type,id,x,y)=>({type,pointerType:'touch',pointerId:id,clientX:x,clientY:y,stopImmediatePropagation(){},preventDefault(){}});
 context.handle(event('pointerdown',1,0,0));context.handle(event('pointerdown',2,100,0));assert.equal(context.drag,null);
 context.handle(event('pointermove',2,200,0));assert.equal(context.pan.scale,2);assert.equal(context.pan.x,20);assert.equal(context.pan.y,40);
 context.handle(event('pointerup',2,200,0));assert.equal(context.gestureBlocked,true);
 context.handle(event('pointerup',1,0,0));assert.equal(context.gestureBlocked,false);assert.equal(context.touchPointers.size,0);
});
test('The detail panel collapses with no selection and respects manual collapse until selection changes',()=>{
 const elements={};for(const id of ['palette','leftResize','inspector','rightResize','toggleLeft','toggleRight'])elements[id]={hidden:false,textContent:'',disabled:false,setAttribute(){},replaceChildren(){}};
 const context={icon:()=>({}),$:id=>elements[id],leftCollapsed:false,rightCollapsed:true,inspectorSelectionKey:''};
 evaluate(section('function inspectorAvailability(', 'function zoomAt(')+'\ninspectorAvailability("node1");',context);assert.equal(elements.inspector.hidden,false);
 context.rightCollapsed=true;evaluate('inspectorAvailability("node1");',context);assert.equal(elements.inspector.hidden,true);
 evaluate('inspectorAvailability("node2");',context);assert.equal(elements.inspector.hidden,false);
 evaluate('inspectorAvailability("");',context);assert.equal(elements.inspector.hidden,true);assert.equal(elements.toggleRight.disabled,true);
});

test('Centering puts the exact center of a single node at the viewport center',()=>{
 const fit=evaluate(section('function fitViewport(', 'function centerProject(')+'\nfitViewport;');
 const rect={x:160,y:130,w:210,h:76},view=fit([rect],1200,600);
 assert.equal(view.x+(rect.x+rect.w/2)*view.scale,600);assert.equal(view.y+(rect.y+rect.h/2)*view.scale,300);
 const note={x:-200,y:-50,w:600,h:400},n=fit([note,rect],1200,600);
 for(const r of [note,rect]){assert.ok(n.x+r.x*n.scale>=39.999);assert.ok(n.y+r.y*n.scale>=39.999);assert.ok(n.x+(r.x+r.w)*n.scale<=1160.001);assert.ok(n.y+(r.y+r.h)*n.scale<=560.001);}
});
test('Notes use their own geometry and resize without altering their text',()=>{
 const geometry=evaluate(section('function nodeRect(', 'function noteInk(')+'\nnodeRect;');
 const node={id:'n',type:'note',x:10,y:20,data:{text:'kept'},appearance:{width:320,height:180,color:'#ffcc70'}};assert.equal(geometry(node).w,320);
 const context={drag:{kind:'note-resize',id:'n',startX:0,startY:0,width:320,height:180,moved:false},pan:{scale:2},pinchGesture:null,gestureBlocked:false,project:{document:{nodes:[node]}},change(){},render(){}};
 evaluate(section('function updateDrag(', 'function inspect(')+'\nupdateDrag({clientX:100,clientY:80});',context);
 assert.equal(node.appearance.width,370);assert.equal(node.appearance.height,220);assert.equal(node.data.text,'kept');
});
test('Real status states distinguish offline, saving, running and saved',()=>{
 const elements={statusLight:{dataset:{}},statusText:{},status:{}},context={$:id=>elements[id],t:x=>x,backendOnline:false,backendCheckAt:null,saveError:'',settingsError:'',savePromise:null,settingsPromise:null,pendingPluginSaves:new Set(),activeActors:new Set(),dirty:false,settingsDirty:false,project:null};
 evaluate(section('function updateStatus(', 'async function checkBackend(')+'\nupdateStatus();',context);assert.equal(elements.statusLight.dataset.state,'red');
 context.backendOnline=true;evaluate('updateStatus();',context);assert.equal(elements.statusLight.dataset.state,'green');
 context.savePromise={};evaluate('updateStatus();',context);assert.equal(elements.statusLight.dataset.state,'yellow');assert.equal(elements.statusText.textContent,'Speichert …');
 context.savePromise=null;context.activeActors.add('actor');evaluate('updateStatus();',context);assert.equal(elements.statusLight.dataset.state,'green');
});
test('New data nodes receive type-specific names',()=>{
 const label=evaluate(section('function newNodeLabel(', 'function nodeRect(')+'\nnewNodeLabel;',{t:x=>x});
 assert.equal(label('email'),'Neue E-Mail');assert.equal(label('location'),'Neuer Ort');assert.equal(label('phone'),'Neue Telefonnummer');
});

test('Edge label routing leaves room for the edit icon and avoids nodes and other labels',()=>{
 const context={};evaluate(section('function connectionGeometry(', 'function render(')+section('function intersects(', 'function routeConnection(')+source.slice(source.indexOf('function routeConnection('))+'\nthis.route=routeConnection;',context);
 const a={x:0,y:0,w:210,h:76},b={x:320,y:0,w:210,h:76},labels=[];
 context.route(a,b,'Eingabe',[a,b],labels);context.route(a,b,'Langer Beziehungstext',[a,b],labels);
 assert.equal(labels.length,2);assert.ok(!context.intersects(labels[0],labels[1],8));for(const l of labels)for(const n of [a,b])assert.ok(!context.intersects(l,n,8));
});
test('Selecting a group supplies its data members to actor compatibility checks',()=>{
 const context={project:{document:{nodes:[{id:'email',type:'email'},{id:'actor',type:'actor'},{id:'other',type:'url'}],groups:[{id:'group',members:['email','actor']}]}},selectedGroup:'group',selected:new Set()};
 evaluate(section('function selectedData(', 'function actorTitle(')+'\nthis.inputs=selectedData();',context);assert.deepEqual(Array.from(context.inputs,n=>n.id),['email']);
});
test('Touch palette dragging creates a drop at the released canvas position',()=>{
 const handlers={},button={style:{},dataset:{},disabled:false,textContent:'E-Mail',setPointerCapture(){},closest(){return null;},addEventListener(n,f){handlers[n]=f;}};let dropped=null;
 const ghost={style:{},remove(){}},context={el:()=>ghost,document:{body:{append(){}},elementFromPoint(){return{closest(){return true;}};}},setTimeout(){},dropPalette:e=>dropped=e};
 evaluate(section('function touchPaletteDrag(', 'function makeRoomForGroup(')+'\nthis.attach=touchPaletteDrag;',context);context.attach(button,{kind:'node',type:'email'});
 handlers.pointerdown({pointerType:'touch',pointerId:1,clientX:0,clientY:0});handlers.pointermove({pointerId:1,clientX:200,clientY:150,preventDefault(){}});handlers.pointerup({type:'pointerup',clientX:240,clientY:160,preventDefault(){}});
 assert.equal(dropped.clientX,240);assert.equal(JSON.parse(dropped.dataTransfer.getData()).type,'email');assert.equal(button.dataset.suppressClick,'1');
});
test('Log search and export input rows are scoped to the current project',()=>{
 const elements={logsSearch:{value:'timeout'}},context={project:{document:{runs:[{id:'1',started_at:'now',plugin:'holehe',action:'lookup',status:'failed',error:'Timeout on provider'},{id:'2',started_at:'now',plugin:'x',action:'y',status:'completed'}]}},$:id=>elements[id],searchText:x=>x.toLowerCase()};
 evaluate(section('function logRows(', 'function renderLogs(')+'\nthis.rows=logRows();',context);assert.equal(context.rows.length,1);assert.equal(context.rows[0].run,'1');
});

test('New nodes avoid existing data and actor rectangles',()=>{
 const context={project:{document:{nodes:[{id:'a',x:0,y:0,type:'email'},{id:'b',x:0,y:111,type:'actor'}],groups:[]}},nodeRect:n=>({...n,w:210,h:76})};
 evaluate(section('function intersects(', 'function routeConnection(')+source.slice(source.indexOf('function freeNodeSpot('))+'\nthis.spot=freeNodeSpot({x:0,y:0,w:210,h:76});',context);assert.equal(context.spot.x,0);assert.ok(context.spot.y>=222);
});

test('Zoom buttons use the next fixed five-percent step while preserving manual values',()=>{
 const next=evaluate(section('function nextZoomPercent(', 'function frameRect(')+'\nnextZoomPercent;');
 assert.equal(next(101,1),105);assert.equal(next(101,-1),100);assert.equal(next(100,1),105);assert.equal(next(100,-1),95);assert.equal(next(15,-1),15);assert.equal(next(250,1),250);
});
test('Deeply nested groups compute bounds and collapsed visibility without recursion',()=>{
 const groups=Array.from({length:600},(_,i)=>({id:'g'+i,members:i?[]:['n'],...(i<599?{parent_id:'g'+(i+1)}:{}),collapsed:false}));
 const context={project:{document:{nodes:[{id:'n',type:'email',x:100,y:100}],groups}},groupBoundsCache:null};
 evaluate(section('function nodeRect(', 'function noteInk(')+section('function groupBounds(', 'function connectionGeometry(')+'\nthis.bounds=groupBounds(project.document.groups[599]);',context);
 assert.equal(context.bounds.x,100-20*600);assert.equal(context.bounds.y,100-42*600);
 context.project.document.groups[599].collapsed=true;evaluate('this.hidden=hiddenGroupIds();this.nodes=groupNodeIds(project.document.groups[599]);',context);assert.equal(context.hidden.size,599);assert.deepEqual([...context.nodes],['n']);
});
test('Nested clipboard selection retains ancestors and remaps group parent references',()=>{
 let n=0;const context={structuredClone,uid:()=> 'new'+(++n)};
 const copy=evaluate(section('function clipboardDocument(', 'function remapDocument(')+'\nclipboardDocument;',context),remap=evaluate(section('function remapDocument(', 'function textEditing(')+'\nremapDocument;',context);
 const doc={nodes:[{id:'n'},{id:'other'}],edges:[],groups:[{id:'root',members:[]},{id:'child',parent_id:'root',members:['n']}],runs:[]};
 const out=remap(copy(doc,new Set(['n'])),'test');assert.equal(out.groups.length,2);assert.equal(out.groups[1].parent_id,out.groups[0].id);assert.equal(out.groups[1].members[0],out.nodes[0].id);
});
test('Wrapping a selected group creates a real parent and preserves child contents',async()=>{
 const group={id:'child',members:['n'],collapsed:true},context={project:{document:{nodes:[{id:'n',type:'email'}],groups:[group]}},selected:new Set(),selectedGroups:new Set(['child']),selectedGroup:'child',askText:async()=> 'Parent',t:x=>x,uid:()=> 'parent',change(){},render(){},inspectGroup(){}};
 evaluate(section('async function createGroupFromSelection(', 'function portPosition(')+'\nthis.create=createGroupFromSelection;',context);await context.create();assert.equal(group.parent_id,'parent');assert.equal(context.project.document.groups.length,2);assert.equal(context.project.document.groups[1].members.length,0);
});
test('Dock snapping chooses a visible target and honors explicit edge ports',()=>{
 const context={};evaluate(section('function nodeRect(', 'function noteInk(')+section('function portPosition(', 'function nodeIcon(')+section('function nearestConnectionTarget(', 'function updateConnection(')+section('function connectionGeometry(', 'function render(')+'\nthis.nearest=nearestConnectionTarget;this.geometry=connectionGeometry;',context);
 const nodes=[{id:'a',type:'email',x:0,y:0},{id:'b',type:'email',x:400,y:0},{id:'hidden',type:'email',x:210,y:0}];const snap=context.nearest({x:392,y:38},'a',nodes,new Set(['a','b']),1);assert.equal(snap.node,'b');assert.equal(snap.side,'left');assert.equal(context.nearest({x:900,y:400},'a',nodes,new Set(['a','b']),1),null);
 const g=context.geometry({x:0,y:0,w:210,h:76},{x:400,y:0,w:210,h:76},'top','bottom');assert.equal(g.sy,0);assert.equal(g.ty,76);
});
test('Optional previews enlarge node geometry and location links prefer exact coordinates',()=>{
 const context={};evaluate(section('function nodeRect(', 'function noteInk(')+section('function locationQuery(', 'function openNodeResource(')+'\nthis.rect=nodeRect;this.url=mapsUrl;',context);
 assert.equal(context.rect({type:'location',x:0,y:0,display:{map:true,mapsButton:true}}).h,370);assert.equal(context.rect({type:'image',x:0,y:0,display:{preview:true,imageButton:true}}).h,272);
 assert.match(context.url({data:{latitude:53.55,longitude:10,formatted_address:'Hamburg'}}),/53.55%2C10/);assert.match(context.url({data:{latitude:null,longitude:null,locality:'Hamburg'}},true),/output=embed/);
});

test('Enabling a large node preview moves neighboring groups as one unit',()=>{
 const context={project:{document:{nodes:[{id:'map',type:'location',x:0,y:0,display:{map:true}},{id:'a',type:'email',x:100,y:200},{id:'b',type:'email',x:100,y:311}],groups:[{id:'other',members:['a','b'],collapsed:true}]}},groupBoundsCache:null};
 evaluate(section('function nodeRect(', 'function noteInk(')+section('function groupBounds(', 'function connectionGeometry(')+section('function intersects(', 'function routeConnection(')+section('function makeRoomForGroup(', 'function resizePaletteSplit(')+'\nmakeRoomForNode(project.document.nodes[0]);',context);
 const [map,a,b]=context.project.document.nodes;assert.ok(a.y>300);assert.equal(b.y-a.y,111);assert.equal(map.x,0);assert.equal(map.y,0);
});
