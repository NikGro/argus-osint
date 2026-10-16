// Browser evidence for the restored UI. Fixtures only; no user projects or external providers.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
 const output={engine:'Chromium / Chrome headless, local API fixtures',devices:[]};
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  await page.addInitScript(()=>globalThis.ARGUS_TEST_MODE=true);
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:{csrf_token:'fixture'}});
   return route.continue();
  });
  await page.goto('http://127.0.0.1:8765/');
  await page.evaluate(async()=>{
   const m=await import('/app.js');globalThis.auditApp=m.createApplication();
   auditApp.features.configureUi.configureUi();
   auditApp.features.bindWorkspace.bindWorkspace();
   auditApp.state.libraryState.projectIndex=[{id:'fixture',title:'Beispielrecherche',revision:1,updated_at:'2026-10-16T00:00:00Z'}];
   auditApp.features.projects.renderProjects();auditApp.features.shell.updateStatus();
   (await import('/icons.js')).decorateStaticIcons();
  });
  const measure=()=>page.evaluate(()=>({
   viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
   smallControls:[...document.querySelectorAll('button,summary,input,select')].filter(n=>n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!n.closest('[hidden]')).map(n=>({id:n.id,text:n.getAttribute('aria-label')||n.textContent.trim()||n.title,width:Math.round(n.getBoundingClientRect().width),height:Math.round(n.getBoundingClientRect().height)})).filter(n=>n.width<44||n.height<44),
   smallText:[...document.querySelectorAll('span,p,label,button,summary')].filter(n=>n.getClientRects().length&&!n.closest('[hidden]')&&parseFloat(getComputedStyle(n).fontSize)<12).slice(0,15).map(n=>({id:n.id,text:n.textContent.trim().slice(0,80),font:getComputedStyle(n).fontSize})),
   unlabeled:[...document.querySelectorAll('input,select,button')].filter(n=>n.getClientRects().length&&!n.closest('[hidden]')&&!n.textContent.trim()&&!n.getAttribute('aria-label')&&!n.title&&!n.labels?.length).map(n=>({id:n.id,tag:n.tagName})),
   focus:document.activeElement?.id
  }));
  const home=await measure();
  await page.screenshot({path:`../../outputs/ARGUS-audit-home-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  await page.evaluate(async()=>{
   const s=auditApp.state;
   s.workspaceState.project={id:'fixture',title:'Beispielrecherche',revision:1,document:{nodes:[{id:'value',type:'value',label:'Beispiel',data:{value:'Beispieldaten'},x:0,y:0,evidence:{source:'Lokale Testdaten'},tags:[],verification:'verified'}],edges:[],groups:[],runs:[]}};
   s.workspaceState.templates={value:{},username:{}};
   s.pluginsState.dataTypes=new Map([['value',{installed:true,node:{name:'Wert'}}],['username',{installed:true,node:{name:'Benutzername'}}]]);
   s.selectionState.selected.add('value');s.shellState.backendOnline=true;
   document.getElementById('projectTitle').value=s.workspaceState.project.title;
   auditApp.features.shell.show('workspace');auditApp.features.shell.updateStatus();auditApp.features.palette.renderPalette();auditApp.features.inspector.inspect();auditApp.features.canvasRenderer.render();
   (await import('/workspace-layout.js')).setupWorkspaceLayout();
  });
  await page.waitForTimeout(180);
  assert.equal(await page.locator('.toolbar #back').count(),1);
  assert.equal(await page.locator('#groupMenu #expandAllGroups,#groupMenu #collapseAllGroups').count(),2);
  assert.equal(await page.locator('#deleteMenu summary').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(164, 46, 59)');
  await page.locator('#groupMenu summary').click();assert.equal(await page.locator('#expandAllGroups').isVisible(),true);await page.locator('#groupMenu summary').press('Escape');assert.equal(await page.locator('#expandAllGroups').isVisible(),false);
  const workspace=await measure();workspace.nodeKeyboard=await page.locator('.node').first().evaluate(n=>({tag:n.tagName,tabindex:n.getAttribute('tabindex'),role:n.getAttribute('role')}));
  await page.screenshot({path:`../../outputs/ARGUS-audit-workspace-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  if(!mobile){
   await page.locator('#deleteMenu summary').click();await page.locator('#deleteDescendants').hover();
   workspace.deleteHover=await page.locator('#deleteDescendants').evaluate(n=>({text:n.textContent.trim(),foreground:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor,fontSize:getComputedStyle(n).fontSize}));
   await page.locator('#deleteMenu summary').press('Escape');
   workspace.renderTimings=[];
   for(const count of [100,500])workspace.renderTimings.push(await page.evaluate(count=>{
    const seed=auditApp.state.workspaceState.project.document.nodes[0];
    auditApp.state.workspaceState.project.document.nodes=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:'fixture'+i,x:i%20*250,y:Math.floor(i/20)*150}));
    const start=performance.now();auditApp.features.canvasRenderer.render();return{count,milliseconds:Math.round(performance.now()-start)};
   },count));
  }
  if(mobile){await page.locator('#toggleRight').tap();workspace.touchPanelToggle=await page.locator('#toggleRight').getAttribute('aria-expanded');}
  await page.evaluate(()=>{
   auditApp.state.pluginsState.catalog=[{id:'fixture',name:'Recherche-Plugin',description:'Beispieldaten für den UI-Audit',actions:[{id:'lookup',name:'Recherche',default_params:{timeout:30,login_password:'••••••••',use_consensus:true},settings_only:['login_password']}]}];
   auditApp.state.pluginsState.pluginSettingsOpen.add('fixture');auditApp.features.shell.show('pluginsView');auditApp.features.pluginSettings.renderInstalled();
  });
  const plugins=await measure();
  await page.screenshot({path:`../../outputs/ARGUS-audit-plugins-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  output.devices.push({mobile,home,workspace,plugins,errors});assert.deepEqual(errors,[]);
  await context.close();
 }
 await browser.close();fs.writeFileSync('../../outputs/ARGUS-audit-browser.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify(output));
})().catch(e=>{console.error(e);process.exit(1);});
