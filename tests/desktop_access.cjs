// Exercise the shipped bundle with fixture APIs. No real project data or provider requests.
const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
 const fixtures=[{id:'active',title:'Desktop-Recherche',revision:1,updated_at:'2026-10-16T00:00:00Z'},{id:'archived',title:'Archivierte Recherche',revision:1,updated_at:'2026-10-16T00:00:00Z',archived_at:'2026-10-16T00:00:00Z'}];
 const results=[];
 for(const mode of ['desktop','phone','desktop-mode']){
  const context=await browser.newContext({viewport:mode==='desktop'?{width:1440,height:1000}:{width:390,height:844},hasTouch:mode!=='desktop',...(mode==='phone'?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  const page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
   if(!u.pathname.startsWith('/api/'))return route.continue();
   requests.push({path:u.pathname,method:route.request().method()});
   if(u.pathname==='/api/auth/session')return route.fulfill({status:401,json:{}});
   if(u.pathname==='/api/auth/login'){assert.deepEqual(route.request().postDataJSON(),{});return route.fulfill({json:{csrf_token:'fixture'}});}
   if(u.pathname==='/api/settings')return route.fulfill({json:{settings:{language:'de',tags:[]}}});
   if(u.pathname==='/api/plugins')return route.fulfill({json:{plugins:[]}});
   if(u.pathname==='/api/providers')return route.fulfill({json:{providers:[]}});
   if(u.pathname==='/api/jobs')return route.fulfill({json:{jobs:[]}});
   if(u.pathname==='/api/health')return route.fulfill({json:{status:'ok'}});
   if(u.pathname==='/api/projects')return route.fulfill({json:fixtures});
   if(u.pathname.endsWith('/rename')){
    const body=route.request().postDataJSON(),p=fixtures.find(p=>u.pathname.includes('/'+p.id+'/'));
    assert.equal(route.request().headers()['x-argus-token'],'fixture');assert.equal(body.revision,p.revision);
    p.title=body.title;p.revision++;return route.fulfill({json:p});
   }
   return route.fulfill({status:404,json:{error:{code:'not_found'}}});
  });
  await page.goto('http://127.0.0.1:8765/');
  if(mode==='phone'){
   await page.locator('#desktopWarning').waitFor({state:'visible'});
   assert.equal(await page.locator('#home').isVisible(),false);
   assert.equal(await page.locator('header').isVisible(),false);
   assert.equal(await page.locator('#desktopWarning').innerText().then(t=>t.includes('Du darfst diese Sperre damit ausdrücklich umgehen.')),true);
   await page.waitForTimeout(250);assert.equal(requests.length,0);
   await page.screenshot({path:'../../outputs/ARGUS-Handy-Hinweis.png',fullPage:true});
  }else{
   await page.locator('.project-tile').waitFor();
   assert.equal(await page.locator('#desktopWarning').isVisible(),false);
   assert.equal(await page.locator('dialog[open]').count(),0);
   if(mode==='desktop'){
    for(const archived of [false,true]){
     if(archived)await page.locator('#homeArchive').click();
     await page.locator('.tile-actions button[title="Titel bearbeiten"]').click();
     const input=page.locator('dialog[open] input');assert.equal(await input.getAttribute('maxlength'),'200');
     const title=archived?'Archiv umbenannt':'Recherche Müller & Söhne 🔎';
     await input.fill(title);await page.locator('dialog[open] button.primary').click();
     await page.waitForFunction(title=>document.querySelector('.project-tile h2').textContent===title,title);
    }
    await page.locator('#homeActive').click();
    await page.screenshot({path:'../../outputs/ARGUS-Projektkarten-Umbenennen.png',fullPage:true});
   }
  }
  assert.deepEqual(errors,[]);results.push({mode,apiRequests:requests.length,status:'ok'});await context.close();
 }
 await browser.close();console.log(JSON.stringify({status:'ok',results}));
})().catch(e=>{console.error(e);process.exit(1);});
