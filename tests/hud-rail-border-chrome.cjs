'use strict';
// Chrome/MV3 and real CSS animation clock; task execution states come from registry fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({call,evaluate,page,worker,content,hud,state,send,until,sleep,pass,out})=>{
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},page);
 await send('HUD_GLOBAL_UI_SET',{minimized:true});
 const sample=()=>hud('(()=>{const n=h.querySelector(".ext-hud-header"),b=getComputedStyle(n,"::before"),g=getComputedStyle(n,"::after");return{jobId:n.dataset.borderJobId,type:n.dataset.taskType,running:n.dataset.taskRunning,main:getComputedStyle(n).getPropertyValue("--task-main").trim().toLowerCase(),angle:b.getPropertyValue("--fm-border-angle"),animation:b.animationName,pulse:g.animationName,play:b.animationPlayState,duration:b.animationDuration,pulseDuration:g.animationDuration,padding:b.paddingTop,display:b.display,glowDisplay:g.display,opacity:b.opacity,glow:g.opacity,mask:b.maskComposite,pointer:b.pointerEvents}})()');
 const geometry=()=>hud('(()=>{const n=h.querySelector(".ext-hud-header"),r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,width:r.width,height:r.height,background:s.backgroundColor,opacity:s.opacity,filter:s.backdropFilter,buttons:[...n.querySelectorAll("button")].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})}})()');
 const expectedColors={dictation:'#10a37f',narration:'#2563eb',lens:'#ea580c'};
 const check=async(jobId,type)=>{
  await until('moldura da execução '+jobId,async()=>{const s=await sample();return s.jobId===jobId&&s.type===type;});
  const first=await sample();await sleep(150);const second=await sample();assert.equal(second.running,'true');assert.equal(second.main,expectedColors[type]);assert.equal(second.animation,'fm-task-border-turn');assert.equal(second.pulse,'fm-task-border-glow');assert.equal(second.duration,'4s');assert.equal(second.pulseDuration,'3s');assert.equal(second.padding,'2px');assert.equal(second.pointer,'none');assert.ok(second.mask.split(',').every(v=>v.trim()==='exclude'));assert.notEqual(first.angle,second.angle);
  // Temporarily remove only decorative attributes: paint cannot change layout or materials.
  const visible=await geometry();await hud('h.querySelector(".ext-hud-header").dataset.taskType="neutral"');assert.deepEqual(await geometry(),visible);await hud('h.querySelector(".ext-hud-header").dataset.taskType='+JSON.stringify(type));
  const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(out,'barra-'+type+'.png'),Buffer.from(shot.data,'base64'));
 };
 const start=async(jobId,type,extra={})=>evaluate(worker,'fixtureRegistry.start('+JSON.stringify({jobId,type,text:'Tarefa do cenário visual',origin:{tabId:0,frameId:0},...extra})+')');
 const event=(jobId,event,eventSeq,extra={})=>evaluate(worker,'fixtureRegistry.event('+JSON.stringify({jobId,event,eventSeq,...extra})+')');
 const idle=async()=>{await until('barra neutra',async()=>(await sample()).type==='neutral');const s=await sample();assert.equal(s.running,'false');assert.equal(s.jobId,'');assert.equal(s.animation,'none');assert.equal(s.pulse,'none');assert.equal(s.display,'none');assert.equal(s.glowDisplay,'none');};
 await idle();await start('rail-stt','STT');await event('rail-stt','setup-complete',1);await check('rail-stt','dictation');
 await start('rail-tts','TTS');await event('rail-tts','play',1,{progress:{contextState:'running',workletPaused:false}});await check('rail-tts','narration');
 await start('rail-lens','TTS',{source:'lens'});await check('rail-lens','lens');
 await event('rail-lens','error',1,{error:'Erro controlado do cenário visual.'});await check('rail-tts','narration');
 await event('rail-tts','pause',2,{progress:{contextState:'suspended',workletPaused:true}});await check('rail-stt','dictation');
 await event('rail-stt','stt-cancelled',2);await idle();
 await event('rail-tts','play',3,{progress:{contextState:'running',workletPaused:false}});await check('rail-tts','narration');await event('rail-tts','ended',4);await idle();
 pass('barra compacta verde/azul/laranja acompanha a execução mais recente; pausa/erro usam a próxima execução; ausência de execução fica neutra');
 await start('rail-reduced','STT');await check('rail-reduced','dictation');await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},page);
 const structural=await hud('getComputedStyle(h.querySelector(".ext-hud-header>.ext-hud-glass")).backgroundColor'),values=[];
 for(const level of [0,100]){await content('chrome.storage.local.set({hudContentTransparency:'+level+'})');await until('alpha interno '+level,()=>hud('h.querySelector(".ext-hud-card").dataset.contentTransparency==='+JSON.stringify(String(level))));const s=await sample();assert.equal(s.animation,'none');assert.equal(s.pulse,'none');assert.equal(s.display,'block');assert.equal(s.main,expectedColors.dictation);values.push(s);assert.equal(await hud('getComputedStyle(h.querySelector(".ext-hud-header>.ext-hud-glass")).backgroundColor'),structural);}
 assert.ok(Number(values[0].opacity)>Number(values[1].opacity));assert.ok(Number(values[0].glow)>Number(values[1].glow));
 await send('HUD_GLOBAL_UI_SET',{minimized:false});const expanded=await sample();assert.notEqual(expanded.animation,'fm-task-border-turn');assert.notEqual(expanded.pulse,'fm-task-border-glow');assert.equal(expanded.padding,'0px','barra expandida conserva seu detalhe original');assert.equal((await state()).jobs.find(j=>j.jobId==='rail-reduced').status,'connecting');
 pass('mesmos 2 px, máscara, giro e pulso dos cards; tamanho, posição, controles e transparência intactos; movimento reduzido respeitado');
};
