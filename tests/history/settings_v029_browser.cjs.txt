const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.ARGUS_BROWSER_EXECUTABLE,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
let entries=[{id:2,text:'2026-10-16 INFO request ok'},{id:1,text:'2026-10-16 WARNING timeout'}],lastExport;
let vpn={enabled:false,rotation_enabled:false,rotation_mode:'interval',interval_seconds:900,profiles:[]};
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
 const json=value=>route.fulfill({json:value});
 if(u.pathname==='/api/auth/session')return json({csrf_token:'fixture'});
 if(u.pathname==='/api/settings')return json({settings:{language:'en',tags:[]},languages:[{code:'de',name:'Deutsch'},{code:'en',name:'English'}]});
 if(u.pathname==='/api/plugins')return json({plugins:[],node_defaults:{}});
 if(u.pathname==='/api/providers')return json({providers:[]});
 if(u.pathname==='/api/projects')return json([]);
 if(u.pathname==='/api/jobs')return json({jobs:[]});
 if(u.pathname==='/api/vpn'){
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();
   if(body.profiles.some(p=>p.name==='invalid'))return route.fulfill({status:400,json:{error:{code:'validation_failed',detail:'Ungültige Quellenreihenfolge.'}}});
   vpn={...body,profiles:body.profiles.map((p,i)=>({id:p.id||'fixture-'+i,name:p.name,type:p.type}))};
  }
  return json({settings:vpn,status:{available:false,connected:false,state:'vpn_unavailable'}});
 }
 if(u.pathname==='/api/system-logs/clear'){entries=[];return json({cleared:true});}
 const filtered=entries.filter(r=>r.text.includes(u.searchParams.get('q')||''));
 if(u.pathname==='/api/system-logs/export'){lastExport=u.search;const limit=Number(u.searchParams.get('limit'));return route.fulfill({headers:{'content-type':'text/plain','content-disposition':'attachment; filename="argus-system-logs.txt"'},body:(limit?filtered.slice(0,limit):filtered).map(r=>r.text).join('\n')});}
 if(u.pathname==='/api/system-logs')return json({lines:filtered,total:filtered.length});
 return json({});
});
await page.goto('http://127.0.0.1:8765/');await page.locator('#projectsTab').getByText('Projects',{exact:true}).waitFor();
const header=await page.evaluate(()=>{const b=id=>document.getElementById(id).getBoundingClientRect();return {gap:b('status').left-b('settingsTab').right,left:b('brandHome').left,right:innerWidth-b('status').right};});
assert.ok(Math.abs(header.gap-14)<1,JSON.stringify(header));assert.ok(Math.abs(header.left-header.right)<1,JSON.stringify(header));
await page.locator('#settingsTab').click();await page.getByText('VPN gateway unavailable',{exact:true}).waitFor();
assert.equal(await page.locator('#vpnSettings input[type=checkbox]').first().isDisabled(),true,'No false VPN activation without gateway');
await page.locator('#vpnSettings summary').click();
await page.getByRole('textbox',{name:'Profile name',exact:true}).fill('invalid');
await page.getByRole('textbox',{name:'VPN profile',exact:true}).fill('synthetic fixture');
await page.getByRole('button',{name:'Save profile',exact:true}).click();
await page.getByText('The input is invalid. Invalid source order.',{exact:true}).waitFor();
await page.getByRole('textbox',{name:'Profile name',exact:true}).fill('Academic VPN');await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.locator('.vpn-profile').getByText('Academic VPN').waitFor();
assert.equal(await page.locator('.system-log-lines').textContent().then(x=>x.includes('timeout')),true);
await page.getByRole('searchbox',{name:'Search system logs'}).fill('timeout');await page.waitForTimeout(350);assert.equal((await page.locator('.system-log-lines').textContent()).includes('request ok'),false);
const download=page.waitForEvent('download');await page.locator('#systemLogs').getByRole('button',{name:'Export',exact:true}).click();const result=await download;assert.equal(result.suggestedFilename(),'argus-system-logs.txt');assert.ok(result.url().includes('limit=0'));await result.cancel();
await page.getByRole('button',{name:'Clear system logs',exact:true}).click();await page.getByText('Log lines: 0',{exact:true}).waitFor();
const fallback=await page.evaluate(async()=>{const i=await import('/i18n.js');await i.setLanguage('en');const {default:factory}=await import('/app/catalogue.js');const f=factory.create({});return {text:f.pluginText({translations:{de:{'Ungültige Quellenreihenfolge.':'Ungültige Quellenreihenfolge.'}}},'Ungültige Quellenreihenfolge.'),diagnostic:i.diagnostic('ValueError: Genau zwei Bild-Nodes verbinden.')};});
assert.equal(fallback.text,'Invalid source order.');assert.equal(fallback.diagnostic,'ValueError: Connect exactly two image nodes.');
assert.deepEqual(errors,[]);await browser.close();console.log('English error transport/fallback, header insets/settings gap, VPN offline profile UI and system-log search/export/clear passed.');
})().catch(e=>{console.error(e);process.exit(1)});
