'use strict';
// Real Chrome/MV3, focus, registry messages and pointer input. Capture metadata
// and telemetry samples here are fixtures; translation-hud-chrome tests real
// microphone/VAD processing with a virtual device and a simulated provider.
const assert=require('node:assert/strict');
module.exports=async function({call,evaluate,attach,page,worker,base,content,send,hud,state,until,sleep,input,screenshot,pass}){
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},page);
 const visible=()=>hud('!h.querySelector(".ext-hud-card").classList.contains("hidden")');
 const wave=()=>hud('getComputedStyle(h.querySelector(".fm-hud-task-wave svg")).animationName');
 const raw=()=>evaluate(worker,'chrome.storage.session.get("falamermo.globalJobs.v1").then(s=>s["falamermo.globalJobs.v1"])');
 const jobId='human-homologation-capture';
 const telemetryOpen=()=>hud('h.querySelector("[data-job-id=\\"'+jobId+'\\"] .fm-hud-metrics")?.open||false');
 assert.equal(await telemetryOpen(),false);
 assert.equal(await hud('h.querySelector(".ext-hud-waveform,.fm-hud-player-wave")'),null);
 assert.equal(await hud('h.querySelector(".fm-global-seek-note").hidden'),true);
 // Keep the global default hidden so an unprojected refresh cannot masquerade
 // as a successful per-tab manual-open test.
 await send('HUD_GLOBAL_UI_SET',{visible:false});
 await send('HUD_GLOBAL_UI_SET',{visible:true,minimized:false});
 assert.equal((await send('STT_CAPTURE_RESERVE',{jobId})).success,true);
 await send('HUD_CAPTURE_STATE',{jobId,status:'recording',microphoneReleased:false,captureTelemetry:{confirmed:true}});
 await until('waveform da captura',async()=>await wave()==='ext-player-wave');
 assert.equal(await telemetryOpen(),false,'gravar não expande Captação');
 const source=(await state()).jobs.find(j=>j.jobId===jobId).origin;
 const documentId=(await raw()).tabHud[source.tabId].documentId;assert.equal((await raw()).visible,false);assert.equal(await visible(),true);
 const {targetId:oid}=await call('Target.createTarget',{url:base+'options.html'}),options=await attach(oid);
 const {targetId:pid}=await call('Target.createTarget',{url:base+'popup.html'}),popup=await attach(pid);
 for(const surface of [options,popup]){await call('Page.bringToFront',{},surface);await until('superfície conectada',()=>evaluate(surface,'typeof chrome!=="undefined"&&!!document.querySelector(".fm-global-hud")'));await evaluate(surface,'chrome.runtime.sendMessage({type:"HUD_GLOBAL_GET"})');}
 await evaluate(options,'chrome.runtime.sendMessage({type:"HUD_GLOBAL_UI_SET",payload:{minimized:true}})');
 await call('Page.bringToFront',{},page);await send('HUD_GLOBAL_GET');assert.equal(await visible(),true);assert.equal((await raw()).tabHud[source.tabId].documentId,documentId);
 await call('Target.closeTarget',{targetId:pid});await call('Target.closeTarget',{targetId:oid});await call('Page.bringToFront',{},page);await send('HUD_GLOBAL_UI_SET',{minimized:false});await send('HUD_GLOBAL_GET');assert.equal(await visible(),true);
 await send('HUD_CAPTURE_STATE',{jobId,microphoneReleased:true});
 assert.equal((await state()).jobs.find(j=>j.jobId===jobId).status,'recording','regressão: status antigo pode chegar antes da finalização');
 await until('waveform para com microfone liberado',async()=>await wave()==='none');
 const transform=await hud('getComputedStyle(h.querySelector(".fm-hud-task-wave svg")).transform');await sleep(160);assert.equal(await hud('getComputedStyle(h.querySelector(".fm-hud-task-wave svg")).transform'),transform);
 assert.equal((await send('HUD_CAPTURE_STATE',{jobId,status:'completed'})).success,true);await sleep(5300);await send('HUD_GLOBAL_GET');assert.equal(await visible(),true);
 pass('homologação: abertura manual resiste a foco/Popup/Opções, documento preservado e timer após captura');
 pass('homologação: waveform fica imóvel após liberação, mesmo com status recording atrasado');
 const sample=(value,confirmed=false,recoveries=7)=>content('fixtureHudController.setCaptureNotice('+JSON.stringify({jobId,sileroProbability:value,tenProbability:.987654321,confirmed,recoveries})+')');
 await sample(.123456789);await send('HUD_GLOBAL_COMMAND',{jobId,action:'collapse',collapsed:false});
 assert.equal(await telemetryOpen(),false,'atualização não expande Captação');
 assert.equal(await hud('h.querySelector("#ext-capture-notice").hidden'),true);
 await hud('h.querySelector("[data-job-id=\\"'+jobId+'\\"] .fm-hud-metrics summary").click()');
 assert.equal(await hud('h.querySelector("[data-field=\\"vad.sileroProbability\\"]").textContent'),'Silero: 12,3%');assert.equal(await hud('h.querySelector("[data-field=\\"vad.sileroProbability\\"]").title'),'Silero: 0.123456789');assert.equal(await hud('h.querySelector("[data-field=\\"vad.tenProbability\\"]").textContent'),'TEN: 98,8%');assert.equal(await hud('h.querySelector("[data-field=\\"vad.recoveries\\"]").textContent'),'Recuperações: 7');
 // A different containing viewport width used to feed rects back into right.
 await evaluate(page,'document.documentElement.style.scrollbarGutter="stable both-edges";document.body.style.minHeight="200vh"');await sleep(150);
 const anchor=()=>hud('(()=>{const r=h.querySelector("#ext-drag-handle").getBoundingClientRect();return {x:r.x,y:r.y}})()');
 const p=await hud('(()=>{const r=h.querySelector(".ext-hud-title").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await input('mousePressed',p.x,p.y,{button:'left',clickCount:1});await input('mouseMoved',p.x-90,p.y-40,{buttons:1});await input('mouseReleased',p.x-90,p.y-40,{button:'left',clickCount:1});
 const released=await anchor();
 for(let i=0;i<40;i++){await sample(i/100,i%2===0,i);await send('HUD_GLOBAL_SET',{volume:i%2?.5:.55});const a=await anchor();assert.ok(Math.abs(a.x-released.x)<.25&&Math.abs(a.y-released.y)<.25,JSON.stringify({released,a,i}));}
 await sleep(900);const settled=await anchor();assert.ok(Math.abs(settled.x-released.x)<.25&&Math.abs(settled.y-released.y)<.25);assert.equal(await hud('h.querySelector(".ext-hud-panel").style.transform'),'');
 assert.equal(await hud('h.querySelector("[data-job-id=\\"'+jobId+'\\"] .fm-hud-metrics")?.open||false'),true);pass('homologação: barra permanece no ponto solto durante acomodação, gutter e 40 atualizações');
 for(const [width,height]of [[320,480],[360,260],[1280,900]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},page);await sleep(120);
  assert.equal(await hud('(()=>{const t=h.querySelector("[data-job-id=\\"'+jobId+'\\"] .fm-hud-metrics"),r=t.getBoundingClientRect();return t.scrollWidth<=t.clientWidth&&h.querySelector(".fm-hud-metric-values").scrollHeight>=0&&h.querySelector(".ext-hud-panel").scrollWidth<=h.querySelector(".ext-hud-panel").clientWidth})()'),true);
  await screenshot('homologacao-telemetria-'+width+'x'+height);
 }
 await sample(0,true,0);assert.equal(await hud('h.querySelector("[data-field=\\"vad.sileroProbability\\"]").textContent'),'Silero: 0%');assert.equal(await hud('h.querySelector("[data-field=\\"vad.recoveries\\"]").textContent'),'Recuperações: 0');
 await send('HUD_GLOBAL_UI_SET',{minimized:true});await content('fixtureHudController.setCaptureNotice("Silero + TEN: timeout · PCM em buffer, envio aguardando validação.")');assert.equal(await hud('h.querySelector("#ext-capture-notice").hidden'),false);assert.equal(await hud('h.querySelector("[data-job-id=\\"'+jobId+'\\"] .fm-hud-metrics")?.open||false'),true);
 await send('HUD_GLOBAL_UI_SET',{minimized:false});await content('fixtureHudController.setCaptureNotice("")');await sample(.123456789);
 assert.equal(await telemetryOpen(),true,'ocultar/reexibir telemetria preserva expansão manual');
 await hud('h.querySelector("[data-job-id=\\"'+jobId+'\\"] .fm-hud-metrics summary").click()');await sample(.4);assert.equal(await telemetryOpen(),false);
 await evaluate(page,'document.body.style.background="white"');await screenshot('homologacao-vidro-pagina-branca');
 pass('homologação: telemetria atualiza valores, preserva expansão/avisos e cabe em viewports pequenas');
 pass('refino: ondas sem bloco visual; Captação recolhida por padrão e escolha manual preservada');
 await hud('h.querySelector("#ext-btn-close").click()');await until('ocultação manual confirmada',async()=>!await visible());await send('HUD_GLOBAL_GET');assert.equal(await visible(),false);pass('homologação: ocultação explícita continua respeitada');
};
