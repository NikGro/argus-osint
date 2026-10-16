'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {routing,asset}=require('./frontend_modules.cjs');
const source=require('./frontend_source.cjs');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);const next=/\n(?:async )?function /.exec(source.slice(start+1));return source.slice(start,next?start+1+next.index:undefined);}
test('Routing accepts exact midpoint anchors for horizontal and vertical neighbors',()=>{
 const a={x:0,y:0,w:210,h:106},b={x:410,y:0,w:210,h:106},right=routing.connectionGeometry(a,b);assert.equal(right.sy,53);assert.equal(right.ty,53);assert.equal(right.c1y,53);assert.equal(right.c2y,53);
 const below=routing.connectionGeometry(a,{...b,x:0,y:306});assert.equal(below.sx,105);assert.equal(below.tx,105);
});
test('Centered default edge has room for its caption without an artificial bridge',()=>{
 const a={x:0,y:0,w:210,h:106},b={x:410,y:0,w:210,h:106};const result=routing.routeConnection(a,b,'Eingabe',[a,b],[],{},42);assert.equal(result.labelY,53);assert.equal(result.labelX,310);assert.ok(result.gap.half<45);
});
test('Batch ungroup retains all contents, reparents nested children and records one edit',()=>{
 const doc={nodes:[{id:'a'},{id:'b'}],groups:[{id:'outer',members:[]},{id:'inner',parent_id:'outer',members:['a']},{id:'leaf',parent_id:'inner',members:['b']}]};let edits=0;
 const c={project:{document:doc},selectedGroups:new Set(['outer','inner']),selectedGroup:'inner',orderedGroups:()=>doc.groups,change:()=>edits++,render(){},inspect(){}};
 vm.runInNewContext(fn('dissolveSelectedGroups')+'\ndissolveSelectedGroups();',c);assert.equal(doc.nodes.length,2);assert.equal(doc.groups.length,1);assert.equal(doc.groups[0].id,'leaf');assert.equal(doc.groups[0].parent_id,undefined);assert.equal(edits,1);
});
test('Plugin provider matching enables specialized actors and excludes Generic only while installed',()=>{
 const record={id:'instagram'},c={providerIndex:new Map([['instagram',record]]),providerSearchKey:s=>s.toLowerCase(),catalog:[{actions:[{providers:['instagram']}]}]};vm.runInNewContext(fn('actionAcceptsNode')+'\nthis.accepts=actionAcceptsNode;',c);
 const node={type:'profile',data:{provider:'instagram'}};assert.equal(c.accepts({inputs:['profile'],providers:['instagram']},node),true);assert.equal(c.accepts({inputs:['profile'],generic_profile:true},node),false);c.catalog=[];assert.equal(c.accepts({inputs:['profile'],generic_profile:true},node),true);assert.equal(c.accepts({inputs:['profile'],providers:['facebook']},node),false);
});
test('Long custom tags use their measured text width instead of a character quota',()=>{
 const c={appSettings:{tags:[{id:'custom',name:'Wide tag',color:'#ffaabb'}]},t:x=>x,measureEdgeText:s=>s.length*8};vm.runInNewContext(fn('nodeBadgeRows')+'\nthis.rows=nodeBadgeRows;',c);const rows=c.rows({type:'value',tags:['custom']},300),tag=rows.flat().find(item=>item.id==='custom');assert.ok(tag.w>=24+Math.ceil(8*8*10/11));
});
test('Every production module parses independently',()=>{
 for(const filename of ['ui.js','form-sections.js','graph-routing.js'])new vm.Script(asset(filename),{filename});
});

