// Focused local UI verification; all API responses are fixtures, external requests are blocked.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({...(process.env.ARGUS_BROWSER_EXECUTABLE ? {executablePath:process.env.ARGUS_BROWSER_EXECUTABLE} : {}),headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const failures=[];page.on('pageerror',e=>failures.push(e.message));
 await page.addInitScript(()=>{globalThis.ARGUS_TEST_MODE=true;});
 let attempts=0;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/auth/session')return route.fulfill({json:{csrf_token:'fixture'}});
  if(url.pathname.startsWith('/api/jobs/'))return route.fulfill({json:{state:'completed',result:attempts===1?{input_request:{title:'Bestätigungscode',fields:[{key:'verification_code',label:'Code',type:'text',transient:true}]}}:{authenticated:true}}});
  return route.continue();
 });
 await page.goto('http://127.0.0.1:8765/');
 await page.evaluate(async()=>{
  const m=await import('/app.js');globalThis.fixtureApp=m.createApplication();
  fixtureApp.features.configureUi.configureUi();
  fixtureApp.features.shell.updateStatus();
  (await import('/icons.js')).decorateStaticIcons();
 });
 const widths=await page.evaluate(()=>[document.getElementById('newProject').getBoundingClientRect().width,document.getElementById('homeActive').getBoundingClientRect().width]);
 assert.equal(widths[0],widths[1]);
 await page.evaluate(async()=>{
  document.getElementById('home').hidden=true;document.getElementById('workspace').hidden=false;
  const {setupWorkspaceLayout}=await import('/workspace-layout.js');setupWorkspaceLayout();
 });
 const layouts=[];
 for(const width of [1440,1024,760,390]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);
  const before=await page.locator('#workspace>.toolbar').boundingBox();
  const geometry=await page.evaluate(()=>{
   const box=id=>document.getElementById(id).getBoundingClientRect();
   return {overflow:[...document.querySelectorAll('.toolbar-row')].some(row=>row.scrollWidth>row.clientWidth+2),left:box('toggleLeft').left-box('palette').right,right:box('toggleRight').right-box('inspector').left,rows:document.querySelectorAll('.toolbar-row').length, groups:[...document.querySelectorAll('.toolbar-row')].map(r=>({width:r.clientWidth,scroll:r.scrollWidth,children:[...r.children].map(g=>({class:g.className,width:g.getBoundingClientRect().width,scroll:g.scrollWidth}))}))};
  });
  assert.equal(geometry.overflow,false,JSON.stringify({width,...geometry}));
  assert.ok(Math.abs(geometry.left)<2,JSON.stringify({width,...geometry}));
  assert.ok(Math.abs(geometry.right)<2,JSON.stringify({width,...geometry}));
  await page.evaluate(()=>{fixtureApp.state.executionState.currentActorJob={label:'Fixture'};fixtureApp.state.executionState.queueRunning=true;fixtureApp.features.shell.updateStatus();});
  await page.waitForTimeout(150);
  const after=await page.locator('#workspace>.toolbar').boundingBox();
  assert.ok(Math.abs(before.height-after.height)<2,`Toolbar jumped at ${width}: ${before.height} -> ${after.height}`);
  await page.evaluate(()=>{fixtureApp.state.executionState.currentActorJob=null;fixtureApp.state.executionState.queueRunning=false;fixtureApp.features.shell.updateStatus();});
  layouts.push({width,rows:geometry.rows,height:after.height});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.waitForTimeout(100); await page.screenshot({path:'../iteration-ui.png',fullPage:true});
 await page.locator('#groupMenu summary').click();assert.equal(await page.locator('#groupNodes').isVisible(),true);
 await page.locator('#groupMenu summary').press('Escape');assert.equal(await page.locator('#groupNodes').isVisible(),false);
 await page.locator('#deleteMenu summary').click();assert.equal(await page.locator('#deleteDescendants').innerText(),'Objekt und Nachkommen löschen');
 // Verify an autosave response never replaces the typed password with the eight-character mask.
 await page.evaluate(async()=>{
  const m=await import('/app.js'),s=m.createState();
  const input=document.createElement('input');input.type='password';input.value='a-long-fixture-password';
  const form=document.createElement('form'),button=document.createElement('button');button.className='primary wide';form.append(input,button);document.body.append(form);
  const model={form,version:1,indicator:document.createElement('span'),settings:{},nodes:{},defaults:{lookup:{data:{login_password:input.value},readers:[{control:input,path:['login_password'],read:()=>input.value}]}}};
  s.pluginsState.activePluginForms.set('instagram',model);s.pluginsState.pendingPluginDirty.add('instagram');
  const callbacks=Object.fromEntries(m.pluginSettingsFeature.dependencies.map(key=>[key,()=>{}]));
  const feature=m.pluginSettingsFeature.create({...s,...callbacks,api:async()=>({}),applyFields:(data,readers)=>({...data,login_password:readers[0].read()}),refreshCatalog:async()=>{s.pluginsState.catalog=[{id:'instagram',settings:{},actions:[{id:'lookup',default_params:{login_password:'••••••••'}}]}];}});
  await feature.persistPluginForm('instagram');
  if(input.value!=='a-long-fixture-password')throw Error('Autosave replaced password input');
 });
 // Use the actual modal primitive and mocked durable jobs for the Instagram challenge flow.
 await page.evaluate(()=>{
  const s=fixtureApp.state,form=document.createElement('form'),button=document.createElement('button');button.className='primary wide';button.textContent='Anmelden';form.append(button);document.body.append(form);
  s.pluginsState.activePluginForms.set('instagram',{form});
  globalThis.loginFixture=fixtureApp.features.pluginSettings;
 });
 // A dedicated feature uses real UI callbacks and only replaces network and catalogue operations.
 await page.evaluate(async()=>{
  const m=await import('/app.js'),s=fixtureApp.state;
  const callbacks=Object.fromEntries(m.pluginSettingsFeature.dependencies.map(key=>[key,()=>{}]));
  globalThis.challengeFeature=m.pluginSettingsFeature.create({...s,...callbacks,parameterModal:(...args)=>fixtureApp.features.shell.parameterModal(...args),api:async()=>{await fetch('/fixture-attempt',{method:'POST'});return {id:'fixture'};}});
 });
 await page.route('**/fixture-attempt',async route=>{attempts++;await route.fulfill({json:{}});});
 const pending=page.evaluate(()=>challengeFeature.connectPlugin({id:'instagram',connection_action:{id:'login'}}));
 await page.locator('dialog[open].manual-dialog').waitFor();
 assert.equal(await page.locator('.connection-pending[aria-busy=true]').count(),1);
 await page.locator('dialog[open].manual-dialog input').fill('123456');
 await page.locator('dialog[open].manual-dialog button.primary').click();
 await pending;assert.equal(attempts,2);assert.equal(await page.locator('.connection-pending').count(),0);
 assert.deepEqual(failures,[]);
 console.log(JSON.stringify({status:'ok',layouts,checks:['home button widths','panel borders','toolbar reserved height','dropdowns and keyboard','password autosave','animated login and verification modal']}));
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
