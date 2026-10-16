// Shipped application, fixture API only; no account queries or real project changes.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let lastSettings=null;
 const makeTool=(id,x)=>({id,type:'actor',label:'Username recherchieren',x,y:0,data:{plugin:'username',action:'lookup',params:{run_timeout:300,max_results:500,search_profiles:{consensus:[{id:'top:50'}],blackbird:[]}}},evidence:{},report:true});
 const project={id:'fixture',title:'Profil-Recherche',revision:1,document:{nodes:[makeTool('search1',0),makeTool('search2',300),{id:'input',type:'username',label:'Testname',x:0,y:250,data:{value:'fixture'},tags:[],evidence:{},verification:'unverified',report:true}],edges:[],groups:[],runs:[],report_notes:''}};
 const plugin={id:'username',name:'Username',actions:[{id:'lookup',name:'Username recherchieren',inputs:['username'],settings_only:[],research_profiles:{consensus:[{id:'top:50',label:'Top 50',top:50},{id:'tag:social',label:'Social media',tag:'social'}],blackbird:[]},default_params:{search_profiles:{},use_consensus:true,use_blackbird:false,run_timeout:300,max_results:500,consensus_sites:[]}}]};
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  const json=body=>route.fulfill({json:body});
  if(u.pathname==='/api/auth/session')return json({csrf_token:'fixture'});
  if(u.pathname==='/api/settings')return json({settings:{language:'de',tags:[{id:'review',name:'Prüfen',color:'#ff9d45'}]}});
  if(u.pathname==='/api/plugins')return json({plugins:[plugin],node_defaults:{}});
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
 await page.goto('http://127.0.0.1:8765/');await page.locator('.project-tile').waitFor();
 await page.locator('#homeArchive').click();assert.ok(await page.locator('#newProject').isVisible());
 await page.locator('#homeActive').click();await page.locator('.project-tile button').first().click();
 await page.locator('#workspace').waitFor({state:'visible'});
 assert.equal(await page.locator('#back').locator('..').getAttribute('class'),'toolbar-group home-tools');
 assert.equal(await page.locator('#actorWindow h2').innerText(),'Tools');
 assert.equal(await page.locator('#projectTitle').textContent(),'Profil-Recherche');
 for(const id of ['projectsTab','pluginsTab','settingsTab'])assert.equal(await page.locator('#'+id).isVisible(),false);
 assert.equal(await page.locator('#save').count(),0);assert.ok(await page.locator('#status').isVisible());
 assert.equal(await page.locator('#cleanupMenu').locator('..').getAttribute('class'),'toolbar-group group-tools');
 await page.locator('#editProjectTitle').click();await page.locator('dialog[open] input').fill('Neu benannt');await page.locator('dialog[open] button.primary').click();
 assert.equal(await page.locator('#projectTitle').textContent(),'Neu benannt');
 for(const width of [1440,1024,1920]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(120);
  const geometry=await page.evaluate(()=>{
   const heading=document.getElementById('projectHeading').getBoundingClientRect();
   return {offset:Math.abs((heading.left+heading.right)/2-innerWidth/2),overflow:[...document.querySelectorAll('.toolbar-row')].some(row=>row.scrollWidth>row.clientWidth+2),groups:[...document.querySelectorAll('.toolbar-group')].map(g=>getComputedStyle(g).justifyContent)};
  });
  assert.ok(geometry.offset<2,JSON.stringify(geometry));assert.equal(geometry.overflow,false,JSON.stringify(geometry));assert.ok(geometry.groups.every(g=>g==='center'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.toolbar-row')].some(row=>Math.abs(row.getBoundingClientRect().left-row.firstElementChild.getBoundingClientRect().left)>2)),false);
  await page.screenshot({path:`../../outputs/ARGUS-Profiles-Workspace-${width}.png`});
 }
 await page.locator('#back').click();await page.locator('#pluginsTab').click();await page.locator('.plugin-expand').click();
 assert.ok(await page.getByRole('heading',{name:'Standardwerte für neue Tools',exact:true}).isVisible());
 const tile=page.locator('.plugin-default-section .provider-profiles').filter({has:page.locator('summary', {hasText:'Consensus'})});
 await tile.locator('summary').click();
 await page.locator('#brandHome').click();await page.locator('.project-tile button').first().click();await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('.node[data-id="search1"]').click();
 const specific=page.locator('#inspector .provider-profiles').filter({has:page.locator('summary',{hasText:'Consensus'})});
 await specific.locator('summary').click();
 assert.equal(await specific.locator('.profile-item').count(),1);
 await specific.locator('.profile-item').getByRole('button',{name:'Suchprofil entfernen'}).click();await page.waitForTimeout(750);
 assert.deepEqual(project.document.nodes.find(n=>n.id==='search1').data.params.search_profiles.consensus,[]);
 assert.deepEqual(project.document.nodes.find(n=>n.id==='search2').data.params.search_profiles.consensus,[{id:'top:50'}]);
 assert.deepEqual(plugin.actions[0].default_params.search_profiles,{});
 await page.locator('.node[data-id="input"]').click();
 const deleteButton=page.locator('#inspector > .node-delete');assert.ok((await deleteButton.innerText()).includes('löschen'));assert.equal(await deleteButton.locator('svg').count(),1);
 assert.ok(await page.locator('#inspector .node-tag-options [role="combobox"]').isVisible());
 await page.locator('#inspector .node-tag-options [role="combobox"]').click();await page.getByRole('option',{name:'Prüfen',exact:true}).click();
 assert.equal(await page.locator('.selected-tag-badge').count(),1);await page.waitForTimeout(750);assert.deepEqual(project.document.nodes.find(n=>n.id==='input').tags,['review']);
 await page.locator('.selected-tag-badge button').click();await page.waitForTimeout(750);assert.deepEqual(project.document.nodes.find(n=>n.id==='input').tags,[]);
 await page.screenshot({path:'../../outputs/ARGUS-Feedback-Details.png'});
 await page.locator('#back').click();await page.locator('#pluginsTab').click();
 const chooser=tile.locator('.research-profiles .search-select-button');
 async function add(search,name){await chooser.click();await page.locator('.select-popup input').fill(search);await page.getByRole('option',{name,exact:true}).click();}
 await add('50','Top 50');await add('social','Social media');await add('eigene','Eigene Websites');
 const styles=await tile.locator('.profile-item').first().evaluate(row=>{
  const handle=getComputedStyle(row.querySelector('.source-handle')), remove=getComputedStyle(row.querySelector('.danger-filled'));
  return {handle:handle.color,border:handle.borderTopWidth,remove:remove.backgroundColor};
 });
 assert.equal(styles.handle,'rgb(255, 157, 69)');assert.equal(styles.border,'0px');assert.notEqual(styles.remove,'rgba(0, 0, 0, 0)');
 await tile.locator('textarea').fill('GitHub\nGitLab');await page.waitForTimeout(750);
 assert.deepEqual(lastSettings.defaults.lookup.search_profiles.consensus,[{id:'top:50'},{id:'tag:social'},{id:'custom',sites:['GitHub','GitLab']}]);
 await tile.locator('.profile-item').nth(1).getByRole('button',{name:'Nach oben',exact:true}).click();
 await page.waitForTimeout(750);assert.equal(lastSettings.defaults.lookup.search_profiles.consensus[0].id,'tag:social');
 // Keyboard reordering uses the same operation as dragging.
 await tile.locator('.profile-item').first().getByRole('button',{name:'Suchprofil verschieben'}).press('ArrowDown');await page.waitForTimeout(750);
 assert.equal(lastSettings.defaults.lookup.search_profiles.consensus[0].id,'top:50');
 await page.screenshot({path:'../../outputs/ARGUS-Profiles-Settings.png',fullPage:true});
 while(await tile.locator('.profile-item').count())await tile.locator('.profile-item').first().getByRole('button',{name:'Suchprofil entfernen'}).click();
 await page.waitForTimeout(750);assert.deepEqual(lastSettings.defaults.lookup.search_profiles.consensus,[]);assert.deepEqual(lastSettings.defaults.lookup.search_profiles.blackbird,[]);
 assert.ok(await tile.getByText('Keine Einschränkung – alle Websites werden durchsucht.').isVisible());
 assert.deepEqual(errors,[]);await browser.close();console.log('Per-search isolation, tags, delete button, profile styles, defaults, header, archive and wrapping toolbar passed.');
})().catch(e=>{console.error(e);process.exit(1);});
