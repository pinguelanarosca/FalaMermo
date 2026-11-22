'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CapturePipeline,DistributedDictation}=require('../stt-realtime.js');
const {create}=require('../stt-scheduler.js');
const {classifyLiveError}=require('../live-session-manager.js');

const {voicePcm}=require('./stt-audio-fixture.cjs');
const keys=Array.from({length:9},(_,i)=>'test-account-'+(i+1));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){
 for(let i=0;i<3000&&!predicate();i++)await tick();
 assert.ok(predicate(),'condição assíncrona não atingida');
}
function fixture({credentials=keys,rejectAccount=()=>{},config={},transportConfig={},budgetLimit=Infinity,verbatim=false}={}){
 let now=1000,number=0,buffered=0,peak=0;
 const timers=new Map(),attempts=[],sessions=[];
 const setTimer=(fn,ms)=>{const id=++number;timers.set(id,{fn,at:now+ms});return id;};
 const clearTimer=id=>timers.delete(id);
 const scheduler=create({now:()=>now,setTimer,clearTimer,classify:classifyLiveError,retire:session=>{session.closed=true;}});
 const budget={
  take(size){if(buffered+size>budgetLimit)return false;buffered+=size;peak=Math.max(peak,buffered);return true;},
  release(size){buffered-=size;}
 };
 function job(jobId){
  const retained=[],published=[],partials=[],warnings=[],errors=[];
  const transport=new DistributedDictation({
   jobId,budget,config:transportConfig,now:()=>now,setTimer,clearTimer,
   copies:Math.min(2,new Set(credentials).size),
   retain:async packet=>retained.push(packet),
   onChunk:result=>published.push(result),onPartial:result=>partials.push(result),
   onWarning:warning=>warnings.push(warning),onFailure:error=>errors.push(error),
   async openLane({sequence,copy,accounts,signal,receive,fail}){
    const lease=await scheduler.admit({
     jobId:jobId+':'+sequence+':'+copy,keys:credentials,models:['gemini-3.5-transcribe-live'],signal,config,blockAccounts:accounts,
     async open({keyIndex}){
      attempts.push({jobId,sequence,copy,keyIndex});
      rejectAccount(keyIndex);
      const session={jobId,sequence,copy,keyIndex,packets:[],receive,fail};
      sessions.push(session);
      return session;
     }
    });
    const session=lease.session;
    return {
     timeoutMs:15000,verbatim,
     send:pcm=>scheduler.sendAudio(lease,pcm,value=>session.packets.push(value)),
     end:()=>scheduler.endAudio(lease,()=>{session.ended=true;}),
     confirm:latency=>scheduler.recordChunk(lease,latency),
     close:error=>{
      session.closed=true;
      if(error)scheduler.fail(lease,error);else scheduler.release(lease);
     }
    };
   }
  });
  let packetSequence=0;
  const send=(sequence,pcm,{startMs=(sequence-1)*100,endMs=sequence*100,cutReason,speechAfterOverlap=true}={})=>
   transport.submitAudioChunk({pcm,endOnly:!!cutReason,chunk:{jobId,sequence,chunkId:jobId+':'+sequence,
    packetSequence:++packetSequence,startMs,endMs,overlapMs:0,speechAfterOverlap,status:cutReason?'closed':'streaming',cutReason}});
  return {transport,retained,published,partials,warnings,errors,send,
   lanes:sequence=>sessions.filter(s=>s.jobId===jobId&&s.sequence===sequence)};
 }
 async function advance(ms){
  const end=now+ms;
  for(;;){
   const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next)break;
   now=next[1].at;
   timers.delete(next[0]);
   next[1].fn();
   await tick();
  }
  now=end;
  await tick();
 }
 return {job,advance,scheduler,sessions,attempts,timers,bytes:()=>buffered,peak:()=>peak};
}
const pcm=new Uint8Array(3200).fill(1),empty=new Uint8Array();
async function block(job,sequence,cutReason='silence'){
 await job.send(sequence,pcm);
 await job.send(sequence,empty,{cutReason});
}
function final(session,text){session.receive({inputTranscription:{text,finished:true}});}

test('palavra curta legítima e repetição em outro bloco continuam sendo publicadas',async()=>{
 const env=fixture(),job=env.job('legitimate-short');
 for(let sequence=1;sequence<=2;sequence++){
  await block(job,sequence);
  await until(()=>job.lanes(sequence).filter(l=>l.ended).length===2);
  final(job.lanes(sequence)[0],'¿Qué?');
  final(job.lanes(sequence)[1],'resposta duplicada de outra réplica');
 }
 const result=await job.transport.finish();
 assert.equal(result.text,'¿Qué? ¿Qué?');assert.equal(result.incomplete,false);assert.equal(result.transcribed,2);
});

test('nove contas participam de um ditado, duas sessões distintas por bloco e uma gravação local por pacote',async()=>{
 const env=fixture({config:{maxPerAccount:2}}),job=env.job('nine');
 for(let sequence=1;sequence<=5;sequence++){
  await block(job,sequence);
  await until(()=>job.lanes(sequence).filter(lane=>lane.ended).length===2);
  const [primary,secondary]=job.lanes(sequence);
  assert.notEqual(primary.keyIndex,secondary.keyIndex);
  assert.deepEqual(primary.packets,[pcm]);assert.deepEqual(secondary.packets,[pcm]);
  final(secondary,'Bloco '+sequence+'.');
  final(primary,'Resultado atrasado.');
  assert.ok(primary.closed&&secondary.closed);
 }
 const result=await job.transport.finish();
 assert.equal(new Set(env.sessions.map(s=>s.keyIndex)).size,9);
 assert.equal(result.text,'Bloco 1. Bloco 2. Bloco 3. Bloco 4. Bloco 5.');
 assert.equal(job.retained.length,5);
 assert.equal(job.warnings.length,0);
 assert.equal(env.bytes(),0);
 assert.equal(env.scheduler.snapshot().activeJobs,0);
 assert.equal(env.timers.size,0);
});

test('respostas fora de ordem, primeira válida, parcial progressiva e outra captura isolada',async()=>{
 const env=fixture(),first=env.job('first'),next=env.job('next');
 await block(first,1);await block(first,2);
 await until(()=>first.lanes(1).every(l=>l.ended)&&first.lanes(2).filter(l=>l.ended).length===2);
 const prior=first.transport.finish();
 await next.send(1,pcm);
 await until(()=>next.lanes(1).some(l=>l.packets.length));
 next.lanes(1)[0].receive({interimInputTranscription:{text:'Prévia do segundo ditado'}});
 assert.equal(next.partials.at(-1).partialText,'Prévia do segundo ditado');
 final(first.lanes(2)[0],'Dois.');
 assert.equal(first.published.length,0);
 first.lanes(1)[0].fail(Object.assign(Error('Falha de rede'),{closeCode:1006}));
 final(first.lanes(1)[1],'Um.');
 assert.equal((await prior).text,'Um. Dois.');
 assert.equal(next.published.length,0);
 assert.ok(next.lanes(1).some(l=>!l.closed));
 next.transport.cancel();
 assert.equal(env.bytes(),0);
 assert.equal(env.scheduler.snapshot().activeJobs,0);
 assert.ok(env.sessions.every(l=>l.closed));
});

test('timeout duplo sinaliza lacuna, libera resposta posterior e ignora resultados tardios',async()=>{
 const env=fixture(),job=env.job('gap');
 await block(job,1);await block(job,2);
 await until(()=>env.sessions.filter(l=>l.ended).length===4);
 const failed=job.lanes(1);
 failed[0].receive({turnComplete:true});
 failed[1].receive({inputTranscription:{text:'',finished:true}});
 final(job.lanes(2)[1],'O trecho seguinte.');
 await env.advance(15000);
 assert.equal(job.published.at(-1).text,'O trecho seguinte.');
 assert.equal(job.warnings[0].gap,true);
 assert.equal(job.warnings[0].sequence,1);
 assert.equal(job.errors.length,0);
 final(failed[0],'Texto tardio.');
 await block(job,3);
 await until(()=>job.lanes(3).some(l=>l.ended));
 final(job.lanes(3)[0],'Continua.');
 const result=await job.transport.finish();
 assert.equal(result.text,'O trecho seguinte. Continua.');
 assert.equal(result.unresolved,1);
 assert.deepEqual(result.unresolvedSequences,[1]);
 assert.equal(result.noSpeech,0);
 assert.equal(job.retained.length,3);
});

test('AUTH e QUOTA degradam a redundância sem duplicar conta nem reenviar o PCM',async()=>{
 const env=fixture({credentials:[keys[0],keys[1],keys[2],keys[2]],config:{maxPerAccount:2},
  rejectAccount:keyIndex=>{
   if(keyIndex===1)throw Object.assign(Error('invalid api key'),{httpStatus:401});
   if(keyIndex===2)throw Object.assign(Error('429 quota'),{httpStatus:429});
  }
 }),job=env.job('degraded');
 await block(job,1);
 await until(()=>job.lanes(1).some(l=>l.ended)&&env.scheduler.snapshot().waiting===0);
 assert.equal(job.lanes(1).length,1);
 final(job.lanes(1)[0],'Texto preservado.');
 assert.equal((await job.transport.finish()).incomplete,false);
 assert.deepEqual(job.warnings,[{sequence:1,gap:false}]);
 assert.equal(env.attempts.filter(a=>a.keyIndex===1).length,1);
 assert.equal(env.attempts.filter(a=>a.keyIndex===2).length,1);
 assert.equal(job.retained.length,1);
 assert.equal(env.scheduler.snapshot().activeJobs,0);
});

test('contexto acústico só no corte forçado e transcrição sem finished após janela de acomodação',async()=>{
 const env=fixture(),job=env.job('context');
 await block(job,1,'maximum');await block(job,2);
 await until(()=>env.sessions.filter(l=>l.ended).length===4);
 assert.deepEqual(job.lanes(2)[0].packets,[pcm,pcm]);
 assert.equal(job.retained.length,2);
 const second=job.lanes(2)[0];
 second.receive({turnComplete:true});
 second.receive({inputTranscription:{text:'casa azul.'}});
 await env.advance(500);
 second.receive({inputTranscription:{text:' Está aberta.'}});
 final(job.lanes(1)[0],'Vamos à casa');
 assert.equal(job.published.at(-1).text,'Vamos à casa');
 await env.advance(900);
 assert.equal((await job.transport.finish()).text,'Vamos à casa azul. Está aberta.');
 assert.equal(env.timers.size,0);
});

test('falta de memória mantém o PCM recuperável e a capacidade global continua limitada',async()=>{
 const env=fixture({budgetLimit:1,config:{maxSessions:1}}),job=env.job('memory');
 await block(job,1);
 assert.equal(job.retained.length,1);
 assert.equal((await job.transport.finish()).unresolved,1);
 assert.equal(job.errors.length,0);
 assert.equal(env.bytes(),0);
 assert.ok(env.peak()<=1);
 await until(()=>env.scheduler.snapshot().waiting===0);
 assert.equal(env.scheduler.snapshot().activeJobs,0);
});

test('limite de uma sessão libera o resultado sem esperar pela réplica e mantém confirmação pós-envio',async()=>{
 const env=fixture({config:{maxSessions:1}}),job=env.job('limited');
 await block(job,1);
 await until(()=>job.lanes(1).some(l=>l.ended));
 const [lane]=job.lanes(1);
 lane.receive({inputTranscription:{text:'Texto ',finished:true}},false);
 assert.equal(job.published.length,0);
 final(lane,'válido.');
 assert.equal((await job.transport.finish()).text,'Texto válido.');
 assert.equal(env.attempts.length,1);
 assert.deepEqual(job.warnings,[{sequence:1,gap:false}]);
 await until(()=>env.scheduler.snapshot().waiting===0);
 assert.equal(env.scheduler.snapshot().activeJobs,0);
});

for(const seconds of [20,60,180])test('ditado distribuído de '+seconds+' s com pausa longa e captura contínua',async()=>{
 const env=fixture(),job=env.job('duration-'+seconds),frame=voicePcm();
 const packets=[],capture=new CapturePipeline({jobId:'duration-'+seconds,realtime:true,continuous:true,submitAudioChunk:p=>packets.push(p)});
 let completed=0;
 async function drain(){
  for(const packet of packets.splice(0)){
   await job.transport.submitAudioChunk(packet);
   if(!packet.endOnly)continue;
   const sequence=packet.chunk.sequence;
   await until(()=>job.lanes(sequence).filter(l=>l.ended).length===2);
   final(job.lanes(sequence)[0],'Trecho '+(++completed)+'.');
  }
 }
 for(let i=0;i<seconds*10;i++){
  capture.push(frame);await drain();
  if(i===99){
   const silence=new Uint8Array(3200);
   for(let pause=0;pause<3000;pause++){capture.push(silence);await drain();}
   await env.advance(300000);
   assert.equal(capture.closed,false);
   assert.equal(job.transport.stopping,undefined);
  }
 }
 capture.finish();await drain();
 const result=await job.transport.finish();
 assert.equal(result.text,Array.from({length:completed},(_,i)=>'Trecho '+(i+1)+'.').join(' '));
 assert.equal(result.incomplete,false);
 assert.equal(job.retained.reduce((sum,p)=>sum+p.pcm.reduce((total,byte)=>total+Number(byte!==0),0),0),seconds*10*frame.reduce((total,byte)=>total+Number(byte!==0),0));
 assert.equal(env.scheduler.snapshot().activeJobs,0);
});

test('corte adaptativo oferece confirmação periódica sem alterar o corte convencional',()=>{
 const frame=voicePcm();
 for(const adaptive of [false,true]){
  const cuts=[];
  const capture=new CapturePipeline({jobId:'adaptive',realtime:true,continuous:true,adaptive,submitAudioChunk:packet=>{
   if(packet.endOnly)cuts.push(packet.chunk);
  }});
  for(let i=0;i<1800;i++)capture.push(frame);
  assert.equal(cuts[0].durationMs,adaptive?5300:12000);
  assert.ok(cuts.slice(1).every(cut=>cut.durationMs===(adaptive?7000:12000)));
  assert.equal(capture.closed,false);
 }
});

test('fala nova após pre-roll no corte máximo conserva repetição legítima',async()=>{
 const env=fixture(),job=env.job('repeat'),packets=[];
 const capture=new CapturePipeline({jobId:'repeat',realtime:true,continuous:true,submitAudioChunk:p=>packets.push(p)});
 const voice=voicePcm(),silence=new Uint8Array(3200);
 for(let i=0;i<120;i++)capture.push(voice);
 capture.push(silence); // Prefixo do segundo bloco ainda não contém fala nova.
 capture.push(voice);
 capture.finish();
 for(const packet of packets)await job.transport.submitAudioChunk(packet);
 await until(()=>env.sessions.filter(l=>l.ended).length===4);
 final(job.lanes(1)[0],'Sim.');
 final(job.lanes(2)[0],'sim.');
 const result=await job.transport.finish();
 assert.equal(result.text,'Sim. sim.');
 assert.equal(env.bytes(),0);
});

test('parcial após overlap sem palavra repetida continua visível antes da confirmação',async()=>{
 const env=fixture(),job=env.job('partial-overlap');
 await block(job,1,'maximum');
 await until(()=>job.lanes(1).some(l=>l.ended));
 final(job.lanes(1)[0],'Primeiro.');
 await job.send(2,pcm);
 await until(()=>job.lanes(2).some(l=>l.packets.length));
 job.lanes(2)[0].receive({interimInputTranscription:{text:'Segundo trecho'}});
 const partial=job.partials.at(-1);
 job.transport.cancel();
 assert.equal(partial?.confirmedText,'Primeiro.');
 assert.equal(partial?.partialText,'Segundo trecho');
});

test('espanhol legítimo não é eliminado por filtro literal',async()=>{
 const env=fixture(),job=env.job('spanish');
 await block(job,1);await until(()=>job.lanes(1).some(l=>l.ended));
 final(job.lanes(1)[0],'¿Qué?');
 assert.equal((await job.transport.finish()).text,'¿Qué?');
});

test('fronteiras confirmadas preservam offsets ordenados em resultados agrupados e lacunas',async()=>{
 const env=fixture(),job=env.job('boundaries');
 await block(job,1);await block(job,2);await block(job,3);
 await until(()=>env.sessions.filter(l=>l.ended).length===6);
 final(job.lanes(3)[0],'Terceiro.');
 final(job.lanes(1)[0],'Primeiro.');
 assert.deepEqual(job.published.at(-1).textBoundaries,[[1,9]]);
 await env.advance(15000);
 const result=await job.transport.finish();
 assert.equal(result.text,'Primeiro. Terceiro.');
 assert.deepEqual(result.textBoundaries,[[1,9],[2,9],[3,19]]);
 result.textBoundaries[0][1]=0;
 assert.deepEqual(job.transport.snapshot().textBoundaries,[[1,9],[2,9],[3,19]],'snapshot não pode alterar o cursor do transporte');
});

test('PCM sem fala nova não abre sessões que fabricariam uma resposta',async()=>{
 for(const [name,build] of [
  ['silêncio',()=>new Int16Array(1600)],
  ['desvio DC',()=>new Int16Array(1600).fill(210)],
  ['impulso isolado',()=>{const a=new Int16Array(1600);a[0]=32767;return a;}],
 ]){
  const env=fixture(),job=env.job(name),packets=[];
  const capture=new CapturePipeline({jobId:name,realtime:true,continuous:true,submitAudioChunk:p=>packets.push(p)});
  for(let i=0;i<60;i++)capture.push(new Uint8Array(build().buffer));capture.finish();
  for(const packet of packets)await job.transport.submitAudioChunk(packet);
  await tick();
  assert.equal(packets.length,0,`${name}: não deve iniciar atividade remota`);
  assert.equal(env.sessions.length,0);
  assert.equal((await job.transport.finish()).text,'');
 }
});

test('texto das duas réplicas durante pre-roll não contamina a primeira fala legítima',async()=>{
 const env=fixture(),job=env.job('preroll');
 await job.send(1,new Uint8Array(3200),{speechAfterOverlap:false});
 await until(()=>job.lanes(1).filter(l=>l.packets.length===1).length===2);
 for(const lane of job.lanes(1)){
  lane.receive({interimInputTranscription:{text:'¿Qué?'}});
  lane.receive({inputTranscription:{text:'¿Qué?',finished:true}});
 }
 assert.deepEqual(job.partials,[]);
 await job.send(1,pcm,{endMs:200});
 await job.send(1,empty,{endMs:200,cutReason:'silence'});
 const lane=job.lanes(1)[0];
 lane.receive({inputTranscription:{text:'¿Qué?',finished:true}},false,false); // chegou antes da fala, parse atrasado
 assert.deepEqual(job.partials,[]);
 lane.receive({interimInputTranscription:{text:'¿Qué?'}});
 assert.equal(job.partials.at(-1).partialText,'¿Qué?');
 final(lane,'¿Qué? Sim.');
 assert.equal((await job.transport.finish()).text,'¿Qué? Sim.');
 assert.equal(job.retained.length,2,'pre-roll preservado no journal');
});

test('pausas com ruído baixo e DC não apagam vocalizações breves ou mudança de idioma',async()=>{
 const env=fixture(),job=env.job('pauses'),packets=[];
 const capture=new CapturePipeline({jobId:'pauses',realtime:true,continuous:true,submitAudioChunk:p=>packets.push(p)});
 const room=new Uint8Array(Int16Array.from({length:1600},(_,i)=>220+(i*13%23)-11).buffer);
 let sequence=0;
 for(const text of ['Quê?','¿Qué?','Hum.']){
  for(let i=0;i<30;i++)capture.push(room);
  const short=voicePcm(25,2200);
  capture.push(short);
  for(let i=0;i<6;i++)capture.push(room);
  for(const packet of packets.splice(0))await job.transport.submitAudioChunk(packet);
  sequence++;
  await until(()=>job.lanes(sequence).filter(lane=>lane.ended).length===2);
  assert.ok(job.lanes(sequence).every(lane=>lane.packets.includes(short)));
  final(job.lanes(sequence)[0],text);
 }
 capture.finish();
 assert.equal(packets.length,0);
 const result=await job.transport.finish();
 assert.equal(result.blocks,3);assert.equal(result.text,'Quê? ¿Qué? Hum.');
});

test('VERBATIM reconcilia revisões, finais atrasados e réplicas sem reemitir blocos',async()=>{
 const env=fixture({verbatim:true}),job=env.job('verbatim-order');
 const hypothesis=(lane,text,startOffset,endOffset)=>lane.receive({interimInputTranscription:{text,startOffset,endOffset}},true,true);
 const confirmed=(lane,text,startOffset,endOffset)=>lane.receive({inputTranscription:{text,startOffset,endOffset}},true,true);
 await block(job,1);await block(job,2);
 await until(()=>env.sessions.filter(lane=>lane.ended).length===4);
 const [a,discarded]=job.lanes(1),[b]=job.lanes(2);
 hypothesis(a,'Prim','0s','0.2s');
 hypothesis(a,'Primeira','0s','0.4s');
 hypothesis(a,'Pri','0s','0.1s');
 assert.equal(job.partials.at(-1).partialText,'Primeira');
 confirmed(b,'¿Qué?','0s','0.4s');
 confirmed(a,'Segunda.','0.5s','0.9s');
 confirmed(a,'Primeira.','0s','0.4s');
 confirmed(a,'Primeira.','0s','0.4s');
 hypothesis(a,'Primei','0s','0.35s');
 a.receive({interimInputTranscription:{text:'Provisória atrasada sem offset'}},true,true);
 a.receive({turnComplete:true,modelTurn:{parts:[{text:'Não inserir'}]}},true,true);
 await env.advance(900);
 assert.equal(job.published.at(-1).text,'Primeira. Segunda. ¿Qué?');
 assert.deepEqual(job.published.at(-1).textBoundaries,[[1,18],[2,24]]);
 confirmed(discarded,'Tardia.','0s','0.4s');
 await block(job,3);await until(()=>job.lanes(3).some(lane=>lane.ended));
 confirmed(job.lanes(3)[0],'¿Qué?','0s','0.4s');
 await env.advance(900);
 assert.equal((await job.transport.finish()).text,'Primeira. Segunda. ¿Qué? ¿Qué?');
 assert.equal(job.errors.length,0);
});

test('VERBATIM não publica interim como confirmado quando falham as duas conexões',async()=>{
 const env=fixture({verbatim:true}),job=env.job('verbatim-disconnect');
 await block(job,1);await until(()=>job.lanes(1).every(lane=>lane.ended)&&job.lanes(1).length===2);
 job.lanes(1)[0].receive({inputTranscription:{text:'Confirmada.'}});
 job.lanes(1)[0].fail(Object.assign(Error('Encerrado'),{closeCode:1006}));
 await env.advance(900);
 await block(job,2);await until(()=>job.lanes(2).filter(lane=>lane.ended).length===2);
 for(const lane of job.lanes(2)){
  lane.receive({interimInputTranscription:{text:'Tentativa'}});
  lane.fail(Object.assign(Error('Encerrado'),{closeCode:1006}));
  lane.receive({inputTranscription:{text:'Confirmada.'}});
 }
 await block(job,3);await until(()=>job.lanes(3).filter(lane=>lane.ended).length===2);
 job.lanes(3)[0].receive({inputTranscription:{text:'Retomada.'}});
 await env.advance(900);
 const result=await job.transport.finish();
 assert.equal(result.text,'Confirmada. Retomada.');
 assert.equal(result.partialText,'');
 assert.deepEqual(result.unresolvedSequences,[2]);
 assert.equal(job.retained.length,3);
});

test('um bloco com confirmação e hipótese nova retém só o trecho confirmado se a conexão cair',async()=>{
 const env=fixture({verbatim:true}),job=env.job('verbatim-incomplete');
 await block(job,1);await until(()=>job.lanes(1).filter(lane=>lane.ended).length===2);
 const [lane]=job.lanes(1);
 lane.receive({inputTranscription:{text:'Fala confirmada.',startOffset:'0s',endOffset:'0.4s'}});
 lane.receive({interimInputTranscription:{text:'Fala incerta',startOffset:'0.6s',endOffset:'0.9s'}});
 assert.equal(job.partials.at(-1).partialText,'Fala confirmada. Fala incerta');
 lane.fail(Object.assign(Error('Encerrado'),{closeCode:1006}));
 const result=await job.transport.finish();
 assert.equal(result.text,'Fala confirmada.');assert.equal(result.partialText,'');
 assert.equal(result.incomplete,true);assert.deepEqual(result.unresolvedSequences,[1]);
});

test('hipóteses fora de ordem atualizam o HUD imediatamente e preservam a fronteira do editor',async()=>{
 const env=fixture({verbatim:true}),job=env.job('visual-out-of-order');
 await block(job,1);await job.send(2,pcm);
 await until(()=>job.lanes(1).filter(lane=>lane.ended).length===2&&job.lanes(2).some(lane=>lane.packets.length));
 const [first]=job.lanes(1),[second]=job.lanes(2);
 second.receive({interimInputTranscription:{text:'Segundo',endOffset:'0.6s'}},false,true);
 assert.equal(job.partials.at(-1).previewText,'Segundo');
 assert.equal(job.partials.at(-1).partialText,'');
 assert.equal(job.partials.at(-1).previewOnly,true);
 first.receive({inputTranscription:{text:'Primeiro.'}},true,true);
 assert.equal(job.partials.at(-1).previewText,'Primeiro.\nSegundo');
 await env.advance(900);
 assert.equal(job.published.at(-1).previewText,'Segundo');
 assert.equal(job.partials.at(-1).partialText,'Segundo');
 assert.deepEqual(job.partials.at(-1).textBoundaries,[[1,9]]);
 await job.send(2,empty,{cutReason:'silence'});
 second.receive({inputTranscription:{text:'Segundo.'}},true,true);
 await env.advance(900);
 assert.equal((await job.transport.finish()).text,'Primeiro. Segundo.');
});

test('réplica estagnada cede a hipótese mais avançada e rejeita regressões ou alternância imediata',async()=>{
 const env=fixture({verbatim:true}),job=env.job('visual-replica');
 await job.send(1,pcm);await until(()=>job.lanes(1).filter(lane=>lane.packets.length).length===2);
 const [a,b]=job.lanes(1);
 const partial=(lane,text,end)=>lane.receive({interimInputTranscription:{text,endOffset:end}},false,true);
 partial(a,'Primeira','0.4s');
 partial(b,'Primeira versão','0.6s');
 assert.equal(job.partials.at(-1).partialText,'Primeira');
 await env.advance(1000);
 partial(b,'Primeira versão mais recente','0.9s');
 assert.equal(job.partials.at(-1).partialText,'Primeira versão mais recente');
 partial(a,'Alternativa','0.5s');
 partial(b,'Atrasada','0.3s');
 partial(b,'Primeira versão mais recente','0.9s');
 assert.equal(job.partials.length,2);
 job.transport.cancel();
});

test('confirmação de áudio permanece quando ambas as réplicas caem antes de fechar atividade',async()=>{
 const env=fixture({verbatim:true}),job=env.job('confirmed-before-end');
 await job.send(1,pcm);await until(()=>job.lanes(1).filter(lane=>lane.packets.length).length===2);
 const [lane]=job.lanes(1);
 lane.receive({inputTranscription:{text:'Confirmada.',startOffset:'0s',endOffset:'0.4s'}},false,true);
 lane.receive({interimInputTranscription:{text:'incompleta',startOffset:'0.5s',endOffset:'0.8s'}},false,true);
 for(const copy of job.lanes(1))copy.fail(Object.assign(Error('Rede indisponível'),{closeCode:1006}));
 await job.send(1,empty,{cutReason:'finalization'});
 const result=await job.transport.finish();
 assert.equal(result.text,'Confirmada.');
 assert.equal(result.incomplete,true);
});

test('setup em paralelo ao journal mantém PCM no disco antes de enviar à primeira sessão',async()=>{
 const env=fixture({verbatim:true}),job=env.job('setup-and-journal');
 let persist;
 job.transport.retain=()=>new Promise(resolve=>{persist=resolve;});
 const inserting=job.send(1,pcm);
 await until(()=>persist&&job.lanes(1).length===2);
 assert.ok(job.lanes(1).every(lane=>!lane.packets.length));
 persist();await inserting;
 assert.ok(job.lanes(1).every(lane=>lane.packets.length===1));
 job.transport.cancel();
});
