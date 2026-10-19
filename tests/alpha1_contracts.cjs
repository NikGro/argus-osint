const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const production=()=>import(require('node:url').pathToFileURL(require('node:path').resolve('static/app.js')).href);
test('Nested grouping retains complete selected subgroups',async()=>{
 const m=await production(),s=m.createState();
 s.workspaceState.project={document:{nodes:[{id:'a'},{id:'b'}],edges:[],groups:[{id:'one',members:['a']},{id:'two',members:['b']}],runs:[]}};
 s.selectionState.selected=new Set(['a','b']);
 const f=m.groupsFeature.create({...s,askText:async()=> 'Parent',uid:()=> 'parent',change(){},render(){},inspectGroup(){}});
 await f.createGroupFromSelection();
 const g=s.workspaceState.project.document.groups;
 assert.equal(g.length,3);assert.equal(g.find(x=>x.id==='one').parent_id,'parent');assert.deepEqual(g.find(x=>x.id==='one').members,['a']);
 assert.equal(g.find(x=>x.id==='two').parent_id,'parent');assert.deepEqual(g.find(x=>x.id==='parent').members,[]);
});
test('Fixed sockets keep curves attached to left inputs and right outputs',async()=>{
 const {routing:r}=await production(),a={x:0,y:0,w:200,h:100},b={x:500,y:0,w:200,h:100};
 const g=r.connectionGeometry(a,b);assert.equal(g.sx,200);assert.equal(g.tx,500);
 assert.deepEqual(r.portPosition(b,'left:0:2'),{x:500,y:100/3,nx:-1,ny:0});
 const paths=r.routeConnection(a,b,'Input',[],[],{target_port:'left:1:2'});assert.ok(paths.path.startsWith('M 200 50'));assert.ok(paths.path.endsWith('500 66.66666666666667'));
});
test('Workflow arrangements keep separate work-step clusters and preserve marker positions',async()=>{
 const m=await production(),s=m.createState(),n=(id,type,x)=>({id,type,x,y:0,data:{},w:210,h:100});
 const nodes=[n('seed','value',0),n('t1','actor',10000),n('r1','value',20000),n('t2','actor',30000),n('r2','value',40000),n('mark','marker',-500)];
 const edges=[['seed','t1'],['t1','r1'],['r1','t2'],['t2','r2']].map(([source,target])=>({source,target}));
 s.workspaceState.project={document:{nodes,edges,groups:[]}};
 const f=m.layoutFeature.create({...s,nodeRect:n=>n,orderedGroups:()=>[],change(){},render(){},$:()=>({click(){}})});
 for(const mode of ['grid','radial','hierarchical']) { f.arrangeProject(mode); assert.equal(nodes[5].x,-500);assert.ok(nodes[1].x<nodes[3].x);for(const node of nodes)assert.ok(Number.isFinite(node.x)&&Number.isFinite(node.y)); }
});
