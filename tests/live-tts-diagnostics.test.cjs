const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'live-tts-diagnostics.js'),'utf8'),flush=()=>new Promise(r=>setImmediate(r));
const jobId='job-1791482000000-abc',sessionId='live-1791482000000-def',secret='fake-private-credential',personal='texto e instrução privados';
function area(){const data={};return{data,async get(key){return{[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}};}
function helper(session,sendMessage){const c=vm.createContext({structuredClone,chrome:{storage:{session},runtime:{sendMessage}}});vm.runInContext(source,c);return c.LiveTtsDiagnostics;}
function worker(session){
 const context=vm.createContext({structuredClone,AbortController,console,chrome:{storage:{session},runtime:{getURL:file=>'chrome-extension://test/'+file}}});
 vm.runInContext(require('./load-background.cjs')(path.join(root,'background.js')).replace('__require("extension/src/background/index.ts");','globalThis.factories=__modules;'),context);
 const cache={};function load(id){if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};context.factories[id](module,module.exports,load);return module.exports;}
 return{context,route:load('extension/src/background/messageRouter.ts').handleExtensionMessage};
}
test('captura real das funções de protocolo/player persiste antes do fim e sobrevive ao offscreen',async()=>{
 const session=area(),sw=worker(session),events=[],nodes=[],sockets=[];let listener;
 class Socket{constructor(){this.readyState=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}send(wire){const msg=JSON.parse(wire);queueMicrotask(()=>this.onmessage({data:new Blob([JSON.stringify(msg.setup?{setupComplete:{}}:{serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAA='}}]}}})])}));}close(){this.readyState=3;this.onclose({code:1000,reason:'idle'});}}
 class AudioContext{constructor(){this.state='suspended';this.sampleRate=24000;this.destination={};this.audioWorklet={async addModule(){}};}createGain(){return{gain:{value:1},connect:x=>x};}async resume(){this.state='running';}async close(){this.state='closed';}}
 class AudioWorkletNode{constructor(){this.port={postMessage(){}};nodes.push(this);}connect(x){return x;}}
 const context=vm.createContext({console,structuredClone,performance,WebSocket:Socket,AudioContext,AudioWorkletNode,AbortController,Blob,TextDecoder,Uint8Array,Float32Array,DataView,atob,btoa,queueMicrotask,setTimeout,clearTimeout,setInterval(){return 0;},clearInterval(){},chrome:{runtime:{getURL:x=>x,onMessage:{addListener(fn){listener=fn;}},sendMessage(message){if(message.type==='LIVE_TTS_DIAGNOSTIC')return sw.route(message,{url:'chrome-extension://test/offscreen.html'});events.push(message);return Promise.resolve({success:true});}}}});
 for(const file of ['live-config.js','live-tts-diagnostics.js','live-session-manager.js','offscreen.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 const payload={operation:'TTS_LIVE_START',jobId,tabId:1,playerId:'p',requestId:'r',apiKeys:[secret],models:['gemini-3.8-live'],modelId:'gemini-3.8-live',voiceName:'Kore',text:personal,systemInstruction:personal};
 assert.equal((await new Promise(r=>listener({type:'LIVE_OFFSCREEN_COMMAND',target:'offscreen',payload},{},r))).success,true);await flush();await flush();
 const before=await sw.context.LiveTtsDiagnostics.read(),job=before.jobs[0];assert.equal(job.jobId,jobId);for(const stage of ['socket-open','setup-sent','setup-complete','turn-sent','first-pcm','pcm-received','player-enqueue'])assert.equal(job.milestones[stage],true,stage);assert.equal(job.milestones.ended,undefined);assert.equal(job.sessions[0].setupCompleteReceived,true);
 nodes[0].port.onmessage({data:{type:'first-played',blockId:0,frames:1}});sockets[0].onmessage({data:JSON.stringify({serverContent:{turnComplete:true}})});await flush();nodes[0].port.onmessage({data:{type:'drain'}});nodes[0].port.onmessage({data:{type:'position',frame:1,totalFrames:1,availableStart:0}});await flush();
 const after=await sw.context.LiveTtsDiagnostics.read();for(const stage of ['first-frame-consumed','first-playback','turn-complete','generation-complete','ended','stopped'])assert.equal(after.jobs[0].milestones[stage],true,stage);context.LiveSessions.getTtsDiagnostics=()=>{throw Error('offscreen indisponível');};
 const restarted=worker(session),options=helper(undefined,msg=>restarted.route(msg,{url:'chrome-extension://test/options.html'})),persisted=await options.get();assert.equal(persisted.jobs[0].milestones.ended,true);assert.equal(persisted.jobs[0].sessions[0].model,'gemini-3.8-live');
 const serialized=JSON.stringify(session.data);assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes(personal));assert.ok(!/base64|inlineData|"systemInstruction"\s*:|"setup"\s*:|"turn"\s*:|"text"\s*:|"buffer"\s*:/.test(serialized));
 assert.equal(events.some(x=>x.payload.event==='ended'),true);
});
test('allowlist descarta conteúdo arbitrário e autentica remetentes no background',async()=>{
 const session=area(),sw=worker(session),packet={jobId,sessionId,stage:'first-pcm',model:'gemini-3.8-live',keyId:'key#1',bytes:2,mimeType:'audio/pcm;rate=24000',apiKey:secret,base64:'AAA=',text:personal,error:personal,reason:personal,setup:{systemInstruction:personal},protocol:{sessionId,setupCompleteReceived:true,setup:personal,turn:personal,url:secret,events:[{text:personal}],milestones:{'setup-complete':true,[personal]:true}}};
 assert.equal((await sw.route({type:'LIVE_TTS_DIAGNOSTIC',payload:packet},{url:'https://example.com'})).success,false);assert.equal(Object.keys(session.data).length,0);
 assert.equal((await sw.route({type:'LIVE_TTS_DIAGNOSTIC',payload:packet},{url:'chrome-extension://test/offscreen.html'})).success,true);
 assert.equal((await sw.route({type:'LIVE_TTS_DIAGNOSTICS_GET'},{url:'chrome-extension://test/content.html'})).success,false);
 const data=await sw.context.LiveTtsDiagnostics.read(),serialized=JSON.stringify(data);assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes(personal));assert.ok(!serialized.includes('AAA='));assert.equal(data.jobs[0].events[0].keyId,'key#1');
});
test('tarefas manuais preservam diagnóstico sanitizado de pausa e retomada',async()=>{
 const session=area(),messages=[],api=helper(session,message=>{messages.push(message);return api.record(message.payload);}),manualId='manual-1791482000000-abc';
 api.captureEvent({operation:'TTS_LIVE_START',jobId:manualId},'first-playback',{apiKey:secret,text:personal});
 api.capturePlayback({jobId:manualId,events:[{stage:'paused',contextState:'suspended',paused:true,workletPaused:true,outputMuted:true,positionFrame:120000,controlSeq:7,text:personal,apiKey:secret}]});
 api.capturePlayback({jobId:manualId,events:[{stage:'resumed',contextState:'running',paused:false}]});
 const state=await api.read(),job=state.jobs.find(item=>item.jobId===manualId);assert.ok(job,'o job manual não pode ser descartado pelo filtro de IDs');
 assert.equal(messages.length,3);assert.equal(job.milestones.paused,true);assert.equal(job.milestones.resumed,true);assert.equal(job.events[1].contextState,'suspended');assert.equal(job.events[2].contextState,'running');
 assert.equal(job.events[1].workletPaused,true);assert.equal(job.events[1].outputMuted,true);assert.equal(job.events[1].positionFrame,120000);assert.equal(job.events[1].controlSeq,7);
 const serialized=JSON.stringify(state);assert.ok(!serialized.includes(personal));assert.ok(!serialized.includes(secret));assert.equal(api.sanitize({jobId:'manual-'+personal,stage:'paused'}),null);
});
test('resumo lógico permite nomes de campos e presença de instrução, nunca valores de conteúdo',async()=>{
 const session=area(),api=helper(session),packet={jobId,stage:'setup-complete',protocol:{sessionId,model:'gemini-3.1-flash-live-preview',schema:'BidiGenerateContentSetup',systemInstructionPresent:true,systemInstructionCharacters:42,setupFields:['model','systemInstruction',personal],generationFields:['speechConfig',secret],systemInstruction:{parts:[{text:personal}]},text:personal}};await api.record(packet);const summary=(await api.read()).jobs[0].sessions[0];assert.equal(summary.systemInstructionPresent,true);assert.equal(summary.systemInstructionCharacters,42);assert.deepEqual(Array.from(summary.setupFields),['model','systemInstruction']);assert.deepEqual(Array.from(summary.generationFields),['speechConfig']);assert.equal(summary.model,'gemini-3.1-flash-live-preview');assert.ok(!JSON.stringify(summary).includes(personal));assert.ok(!JSON.stringify(summary).includes(secret));assert.equal(summary.systemInstruction,undefined);
});
test('writes concorrentes preservam eventos; limites e TTL limpam histórico na consulta',async()=>{
 const session=area(),api=helper(session),jobs=Array.from({length:12},(_,i)=>'job-'+(1791482000000+i)+'-abc');
 await Promise.all(jobs.map(jobId=>api.record({jobId,stage:'setup-complete'})));assert.equal((await api.read()).jobs.length,api.MAX_JOBS);
 const latest=jobs.at(-1);await Promise.all(Array.from({length:150},(_,blockId)=>api.record({jobId:latest,stage:'player-enqueue',blockId})));const state=await api.read(),job=state.jobs.find(j=>j.jobId===latest);assert.equal(job.events.length,api.MAX_EVENTS);assert.equal(job.events.at(-1).blockId,149);assert.equal(job.milestones['setup-complete'],true);
 session.data[api.STORAGE_KEY].jobs[0].updatedAt=Date.now()-api.TTL_MS-1;const cleaned=await api.read();assert.equal(cleaned.jobs.some(j=>j.jobId===latest),false);assert.equal(session.data[api.STORAGE_KEY].jobs.some(j=>j.jobId===latest),false);
});
test('falha de storage não envenena a fila; envio de diagnóstico rejeitado não lança',async()=>{
 const session=area(),get=session.get;let failed=false;session.get=async key=>{if(!failed){failed=true;throw Error('storage indisponível');}return get(key);};const api=helper(session,()=>Promise.reject(Error('offscreen encerrando')));
 await assert.rejects(api.record({jobId,stage:'setup-sent'}));await api.record({jobId,stage:'setup-complete'});assert.equal((await api.read()).jobs.length,1);
 assert.doesNotThrow(()=>api.captureProtocol({jobId,sessionId,model:'gemini-3.8-live',events:[{event:'setup-complete'}]}));await flush();
});
test('marcos sobrevivem à rotação dos snapshots; sessões também têm limite',async()=>{
 const session=area(),api=helper(session);await api.record({jobId,stage:'setup-complete',protocol:{sessionId,milestones:{'setup-complete':true}}});await api.record({jobId,stage:'turn-complete',protocol:{sessionId,milestones:{'turn-complete':true}}});
 const initial=(await api.read()).jobs[0].sessions[0];assert.equal(initial.milestones['setup-complete'],true);assert.equal(initial.milestones['turn-complete'],true);
 for(let i=0;i<18;i++)await api.record({jobId,stage:'setup-complete',protocol:{sessionId:'live-'+(1791482000001+i)+'-abc',setupCompleteReceived:true}});assert.equal((await api.read()).jobs[0].sessions.length,api.MAX_SESSIONS);
});
test('STT não é capturado e opções carregam o comando sem offscreen',()=>{
 const messages=[],api=helper(undefined,msg=>{messages.push(msg);return Promise.resolve();});api.captureEvent({operation:'STT_LIVE_START',jobId},'setup-complete',{text:personal});assert.equal(messages.length,0);
 assert.match(fs.readFileSync(path.join(root,'options.html'),'utf8'),/<script src="live-tts-diagnostics.js"><\/script>/);assert.match(fs.readFileSync(path.join(root,'offscreen.html'),'utf8'),/<script src="live-tts-diagnostics.js"><\/script>/);
});
