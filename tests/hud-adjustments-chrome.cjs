'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({a,b,popup,call,evaluate,content,hud,send,until,focus,click,appearance,captureId,out,pass,worker,contexts})=>{
 const previous=[await appearance(a),await appearance(b)];for(const v of [a,b])await send(v,'HUD_GLOBAL_UI_SET',{scope:'tab',visible:true,minimized:false});
 for(const v of [a,b]){assert.equal(await hud(v,'h.querySelector(".fm-global-head")'),null);assert.equal(await hud(v,'h.querySelector("#ext-capture-telemetry")'),null);}
 await send(b,'HUD_CAPTURE_STATE',{jobId:captureId,capturedChunks:7,blocks:3,forwardedChunks:24,pendingChunks:0,completedBlocks:1,totalBlocks:2,captureTelemetry:{sileroProbability:.002,tenProbability:.151,confirmed:false,recoveries:0}});
 assert.equal((await send(a,'HUD_CAPTURE_STATE',{jobId:captureId,captureTelemetry:{recoveries:99}})).success,false);
 const details='[data-job-id="'+captureId+'"] .fm-hud-metrics';
 for(const v of [a,b]){await until('telemetria sincronizada na tarefa',()=>hud(v,'h.querySelector("[data-field=\\"vad.sileroProbability\\"]")?.textContent==="Silero: 0,2%"'));assert.equal(await hud(v,'h.querySelector('+JSON.stringify(details)+').open'),false);}
 await hud(b,'h.querySelector('+JSON.stringify(details+' summary')+').click()');await send(b,'HUD_CAPTURE_STATE',{jobId:captureId,captureTelemetry:{sileroProbability:.5,tenProbability:.8,confirmed:true,recoveries:2}});assert.equal(await hud(b,'h.querySelector('+JSON.stringify(details)+').open'),true);assert.equal(await hud(a,'h.querySelector('+JSON.stringify(details)+').open'),false);
 const chips=await hud(b,'Array.from(h.querySelectorAll("[data-job-id=\\"'+captureId+'\\"] .fm-hud-chip")).filter(n=>!n.hidden).map(n=>({text:n.textContent,label:n.getAttribute("aria-label"),title:n.title,top:n.getBoundingClientRect().top}))');assert.equal(chips.length,6);assert.ok(chips.every(n=>n.top===chips[0].top&&n.title===n.label));assert.ok(chips.some(n=>n.text==='24'&&n.label==='Enviados: 24'));assert.ok(chips.some(n=>n.text==='0'));
 // Native pointer on the top-left resize grip, preserving the bottom-right rail anchor.
 await focus(b);const point=await hud(b,'(()=>{const r=h.querySelector("#ext-resize-handle").getBoundingClientRect();return{x:r.x+8,y:r.y+8}})()');
 const dims=v=>hud(v,'(()=>{const r=h.querySelector(".ext-hud-card").getBoundingClientRect();return{width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()');
 const initial=await dims(b),other=await dims(a),localA=await appearance(a);
 const savedSize=()=>content(b,'chrome.storage.local.get("hudSize").then(s=>s.hudSize)');
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},b.session);await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-60,y:point.y-50,buttons:1},b.session);await until('sincronização durante arraste',async()=>(await dims(a)).width>other.width);await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-60,y:point.y-50,button:'left',clickCount:1},b.session);
 await until('tamanho global persistido',async()=>!!(await savedSize()));const resized=await dims(b);
 await until('mesmas dimensões em ambas as janelas',async()=>{const d=await dims(a);return d.width===resized.width&&d.height===resized.height;});
 assert.ok(resized.width>initial.width);assert.equal(resized.right,initial.right);assert.equal(resized.bottom,initial.bottom);
 const synced=await dims(a);assert.equal(synced.right,other.right);assert.equal(synced.bottom,other.bottom);assert.deepEqual(await appearance(a),localA);
 assert.equal((await send(a,'HUD_GLOBAL_GET')).state.size,undefined);assert.equal((await send(b,'HUD_GLOBAL_GET')).state.size,undefined);
 for(const minimized of [true,false])await send(b,'HUD_GLOBAL_UI_SET',{scope:'tab',minimized});assert.deepEqual(await dims(b),resized);
 await send(b,'HUD_GLOBAL_GET');assert.deepEqual(await dims(b),resized);
 await focus(b);const move=await hud(b,'(()=>{const r=h.querySelector(".ext-hud-title").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...move,button:'left',clickCount:1},b.session);await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:move.x-15,y:move.y-10,buttons:1},b.session);await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:move.x-15,y:move.y-10,button:'left',clickCount:1},b.session);assert.equal((await dims(b)).width,resized.width);
 // Extreme sizes remain bounded; keyboard grip and per-tab session restoration.
 await content(b,'fixtureHudController.applySize({width:10000,height:10000})');
 let limits=await dims(b);assert.ok(limits.width<=1000-24);assert.ok(limits.height<=await content(b,'innerHeight-48'));
 await content(b,'fixtureHudController.applySize({width:1,height:1})');limits=await dims(b);assert.equal(limits.width,320);assert.equal(limits.height,260);
 await content(b,'fixtureHudController.applySize('+JSON.stringify({width:resized.width,height:resized.height})+')');
 await send(b,'HUD_GLOBAL_UI_SET',{scope:'tab',size:{width:resized.width,height:resized.height}});
 await hud(b,'h.querySelector("#ext-resize-handle").focus()');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37},b.session);await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37},b.session);
 await until('resize por teclado',async()=>(await dims(b)).width===resized.width+10);
 const preferred=await savedSize();
 await until('teclado sincroniza outra janela',async()=>(await dims(a)).width===preferred.width);
 const bStable=await dims(b),beforeSmall=await savedSize();
 await call('Emulation.setDeviceMetricsOverride',{width:360,height:300,deviceScaleFactor:1,mobile:false},a.session);
 await until('janela pequena limita apenas renderização',async()=>{const d=await dims(a);return d.width<=336&&d.height<=252;});
 assert.deepEqual(await savedSize(),beforeSmall);assert.deepEqual(await dims(b),bStable);
 await call('Emulation.clearDeviceMetricsOverride',{},a.session);await until('dimensões preferidas restauradas na viewport maior',async()=>{const d=await dims(a);return d.width===preferred.width&&d.height===preferred.height;});assert.deepEqual(await savedSize(),preferred);
 await click(a,'#ext-btn-close');await until('HUD fechado',async()=>!(await appearance(a)).visible);assert.deepEqual(await dims(b),bStable);
 await evaluate(worker,'chrome.tabs.sendMessage('+a.tabId+',{type:"TOGGLE_HUD"})');await until('HUD reaberto compacto',async()=>{const s=await appearance(a);return s.visible&&s.minimized;});
 assert.deepEqual(await savedSize(),preferred);await click(a,'#ext-btn-toggle');await until('raio restaura tamanho global',async()=>!(await appearance(a)).minimized&&(await dims(a)).width===preferred.width);
 contexts.set(a.session,[]);await call('Page.reload',{},a.session);
 a.context=await until('content após reload',async()=>{for(const c of contexts.get(a.session)||[])try{if(!c.auxData?.isDefault&&await evaluate(a.session,'typeof fixtureHudController!=="undefined"',c.id))return c.id;}catch{} });
 await send(a,'HUD_GLOBAL_GET');a.documentId=await evaluate(worker,'chrome.storage.session.get("falamermo.globalJobs.v1").then(s=>s["falamermo.globalJobs.v1"].tabHud['+a.tabId+'].documentId)');
 await until('tamanho restaurado após reload',async()=>{const d=await dims(a);return d.width===preferred.width&&d.height===preferred.height;});assert.deepEqual(await savedSize(),preferred);assert.deepEqual(await dims(b),bStable);
 pass('tamanho global ao vivo, posições locais, viewport pequena sem alterar preferência, fechar/reabrir e reload');
 const shot=await call('Page.captureScreenshot',{format:'png'},b.session);fs.writeFileSync(path.join(out,'hud-ajustes.png'),Buffer.from(shot.data,'base64'));
 // The caller continues with the native Popup after restoring per-tab presentation.
 for(const [i,v]of [a,b].entries())await send(v,'HUD_GLOBAL_UI_SET',{scope:'tab',...previous[i]});
 pass('cabeçalho removido, telemetria por tarefa, chips acessíveis em linha e resize global, arraste e minimização por aba');
};
