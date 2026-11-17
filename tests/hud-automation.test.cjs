'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const GlobalJobs=require('../global-jobs.js');
const hud=state=>GlobalJobs.forHud(state,1);

function fixture(data={}){
 let clock=1000,next=0,history={enabled:true,maxEntries:50,recentItems:[]};const timers=new Map();
 const services={now:()=>clock,storage:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))},
  getHistory:async()=>history,updateHistory:async fn=>{history=fn(history)||history;},
  setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
 const registry=GlobalJobs.create(services);
 return{registry,services,data,timers,history:()=>history,async advance(ms){clock+=ms;for(const[id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}await registry.get();},
  start:(id,type='TTS',extra={})=>registry.start({jobId:id,requestId:id,type,text:type==='TTS'?'Texto '+id:'',origin:{tabId:1},...extra}),
  end:id=>registry.event({jobId:id,requestId:id,event:'ended',eventSeq:2})};
}

test('STT/TTS abrem HUD fechado, restauram e expandem só a nova tarefa; eventos não desfazem intervenção manual',async()=>{
 const e=fixture(),r=e.registry;await r.ui({visible:false,minimized:true});
 await e.start('stt','STT');let s=await r.get();assert.equal(hud(s).visible,true);assert.equal(hud(s).minimized,false);assert.equal(s.hudTaskId,'stt');assert.equal(s.jobs[0].collapsed,false);
 await r.ui({visible:false});await r.event({jobId:'stt',event:'setup-complete',eventSeq:1});assert.equal(hud(await r.get()).visible,false);
 await e.start('tts');s=await r.get();assert.equal(hud(s).visible,true);assert.equal(s.hudTaskId,'tts');assert.equal(s.jobs[0].collapsed,false);assert.equal(s.jobs[1].collapsed,true);
 await r.collapse({jobId:'tts',collapsed:true});await r.collapse({jobId:'stt',collapsed:false});await r.event({jobId:'tts',event:'play',eventSeq:1});s=await r.get();assert.equal(s.jobs[0].collapsed,true);assert.equal(s.jobs[1].collapsed,false);
 await r.ui({visible:false});await e.end('tts');await r.event({jobId:'tts',event:'play',eventSeq:99});s=await r.get();assert.equal(hud(s).visible,false);assert.equal(s.hudTaskId,'stt');assert.equal(s.jobs[0].status,'completed');
});

test('fechamento ocorre em 5000 ms; nova atividade invalida inclusive callback já enfileirado',async()=>{
 const e=fixture(),r=e.registry;await e.start('one');await e.end('one');assert.equal(e.timers.size,1);
 const oldCallback=[...e.timers.values()][0].fn;
 await e.advance(4999);assert.equal(hud(await r.get()).visible,true);
 await e.start('two');oldCallback();await e.advance(1);assert.equal(hud(await r.get()).visible,true);assert.equal(e.timers.size,0);
 await e.end('two');await e.advance(4999);assert.equal(hud(await r.get()).visible,true);await e.advance(1);assert.equal(hud(await r.get()).visible,false);
 const s=await r.get();assert.equal(s.jobs.length,2);assert.ok(s.jobs.every(job=>job.collapsed));assert.equal(e.history().recentItems.length,2);
 await r.event({jobId:'one',event:'play',eventSeq:90});assert.equal(hud(await r.get()).visible,false);assert.equal(e.timers.size,0);
});

test('consulta manual cancela o timer anterior e respeita apresentação por aba',async()=>{
 const e=fixture(),r=e.registry;await e.start('one');await e.end('one');await e.advance(2000);await r.ui({visible:true});assert.equal(e.timers.size,0);await e.advance(10000);assert.equal(hud(await r.get()).visible,true);
 await e.start('two');await e.end('two');await r.ui({visible:true},7);await e.advance(5000);const s=await r.get();assert.equal(hud(s).visible,false);assert.equal(GlobalJobs.forHud(s,7).visible,true);assert.equal(GlobalJobs.forHud(s,8).visible,true);
 await r.ui({visible:false},7);await r.event({jobId:'two',event:'play',eventSeq:99});assert.equal(GlobalJobs.forHud(await r.get(),7).visible,false);
});

test('gravação, envio pendente, finalização, tradução, pausa e narração STT bloqueiam o timer',async()=>{
 const e=fixture(),r=e.registry;
 await r.start({jobId:'stt',requestId:'stt',type:'STT',origin:{tabId:1}},'reserve-stt');await r.event({jobId:'stt',event:'stt-final',text:'Transcrição.',eventSeq:1});await r.insertion({jobId:'stt',inserted:true},{tabId:1});
 await e.advance(6000);assert.equal(hud(await r.get()).visible,true);assert.equal(e.timers.size,0);
 await r.capture({jobId:'stt',microphoneReleased:true,pendingChunks:2},{tabId:1});await e.advance(6000);assert.equal(e.timers.size,0);
 await r.capture({jobId:'stt',pendingChunks:0},{tabId:1});assert.equal(e.timers.size,1);
 await r.preparePlayback({jobId:'stt',requestId:'audio'});await r.event({jobId:'stt',requestId:'audio',narration:true,event:'pause',eventSeq:1});await e.advance(6000);assert.equal(hud(await r.get()).visible,true);assert.equal(e.timers.size,0);
 await r.event({jobId:'stt',requestId:'audio',narration:true,event:'ended',eventSeq:2});assert.equal(e.timers.size,1);
 await e.start('translation','TTS',{source:'translation'});assert.equal(e.timers.size,0);await e.advance(6000);assert.equal(hud(await r.get()).visible,true);
 await r.selectionResult({jobId:'translation',text:'Olá!'});await e.start('newer');await r.ui({visible:false});await r.preparePlayback({jobId:'translation',requestId:'translated-audio'});
 const s=await r.get();assert.equal(hud(s).visible,false);assert.equal(s.hudTaskId,'newer');assert.equal(s.jobs.find(job=>job.jobId==='translation').collapsed,true);
});

test('tarefas simultâneas: terminar a mais nova mantém HUD aberto enquanto outra executa',async()=>{
 const e=fixture();await e.start('one');await e.start('two');await e.end('two');await e.advance(6000);assert.equal(hud(await e.registry.get()).visible,true);assert.equal(e.timers.size,0);await e.end('one');await e.advance(5000);assert.equal(hud(await e.registry.get()).visible,false);
});

test('reinício do service worker restaura o prazo restante e a consulta manual',async()=>{
 const e=fixture();await e.start('one');await e.end('one');await e.advance(3000);e.timers.clear();
 const restarted=GlobalJobs.create(e.services);await restarted.get();assert.equal([...e.timers.values()][0].at,e.data[GlobalJobs.STORAGE_KEY].hudAutomation.closeAt);await e.advance(2000);assert.equal(hud(await restarted.get()).visible,false);
 await restarted.ui({visible:true});const again=GlobalJobs.create(e.services);assert.equal(hud(await again.get()).visible,true);assert.equal(e.timers.size,0);
});
