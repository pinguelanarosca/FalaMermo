'use strict';
// Real Chrome animation clock; operational transitions are injected into the real registry.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({call,evaluate,page,worker,content,hud,state,until,sleep,pass,out})=>{
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},page);
 await content('chrome.storage.local.set({hudContentTransparency:50})');await until('alpha padrão',()=>hud('h.querySelector(".ext-hud-card").dataset.contentTransparency==="50"'));
 const sample=id=>hud('(()=>{const n=h.querySelector('+JSON.stringify('[data-job-id="'+id+'"]')+'),b=getComputedStyle(n,"::before"),g=getComputedStyle(n,"::after");return{running:n.dataset.taskRunning,angle:b.getPropertyValue("--fm-border-angle"),glow:g.opacity,borderOpacity:b.opacity,play:b.animationPlayState,pulse:g.animationPlayState,color:getComputedStyle(n).getPropertyValue("--task-main"),padding:b.paddingTop,gradient:b.backgroundImage}})()');
 const check=async(id,running)=>{
  await until(id+' atividade '+running,async()=>(await sample(id)).running===String(running));await sleep(90);const first=await sample(id);await sleep(190);const second=await sample(id);
  assert.equal(second.padding,'2px');assert.ok(second.gradient.includes('conic-gradient'));assert.ok(Number(second.borderOpacity)>0&&Number(second.glow)>0);assert.equal(first.color,second.color);
  assert.equal(second.play,running?'running':'paused');assert.equal(second.pulse,running?'running':'paused');
  if(running)assert.notEqual(second.angle,first.angle,'gradiente gira em execução');else{assert.equal(second.angle,first.angle,'gradiente estático');assert.equal(second.glow,first.glow,'brilho estático');}
 };
 const event=(jobId,event,eventSeq,extra={})=>evaluate(worker,'fixtureRegistry.event('+JSON.stringify({jobId,event,eventSeq,...extra})+')');
 const narrator='border-narration',dictation='border-dictation',lens='border-lens';
 for(const id of [narrator,dictation,lens])await check(id,true);
 await event(narrator,'play',1,{progress:{contextState:'running',workletPaused:false}});await check(narrator,true);
 await event(narrator,'pause',2,{progress:{contextState:'suspended',workletPaused:true}});await check(narrator,false);
 await event(narrator,'play',3,{progress:{contextState:'running',workletPaused:false}});await check(narrator,true);
 await event(narrator,'ended',4);await check(narrator,false);
 await event(dictation,'setup-complete',1);await check(dictation,true);
 await event(dictation,'stt-status',2,{status:'Aguardando processamento'});await check(dictation,true);
 await event(dictation,'stt-cancelled',3);await check(dictation,false);
 await event(lens,'error',1,{error:'Erro controlado do cenário de apresentação.'});await check(lens,false);
 assert.deepEqual((await state()).jobs.filter(j=>[narrator,dictation,lens].includes(j.jobId)).map(j=>j.status).sort(),['cancelled','completed','error']);
 const shot=await call('Page.captureScreenshot',{format:'png'},page);fs.writeFileSync(path.join(out,'bordas-inativas.png'),Buffer.from(shot.data,'base64'));
 pass('bordas mantêm cor/brilho e ficam estáticas em pausa, conclusão, cancelamento e erro; retomada, gravação e espera ativa animam');
 const icon=selector=>hud('(()=>{const n=h.querySelector('+JSON.stringify(selector)+'),s=getComputedStyle(n);return{text:n.textContent,color:s.color,background:s.backgroundColor,border:s.borderColor,radius:s.borderRadius,width:s.width,height:s.height,font:s.fontSize,label:n.getAttribute("aria-label")}})()');
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1},page);await sleep(180);const panic=await icon('[data-action=panic]'),options=await icon('#ext-btn-options');assert.equal(panic.text,'■');assert.equal(panic.label,'Parar todas as operações');for(const key of ['color','background','border','radius','width','height','font'])assert.equal(panic[key],options[key],key);
 const hover=async selector=>{const p=await hud('(()=>{const r=h.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p},page);await sleep(180);return icon(selector);};
 const panicHover=await hover('[data-action=panic]'),optionsHover=await hover('#ext-btn-options');assert.equal(panicHover.background,optionsHover.background);assert.equal(panicHover.color,optionsHover.color);
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},page);
 for(const id of [narrator,dictation,lens])assert.equal(await hud('getComputedStyle(h.querySelector('+JSON.stringify('[data-job-id="'+id+'"]')+'),"::before").animationName'),'none');
 pass('quadrado de parada usa o mesmo material, cor, dimensões e hover da barra; movimento reduzido mantém bordas imóveis');
};
