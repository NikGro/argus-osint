/* Current React integration contract. All APIs and media are synthetic/local. */
const { chromium } = require(process.env.ARGUS_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.ARGUS_BROWSER_EXECUTABLE});
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(7000); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const artifacts=process.env.ARGUS_ARTIFACT_DIR; if(artifacts) fs.mkdirSync(artifacts,{recursive:true});
  const data=fs.readdirSync('data_plugins').filter(x=>x.endsWith('.json')).map(x=>JSON.parse(fs.readFileSync('data_plugins/'+x)));
  const node=(id,type,x,y,extra={})=>({id,type,label:id,x,y,data:{},evidence:{origin:'manual'},tags:['fixture'],verification:'verified',display:{},report:true,...extra});
  const project={id:'demo',title:'Synthetic UI fixture',revision:1,updated_at:new Date().toISOString(),document:{nodes:[
    node('image','image',40,40,{data:{file_id:'synthetic-image',filename:'fixture.png'},display:{preview:true,imageButton:true,videoButton:true}}),
    node('video','video',380,40,{data:{file_id:'synthetic-video',filename:'fixture.webm'},display:{preview:true,imageButton:true,videoButton:true}}),
    node('note','note',40,420,{data:{text:'Synthetic editable note'},appearance:{width:280,height:180,color:'#ffcc70'}}),
    node('marker','marker',700,420,{appearance:{width:280,height:180,color:'#ffcc70'}}),
    node('phone','phone',700,40,{data:{value:'+49123456789'}}),
    node('datetime','datetime',1000,40,{data:{date:'2026-10-18',time:'12:30',timezone:'UTC'}}),
    node('location','location',1000,420,{data:{country:'Germany',country_code:'DE',locality:'Hamburg'}}),
    node('error','error',380,420,{data:{message:'Synthetic failure'}})
  ],edges:[{id:'edge',source:'image',target:'video',label:'fixture edge'}],groups:[],runs:[],report_notes:''}};
  const research={id:'research',name:'Research',description:'Synthetic provider fixture',settings:{},actions:[{id:'lookup',name:'Research',inputs:['username'],default_params:{source_order:['consensus','holehe'],use_consensus:true,use_holehe:true,search_profiles:{}},research_profiles:{consensus:[{id:'top50',name:'Top 50'}],holehe:[{id:'social',name:'Social'}]}}]};
  let videoBytes;
  await page.goto('http://127.0.0.1:8765/');
  videoBytes=Buffer.from(await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const context=canvas.getContext('2d');const stream=canvas.captureStream(10);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start();for(let i=0;i<12;i++){context.fillStyle=i%2?'#ffcc70':'#53e58b';context.fillRect(0,0,160,90);await new Promise(r=>setTimeout(r,100));}
    recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }));
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url()), method=route.request().method();
    const send=body=>route.fulfill({json:body});
    if(u.pathname==='/api/auth/session')return send({csrf_token:'fixture'});
    if(u.pathname==='/api/settings')return send({settings:{language:'en',tags:[{id:'fixture',name:'Fixture',color:'#6fc58c'}]},languages:[{code:'en',name:'English'},{code:'de',name:'Deutsch'}]});
    if(u.pathname==='/api/plugins')return send({plugins:[...data,research],data_plugins:data,node_defaults:Object.fromEntries(data.flatMap(p=>(p.nodes||[]).map(n=>[n.type,n.defaults])))});
    if(u.pathname==='/api/providers')return send({providers:[]});
    if(u.pathname==='/api/health')return send({status:'ok'});
    if(u.pathname==='/api/jobs')return send({jobs:[]});
    if(u.pathname==='/api/projects')return send([project]);
    if(u.pathname==='/api/projects/demo/reconcile'){project.document=route.request().postDataJSON().local;project.revision++;return send(project);}
    if(u.pathname==='/api/projects/demo'){if(method==='POST'){Object.assign(project,route.request().postDataJSON());project.revision++;}return send(project);}
    if(u.pathname==='/api/plugin/settings')return send({});
    if(u.pathname==='/api/files/synthetic-image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f7c66b"/></svg>'});
    if(u.pathname==='/api/files/synthetic-video')return route.fulfill({contentType:'video/webm',body:videoBytes});
    if(u.pathname==='/api/vpn')return send({settings:{enabled:false,profiles:[],rotation_enabled:false,rotation_mode:'interval',interval_seconds:900},status:{available:false}});
    if(u.pathname==='/api/system-logs'||u.pathname.endsWith('/logs'))return send({lines:[],total:0});
    if(u.pathname==='/api/map-preview')return route.fulfill({contentType:'text/html',body:'<p>Fixture map</p>'});
    return send({});
  });
  const check=async(name,fn)=>{if(process.env.ARGUS_CASES && !name.includes(process.env.ARGUS_CASES))return;console.log('CHECK '+name);await fn();console.log('PASS '+name);};
  try {
    await page.reload();await page.locator('.project-tile').waitFor();
    await check('Card end action remains on right',async()=>{
      const gap=await page.locator('.tile-actions').evaluate(el=>{const box=el.getBoundingClientRect(),last=el.lastElementChild.getBoundingClientRect();return box.right-last.right;});assert.ok(gap<2);
    });
    if(artifacts) await page.screenshot({path:path.join(artifacts,'home.png')});console.log('STEP open project');await page.locator('.project-tile button').first().click();console.log('STEP project clicked');await page.locator('.node[data-id=image]').waitFor();await page.locator('#fit').click();
    await check('Media geometry and playback',async()=>{
      const dimensions=await page.locator('.node[data-id=image]').evaluate(el=>{const media=el.querySelector('foreignObject'),badges=el.querySelector('.node-badges rect');return {bottom:Number(media.getAttribute('y'))+Number(media.getAttribute('height')),badge:Number(badges.getAttribute('y'))};});
      assert.ok(dimensions.bottom+10<=dimensions.badge);
      const video=page.locator('.node[data-id=video] video');
      await video.evaluate(async el=>{await Promise.race([el.play(), new Promise((_,reject)=>setTimeout(()=>reject(Error("Video readiness timeout: "+el.networkState+"/"+el.readyState+"/"+el.error?.message)),5000))]);});await page.waitForTimeout(250);
      assert.ok(await video.evaluate(el=>el.currentTime>0),'Synthetic video actually plays');
      const identity=await video.evaluate(el=>{el.dataset.identity='retained';return el.dataset.identity;});
      await page.locator('#graph').hover({position:{x:80,y:80}});await page.mouse.wheel(50,30);await page.waitForTimeout(100);
      assert.equal(await video.getAttribute('data-identity'),identity);
    });
    await check('Inspector shared fields and section boundaries',async()=>{
      await page.locator('.node[data-id=marker]').click();await page.locator('#fit').click();assert.equal(await page.locator('#inspector .color-swatch').count(),1);
      assert.equal(await page.locator('#inspector .save-indicator').count(),0);
      await page.locator('.node[data-id=datetime]').click();await page.locator('#inspector input[type=date]').waitFor();assert.equal(await page.locator('#inspector input[type=date]').count(),1);assert.equal(await page.locator('#inspector input[type=time]').count(),1);
      await page.locator('.node[data-id=location]').click();await page.locator('#inspector .country-input').waitFor();assert.equal(await page.locator('#inspector .country-input').count(),1);assert.equal(await page.locator('#inspector .country-input input[disabled]').inputValue(),'DE');
      await page.locator('.node[data-id=phone]').click();await page.locator('#inspector .phone-input').waitFor();assert.equal(await page.locator('#inspector .phone-input').count(),1);
      const report=await page.locator('.node-report-section').evaluate(el=>getComputedStyle(el).borderBottomWidth);assert.equal(report,'0px');
    });
    await check('Note releases keyboard focus for graph deletion',async()=>{
      await page.locator('.note-editor').click();await page.keyboard.type(' fixture');
      await page.locator('.node[data-id=error]').click();await page.keyboard.press('Delete');
      await page.locator('.node[data-id=error]').waitFor({state:'detached'});
      assert.equal(await page.locator('.node[data-id=note]').count(),1);
    });
    await check('Pinch zoom and both panel toggles',async()=>{
      const before=await page.locator('#scene').getAttribute('transform');
      await page.locator('#graph').evaluate(el=>{
        const box=el.getBoundingClientRect();const fire=(type,id,x,y)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:box.left+x,clientY:box.top+y,bubbles:true,cancelable:true}));
        // Synthetic events cannot own pointer capture; stub only that DOM capability.
        const original=el.setPointerCapture;el.setPointerCapture=()=>{};
        fire('pointerdown',101,400,300);fire('pointerdown',102,500,300);fire('pointermove',102,600,300);fire('pointerup',101,400,300);fire('pointerup',102,600,300);el.setPointerCapture=original;
      });assert.notEqual(await page.locator('#scene').getAttribute('transform'),before);
      await page.locator('.node[data-id=phone]').click();
      for(const id of ['toggleLeft','toggleRight']){const prior=await page.locator('#scene').getAttribute('transform');await page.locator('#'+id).click();await page.waitForTimeout(100);assert.notEqual(await page.locator('#scene').getAttribute('transform'),prior);await page.locator('#'+id).click();}
    });
    if(artifacts){await page.locator('#fit').click();await page.screenshot({path:path.join(artifacts,'workspace.png')});}
    await page.locator('#back').click();await page.locator('#pluginsTab').click();await page.locator('[data-plugin-row=research] .plugin-expand').click();
    await check('Provider expansion has real content; row drag uses shared component',async()=>{
      const rows=page.locator('[data-plugin-row=research] .source-tile');await rows.first().locator('.source-expand').click();await rows.first().locator('.provider-defaults').waitFor();
      assert.ok((await rows.first().locator('.source-settings').textContent()).length>30);
      await page.evaluate(()=>{window.dragEvents=[]; for(const name of ['dragstart','dragover','drop','dragend']) document.addEventListener(name,e=>{if(window.dragEvents.length<35)window.dragEvents.push([name,e.target.closest('.source-tile')?.dataset.sortId,e.clientY]);},true);});
      await rows.first().locator('.source-handle').dragTo(rows.nth(1));
      console.log('DRAG',JSON.stringify(await page.evaluate(()=>({events:window.dragEvents,rows:[...document.querySelectorAll('[data-plugin-row=research] .source-tile')].map(e=>[e.dataset.sortId,e.style.transform,e.textContent.slice(0,40)])}))));
      await page.waitForFunction(()=>document.querySelector('[data-plugin-row=research] .source-tile .source-order-content').textContent==='Holehe');
    });
    assert.deepEqual(errors,[]);
    if(artifacts){await page.waitForTimeout(220);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'plugins.png'),fullPage:true});}
    console.log('React integration checks completed. No external research or inference.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
