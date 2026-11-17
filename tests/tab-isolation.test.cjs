const test=require('node:test'),assert=require('node:assert/strict'),G=require('../global-jobs.js');
test('cancelamento confirmado com microfone liberado não mantém HUD aberto por contador antigo da fila fechada',async()=>{
 let timer;const r=G.create({setTimeout:fn=>(timer=fn,1),clearTimeout:()=>timer=null});
 await r.start({jobId:'cancel',type:'STT',origin:{tabId:1}},'reserve-stt');await r.capture({jobId:'cancel',pendingChunks:1,microphoneReleased:true},{tabId:1});await r.event({jobId:'cancel',event:'stt-cancelled',eventSeq:1});assert.equal(typeof timer,'function');timer();const s=await r.get();assert.equal(G.forHud(s,1).visible,false);assert.equal(s.jobs[0].progress.pendingChunks,1);assert.equal(s.jobs[0].status,'cancelled');
});
test('narração nova não pausa player de outra aba; disputa permanece dentro da mesma aba',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const src=fs.readFileSync(require.resolve('../offscreen.js'),'utf8');
 const c=vm.createContext({LiveSessions:{LiveSessionManager:class{}}});vm.runInContext(src.slice(0,src.indexOf('function viewFor'))+'globalThis.controls={playbackIntent,activatePlayback};})();',c);
 const player=tabId=>({payload:{tabId},volume:.3,authorized:false,paused:true,async pause(v){this.paused=v;}});
 const a=player(1),b=player(2),next=player(2);c.controls.playbackIntent(a,1);await c.controls.activatePlayback(a);c.controls.playbackIntent(b,2);await c.controls.activatePlayback(b);assert.equal(a.paused,false);assert.equal(a.volume,.3);assert.equal(b.paused,false);
 c.controls.playbackIntent(next,3);await c.controls.activatePlayback(next);assert.equal(a.paused,false);assert.equal(b.paused,true);assert.equal(next.paused,false);
});
test('STT/TTS/tradução abrem somente origem, preservam consulta alheia e fechamento local após 5s',async()=>{
 let now=1,timer;const r=G.create({now:()=>now,setTimeout:fn=>(timer=fn,1),clearTimeout:()=>timer=null});
 await r.ui({visible:true},3);
 for(const [id,type,source,tabId]of [['s','STT',undefined,1],['t','TTS',undefined,2],['tr','TTS','translation',1]]){
  await r.start({jobId:id,type,source,origin:{tabId},text:type==='TTS'?'Texto.':''});const s=await r.get();
  assert.equal(G.forHud(s,tabId).visible,true);assert.equal(G.forHud(s,3).visible,true);assert.equal(G.forHud(s,4).visible,false);assert.equal(s.visible,false);
 }
 await r.ui({visible:false},2);await r.event({jobId:'s',event:'stt-error',eventSeq:1});await r.event({jobId:'t',event:'ended',eventSeq:1});await r.fail('tr','cancelado para teste');
 now+=5000;timer();await r.get();const s=await r.get();assert.equal(G.forHud(s,1).visible,false);assert.equal(G.forHud(s,2).visible,false);assert.equal(G.forHud(s,3).visible,true);assert.equal(s.jobs.length,3);
});
test('nova atividade em outra aba não revoga consulta manual da primeira',async()=>{
 let timer;const r=G.create({setTimeout:fn=>(timer=fn,1),clearTimeout:()=>timer=null});
 await r.start({jobId:'one',type:'TTS',text:'um',origin:{tabId:1}});await r.ui({visible:true},1);
 await r.start({jobId:'two',type:'TTS',text:'dois',origin:{tabId:2}});await r.event({jobId:'one',event:'ended',eventSeq:1});await r.event({jobId:'two',event:'ended',eventSeq:1});timer();const s=await r.get();assert.equal(G.forHud(s,1).visible,true);assert.equal(G.forHud(s,2).visible,false);
});
