const {chromium}=require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.ARGUS_BROWSER_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const data=fs.readdirSync('data_plugins').filter(x=>x.endsWith('.json')).map(x=>JSON.parse(fs.readFileSync('data_plugins/'+x)));
const n=(id,type,label,x,y,extra={})=>({id,type,label,x,y,data:type==='username'?{value:label}:type==='note'?{text:'Synthetic data only. No research is executed.'}:type==='error'?{title:'Partial results',message:'Zeitlimit erreicht; Teilergebnisse gespeichert.'}:{value:label},evidence:{origin:'manual'},tags:[],verification:'verified',display:{},report:true,...extra});
const tool=(id,x,y)=>n(id,'actor','Username research',x,y,{data:{plugin:'research',action:'lookup',params:{timeout:30}}});
const project={id:'demo',title:'Academic research · synthetic workspace',revision:1,document:{nodes:[n('input','username','example_fixture',0,100),tool('lookup',360,100),n('profile','profile','Example profile',740,60,{data:{provider:'Example',identifier:'example_fixture',url:'https://example.invalid/profile'}}),n('email','email','fixture@example.invalid',740,300,{data:{value:'fixture@example.invalid'}}),n('note','note','Research notes',0,380),n('error','error','Partial results',1100,300),n('marker','marker','Discovery',300,20,{data:{},appearance:{width:750,height:650,color:'#a9d5f5'}})],edges:[{id:'in',source:'input',target:'lookup',label:'Eingabe'},{id:'out',source:'lookup',target:'profile',label:'Ergebnis'},{id:'out2',source:'lookup',target:'email',label:'Ergebnis'}],groups:[],runs:[],report_notes:''}};
const research={id:'research',name:'Username research',description:'Discover public profiles using enabled providers.',translations:{en:{'Username research':'Username research'}},settings:{},actions:[{id:'lookup',name:'Username research',inputs:['username'],default_params:{timeout:30},min_inputs:2}]};
let vpn={enabled:false,profiles:[],rotation_enabled:true,rotation_mode:'interval',interval_seconds:900};let logFetches=0;
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();
 const send=body=>route.fulfill({json:body}),body=()=>route.request().postDataJSON();
 if(u.pathname==='/api/auth/session')return send({csrf_token:'fixture'});
 if(u.pathname==='/api/settings')return send({settings:{language:'en',tags:[{id:'review',name:'Reviewed',color:'#6fc58c'}]},languages:[{code:'en',name:'English'},{code:'de',name:'Deutsch'}]});
 if(u.pathname==='/api/plugins')return send({plugins:[...data,research],data_plugins:data,node_defaults:Object.fromEntries(data.flatMap(p=>p.nodes.map(n=>[n.type,n.defaults])))});
 if(u.pathname==='/api/providers')return send({providers:[]});
 if(u.pathname==='/api/jobs')return send({jobs:[]});if(u.pathname==='/api/health')return send({status:'ok'});
 if(u.pathname==='/api/projects')return send([project]);
 if(u.pathname==='/api/projects/demo/reconcile'){project.document=body().local;project.revision++;return send(project);}
 if(u.pathname==='/api/projects/demo'){if(route.request().method()==='POST'){Object.assign(project,body());project.revision++;}return send(project);}
 if(u.pathname==='/api/vpn'){if(route.request().method()==='POST'){vpn=body();vpn.profiles=vpn.profiles.map((p,i)=>({...p,id:p.id||'vpn'+i}));}return send({settings:vpn,status:{available:true,state:'disabled',enabled:false}});}
 if(u.pathname==='/api/system-logs'){logFetches++;return send({lines:[{text:'2026-10-16 INFO application ready'},{text:'2026-10-16 INFO synthetic fixture loaded'}],total:2});}
 return send({});
});
fs.mkdirSync('docs/assets',{recursive:true});
await page.goto('http://127.0.0.1:8765/');await page.locator('.project-tile').waitFor();
const centeredCreate = await page.locator('#newProject').evaluate(e=>{const r=e.getBoundingClientRect(),a=e.firstElementChild.getBoundingClientRect(),b=e.lastElementChild.getBoundingClientRect();return Math.abs((a.left+b.right-r.left-r.right)/2)<1;});assert.ok(centeredCreate,'Create project content centered as one unit');
await page.screenshot({path:'docs/assets/home.png'});
await page.locator('.project-tile button').first().click();await page.locator('.node[data-id=lookup]').waitFor();await page.locator('#fit').click();
assert.equal(await page.locator('.node[data-id=lookup] .dock').count(),3,'Two required left inputs and one right output');
assert.equal(await page.locator('.node[data-id=marker] .note-editor').count(),0);
await page.locator('.node[data-id=error]').click();assert.equal(await page.locator('#inspector .verification-select').count(),0);assert.ok((await page.locator('.node[data-id=error]').textContent()).includes('Time limit reached'));
await page.locator('.node[data-id=note]').click();assert.equal(await page.locator('#inspector .verification-select').count(),0);
await page.locator('.node[data-id=input]').click();await page.locator('.node[data-id=email]').click({modifiers:['Shift']});
const report=page.locator('#inspector .multi-selection-actions input[type=checkbox]');await report.waitFor();assert.equal(await report.isChecked(),true);
await report.uncheck();await page.waitForTimeout(850);assert.equal(project.document.nodes.find(n=>n.id==='email').report,false);
await page.locator('#fit').click();await page.locator('.node[data-id=profile]').click();await page.screenshot({path:'docs/assets/workspace.png'});
await page.locator('#back').click();await page.locator('#pluginsTab').click();await page.locator('[data-plugin-row=research] .plugin-expand').click();
const centered=await page.locator('[data-plugin-row=research] .plugin-expand').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.querySelector('svg').getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2)<1&&Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<1;});assert.ok(centered,'Chevron centered');
await page.locator('#pluginSearch').fill('Username research');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'docs/assets/plugins.png'});
await page.locator('#settingsTab').click();await page.getByRole('button',{name:'Add VPN profile',exact:true}).waitFor();
assert.equal(await page.locator('#statusText').textContent(),'Saved');
await page.getByRole('button',{name:'Add VPN profile',exact:true}).click();
await page.getByRole('textbox',{name:'Profile name',exact:true}).fill('Academic fixture');await page.getByRole('textbox',{name:'VPN profile',exact:true}).fill('Synthetic profile; never connected');await page.getByRole('button',{name:'Save profile',exact:true}).click();
await page.locator('.vpn-profile-header').waitFor();assert.equal(await page.locator('.vpn-profile-header').evaluate(e=>e.firstElementChild.classList.contains('source-expand')),true);assert.equal(await page.locator('.vpn-profile-header .source-expand').evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');assert.equal(await page.locator('.vpn-profile-header .source-drag').count(),1);await page.getByRole('button',{name:'Expand profile',exact:true}).click();await page.locator('.vpn-profile-body').waitFor({state:'visible'});
const align=await page.evaluate(()=>{const b=[...document.querySelectorAll('#vpnSettings button')].find(e=>e.textContent.includes('Switch VPN now')),i=document.querySelector('#vpnSettings input[type=number]');return Math.abs(b.getBoundingClientRect().bottom-i.getBoundingClientRect().bottom);});assert.ok(align<2,'VPN interval/action aligned: '+align);
await page.getByRole('checkbox',{name:'Auto refresh',exact:true}).check();await page.getByRole('checkbox',{name:'Auto scroll to bottom',exact:true}).check();
const before=logFetches;await page.waitForTimeout(5200);assert.ok(logFetches>before,'Auto refresh requests newer lines');
await page.getByRole('checkbox',{name:'Auto refresh',exact:true}).uncheck();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'docs/assets/settings.png',fullPage:true});
const sticky=await page.locator('body > header').evaluate(e=>getComputedStyle(e).position);assert.equal(sticky,'sticky');assert.deepEqual(errors,[]);
const mobile=await browser.newContext({userAgent:'Mozilla/5.0 (Linux; Android 14; Mobile)',viewport:{width:390,height:844}}),mp=await mobile.newPage();
await mp.route('**/api/**',route=>route.fulfill({json:route.request().url().includes('/settings')?{settings:{language:'en'}}:{csrf_token:'fixture'}}));
await mp.goto('http://127.0.0.1:8765/');await mp.getByRole('heading',{name:'ARGUS is designed for desktop'}).waitFor();assert.equal(await mp.locator('#home').isVisible(),false);
await browser.close();console.log('Alpha 1 UI: fixed sockets, marker, English diagnostics/mobile guard, multi-select report checkbox, icons, sticky saved status, VPN profiles/alignment and log refresh passed. Synthetic screenshots saved.');
})().catch(e=>{console.error(e);process.exit(1)});
