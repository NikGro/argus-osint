const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const {default: module} = await import('data:text/javascript;base64,'+fs.readFileSync('static/app/layout.js').toString('base64'));
 const nodes = Array.from({length:12},(_,i)=>({id:'n'+i,x:i*10000,y:-i*2000,w:i%3?220:500,h:i%4?90:210,evidence:{run_id:'r'+i}}));
 const state={project:{document:{nodes,groups:[],edges:[],runs:[]}}};
 const layout=module.create({workspaceState:state,persistenceState:{},canvasState:{},$:()=>({click(){},open:true}),change(){},render(){},nodeRect:n=>n,orderedGroups:()=>[]});
 for(const mode of ['grid','radial']){
  layout.arrangeProject(mode);
  const first=nodes.map(n=>[n.x,n.y]);
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i],b=nodes[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,mode+' overlap');
  }
  assert.ok(Math.max(...nodes.map(n=>n.x))-Math.min(...nodes.map(n=>n.x))<6000,'Old positions must not spread layout');
  layout.arrangeProject(mode);nodes.forEach((n,i)=>{assert.ok(Math.abs(n.x-first[i][0])<1e-8);assert.ok(Math.abs(n.y-first[i][1])<1e-8);});
 }
 console.log('Grid and circle: varied-size collision checks, old-coordinate independence and idempotence passed.');
})().catch(e=>{console.error(e);process.exit(1)});
