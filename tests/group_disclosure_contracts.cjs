'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const production=()=>import('data:text/javascript;base64,'+fs.readFileSync('static/app.js').toString('base64'));
async function fixture(){
 const m=await production(),state=m.createState();
 const group={id:'g',members:['inside'],collapsed:true};
 const inside={id:'inside',x:10,y:20},outside={id:'outside',x:10,y:30};
 state.workspaceState.project={id:'p',document:{nodes:[inside,outside],groups:[group]}};
 let inspected=0;
 const groups=m.groupsFeature.create({...state,change(){},render(){},inspect(){},inspectGroup(){inspected++;},makeRoomForGroup(){outside.y+=200;}});
 return {state,group,inside,outside,groups,inspected:()=>inspected};
}
test('Group disclosure preserves selection and reverses untouched automatic displacement',async()=>{
 const f=await fixture();f.state.selectionState.selected.add('outside');
 f.groups.toggleGroup(f.group);assert.equal(f.outside.y,230);assert.equal(f.inspected(),0);assert.deepEqual([...f.state.selectionState.selected],['outside']);
 f.groups.toggleGroup(f.group);assert.equal(f.outside.y,30);assert.equal(f.group.collapsed,true);
});
test('Closing a group does not undo subsequent manual movement',async()=>{
 const f=await fixture();f.groups.toggleGroup(f.group);f.inside.x+=10;f.groups.toggleGroup(f.group);
 assert.equal(f.inside.x,20);assert.equal(f.outside.y,230);
});
test('Expand/collapse all reverses an unchanged layout without changing selection',async()=>{
 const f=await fixture();f.groups.setAllGroups(false);assert.equal(f.outside.y,230);f.groups.setAllGroups(true);assert.equal(f.outside.y,30);assert.equal(f.inspected(),0);
});
