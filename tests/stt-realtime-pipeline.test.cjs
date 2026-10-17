'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CONFIG,CapturePipeline,TranscriptionMerger,mergeTranscriptionChunks,LiveChunkTransport}=require('../stt-realtime.js');
const {AudioQueue}=require('../dictation-runtime.js');
function pcm(ms=100,amplitude=.1){const bytes=new Uint8Array(ms*32),view=new DataView(bytes.buffer);for(let i=0;i<bytes.length;i+=2)view.setInt16(i,Math.round(amplitude*32767),true);return bytes;}
function capture(realtime=true,config={}){const packets=[],diagnostics=[],pipeline=new CapturePipeline({jobId:'job',realtime,config,submitAudioChunk:p=>packets.push(p),onDiagnostic:p=>diagnostics.push(p)});return{pipeline,packets,diagnostics};}
function transport(config={}){let now=100,number=0;const timers=new Map(),sent=[],ended=[],partials=[],results=[],errors=[],diagnostics=[];
 const queue=new LiveChunkTransport({jobId:'job',config,sendAudio:bytes=>sent.push(bytes.slice()),endAudio:()=>ended.push(true),onPartial:p=>partials.push(p),onChunk:p=>results.push(p),onFailure:e=>errors.push(e),onDiagnostic:p=>diagnostics.push(p),now:()=>now,setTimer:(fn,ms)=>{timers.set(++number,{fn,ms});return number;},clearTimer:id=>timers.delete(id)});
 return{queue,sent,ended,partials,results,errors,diagnostics,timers,advance:ms=>now+=ms,fire:ms=>{for(const[id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};}
function packetsForTwo(){const e=capture();for(let n=0;n<2;n++){e.pipeline.push(pcm());for(let i=0;i<5;i++)e.pipeline.push(pcm(100,0));}return e.packets;}
test('OFF conserva frames legados sem novos cortes; ON envia primeiro PCM antes do Stop',()=>{
 const off=capture(false),on=capture();off.pipeline.push(pcm());on.pipeline.push(pcm());assert.equal(off.packets.length,1);assert.equal(off.packets[0].chunk,undefined);assert.equal(on.packets.length,1);assert.equal(on.packets[0].chunk.status,'streaming');assert.equal(on.packets[0].endOnly,false);assert.equal(on.packets[0].chunk.sequence,1);off.pipeline.finish();assert.equal(off.packets.length,1);
});
test('VAD fecha em 500ms de silêncio, preserva fala curta e identifica fronteiras naturais',()=>{
 const e=capture();e.pipeline.push(pcm());for(let i=0;i<4;i++)e.pipeline.push(pcm(100,0));assert.equal(e.packets.some(p=>p.endOnly),false);e.pipeline.push(pcm(100,0));assert.equal(e.packets.filter(p=>p.endOnly).length,1);assert.equal(e.packets.at(-1).chunk.cutReason,'silence');assert.equal(e.packets.at(-1).chunk.durationMs,600);assert.equal(e.diagnostics[0].stage,'chunk-created');e.pipeline.finish();assert.equal(e.packets.filter(p=>p.endOnly).length,1);
});
test('fala contínua tem máximo de 12s, sequência e timestamps sem perder PCM nas fronteiras',()=>{
 const e=capture(true,{overlapMs:0}),input=[];for(let i=0;i<125;i++){const frame=pcm();input.push(frame);e.pipeline.push(frame);}e.pipeline.finish();const closed=e.packets.filter(p=>p.endOnly);assert.deepEqual(closed.map(p=>[p.chunk.sequence,p.chunk.startMs,p.chunk.endMs,p.chunk.cutReason]),[[1,0,12000,'maximum'],[2,12000,12500,'finalization']]);assert.deepEqual(Buffer.concat(e.packets.map(p=>Buffer.from(p.pcm))),Buffer.concat(input.map(p=>Buffer.from(p))));assert.ok(e.packets.every((p,i)=>p.chunk.packetSequence===i+1));
});
test('overlap opcional só em máximo; silêncio não repete PCM e merge remove só fronteira marcada',()=>{
 const e=capture(true,{minChunkMs:600,maxChunkMs:800,overlapMs:200});for(let i=0;i<9;i++)e.pipeline.push(pcm());e.pipeline.finish();assert.equal(e.packets.find(p=>p.chunk.sequence===2).chunk.overlapMs,200);assert.equal(e.packets.find(p=>p.chunk.sequence===2).pcm.length,6400);assert.equal(mergeTranscriptionChunks([{sequence:2,text:'à fronteira não desaparece.',overlapMs:400},{sequence:1,text:'Palavra próxima à fronteira',overlapMs:0}]),'Palavra próxima à fronteira não desaparece.');
 assert.equal(mergeTranscriptionChunks([{sequence:1,text:'Sim, sim.'},{sequence:2,text:'Sim, continuamos.'}]),'Sim, sim. Sim, continuamos.');assert.equal(CONFIG.overlapMs,200);
});
test('merge fora de ordem aguarda lacunas, preserva pontuação e confirmações não são sobrescritas',()=>{
 const merge=new TranscriptionMerger();merge.set({sequence:3,text:'Três.',status:'final'});assert.equal(merge.snapshot().text,'');merge.set({sequence:1,text:'Um.',status:'final'});assert.equal(merge.snapshot().text,'Um.');merge.set({sequence:2,text:'Dois.',status:'partial'});assert.equal(merge.snapshot().confirmedText,'Um.');assert.equal(merge.snapshot().text,'Um. Dois. Três.');merge.set({sequence:2,text:'Dois.',status:'final'});assert.equal(merge.snapshot().confirmedText,'Um. Dois. Três.');assert.equal(merge.set({sequence:1,text:'atrasado',status:'partial'}),false);
});
test('transporte envia incremental, serializa turnos e conserva uma consolidação progressiva',async()=>{
 const e=transport();for(const packet of packetsForTwo())e.queue.submitAudioChunk(packet);assert.equal(e.ended.length,1);assert.equal(e.sent.length,6);e.queue.receive({inputTranscription:{text:'Primeira frase.'}});assert.equal(e.partials.at(-1).text,'Primeira frase.');assert.equal(e.results.length,0);e.advance(250);e.queue.receive({turnComplete:true});e.fire(CONFIG.settleMs);assert.equal(e.results[0].confirmedText,'Primeira frase.');assert.equal(e.ended.length,2);assert.equal(e.sent.length,12);const final=e.queue.finish();e.queue.receive({inputTranscription:{text:'Segunda frase.'},turnComplete:true});e.fire(CONFIG.settleMs);assert.equal((await final).text,'Primeira frase. Segunda frase.');assert.equal(e.results.length,2);assert.equal(e.timers.size,0);assert.ok(e.diagnostics.some(d=>d.stage==='chunk-merge'&&Number.isFinite(d.meanChunkLatencyMs)));
});
test('inputTranscription após turnComplete é conservado; IN_PROGRESS não finaliza Extended',async()=>{
 const e=transport();e.queue.requiresIdle=true;for(const p of packetsForTwo().filter(p=>p.chunk.sequence===1))e.queue.submitAudioChunk(p);const final=e.queue.finish();e.queue.receive({turnComplete:true,interactionStatus:'IN_PROGRESS'});e.fire(CONFIG.settleMs);assert.equal(e.results.length,0);e.queue.receive({inputTranscription:{text:'Resposta tardia.'},interactionStatus:'IDLE'});e.fire(CONFIG.settleMs);assert.equal((await final).text,'Resposta tardia.');
});
test('cancelamento invalida PCM, timers e respostas tardias sem final',async()=>{
 const e=transport();for(const p of packetsForTwo())e.queue.submitAudioChunk(p);const final=e.queue.finish();e.queue.cancel();await assert.rejects(final,/cancelado/);const count=e.partials.length;e.queue.receive({inputTranscription:{text:'Tardio.'},turnComplete:true});e.fire(CONFIG.settleMs);assert.equal(e.partials.length,count);assert.equal(e.results.length,0);assert.equal(e.queue.pendingBytes,0);assert.equal(e.timers.size,0);const c=capture();c.pipeline.cancel();assert.equal(c.pipeline.push(pcm()),false);assert.equal(c.packets.length,0);
});
test('backpressure limita chunks e bytes; falha explícita cancela fila sem descarte silencioso',()=>{
 for(const config of [{maxQueuedChunks:1},{maxQueuedBytes:100}]){const e=transport(config);let error;try{for(const p of packetsForTwo())e.queue.submitAudioChunk(p);}catch(caught){error=caught;}assert.equal(error?.code,'BACKPRESSURE');assert.equal(e.errors.length,1);assert.equal(e.queue.cancelled,true);assert.equal(e.queue.pendingBytes,0);assert.ok(e.diagnostics.some(d=>d.stage==='chunk-error'&&d.outcome==='BACKPRESSURE'));}
});
test('fila Chrome interrompe imediatamente quando excede limite; timeout de chunk é finito',async()=>{
 const failures=[],q=new AudioQueue({maxPendingChunks:1,send:async()=>({success:true}),onFailure:e=>failures.push(e.code)});assert.equal(q.push({},2),true);assert.equal(q.push({},2),false);await assert.rejects(q.drain(),/Fila STT cheia/);assert.deepEqual(failures,['BACKPRESSURE']);const e=transport();for(const p of packetsForTwo())e.queue.submitAudioChunk(p);e.fire(15000);assert.equal(e.errors[0].code,'CHUNK_TIMEOUT');assert.equal(e.timers.size,0);
});
test('metadados duplicados/fora de sequência não são enviados de novo',()=>{
 const e=transport(),packet=packetsForTwo()[0];e.queue.submitAudioChunk(packet);assert.throws(()=>e.queue.submitAudioChunk(packet),/ordem/);assert.equal(e.sent.length,1);const other=transport(),wrong={...packet,chunk:{...packet.chunk,sequence:3,chunkId:'job:3'}};assert.throws(()=>other.queue.submitAudioChunk(wrong),/sequência/);assert.equal(other.sent.length,0);
});
test('diagnósticos de chunk incluem identidade/tempo e nunca PCM, base64, chave ou transcript',()=>{
 const diag=require('../live-stt-diagnostics.js'),jobId='12345678-1234-1234-1234-123456789abc',safe=diag.sanitize({jobId,scope:'transport',stage:'chunk-merge',chunkId:jobId+':2',sequence:2,startMs:600,endMs:1200,durationMs:600,latencyMs:30,meanChunkLatencyMs:25,cutReason:'silence',pendingChunks:1,status:'final',apiKey:'private-key',pcm:'private-audio',audioBase64:'private-base64',text:'private-text',systemInstruction:'private-instruction'});assert.equal(safe.sequence,2);assert.equal(safe.chunkId,jobId+':2');assert.equal(safe.cutReason,'silence');assert.equal(safe.latencyMs,30);assert.doesNotMatch(JSON.stringify(safe),/private-|apiKey|audioBase64|systemInstruction/);
});
test('silêncio depois da fala não cria turno vazio; pre-roll conserva início da próxima fala',()=>{
 const e=capture();e.pipeline.push(pcm());for(let i=0;i<5;i++)e.pipeline.push(pcm(100,0));const closed=e.packets.length;for(let i=0;i<20;i++)e.pipeline.push(pcm(100,0));assert.equal(e.packets.length,closed);assert.ok(e.pipeline.idle.length<=CONFIG.preRollMs*32);e.pipeline.push(pcm());const prefix=e.packets[closed];assert.equal(prefix.chunk.sequence,2);assert.equal(prefix.pcm.length,16000);assert.equal(prefix.chunk.overlapMs,0);for(let i=0;i<5;i++)e.pipeline.push(pcm(100,0));for(let i=0;i<7;i++)e.pipeline.push(pcm(100,0));e.pipeline.finish();assert.equal(e.packets.filter(p=>p.endOnly).length,2);assert.ok(e.diagnostics.some(d=>d.stage==='vad-silence'&&d.skippedSilenceMs>0));
});
test('transcrição de entrada confirma chunk sem esperar resposta falada/turnComplete do assistente',async()=>{
 const e=transport();for(const p of packetsForTwo())e.queue.submitAudioChunk(p);e.queue.receive({inputTranscription:{text:'Primeira.'}});const timer=[...e.timers.values()].find(t=>t.ms===900);e.queue.receive({modelTurn:{parts:[{inlineData:{data:'IGNORADO'}}]}});assert.ok([...e.timers.values()].includes(timer));e.fire(900);assert.equal(e.results.length,1);assert.equal(e.ended.length,2);const final=e.queue.finish();e.queue.receive({inputTranscription:{text:'Segunda.'}});e.fire(900);assert.equal((await final).text,'Primeira. Segunda.');
});
test('turnComplete do assistente anterior não conclui próximo chunk sem transcrição de entrada',async()=>{
 const e=transport();for(const p of packetsForTwo())e.queue.submitAudioChunk(p);e.queue.receive({inputTranscription:{text:'Primeiro.'}});e.fire(900);e.queue.receive({turnComplete:true});e.fire(900);assert.equal(e.results.length,1);assert.equal(e.queue.active.sequence,2);const final=e.queue.finish();e.queue.receive({inputTranscription:{text:'Segundo.'}});e.fire(900);assert.equal((await final).text,'Primeiro. Segundo.');
});
test('overlap curto não apaga duas palavras legítimas iguais nem toda fala nova',()=>{
 assert.equal(mergeTranscriptionChunks([{sequence:1,text:'Sim, sim.'},{sequence:2,text:'sim sim.',overlapMs:200,speechAfterOverlap:true}]),'Sim, sim. sim.');assert.equal(mergeTranscriptionChunks([{sequence:1,text:'Sim.'},{sequence:2,text:'sim.',overlapMs:200,speechAfterOverlap:true}]),'Sim. sim.');assert.equal(mergeTranscriptionChunks([{sequence:1,text:'Sim.'},{sequence:2,text:'sim.',overlapMs:200,speechAfterOverlap:false}]),'Sim.');
});
