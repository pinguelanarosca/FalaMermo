const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const config=require('../live-config.js'),sessions=require('../live-session-manager.js'),source=fs.readFileSync(require.resolve('../content.js'),'utf8'),flush=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function contentEnv({slowMic=false,slowModule=false,slowStart=false,diagnostics=false}={}){
 const events={},states=[],messages=[],streams=[],contexts=[],nodes=[],timers=new Map(),errors=[];const micReady=deferred(),startReady=deferred(),moduleReady=deferred();
 class Input{constructor(value='original'){this._value=value;this.selectionStart=0;this.selectionEnd=0;this.isConnected=true;this.events=[];}get value(){return this._value;}set value(v){this._value=v;this.nativeWrites=(this.nativeWrites||0)+1;}focus(){doc.activeElement=this;}dispatchEvent(e){this.events.push(e.type);}getRootNode(){return{};}}
 class Textarea extends Input{get value(){return super.value;}set value(v){super.value=v;}}
 const input=new Textarea(),other=new Textarea('outro'),doc={activeElement:input,addEventListener(name,fn){events[name]=fn;},createTextNode:text=>({text}),createRange(){throw Error('range não configurado');}};
 const hud={init(){},setStatus:(kind,label)=>states.push([kind,label]),setTextPreview(text){this.preview=text;},show(){}};
 function stream(){const track={stopped:false,stop(){this.stopped=true;}};const item={track,getTracks:()=>[track]};streams.push(item);return item;}
 class AudioContext{constructor(){this.sampleRate=48000;this.state='suspended';this.destination={};this.audioWorklet={addModule:()=>slowModule?moduleReady.promise:Promise.resolve()};contexts.push(this);}createMediaStreamSource(){return{connect:x=>x,disconnect(){}};}createGain(){return{gain:{value:1},connect:x=>x,disconnect(){}};}async resume(){this.state='running';}async close(){this.state='closed';}}
 class Node{constructor(){nodes.push(this);this.port={postMessage:msg=>{if(msg.type==='flush')this.port.onmessage({data:{type:'flushed'}});}};}connect(x){return x;}disconnect(){this.disconnected=true;}}
 const runtime={id:'test-extension',invalid:false,getManifest(){if(this.invalid)throw Error('Extension context invalidated.');return{manifest_version:3};},getURL(x){if(this.invalid)throw Error('Extension context invalidated.');return x;},sendMessage(msg){messages.push(msg);if(this.invalid||this.throwOn===msg.type)throw Error('Extension context invalidated.');if(this.rejectOn===msg.type)return Promise.reject(Error('Extension context invalidated.'));if(msg.type==='STT_LIVE_START'&&slowStart)return startReady.promise;return Promise.resolve({success:true});}};
 const context=vm.createContext({console:{...console,error:(...args)=>errors.push(args)},Event,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,document:doc,window:{getSelection:()=>null,addEventListener(name,fn){events[name]=fn;}},navigator:{mediaDevices:{getUserMedia:async()=>slowMic?micReady.promise:stream()}},AudioContext,AudioWorkletNode:Node,Float32Array,Int16Array,Uint8Array,setTimeout,clearTimeout,setInterval:fn=>{const id=Symbol();timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),btoa,crypto:require('node:crypto').webcrypto,chrome:{runtime}});
 vm.runInContext(fs.readFileSync(require.resolve('../dictation-runtime.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(require.resolve('../stt-realtime.js'),'utf8'),context);
 if(diagnostics)vm.runInContext(fs.readFileSync(require.resolve('../live-stt-diagnostics.js'),'utf8'),context);
 vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),context);
 const cache={'extension/src/content/ui/hudController.ts':{exports:{hud}},'extension/src/services/diagnosticLogger.ts':{exports:{logDiagnostic:async()=>{}}}};
 function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};context.modules[id](m,m.exports,load);return m.exports;}
 const injector=load('extension/src/content/dom/inputInjector.ts'),stt=load('extension/src/content/controllers/sttController.ts').stt;
 return{stt,injector,input,other,doc,events,states,messages,streams,contexts,nodes,micReady,startReady,moduleReady,stream,context,hud,runtime,timers,load,errors};
}
function assertInvalidated(e){assert.equal(e.stt.liveJobId,null);assert.equal(e.stt.isRecording,false);assert.equal(e.timers.size,0);assert.ok(e.streams.every(s=>s.track.stopped));assert.ok(e.contexts.every(c=>c.state==='closed'));assert.equal(e.states.at(-1)[1],'Atualize a página');assert.match(e.hud.preview,/F5/);}
test('toggle realtime controla PCM/VAD; OFF mantém formato antigo, ambos enviam antes do Stop',async()=>{
 for(const realtime of [false,true]){const e=contentEnv();e.stt.insertionMode=realtime?'realtime':'final';await e.stt.startLiveRecording('custom');const start=e.messages.find(m=>m.type==='STT_LIVE_START');assert.equal(start.payload.realtime,realtime);assert.equal(start.payload.agentId,'custom');const input=new Float32Array(4800).fill(.1);e.nodes[0].port.onmessage({data:input.buffer});await flush();const packet=e.messages.find(m=>m.type==='STT_LIVE_AUDIO');assert.ok(packet);assert.equal(!!packet.payload.chunk,realtime);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'),false);if(realtime){for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await flush();await e.stt.liveCapture.audioQueue.drain();assert.ok(e.messages.some(m=>m.payload?.endOnly&&m.payload.chunk.cutReason==='silence'));}e.stt.cancelRecording();await flush();assert.equal(e.streams[0].track.stopped,true);}
});
test('página antiga não abre microfone nem envia mensagens; página nova opera',async()=>{
 const old=contentEnv();old.runtime.invalid=true;await old.stt.toggleRecording('narrator');assertInvalidated(old);assert.equal(old.streams.length,0);assert.equal(old.messages.length,0);
 const fresh=contentEnv();await fresh.stt.toggleRecording('narrator');assert.equal(fresh.stt.isRecording,true);fresh.stt.cancelRecording();await flush();
});
test('cancelamento/pagehide suporta sendMessage lançando erro síncrono e libera recursos',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.runtime.throwOn='STT_LIVE_CANCEL';assert.doesNotThrow(()=>e.events.pagehide());await flush();assertInvalidated(e);
});
test('rejeição durante START é tratada sem repetir mensagens em contexto inválido',async()=>{
 const e=contentEnv();e.runtime.rejectOn='STT_LIVE_START';await e.stt.toggleRecording('narrator');await flush();assertInvalidated(e);assert.deepEqual(e.messages.map(m=>m.type),['STT_LIVE_START']);
});
test('PCM rejeitado encerra captura e descarta PCM/final tardios sem rejeição não tratada',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration,queuedCallback=e.nodes[0].port.onmessage;e.runtime.rejectOn='STT_LIVE_AUDIO';e.runtime.throwOn='STT_LIVE_CANCEL';
 queuedCallback({data:new Float32Array([.1,.2,.3]).buffer});await flush();await flush();assertInvalidated(e);const count=e.messages.length;assert.equal(e.nodes[0].port.onmessage,null);
 queuedCallback({data:new Float32Array([.2]).buffer});await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'tardio'});assert.equal(e.messages.length,count);assert.equal(e.input.value,'original');
});
test('invalidação silenciosa durante captura encerra microfone sem reconexão',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');assert.equal(e.timers.size,1);e.runtime.invalid=true;for(const fn of [...e.timers.values()])fn();await flush();assertInvalidated(e);assert.equal(e.messages.filter(m=>m.type.startsWith('STT_LIVE_')).length,1);
});
test('final entregue após contexto invalidado não insere transcrição',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.runtime.invalid=true;await e.stt.handleLiveEvent({jobId:e.stt.liveJobId,generation:e.stt.liveGeneration,event:'stt-final',text:'tardio'});assertInvalidated(e);assert.equal(e.input.value,'original');
});
test('cancelamento enquanto final aguarda close impede inserção atrasada',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const closing=deferred();e.contexts[0].close=()=>{e.contexts[0].state='closed';return closing.promise;};
 const final=e.stt.handleLiveEvent({jobId:e.stt.liveJobId,generation:e.stt.liveGeneration,event:'stt-final',text:'tardio'});e.stt.cancelRecording();closing.resolve();await final;assert.equal(e.input.value,'original');assert.equal(e.stt.isRecording,false);
});
test('STOP rejeitado por invalidação limpa job e não tenta CANCEL inválido',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});await flush();e.runtime.rejectOn='STT_LIVE_STOP';await e.stt.stopLiveRecording();await flush();assertInvalidated(e);assert.deepEqual(e.messages.filter(m=>m.type.startsWith('STT_LIVE_')).map(m=>m.type),['STT_LIVE_START','STT_LIVE_AUDIO','STT_LIVE_STOP']);
});
test('getURL invalidado entre setup e worklet encerra stream sem reabrir sessão',async()=>{
 const e=contentEnv();e.runtime.getURL=()=>{throw Error('Extension context invalidated.');};await e.stt.startLiveRecording('narrator');await flush();assertInvalidated(e);assert.equal(e.nodes.length,0);assert.deepEqual(e.messages.map(m=>m.type),['STT_LIVE_START']);
});
test('erro de API diferente de invalidação continua visível e libera microfone',async()=>{
 const e=contentEnv();e.runtime.sendMessage=()=>Promise.reject(Error('Falha de conexão sintética'));await e.stt.startLiveRecording('narrator');await flush();assert.equal(e.stt.contextInvalidated,false);assert.equal(e.stt.isRecording,false);assert.equal(e.streams[0].track.stopped,true);assert.match(e.hud.preview,/Falha de conexão sintética/);assert.equal(e.errors.length,1);
});
function loadEntrypoint(e,storage){
 e.doc.readyState='loading';e.runtime.onMessage={addListener(fn){e.messageListener=fn;}};
 const deps={'extension/src/content/ui/hudController.ts':{hud:e.hud},'extension/src/content/controllers/ttsController.ts':{tts:{setVolume(){},setSpeed(){},stop(){}}},'extension/src/content/controllers/sttController.ts':{stt:e.stt},'extension/src/content/controllers/lensController.ts':{lens:{}},'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:storage},'extension/src/content/styles/hud.css?raw':{default:''}};
 const m={exports:{}};e.context.modules['extension/src/content/entrypoint.ts'](m,m.exports,id=>deps[id]||e.load(id));
}
test('DOMContentLoaded tardio após recarga não lê storage nem registra mensagens',()=>{
 const e=contentEnv();let reads=0;loadEntrypoint(e,{get(){reads++;return Promise.resolve({});},subscribe(){}});e.runtime.invalid=true;assert.doesNotThrow(()=>e.events.DOMContentLoaded());assert.equal(reads,0);assert.equal(e.messageListener,undefined);assertInvalidated(e);
});
test('leituras iniciais rejeitadas são tratadas e HUD pede atualização',async()=>{
 const e=contentEnv();loadEntrypoint(e,{get:()=>Promise.reject(Error('Extension context invalidated.')),subscribe(){}});e.events.DOMContentLoaded();await flush();assertInvalidated(e);
});
test('HUD e listener STT tratam Promises rejeitadas pelos controladores',async()=>{
 for(const action of ['hud','message']){
  const e=contentEnv();loadEntrypoint(e,{get:()=>Promise.resolve({}),subscribe(){}});e.events.DOMContentLoaded();await flush();
  if(action==='hud'){e.stt.toggleRecording=()=>Promise.reject(Error('Extension context invalidated.'));e.hud.onRecordClick();}
  else{e.stt.handleLiveEvent=()=>Promise.reject(Error('Extension context invalidated.'));e.messageListener({type:'STT_LIVE_EVENT',payload:{}},{},()=>{});}
  await flush();assertInvalidated(e);
 }
});
test('sendResponse invalidado no listener STT é tratado sem exceção síncrona',async()=>{
 const e=contentEnv();loadEntrypoint(e,{get:()=>Promise.resolve({}),subscribe(){}});e.events.DOMContentLoaded();await flush();assert.doesNotThrow(()=>e.messageListener({type:'STT_LIVE_EVENT',payload:{}},{},()=>{throw Error('Extension context invalidated.');}));await flush();assertInvalidated(e);
});
test('callback Chrome storage com lastError invalidado rejeita leitura em vez de lançar',async()=>{
 const e=contentEnv();let reply;e.context.chrome.storage={local:{get(_keys,callback){reply=callback;}}};const storage=e.load('extension/src/services/storage/chromeStorageAdapter.ts').chromeStorage;
 const read=storage.get('ui'),checked=assert.rejects(read,/Extension context invalidated/);Object.defineProperty(e.runtime,'lastError',{get(){throw Error('Extension context invalidated.');}});assert.doesNotThrow(()=>reply({}));await checked;
});
test('erro seguido de CANCEL invalidado mantém orientação F5, não sobrescreve com Erro STT',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.runtime.throwOn='STT_LIVE_CANCEL';await e.stt.handleLiveEvent({jobId:e.stt.liveJobId,generation:e.stt.liveGeneration,event:'stt-error',error:'Falha sintética de conexão'});await flush();assertInvalidated(e);
});
test('invalidação durante aquisição do microfone descarta stream tardio sem enviar START',async()=>{
 const e=contentEnv({slowMic:true}),starting=e.stt.startLiveRecording('narrator');e.runtime.invalid=true;for(const fn of [...e.timers.values()])fn();const stream=e.stream();e.micReady.resolve(stream);await starting;assertInvalidated(e);assert.equal(e.messages.length,0);
});
test('final anterior conserva seu alvo enquanto novo job grava em outro campo',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration,oldPcm=e.nodes[0].port.onmessage,closing=deferred();e.contexts[0].close=()=>{e.contexts[0].state='closed';return closing.promise;};
 const oldFinal=e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'antigo'});e.doc.activeElement=e.other;await e.stt.startLiveRecording('narrator');const newJob=e.stt.liveJobId,count=e.messages.length,lastState=e.states.at(-1);
 oldPcm({data:new Float32Array([.1]).buffer});await e.stt.handleLiveEvent({jobId,generation,event:'stt-error',error:'tardio'});await e.stt.handleLiveEvent({jobId,generation,event:'stt-partial',text:'tardio'});closing.resolve();await oldFinal;
 assert.equal(e.stt.liveJobId,newJob);assert.equal(e.streams[1].track.stopped,false);assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_AUDIO').length,0);assert.equal(e.states.at(-1),lastState);assert.equal(e.input.value,'Antigooriginal');assert.equal(e.other.value,'outro');e.stt.cancelRecording();await flush();assert.equal(e.streams[1].track.stopped,true);assert.equal(e.timers.size,0);
});
test('rejeição tardia de CANCEL não altera HUD ou recursos de novo job',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');let reject;const send=e.runtime.sendMessage.bind(e.runtime);e.runtime.sendMessage=msg=>msg.type==='STT_LIVE_CANCEL'?new Promise((_r,j)=>reject=j):send(msg);e.stt.cancelRecording();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,lastState=e.states.at(-1);
 reject(Error('Falha sintética de cancelamento'));await flush();assert.equal(e.stt.liveJobId,jobId);assert.equal(e.streams[1].track.stopped,false);assert.equal(e.states.at(-1),lastState);assert.equal(e.errors.length,1);e.runtime.sendMessage=send;e.stt.cancelRecording();await flush();
});
test('HUD perde foco mas ditado conserva campo original/seleção zero e emite eventos',async()=>{
 const e=contentEnv();e.events.focusin();e.doc.activeElement={getRootNode:()=>({host:{id:'ext-tts-stt-host'}})};
 await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;e.doc.activeElement=e.other;
 await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'Ditado'});
 assert.equal(e.input.value,'Ditadooriginal');assert.equal(e.other.value,'outro');assert.equal(e.input.nativeWrites,1);assert.deepEqual(e.input.events,['beforeinput','input','change']);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.isRecording,false);assert.match(e.states.at(-1)[1],/texto inserido/);
});
test('seleção original é substituída e setter nativo evita valor interceptado',()=>{
 const e=contentEnv();e.input.selectionStart=0;e.input.selectionEnd=8;const saved=e.injector.captureDictationTarget();let interception=0;Object.defineProperty(e.input,'value',{get:()=>e.input._value,set:()=>interception++});e.input.selectionStart=5;e.input.selectionEnd=5;
 assert.equal(e.injector.injectTranscribedText('novo',undefined,e.input,saved),true);assert.equal(e.input.value,'Novo');assert.equal(interception,0);
 e.input.isConnected=false;assert.equal(e.injector.injectTranscribedText('não inserir',undefined,e.input,saved),false);
});
test('contenteditable usa range salvo e nunca modifica seleção de outro editor',()=>{
 const e=contentEnv(),original={text:'a'},foreign={text:'b'},changes=[];const editor={isContentEditable:true,isConnected:true,contains:n=>n===original,focus(){},dispatchEvent:()=>changes.push('input')};
 const range={startContainer:original,endContainer:original,cloneRange(){return this;},deleteContents(){changes.push('delete original');},insertNode:n=>changes.push(n.text),setStartAfter(){},collapse(){}};
 e.context.window.getSelection=()=>({rangeCount:1,getRangeAt:()=>({startContainer:foreign,endContainer:foreign,deleteContents(){throw Error('não deve modificar outro editor');}}),removeAllRanges(){},addRange:r=>assert.equal(r,range)});
 assert.equal(e.injector.injectTranscribedText('ditado',undefined,editor,{range}),true);assert.deepEqual(changes,['delete original','Ditado','input']);
});
test('cancelamento libera trilhas/contexto e descarta final tardio',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;e.stt.cancelRecording();await flush();
 assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.nodes[0].disconnected,true);assert.equal(e.stt.isRecording,false);assert.equal(e.stt.liveCapture,null);
 await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'tardio'});assert.equal(e.input.value,'original');assert.ok(e.messages.some(m=>m.type==='STT_LIVE_CANCEL'));
});
test('erro Live enquanto grava libera microfone/contexto e cancela sessão',async()=>{const e=contentEnv();await e.stt.startLiveRecording('narrator');await e.stt.handleLiveEvent({jobId:e.stt.liveJobId,generation:e.stt.liveGeneration,event:'stt-error',error:'conexão perdida'});assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.isRecording,false);assert.equal(e.stt.liveJobId,null);assert.equal(e.states.at(-1)[1],'Erro STT');});
test('falha no AudioContext durante início encerra trilhas e cancela sessão',async()=>{const e=contentEnv();e.context.AudioContext.prototype.resume=async()=>{throw Error('contexto indisponível');};await e.stt.startLiveRecording('narrator');assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.liveJobId,null);assert.equal(e.stt.isRecording,false);assert.ok(e.messages.some(m=>m.type==='STT_LIVE_CANCEL'));});
test('campo removido mantém texto no HUD e não anuncia inserção bem-sucedida',async()=>{const e=contentEnv();await e.stt.startLiveRecording('narrator');e.input.isConnected=false;await e.stt.handleLiveEvent({jobId:e.stt.liveJobId,generation:e.stt.liveGeneration,event:'stt-final',text:'Texto sintético'});assert.equal(e.input.value,'original');assert.match(e.hud.preview,/Copie a transcrição/);assert.match(e.states.at(-1)[1],/texto não inserido/);assert.equal(e.streams[0].track.stopped,true);});
test('cancelamento durante getUserMedia encerra stream que chega depois',async()=>{
 const e=contentEnv({slowMic:true}),starting=e.stt.startLiveRecording('narrator');e.stt.cancelRecording();const stream=e.stream();e.micReady.resolve(stream);await starting;assert.equal(stream.track.stopped,true);assert.equal(e.contexts.length,0);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_START'),false);
});
test('cancelamento durante setup/worklet impede inicialização atrasada',async()=>{
 for(const phase of ['start','module']){const e=contentEnv({slowStart:phase==='start',slowModule:phase==='module'}),starting=e.stt.startLiveRecording('narrator');await flush();e.stt.cancelRecording();if(phase==='start')e.startReady.resolve({success:true});else e.moduleReady.resolve();await starting;assert.equal(e.streams[0].track.stopped,true);assert.equal(e.stt.isRecording,false);assert.equal(e.nodes.length,0);if(e.contexts.length)assert.equal(e.contexts[0].state,'closed');}
});
test('parada envia PCM pendente antes de STOP e libera microfone antes do final',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;await e.stt.stopLiveRecording();
 assert.deepEqual(e.messages.filter(m=>m.type.startsWith('STT_LIVE_')).map(m=>m.type),['STT_LIVE_START','STT_LIVE_AUDIO','STT_LIVE_STOP']);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.isRecording,false);assert.equal(e.stt.liveJobId,null);assert.equal(e.stt.liveJobs.has(jobId),true);
 await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'Ditado'});assert.equal(e.stt.liveJobId,null);assert.match(e.states.at(-1)[1],/Parado/);
});
test('botão Parar do HUD finaliza STT ativo; não apenas TTS',()=>{
 const start=source.indexOf('    hudController_1.hud.onStopClick ='),end=source.indexOf('    hudController_1.hud.onCloseClick',start),calls=[],hud={};
 vm.runInNewContext(source.slice(start,end),{hudController_1:{hud},sttController_1:{stt:{isRecording:true,stopLiveRecording:()=>calls.push('stt-stop')}},ttsController_1:{tts:{stop:()=>calls.push('tts-stop')}}});hud.onStopClick();assert.deepEqual(calls,['stt-stop']);
});
function offscreenEnv(acquire){const events=[],attempts=[],timers=new Map();let listener,id=0;const retired=[];
 const context=vm.createContext({console,performance,structuredClone,AbortController,Uint8Array,setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout:i=>timers.delete(i),LiveConfig:config,LiveSessions:{classifyLiveError:sessions.classifyLiveError,decodeBase64:sessions.decodeBase64,LiveSessionManager:class{async acquire(o){attempts.push(o);return acquire(o);}retire(s){retired.push(s);}release(){}}},chrome:{runtime:{getURL:x=>x,onMessage:{addListener:fn=>listener=fn},sendMessage:m=>{events.push(m.payload);return Promise.resolve();}}}});
 const runtimeSend=context.chrome.runtime.sendMessage;context.chrome.runtime.sendMessage=message=>message.type==='LIVE_OFFSCREEN_EVENT'?runtimeSend(message):Promise.resolve();
 vm.runInContext(fs.readFileSync(require.resolve('../offscreen.js'),'utf8'),context);
 return{events,attempts,retired,timers,command:p=>new Promise(r=>listener({type:'LIVE_OFFSCREEN_COMMAND',target:'offscreen',payload:p},{},r)),expire(){for(const [id,t]of [...timers]){timers.delete(id);t.fn();}}};
}
const base={jobId:'test',modelId:'gemini-3.8-live',operation:'STT_LIVE_START',apiKeys:['fake-only']};
test('turnComplete sem transcript não fecha antes de inputTranscription independente',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);await e.command(base);await e.command({...base,operation:'STT_LIVE_AUDIO',audioBase64:'AAA=',sampleRate:16000});await e.command({...base,operation:'STT_LIVE_STOP'});
 session.handler({serverContent:{turnComplete:true}});
 for(const [id,timer]of [...e.timers])if(timer.ms<=900){e.timers.delete(id);timer.fn();}await flush();assert.equal(e.retired.length,0);assert.equal(e.events.some(x=>x.event==='stt-error'),false);
 session.handler({serverContent:{inputTranscription:{text:'Teste de ditado.'}}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final')?.text,'Teste de ditado.');
});
test('inputTranscription independente de turnComplete aguarda conclusão sem fechar em 900 ms',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);await e.command(base);await e.command({...base,operation:'STT_LIVE_AUDIO',audioBase64:'AAA='});await e.command({...base,operation:'STT_LIVE_STOP'});
 session.handler({serverContent:{inputTranscription:{text:'Teste'}}});assert.ok([...e.timers.values()].every(t=>t.ms===15000));session.handler({serverContent:{inputTranscription:{text:' de ditado.'},turnComplete:true}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final').text,'Teste de ditado.');
});
test('interim isolado não é promovido a final e timeout não anuncia ausência de PCM',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);await e.command(base);await e.command({...base,operation:'STT_LIVE_AUDIO',audioBase64:'AAA='});session.handler({serverContent:{interimInputTranscription:{text:'provisório'}}});await e.command({...base,operation:'STT_LIVE_STOP'});e.expire();await flush();assert.equal(e.events.some(x=>x.event==='stt-final'),false);assert.match(e.events.find(x=>x.event==='stt-error').error,/provisória|parcial/i);
});
test('PCM ausente e PCM enviado sem texto têm mensagens diferentes',async()=>{
 for(const audio of [false,true]){const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);await e.command(base);if(audio)await e.command({...base,operation:'STT_LIVE_AUDIO',audioBase64:'AAA='});await e.command({...base,operation:'STT_LIVE_STOP'});e.expire();await flush();assert.match(e.events.find(x=>x.event==='stt-error').error,audio?/PCM enviado ao Gemini/:/Nenhum PCM chegou/);}
});
test('diagnóstico HUD diferencia ausência de frames e PCM com sinal, sem áudio/texto privado',async()=>{
 for(const audio of [false,true]){const e=contentEnv({diagnostics:true});await e.stt.startLiveRecording('narrator');const capture=e.stt.liveCapture;if(audio)e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});await e.stt.stopLiveRecording();await flush();
 const packets=e.messages.filter(m=>m.type==='LIVE_STT_DIAGNOSTIC').map(m=>m.payload),released=packets.filter(p=>p.stage==='capture-released').at(-1);
 assert.equal(released.released,true);assert.equal(released.flushAcknowledged,true);assert.equal(released.contextState,'closed');assert.equal(released.capturedFrames,audio?3:0);assert.equal(released.ackBytes,audio?2:0);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'),audio);
 if(audio){assert.ok(released.peak>0);assert.ok(released.maxRms>0);assert.ok(released.signalSamples>0);e.stt.cancelRecording();}else assert.equal(e.states.at(-1)[1],'Nenhum PCM capturado');
 assert.ok(packets.every(p=>!('audioBase64'in p)&&!('text'in p)&&!('apiKey'in p)));await flush();}
});
test('diagnóstico persistido é limitado, expira e descarta campos privados arbitrários',async()=>{
 const sent=[],store={},context=vm.createContext({console,chrome:{runtime:{sendMessage:async m=>sent.push(m)},storage:{session:{get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,value)}}}});vm.runInContext(fs.readFileSync(require.resolve('../live-stt-diagnostics.js'),'utf8'),context);const diag=context.LiveSttDiagnostics;
 for(let n=0;n<10;n++){const jobId='00000000-0000-4000-8000-'+String(n).padStart(12,'0');for(let i=0;i<45;i++)await diag.record({jobId,scope:'capture',stage:'capture-progress',capturedFrames:i,apiKey:'private-credential',audioBase64:'private-audio',text:'private-transcript',instructions:'private-instructions'});}
 const snapshot=await diag.read();assert.equal(snapshot.jobs.length,8);assert.ok(snapshot.jobs.every(j=>j.events.length===40));assert.ok(!JSON.stringify(snapshot).includes('private-'));assert.equal(diag.sanitize({jobId:'malicious text',scope:'capture',stage:'capture-progress'}),null);
 const stale=structuredClone(snapshot);stale.jobs.forEach(j=>j.updatedAt=Date.now()-86400001);assert.equal(diag.clean(stale).jobs.length,0);
 await diag.emit({jobId:'00000000-0000-4000-8000-000000000000',scope:'transport',stage:'audio-sent',sentBytes:3200,audioBase64:'private-audio'});assert.equal(sent[0].payload.sentBytes,3200);assert.equal(sent[0].payload.audioBase64,undefined);
 const event=diag.sanitize({jobId:'00000000-0000-4000-8000-000000000000',scope:'transport',stage:'server-message',serverEventTypes:['serverContent','private-text','serverContent'],serverContentTypes:['inputTranscription','private-instructions'],messagesAfterEnd:2,elapsedMs:900});assert.deepEqual(Array.from(event.serverEventTypes),['serverContent']);assert.deepEqual(Array.from(event.serverContentTypes),['inputTranscription']);assert.equal(event.messagesAfterEnd,2);assert.ok(!JSON.stringify(event).includes('private'));
});
test('PCM do HUD e opções preserva sinal e taxa em chunks a 44,1/48 kHz e Int16 LE',()=>{
 const optionsSource=fs.readFileSync(require.resolve('../options.js'),'utf8'),ctx=vm.createContext({Int16Array,Uint8Array});vm.runInContext(optionsSource.slice(optionsSource.indexOf('function resampleLiveTest('),optionsSource.indexOf('async function releaseLiveSttTest(')),ctx);
 for(const rate of [16000,44100,48000]){const e=contentEnv(),state={cursor:0,previous:0};e.stt.resampleCursor=0;e.stt.resamplePrevious=0;let samples=0,peak=0,total=0;for(let offset=0;offset<rate;){const length=Math.min(128,rate-offset),input=Float32Array.from({length},(_,i)=>.5*Math.sin(2*Math.PI*440*(offset+i)/rate)),hud=e.stt.resamplePcm16(input,rate,16000),options=ctx.resampleLiveTest(input,rate,state);assert.deepEqual([...hud],[...options]);const view=new DataView(hud.buffer,hud.byteOffset,hud.byteLength);for(let i=0;i<hud.length;i+=2){const value=view.getInt16(i,true)/32768;peak=Math.max(peak,Math.abs(value));total+=value*value;samples++;}offset+=length;}
 // A fronteira fracionária de 44,1 kHz pode arredondar uma amostra; não aceitar deriva maior.
 assert.ok(Math.abs(samples-16000)<=1);assert.ok(peak>.49&&peak<=.501);assert.ok(Math.sqrt(total/samples)>.34);}
 const e=contentEnv();e.stt.resampleCursor=0;e.stt.resamplePrevious=0;assert.deepEqual([...e.stt.resamplePcm16(new Float32Array([-1,0,1]),16000,16000)],[0,128,0,0,255,127]);
});
test('diagnóstico separa sinal do worklet, PCM convertido e silêncio, sem identificadores do dispositivo',()=>{
 const diag=require('../live-stt-diagnostics.js'),capture={jobId:'00000000-0000-4000-8000-000000000000',stream:{getTracks:()=>[{readyState:'live',enabled:true,muted:false,getSettings:()=>({channelCount:1,sampleRate:48000,deviceId:'fixture-private-id',groupId:'fixture-private-group'})}]},context:{state:'running',sampleRate:48000}};
 diag.observe(capture,new Float32Array([.5,-.5]),new Uint8Array([0,64,0,192]));let packet=diag.captureSnapshot(capture,'capture-progress');assert.equal(packet.trackSampleRate,48000);assert.equal(packet.trackChannels,1);assert.equal(packet.pcmSamples,2);assert.equal(packet.pcmSignalSamples,2);assert.equal(packet.pcmPeak,.5);assert.equal(packet.pcmMaxRms,.5);assert.equal(packet.deviceId,undefined);assert.ok(!JSON.stringify(packet).includes('private'));
 const silent={jobId:capture.jobId};diag.observe(silent,new Float32Array([.5,.5]),new Uint8Array(4));packet=diag.captureSnapshot(silent,'capture-progress');assert.equal(packet.signalSamples,2);assert.equal(packet.pcmSignalSamples,0);assert.equal(packet.pcmPeak,0);assert.equal(packet.pcmMaxRms,0);
});
test('worklet mistura todos os canais e mantém cauda antes de flushed',()=>{
 let Processor;const packets=[],context=vm.createContext({sampleRate:48000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)};}},registerProcessor:(_id,p)=>Processor=p});vm.runInContext(fs.readFileSync(require.resolve('../mic-capture-worklet.js'),'utf8'),context);const worklet=new Processor();worklet.process([[new Float32Array([0,0]),new Float32Array([.4,.6])]]);worklet.port.onmessage({data:{type:'flush'}});assert.ok(Math.abs(new Float32Array(packets[0])[0]-.2)<1e-6);assert.ok(Math.abs(new Float32Array(packets[0])[1]-.3)<1e-6);assert.equal(packets[1].type,'flushed');
});
test('fila STT confirma 300 chunks (30s PCM16k) sem limite de duração ou descarte',async()=>{
 const {AudioQueue}=require('../dictation-runtime.js'),metrics={},sent=[];
 const queue=new AudioQueue({metrics,send:async packet=>{sent.push(packet.sequence);return{success:true};}});
 for(let i=0;i<300;i++)assert.equal(queue.push({sequence:i},3200),true);
 await queue.drain();assert.equal(sent.length,300);assert.deepEqual(sent,Array.from({length:300},(_,i)=>i));assert.equal(metrics.queuedBytes,960000);assert.equal(metrics.ackBytes,960000);assert.equal(metrics.ackChunks,300);assert.equal(metrics.pendingChunks,0);assert.equal(metrics.pendingBytes,0);
});
test('ACK bloqueado expira, preserva contadores pendentes e produz uma falha explícita',async()=>{
 const {AudioQueue}=require('../dictation-runtime.js'),metrics={},failures=[],sent=[];
 const queue=new AudioQueue({metrics,ackTimeoutMs:15,send:packet=>{sent.push(packet.sequence);return new Promise(()=>{});},onFailure:error=>failures.push(error.code)});
 queue.push({sequence:1},3200);queue.push({sequence:2},3200);
 await assert.rejects(queue.drain(),error=>error.code==='ACK_TIMEOUT');assert.deepEqual(sent,[1]);assert.deepEqual(failures,['ACK_TIMEOUT']);assert.equal(metrics.pendingChunks,2);assert.equal(metrics.pendingBytes,6400);assert.equal(metrics.ackChunks||0,0);assert.equal(metrics.ackTimeouts,1);assert.equal(queue.push({sequence:3},3200),false);
});
test('ACK atrasado é aguardado antes do próximo chunk e do drain',async()=>{
 const {AudioQueue}=require('../dictation-runtime.js'),gate=deferred(),order=[];const queue=new AudioQueue({send:async packet=>{order.push(packet.sequence);if(packet.sequence===1)await gate.promise;return{success:true};}});queue.push({sequence:1},2);queue.push({sequence:2},2);let drained=false;const draining=queue.drain().then(()=>drained=true);await flush();assert.deepEqual(order,[1]);assert.equal(drained,false);gate.resolve();await draining;assert.deepEqual(order,[1,2]);assert.equal(drained,true);
});
test('modo ao vivo substitui só intervalo do job, conserva prefixo/sufixo e consolida uma vez',async()=>{
 const e=contentEnv();e.input.value='Antes [seleção] depois';e.input.selectionStart=6;e.input.selectionEnd=15;const target=e.injector.captureDictationTarget(),insertion=new e.context.DictationRuntime.Insertion(target,{settleMs:0});e.doc.activeElement=e.other;
 assert.equal((await insertion.apply('fala pro')).inserted,true);assert.equal(e.input.value,'Antes fala pro depois');assert.equal(e.doc.activeElement,e.other);
 assert.equal((await insertion.apply('fala pronta')).inserted,true);assert.equal(e.input.value,'Antes fala pronta depois');
 const writes=e.input.nativeWrites;assert.equal((await insertion.apply('fala pronta',{final:true})).inserted,true);assert.equal(e.input.nativeWrites,writes);assert.equal((await insertion.apply('fala pronta',{final:true})).reason,'ALREADY_INSERTED');insertion.dispose();
});
test('edição manual, campo removido e outro documento impedem redirecionamento do ditado',async()=>{
 for(const change of ['manual','removed','document']){const e=contentEnv(),target=e.injector.captureDictationTarget(),insertion=new e.context.DictationRuntime.Insertion(target,{settleMs:0});e.doc.activeElement=e.other;if(change==='manual')e.input.value='Editado pelo usuário';if(change==='removed')e.input.isConnected=false;if(change==='document')e.input.ownerDocument={};const result=await insertion.apply('não inserir',{final:true});assert.equal(result.inserted,false);assert.equal(e.other.value,'outro');assert.equal(e.input.value,change==='manual'?'Editado pelo usuário':'original');insertion.dispose();}
});
test('editor controlado que reverte no render não é declarado inserido',async()=>{
 const e=contentEnv(),original=e.input.value,dispatch=e.input.dispatchEvent.bind(e.input);e.input.dispatchEvent=event=>{dispatch(event);if(event.type==='input')setTimeout(()=>{e.input._value=original;},0);};const insertion=new e.context.DictationRuntime.Insertion(e.injector.captureDictationTarget(),{settleMs:15});const result=await insertion.apply('fala final',{final:true});assert.equal(result.inserted,false);assert.equal(result.reason,'EDITOR_REVERTED');assert.equal(e.input.value,original);insertion.dispose();
});
test('contenteditable multilinha atualiza só a diferença e conserva espaço do sufixo e marcação',async()=>{
 const {Insertion}=require('../dictation-runtime.js'),calls=[];let nodes=[{textContent:'Antes '},{textContent:'seleção'},{textContent:' depois'}],multiline=false,selected;
 const other={isConnected:true,focus(){doc.activeElement=this;}},selection={removeAllRanges(){},addRange(range){selected=range;},rangeCount:0},doc={activeElement:other,defaultView:{getSelection:()=>selection},createTreeWalker(){let index=0;return{nextNode:()=>nodes[index++]};},createRange(){return{setStart(node,offset){this.startContainer=node;this.startOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}};},execCommand(_command,_ui,replacement){calls.push(replacement);if(replacement.includes('\n')){const [first,second]=replacement.split('\n');nodes=[nodes[0],{textContent:first},{textContent:second+' depois'}];multiline=true;}else{assert.equal(selected.startContainer,selected.endContainer,'não recriar parágrafos nem selecionar sufixo');const node=selected.startContainer;node.textContent=node.textContent.slice(0,selected.startOffset)+replacement+node.textContent.slice(selected.endOffset);}return true;}};
 const rich={isContentEditable:true,isConnected:true,ownerDocument:doc,get textContent(){return nodes.map(node=>node.textContent).join('');},get innerText(){return nodes[0].textContent+nodes[1].textContent+(multiline?'\n':'')+nodes[2].textContent;},focus(){doc.activeElement=this;},dispatchEvent:()=>true,addEventListener(){},removeEventListener(){}};
 const insertion=new Insertion({element:rich,document:doc,original:rich.textContent,originalVisual:rich.innerText,selectionStart:6,selectionEnd:13},{settleMs:0});
 assert.equal((await insertion.apply('primeira linha\nsegunda pro')).inserted,true);assert.equal((await insertion.apply('primeira linha\nsegunda linha',{final:true})).inserted,true);assert.deepEqual(calls,['primeira linha\nsegunda pro','linha']);assert.equal(rich.innerText,'Antes primeira linha\nsegunda linha depois');assert.equal(nodes[1].textContent,'primeira linha');assert.equal(doc.activeElement,other);insertion.dispose();
});
test('eventos repetidos não duplicam ao vivo/final e nunca usam o campo visualizador',async()=>{
 const e=contentEnv();e.stt.insertionMode='realtime';await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;e.doc.activeElement=e.other;
 await e.stt.handleLiveEvent({jobId,generation,eventSeq:1,event:'stt-partial',confirmedText:'',partialText:'fala pro',text:'fala pro'});assert.equal(e.input.value,'Fala prooriginal');
 await e.stt.handleLiveEvent({jobId,generation,eventSeq:2,event:'stt-partial',confirmedText:'',partialText:'fala pronta',text:'fala pronta'});assert.equal(e.input.value,'Fala prontaoriginal');
 const writes=e.input.nativeWrites;await e.stt.handleLiveEvent({jobId,generation,eventSeq:2,event:'stt-partial',text:'duplicado'});assert.equal(e.input.nativeWrites,writes);
 await e.stt.handleLiveEvent({jobId,generation,eventSeq:3,event:'stt-final',text:'fala pronta'});assert.equal(e.input.value,'Fala prontaoriginal');assert.equal(e.input.nativeWrites,writes);assert.equal(e.other.value,'outro');assert.equal(e.stt.getJobState(jobId).inserted,true);await e.stt.handleLiveEvent({jobId,generation,eventSeq:4,event:'stt-final',text:'duplicado'});assert.equal(e.input.nativeWrites,writes);
});
test('tempo real com transformação aguarda o resultado final do agente sem inserir áudio bruto',async()=>{
 const e=contentEnv(),send=e.runtime.sendMessage.bind(e.runtime);e.runtime.sendMessage=message=>message.type==='STT_LIVE_START'?Promise.resolve({success:true,transform:true}):send(message);e.stt.insertionMode='realtime';await e.stt.startLiveRecording('editor');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;await e.stt.handleLiveEvent({jobId,generation,event:'stt-partial',text:'provisório bruto'});assert.equal(e.input.value,'original');await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'transformado'});assert.equal(e.input.value,'Transformadooriginal');
});
test('navegação invalida alvo, finaliza áudio já capturado e não insere em documento novo',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});e.events.pagehide();await flush();await flush();assert.equal(e.streams[0].track.stopped,true);assert.ok(e.messages.some(message=>message.type==='STT_LIVE_STOP'));await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'resultado recuperável'});assert.equal(e.input.value,'original');assert.equal(e.stt.getJobState(jobId).reason,'TARGET_DOCUMENT_LOST');
});
test('cancelamento global individual limpa job antigo sem parar captura posterior ou reinserir final',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});await e.stt.stopLiveRecording();e.doc.activeElement=e.other;await e.stt.startLiveRecording('narrator');const latest=e.stt.liveJobId;await e.stt.handleLiveEvent({jobId,generation,event:'stt-cancelled'});await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'não inserir'});assert.equal(e.input.value,'original');assert.equal(e.other.value,'outro');assert.equal(e.stt.liveJobId,latest);assert.equal(e.streams[1].track.stopped,false);assert.equal(e.stt.getJobState(jobId).status,'cancelled');e.stt.cancelRecording();await flush();
});
test('Extended STT aguarda IDLE sem fechar durante IN_PROGRESS',async()=>{
 const session={endAudio(){}},e=offscreenEnv(async()=>session),payload={...base,modelId:'gemini-3.8-live-extended-thinking'};await e.command(payload);
 session.handler({serverContent:{inputTranscription:{text:'Teste de ditado.'},interactionStatus:'IN_PROGRESS'}});await e.command({...payload,operation:'STT_LIVE_STOP'});
 session.handler({serverContent:{turnComplete:true,interactionStatus:'IN_PROGRESS'}});assert.equal(e.events.some(x=>x.event==='stt-final'),false);assert.equal(e.retired.length,0);assert.ok([...e.timers.values()].every(x=>x.ms===90000));
 session.handler({serverContent:{interactionStatus:'IDLE'}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final').text,'Teste de ditado.');assert.equal(e.retired.length,1);
});
test('STT completo esgota nove chaves em cada modelo e não tenta unary/Translate',async()=>{
 const e=offscreenEnv(async()=>{throw Error('Quota exceeded');}),result=await e.command({...base,apiKeys:Array(9).fill('fake'),models:[...config.LIVE_MODEL_PRIORITY].reverse().concat('gemini-3.8-flash-tts','gemini-3.5-live-translate-preview')});assert.equal(result.success,false);assert.deepEqual(e.attempts.map(o=>[o.modelId,o.keyIndex]),config.LIVE_MODEL_PRIORITY.flatMap(model=>Array.from({length:9},(_,i)=>[model,i+1])));
});
test('STT nativo acumula inputTranscription parcial/final, ignora output/PCM e não cria player',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);assert.equal((await e.command(base)).success,true);
 session.handler({serverContent:{inputTranscription:{text:'Olá'}}});session.handler({serverContent:{inputTranscription:{text:' mundo'},outputTranscription:{text:'NÃO inserir'},modelTurn:{parts:[{inlineData:{data:'AAA='}}]}}});await flush();assert.equal(e.events.filter(x=>x.event==='stt-partial').at(-1).text,'Olá mundo');
 await e.command({...base,operation:'STT_LIVE_STOP'});session.handler({serverContent:{turnComplete:true}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final').text,'Olá mundo');assert.equal(e.events.some(x=>/play|pcm/.test(x.event)),false);assert.equal(e.retired.length,1);
});
test('fallback STT esgota nove chaves por modelo e respeita modelos compatíveis',async()=>{
 const e=offscreenEnv(async o=>{if(o.modelId===base.modelId)throw Error('Quota exceeded');return{endAudio(){}};});assert.equal((await e.command({...base,apiKeys:Array(9).fill('fake'),models:[base.modelId,'gemini-3.5-transcribe-live','gemini-3.5-flash-lite','gemini-3.5-live-translate-preview','gemini-3.8-live-extended-thinking']})).success,true);
 assert.deepEqual(e.attempts.map(o=>[o.modelId,o.keyIndex]),[...Array.from({length:9},(_,i)=>[base.modelId,i+1]),['gemini-3.8-live-extended-thinking',1]]);await e.command({...base,operation:'STT_LIVE_CANCEL'});
});
test('offscreen não abre sessão especializada mesmo em payload antigo direto',async()=>{const e=offscreenEnv(async()=>{throw Error('não deve conectar');}),result=await e.command({...base,modelId:'gemini-3.5-transcribe-live',models:['gemini-3.5-transcribe-live']});assert.equal(result.success,false);assert.equal(e.attempts.length,0);});
test('cancelamento STT durante acquire retira sessão tardia e não anuncia setup',async()=>{
 const pending=deferred(),session={},e=offscreenEnv(()=>pending.promise),started=e.command(base);await e.command({...base,operation:'STT_LIVE_CANCEL'});pending.resolve(session);assert.equal((await started).success,false);assert.equal(e.retired[0],session);assert.equal(e.events.some(x=>x.event==='setup-complete'),false);
});
test('worklet flush entrega cauda menor que 100 ms antes da confirmação',()=>{
 let Processor;const messages=[],context=vm.createContext({sampleRate:48000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},registerProcessor(_id,cls){Processor=cls;}});vm.runInContext(fs.readFileSync(require.resolve('../mic-capture-worklet.js'),'utf8'),context);const p=new Processor();p.process([[new Float32Array([.2,.4,.6])]]);assert.equal(messages.length,0);p.port.onmessage({data:{type:'flush'}});assert.equal(new Float32Array(messages[0]).length,3);assert.equal(messages[1].type,'flushed');p.port.onmessage({data:{type:'flush'}});assert.equal(messages.length,3);
});
