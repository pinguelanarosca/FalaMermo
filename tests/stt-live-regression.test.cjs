const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const config=require('../live-config.js'),sessions=require('../live-session-manager.js'),source=fs.readFileSync(require.resolve('../content.js'),'utf8'),flush=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function contentEnv({slowMic=false,slowModule=false,slowStart=false,diagnostics=false}={}){
 const events={},states=[],messages=[],streams=[],contexts=[],nodes=[],timers=new Map(),errors=[];const micReady=deferred(),startReady=deferred(),moduleReady=deferred();
 class Input{constructor(value='original'){this._value=value;this.selectionStart=0;this.selectionEnd=0;this.isConnected=true;this.events=[];}get value(){return this._value;}set value(v){this._value=v;this.nativeWrites=(this.nativeWrites||0)+1;}focus(){doc.activeElement=this;}dispatchEvent(e){this.events.push(e.type);}getRootNode(){return{};}}
 class Textarea extends Input{get value(){return super.value;}set value(v){super.value=v;}}
 const input=new Textarea(),other=new Textarea('outro'),doc={activeElement:input,addEventListener(name,fn){events[name]=fn;},createTextNode:text=>({text}),createRange(){throw Error('range não configurado');}};
 const hud={init(){},setStatus:(kind,label)=>states.push([kind,label]),setTextPreview(text){this.preview=text;},setCaptureNotice(text){this.captureNotice=text;},show(){}};
 function stream(){const track=Object.assign(new EventTarget(),{stopped:false,stop(){this.stopped=true;}});const item={track,getTracks:()=>[track]};streams.push(item);return item;}
 class AudioContext extends EventTarget{constructor(){super();this.sampleRate=48000;this.state='suspended';this.destination={};this.audioWorklet={addModule:()=>slowModule?moduleReady.promise:Promise.resolve()};contexts.push(this);}createMediaStreamSource(){return{connect:x=>x,disconnect(){}};}createGain(){return{gain:{value:1},connect:x=>x,disconnect(){}};}async resume(){this.state='running';this.dispatchEvent(new Event('statechange'));}async close(){this.state='closed';this.dispatchEvent(new Event('statechange'));}}
 class Node extends EventTarget{constructor(){super();nodes.push(this);this.port={postMessage:msg=>{if(msg.type==='flush')this.port.onmessage({data:{type:'flushed'}});}};}connect(x){return x;}disconnect(){this.disconnected=true;}}
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
test('realtime e final processam blocos VAD antes do Stop, sem confundir modalidade de inserção',async()=>{
 for(const realtime of [false,true]){const e=contentEnv();e.stt.insertionMode=realtime?'realtime':'final';await e.stt.startLiveRecording('custom');const start=e.messages.find(m=>m.type==='STT_LIVE_START');assert.equal(start.payload.realtime,realtime);assert.equal(start.payload.chunked,true);assert.equal(start.payload.agentId,'custom');const input=new Float32Array(4800).fill(.1);e.nodes[0].port.onmessage({data:input.buffer});await flush();const packet=e.messages.find(m=>m.type==='STT_LIVE_AUDIO');assert.ok(packet?.payload.chunk);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'),false);for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await flush();await e.stt.liveCapture.audioQueue.drain();assert.ok(e.messages.some(m=>m.payload?.endOnly&&m.payload.chunk.cutReason==='silence'));const jobId=e.stt.liveJobId;await e.stt.handleLiveEvent({jobId,event:'stt-partial',confirmedText:'',partialText:'fala em andamento'});assert.equal(e.input.value,realtime?'Fala em andamentooriginal':'original');assert.equal(e.stt.isRecording,true);e.stt.cancelRecording();await flush();assert.equal(e.streams[0].track.stopped,true);}
});
test('página antiga não abre microfone nem envia mensagens; página nova opera',async()=>{
 const old=contentEnv();old.runtime.invalid=true;await old.stt.toggleRecording('narrator');assertInvalidated(old);assert.equal(old.streams.length,0);assert.equal(old.messages.length,0);
 const fresh=contentEnv();await fresh.stt.toggleRecording('narrator');assert.equal(fresh.stt.isRecording,true);fresh.stt.cancelRecording();await flush();
});
test('reserva recusada por ditado em outra aba exibe aviso sem abrir microfone nem enviar Cancel',async()=>{
 const e=contentEnv(),send=e.runtime.sendMessage.bind(e.runtime);
 e.runtime.sendMessage=async message=>{
  if(message.type==='STT_CAPTURE_RESERVE'){
   e.messages.push(message);
   return {success:false,code:'STT_CAPTURE_BUSY',otherTab:true};
  }
  return send(message);
 };
 await e.stt.toggleRecording('narrator');
 assert.deepEqual(e.messages.map(m=>m.type),['STT_CAPTURE_RESERVE']);
 assert.equal(e.streams.length,0);
 assert.equal(e.stt.liveCapture,null);
 assert.equal(e.timers.size,0);
 assert.equal(e.hud.captureNotice,'Já existe um ditado em andamento em outra aba.');
 assert.ok(e.states.every(([,label])=>!/Falha|Atualize/.test(label)));
 e.runtime.sendMessage=send;
 await e.stt.toggleRecording('narrator');
 assert.equal(e.hud.captureNotice,'');
 assert.equal(e.stt.isRecording,true);
 e.stt.cancelRecording();
 await flush();
});
test('cancelamento/pagehide suporta sendMessage lançando erro síncrono e libera recursos',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.runtime.throwOn='STT_LIVE_CANCEL';assert.doesNotThrow(()=>e.events.pagehide());await flush();assertInvalidated(e);
});
test('rejeição durante START é tratada sem repetir mensagens em contexto inválido',async()=>{
 const e=contentEnv();e.runtime.rejectOn='STT_LIVE_START';await e.stt.toggleRecording('narrator');await flush();assertInvalidated(e);assert.deepEqual(e.messages.map(m=>m.type),['STT_CAPTURE_RESERVE','STT_LIVE_START']);
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
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});await flush();e.runtime.rejectOn='STT_LIVE_STOP';await e.stt.stopLiveRecording();await flush();assertInvalidated(e);assert.deepEqual(e.messages.filter(m=>m.type.startsWith('STT_LIVE_')).map(m=>m.type),['STT_LIVE_START','STT_LIVE_AUDIO','STT_LIVE_AUDIO','STT_LIVE_STOP']);assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_AUDIO').at(-1).payload.endOnly,true);
});
test('getURL invalidado entre setup e worklet encerra stream sem reabrir sessão',async()=>{
 const e=contentEnv();e.runtime.getURL=()=>{throw Error('Extension context invalidated.');};await e.stt.startLiveRecording('narrator');await flush();assertInvalidated(e);assert.equal(e.nodes.length,0);assert.deepEqual(e.messages.map(m=>m.type),['STT_CAPTURE_RESERVE','STT_LIVE_START']);
});
test('erro de API diferente de invalidação continua visível e libera microfone',async()=>{
 const e=contentEnv();const send=e.runtime.sendMessage.bind(e.runtime);e.runtime.sendMessage=m=>['STT_LIVE_START','STT_LIVE_CANCEL'].includes(m.type)?Promise.reject(Error('Falha de conexão sintética')):send(m);await e.stt.startLiveRecording('narrator');await flush();assert.equal(e.stt.contextInvalidated,false);assert.equal(e.stt.isRecording,false);assert.equal(e.streams[0].track.stopped,true);assert.match(e.hud.preview,/Falha de conexão sintética/);assert.equal(e.errors.length,1);
});
function loadEntrypoint(e,storage){
 e.doc.readyState='loading';e.runtime.onMessage={addListener(fn){e.messageListener=fn;}};
 const deps={'extension/src/content/ui/hudController.ts':{hud:e.hud},'extension/src/content/controllers/ttsController.ts':{tts:{setVolume(){},setSpeed(){},stop(){}}},'extension/src/content/controllers/sttController.ts':{stt:e.stt},'extension/src/content/controllers/lensController.ts':{lens:{}},'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:storage},'extension/src/content/styles/hud.css?raw':{default:''}};
 const m={exports:{}};e.context.modules['extension/src/content/entrypoint.ts'](m,m.exports,id=>deps[id]||e.load(id));
}
test('início antes da preferência carregar respeita realtime e insere parcial antes do Stop',async()=>{
 const e=contentEnv(),ui=deferred();loadEntrypoint(e,{get:key=>key==='ui'?ui.promise:Promise.resolve({}),subscribe(){}});e.events.DOMContentLoaded();
 const starting=e.stt.startLiveRecording('narrator');await flush();ui.resolve({dictationInsertion:'realtime'});await starting;
 const start=e.messages.find(message=>message.type==='STT_LIVE_START');assert.equal(start.payload.realtime,true);
 const jobId=e.stt.liveJobId;await e.stt.handleLiveEvent({jobId,event:'stt-partial',eventSeq:1,confirmedText:'',partialText:'antes de parar'});
 assert.equal(e.input.value,'Antes de pararoriginal');assert.equal(e.stt.isRecording,true);assert.equal(e.messages.some(message=>message.type==='STT_LIVE_STOP'),false);e.stt.cancelRecording();await flush();
});
test('falha ao ler preferência não congela silenciosamente ditado no modo final',async()=>{
 const e=contentEnv();loadEntrypoint(e,{get:key=>key==='ui'?Promise.reject(Error('Storage temporariamente indisponível')):Promise.resolve({}),subscribe(){}});e.events.DOMContentLoaded();await flush();await e.stt.startLiveRecording('narrator');assert.equal(e.streams.length,0);assert.ok(!e.messages.some(m=>m.type==='STT_LIVE_START'));assert.match(e.hud.preview,/preferência de inserção/);
});
test('PCM → VAD → transporte → registro → campo original: parcial inserido ainda gravando',async()=>{
 const e=contentEnv(),GlobalJobs=require('../global-jobs.js'),registry=GlobalJobs.create(),origin={tabId:1,frameId:0};let sequence=0,delivery=Promise.resolve(),ended=0;
 const emit=result=>{delivery=delivery.then(async()=>{const payload={jobId:e.stt.liveJobId,event:'stt-partial',eventSeq:++sequence,...result};await registry.event(payload);await e.stt.handleLiveEvent(payload);});};
 let transport;e.runtime.sendMessage=async message=>{e.messages.push(message);const p=message.payload;if(message.type==='STT_LIVE_START'){await registry.start({...p,type:'STT',origin});transport=new e.context.SttRealtime.LiveChunkTransport({jobId:p.jobId,sendAudio(){},endAudio(){ended++;},onPartial:emit});}if(message.type==='STT_LIVE_AUDIO')transport.submitAudioChunk({pcm:new Uint8Array(Buffer.from(p.audioBase64||'','base64')),chunk:p.chunk,endOnly:p.endOnly});if(message.type==='HUD_CAPTURE_STATE')await registry.capture(p,origin);return{success:true};};
 e.stt.insertionMode='realtime';await e.stt.startLiveRecording('narrator');e.doc.activeElement=e.other;
 for(let i=0;i<7;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await e.stt.liveCapture.audioQueue.drain();assert.equal(ended,1);
 transport.receive({inputTranscription:{text:'fala antes do Stop'}});await delivery;assert.equal(e.input.value,'Fala antes do Stoporiginal');assert.equal(e.other.value,'outro');assert.equal(e.stt.isRecording,true);assert.equal(e.streams[0].track.stopped,false);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'),false);assert.equal((await registry.get()).jobs[0].partialText,'fala antes do Stop');
 transport.cancel();e.stt.cancelRecording();await flush();assert.equal(e.streams[0].track.stopped,true);
});
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
 const e=contentEnv({slowMic:true}),starting=e.stt.startLiveRecording('narrator');await flush();e.runtime.invalid=true;for(const fn of [...e.timers.values()])fn();const stream=e.stream();e.micReady.resolve(stream);await starting;assertInvalidated(e);assert.deepEqual(e.messages.map(m=>m.type),['STT_CAPTURE_RESERVE']);
});
test('final anterior conserva seu alvo enquanto novo job grava em outro campo',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration,oldPcm=e.nodes[0].port.onmessage,closing=deferred();e.contexts[0].close=()=>{e.contexts[0].state='closed';return closing.promise;};
 const oldFinal=e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'antigo'});await flush();e.doc.activeElement=e.other;await e.stt.startLiveRecording('narrator');const newJob=e.stt.liveJobId,count=e.messages.length,lastState=e.states.at(-1);
 oldPcm({data:new Float32Array([.1]).buffer});await e.stt.handleLiveEvent({jobId,generation,event:'stt-error',error:'tardio'});await e.stt.handleLiveEvent({jobId,generation,event:'stt-partial',text:'tardio'});closing.resolve();await oldFinal;
 assert.equal(e.stt.liveJobId,newJob);assert.equal(e.streams[1].track.stopped,false);assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_AUDIO').length,0);assert.equal(e.states.at(-1),lastState);assert.equal(e.input.value,'Antigooriginal');assert.equal(e.other.value,'outro');e.stt.cancelRecording();await flush();assert.equal(e.streams[1].track.stopped,true);assert.equal(e.timers.size,0);
});
test('resultado atrasado no mesmo campo permanece no job sem invalidar a inserção mais recente',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');const first=e.stt.liveCapture;
 e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});await e.stt.stopLiveRecording();
 const reserve=deferred(),send=e.runtime.sendMessage.bind(e.runtime);
 e.runtime.sendMessage=message=>message.type==='STT_CAPTURE_RESERVE'?reserve.promise:send(message);
 const starting=e.stt.startLiveRecording('narrator'),second=e.stt.liveCapture;
 const finishing=e.stt.handleLiveEvent({jobId:first.jobId,generation:first.generation,event:'stt-final',text:'antigo'});
 await flush();
 assert.equal(e.input.value,'original');
 reserve.resolve({success:true});
 await Promise.all([starting,finishing]);
 assert.equal(e.input.value,'original');
 assert.equal(e.stt.getJobState(first.jobId).inserted,false);
 assert.equal(e.stt.liveCapture,second);
 await e.stt.handleLiveEvent({jobId:second.jobId,generation:second.generation,event:'stt-final',text:'novo'});
 assert.equal(e.input.value,'Novooriginal');
 assert.equal(e.stt.getJobState(second.jobId).inserted,true);
});
test('rejeição tardia de CANCEL não altera HUD ou recursos de novo job',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');let reject;const send=e.runtime.sendMessage.bind(e.runtime);e.runtime.sendMessage=msg=>msg.type==='STT_LIVE_CANCEL'?new Promise((_r,j)=>reject=j):send(msg);e.stt.cancelRecording();await flush();await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,lastState=e.states.at(-1);
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
test('falha no AudioContext durante início encerra trilhas e cancela sessão',async()=>{const e=contentEnv();e.context.AudioContext.prototype.resume=async()=>{throw Error('contexto indisponível');};await e.stt.startLiveRecording('narrator');await flush();assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.liveJobId,null);assert.equal(e.stt.isRecording,false);assert.ok(e.messages.some(m=>m.type==='STT_LIVE_CANCEL'));});
test('campo removido mantém texto no HUD e não anuncia inserção bem-sucedida',async()=>{const e=contentEnv();await e.stt.startLiveRecording('narrator');e.input.isConnected=false;await e.stt.handleLiveEvent({jobId:e.stt.liveJobId,generation:e.stt.liveGeneration,event:'stt-final',text:'Texto sintético'});assert.equal(e.input.value,'original');assert.match(e.hud.preview,/Copie a transcrição/);assert.match(e.states.at(-1)[1],/texto não inserido/);assert.equal(e.streams[0].track.stopped,true);});
test('cancelamento durante getUserMedia encerra stream que chega depois',async()=>{
 const e=contentEnv({slowMic:true}),starting=e.stt.startLiveRecording('narrator');await flush();const id=e.stt.liveJobId;e.stt.cancelRecording();assert.equal(e.stt.getJobState(id).microphoneReleased,false);assert.ok(!e.messages.some(m=>m.payload?.microphoneReleased));const stream=e.stream();e.micReady.resolve(stream);await starting;await flush();assert.equal(stream.track.stopped,true);assert.equal(e.contexts.length,0);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_START'),false);assert.ok(e.messages.some(m=>m.payload?.jobId===id&&m.payload.microphoneReleased));
});
test('cancelamento durante setup/worklet impede inicialização atrasada',async()=>{
 for(const phase of ['start','module']){const e=contentEnv({slowStart:phase==='start',slowModule:phase==='module'}),starting=e.stt.startLiveRecording('narrator');await flush();e.stt.cancelRecording();if(phase==='start')e.startReady.resolve({success:true});else e.moduleReady.resolve();await starting;assert.equal(e.streams[0].track.stopped,true);assert.equal(e.stt.isRecording,false);assert.equal(e.nodes.length,0);if(e.contexts.length)assert.equal(e.contexts[0].state,'closed');}
});
test('parada envia PCM pendente antes de STOP e libera microfone antes do final',async()=>{
 const e=contentEnv();await e.stt.startLiveRecording('narrator');e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;await e.stt.stopLiveRecording();
 assert.deepEqual(e.messages.filter(m=>m.type.startsWith('STT_LIVE_')).map(m=>m.type),['STT_LIVE_START','STT_LIVE_AUDIO','STT_LIVE_AUDIO','STT_LIVE_STOP']);assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_AUDIO').at(-1).payload.endOnly,true);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.isRecording,false);assert.equal(e.stt.liveJobId,null);assert.equal(e.stt.liveJobs.has(jobId),true);
 await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'Ditado'});assert.equal(e.stt.liveJobId,null);assert.match(e.states.at(-1)[1],/Parado/);
});
test('botão Parar do HUD finaliza STT ativo; não apenas TTS',()=>{
 const start=source.indexOf('    hudController_1.hud.onStopClick ='),end=source.indexOf('    hudController_1.hud.onCloseClick',start),calls=[],hud={};
 vm.runInNewContext(source.slice(start,end),{hudController_1:{hud},sttController_1:{stt:{isRecording:true,stopLiveRecording:()=>calls.push('stt-stop')}},ttsController_1:{tts:{stop:()=>calls.push('tts-stop')}}});hud.onStopClick();assert.deepEqual(calls,['stt-stop']);
});
function offscreenEnv(acquire,deliver){const events=[],attempts=[],timers=new Map(),diagnostics=[];let listener,id=0,clock=0;const retired=[];
 const context=vm.createContext({console,performance:{now:()=>clock},structuredClone,AbortController,Uint8Array,setTimeout(fn,ms){timers.set(++id,{fn,ms,at:clock+ms});return id;},clearTimeout:i=>timers.delete(i),SttScheduler:require('../stt-scheduler.js'),LiveConfig:config,LiveSessions:{classifyLiveError:sessions.classifyLiveError,decodeBase64:sessions.decodeBase64,LiveSessionManager:class{async acquire(o){attempts.push(o);return acquire(o);}retire(s){retired.push(s);}release(){}}},chrome:{runtime:{getURL:x=>x,onMessage:{addListener:fn=>listener=fn},sendMessage:m=>{events.push(m.payload);return Promise.resolve();}}}});
 const recovery=new Map();context.SttRecovery={async start(jobId){if(recovery.has(jobId))throw Error('duplicate recovery');recovery.set(jobId,{packets:[],state:'recording'});},async append(jobId,p){recovery.get(jobId).packets.push({pcm:p.pcm.slice(),chunk:{...p.chunk}});},async update(jobId,patch){Object.assign(recovery.get(jobId)||{},patch);}};context.SttRealtime=require('../stt-realtime.js');context.LiveSttDiagnostics={emit:p=>diagnostics.push(p)};
 const runtimeSend=context.chrome.runtime.sendMessage;context.chrome.runtime.sendMessage=message=>message.type==='LIVE_OFFSCREEN_EVENT'?runtimeSend(message).then(()=>deliver?.(message.payload)):Promise.resolve();
 vm.runInContext(fs.readFileSync(require.resolve('../offscreen.js'),'utf8'),context);
 return{events,attempts,retired,timers,diagnostics,recovery,recoveryService:context.SttRecovery,command:p=>new Promise(r=>listener({type:'LIVE_OFFSCREEN_COMMAND',target:'offscreen',payload:p},{},r)),expire(){for(const [id,t]of [...timers]){timers.delete(id);t.fn();}},async advance(ms){const end=clock+ms;let count=0;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert.ok(++count<1000,'timers devem ser finitos');const [id,timer]=next;timers.delete(id);clock=timer.at;timer.fn();await flush();}clock=end;}};
}
const base={jobId:'test',modelId:'gemini-3.8-live',operation:'STT_LIVE_START',apiKeys:['fake-only']};
function preferenceFlow({mode='realtime',legacyMode}={}){
 const e=contentEnv({diagnostics:true}),raw={ui:{dictationInsertion:mode,theme:'dark',shortcuts:{startDictation:'Pause'}},api:{apiKeys:Array.from({length:9},(_,i)=>'unit-account-'+i)},agents:{activeAgentId:'custom',customAgents:[{metadata:{id:'custom',isBuiltIn:false},instructions:{sttFormattingInstruction:'Preserve o sentido da fala e pontue o texto público.'},live:{preferredModel:'gemini-3.8-live',stt:{transform:true,preferredModel:'gemini-3.8-live'}}}]},history:{enabled:false,recentItems:[]},...(legacyMode?{uiPreferences:{dictationInsertion:legacyMode,theme:'dark',shortcuts:{startDictation:'Pause'}}}:{})};
 const changes=new Set(),sessionStore={},deliveries=[],routed=[],liveSessions=[];let router;
 const local={get(keys,callback){const selected=keys===null?structuredClone(raw):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in raw).map(key=>[key,structuredClone(raw[key])]));if(callback){callback(selected);return;}return Promise.resolve(selected);},set(values,callback){const event={};for(const [key,value]of Object.entries(values)){event[key]={oldValue:structuredClone(raw[key]),newValue:structuredClone(value)};raw[key]=structuredClone(value);}for(const listener of changes)listener(event,'local');callback?.();return Promise.resolve();}};
 const storage={local,onChanged:{addListener:fn=>changes.add(fn),removeListener:fn=>changes.delete(fn)},session:{get:async key=>({[key]:sessionStore[key]}),set:async values=>Object.assign(sessionStore,structuredClone(values))}};
 const sender={url:'https://public.example.test/',tab:{id:1},frameId:0,documentId:'original-document'};
 const offscreen=offscreenEnv(async options=>{const live={options,id:'live-1793242000000-test',sent:[],sendAudio(bytes){this.sent.push(bytes.slice());},endAudio(){this.endCount=(this.endCount||0)+1;},async sendTurn(){return{text:'Texto público transformado.'};}};liveSessions.push({options,live});return live;},packet=>{const delivery=router.handleExtensionMessage({type:'LIVE_OFFSCREEN_EVENT',payload:packet},{url:'chrome-extension://test/offscreen.html'});deliveries.push(delivery);return delivery;});
 const background=vm.createContext({console,structuredClone,AbortController,setTimeout,clearTimeout,chrome:{storage,runtime:{getURL:x=>'chrome-extension://test/'+x,sendMessage:async()=>({success:true})},tabs:{get:async id=>({id,autoDiscardable:true}),update:async()=>{},sendMessage:async(_tab,message)=>{if(message.type==='STT_LIVE_EVENT')await e.stt.handleLiveEvent(message.payload);return{success:true};}}}});
 vm.runInContext(require('./load-background.cjs')(require.resolve('../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),background);
 const cache={},overrides={'extension/src/services/backgroundPlayback.ts':{hasDocument:async()=>false,handlePlaybackCommand:async payload=>{routed.push(payload);return offscreen.command(payload);}},'extension/src/services/diagnosticLogger.ts':{logDiagnostic:async()=>{}}};
 function load(id){if(overrides[id])return overrides[id];if(cache[id])return cache[id].exports;const module=cache[id]={exports:{}};background.modules[id](module,module.exports,load);return module.exports;}
 router=load('extension/src/background/messageRouter.ts');e.context.chrome.storage=storage;e.runtime.sendMessage=async message=>{e.messages.push(message);return router.handleExtensionMessage(message,sender);};
 const adapter=e.load('extension/src/services/storage/chromeStorageAdapter.ts').chromeStorage;loadEntrypoint(e,adapter);e.events.DOMContentLoaded();
 const optionsSource=fs.readFileSync(require.resolve('../options.js'),'utf8'),options=vm.createContext({state:{ui:structuredClone(raw.ui)},chrome:{storage}});vm.runInContext(optionsSource.slice(optionsSource.indexOf('async function saveDictationInsertion('),optionsSource.indexOf('async function startLiveTtsPreview(')),options);
 return{e,raw,offscreen,routed,liveSessions,saveMode:mode=>options.saveDictationInsertion(mode),diagnostics:()=>router.handleExtensionMessage({type:'LIVE_STT_DIAGNOSTICS_GET'},{url:'chrome-extension://test/options.html'}),async delivered(){for(let i=0;i<12;i++){await flush();const count=deliveries.length;await Promise.all(deliveries);await flush();if(count===deliveries.length)return;}throw Error('Eventos STT não estabilizaram.');}};
}
test('Options → storage normalizado → content → background → offscreen → registro/editor preservam modo e transformação efetivos',async()=>{
 for(const scenario of [{mode:'realtime'},{mode:'final',changeTo:'realtime'},{mode:'realtime',legacyMode:'final'},{mode:'final'}]){
 const flow=preferenceFlow(scenario),{e,raw}=flow,agentBefore=JSON.stringify(raw.agents),keysBefore=JSON.stringify(raw.api),expected=scenario.changeTo||scenario.mode;await e.stt.preferencesReady;if(scenario.changeTo)await flow.saveMode(scenario.changeTo);
 await e.stt.startLiveRecording('custom');const jobId=e.stt.liveJobId;try{assert.ok(jobId);const start=e.messages.find(m=>m.type==='STT_LIVE_START');assert.equal(start.payload.realtime,expected==='realtime');assert.equal(e.stt.liveJobs.get(jobId).mode,expected);assert.equal(e.stt.liveJobs.get(jobId).transform,expected==='final');const routed=flow.routed.find(p=>p.operation==='STT_LIVE_START');assert.equal(routed.realtime,expected==='realtime');assert.equal(routed.transformInstruction,expected==='realtime'?null:raw.agents.customAgents[0].instructions.sttFormattingInstruction);
 e.doc.activeElement=e.other;
 for(const text of ['fala pública','continua em ordem']){for(let i=0;i<7;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await e.stt.liveCapture.audioQueue.drain();flow.liveSessions[0].live.handler({serverContent:{inputTranscription:{text,finished:true}}});await flow.delivered();}
 assert.equal(e.input.value,expected==='realtime'?'Fala pública continua em ordemoriginal':'original');assert.equal(e.other.value,'outro');assert.equal(e.stt.isRecording,true);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'),false);assert.equal(flow.liveSessions.length,1);
 const stateBefore=await e.runtime.sendMessage({type:'HUD_GLOBAL_GET'});assert.equal(stateBefore.state.jobs.find(j=>j.jobId===jobId).text,'fala pública continua em ordem');const stored=(await flow.diagnostics()).diagnostics.jobs.find(j=>j.jobId===jobId);assert.equal(stored.capture.insertionMode,expected);assert.equal(stored.capture.transform,expected==='final');if(expected==='realtime'){assert.equal(stored.result.whileRecording,true);assert.equal(stored.result.finalInsertion,false);}else assert.equal(stored.result,undefined);
 await e.stt.stopLiveRecording();await flow.delivered();assert.equal(e.input.value,expected==='realtime'?'Fala pública continua em ordemoriginal':'Texto público transformado.original');assert.equal(flow.liveSessions.filter(s=>s.options.mode==='agent').length,expected==='final'?1:0);assert.equal(flow.offscreen.events.some(p=>p.event==='stt-transform-attempt'),expected==='final');assert.equal(flow.offscreen.events.some(p=>p.event==='stt-status'&&/Transformando/.test(p.status)),expected==='final');assert.equal(JSON.stringify(raw.agents),agentBefore);assert.equal(JSON.stringify(raw.api),keysBefore);assert.equal(raw.ui.dictationInsertion,expected);
 const setup=e.messages.find(m=>m.type==='LIVE_STT_DIAGNOSTIC'&&m.payload.stage==='setup-complete'&&m.payload.scope==='capture').payload;assert.equal(setup.insertionMode,expected);assert.equal(setup.transform,expected==='final');const first=e.messages.find(m=>m.type==='LIVE_STT_DIAGNOSTIC'&&m.payload.stage==='inserted').payload;assert.equal(first.whileRecording,expected==='realtime');assert.equal(first.finalInsertion,expected==='final');assert.equal(e.streams[0].track.stopped,true);
 }finally{e.stt.cancelRecording();await flush();}
 }
});
for(const mode of ['final','realtime'])for(const seconds of [20,60,180])for(const pauses of [false,true])test(`estabilidade integrada ${mode}: ${seconds}s PCM ${pauses?'com pausas longas no corte de 12s':'de fala contínua'}, sem Stop automático`,async()=>{
 const flow=preferenceFlow({mode}),{e,offscreen}=flow;await e.stt.preferencesReady;await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,capture=e.stt.liveCapture;const job=e.stt.liveJobs.get(jobId);job.insertion.settleMs=0;const live=flow.liveSessions[0].live,voice=new Float32Array(4800).fill(.1),silence=new Float32Array(4800),texts=[];let voicedFrames=0;
 async function respond(){while(texts.length<(live.endCount||0)){const text=`Bloco ${texts.length+1}.`;texts.push(text);live.handler({serverContent:{inputTranscription:{text,finished:true}}});await flow.delivered();}}
 try{
 for(let i=0;i<seconds*10;i++){const voiced=!pauses||i%440<120||i%440>=320;if(voiced)voicedFrames++;e.nodes[0].port.onmessage({data:(voiced?voice:silence).buffer});await capture.audioQueue.drain();await respond();await offscreen.advance(100);if(i%10===0)for(const callback of e.timers.values())callback();assert.equal(e.stt.liveCapture,capture,`microfone deve permanecer no frame ${i}`);assert.equal(e.stt.isRecording,true);assert.equal(e.streams[0].track.stopped,false);}
 assert.equal(capture.metrics.capturedBytes,seconds*32000);assert.equal(flow.liveSessions.length,1);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'||m.type==='STT_LIVE_CANCEL'),false);assert.equal(offscreen.events.some(p=>p.event==='stt-final'||p.event==='stt-error'),false);
 assert.equal(e.input.value,mode==='realtime'?texts.join(' ')+'original':'original');
 await e.stt.stopLiveRecording();await respond();await flow.delivered();assert.equal(e.input.value,texts.join(' ')+'original');assert.equal(e.other.value,'outro');assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(capture.metrics.pendingChunks,0);assert.equal(e.timers.size,0);assert.equal(offscreen.events.filter(p=>p.event==='stt-final').length,1);assert.equal(offscreen.events.some(p=>p.event==='stt-error'),false);
 const packets=e.messages.filter(m=>m.type==='STT_LIVE_AUDIO').map(m=>m.payload);assert.ok(packets.every((p,i)=>(p.chunk?.packetSequence??p.packetSequence)===i+1));const closed=packets.filter(p=>p.endOnly);assert.ok(closed.every((p,i)=>p.chunk.sequence===i+1));assert.ok(closed.length>=texts.length);assert.equal(live.endCount,texts.length,'cortes máximos locais não criam turnos extras');assert.ok(packets.filter(p=>p.chunk).every(p=>p.chunk.overlapMs===0));
 let voicedSamples=0;for(const bytes of live.sent){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<bytes.byteLength;i+=2)if(view.getInt16(i,true)!==0)voicedSamples++;}assert.equal(voicedSamples,voicedFrames*1600,'toda fala foi enviada exatamente uma vez, sem overlap ou duplicação');assert.deepEqual(Buffer.concat(offscreen.recovery.get(jobId).packets.map(p=>Buffer.from(p.pcm))),Buffer.concat(live.sent.map(p=>Buffer.from(p))));
 const diagnostic=(await flow.diagnostics()).diagnostics.jobs.find(j=>j.jobId===jobId);assert.equal(diagnostic.capture.stopReason,'user-stop');assert.equal(offscreen.diagnostics.findLast(p=>p.stage==='session-ending').stopReason,'user-stop');assert.equal(diagnostic.capture.released,true);
 }finally{e.stt.cancelRecording();await flush();}
});
for(const mode of ['final','realtime'])for(const pause of [30000,300000])test(`Etapa 1B ${mode}: microfone ativo em pausa ${pause/1000}s e retomada no mesmo ditado`,async()=>{
 const flow=preferenceFlow({mode}),{e,offscreen}=flow;await e.stt.preferencesReady;await e.stt.startLiveRecording('narrator');const capture=e.stt.liveCapture,jobId=capture.jobId,live=flow.liveSessions[0].live;e.stt.liveJobs.get(jobId).insertion.settleMs=0;
 async function frames(n,value){const frame=new Float32Array(4800).fill(value);for(let i=0;i<n;i++)e.nodes[0].port.onmessage({data:frame.buffer});await capture.audioQueue.drain();}
 try{
  await frames(7,.1);await frames(5,0);live.handler({serverContent:{inputTranscription:{text:'Antes.',finished:true}}});await flow.delivered();const sent=live.sent.length,archived=offscreen.recovery.get(jobId).packets.length;
  await frames(pause/100,0);await offscreen.advance(pause);await flow.delivered();assert.equal(e.stt.liveCapture,capture);assert.equal(e.stt.isRecording,true);assert.equal(e.streams[0].track.stopped,false);assert.equal(e.contexts[0].state,'running');assert.equal(live.sent.length,sent);assert.equal(offscreen.recovery.get(jobId).packets.length,archived);assert.ok(capture.chunker.idle.length<=16000);assert.equal(e.messages.some(m=>['STT_LIVE_STOP','STT_LIVE_CANCEL'].includes(m.type)),false);assert.equal(offscreen.events.some(p=>['stt-error','stt-final'].includes(p.event)),false);
  await frames(7,.1);await frames(5,0);live.handler({serverContent:{inputTranscription:{text:'Depois.',finished:true}}});await flow.delivered();assert.equal(e.input.value,mode==='realtime'?'Antes. Depois.original':'original');assert.equal(flow.liveSessions.length,1);
  await e.stt.stopLiveRecording();await flow.delivered();assert.equal(e.input.value,'Antes. Depois.original');assert.equal(e.streams[0].track.stopped,true);assert.equal(offscreen.events.find(p=>p.event==='stt-final').incomplete,false);assert.equal(offscreen.recovery.get(jobId).state,'completed');
 }finally{e.stt.cancelRecording();await flow.delivered();}
});
for(const mode of ['final','realtime'])test(`Etapa 1B ${mode}: sinal sem fala, blocos sem resultado e fala seguinte não bloqueiam nem encerram captura`,async()=>{
 const flow=preferenceFlow({mode}),{e,offscreen}=flow;await e.stt.preferencesReady;await e.stt.startLiveRecording('narrator');const capture=e.stt.liveCapture,jobId=capture.jobId,live=flow.liveSessions[0].live;e.stt.liveJobs.get(jobId).insertion.settleMs=0;
 async function phrase(){for(let i=0;i<7;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await capture.audioQueue.drain();}
 try{
  await phrase();live.handler({serverContent:{inputTranscription:{text:'Confirmado.',finished:true}}});await flow.delivered();await phrase();const before=live.sent.length;await phrase();assert.ok(live.sent.length>before,'terceiro bloco enviado mesmo sem resultado do segundo');
  live.handler({serverContent:{turnComplete:true,generationComplete:true}});await offscreen.advance(30000);await flow.delivered();assert.equal(e.stt.isRecording,true);assert.equal(e.streams[0].track.stopped,false);assert.equal(offscreen.events.some(p=>p.event==='stt-error'),false);assert.ok(offscreen.events.some(p=>p.event==='stt-warning'));assert.equal(offscreen.recovery.get(jobId).noSpeech,0);
  live.handler({serverContent:{inputTranscription:{text:'Continua válido.'}}});await flow.delivered();assert.equal(e.input.value,mode==='realtime'?'Confirmado. Continua válido.original':'original');
  const archive=offscreen.recovery.get(jobId);assert.deepEqual(Buffer.concat(archive.packets.map(p=>Buffer.from(p.pcm))),Buffer.concat(live.sent.map(p=>Buffer.from(p))));assert.equal(flow.liveSessions.length,1);
  await e.stt.stopLiveRecording();await offscreen.advance(15000);await flow.delivered();assert.equal(e.input.value,'Confirmado. Continua válido.original');assert.equal(offscreen.events.find(p=>p.event==='stt-final').incomplete,true);assert.equal(archive.state,'incomplete');assert.equal(e.streams[0].track.stopped,true);
 }finally{e.stt.cancelRecording();await flow.delivered();}
});
for(const mode of ['final','realtime'])test(`Etapa 1B ${mode}: expiração remota em pausa não para microfone, retoma contexto/conta sem replay`,async()=>{
 const flow=preferenceFlow({mode}),{e,offscreen}=flow;await e.stt.preferencesReady;await e.stt.startLiveRecording('narrator');const capture=e.stt.liveCapture,jobId=capture.jobId,first=flow.liveSessions[0];e.stt.liveJobs.get(jobId).insertion.settleMs=0;
 async function phrase(){for(let i=0;i<7;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await capture.audioQueue.drain();}
 try{
  await phrase();first.live.handler({serverContent:{inputTranscription:{text:'Antes.',finished:true}}});await flow.delivered();const sent=first.live.sent.length;first.live.resumeHandle='test-opaque-resumption';first.live.handler({error:{cause:Object.assign(Error('WebSocket closed'),{closeCode:1000})}});await flow.delivered();await offscreen.advance(300000);assert.equal(e.stt.isRecording,true);assert.equal(e.streams[0].track.stopped,false);assert.equal(flow.liveSessions.length,1,'não reconecta por temporizador de inatividade');
  await phrase();assert.equal(flow.liveSessions.length,2);const next=flow.liveSessions[1];assert.equal(next.options.resumeHandle,'test-opaque-resumption');assert.equal(next.options.apiKey,first.options.apiKey);assert.equal(next.options.keyIndex,first.options.keyIndex);assert.equal(next.options.modelId,first.options.modelId);assert.equal(next.options.jobId,jobId);assert.equal(first.live.sent.length,sent);assert.ok(next.live.sent.length<sent+10,'somente PCM novo, sem replay do primeiro bloco');next.live.handler({serverContent:{inputTranscription:{text:'Depois.',finished:true}}});await flow.delivered();await e.stt.stopLiveRecording();await flow.delivered();assert.equal(e.input.value,'Antes. Depois.original');assert.equal(offscreen.events.some(p=>p.event==='stt-error'),false);
 }finally{e.stt.cancelRecording();await flow.delivered();}
});
test('recuperação local falha explicitamente antes do envio, sem penalizar conta ou apagar journal anterior',async()=>{
 for(const code of ['RECOVERY_STORAGE','RECOVERY_LIMIT']){const sent=[],live={sendAudio:bytes=>sent.push(bytes),endAudio(){}},offscreen=offscreenEnv(async()=>live),p={...base,chunked:true};assert.equal((await offscreen.command(p)).success,true);offscreen.recoveryService.append=async()=>{throw Object.assign(Error('Falha local de recuperação'),{code});};const packet={jobId:p.jobId,chunkId:p.jobId+':1',sequence:1,packetSequence:1,startMs:0,endMs:100,overlapMs:0,status:'streaming'};const reply=await offscreen.command({...p,operation:'STT_LIVE_AUDIO',audioBase64:Buffer.alloc(3200,7).toString('base64'),chunk:packet});await flush();assert.equal(reply.success,false);assert.equal(sent.length,0);const error=offscreen.events.find(e=>e.event==='stt-error');assert.equal(error.stopReason,code==='RECOVERY_LIMIT'?'recovery-limit':'recovery-storage');assert.equal(error.recoveryAvailable,false);assert.equal(offscreen.recovery.get(p.jobId).state,'interrupted');const snapshot=await offscreen.command({operation:'STT_SCHEDULER_SNAPSHOT'});assert.ok(snapshot.diagnostics.accounts.every(a=>a.models.every(m=>m.cooldownUntil===0)));await offscreen.command({...p,operation:'STT_LIVE_CANCEL'});assert.equal((await offscreen.command(p)).success,false);assert.equal(offscreen.recovery.get(p.jobId).state,'interrupted','START duplicado não altera journal preexistente');}
});
test('retomada rejeitada tenta só a mesma conta uma vez, guarda PCM novo e não faz fallback/replay',async()=>{
 const live={options:null,resumeHandle:'opaque-test',sendAudio(){},endAudio(){}},offscreen=offscreenEnv(async options=>{if(options.resumeHandle)throw Error('Retomada rejeitada');live.options=options;return live;}),p={...base,chunked:true};assert.equal((await offscreen.command(p)).success,true);live.handler({error:{cause:Object.assign(Error('WebSocket closed'),{closeCode:1000})}});await flush();assert.equal(offscreen.events.some(e=>e.event==='stt-error'),false);const chunk={jobId:p.jobId,chunkId:p.jobId+':1',sequence:1,packetSequence:1,startMs:0,endMs:100,overlapMs:0,status:'streaming'};const reply=await offscreen.command({...p,operation:'STT_LIVE_AUDIO',audioBase64:Buffer.alloc(3200,7).toString('base64'),chunk});await flush();assert.equal(reply.success,false);assert.equal(offscreen.attempts.length,2);assert.equal(offscreen.attempts[1].apiKey,offscreen.attempts[0].apiKey);assert.equal(offscreen.recovery.get(p.jobId).packets[0].pcm.length,3200);assert.equal(offscreen.recovery.get(p.jobId).state,'interrupted');assert.ok(offscreen.events.some(e=>e.event==='stt-error'&&e.incomplete));
});
test('falhas de dispositivo/worklet/contexto são fatais explícitas; suspensão transitória não encerra o ditado',async()=>{
 for(const kind of ['microphone-ended','worklet-error','context-closed']){const e=contentEnv({diagnostics:true});await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,capture=e.stt.liveCapture;
 e.contexts[0].state='suspended';e.contexts[0].dispatchEvent(new Event('statechange'));await flush();assert.equal(e.stt.isRecording,true);e.contexts[0].state='running';e.contexts[0].dispatchEvent(new Event('statechange'));
 if(kind==='microphone-ended')e.streams[0].track.dispatchEvent(new Event('ended'));if(kind==='worklet-error')e.nodes[0].dispatchEvent(new Event('processorerror'));if(kind==='context-closed'){e.contexts[0].state='closed';e.contexts[0].dispatchEvent(new Event('statechange'));}await flush();await flush();
 assert.equal(capture.stopReason,kind);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.stt.isRecording,false);assert.equal(e.states.at(-1)[1],'Erro STT');assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_CANCEL').length,1);assert.equal(e.messages.some(m=>m.type==='LIVE_STT_DIAGNOSTIC'&&m.payload.stage==='capture-ending'&&m.payload.stopReason===kind),true);
 const count=e.messages.length;e.nodes[0].dispatchEvent(new Event('processorerror'));e.streams[0].track.dispatchEvent(new Event('ended'));await e.stt.handleLiveEvent({jobId,event:'stt-final',text:'Final atrasado.'});await flush();assert.equal(e.messages.length,count);assert.equal(e.input.value,'original');
 }
});
test('origem de Stop, Cancelar, navegação e invalidação é registrada antes da liberação',async()=>{
 for(const kind of ['user-stop','user-cancel','origin-lost','context-invalidated']){const e=contentEnv({diagnostics:true});await e.stt.startLiveRecording('narrator');const capture=e.stt.liveCapture;e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});await capture.audioQueue.drain();if(kind==='user-stop')await e.stt.stopLiveRecording();if(kind==='user-cancel')e.stt.cancelRecording();if(kind==='origin-lost')e.events.pagehide();if(kind==='context-invalidated')e.stt.invalidateExtensionContext();await flush();await flush();assert.equal(capture.stopReason,kind);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.messages.filter(m=>m.type==='LIVE_STT_DIAGNOSTIC'&&m.payload.stage==='capture-ending').length,1);}
});
test('Cancelar após três minutos de PCM libera o job e não afeta uma captura posterior nos dois modos',async()=>{
 for(const mode of ['final','realtime']){const e=contentEnv({diagnostics:true});e.stt.insertionMode=mode;await e.stt.startLiveRecording('narrator');const jobId=e.stt.liveJobId,capture=e.stt.liveCapture,frame=new Float32Array(4800).fill(.1);for(let i=0;i<1800;i++){e.nodes[0].port.onmessage({data:frame.buffer});await capture.audioQueue.drain();}assert.equal(e.stt.isRecording,true);assert.equal(capture.metrics.capturedBytes,180*32000);e.stt.cancelRecording();await flush();assert.equal(capture.stopReason,'user-cancel');assert.equal(e.contexts[0].state,'closed');assert.equal(e.streams[0].track.stopped,true);assert.equal(capture.audioQueue.closed,true);assert.equal(e.timers.size,0);assert.equal(e.messages.some(m=>m.type==='STT_LIVE_STOP'),false);
 await e.stt.startLiveRecording('narrator');e.nodes[0].dispatchEvent(new Event('processorerror'));e.streams[0].track.dispatchEvent(new Event('ended'));await e.stt.handleLiveEvent({jobId,event:'stt-final',text:'Evento antigo.'});assert.equal(e.stt.isRecording,true);assert.equal(e.streams[1].track.stopped,false);assert.equal(e.input.value,'original');e.stt.cancelRecording();await flush();}
});
test('timeout de bloco é aviso; socket 429 continua fatal sem replay e conserva texto/áudio',async()=>{
 for(const mode of ['final','realtime'])for(const kind of ['chunk-timeout','socket-error']){const flow=preferenceFlow({mode}),{e,offscreen}=flow;await e.stt.preferencesReady;await e.stt.startLiveRecording('narrator');const capture=e.stt.liveCapture,jobId=capture.jobId,live=flow.liveSessions[0].live;e.stt.liveJobs.get(jobId).insertion.settleMs=0;
 for(let turn=0;turn<2;turn++){for(let i=0;i<7;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});for(let i=0;i<5;i++)e.nodes[0].port.onmessage({data:new Float32Array(4800).buffer});await capture.audioQueue.drain();if(turn===0){live.handler({serverContent:{inputTranscription:{text:'Trecho confirmado.',finished:true}}});await flow.delivered();}}
 const sent=live.sent.length;if(kind==='chunk-timeout'){await offscreen.advance(15001);await flow.delivered();assert.equal(e.stt.isRecording,true);assert.equal(capture.stopReason,undefined);assert.equal(e.streams[0].track.stopped,false);assert.equal(offscreen.events.some(p=>p.event==='stt-error'),false);assert.ok(offscreen.events.some(p=>p.event==='stt-warning'));assert.ok(offscreen.recovery.get(jobId).packets.length);e.stt.cancelRecording();await flow.delivered();continue;}live.handler({error:{message:'Socket encerrado (429).',cause:Object.assign(Error('429'),{httpStatus:429,closeCode:1011})}});await flow.delivered();assert.equal(capture.stopReason,kind);assert.equal(e.stt.isRecording,false);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.states.at(-1)[1],'Erro STT');assert.equal(e.input.value,mode==='realtime'?'Trecho confirmado.original':'original');assert.equal(flow.liveSessions.length,1);assert.equal(live.sent.length,sent);assert.equal(offscreen.events.some(p=>p.event==='stt-final'),false);assert.equal(offscreen.recovery.get(jobId).state,'interrupted');
 const job=(await e.runtime.sendMessage({type:'HUD_GLOBAL_GET'})).state.jobs.find(j=>j.jobId===jobId);assert.equal(job.status,'error');assert.equal(job.text,'Trecho confirmado.');assert.equal(job.incomplete,true);const diagnostic=offscreen.diagnostics.findLast(p=>p.stage==='error');assert.equal(diagnostic.stopReason,kind);if(kind==='socket-error')assert.equal(diagnostic.errorKind,'QUOTA');
 live.handler({serverContent:{inputTranscription:{text:'Não inserir.',finished:true}}});await flow.delivered();assert.equal(live.sent.length,sent);assert.equal(e.input.value,mode==='realtime'?'Trecho confirmado.original':'original');}
});
test('offscreen: final e realtime recebem parciais antes do Stop, mesma sessão, transformação suspensa só realtime',async()=>{
 for(const realtime of [false,true]){let ended=0;const transformed=[],session={id:'live-1793242000000-test',sendAudio(){},endAudio(){ended++;}},agentSession={async sendTurn(text){transformed.push(text);return{text:'Texto transformado.'};}},e=offscreenEnv(async o=>o.mode==='agent'?agentSession:session),p={...base,jobId:'00000000-0000-4000-8000-000000000000',chunked:true,realtime,transformInstruction:'Instrução pública.'};
 const started=await e.command(p);assert.equal(started.success,true);assert.equal(started.transform,!realtime);assert.equal(e.attempts[0].vad.disabled,true);
 const packets=[],pipeline=new (require('../stt-realtime.js').CapturePipeline)({jobId:p.jobId,realtime:true,submitAudioChunk:x=>packets.push(x)}),pcm=new Uint8Array(3200);new DataView(pcm.buffer).setInt16(0,10000,true);pipeline.push(pcm);for(let i=0;i<5;i++)pipeline.push(new Uint8Array(3200));
 for(const packet of packets)assert.equal((await e.command({...p,operation:'STT_LIVE_AUDIO',chunk:packet.chunk,endOnly:packet.endOnly,audioBase64:Buffer.from(packet.pcm).toString('base64')})).success,true);
 assert.equal(ended,1);session.handler({serverContent:{inputTranscription:{text:'Ditado público.',finished:true}}});await flush();assert.ok(e.events.some(x=>x.event==='stt-partial'&&x.text==='Ditado público.'));assert.equal(e.events.some(x=>x.event==='stt-final'),false);assert.equal(e.attempts.length,1);
 await e.command({...p,operation:'STT_LIVE_STOP'});await flush();await flush();assert.equal(e.events.find(x=>x.event==='stt-final')?.text,realtime?'Ditado público.':'Texto transformado.');assert.equal(transformed.length,realtime?0:1);assert.ok(e.diagnostics.some(d=>d.stage==='first-pcm'&&Number.isFinite(d.firstPcmMs)));assert.ok(e.diagnostics.some(d=>d.stage==='input-transcription'&&Number.isFinite(d.firstResponseMs)));assert.ok(e.diagnostics.some(d=>d.stage==='consolidated'&&Number.isFinite(d.stopToFinalMs)));
 }
});
test('Stop com fila de blocos conserva só deadline por bloco, sem timeout global prematuro ou nova sessão',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session),p={...base,chunked:true};await e.command(p);const packets=[],pipeline=new(require('../stt-realtime.js').CapturePipeline)({jobId:p.jobId,realtime:true,submitAudioChunk:x=>packets.push(x)}),pcm=new Uint8Array(3200).fill(100);
 for(let n=0;n<3;n++){pipeline.push(pcm);for(let i=0;i<5;i++)pipeline.push(new Uint8Array(3200));}for(const packet of packets)await e.command({...p,operation:'STT_LIVE_AUDIO',chunk:packet.chunk,endOnly:packet.endOnly,audioBase64:Buffer.from(packet.pcm).toString('base64')});await e.command({...p,operation:'STT_LIVE_STOP'});
 assert.equal([...e.timers.values()].filter(t=>t.ms===15000).length,4,'três avisos de bloco e um deadline somente após Stop');for(const text of ['Um.',' Dois.',' Três.']){session.handler({serverContent:{inputTranscription:{text,finished:true}}});await flush();}await e.advance(15001);assert.equal(e.events.find(x=>x.event==='stt-final')?.text,'Um. Dois. Três.');assert.equal(e.attempts.length,1);assert.equal(e.retired.length,1);assert.equal(e.events.some(x=>x.event==='stt-error'),false);assert.equal(e.events.find(x=>x.event==='stt-final').incomplete,true);
});
test('turnComplete sem transcript não fecha antes de inputTranscription independente',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);await e.command(base);await e.command({...base,operation:'STT_LIVE_AUDIO',audioBase64:'AAA=',sampleRate:16000});await e.command({...base,operation:'STT_LIVE_STOP'});
 session.handler({serverContent:{turnComplete:true}});
 for(const [id,timer]of [...e.timers])if(timer.ms<=900){e.timers.delete(id);timer.fn();}await flush();assert.equal(e.retired.length,0);assert.equal(e.events.some(x=>x.event==='stt-error'),false);
 session.handler({serverContent:{inputTranscription:{text:'Teste de ditado.'}}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final')?.text,'Teste de ditado.');
});
test('inputTranscription independente de turnComplete aguarda conclusão sem fechar em 900 ms',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);await e.command(base);await e.command({...base,operation:'STT_LIVE_AUDIO',audioBase64:'AAA='});await e.command({...base,operation:'STT_LIVE_STOP'});
 session.handler({serverContent:{inputTranscription:{text:'Teste'}}});await flush();assert.ok([...e.timers.values()].every(t=>t.ms===15000||t.ms===250));session.handler({serverContent:{inputTranscription:{text:' de ditado.'},turnComplete:true}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final').text,'Teste de ditado.');
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
test('tempo real ignora ACK/evento legado de transformação e insere parcial antes do Stop',async()=>{
 const e=contentEnv(),send=e.runtime.sendMessage.bind(e.runtime);e.runtime.sendMessage=message=>message.type==='STT_LIVE_START'?Promise.resolve({success:true,transform:true}):send(message);e.stt.insertionMode='realtime';await e.stt.startLiveRecording('editor');const jobId=e.stt.liveJobId,generation=e.stt.liveGeneration;await e.stt.handleLiveEvent({jobId,generation,event:'stt-transform-attempt'});await e.stt.handleLiveEvent({jobId,generation,event:'stt-partial',text:'provisório bruto'});assert.equal(e.input.value,'Provisório brutooriginal');assert.equal(e.stt.isRecording,true);await e.stt.handleLiveEvent({jobId,generation,event:'stt-final',text:'provisório bruto'});assert.equal(e.input.value,'Provisório brutooriginal');
});
test('diagnóstico confirma primeira inserção antes do Stop sem texto/chave e preserva edição manual posterior',async()=>{
 const e=contentEnv({diagnostics:true});e.stt.insertionMode='realtime';await e.stt.startLiveRecording('custom');const jobId=e.stt.liveJobId;
 await e.stt.handleLiveEvent({jobId,eventSeq:1,event:'stt-partial',text:'fala pública'});const inserted=e.messages.filter(m=>m.type==='LIVE_STT_DIAGNOSTIC'&&m.payload.stage==='inserted').at(-1).payload;assert.equal(inserted.finalInsertion,false);assert.equal(inserted.whileRecording,true);assert.ok(Number.isFinite(inserted.firstInsertionMs));assert.ok(Number.isFinite(inserted.insertionDurationMs));assert.equal('text'in inserted,false);assert.equal('apiKey'in inserted,false);e.input.value='Edição manual preservada';await e.stt.handleLiveEvent({jobId,eventSeq:2,event:'stt-partial',text:'fala pública completa'});assert.equal(e.input.value,'Edição manual preservada');await e.stt.handleLiveEvent({jobId,eventSeq:3,event:'stt-final',text:'fala pública completa'});assert.equal(e.input.value,'Edição manual preservada');assert.equal(e.stt.getJobState(jobId).inserted,false);assert.equal(e.streams[0].track.stopped,true);
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
 session.handler({serverContent:{turnComplete:true,interactionStatus:'IN_PROGRESS'}});assert.equal(e.events.some(x=>x.event==='stt-final'),false);assert.equal(e.retired.length,0);await flush();assert.ok([...e.timers.values()].every(x=>x.ms===90000||x.ms===250));
 session.handler({serverContent:{interactionStatus:'IDLE'}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final').text,'Teste de ditado.');assert.equal(e.retired.length,1);
});
test('compatibilidade STT Extended sem chunks: IN_PROGRESS/IDLE nunca arma deadline de sessão antes de Stop',async()=>{
 for(const idle of [false,true]){const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session),payload={...base,modelId:'gemini-3.8-live-extended-thinking',realtime:false};await e.command(payload);await e.command({...payload,operation:'STT_LIVE_AUDIO',audioBase64:'AAA='});session.handler({serverContent:{inputTranscription:{text:'Fala anterior.',finished:true},interactionStatus:'IN_PROGRESS'}});if(idle)session.handler({serverContent:{interactionStatus:'IDLE'}});await e.advance(180000);await flush();assert.equal(e.events.some(p=>p.event==='stt-final'||p.event==='stt-error'),false,'estado interno do turno não pode finalizar a sessão de captura');assert.equal(e.retired.length,0);assert.equal((await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'})).activeJobIds.includes(payload.jobId),true);await e.command({...payload,operation:'STT_LIVE_STOP'});session.handler({serverContent:{interactionStatus:'IDLE'}});await e.advance(900);await flush();assert.equal(e.events.find(p=>p.event==='stt-final')?.text,'Fala anterior.');assert.equal(e.retired.length,1);}
});
test('STT completo esgota nove chaves em cada modelo e não tenta unary/Translate',async()=>{
 const e=offscreenEnv(async()=>{throw Error('Quota exceeded');}),result=await e.command({...base,apiKeys:Array.from({length:9},(_,i)=>'fake-'+i),models:[...config.LIVE_MODEL_PRIORITY].reverse().concat('gemini-3.8-flash-tts','gemini-3.5-live-translate-preview')});assert.equal(result.success,false);assert.deepEqual(e.attempts.map(o=>[o.modelId,o.keyIndex]),config.LIVE_MODEL_PRIORITY.flatMap(model=>Array.from({length:9},(_,i)=>[model,i+1])));
});
test('STT nativo acumula inputTranscription parcial/final, ignora output/PCM e não cria player',async()=>{
 const session={sendAudio(){},endAudio(){}},e=offscreenEnv(async()=>session);assert.equal((await e.command(base)).success,true);
 session.handler({serverContent:{inputTranscription:{text:'Olá'}}});session.handler({serverContent:{inputTranscription:{text:' mundo'},outputTranscription:{text:'NÃO inserir'},modelTurn:{parts:[{inlineData:{data:'AAA='}}]}}});await flush();assert.equal(e.events.filter(x=>x.event==='stt-partial').at(-1).text,'Olá mundo');
 await e.command({...base,operation:'STT_LIVE_STOP'});session.handler({serverContent:{turnComplete:true}});e.expire();await flush();assert.equal(e.events.find(x=>x.event==='stt-final').text,'Olá mundo');assert.equal(e.events.some(x=>/play|pcm/.test(x.event)),false);assert.equal(e.retired.length,1);
});
test('fallback STT esgota nove chaves por modelo e respeita modelos compatíveis',async()=>{
 const e=offscreenEnv(async o=>{if(o.modelId===base.modelId)throw Error('Quota exceeded');return{endAudio(){}};});assert.equal((await e.command({...base,apiKeys:Array.from({length:9},(_,i)=>'fake-'+i),models:[base.modelId,'gemini-3.5-transcribe-live','gemini-3.5-flash-lite','gemini-3.5-live-translate-preview','gemini-3.8-live-extended-thinking']})).success,true);
 assert.deepEqual(e.attempts.map(o=>[o.modelId,o.keyIndex]),[...Array.from({length:9},(_,i)=>[base.modelId,i+1]),['gemini-3.8-live-extended-thinking',1]]);await e.command({...base,operation:'STT_LIVE_CANCEL'});
});
test('offscreen não abre sessão especializada mesmo em payload antigo direto',async()=>{const e=offscreenEnv(async()=>{throw Error('não deve conectar');}),result=await e.command({...base,modelId:'gemini-3.5-transcribe-live',models:['gemini-3.5-transcribe-live']});assert.equal(result.success,false);assert.equal(e.attempts.length,0);});
test('cancelamento STT durante acquire retira sessão tardia e não anuncia setup',async()=>{
 const pending=deferred(),session={},e=offscreenEnv(()=>pending.promise),started=e.command(base);for(let n=0;n<1000&&!e.attempts.length;n++)await flush();assert.equal(e.attempts.length,1);await e.command({...base,operation:'STT_LIVE_CANCEL'});pending.resolve(session);assert.equal((await started).success,false);assert.equal(e.retired[0],session);assert.equal(e.events.some(x=>x.event==='setup-complete'),false);
});
test('worklet flush entrega cauda menor que 100 ms antes da confirmação',()=>{
 let Processor;const messages=[],context=vm.createContext({sampleRate:48000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},registerProcessor(_id,cls){Processor=cls;}});vm.runInContext(fs.readFileSync(require.resolve('../mic-capture-worklet.js'),'utf8'),context);const p=new Processor();p.process([[new Float32Array([.2,.4,.6])]]);assert.equal(messages.length,0);p.port.onmessage({data:{type:'flush'}});assert.equal(new Float32Array(messages[0]).length,3);assert.equal(messages[1].type,'flushed');p.port.onmessage({data:{type:'flush'}});assert.equal(messages.length,3);
});

test('repetições não reiniciam o STT, mas novo acionamento abre captura com ACK de Stop anterior pendente',async()=>{
 for(const mode of ['final','realtime']){
  const e=contentEnv();
  loadEntrypoint(e,{get:async key=>key==='ui'?{dictationInsertion:mode}:{},subscribe(){}});
  e.events.DOMContentLoaded();await flush();
  const key={key:' ',code:'Space',ctrlKey:true,shiftKey:true,altKey:false,preventDefault(){}};
  e.events.keydown(key);e.events.keyup(key);await flush();
  assert.equal(e.stt.isRecording,true);
  const first=e.stt.liveCapture;
  e.nodes[0].port.onmessage({data:new Float32Array(4800).fill(.1).buffer});
  const send=e.runtime.sendMessage.bind(e.runtime),stop=deferred();
  e.runtime.sendMessage=message=>message.type==='STT_LIVE_STOP'
   ?(e.messages.push(message),stop.promise):send(message);
  e.events.keydown(key);await flush();
  assert.equal(e.stt.liveCapture,null);
  assert.ok(e.messages.some(m=>m.type==='STT_LIVE_STOP'&&m.payload.jobId===first.jobId));
  e.events.keydown(key);e.events.keydown({...key,repeat:true});
  assert.equal(e.stt.liveCapture,null);
  assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_START').length,1);
  e.events.keyup(key);
  const message={type:'CMD_START_DICTATION',payload:{commandId:'next-start'}};
  e.messageListener(message,{},()=>{});
  await flush();
  e.messageListener(message,{},()=>{});
  assert.equal(e.stt.isRecording,true);
  const second=e.stt.liveCapture;
  stop.resolve({success:true});await flush();
  await e.stt.handleLiveEvent({jobId:first.jobId,generation:first.generation,event:'stt-error',error:'Falha atrasada'});
  assert.equal(e.stt.liveCapture,second);
  assert.equal(e.streams[0].track.stopped,true);
  assert.equal(e.streams[1].track.stopped,false);
  e.events.keydown(key);e.events.keyup(key);await flush();
  assert.equal(e.stt.isRecording,false);
  assert.equal(e.messages.filter(m=>m.type==='STT_LIVE_START').length,2);
 }
});
