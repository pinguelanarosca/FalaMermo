'use strict';
// Real Chrome/MV3, wall-clock deadlines, native pointer input and browser zoom.
// Task completions below are injected into the real registry; no audio provider is used here.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({a,b,peer,worker,call,evaluate,content,hud,send,until,focus,click,appearance,pass,out})=>{
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let serial=0;
 const finish=async()=>{
  await send(peer,'HUD_GLOBAL_UI_SET',{visible:false});const jobId='click-deadline-'+(++serial);
  await evaluate(worker,'(async()=>{await fixtureRegistry.start('+JSON.stringify({jobId,requestId:jobId,type:'TTS',text:'Teste de fechamento',origin:{tabId:peer.tabId}})+');await fixtureRegistry.event('+JSON.stringify({jobId,requestId:jobId,event:'ended',eventSeq:1})+');})()');
  await until('abertura automática compacta',async()=>{const s=await appearance(peer);return s.visible&&s.minimized;});return jobId;
 };
 const automation=()=>evaluate(worker,'chrome.storage.session.get("falamermo.globalJobs.v1").then(s=>s["falamermo.globalJobs.v1"].hudAutomation)');
 await finish();const deadline=(await automation()).closeAt;assert.ok(deadline>Date.now());await focus(b);await send(peer,'HUD_GLOBAL_GET');await focus(peer);
 await until('fecha após 5s sem clique, mesmo com foco e GET',async()=>!(await appearance(peer)).visible);assert.ok(Date.now()>=deadline);
 pass('temporizador real fecha sem clique; foco e atualização de estado não contam como intervenção');
 await finish();await focus(peer);const p=await hud(peer,'(()=>{const r=h.querySelector(".ext-hud-header").getBoundingClientRect();return{x:r.x+2,y:r.y+r.height/2}})()');
 for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1},peer.session);
 await until('clique em área vazia da barra cancela prazo',async()=>(await automation()).closeAt===0);await sleep(5300);assert.equal((await appearance(peer)).visible,true);assert.equal((await appearance(peer)).minimized,true);
 await click(peer,'#ext-btn-toggle');await until('expansão manual',async()=>!(await appearance(peer)).minimized);
 await evaluate(worker,'fixtureRegistry.start('+JSON.stringify({jobId:'click-metrics',type:'TTS',text:'Indicadores reais do registro',origin:{tabId:peer.tabId},progress:{totalBlocks:3,completedBlocks:1,pendingChunks:2}})+')');
 await send(peer,'HUD_GLOBAL_COMMAND',{jobId:'click-deadline-2',action:'collapse',collapsed:false});
 // Each click must reach the capturing listener, including non-button elements.
 for(const selector of ['.fm-global-kind','.fm-hud-chip','.fm-global-card','.fm-global-player']){
  const count=await evaluate(worker,'fixtureUiTrace.filter(t=>t.tabId==='+peer.tabId+'&&t.payload.interaction).length');await click(peer,selector);
  await until('intervenção em '+selector,()=>evaluate(worker,'fixtureUiTrace.filter(t=>t.tabId==='+peer.tabId+'&&t.payload.interaction).length>'+count));
 }
 await click(peer,'#ext-btn-close');await until('fechamento explícito prevalece sobre clique capturado',async()=>!(await appearance(peer)).visible);
 pass('cliques em barra compacta, texto, indicador, cartão e controles registram intervenção; fechar explícito funciona');
 await send(peer,'HUD_GLOBAL_UI_SET',{visible:true,minimized:false});
 const anchor=()=>hud(peer,'(()=>{const r=h.querySelector(".ext-hud-header").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()');
 const saved=await content(peer,'chrome.storage.local.get("hudSize").then(s=>s.hudSize||null)');
 const layouts=[
  {name:'curta',width:1100,height:850,zoom:1,css:'html,body{margin:0;min-height:0;height:auto;overflow:auto}body{background:#e9edf4;color:#111}'},
  {name:'rolagem',width:1000,height:800,zoom:.8,css:'html{overflow-y:scroll}body{margin:16px;min-height:250vh;background:#1d293d}'},
  {name:'estreita',width:680,height:720,zoom:1.25,css:'html{overflow:scroll}body{width:150vw;min-height:180vh;margin:0;background:#38516d}'}
 ];
 for(const layout of layouts){
  for(const job of (await send(peer,'HUD_GLOBAL_GET')).state.jobs)await send(peer,'HUD_GLOBAL_COMMAND',{jobId:job.jobId,action:'collapse',collapsed:true});
  await call('Emulation.setDeviceMetricsOverride',{width:layout.width,height:layout.height,deviceScaleFactor:1,mobile:false},peer.session);
  await evaluate(worker,'chrome.tabs.setZoom('+peer.tabId+','+layout.zoom+')');
  await evaluate(peer.session,'(()=>{let s=document.querySelector("#fixture-layout");if(!s){s=document.createElement("style");s.id="fixture-layout";document.head.append(s);}s.textContent='+JSON.stringify(layout.css)+';window.scrollTo(0,120)})()');
  await content(peer,'(()=>{const c=fixtureHudController;c.applySize({width:420,height:visualViewport.height-48});c.posX=24;c.posY=24;c.container.style.right="24px";c.container.style.bottom="24px";c.resetMotion();c.constrainPosition()})()');await sleep(150);
  const before=await anchor(),point={x:before.x+before.width/2,y:before.y+before.height/2};
  const space=await hud(peer,'Math.min(h.querySelector(".ext-hud-panel").getBoundingClientRect().top,h.querySelector(".ext-hud-header").getBoundingClientRect().top)-visualViewport.offsetTop-12');const dy=Math.min(100,space);assert.ok(dy>=30,JSON.stringify({layout,space,before}));
  await focus(peer);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},peer.session);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-45,y:point.y-100,buttons:1},peer.session);await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-45,y:point.y-100,button:'left',clickCount:1},peer.session);
  const released=await anchor();assert.ok(Math.abs(released.x-before.x+45)<1,JSON.stringify({layout,before,released}));assert.ok(Math.abs(released.y-before.y+dy)<1,JSON.stringify({layout,before,released,dy}));
  await sleep(850);const settled=await anchor();assert.ok(Math.abs(settled.x-released.x)<.3&&Math.abs(settled.y-released.y)<.3,'sem deriva após soltar');
  for(let i=0;i<15;i++)await send(peer,'HUD_GLOBAL_GET');const stable=await anchor();assert.ok(Math.abs(stable.y-released.y)<.3);
  await content(peer,'fixtureHudController.moveHud(-10000,-10000)');await sleep(850);const limited=await anchor();assert.ok(limited.x>=11&&limited.y>=11);
  await content(peer,'fixtureHudController.moveHud(10000,10000)');await sleep(850);assert.equal(await hud(peer,'(()=>{const r=h.querySelector(".ext-hud-header").getBoundingClientRect();return r.right<=visualViewport.offsetLeft+visualViewport.width-11&&r.bottom<=visualViewport.offsetTop+visualViewport.height-11})()'),true);
  assert.deepEqual(await content(peer,'chrome.storage.local.get("hudSize").then(s=>s.hudSize||null)'),saved,'contenção não grava tamanho global');
  const shot=await call('Page.captureScreenshot',{format:'png'},peer.session);fs.writeFileSync(path.join(out,'arraste-'+layout.name+'.png'),Buffer.from(shot.data,'base64'));
 }
 await evaluate(worker,'chrome.tabs.setZoom('+peer.tabId+',1)');await call('Emulation.clearDeviceMetricsOverride',{},peer.session);
 assert.equal((await appearance(a)).visible,true);assert.equal((await appearance(b)).visible,true);
 pass('arraste horizontal/vertical real em 3 layouts, zoom 80/100/125%, barras de rolagem, limites e estabilidade; preferência global intacta');
};
