'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CapturePipeline,DictationTransport}=require('../stt-realtime.js');
test('carregar STT em frame com IndexedDB bloqueado não acessa storage nem quebra outros módulos',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),context=vm.createContext({Uint8Array,DataView,setTimeout,clearTimeout});let reads=0;Object.defineProperty(context,'indexedDB',{get(){reads++;throw Error('SecurityError');}});assert.doesNotThrow(()=>vm.runInContext(fs.readFileSync(require.resolve('../stt-realtime.js'),'utf8'),context));assert.equal(reads,0);await assert.rejects(context.SttRealtime.recovery.start('test'),error=>error.code==='RECOVERY_STORAGE');assert.equal(reads,1);
});
const pcm=(ms=100,value=3000)=>{const bytes=new Uint8Array(ms*32);new Int16Array(bytes.buffer).fill(value);return bytes;};
function fixture(options={}){
 let time=0,id=0;const timers=new Map(),sent=[],retained=[],errors=[],warnings=[],diagnostics=[];
 const transport=new DictationTransport({jobId:'test',sendAudio:bytes=>sent.push(bytes.slice()),endAudio:()=>{e.ends++;},retain:async p=>retained.push({pcm:p.pcm.slice(),chunk:{...p.chunk}}),now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),onFailure:error=>errors.push(error),onWarning:w=>warnings.push(w),onDiagnostic:d=>diagnostics.push(d),...options});
 const works=[],pipeline=new CapturePipeline({jobId:'test',realtime:true,continuous:true,submitAudioChunk:p=>works.push(transport.submitAudioChunk(p))});
 const e={transport,pipeline,sent,retained,errors,warnings,diagnostics,timers,ends:0,async drain(){await Promise.all(works.splice(0));},async advance(ms){const end=time+ms;for(let n=0;;n++){const next=[...timers].sort((a,b)=>a[1].at-b[1].at).find(([,t])=>t.at<=end);if(!next)break;assert.ok(n<1000);const[id,t]=next;timers.delete(id);time=t.at;t.fn();await Promise.resolve();}time=end;},async phrase(value=3000){for(let i=0;i<7;i++)pipeline.push(pcm(100,value));for(let i=0;i<5;i++)pipeline.push(pcm(100,0));await e.drain();}};return e;
}
for(const pause of [30000,300000])test(`fluxo: fala → ${pause/1000}s silêncio → fala, sem timer de captura`,async()=>{
 const e=fixture();await e.phrase();e.transport.receive({inputTranscription:{text:'Antes.',finished:true}});const count=e.sent.length,retained=e.retained.length;
 for(let i=0;i<pause/100;i++)e.pipeline.push(pcm(100,0));await e.drain();await e.advance(pause);
 assert.equal(e.pipeline.closed,false);assert.equal(e.transport.cancelled,false);assert.equal(e.sent.length,count);assert.equal(e.retained.length,retained);assert.ok(e.pipeline.idle.length<=16000);assert.equal(e.errors.length,0);
 await e.phrase();e.transport.receive({inputTranscription:{text:'Depois.',finished:true}});e.pipeline.finish();await e.drain();const result=await e.transport.finish();assert.equal(result.text,'Antes. Depois.');assert.equal(result.incomplete,false);assert.equal(e.timers.size,0);
});
test('sinal sem fala não bloqueia fala válida; timeout é inconclusivo, nunca silêncio automático',async()=>{
 const e=fixture();await e.phrase(6000);const toneBytes=e.sent.reduce((n,p)=>n+p.length,0);await e.phrase(2000);assert.ok(e.sent.reduce((n,p)=>n+p.length,0)>toneBytes,'segundo bloco enviado antes do deadline do primeiro');
 e.transport.receive({voiceActivity:{type:'ACTIVITY_END'},turnComplete:true,generationComplete:true});await e.advance(300000);assert.equal(e.transport.cancelled,false);assert.equal(e.pipeline.closed,false);assert.equal(e.transport.stats.noSpeech,0);assert.equal(e.transport.stats.unresolved,2);assert.equal(e.errors.length,0);assert.equal(e.warnings.length,2);
 e.transport.receive({inputTranscription:{text:'Fala válida.'}});assert.equal(e.transport.snapshot().text,'Fala válida.');assert.equal(e.transport.snapshot().incomplete,true);assert.deepEqual(Buffer.concat(e.retained.map(p=>Buffer.from(p.pcm))),Buffer.concat(e.sent.map(p=>Buffer.from(p))));
 e.pipeline.finish();await e.drain();const result=e.transport.finish();await Promise.resolve();await Promise.resolve();await e.advance(15000);assert.equal((await result).text,'Fala válida.');assert.equal(e.transport.stats.noSpeech,0);
});
test('máximos locais não reiniciam atividade remota nem repetem overlap em fala contínua',async()=>{
 const e=fixture();for(let i=0;i<260;i++)e.pipeline.push(pcm());await e.drain();assert.equal(e.ends,0);assert.equal(e.transport.blocks.size,3);assert.ok([...e.transport.blocks.values()].every(b=>b.overlapMs===0));assert.equal(e.sent.reduce((n,p)=>n+p.length,0),260*3200);
 for(let i=0;i<5;i++)e.pipeline.push(pcm(100,0));await e.drain();assert.equal(e.ends,1);e.transport.receive({inputTranscription:{text:'Fala contínua em ordem.'}});await e.advance(30000);assert.equal(e.transport.cancelled,false);assert.equal(e.transport.snapshot().text,'Fala contínua em ordem.');e.transport.cancel();
});
test('pausa exatamente após máximo fecha atividade sem enviar silêncio e sem novo bloco',async()=>{
 const e=fixture();for(let i=0;i<120;i++)e.pipeline.push(pcm());await e.drain();assert.equal(e.ends,0);for(let i=0;i<3000;i++)e.pipeline.push(pcm(100,0));await e.drain();assert.equal(e.ends,1);assert.equal(e.transport.blocks.size,1);assert.equal(e.sent.length,120);await e.advance(300000);assert.equal(e.transport.cancelled,false);assert.equal(e.pipeline.closed,false);assert.equal(e.transport.stats.unresolved,1);e.transport.cancel();
});
test('respostas com offsets ordenam e deduplicam só o mesmo evento; repetições legítimas ficam',async()=>{
 const e=fixture();await e.phrase();for(const input of [{text:'Segunda.',startOffset:'2s',endOffset:'3s'},{text:'Primeira.',startOffset:'0s',endOffset:'1s'},{text:'Segunda.',startOffset:'2s',endOffset:'3s'}])e.transport.receive({inputTranscription:input});assert.equal(e.transport.snapshot().text,'Primeira. Segunda.');assert.equal(e.transport.timeline.length,2);e.transport.receive({inputTranscription:{text:'Segunda.'}});assert.equal(e.transport.snapshot().text,'Primeira. Segunda. Segunda.');assert.equal(e.transport.timeline.length,3);e.transport.cancel();
});
test('confirmação vazia com sinal continua inconclusiva; PCM digitalmente zero é distinguível',async()=>{
 const e=fixture();await e.phrase();e.transport.receive({inputTranscription:{text:'',finished:true}});assert.equal(e.transport.stats.unresolved,1);assert.equal(e.transport.stats.noSpeech,0);assert.equal(e.transport.cancelled,false);e.transport.cancel();
 const z=fixture();await z.transport.submitAudioChunk({pcm:pcm(100,0),chunk:{jobId:'test',chunkId:'test:1',sequence:1,packetSequence:1,startMs:0,endMs:100,overlapMs:0,status:'streaming'}});await z.transport.submitAudioChunk({pcm:new Uint8Array(),endOnly:true,chunk:{jobId:'test',chunkId:'test:1',sequence:1,packetSequence:2,startMs:0,endMs:100,overlapMs:0,status:'closed',cutReason:'silence'}});assert.equal(z.transport.stats.noSpeech,1);assert.equal(z.transport.stats.unresolved,0);z.transport.cancel();
});
test('falha de retenção é explícita antes de enviar; Cancelar invalida respostas sem apagar retenção',async()=>{
 const e=fixture({retain:async()=>{throw Object.assign(Error('armazenamento indisponível'),{code:'RECOVERY_STORAGE'});}});e.pipeline.push(pcm());await assert.rejects(e.drain(),/armazenamento/);assert.equal(e.sent.length,0);assert.equal(e.errors.length,1);
 const q=fixture();await q.phrase();q.transport.receive({inputTranscription:{text:'Confirmado.'}});q.transport.cancel();const retained=q.retained.length;q.transport.receive({inputTranscription:{text:'Não inserir.'}});assert.equal(q.transport.snapshot().text,'Confirmado.');assert.equal(q.retained.length,retained);assert.equal(q.timers.size,0);await assert.rejects(q.transport.finish(),error=>error.code==='CANCELLED');
});
test('offsets reiniciados após retomada não apagam repetição legítima nem reordenam conexão anterior',async()=>{
 const e=fixture();await e.phrase();e.transport.receive({inputTranscription:{text:'Sim.',startOffset:'0s',endOffset:'1s',finished:true}});e.transport.resumeEpoch();await e.phrase();e.transport.receive({inputTranscription:{text:'Sim.',startOffset:'0s',endOffset:'1s',finished:true}});assert.equal(e.transport.snapshot().text,'Sim. Sim.');assert.equal(e.transport.timeline.length,2);e.transport.cancel();
});
test('offset de nova atividade não é identidade global: mesma frase pode ser dita duas vezes',async()=>{
 const e=fixture();for(let i=0;i<2;i++){await e.phrase();e.transport.receive({inputTranscription:{text:'Sim.',startOffset:'0s',endOffset:'1s',finished:true}});}assert.equal(e.transport.snapshot().text,'Sim. Sim.');e.transport.cancel();
});
test('atividades ambíguas não deduplicam frases iguais nem reordenam por offsets possivelmente locais',async()=>{
 const e=fixture();await e.phrase();e.transport.receive({inputTranscription:{text:'Primeira.',startOffset:'10s',endOffset:'11s'}});await e.phrase();for(let i=0;i<2;i++)e.transport.receive({inputTranscription:{text:'Sim.',startOffset:'0s',endOffset:'1s'}});assert.equal(e.transport.snapshot().text,'Primeira. Sim. Sim.');assert.equal(e.transport.timeline.length,3);assert.equal(e.transport.snapshot().ambiguous,true);e.transport.cancel();
});
test('Stop mantém janela de respostas tardias; silêncio de captura não inicia essa janela',async()=>{
 const e=fixture();await e.phrase();e.transport.receive({inputTranscription:{text:'Primeiro'}});await e.advance(300000);assert.equal(e.transport.stopping,false);const final=e.transport.finish();let settled=false;final.then(()=>settled=true);await Promise.resolve();await Promise.resolve();await e.advance(1000);assert.equal(settled,false);e.transport.receive({inputTranscription:{text:' complemento.'}});await e.advance(14000);assert.equal((await final).text,'Primeiro complemento.');assert.equal(e.errors.length,0);assert.equal(e.timers.size,0);
});
test('Extended não encerra captura em IN_PROGRESS e só finaliza após Stop e IDLE',async()=>{
 const e=fixture({requiresIdle:true,timeoutMs:90000});await e.phrase();e.transport.receive({inputTranscription:{text:'Texto Extended.',finished:true},interactionStatus:'IN_PROGRESS',turnComplete:true});await e.advance(300000);assert.equal(e.transport.stopping,false);assert.equal(e.pipeline.closed,false);assert.equal(e.transport.cancelled,false);const final=e.transport.finish();let settled=false;final.then(()=>settled=true);await Promise.resolve();await Promise.resolve();await e.advance(1000);assert.equal(settled,false);e.transport.receive({interactionStatus:'IDLE',turnComplete:true});assert.equal((await final).text,'Texto Extended.');assert.equal(e.timers.size,0);assert.equal(e.errors.length,0);
});
