// Shipped application, fixture API only; no account queries or real project changes.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const deepface=JSON.parse(require('node:child_process').execFileSync(process.env.ARGUS_PYTHON || 'python',['-c','import json;from plugins.deepface_tool import PLUGIN;print(json.dumps(PLUGIN))'],{encoding:'utf8'}));
 let lastSettings=null;
 const makeTool=(id,x)=>({id,type:'actor',label:'Username recherchieren',x,y:0,data:{plugin:'username',action:'lookup',params:{run_timeout:300,max_results:500,search_profiles:{consensus:[{id:'top:50'}],blackbird:[]}}},evidence:{},report:true});
 const dataPlugins=require('./ui_data_plugins.json');const nodeDefaults=Object.fromEntries(dataPlugins.flatMap(p=>p.nodes.map(n=>[n.type,n.defaults])));
 const project={id:'fixture',title:'Profil-Recherche',revision:1,document:{nodes:[{...makeTool('deep',600),data:{plugin:'deepface',action:'verify',params:deepface.actions[0].default_params}},makeTool('search1',0),makeTool('search2',300),{id:'input',type:'username',label:'Testname',x:0,y:250,data:{value:'fixture'},tags:['review'],evidence:{},verification:'unverified',report:true}],edges:[{id:'link',source:'search1',target:'search2',label:'Ergebnis'}],groups:[],runs:[],report_notes:''}};
 const plugin={id:'username',name:'Username',actions:[{id:'lookup',name:'Username recherchieren',inputs:['username'],settings_only:[],research_profiles:{consensus:[{id:'top:50',label:'Top 50',top:50},{id:'tag:social',label:'Social media',tag:'social'}],blackbird:[]},default_params:{search_profiles:{},use_consensus:true,use_blackbird:false,run_timeout:300,max_results:500,consensus_sites:[]}}]};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  const json=body=>route.fulfill({json:body});
  if(u.pathname==='/api/auth/session')return json({csrf_token:'fixture'});
  if(u.pathname==='/api/settings')return json({settings:{language:'de',tags:[{id:'review',name:'Prüfen',color:'#ff9d45'}]}});
  if(u.pathname==='/api/plugins')return json({plugins:[...dataPlugins,plugin,deepface],node_defaults:nodeDefaults});
  if(u.pathname==='/api/providers')return json({providers:[]});
  if(u.pathname==='/api/jobs')return json({jobs:[]});
  if(u.pathname==='/api/projects')return json([project]);
  if(u.pathname==='/api/projects/fixture/reconcile'){const data=route.request().postDataJSON();project.title=data.title;project.document=data.local;project.revision++;return json(project);}
  if(u.pathname==='/api/projects/fixture'){
   if(route.request().method()==='POST'){const data=route.request().postDataJSON();Object.assign(project,data);project.revision++;}
   return json(project);
  }
  if(u.pathname==='/api/plugin/settings'){
   lastSettings=route.request().postDataJSON().settings;plugin.settings=lastSettings;plugin.actions[0].default_params={...plugin.actions[0].default_params,...lastSettings.defaults.lookup};return json({});
  }
  return json({});
 });
 const samples={};
 async function measure(name){samples[name]=await page.evaluate(()=>{
 const box=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
 const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const buttons=[...document.querySelectorAll('button,summary')].filter(visible).map(n=>{const s=getComputedStyle(n),b=box(n),i=n.querySelector(':scope>.ui-icon'),r=i&&box(i);return {id:n.id,cls:n.className,label:n.getAttribute('aria-label')||n.textContent.trim(),box:b,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],margin:[s.marginTop,s.marginRight,s.marginBottom,s.marginLeft],iconOffset:r?{x:(r.left+r.right-b.left-b.right)/2,y:(r.top+r.bottom-b.top-b.bottom)/2}:null}});
 const a=document.querySelector('#nodePalette'),split=document.querySelector('#paletteSplit'),h=document.querySelector('#actorWindow .palette-heading');
 const input=document.querySelector('dialog[open] input');let focus=null;
 if(input){const f=input.closest('form'),b=box(input),r=box(f),s=getComputedStyle(input);focus={left:b.left-r.left,right:r.right-b.right,outline:s.outlineWidth,offset:s.outlineOffset};}

 const badge=document.querySelector('.selected-tag-badge');
 const contentInsets=buttons.filter(b=>['newProject','homeActive'].includes(b.id)).map(b=>{const n=document.getElementById(b.id),children=[...n.children].map(box);return {id:b.id,left:Math.min(...children.map(c=>c.left))-b.box.left,right:b.box.right-Math.max(...children.map(c=>c.right)),top:Math.min(...children.map(c=>c.top))-b.box.top,bottom:b.box.bottom-Math.max(...children.map(c=>c.bottom))}});
 const toolbar=[...document.querySelectorAll('.toolbar-row')].filter(visible).flatMap(row=>[...row.children].slice(1).map(g=>{const r=box(g),prev=box(g.previousElementSibling),css=getComputedStyle(g,'::before'),line=r.left+parseFloat(css.left);return {before:line-prev.right,after:r.left-line-1,internal:getComputedStyle(g).columnGap}}));
 const report=document.querySelector('.node-report-section'),tags=document.querySelector('.node-tag-options');
 const sections={report:report?[getComputedStyle(report).borderTopWidth,getComputedStyle(report).borderBottomWidth]:null,tags:tags?getComputedStyle(tags).borderTopWidth:null};

 return {buttons,contentInsets,toolbar,sections,palette:a&&visible(a)?{above:box(split).top-box(a).bottom,below:box(h).top-box(split).bottom}:null,focus,badge:badge?box(badge):null,overflow:document.documentElement.scrollWidth>innerWidth};
 });}
 await page.goto('http://127.0.0.1:8765/');await page.locator('.project-tile').waitFor();await measure('home');
 await page.locator('.project-tile button[title="Titel bearbeiten"]').click();await page.locator('dialog[open] input').focus();await measure('title-dialog');await page.locator('dialog[open]').press('Escape');
 await page.locator('.project-tile button').first().click();await page.locator('#workspace').waitFor({state:'visible'});await page.waitForTimeout(150);await measure('workspace');
 await page.locator('.node[data-id="input"]').click();await measure('node-details');await page.screenshot({path:'../../outputs/ARGUS-v025-Audit-Tags.png'});
 await page.locator('.node[data-id="deep"]').click();await measure('numeric-parameters');
 await page.locator('#back').click();await page.locator('#pluginsTab').click();await page.locator('[data-plugin-row="username"] .plugin-expand').click();await measure('plugin-defaults');
 
 await page.locator('#brandHome').click();
 const inputNode=project.document.nodes.find(n=>n.id==='input');
 for(const [type,data] of Object.entries({value:{value:'Testwert'},email:{value:'dummy@example.test'},phone:{value:'+4912345678'},profile:{url:'https://example.test/demo',username:'dummy'},url:{url:'https://example.test/'},image:{url:''},file:{filename:'dummy.pdf'},note:{text:'Lokale Audit-Notiz'},location:{latitude:52.5,longitude:13.4},datetime:{date:'2026-10-16',time:'12:00',timezone:'UTC'},person:{first_name:'Dummy',last_name:'Person'},error:{message:'Lokaler Beispielfehler'}})){
  inputNode.type=type;inputNode.data={...nodeDefaults[type],...data};
  await page.locator('.project-tile button').first().click();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('.node[data-id="input"]').click();
  await page.locator('#inspector .node-delete').scrollIntoViewIfNeeded();await measure('details-'+type);await page.locator('#node-label').scrollIntoViewIfNeeded();
  await page.screenshot({path:'../../outputs/ARGUS-v025-Audit-Details-'+type+'.png'});
  await page.locator('#back').click();
 }

 await page.evaluate(()=>{const form=document.createElement('form');form.id='numeric-fixture';const input=document.createElement('input');input.id='numeric-audit';input.type='number';input.min='0';input.max='1';input.step='0.1';input.value='0.8';input.setAttribute('aria-label','Audit');form.append(input);document.body.append(form);});
 const number=page.locator('#numeric-audit'),numberRow=page.locator('#numeric-fixture .number-field'),up=numberRow.locator('[data-direction="1"]'),down=numberRow.locator('[data-direction="-1"]');
 await up.click();assert.equal(await number.inputValue(),'0.9');await up.click();assert.equal(await number.inputValue(),'1');assert.equal(await up.isDisabled(),true);
 await number.fill('0');assert.equal(await down.isDisabled(),true);await number.press('ArrowUp');assert.equal(await number.inputValue(),'0.1');
 await number.evaluate(n=>{n.readOnly=true;});assert.equal(await up.isDisabled(),true);assert.equal(await down.isDisabled(),true);
 await number.evaluate(n=>{n.readOnly=false;n.step='any';n.max='10';n.value='2.5';n.dispatchEvent(new Event('input',{bubbles:true}));});await up.click();assert.equal(await number.inputValue(),'3.5');
 await number.evaluate(n=>{n.disabled=true;});assert.equal(await down.isDisabled(),true);await page.locator('#numeric-fixture').evaluate(n=>n.remove());
 for(const [name,sample] of Object.entries(samples)){
  assert.equal(sample.overflow,false,name);
  assert.ok(sample.toolbar.every(g=>g.before===12&&g.after===12&&g.internal==='6px'),name);
  if(sample.sections.report)assert.deepEqual(sample.sections.report,['1px','1px'],name);
  if(sample.sections.tags)assert.equal(sample.sections.tags,'1px',name);
 }
 assert.deepEqual(errors,[]);
 const result=process.env.ARGUS_AUDIT_RESULT||'../audit-after.json';require('node:fs').writeFileSync(result,JSON.stringify({samples,errors},null,2));
 await browser.close();console.log(result);
})().catch(e=>{console.error(e);process.exit(1);});
