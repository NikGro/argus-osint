// Shipped application, fixture API only; no account queries or real project changes.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const deepface=JSON.parse(require('node:child_process').execFileSync(process.env.ARGUS_PYTHON || 'python',['-c','import json;from plugins.deepface_tool import PLUGIN;print(json.dumps(PLUGIN))'],{encoding:'utf8'}));
 let lastSettings=null;let jobs=[];
 const makeTool=(id,x)=>({id,type:'actor',label:'Username recherchieren',x,y:0,data:{plugin:'username',action:'lookup',params:{run_timeout:300,max_results:500,search_profiles:{consensus:[{id:'top:50'}],blackbird:[{id:'custom',sites:['GitHub']}]},use_blackbird:true}},evidence:{},report:true});
 const project={id:'fixture',title:'Profil-Recherche',revision:1,document:{nodes:[{...makeTool('deep',600),data:{plugin:'deepface',action:'verify',params:deepface.actions[0].default_params}},makeTool('search1',0),makeTool('search2',300),{id:'input',type:'username',label:'Testname',x:0,y:250,data:{value:'fixture'},tags:[],evidence:{},verification:'unverified',report:true}],edges:[{id:'link',source:'search1',target:'search2',label:'Ergebnis'}],groups:[{id:'grp',label:'Fixture group',members:['search1'],collapsed:false}],runs:[],report_notes:''}};
 const plugin={id:'username',name:'Username',actions:[{id:'lookup',name:'Username recherchieren',inputs:['username'],settings_only:[],research_profiles:{consensus:[{id:'top:50',label:'Top 50',top:50},{id:'tag:social',label:'Social media',tag:'social'}],blackbird:[]},default_params:{search_profiles:{},use_consensus:true,use_blackbird:false,run_timeout:300,max_results:500,consensus_sites:[]}}]};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  const json=body=>route.fulfill({json:body});
  if(u.pathname==='/api/auth/session')return json({csrf_token:'fixture'});
  if(u.pathname==='/api/settings')return json({settings:{language:'de',tags:[{id:'review',name:'Prüfen',color:'#ff9d45'}]}});
  if(u.pathname==='/api/plugins')return json({plugins:[plugin,deepface],node_defaults:{}});
  if(u.pathname==='/api/providers')return json({providers:[]});
  if(u.pathname==='/api/jobs')return json({jobs});
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


 await page.goto('http://127.0.0.1:8765/');await page.locator('.project-tile').waitFor();await page.locator('.project-tile button').first().click();await page.locator('#workspace').waitFor({state:'visible'});
 const toggle=page.locator('.group[data-group="grp"] .group-toggle');
 for(const collapsed of [true,false,true,false]){
  await toggle.click();await page.waitForTimeout(850);assert.equal(project.document.groups[0].collapsed,collapsed,'Every click must toggle even after canonical autosave replacement');
 }
 // A detail control keeps its group reference across saves as well.
 await page.locator('#inspector').getByRole('button',{name:'Einklappen',exact:true}).click();await page.waitForTimeout(850);assert.equal(project.document.groups[0].collapsed,true);
 await page.locator('#inspector').getByRole('button',{name:'Aufklappen',exact:true}).click();await page.waitForTimeout(850);assert.equal(project.document.groups[0].collapsed,false);
 for(const width of [1024,1440,1920]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);
  assert.equal(await page.locator('#back').evaluate(n=>n.getBoundingClientRect().height),32);
  assert.equal(await page.locator('#groupMenu summary').evaluate(n=>n.getBoundingClientRect().height),32);
 }
 jobs=[{id:'fixture-job',actor_id:'deep',project_id:'fixture',state:'running',label:'DeepFace'}];
 await page.locator('#actorActivity:not(.inactive)').waitFor({state:'visible'});assert.equal(await page.locator('#actorActivity .queue-count').count(),0);
 const width=await page.locator('#actorActivity').evaluate(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n),children=[...n.children].map(c=>({width:parseFloat(getComputedStyle(c).width)}));return {width:b.width,content:children.reduce((total,c)=>total+c.width,0)+(children.length-1)*parseFloat(s.gap),padding:parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)+2}});
 assert.ok(Math.abs(width.width-width.content-width.padding)<1,JSON.stringify(width));
 jobs.push({id:'queued',actor_id:'search2',project_id:'fixture',state:'queued'});await page.locator('#actorActivity .queue-count').waitFor();assert.ok(await page.locator('#actorActivity').evaluate(n=>n.getBoundingClientRect().width)>width.width);
 jobs=jobs.slice(0,1);await page.locator('#actorActivity .queue-count').waitFor({state:'detached'});assert.ok(Math.abs(await page.locator('#actorActivity').evaluate(n=>n.getBoundingClientRect().width)-width.width)<1);
 jobs=[];await page.locator('#actorActivity.inactive').waitFor({state:'hidden'}).catch(()=>{});
 await page.locator('.node[data-id="deep"]').click();
 for(const label of [/Erkennungs-Overlays/,/Arbeitskopie/])assert.ok(await page.locator('#inspector').getByText(label).isVisible());
 const resize=page.locator('#inspector input[data-field="resize_large_images"]');await resize.check();await page.waitForTimeout(850);assert.equal(project.document.nodes.find(n=>n.id==='deep').data.params.resize_large_images,true);
 // Even an in-progress tool run must not consume group-toggle clicks.
 await page.evaluate(async()=>{const m=await import('/app.js');const s=m.createState();s.workspaceState.project={document:{groups:[{id:'g',collapsed:true}],nodes:[]}};s.persistenceState.busy=true;const callbacks=Object.fromEntries(m.groupsFeature.dependencies.map(key=>[key,()=>{}]));const feature=m.groupsFeature.create({...s,...callbacks});feature.toggleGroup({id:'g',collapsed:true});if(s.workspaceState.project.document.groups[0].collapsed)throw Error('Busy toggle was ignored');});
 assert.deepEqual(errors,[]);await page.screenshot({path:'../../outputs/ARGUS-v027-DeepFace.png'});await browser.close();console.log('v0.27 UI: repeated group clicks through autosave, busy toggle, dynamic status width/queue, 32px toolbar and new DeepFace options passed; no tool execution.');
})().catch(e=>{console.error(e);process.exit(1);});
