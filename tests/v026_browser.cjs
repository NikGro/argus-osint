// Shipped application, fixture API only; no account queries or real project changes.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const deepface=JSON.parse(require('node:child_process').execFileSync(process.env.ARGUS_PYTHON || 'python',['-c','import json;from plugins.deepface_tool import PLUGIN;print(json.dumps(PLUGIN))'],{encoding:'utf8'}));
 let lastSettings=null;
 const makeTool=(id,x)=>({id,type:'actor',label:'Username recherchieren',x,y:0,data:{plugin:'username',action:'lookup',params:{run_timeout:300,max_results:500,search_profiles:{consensus:[{id:'top:50'}],blackbird:[{id:'custom',sites:['GitHub']}]},use_blackbird:true}},evidence:{},report:true});
 const project={id:'fixture',title:'Profil-Recherche',revision:1,document:{nodes:[{...makeTool('deep',600),data:{plugin:'deepface',action:'verify',params:deepface.actions[0].default_params}},makeTool('search1',0),makeTool('search2',300),{id:'input',type:'username',label:'Testname',x:0,y:250,data:{value:'fixture'},tags:[],evidence:{},verification:'unverified',report:true}],edges:[{id:'link',source:'search1',target:'search2',label:'Ergebnis'}],groups:[],runs:[],report_notes:''}};
 const plugin={id:'username',name:'Username',actions:[{id:'lookup',name:'Username recherchieren',inputs:['username'],settings_only:[],research_profiles:{consensus:[{id:'top:50',label:'Top 50',top:50},{id:'tag:social',label:'Social media',tag:'social'}],blackbird:[]},default_params:{search_profiles:{},source_order:['consensus','blackbird'],use_consensus:true,use_blackbird:false,run_timeout:300,max_results:500,consensus_sites:[]}}]};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  const json=body=>route.fulfill({json:body});
  if(u.pathname==='/api/auth/session')return json({csrf_token:'fixture'});
  if(u.pathname==='/api/settings')return json({settings:{language:'de',tags:[{id:'review',name:'Prüfen',color:'#ff9d45'}]}});
  if(u.pathname==='/api/plugins')return json({plugins:[plugin,deepface],node_defaults:{}});
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

 async function openNode(){await page.locator('.project-tile button').first().click();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('.node[data-id="search1"]').click();}
 async function settings(){await page.locator('#back').click();await page.locator('#pluginsTab').click();const expand=page.locator('[data-plugin-row="username"] .plugin-expand');if(await expand.getAttribute('aria-expanded')==='false')await expand.click();}
 const providers=page.locator('#inspector .tool-search-profiles .provider-profiles > summary');
 await page.goto('http://127.0.0.1:8765/');await page.locator('.project-tile').waitFor();await openNode();
 assert.equal(await page.locator('#inspector [data-field="source_order"], #inspector [data-field^="use_"]').count(),0,'Sources belong only in plugin settings');
 assert.deepEqual(await providers.allTextContents(),['Consensus'],'Global plugin activation overrides old node-local flags for visibility');
 const consensus=page.locator('#inspector .provider-profiles');await consensus.locator('summary').click();await consensus.getByRole('button',{name:'Suchprofil entfernen'}).click();await page.waitForTimeout(800);
 const saved=()=>project.document.nodes.find(n=>n.id==='search1').data.params;
 assert.deepEqual(saved().search_profiles.consensus,[]);assert.deepEqual(saved().search_profiles.blackbird,[{id:'custom',sites:['GitHub']}],'Hidden profiles survive edits');
 assert.deepEqual(project.document.nodes.find(n=>n.id==='search2').data.params.search_profiles.consensus,[{id:'top:50'}]);
 await settings();await page.locator('.source-row[data-source="blackbird"] input[type="checkbox"]').check();await page.waitForTimeout(800);assert.equal(plugin.actions[0].default_params.use_blackbird,true);
 await page.locator('#brandHome').click();await openNode();assert.deepEqual(await providers.allTextContents(),['Consensus','Blackbird']);
 const blackbird=page.locator('#inspector .provider-profiles').filter({has:page.locator('summary',{hasText:'Blackbird'})});await blackbird.locator('summary').click();assert.equal(await blackbird.locator('textarea').inputValue(),'GitHub');
 await settings();await page.locator('.source-row[data-source="blackbird"] input[type="checkbox"]').uncheck();await page.locator('.source-row[data-source="consensus"] input[type="checkbox"]').uncheck();await page.waitForTimeout(800);
 await page.locator('#brandHome').click();await openNode();assert.equal(await page.locator('#inspector .tool-search-profiles').count(),0,'No empty profile section when all sources are disabled');
 await page.locator('#inspector input[data-field="run_timeout"]').fill('550');await page.waitForTimeout(800);assert.equal(saved().run_timeout,550);assert.deepEqual(saved().search_profiles.blackbird,[{id:'custom',sites:['GitHub']}]);
 const geometry=await page.evaluate(()=>{
 const status=document.querySelector('#status').getBoundingClientRect(), dot=document.querySelector('#statusLight').getBoundingClientRect(), text=document.querySelector('#statusText').getBoundingClientRect(), logo=document.querySelector('#brandHome').getBoundingClientRect();
 const node=document.querySelector('.node.actor'); const hover=node.querySelector('.node-hover-area');
 return {right:innerWidth-status.right,left:logo.left,dotRight:dot.right,textRight:text.right,hoverX:Number(hover.getAttribute('x')),hoverFill:getComputedStyle(hover).fill};
 });
 assert.ok(geometry.dotRight>geometry.textRight,'Status dot follows text');
 assert.ok(Math.abs(geometry.right-geometry.left)<=1,'Header has equal outer insets');
 assert.equal(geometry.hoverX,-10);assert.equal(geometry.hoverFill,'rgba(0, 0, 0, 0)');
 assert.deepEqual(errors,[]);await browser.close();console.log('v0.26: active provider filtering, current plugin toggles, hidden-profile preservation and autosave passed; no research executed.');
})().catch(e=>{console.error(e);process.exit(1);});
