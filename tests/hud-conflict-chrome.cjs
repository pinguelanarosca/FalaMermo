'use strict';
// Real capture owner, two native windows and an additional tab. Provider and mic input are fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({page,isolated,worker,tabId,views,call,evaluate,waitFor,state,out})=>{
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),title='Ditado principal — título real';
 const local=(v,code)=>evaluate(v.session,code,v.context),hud=(v,code)=>local(v,'(()=>{const h=document.querySelector("#ext-tts-stt-host").shadowRoot;return '+code+'})()');
 const send=(v,type,payload={})=>local(v,'chrome.runtime.sendMessage('+JSON.stringify({type,payload})+')');
 const owner=(await state()).jobs.find(j=>j.type==='STT'&&j.status==='recording');assert.ok(owner);
 await evaluate(page,'document.title='+JSON.stringify(title));assert.equal(await evaluate(worker,'chrome.tabs.get('+tabId+').then(t=>t.title)'),title);
 for(const v of views){
  v.tabId=await evaluate(worker,'chrome.tabs.query({}).then(t=>t.find(x=>x.url==='+JSON.stringify(v.url)+').id)');v.prior=(await send(v,'HUD_GLOBAL_GET')).state;
  await send(v,'HUD_GLOBAL_UI_SET',{minimized:true});
  await local(v,'globalThis.fixtureBusyEvents=[];new MutationObserver(()=>{const n=document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector("#ext-microphone-notice");fixtureBusyEvents.push({hidden:n.hidden,at:performance.now()});}).observe(document.querySelector("#ext-tts-stt-host").shadowRoot.querySelector("#ext-microphone-notice"),{attributes:true,attributeFilter:["hidden"]})');
  await call('Page.bringToFront',{},v.session);await evaluate(v.session,'document.querySelector("textarea").focus()');
  await evaluate(worker,'chrome.tabs.sendMessage('+v.tabId+',{type:"CMD_START_DICTATION"})');
  await waitFor('aviso de conflito com título real',()=>hud(v,'(()=>{const n=h.querySelector("#ext-microphone-notice");return !n.hidden&&n.querySelector("span").textContent==='+JSON.stringify('O microfone já está em uso na aba “'+title+'”.')+'})()'));
  v.timer=await local(v,'fixtureHudController.microphoneNoticeTimer');
  assert.equal(await hud(v,'h.querySelectorAll("#ext-microphone-notice").length'),1);
  assert.equal(await hud(v,'h.querySelector(".ext-hud-card").dataset.minimized'),'true');
  await sleep(60);const geometry=await hud(v,'(()=>{const n=h.querySelector("#ext-microphone-notice").getBoundingClientRect(),r=h.querySelector(".ext-hud-header").getBoundingClientRect();return{left:n.left,right:n.right,top:n.top,bottom:n.bottom,railTop:r.top,railLeft:r.left,railRight:r.right,viewport:visualViewport.width}})()');assert.ok(geometry.left>=0&&geometry.right<=geometry.viewport&&geometry.top>=0&&(geometry.bottom<=geometry.railTop+1||geometry.right<=geometry.railLeft-7||geometry.left>=geometry.railRight+7),JSON.stringify(geometry));
  const shot=await call('Page.captureScreenshot',{format:'png'},v.session);fs.writeFileSync(path.join(out,'aviso-microfone-'+v.tabId+'.png'),Buffer.from(shot.data,'base64'));
 }
 const windows=await evaluate(worker,'Promise.all('+JSON.stringify(views.map(v=>v.tabId).concat(tabId))+'.map(id=>chrome.tabs.get(id).then(t=>t.windowId)))');assert.equal(windows[0],windows[2]);assert.notEqual(windows[1],windows[2]);
 for(const v of views){
  for(let i=0;i<6;i++){await send(v,'HUD_GLOBAL_GET');await local(v,'fixtureHudController.setCaptureNotice("");fixtureHudController.setStatus("loading","Conectando ditado")');}
  await evaluate(worker,'chrome.tabs.sendMessage('+v.tabId+',{type:"CMD_START_DICTATION"})');await sleep(100);
  assert.equal(await local(v,'fixtureHudController.microphoneNoticeTimer'),v.timer,'repetição não reinicia prazo');assert.equal(await hud(v,'h.querySelector("#ext-microphone-notice").hidden'),false);
 }
 const elapsed=await local(views[0],'performance.now()-fixtureBusyEvents[0].at');await sleep(Math.max(0,7900-elapsed));
 for(const v of views)assert.equal(await hud(v,'h.querySelector("#ext-microphone-notice").hidden'),false,'continua legível antes dos 8 segundos');
 for(const v of views){
  await waitFor('aviso encerra somente após 8s',()=>hud(v,'h.querySelector("#ext-microphone-notice").hidden'));
  const events=await local(v,'fixtureBusyEvents');assert.equal(events.length,2,'sem piscadas nas atualizações');assert.equal(events[0].hidden,false);assert.equal(events[1].hidden,true);assert.ok(events[1].at-events[0].at>=8000,JSON.stringify(events));
 }
 const v=views[1];await evaluate(worker,'chrome.tabs.sendMessage('+v.tabId+',{type:"CMD_START_DICTATION"})');await waitFor('novo aviso dispensável',()=>hud(v,'!h.querySelector("#ext-microphone-notice").hidden'));
 await call('Page.bringToFront',{},v.session);const point=await hud(v,'(()=>{const r=h.querySelector("#ext-microphone-notice button").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1},v.session);
 await waitFor('dispensa manual do aviso',()=>hud(v,'h.querySelector("#ext-microphone-notice").hidden'));assert.equal(await local(v,'fixtureHudController.microphoneNoticeTimer'),null);
 assert.equal((await state()).jobs.filter(j=>j.type==='STT'&&!j.microphoneReleased).length,1);assert.equal((await state()).jobs.find(j=>j.jobId===owner.jobId).status,'recording');
 assert.equal(await evaluate(page,'fixtureStt.isRecording&&fixtureStt.liveCapture.stream.getTracks().every(t=>t.readyState==="live")',isolated),true);
 for(const view of views)await send(view,'HUD_GLOBAL_UI_SET',{visible:view.prior.visible,minimized:view.prior.minimized});await call('Page.bringToFront',{},page);
 console.log('VERIFICADO: conflito real com captura ativa entre abas e janelas; título obtido por tabId; aviso próximo à barra por >=8s, sem piscar/reiniciar, com dispensa nativa; microfone original preservado.');
};
