const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const config=require('../live-config.js');const flush=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function environment(acquire,slowInit=false,cacheLimit){
 const events=[],contexts=[],nodes=[],attempts=[];let listener;
 class AudioContext{constructor(){this.state='suspended';this.sampleRate=24000;this.destination={};this.init=deferred();this.audioWorklet={addModule:()=>slowInit?this.init.promise:Promise.resolve()};contexts.push(this);}createGain(){return{gain:{value:1},connect:x=>x};}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
 let Processor;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','pcm-player-worklet.js'),'utf8'),{sampleRate:24000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(_name,type)=>Processor=type});
 class AudioWorkletNode{constructor(){this.sent=[];this.processor=new Processor();this.processor.port.postMessage=data=>queueMicrotask(()=>this.port.onmessage?.({data}));this.port={postMessage:(data,transfer)=>{const copy=structuredClone(data,{transfer});this.sent.push(copy);this.processor.port.onmessage({data:copy});}};nodes.push(this);}connect(x){return x;}}
 class Manager{async acquire(options){attempts.push({jobId:options.jobId,blockId:options.blockId,modelId:options.modelId,keyIndex:options.keyIndex});return acquire(options);}release(){}retire(session){session.closed=true;}}
 const context=vm.createContext({console,performance,structuredClone,setTimeout,clearTimeout,AudioContext,AudioWorkletNode,AbortController,DataView,Float32Array,Uint8Array,LiveConfig:config,LiveSessions:{LiveSessionManager:Manager,classifyLiveError:require('../live-session-manager.js').classifyLiveError},chrome:{runtime:{getURL:x=>x,onMessage:{addListener(fn){listener=fn;}},sendMessage(msg){events.push(msg.payload);return Promise.resolve();}}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','offscreen.js'),'utf8').replace('PLAYBACK_CACHE_LIMIT=128*1024*1024',cacheLimit?'PLAYBACK_CACHE_LIMIT='+cacheLimit:'PLAYBACK_CACHE_LIMIT=128*1024*1024'),context);
 const command=payload=>new Promise(resolve=>listener({target:'offscreen',type:'LIVE_OFFSCREEN_COMMAND',payload},{},resolve));
 return{command,events,contexts,nodes,attempts};
}
function pendingSession(){const done=deferred();let callback;return{done,get callback(){return callback;},session:{socketOpenMs:1,setupCompleteMs:2,sendTurn(_text,onMessage,signal){callback=onMessage;signal?.addEventListener('abort',()=>done.reject(Object.assign(new Error('Cancelado'),{cancelled:true})),{once:true});return done.promise;}},finish(value){callback({type:'pcm',bytes:new Uint8Array([value&255,value>>8]),mimeType:'audio/pcm;rate=24000'});done.resolve({metrics:{}});}};}
const shortTurn={async sendTurn(_text,onMessage){
 onMessage({type:'pcm',bytes:new Uint8Array([0,64]),mimeType:'audio/pcm;rate=24000'});
 return{metrics:{}};
}};
const base={operation:'TTS_LIVE_START',tabId:1,playerId:'p',requestId:'r',jobId:'j',modelId:'gemini-3.8-live',models:['gemini-3.8-live','gemini-3.8-live-extended-thinking'],apiKeys:Array.from({length:9},(_,i)=>'fake-'+i),text:'Teste.',maxParallelLiveSessions:1};
test('cadeia completa ordena modelos, esgota chaves e nunca aciona convencionais',async()=>{
 const models=config.LIVE_MODEL_PRIORITY,env=environment(async()=>{throw Error('Quota exceeded');});await env.command({...base,models:[models[0],models[3],models[2],models[1],'gemini-3.8-flash-tts']});await flush();await flush();
 assert.deepEqual(env.attempts.map(x=>[x.modelId,x.keyIndex]),models.flatMap(model=>Array.from({length:9},(_,i)=>[model,i+1])));assert.ok(env.events.some(e=>e.event==='error'&&/Fallback Live esgotado/.test(e.error)));
});
test('ranking passivo só altera chaves do modelo atual, respeitando cooldown',async()=>{
 const env=environment(async o=>{if(o.modelId===base.modelId)throw Error('WebSocket closed');return shortTurn;});
 await env.command({...base,keyOrderByModel:{[base.modelId]:[7,2],['gemini-3.8-live-extended-thinking']:[4]}});await flush();await flush();assert.deepEqual(env.attempts.map(x=>[x.modelId,x.keyIndex]),[[base.modelId,8],[base.modelId,3],['gemini-3.8-live-extended-thinking',5]]);
});
test('modelo convencional/Translate ou JSON incompatível não cria player/sessão',async()=>{
 for(const extra of [{modelId:'gemini-3.8-flash-tts'},{modelId:'gemini-3.5-live-translate-preview'},{jsonMode:'override',advancedJson:{setup:{model:'models/gemini-3.8-flash-tts'}}}]){
  const env=environment(async()=>{throw Error('não deve conectar');}),result=await env.command({...base,...extra});assert.equal(result.success,false);assert.equal(env.attempts.length,0);assert.equal(env.contexts.length,0);
 }
});
test('turno sem PCM não anuncia sucesso e esgota somente os pares Live',async()=>{
 const env=environment(async()=>({sendTurn:async()=>({chunks:[],metrics:{}})}));await env.command({...base,apiKeys:['fake'],models:config.LIVE_TTS_MODELS});await flush();await flush();assert.deepEqual(env.attempts.map(x=>x.modelId),config.LIVE_TTS_MODELS);assert.equal(env.events.some(x=>x.event==='generation-complete'),false);assert.ok(env.events.some(x=>x.event==='error'&&/não retornou áudio/.test(x.error)));
});
test('offscreen esgota nove chaves por modelo em AUTH/QUOTA/TRANSIENT',async()=>{
 for(const message of ['Invalid API key','Quota exceeded','WebSocket closed']){
  const env=environment(async o=>{if(o.modelId==='gemini-3.8-live')throw new Error(message);return shortTurn;});await env.command(base);await flush();await flush();
  assert.deepEqual(env.attempts.map(x=>[x.modelId,x.keyIndex]),[...Array.from({length:9},(_,i)=>['gemini-3.8-live',i+1]),['gemini-3.8-live-extended-thinking',1]]);
 }
});
test('três blocos paralelos terminam 3 → 1 → 2 e enfileiram 1 → 2 → 3 sem mistura',async()=>{
 const sessions=[],env=environment(async o=>{const item=pendingSession();sessions[o.blockId]=item;return item.session;});
 const text=['um','dois','três'].map(x=>('Bloco '+x+'. '+'palavra '.repeat(12)+'Fim.')).join('\n\n'),blocks=config.splitLiveNarrationBlocks(text,120);assert.equal(blocks.length,3);
 await env.command({...base,models:['gemini-3.8-live'],text,chunkSize:120,maxParallelLiveSessions:3});await flush();assert.equal(sessions.length,3);assert.deepEqual(env.attempts.map(x=>x.keyIndex),[1,2,3]);
 sessions[2].finish(9000);await flush();assert.equal(env.nodes[0].sent.filter(x=>x.type==='enqueue').length,0);
 sessions[0].finish(3000);await flush();sessions[1].finish(6000);await flush();
 const chunks=env.nodes[0].sent.filter(x=>x.type==='enqueue');assert.deepEqual(chunks.map(x=>x.blockId),[0,1,2]);assert.deepEqual(chunks.map(x=>new Float32Array(x.buffer)[0]),[3000,6000,9000].map(x=>x/32768));assert.equal(env.events.some(x=>x.event==='generation-complete'),true);
 for(let i=0;i<3;i++)env.nodes[0].port.onmessage({data:{type:'drain'}});env.nodes[0].port.onmessage({data:{type:'position',frame:3,totalFrames:3,availableStart:0}});await flush();assert.equal(env.events.filter(x=>x.event==='ended').length,1);
});
test('falha tardia de job cancelado não remove os controles do sucessor',async()=>{
 const old=deferred(),current=pendingSession(),env=environment(async o=>o.jobId==='old'?old.promise:current.session);
 await env.command({...base,jobId:'old',requestId:'old'});await env.command({...base,jobId:'old',operation:'STOP',requestId:'old'});await env.command({...base,jobId:'new',requestId:'new'});await flush();old.reject(new Error('WebSocket closed'));await flush();
 const paused=await env.command({...base,jobId:'new',operation:'PAUSE',requestId:'new'});assert.equal(paused.status?.paused,true);await env.command({...base,jobId:'new',operation:'STOP',requestId:'new'});await flush();
});
test('Stop de request antigo não cancela replay atual do mesmo job nem outra tarefa',async()=>{
 const env=environment(async()=>pendingSession().session);await env.command(base);await env.command({...base,operation:'STOP'});await env.command({...base,requestId:'replay'});await env.command({...base,jobId:'other',requestId:'other'});
 assert.equal((await env.command({...base,operation:'STOP'})).success,false);const state=await env.command({operation:'GLOBAL_JOBS_SNAPSHOT'});assert.equal(state.activeJobIds.length,2);assert.equal(env.contexts[1].state,'running');assert.equal(env.contexts[2].state,'running');
 await env.command({...base,operation:'STOP',requestId:'replay'});assert.equal(env.contexts[2].state,'running');await env.command({...base,operation:'STOP',jobId:'other',requestId:'other'});
});
test('inicializações simultâneas preservam jobs independentes e controles individuais',async()=>{
 const env=environment(async()=>pendingSession().session,true),first=env.command({...base,jobId:'old',requestId:'old'}),second=env.command({...base,jobId:'new',requestId:'new'});
 env.contexts[1].init.resolve();await second;env.contexts[0].init.resolve();await first;await flush();assert.deepEqual(env.attempts.map(x=>x.jobId),['new','old']);assert.equal(env.contexts[0].state,'running');assert.equal(env.nodes.length,2);await env.command({...base,jobId:'new',operation:'STOP',requestId:'new'});assert.equal(env.contexts[0].state,'running');await env.command({...base,jobId:'old',operation:'STOP',requestId:'old'});await flush();assert.ok(env.contexts.every(c=>c.state==='closed'));
});

const playbackPayload=id=>({...base,jobId:id,playerId:id,requestId:id,models:['gemini-3.8-live'],apiKeys:['fixture-only']});
async function playbackFixture(){
 const sessions=new Map(),env=environment(async options=>{const pending=pendingSession();sessions.set(options.jobId,pending);return pending.session;});
 const start=async(id,extra={})=>{const result=await env.command({...playbackPayload(id),...extra});assert.equal(result.success,true,result.error);await flush();return sessions.get(id);};
 const pcm=async(id,frames=24000)=>{const bytes=new Uint8Array(frames*2);new Int16Array(bytes.buffer).fill(4096);sessions.get(id).callback({type:'pcm',bytes,mimeType:'audio/pcm;rate=24000'});await flush();await flush();};
 const control=(id,operation,extra={})=>env.command({...playbackPayload(id),operation,...extra});
 const consume=async(index,frames=128)=>{env.nodes[index].processor.process([],[[new Float32Array(frames)]]);await flush();};
 const snapshot=async()=>env.command({operation:'GLOBAL_JOBS_SNAPSHOT'});
 return{...env,sessions,start,pcm,control,consume,snapshot};
}
test('exclusividade: B só pausa A quando recebe PCM, conserva posição/cache e retoma sem síntese',async()=>{
 const e=await playbackFixture();await e.start('a');await e.pcm('a');await e.consume(0,12000);const frame=e.nodes[0].processor.cursor;
 await e.start('b');assert.equal(e.contexts[0].state,'running');await e.pcm('b');await e.consume(1);
 assert.equal(e.contexts[0].state,'suspended');assert.equal(e.nodes[0].processor.cursor,frame);assert.ok(e.nodes[0].processor.queue.length);assert.equal(e.nodes[0].sent.some(x=>x.type==='flush'),false);
 await e.control('a','RESUME');assert.equal(e.contexts[1].state,'suspended');assert.equal(e.contexts[0].state,'running');assert.equal(e.nodes[0].processor.cursor,frame);assert.equal(e.attempts.length,2);
 await e.consume(0);assert.equal(e.nodes[0].processor.cursor,frame+128);assert.equal((await e.snapshot()).jobs.filter(j=>j.status==='playing').length,1);
 await e.control('a','STOP');assert.equal(e.contexts[0].state,'closed');assert.equal(e.contexts[1].state,'suspended');await e.control('b','STOP');
});
test('resposta antiga fora de ordem fica pausada e nunca toma prioridade da solicitação recente',async()=>{
 const e=await playbackFixture();await e.start('old',{playbackIntent:10});await e.start('new',{playbackIntent:20});await e.pcm('new');await e.consume(1);await e.pcm('old');
 assert.equal(e.contexts[0].state,'suspended');assert.equal(e.contexts[1].state,'running');assert.equal(e.events.some(x=>x.jobId==='old'&&x.event==='play'),false);
 assert.ok((await e.snapshot()).jobs.find(j=>j.jobId==='old').status==='paused');await e.control('old','RESUME');assert.equal(e.contexts[1].state,'suspended');assert.equal(e.attempts.length,2);await e.control('old','STOP');await e.control('new','STOP');
});
test('Pause durante síntese conserva PCM tardio; Resume não duplica geração nem posição',async()=>{
 const e=await playbackFixture();await e.start('pending');await e.control('pending','PAUSE');await e.pcm('pending');
 assert.equal(e.contexts[0].state,'suspended');assert.equal(e.nodes[0].sent.filter(x=>x.type==='enqueue').length,0);assert.equal((await e.snapshot()).jobs[0].status,'paused');
 await e.control('pending','RESUME');await e.consume(0);assert.equal(e.nodes[0].processor.cursor,128);assert.equal(e.attempts.length,1);await e.control('pending','STOP');
});
test('Stop durante geração invalida PCM tardio, libera cache e próximo Play gera novamente',async()=>{
 const e=await playbackFixture(),session=await e.start('stopped');await e.pcm('stopped');await e.control('stopped','STOP');const count=e.nodes[0].sent.length;
 session.callback({type:'pcm',bytes:new Uint8Array(48000),mimeType:'audio/pcm;rate=24000'});await flush();assert.equal(e.nodes[0].sent.length,count);assert.equal(e.nodes[0].processor.queue.length,0);assert.equal(e.contexts[0].state,'closed');assert.equal((await e.snapshot()).activeJobIds.length,0);
 await e.start('stopped',{requestId:'fresh'});assert.equal(e.attempts.length,2);await e.control('stopped','STOP',{requestId:'fresh'});
});
test('fim natural libera recursos, não retoma outro pausado e novo Play sintetiza outra vez',async()=>{
 const e=await playbackFixture();await e.start('a');await e.pcm('a');await e.start('b');await e.pcm('b',256);e.sessions.get('b').done.resolve({metrics:{}});await flush();await e.consume(1,256);
 assert.equal(e.contexts[1].state,'closed');assert.equal(e.nodes[1].processor.queue.length,0);assert.equal(e.contexts[0].state,'suspended');assert.equal((await e.snapshot()).jobs.find(j=>j.jobId==='b').status,'completed');
 await e.start('b',{requestId:'again'});assert.equal(e.attempts.length,3);await e.control('b','STOP',{requestId:'again'});await e.control('a','STOP');
});
test('comandos rápidos em três cards terminam na última retomada sem sobreposição',async()=>{
 const e=await playbackFixture();for(const id of ['a','b','c']){await e.start(id);await e.pcm(id);}
 await Promise.all([e.control('a','RESUME'),e.control('b','RESUME'),e.control('c','RESUME')]);
 assert.deepEqual(e.contexts.map(c=>c.state),['suspended','suspended','running']);assert.equal(e.nodes.filter((n,i)=>!n.processor.paused&&e.contexts[i].state==='running').length,1);
 for(const id of ['a','b','c'])await e.control(id,'STOP');
});
test('mesmo Play pendente é idempotente; novo request não substitui cache existente',async()=>{
 const e=await playbackFixture();await e.start('same');assert.equal((await e.command(playbackPayload('same'))).success,true);assert.equal(e.attempts.length,1);
 assert.equal((await e.command({...playbackPayload('same'),requestId:'duplicate'})).success,false);assert.equal(e.attempts.length,1);await e.control('same','STOP');
});
test('volume global multiplica saída sem reescrever volumes individuais dos cards',async()=>{
 const e=await playbackFixture();await e.start('a',{volume:.4});await e.pcm('a');await e.start('b',{volume:.8});await e.pcm('b');await e.consume(1);
 await e.command({operation:'SET_GLOBAL',volume:.5});let state=await e.snapshot();assert.equal(state.playback.volume,.5);assert.equal(state.jobs.find(j=>j.jobId==='a').progress.volume,.4);assert.equal(state.jobs.find(j=>j.jobId==='b').progress.volume,.8);
 await e.control('a','SET',{volume:.2});state=await e.snapshot();assert.equal(state.jobs.find(j=>j.jobId==='b').progress.volume,.8);assert.equal(state.playback.volume,.5);await e.control('a','RESUME');assert.equal((await e.snapshot()).jobs.find(j=>j.jobId==='a').progress.volume,.2);
 await e.control('a','STOP');await e.control('b','STOP');
});
test('prioridade é reservada antes de iniciar nova geração; PCM da solicitação anterior aguarda Play',async()=>{
 const e=await playbackFixture();await e.start('old',{playbackIntent:10});await e.command({operation:'PLAYBACK_INTENT',playbackIntent:20});await e.pcm('old');assert.equal((await e.snapshot()).jobs[0].status,'paused');assert.equal(e.nodes[0].sent.filter(p=>p.type==='enqueue').length,0);await e.control('old','STOP');
});
test('configuração antiga enviada com novo TTS não reverte volume global já ajustado',async()=>{
 const e=await playbackFixture();await e.command({operation:'SET_GLOBAL',volume:.3});await e.start('a',{globalVolume:1});await e.pcm('a');assert.equal((await e.snapshot()).playback.volume,.3);await e.control('a','STOP');
});
test('limite do cache pausa e informa condição sem descartar PCM previamente recebido',async()=>{
 const session=pendingSession(),e=environment(async()=>session.session,false,256),p=playbackPayload('limited');await e.command(p);await flush();session.callback({type:'pcm',bytes:new Uint8Array(64),mimeType:'audio/pcm;rate=24000'});await flush();await flush();session.callback({type:'pcm',bytes:new Uint8Array(256),mimeType:'audio/pcm;rate=24000'});await flush();await flush();
 const state=await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});assert.equal(state.jobs[0].status,'paused');assert.match(state.jobs[0].warning,/cache|128 MB/);assert.equal(e.contexts[0].state,'suspended');assert.equal(e.nodes[0].processor.queue.length,1);assert.equal(e.nodes[0].sent.some(p=>p.type==='flush'),false);assert.equal((await e.command({...p,operation:'RESUME'})).success,true);e.nodes[0].processor.process([],[[new Float32Array(32)]]);await flush();assert.equal(e.contexts[0].state,'closed');
});
test('PCM recebido durante Pause reserva espaço para a conversão antes do Resume', async () => {
 const session = pendingSession();
 const e = environment(async () => session.session, false, 256);
 const payload = playbackPayload('paused-budget');
 await e.command(payload);
 await e.command({...payload, operation:'PAUSE'});
 for (let i = 0; i < 2; i++) {
  session.callback({type:'pcm',bytes:new Uint8Array(80),mimeType:'audio/pcm;rate=24000'});
 }
 await flush();
 assert.match((await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'})).jobs[0].warning || '', /128 MB/);
 await e.command({...payload, operation:'RESUME'});
 const enqueued = e.nodes[0].sent.filter(packet => packet.type === 'enqueue');
 assert.deepEqual(enqueued.map(packet => packet.buffer.byteLength), [160]);
 assert.equal(e.attempts.length, 1);
 await e.command({...payload, operation:'STOP'});
});
test('PCM é dimensionado pela taxa do contexto antes de ser aceito', async () => {
 const session = pendingSession();
 const e = environment(async () => session.session, false, 256);
 await e.command(playbackPayload('resample-budget'));
 await flush();
 session.callback({type:'pcm',bytes:new Uint8Array(80),mimeType:'audio/pcm;rate=12000'});
 await flush();
 const state = await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});
 assert.deepEqual(Array.from(state.activeJobIds), []);
 assert.match(state.jobs[0].error || '', /128 MB/);
 assert.equal(e.nodes[0].processor.queue.length, 0);
});
test('queda de conexão após enfileirar bloco antes fora de ordem não repete seu início', async () => {
 const lanes = [];
 const e = environment(async () => {
  const lane = pendingSession();
  lanes.push(lane);
  return lane.session;
 });
 const payload = {...playbackPayload('out-of-order'), apiKeys:['fixture-a','fixture-b'], maxParallelLiveSessions:2,
  chunkSize:120, text:['Primeiro.','Segundo.'].map(name => name+' '+ 'palavra '.repeat(12)+'Fim.').join('\n\n')};
 await e.command(payload);
 await flush();
 assert.equal(lanes.length, 2);
 lanes[1].callback({type:'pcm',bytes:new Uint8Array([0,64]),mimeType:'audio/pcm;rate=24000'});
 lanes[0].finish(3000);
 await flush();
 const rendered = new Float32Array(2);
 e.nodes[0].processor.process([],[[rendered]]);
 assert.equal(rendered[1], .5);
 lanes[1].done.reject(Error('WebSocket closed'));
 await flush();
 const state = await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});
 assert.equal(lanes.length, 2, 'nenhuma segunda síntese do bloco já tocado');
 assert.equal(state.jobs[0].status, 'paused');
 await e.command({...payload, operation:'STOP'});
});
test('falha do worklet encerra só a narração afetada e libera seu PCM', async () => {
 const e = await playbackFixture();
 await e.start('preserved');
 await e.pcm('preserved');
 await e.start('worklet-failed');
 await e.pcm('worklet-failed');
 e.nodes[1].onprocessorerror?.({});
 await flush();
 const state = await e.snapshot();
 assert.deepEqual(Array.from(state.activeJobIds), ['preserved']);
 assert.equal(state.jobs.find(job => job.jobId === 'worklet-failed').status, 'error');
 assert.equal(e.contexts[1].state, 'closed');
 assert.equal(e.nodes[1].processor.queue.length, 0);
 assert.equal(e.contexts[0].state, 'suspended');
 await e.control('preserved', 'STOP');
});
test('falha ao pausar após erro remoto libera recursos e publica erro terminal', async () => {
 const e = await playbackFixture();
 const session = await e.start('pause-failed');
 await e.pcm('pause-failed');
 e.contexts[0].suspend = async () => { throw Error('Contexto não suspendeu'); };
 session.done.reject(Error('WebSocket closed'));
 await flush();
 const state = await e.snapshot();
 assert.equal(state.jobs[0].status, 'error');
 assert.equal(state.activeJobIds.length, 0);
 assert.equal(e.contexts[0].state, 'closed');
 assert.equal(e.nodes[0].processor.queue.length, 0);
});
test('falha de geração com cache disponível usa Pause e mantém trecho recebido para retomada',async()=>{
 const e=await playbackFixture();await e.start('partial');await e.pcm('partial');e.sessions.get('partial').done.reject(Error('Falha remota sintética.'));await flush();await flush();const state=await e.snapshot();assert.equal(state.jobs[0].status,'paused');assert.match(state.jobs[0].warning,/Falha remota/);assert.equal(e.nodes[0].processor.queue.length,1);assert.equal(e.nodes[0].sent.some(p=>p.type==='flush'),false);await e.control('partial','RESUME');assert.equal(e.contexts[0].state,'running');await e.control('partial','STOP');
});
test('erro durante geração pausada conserva também PCM ainda não transferido ao worklet',async()=>{
 const e=await playbackFixture();await e.start('paused-error');await e.control('paused-error','PAUSE');await e.pcm('paused-error');e.sessions.get('paused-error').done.reject(Error('Falha de teste durante pausa.'));await flush();await flush();assert.equal((await e.snapshot()).jobs[0].status,'paused');await e.control('paused-error','RESUME');assert.equal(e.nodes[0].processor.queue.length,1);assert.equal(e.attempts.length,1);await e.control('paused-error','STOP');
});
test('Pause que chega enquanto Resume aguarda contexto impede liberação tardia da saída',async()=>{
 const e=await playbackFixture();await e.start('rapid');await e.pcm('rapid');await e.consume(0);await e.control('rapid','PAUSE');let release;const original=e.contexts[0].resume.bind(e.contexts[0]);e.contexts[0].resume=()=>new Promise(resolve=>release=()=>original().then(resolve));
 const resuming=e.control('rapid','RESUME');await flush();const pausing=e.control('rapid','PAUSE');release();await Promise.all([resuming,pausing]);assert.equal(e.contexts[0].state,'suspended');assert.equal(e.nodes[0].processor.paused,true);await e.control('rapid','STOP');
});
test('Play repetido durante geração conserva prioridade e não gera outra narração',async()=>{
 const e=await playbackFixture();await e.start('pending',{playbackIntent:10});await e.command({operation:'PLAYBACK_INTENT',playbackIntent:20});await e.control('pending','CLAIM_PLAYBACK',{playbackIntent:20});await e.pcm('pending');await e.consume(0);assert.equal((await e.snapshot()).jobs[0].status,'playing');assert.equal(e.attempts.length,1);await e.control('pending','STOP');
});
test('primeiro PCM acima do orçamento falha com mensagem, sem deixar geração presa em Conectando',async()=>{
 const session=pendingSession(),e=environment(async()=>session.session,false,256),p=playbackPayload('oversized');await e.command(p);await flush();session.callback({type:'pcm',bytes:new Uint8Array(512),mimeType:'audio/pcm;rate=24000'});await flush();await flush();const state=await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});assert.equal(state.jobs[0].status,'error');assert.match(state.jobs[0].error,/cache|128 MB/);assert.equal(state.activeJobIds.length,0);
});

test('Resume sem PCM mantém Conectando e não pausa a narração que ainda está tocando', async()=>{
 const e=await playbackFixture();
 await e.start('audible');await e.pcm('audible');await e.consume(0);
 await e.start('pending');await e.control('pending','PAUSE');
 const resumed=await e.control('pending','RESUME');
 assert.equal(resumed.status.playbackState,'connecting');
 assert.equal((await e.snapshot()).jobs.find(job=>job.jobId==='audible').status,'playing');
 await e.pcm('pending',128);await e.consume(1,128);
 assert.equal((await e.snapshot()).jobs.find(job=>job.jobId==='audible').status,'paused');
 await e.consume(1,128);
 assert.equal((await e.snapshot()).jobs.find(job=>job.jobId==='pending').status,'connecting');
 await e.pcm('pending',128);await e.consume(1,128);
 assert.equal((await e.snapshot()).jobs.find(job=>job.jobId==='pending').status,'playing');
 await e.control('audible','STOP');await e.control('pending','STOP');
});
