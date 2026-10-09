const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const config=require('../live-config.js');const flush=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function environment(acquire,slowInit=false){
 const events=[],contexts=[],nodes=[],attempts=[];let listener;
 class AudioContext{constructor(){this.state='suspended';this.sampleRate=24000;this.destination={};this.init=deferred();this.audioWorklet={addModule:()=>slowInit?this.init.promise:Promise.resolve()};contexts.push(this);}createGain(){return{gain:{value:1},connect:x=>x};}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
 class AudioWorkletNode{constructor(){this.sent=[];this.port={postMessage:(data,transfer)=>{this.sent.push(structuredClone(data,{transfer}));}};nodes.push(this);}connect(x){return x;}}
 class Manager{async acquire(options){attempts.push({jobId:options.jobId,blockId:options.blockId,modelId:options.modelId,keyIndex:options.keyIndex});return acquire(options);}release(){}retire(session){session.closed=true;}}
 const context=vm.createContext({console,performance,structuredClone,AudioContext,AudioWorkletNode,AbortController,DataView,Float32Array,Uint8Array,LiveConfig:config,LiveSessions:{LiveSessionManager:Manager,classifyLiveError:require('../live-session-manager.js').classifyLiveError},chrome:{runtime:{getURL:x=>x,onMessage:{addListener(fn){listener=fn;}},sendMessage(msg){events.push(msg.payload);return Promise.resolve();}}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','offscreen.js'),'utf8'),context);
 const command=payload=>new Promise(resolve=>listener({target:'offscreen',type:'LIVE_OFFSCREEN_COMMAND',payload},{},resolve));
 return{command,events,contexts,nodes,attempts};
}
function pendingSession(){const done=deferred();let callback;return{done,get callback(){return callback;},session:{socketOpenMs:1,setupCompleteMs:2,sendTurn(_text,onMessage,signal){callback=onMessage;signal?.addEventListener('abort',()=>done.reject(Object.assign(new Error('Cancelado'),{cancelled:true})),{once:true});return done.promise;}},finish(value){callback({type:'pcm',bytes:new Uint8Array([value&255,value>>8]),mimeType:'audio/pcm;rate=24000'});done.resolve({metrics:{}});}};}
const base={operation:'TTS_LIVE_START',tabId:1,playerId:'p',requestId:'r',jobId:'j',modelId:'gemini-3.8-live',models:['gemini-3.8-live','gemini-3.8-live-extended-thinking'],apiKeys:Array.from({length:9},(_,i)=>'fake-'+i),text:'Teste.',maxParallelLiveSessions:1};
test('cadeia completa ordena modelos, esgota chaves e nunca aciona convencionais',async()=>{
 const models=config.LIVE_MODEL_PRIORITY,env=environment(async()=>{throw Error('Quota exceeded');});await env.command({...base,models:[models[0],models[3],models[2],models[1],'gemini-3.8-flash-tts']});await flush();await flush();
 assert.deepEqual(env.attempts.map(x=>[x.modelId,x.keyIndex]),models.flatMap(model=>Array.from({length:9},(_,i)=>[model,i+1])));assert.ok(env.events.some(e=>e.event==='error'&&/Fallback Live esgotado/.test(e.error)));
});
test('ranking passivo só altera chaves do modelo atual, respeitando cooldown',async()=>{
 const env=environment(async o=>{if(o.modelId===base.modelId)throw Error('WebSocket closed');return{sendTurn:async()=>({metrics:{}})};});
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
  const env=environment(async o=>{if(o.modelId==='gemini-3.8-live')throw new Error(message);return{sendTurn:async()=>({metrics:{}})};});await env.command(base);await flush();await flush();
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
 for(let i=0;i<3;i++)env.nodes[0].port.onmessage({data:{type:'drain'}});assert.equal(env.events.filter(x=>x.event==='ended').length,1);
});
test('falha tardia de job cancelado não remove os controles do sucessor',async()=>{
 const old=deferred(),current=pendingSession(),env=environment(async o=>o.jobId==='old'?old.promise:current.session);
 await env.command({...base,jobId:'old',requestId:'old'});await env.command({...base,jobId:'new',requestId:'new'});await flush();old.reject(new Error('WebSocket closed'));await flush();
 const paused=await env.command({...base,operation:'PAUSE',requestId:'new'});assert.equal(paused.status?.paused,true);await env.command({...base,operation:'STOP',requestId:'new'});await flush();
});
test('inicializações simultâneas mantêm somente o job mais recente',async()=>{
 const item=pendingSession(),env=environment(async()=>item.session,true),first=env.command({...base,jobId:'old',requestId:'old'}),second=env.command({...base,jobId:'new',requestId:'new'});
 env.contexts[1].init.resolve();await second;env.contexts[0].init.resolve();await first;await flush();assert.deepEqual(env.attempts.map(x=>x.jobId),['new']);assert.equal(env.contexts[0].state,'closed');assert.equal(env.nodes.length,1);await env.command({...base,operation:'STOP',requestId:'new'});await flush();
});
