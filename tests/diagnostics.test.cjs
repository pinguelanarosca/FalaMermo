'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../diagnostics-runtime.js'),{AudioQueue}=require('../dictation-runtime.js'),{CapturePipeline}=require('../stt-realtime.js');
const jobId='a1234567-1234-1234-1234-123456789abc',sessionId='live-1791482000000-abc';
const event=(extra={})=>({component:'stt',category:'capture',stage:'packet-created',jobId,...extra});
test('ordem global e identidade/relógio de origem são preservados na correlação',()=>{
 let wall=1791482000000,clock=1;const producer=core.create({context:'content',now:()=>wall++,mono:()=>clock++}),hub=core.create();
 producer.event(event({chunkId:jobId+':1',sessionId,details:{packetSequence:7,bytes:3200}}));producer.event(event({category:'editor',stage:'editor-ack',details:{revision:3}}));
 const original=producer.snapshot().events;for(const e of original)hub.append(e);
 const saved=hub.snapshot().events;assert.deepEqual(saved.map(e=>e.sequence),[1,2]);
 for(let i=0;i<saved.length;i++)for(const key of ['at','sourceId','sourceSeq','monotonicMs','jobId'])assert.equal(saved[i][key],original[i][key]);
 assert.equal(saved[0].details.packetSequence,7);assert.equal(saved[0].sessionId,sessionId);
});
test('allowlist descarta credenciais, texto, áudio e erros arbitrários em profundidade',()=>{
 const secret='FAKE_SECRET_DO_NOT_EXPORT',input=event({stage:'error',code:secret,apiKey:secret,message:secret,details:{bytes:2,text:secret,apiKey:secret,token:secret,pcm:[1,2],status:secret,before:{fieldCharacters:12,text:secret},protocol:{systemInstruction:secret,phase:'ready'}}});
 const safe=core.sanitize(input);assert.ok(!JSON.stringify(safe).includes(secret));assert.equal(safe.details.before.fieldCharacters,12);assert.equal(safe.details.protocol.phase,'ready');assert.equal(safe.code,undefined);
 assert.equal(core.sanitize(event({stage:secret})),null);assert.equal(core.sanitize(event({jobId:secret})).jobId,undefined);
 const malicious={get component(){throw Error(secret);}};assert.equal(core.sanitize(malicious),null);
});
test('buffer circular limita contagem e bytes, inclusive sob gravação prolongada',()=>{
 const d=core.create({settings:{capacity:256,maxBytes:65536}});
 for(let i=0;i<18000;i++)d.event(event({details:{packetSequence:i,bytes:3200}}));
 const s=d.snapshot(0,20000);assert.ok(s.retained<=256);assert.ok(s.bytes<=65536);assert.equal(s.dropped+s.retained,18000);assert.equal(s.events.at(-1).details.packetSequence,17999);assert.ok(s.events.every((e,i)=>!i||e.sequence>s.events[i-1].sequence));
 d.configure({capacity:512,maxBytes:100000});assert.ok(d.snapshot().bytes<=100000);
});
test('Normal agrega custo/duração; Forense retém sequência individual; desligado não coleta',()=>{
 const d=core.create();for(let i=0;i<1000;i++)d.aggregate(event({durationMs:2,details:{packetSequence:i}}));
 assert.equal(d.snapshot().retained,0);d.flush();let s=d.snapshot();assert.equal(s.retained,1);assert.equal(s.events[0].details.eventCount,1000);assert.equal(s.events[0].details.meanDurationMs,2);
 d.configure({mode:'forensic'});d.aggregate(event({details:{packetSequence:1001}}));assert.equal(d.snapshot().events.at(-1).details.packetSequence,1001);
 d.configure({mode:'off'});s=d.snapshot();for(let i=0;i<1000;i++){d.event(event());d.aggregate(event());}d.flush();assert.equal(d.snapshot().cursor,s.cursor);
});
test('métricas de fila medem pico, espera, vazão, idade e esvaziamento',()=>{
 let clock=0;const d=core.create({mono:()=>clock}),q=d.queue('persist-send',jobId),a=q.enter({packetSequence:1});clock=10;const b=q.enter({packetSequence:2});clock=30;q.begin(a);clock=50;q.leave(a);d.flush();
 let e=d.snapshot().events.at(-1);assert.equal(e.details.size,1);assert.equal(e.details.peak,2);assert.equal(e.details.averageWaitMs,30);assert.equal(e.details.oldestMs,40);assert.equal(e.details.oldestWaitingMs,40);assert.equal(e.details.throughput,20);assert.equal(e.details.meanDurationMs,50);
 clock=60;q.begin(b);clock=70;q.leave(b);d.flush();e=d.snapshot().events.at(-1);assert.equal(e.details.size,0);assert.equal(e.details.total,2);
});
test('rastreadores têm limite global e liberam recursos no cancelamento',()=>{
 const d=core.create({settings:{mode:'forensic'}});const queues=Array.from({length:128},(_,i)=>d.queue('persist-send',jobId+':'+i));let accepted=0;
 for(const q of queues)for(let i=0;i<100;i++)if(q.enter())accepted++;
 assert.equal(accepted,8192);assert.equal(d.queue('persist-send','excess').enter(),null);for(const q of queues)q.abandon();assert.ok(d.snapshot().aggregateLost>0);assert.ok(queues.every(q=>q.size===0));d.flush();assert.ok(d.snapshot(0,20000).events.filter(e=>e.code==='CANCELLED').every(e=>e.severity==='info'));
});
test('filtros, pausa e limpeza afetam só a visualização; exportação conserva os eventos',()=>{
 const d=core.create(),v=new core.View();d.event(event());d.event({component:'tts',category:'playback',stage:'error',severity:'error',jobId});v.update(d.snapshot());assert.equal(v.visible({component:'tts',severity:'error',jobId}).length,1);
 v.paused=true;d.event(event());assert.equal(v.update(d.snapshot()),false);assert.equal(v.events.length,2);assert.equal(d.snapshot().events.length,3);
 v.clear();assert.equal(v.visible({}).length,0);v.paused=false;v.update(d.snapshot());assert.equal(v.visible({}).length,1);const saved=JSON.parse(JSON.stringify(d.snapshot()));assert.equal(saved.events.length,3);assert.equal(saved.events[0].jobId,jobId);
});
test('falha do consumidor de telemetria fica isolada e preserva o evento',()=>{
 const d=core.create({onEvent(){throw Error('simulated collector failure');}});assert.doesNotThrow(()=>{d.event(event());d.aggregate(event());d.flush();d.finish(d.start('stt','persist-packet',jobId));d.flush();});assert.ok(d.snapshot().failures>=1);assert.ok(d.snapshot().retained>=2);
});
test('adapters existentes usam lotes sem IPC nem escrita por pacote; descarte é limitado',async()=>{
 const timers=[],sent=[],local={};let release;const pending=new Promise(r=>release=r);
 const c=vm.createContext({console,performance,Date,document:{},location:{pathname:'/options.html',protocol:'chrome-extension:'},setInterval(fn){timers.push(fn);return 0;},chrome:{runtime:{getManifest(){return{};},sendMessage(m){sent.push(m);return pending;}},storage:{local:{async get(){return local;}},onChanged:{addListener(){}}}},addEventListener(){}});
 for(const name of ['diagnostics-runtime.js','live-stt-diagnostics.js','live-tts-diagnostics.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),c);
 for(let i=0;i<1000;i++)await c.LiveSttDiagnostics.emit({jobId,scope:'transport',stage:'audio-sent',sentChunks:i});
 assert.equal(sent.length,0);timers[0]();assert.equal(sent.length,1);assert.ok(sent[0].payload.events.length<=128);timers[0]();assert.equal(sent.length,1,'não abre segundo envio enquanto o lote anterior está pendente');
 release({success:true});await pending;await new Promise(r=>setImmediate(r));
 assert.equal(sent[0].payload.events.find(e=>e.stage==='audio-sent').details.eventCount,1000);assert.equal(sent[0].payload.events.find(e=>e.stage==='audio-sent').details.sentChunks,999);
});
test('instrumentação conserva PCM, ordem e comportamento da fila real de captura',async()=>{
 const previous=globalThis.FalaDiagnostics;
 try{for(const mode of ['off','normal','forensic']){
  globalThis.FalaDiagnostics=core.create({settings:{mode}});const sent=[],metrics={};const q=new AudioQueue({metrics,send:async payload=>{sent.push([...payload.pcm]);return{success:true};}});
  const pipeline=new CapturePipeline({jobId,realtime:true,continuous:true,submitAudioChunk:packet=>q.push({jobId,pcm:packet.pcm,chunk:packet.chunk},packet.pcm.length)});
  const expected=[];for(let n=0;n<20;n++){const pcm=Uint8Array.from({length:3200},(_,i)=>(i+n)%251);expected.push(...pcm);pipeline.push(pcm,true);}
  pipeline.finish();await q.drain();q.close();assert.deepEqual(sent.flat(),expected);assert.equal(metrics.pendingChunks,0);globalThis.FalaDiagnostics.flush();if(mode!=='off')assert.ok(globalThis.FalaDiagnostics.snapshot().retained>0);
 }}finally{globalThis.FalaDiagnostics=previous;}
});
test('alternar Desativado/Normal no mesmo ditado mantém as métricas registradas',()=>{
 const d=core.create(),q=d.queue('persist-send',jobId),a=q.enter();q.begin(a);d.configure({mode:'off'});assert.equal(q.size,0);d.configure({mode:'normal'});const b=q.enter();q.begin(b);q.leave(b);d.flush();assert.ok(d.snapshot().events.some(e=>e.stage==='persist-send'&&e.details.completed===1));
});
test('agregados e spans não retêm referências a payloads de áudio ou conteúdo mutável',()=>{
 const d=core.create(),raw=event({details:{bytes:3200,text:'PRIVATE',pcm:new Uint8Array(1024*1024)}});d.aggregate(raw);raw.details.bytes=9999;raw.details.text='OTHER';d.flush();assert.equal(d.snapshot().events[0].details.bytes,3200);assert.ok(!JSON.stringify(d.snapshot()).includes('PRIVATE'));
 const extra={bytes:12,audio:new Uint8Array(1024)},span=d.start('stt','persist-packet',jobId,extra);extra.bytes=99;assert.equal(span.extra.bytes,12);assert.equal(span.extra.audio,undefined);
 const q=d.queue('persist-send',jobId),token=q.enter(extra);assert.equal(token.extra.audio,undefined);q.abandon();
});
test('reinjeção do script não cria outro coletor nem timers duplicados',()=>{
 let timers=0;const c=vm.createContext({performance,document:{},location:{pathname:'/options.html',protocol:'chrome-extension:'},setInterval(){timers++;return 0;},chrome:{runtime:{getManifest(){return{};}},storage:{local:{async get(){return{};}},onChanged:{addListener(){}}}},addEventListener(){}}),source=fs.readFileSync(require.resolve('../diagnostics-runtime.js'),'utf8');vm.runInContext(source,c);const first=c.FalaDiagnostics;vm.runInContext(source,c);assert.equal(c.FalaDiagnostics,first);assert.equal(timers,1);
});
test('falha de transporte mantém um único lote limitado e reenvia os mesmos IDs',async()=>{
 const sent=[],timers=[];const c=vm.createContext({performance,document:{},location:{pathname:'/options.html',protocol:'chrome-extension:'},setInterval(fn){timers.push(fn);return 0;},chrome:{runtime:{getManifest(){return{};},sendMessage(message){sent.push(message);return sent.length===1?Promise.reject(Error('transport down')):Promise.resolve({success:true});}},storage:{local:{async get(){return{};}},onChanged:{addListener(){}}}},addEventListener(){}});
 vm.runInContext(fs.readFileSync(require.resolve('../diagnostics-runtime.js'),'utf8'),c);await c.FalaDiagnostics.ready;await c.FalaDiagnostics.send();assert.equal(c.FalaDiagnostics.snapshot().failures,1);await c.FalaDiagnostics.send();assert.equal(sent.length,2);assert.equal(JSON.stringify(sent[0].payload.events),JSON.stringify(sent[1].payload.events));assert.equal(sent[1].payload.failures,1);
});
test('fila real distingue oito blocos em processamento do nono aguardando sessão',async()=>{
 const {DistributedDictation}=require('../stt-realtime.js'),previous=globalThis.FalaDiagnostics;let clock=0;const d=globalThis.FalaDiagnostics=core.create({mono:()=>clock}),lanes=[];
 const transport=new DistributedDictation({jobId,copies:1,retain:async()=>{},openLane:async options=>{const lane={...options,timeoutMs:15000,send(){},end(){},close(){},confirm(){}};lanes.push(lane);return lane;}});
 try{let packetSequence=0;for(let sequence=1;sequence<=9;sequence++){const chunk={jobId,chunkId:jobId+':'+sequence,sequence,startMs:(sequence-1)*100,endMs:sequence*100,overlapMs:0,speechAfterOverlap:true};await transport.submitAudioChunk({pcm:new Uint8Array([sequence,0]),chunk:{...chunk,packetSequence:++packetSequence,status:'streaming'}});await transport.submitAudioChunk({pcm:new Uint8Array(),endOnly:true,chunk:{...chunk,packetSequence:++packetSequence,status:'closed',cutReason:'silence'}});}
  clock=100;d.flush();let row=d.snapshot().events.findLast(e=>e.stage==='block-admission');assert.equal(lanes.length,8);assert.equal(row.details.size,9);assert.equal(row.details.inFlight,8);assert.equal(row.details.waiting,1);assert.equal(row.details.oldestWaitingMs,100);
  lanes[0].receive({inputTranscription:{text:'controlled response',finished:true}});await new Promise(r=>setImmediate(r));clock=120;d.flush();row=d.snapshot().events.findLast(e=>e.stage==='block-admission');assert.equal(lanes.length,9);assert.equal(row.details.waiting,0);assert.equal(row.details.averageWaitMs,100);
 }finally{transport.cancel();globalThis.FalaDiagnostics=previous;}
});
test('instrumentação da admissão não altera validação nem deixa vaga retida em identidade inválida',async()=>{
 const previous=globalThis.FalaDiagnostics;globalThis.FalaDiagnostics=core.create();try{const scheduler=require('../stt-scheduler.js').create();await assert.rejects(scheduler.admit({jobId:null,keys:[],models:[],open:async()=>{throw Error('não deve abrir');}}),{code:'REQUEST'});assert.equal(scheduler.snapshot().waiting,0);assert.equal(scheduler.snapshot().activeJobs,0);}finally{globalThis.FalaDiagnostics=previous;}
});

test('fila ociosa removida pela rotação volta a publicar quando a tarefa retoma',()=>{
 const d=core.create(),original=d.queue('persist-send',jobId);for(let i=1;i<=128;i++)d.queue('persist-send',jobId+':'+i);const token=original.enter({packetSequence:1});original.begin(token);original.leave(token);d.flush();assert.ok(d.snapshot().events.some(e=>e.stage==='persist-send'&&e.jobId===jobId&&e.details.completed===1));
});
test('preserva os tempos e a rota realmente retornados pelo host VAD',()=>{
 const safe=core.sanitize(event({category:'vad',stage:'worker-timing',details:{toBackgroundMs:3,toHostMs:4,hostMs:10,hostFinishedAt:1791482000000,route:'direct-offscreen'}}));assert.equal(safe.details.toBackgroundMs,3);assert.equal(safe.details.toHostMs,4);assert.equal(safe.details.hostMs,10);assert.equal(safe.details.route,'direct-offscreen');
});
test('ID real de tarefa Lens atravessa o adaptador TTS e mantém a correlação',()=>{
 const lensId='lens-1791482000000-abc',adapter=require('../live-tts-diagnostics.js'),safe=adapter.sanitize({jobId:lensId,stage:'first-pcm',bytes:3200});assert.equal(safe.jobId,lensId);const d=core.create();d.legacy('tts',safe);d.flush();assert.equal(d.snapshot().events[0].jobId,lensId);assert.equal(core.sanitize({component:'lens',category:'task',stage:'state-transition',jobId:lensId}).jobId,lensId);
});
test('tempo decorrido da captura não é anunciado como custo de operação nem média zero fictícia',()=>{
 const d=core.create();d.legacy('stt',{jobId,scope:'capture',stage:'capture-progress',elapsedMs:90000});d.flush();const e=d.snapshot().events[0];assert.equal(e.details.elapsedMs,90000);assert.equal(e.durationMs,undefined);assert.equal(e.details.meanDurationMs,undefined);assert.equal(e.details.maxDurationMs,undefined);
});

test('a projeção do editor conserva a decisão do ACK sem incluir conteúdo',()=>{
 for(const ackAccepted of [true,false]){
  const safe=core.sanitize({component:'stt',category:'editor',stage:'editor-ack',jobId,details:{
   revision:3,ackRevision:3,ackAccepted,text:'conteúdo privado'
  }});
  assert.deepEqual(safe.details,{revision:3,ackRevision:3,ackAccepted});
 }
});
