const test=require('node:test'),assert=require('node:assert/strict');
const config=require('../live-config.js'),sessions=require('../live-session-manager.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function transport(t,override={}){
 const original=globalThis.WebSocket,instances=[];
 class Socket{
  constructor(url){this.url=url;this.readyState=0;this.sent=[];instances.push(this);}
  open(){this.readyState=1;this.onopen();}
  send(wire){assert.equal(this.readyState,1);this.sent.push(wire);}
  message(data){this.onmessage({data});}
  serverClose(code,reason){this.readyState=3;this.onclose({code,reason});}
  close(code,reason){if(this.readyState===3)return;this.serverClose(code,reason);}
 }
 globalThis.WebSocket=Socket;t.after(()=>{globalThis.WebSocket=original;});
 const options={modelId:'gemini-3.8-live',voiceName:'Kore',apiKey:'secret-test-key',keyIndex:1,jobId:'job-1',blockId:0,...override};
 const session=new sessions.LiveSession({retire(s){s.close();}},options);
 return{session,options,instances};
}
test('runtime rejeita modelo convencional/Translate/Transcribe e JSON antes do socket',async t=>{
 const {session,instances}=transport(t);
 for(const modelId of ['gemini-3.8-flash-tts','gemini-3.5-live-translate-preview','gemini-3.5-transcribe-live']){session.options.modelId=modelId;await assert.rejects(session.open(),error=>error.httpStatus===400);assert.equal(instances.length,0);}
 session.options.modelId='gemini-3.8-live';session.options.jsonMode='override';session.options.advancedJson={setup:{model:'models/gemini-3.8-flash-tts'}};await assert.rejects(session.open(),/corresponder/);assert.equal(instances.length,0);
});
test('os quatro modelos gerais usam exatamente o setup central no socket',async t=>{
 const {instances,options}=transport(t);for(const modelId of config.LIVE_MODEL_PRIORITY){const session=new sessions.LiveSession({retire(s){s.close();}},{...options,modelId,thinkingLevel:'low'}),open=session.open(),socket=instances.at(-1);socket.open();await flush();assert.deepEqual(JSON.parse(socket.sent[0]),config.buildLiveSessionConfig(session.options));socket.message(JSON.stringify({setupComplete:{}}));await open;session.close();}
});
test('ditado Extended aplica VAD validado ao setup e lifecycle de áudio sem alterar TTS',async t=>{
 const {instances,options}=transport(t),session=new sessions.LiveSession({retire(s){s.close();}},{...options,modelId:'gemini-3.8-live-extended-thinking',mode:'dictation'}),open=session.open(),socket=instances[0];socket.open();await flush();assert.equal(JSON.parse(socket.sent[0]).setup.realtimeInputConfig.automaticActivityDetection.disabled,true);socket.message(JSON.stringify({setupComplete:{}}));await open;
 session.sendAudio(new Uint8Array([0,0]));session.endAudio();assert.ok(socket.sent.some(wire=>JSON.parse(wire).realtimeInput?.activityStart));assert.ok(socket.sent.some(wire=>JSON.parse(wire).realtimeInput?.activityEnd));assert.equal(socket.sent.some(wire=>JSON.parse(wire).realtimeInput?.audioStreamEnd),false);session.close();
});
test('setup → confirmação binária → turno; captura exatamente os corpos enviados',async t=>{
 const {session,options,instances}=transport(t),opening=session.open(),socket=instances[0];
 socket.open();await flush();
 assert.equal(socket.sent.length,1);assert.deepEqual(JSON.parse(socket.sent[0]),config.buildLiveSessionConfig(options));
 const turn=session.sendTurn('Teste de áudio.');await flush();assert.equal(socket.sent.length,1);
 socket.message(new Blob([JSON.stringify({setupComplete:{}})]));await opening;await flush();
 assert.equal(socket.sent.length,2);assert.deepEqual(JSON.parse(socket.sent[1]),config.buildLiveTurnMessage('Teste de áudio.'));
 socket.message(new TextEncoder().encode(JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAA='}}]},turnComplete:true}})).buffer);
 const result=await turn;assert.equal(result.chunks[0].byteLength,2);
 const trace=sessions.getTtsDiagnostics().find(x=>x.sessionId===session.id);assert.ok(trace,'conclusão bem-sucedida deve ficar disponível no snapshot público');assert.equal(trace.setupCompleteReceived,true);assert.deepEqual(trace.setup,JSON.parse(socket.sent[0]));assert.deepEqual(trace.turn,JSON.parse(socket.sent[1]));assert.ok(trace.events.some(e=>e.event==='first-pcm'));assert.ok(trace.events.some(e=>e.event==='turn-complete'));assert.ok(!JSON.stringify(trace).includes(options.apiKey));session.close();
});
test('1007 antes de setupComplete preserva motivo, fase e última mensagem; REQUEST só com evidência',async t=>{
 const {session,instances}=transport(t),opening=session.open(),socket=instances[0];
 socket.open();await flush();socket.serverClose(1007,'Request contains an invalid argument.');
 await assert.rejects(opening,error=>{assert.equal(error.closeCode,1007);assert.equal(error.closeReason,'Request contains an invalid argument.');assert.equal(error.protocolPhase,'awaiting-setup-complete');assert.equal(error.lastSentType,'setup');assert.equal(error.protocol.setupCompleteReceived,false);assert.equal(error.protocol.turn,null);assert.equal(error.protocol.close.readyState,3);assert.equal(sessions.classifyLiveError(error),'REQUEST');return true;});
});
test('preview readonly coincide com setup/turn enviados nos três modos Live',async t=>{
 const fs=require('node:fs'),vm=require('node:vm'),{instances,options}=transport(t),source=fs.readFileSync(require.resolve('../options.js'),'utf8'),html=fs.readFileSync(require.resolve('../options.html'),'utf8');
 assert.match(html,/<pre id="liveSetupPreview"/);assert.match(html,/<pre id="liveTurnPreview"/);
 for(const jsonMode of ['panel','override','complete']){
  const agent={metadata:{id:'custom'},voice:{preferredVoice:'Kore'},instructions:{ttsSystemInstruction:'Leia fielmente.'},live:{preferredModel:options.modelId,voiceName:'Kore',jsonMode}},panel=config.buildLiveSessionConfig(config.buildAgentLiveOptions({...agent,live:{...agent.live,jsonMode:'panel'}}));
  agent.live.advancedJson=jsonMode==='complete'?JSON.stringify(panel):{setup:{outputAudioTranscription:{}}};
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'Teste de áudio.',textContent:''});return elements.get(id);},context=vm.createContext({LiveConfig:config,currentAgent:agent,state:{audio:{}},$:element});
  vm.runInContext(source.slice(source.indexOf('function buildLivePreview(){'),source.indexOf('function setupLiveOptions(){'))+';updateLivePreview();',context);
  const setup=JSON.parse(element('#liveSetupPreview').textContent),turn=JSON.parse(element('#liveTurnPreview').textContent),session=new sessions.LiveSession({retire(s){s.close();}},{...options,...config.buildAgentLiveOptions(agent)});t.after(()=>session.close());
  const opening=session.open(),socket=instances.at(-1);socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));await opening;assert.deepEqual(JSON.parse(socket.sent[0]),setup);
  const sending=session.sendTurn(element('#liveTestText').value);await flush();assert.deepEqual(JSON.parse(socket.sent[1]),turn);socket.message(JSON.stringify({serverContent:{turnComplete:true}}));await sending;session.close();
 }
});
test('1007 depois de setupComplete não perde close.reason dentro de sendTurn',async t=>{
 const {session,instances}=transport(t),opening=session.open(),socket=instances[0];socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));await opening;
 const turn=session.sendTurn('Teste de áudio.');await flush();socket.serverClose(1007,'Unknown field in clientContent.');
 await assert.rejects(turn,error=>{assert.equal(error.closeReason,'Unknown field in clientContent.');assert.equal(error.protocol.setupCompleteReceived,true);assert.equal(error.lastSentType,'turn');assert.equal(error.protocolPhase,'awaiting-first-pcm');assert.equal(sessions.classifyLiveError(error),'REQUEST');return true;});
});
test('1007 sem motivo conclusivo não é automaticamente REQUEST',()=>{assert.equal(sessions.classifyLiveError(Object.assign(new Error('WebSocket Live fechado (1007).'),{closeCode:1007,closeReason:'',protocolPhase:'awaiting-setup-complete',lastSentType:'setup'})),'UNKNOWN');});
test('sessão warm atualiza job/bloco sem reconstruir setup',async t=>{
 const {session,options,instances}=transport(t),manager=new sessions.LiveSessionManager();t.after(()=>manager.closeAll());
 const opening=session.open();instances[0].open();await flush();instances[0].message(JSON.stringify({setupComplete:{}}));await opening;
 manager.pool.set(manager.key(options),[session]);session.manager=manager;manager.release(session);
 const reused=await manager.acquire({...options,jobId:'job-2',blockId:2});assert.equal(reused,session);assert.equal(reused.diagnosticSnapshot().jobId,'job-2');assert.equal(reused.diagnosticSnapshot().blockId,2);assert.equal(instances[0].sent.length,1);
});
test('STT aceita setupComplete Blob e transcrições ArrayBuffer sem timeout',async t=>{
 const {session,instances}=transport(t,{mode:'dictation'});const opening=session.open(),socket=instances[0];void opening.catch(()=>{});t.after(()=>session.close());socket.open();await flush();socket.message(new Blob([JSON.stringify({setupComplete:{}})]));await flush();assert.equal(session.ready,true);await opening;
 const received=[];session.handler=msg=>received.push(msg.serverContent);socket.message(new TextEncoder().encode(JSON.stringify({serverContent:{interimInputTranscription:{text:'Teste'}}})).buffer);socket.message(new Blob([JSON.stringify({serverContent:{inputTranscription:{text:'Teste final'},turnComplete:true}})]));await flush();assert.equal(received[0].interimInputTranscription.text,'Teste');assert.equal(received[1].inputTranscription.text,'Teste final');
});
test('roteamento dictation real envia setup STT geral, PCM e fim sem turno TTS',async t=>{
 const {session,instances}=transport(t,{mode:'dictation',vad:{disabled:false},outputTranscription:true,systemInstruction:'instrução TTS privada'});t.after(()=>session.close());
 const opening=session.open(),socket=instances[0];socket.open();await flush();const setup=JSON.parse(socket.sent[0]).setup;assert.deepEqual(setup.generationConfig,{responseModalities:['AUDIO']});assert.deepEqual(setup.inputAudioTranscription,{});assert.equal(setup.outputAudioTranscription,undefined);assert.ok(!JSON.stringify(setup).includes('privada'));
 socket.message(JSON.stringify({setupComplete:{}}));await opening;session.sendAudio(new Uint8Array([0,0]),16000);session.endAudio();assert.deepEqual(JSON.parse(socket.sent[1]),{realtimeInput:{audio:{data:'AAA=',mimeType:'audio/pcm;rate=16000'}}});assert.deepEqual(JSON.parse(socket.sent[2]),{realtimeInput:{audioStreamEnd:true}});assert.equal(sessions.getTtsDiagnostics().some(s=>s.sessionId===session.id),false);
});
test('VAD manual delimita áudio com activityStart/activityEnd, sem audioStreamEnd',async t=>{
 const {session,instances}=transport(t);session.options={...session.options,mode:'dictation',vad:{disabled:true}};t.after(()=>session.close());const opening=session.open(),socket=instances[0];socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));await opening;
 session.sendAudio(new Uint8Array([0,0]));session.sendAudio(new Uint8Array([0,0]));session.endAudio();assert.deepEqual(socket.sent.slice(1).map(w=>Object.keys(JSON.parse(w).realtimeInput)[0]),['activityStart','audio','audio','activityEnd']);assert.equal(socket.sent.some(w=>w.includes('audioStreamEnd')),false);
});
test('quatro modelos STT respeitam setupComplete e VAD efetivo sem misturar finais',async t=>{
 const {instances,options}=transport(t);
 for(const modelId of config.LIVE_MODEL_PRIORITY)for(const vad of [undefined,{disabled:true},{disabled:false}]){
  const session=new sessions.LiveSession({retire(s){s.close();}},{...options,modelId,mode:'dictation',vad}),opening=session.open(),socket=instances.at(-1);assert.throws(()=>session.sendAudio(new Uint8Array([0,0])),/não está pronta/);socket.open();await flush();const setup=JSON.parse(socket.sent[0]).setup;assert.deepEqual(setup.inputAudioTranscription,{});assert.deepEqual(setup.generationConfig.responseModalities,['AUDIO']);socket.message(JSON.stringify({setupComplete:{}}));await opening;
  assert.throws(()=>session.sendAudio(new Uint8Array([0])),/Int16/);assert.throws(()=>session.sendAudio(new Uint8Array([0,0]),48000),/16000/);session.sendAudio(new Uint8Array([0,64]));session.endAudio();const manual=session.options.vad.disabled===true;assert.deepEqual(socket.sent.slice(1).map(w=>Object.keys(JSON.parse(w).realtimeInput)[0]),manual?['activityStart','audio','activityEnd']:['audio','audioStreamEnd']);const snapshot=session.sttSnapshot();assert.equal(snapshot.inputTranscriptionConfigured,true);assert.equal(snapshot.sentBytes,2);assert.equal(snapshot.activityEnds,manual?1:0);assert.equal(snapshot.streamEnds,manual?0:1);session.close();
 }
});
test('diagnóstico STT conta mensagens/VAD/geração sem confundir output com input nem guardar texto',async t=>{
 const {session,instances}=transport(t,{mode:'dictation'});const opening=session.open(),socket=instances[0];socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));await opening;
 const received=[];session.handler=msg=>received.push(msg);socket.message('invalid JSON fixture');socket.message(JSON.stringify({voiceActivity:{type:'ACTIVITY_START'}}));socket.message(JSON.stringify({serverContent:{outputTranscription:{text:'fixture-private-output'},modelTurn:{parts:[{text:'fixture-private-output'}]}}}));socket.message(JSON.stringify({serverContent:{interimInputTranscription:{text:'fixture-private-interim'}}}));socket.message(JSON.stringify({serverContent:{inputTranscription:{text:'fixture-private-input',finished:true},turnComplete:true}}));await flush();session.sendAudio(new Uint8Array([0,64]));
 const snapshot=session.sttSnapshot();assert.equal(snapshot.serverMessages,5);assert.equal(snapshot.voiceActivityEvents,1);assert.equal(snapshot.modelTurnEvents,1);assert.equal(snapshot.outputEvents,1);assert.equal(snapshot.inputEvents,1);assert.equal(snapshot.interimEvents,1);assert.equal(snapshot.inputFinished,true);assert.equal(snapshot.parseErrors,1);assert.equal(snapshot.sentChunks,1);assert.equal(received[0].voiceActivity.type,'ACTIVITY_START');assert.ok(!JSON.stringify(snapshot).includes('private'));session.close();
});
test('STT 3.8 padrão delimita PCM sem silêncio e persiste tipos/tempos após fim sem dados privados',async t=>{
 const diag=require('../live-stt-diagnostics.js'),original=globalThis.LiveSttDiagnostics,packets=[];globalThis.LiveSttDiagnostics={emit:p=>{const safe=diag.sanitize(p);if(safe)packets.push(safe);}};t.after(()=>globalThis.LiveSttDiagnostics=original);
 const {session,instances}=transport(t,{mode:'dictation',jobId:'00000000-0000-4000-8000-000000000000'}),opening=session.open(),socket=instances[0];socket.open();await flush();assert.equal(JSON.parse(socket.sent[0]).setup.realtimeInputConfig.automaticActivityDetection.disabled,true);socket.message(JSON.stringify({setupComplete:{}}));socket.message(JSON.stringify({sessionResumptionUpdate:{resumable:true,newHandle:'fixture-private-handle'}}));await opening;
 socket.message(JSON.stringify({voiceActivity:{type:'ACTIVITY_START'}}));await flush();session.sendAudio(new Uint8Array([0,64]));session.sendAudio(new Uint8Array([0,192]));session.endAudio();assert.deepEqual(socket.sent.slice(1).map(w=>Object.keys(JSON.parse(w).realtimeInput)[0]),['activityStart','audio','audio','activityEnd']);
 socket.message(JSON.stringify({voiceActivity:{type:'ACTIVITY_END'}}));socket.message(JSON.stringify({serverContent:{inputTranscription:{text:'fixture-private-transcript'},turnComplete:true,waitingForInput:false},usageMetadata:{private:'fixture-private'},private:'fixture-private'}));await flush();const state=session.sttSnapshot();assert.equal(state.voiceStarts,1);assert.equal(state.voiceEnds,1);assert.equal(state.messagesAfterEnd,2);assert.equal(state.setupMessages,1);assert.equal(state.resumptionMessages,1);assert.equal(state.serverContentMessages,1);assert.equal(state.usageMessages,1);assert.equal(state.pcmDurationMs,.125);assert.ok(state.audioEndMs>=state.lastAudioMs);assert.ok(state.firstServerAfterEndMs>=state.audioEndMs);assert.ok(state.sendIntervalMaxMs>=state.sendIntervalMinMs);
 const event=packets.filter(p=>p.stage==='server-message').at(-1);assert.deepEqual(event.serverEventTypes,['serverContent','usageMetadata']);assert.equal(event.afterAudioEnd,true);assert.equal(event.turnComplete,true);assert.ok(!JSON.stringify(packets).includes('private'));session.close();assert.equal(packets.at(-1).stage,'socket-close');assert.equal(packets.at(-1).localClose,true);
});
test('mensagem recebida antes de endAudio, mas parseada depois, não conta como resposta ao fim',async t=>{
 const {session,instances}=transport(t,{mode:'dictation'}),opening=session.open(),socket=instances[0];socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));await opening;session.sendAudio(new Uint8Array([0,64]));socket.message(new Blob([JSON.stringify({voiceActivity:{type:'ACTIVITY_START'}})]));session.endAudio();await flush();assert.equal(session.sttSnapshot().messagesAfterEnd,0);socket.message(JSON.stringify({voiceActivity:{type:'ACTIVITY_END'}}));await flush();assert.equal(session.sttSnapshot().messagesAfterEnd,1);session.close();
});
test('pool separa modelo, voz, instrução e JSON; retire remove sessão',async t=>{
 const {options,instances}=transport(t),manager=new sessions.LiveSessionManager();t.after(()=>manager.closeAll());
 async function acquire(override={}){const pending=manager.acquire({...options,...override}),socket=instances.at(-1);socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));const session=await pending;manager.release(session);return session;}
 const original=await acquire();
 for(const override of [{voiceName:'Puck'},{systemInstruction:'Outra instrução.'},{modelId:'gemini-3.8-live-extended-thinking',thinkingLevel:'low'},{jsonMode:'override',advancedJson:{setup:{outputAudioTranscription:{}}}}]){const changed=await acquire(override);assert.notEqual(changed,original);assert.deepEqual(JSON.parse(changed.socket.sent[0]),config.buildLiveSessionConfig({...options,...override}));}
 const reused=await manager.acquire({...options,jobId:'pool-next'});assert.equal(reused,original);assert.equal(reused.handler,null);manager.retire(reused);assert.equal(reused.closed,true);assert.equal([...manager.pool.values()].flat().includes(reused),false);
});
test('Extended não conclui utterance IN_PROGRESS antes de IDLE',async t=>{
 const {session,instances}=transport(t);session.options.modelId='gemini-3.8-live-extended-thinking';session.options.thinkingLevel='low';const opening=session.open(),socket=instances[0];socket.open();await flush();socket.message(JSON.stringify({setupComplete:{}}));await opening;
 let completed=false;const turn=session.sendTurn('Teste de áudio.').then(result=>{completed=true;return result;});await flush();
 socket.message(JSON.stringify({serverContent:{turnComplete:true,interactionStatus:'IN_PROGRESS'}}));await flush();assert.equal(completed,false);
 socket.message(JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAA='}}]},turnComplete:true,interactionStatus:'IDLE'}}));const result=await turn;assert.equal(result.chunks.length,1);session.close();
});
test('erro durante close de socket ainda conectando não causa recursão',async t=>{
 const {session,instances}=transport(t),opening=session.open(),socket=instances[0];let closes=0;
 socket.close=()=>{closes++;socket.onerror();};
 socket.onerror();
 await assert.rejects(opening,/Falha de rede/);assert.equal(closes,1);assert.equal(session.closed,true);
});
test('offscreen encerra payload rejeitado sem repetir em nove chaves/modelos',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),messages=[],sockets=[];let listener;
 class Socket{
  constructor(){this.readyState=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}
  send(){queueMicrotask(()=>{this.readyState=3;this.onclose({code:1007,reason:'Request contains an invalid argument.'});});}
  close(){this.readyState=3;}
 }
 class AudioContext{
  constructor(){this.audioWorklet={async addModule(){}};this.destination={};}
  createGain(){return{gain:{value:1},connect(){return this;}};}
  async resume(){}async close(){}
 }
 class AudioWorkletNode{constructor(){this.port={postMessage(){}};}connect(node){return node;}}
 const context=vm.createContext({console,performance,structuredClone,WebSocket:Socket,AudioContext,AudioWorkletNode,AbortController,TextDecoder,Blob,atob,btoa,setTimeout,clearTimeout,setInterval(){return 0;},clearInterval(){},chrome:{runtime:{getURL:file=>'chrome-extension://test/'+file,onMessage:{addListener(fn){listener=fn;}},sendMessage(message){messages.push(message);return Promise.resolve();}}}});
 for(const file of ['live-config.js','live-session-manager.js','offscreen.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 const payload={operation:'TTS_LIVE_START',tabId:0,playerId:'p',requestId:'r',jobId:'j',modelId:'gemini-3.8-live',models:['gemini-3.8-live','gemini-3.8-live-extended-thinking'],apiKeys:Array.from({length:9},(_,i)=>'secret-'+i),text:'Teste de áudio.'};
 const started=await new Promise(resolve=>listener({type:'TTS_OFFSCREEN_COMMAND',target:'offscreen',payload},{},resolve));assert.equal(started.success,true);await flush();await flush();
 assert.equal(sockets.length,1);assert.equal(messages.filter(message=>message.payload.event==='ranking').length,1);assert.equal(messages.find(message=>message.payload.event==='ranking').payload.result,'REQUEST');assert.ok(messages.some(message=>message.payload.event==='error'));assert.ok(!JSON.stringify(messages).includes('secret-'));
});
