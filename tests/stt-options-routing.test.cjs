const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const config=require('../live-config.js'),source=fs.readFileSync(require.resolve('../options.js'),'utf8'),flush=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function optionsEnv({slowMic=false,slowSetup=false}={}){
 const elements=new Map(),messages=[],streams=[],contexts=[],nodes=[],micReady=deferred(),setupReady=deferred();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='#liveSttModel'?'gemini-3.8-live':'',checked:false,textContent:''});return elements.get(id);};
 function stream(){const track={stopped:false,stop(){this.stopped=true;}};const s={track,getTracks:()=>[track]};streams.push(s);return s;}
 class AudioContext{constructor(){this.sampleRate=48000;this.destination={};this.state='suspended';this.audioWorklet={addModule:async()=>{}};contexts.push(this);}createMediaStreamSource(){return{connect:x=>x,disconnect(){}};}createGain(){return{gain:{value:1},connect:x=>x,disconnect(){}};}async resume(){this.state='running';}async close(){this.state='closed';}}
 class Node{constructor(){nodes.push(this);this.port={postMessage:m=>{if(m.type==='flush')this.port.onmessage({data:{type:'flushed'}});}};}connect(x){return x;}disconnect(){this.disconnected=true;}}
 const context=vm.createContext({console,structuredClone,crypto:crypto.webcrypto,setTimeout,clearTimeout,btoa,Float32Array,Int16Array,Uint8Array,AudioContext,AudioWorkletNode:Node,navigator:{mediaDevices:{getUserMedia:async()=>slowMic?micReady.promise:stream()}},LiveConfig:config,$:element,currentAgent:{metadata:{id:'custom'},live:{stt:{}}},pullAgentFromFields(){},clone:structuredClone,liveDraft(){return context.currentAgent.live;},chrome:{runtime:{getURL:x=>x,async sendMessage(m){messages.push(m);if(m.type==='STT_LIVE_START'&&slowSetup)return setupReady.promise;return{success:true};}}}});
 vm.runInContext("let livePreview=null,liveMic=null,liveSttJobId=null,liveSttCommitted='';"+source.slice(source.indexOf('function resampleLiveTest('),source.indexOf('async function main('))+";globalThis.testApi={toggleLiveSttTest,releaseLiveSttTest,getMic:()=>liveMic,getJob:()=>liveSttJobId};",context);
 const line=source.split('\n').find(line=>line.startsWith(' chrome.runtime.onMessage.addListener(message=>'));
 vm.runInContext('globalThis.eventHandler='+line.slice(line.indexOf('(message=>')+1,-2)+';',context);
 return{...context.testApi,eventHandler:context.eventHandler,elements,messages,streams,contexts,nodes,stream,micReady,setupReady,context,element};
}
test('opções STT: final/erro liberam microfone e AudioContext sem clique extra',async()=>{
 for(const event of ['stt-final','stt-error']){const e=optionsEnv();await e.toggleLiveSttTest();const jobId=e.getJob();e.eventHandler({type:'LIVE_OPTIONS_EVENT',payload:{jobId,event,text:'Texto sintético',error:'erro sintético'}});await flush();assert.equal(e.getJob(),null);assert.equal(e.getMic(),null);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.element('#recordStt').textContent,'Iniciar gravação');}
});
test('opções STT: falha do contexto no início encerra trilhas e cancela sessão',async()=>{const e=optionsEnv();e.context.AudioContext.prototype.resume=async()=>{throw Error('contexto indisponível');};await e.toggleLiveSttTest();assert.equal(e.getJob(),null);assert.equal(e.getMic(),null);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.ok(e.messages.some(m=>m.type==='STT_LIVE_CANCEL'));});
test('opções STT: parada envia PCM antes de STOP e aguarda final sem nova gravação',async()=>{
 const e=optionsEnv();await e.toggleLiveSttTest();const mic=e.getMic();e.nodes[0].port.onmessage({data:new Float32Array([.1,.2,.3]).buffer});await e.toggleLiveSttTest();await e.toggleLiveSttTest();assert.equal(e.streams[0].track.stopped,true);assert.equal(e.contexts[0].state,'closed');assert.equal(e.getMic(),null);assert.equal(e.getJob(),mic.jobId);assert.deepEqual(e.messages.map(m=>m.type),['STT_LIVE_START','STT_LIVE_AUDIO','STT_LIVE_STOP']);
});
test('opções STT: cancelar início pendente impede gravação e encerra stream tardio',async()=>{
 for(const phase of ['microphone','setup']){const e=optionsEnv({slowMic:phase==='microphone',slowSetup:phase==='setup'}),started=e.toggleLiveSttTest();await flush();await e.toggleLiveSttTest();if(phase==='microphone')e.micReady.resolve(e.stream());else e.setupReady.resolve({success:true});await started;assert.equal(e.getJob(),null);assert.equal(e.getMic(),null);assert.equal(e.streams[0].track.stopped,true);assert.equal(e.nodes.length,0);assert.ok(e.messages.some(m=>m.type==='STT_LIVE_CANCEL'));}
});
test('opções mantêm vocabulário/SMART legados desativados entre modelos gerais',()=>{
 const e=optionsEnv();e.element('#liveSttVocabulary').value='termo preservado';e.element('#liveSttSmart').checked=true;
 vm.runInContext(source.slice(source.indexOf('function updateLiveSttCapabilities('),source.indexOf('function syncLiveFields(')),e.context);
 e.context.updateLiveSttCapabilities();assert.equal(e.element('#liveSttVocabulary').disabled,true);assert.equal(e.element('#liveSttSmart').disabled,true);
 e.element('#liveSttModel').value='gemini-3.8-live-extended-thinking';e.context.updateLiveSttCapabilities();assert.equal(e.element('#liveSttVocabulary').disabled,true);assert.equal(e.element('#liveSttSmart').disabled,true);assert.equal(e.element('#liveSttVocabulary').value,'termo preservado');assert.equal(e.element('#liveSttSmart').checked,true);
});
function backgroundEnv(agent,models={sttModelId:'gemini-3.8-live'}){
 const forwarded=[],stored=[],sent=[];
 const context=vm.createContext({structuredClone,AbortController,console,setTimeout,clearTimeout,chrome:{runtime:{getURL:x=>'chrome-extension://test/'+x,sendMessage:async m=>{sent.push(m);return{success:true};}},tabs:{sendMessage:async(...args)=>sent.push(args)}}});
 vm.runInContext(require('./load-background.cjs')(require.resolve('../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);
 const cache={},overrides={
  'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:{get:async key=>key==='audio'?{legacyUnaryAudio:true}: {},getMany:async()=>({api:{apiKey:'fake-only',apiKeys:['fake-only','fake-two']},agents:{customAgents:[agent]},models,audio:{}}),update:async()=>{},setMultiple:async v=>stored.push(v)}},
  'extension/src/services/backgroundPlayback.ts':{handlePlaybackCommand:async(payload,sender)=>{forwarded.push({payload,sender});return{success:true};}},
  'extension/src/services/diagnosticLogger.ts':{logDiagnostic:async()=>{}},
 };
 function load(id){if(overrides[id])return overrides[id];if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};context.modules[id](m,m.exports,load);return m.exports;}
 const router=load('extension/src/background/messageRouter.ts');return{forwarded,stored,sent,run:(type,payload={jobId:'stt',agentId:agent.metadata.id},sender={url:'https://example.test/',tab:{id:5},frameId:2})=>router.handleExtensionMessage({type,payload},sender)};
}
test('background escolhe modelo global Live quando agente só contém legado',async()=>{
 const e=backgroundEnv({metadata:{id:'custom'},modelPreferences:{sttModelId:'gemini-3.5-transcribe'},instructions:{}},{sttModelId:'gemini-3.8-live-extended-thinking'});assert.equal((await e.run('STT_LIVE_START')).success,true);const p=e.forwarded[0].payload;assert.equal(p.modelId,'gemini-3.8-live-extended-thinking');assert.deepEqual(Array.from(p.models),config.modelChain('stt','gemini-3.8-live-extended-thinking'));assert.equal(e.stored.length,0);
});
test('TTS global/agente/editor encaminham modelo efetivo Live sem execução legada',async()=>{
 for(const preferredModel of ['gemini-3.8-flash-tts','gemini-3.1-flash-live-preview']){
  const agent={metadata:{id:'narrator'},voice:{},instructions:{},modelPreferences:{ttsModelId:'gemini-3.8-flash-lite-tts'},live:{preferredModel}},models={ttsModelId:'gemini-2.5-flash-native-audio-preview-12-2025'},before=structuredClone(agent),e=optionsEnv();e.context.currentAgent=structuredClone(agent);e.context.state={models,audio:{}};e.context.Option=class{constructor(text,value){this.text=text;this.value=value;}};e.context.updateLivePreview=()=>{};
  for(const id of [...source.matchAll(/\$\('(#[\w]+)'\)/g)].map(m=>m[1])){const el=e.element(id);el.options=[];el.add=o=>el.options.push(o);el.classList={toggle(){}};}
  vm.runInContext(source.slice(source.indexOf('function liveDraft('),source.indexOf('function syncLiveFields(')),e.context);e.context.renderLiveEditor();
  e.context.CHAINS={vision:[],general:[]};e.context.fillSelect=(el,ids,value)=>{el.options=Array.from(ids);el.value=value;};vm.runInContext(source.slice(source.indexOf('function initModelSelects('),source.indexOf('function renderAgentSelect(')),e.context);e.context.initModelSelects();
  const routed=backgroundEnv(agent,models);await routed.run('TTS_REQUEST',{agentId:'narrator',text:'Teste.'});const payload=routed.forwarded[0].payload;
  assert.equal(e.element('#liveModel').value,payload.modelId);assert.equal(e.element('#agentTtsModel').value,payload.modelId);assert.deepEqual(e.element('#agentTtsModel').options,config.LIVE_TTS_MODELS);assert.equal(e.element('#globalTts').value,models.ttsModelId);assert.deepEqual(Array.from(payload.models),config.modelChain('tts',payload.modelId));assert.equal(payload.operation,'TTS_LIVE_START');assert.deepEqual(agent,before);assert.equal(routed.stored.length,0);
 }
});
test('diagnóstico TTS unary não pode acionar serviço antigo',async()=>{
 const e=backgroundEnv({metadata:{id:'narrator'}}),result=await e.run('TTS_DIAGNOSTIC_REQUEST',{request:{modelId:'gemini-3.8-flash-tts'}},{url:'chrome-extension://test/options.html'});assert.equal(result.success,false);assert.match(result.error,/unary desativado/);assert.equal(e.forwarded.length,0);
});
test('background substitui escolha inelegível sem apagar legado/fallback/instruções',async()=>{
 const agent={metadata:{id:'custom'},instructions:{sttFormattingInstruction:'Formate.'},live:{preferredModel:'gemini-3.8-live',stt:{preferredModel:'gemini-3.5-transcribe-live',fallbackModels:['gemini-3.5-transcribe-live','gemini-3.8-live'],smartTranscription:false,customVocabulary:['termo'],transform:false}}},before=structuredClone(agent),e=backgroundEnv(agent);await e.run('STT_LIVE_START');const p=e.forwarded[0].payload;assert.equal(p.modelId,'gemini-3.8-live');assert.deepEqual(Array.from(p.models),config.LIVE_STT_MODELS);assert.equal(p.smartTranscription,false);assert.deepEqual(Array.from(p.customVocabulary),['termo']);assert.equal(p.transformInstruction,null);assert.equal(e.stored.length,0);assert.deepEqual(agent,before);
});
test('seletores STT global/agente/editor apresentam exatamente o modelo usado',async()=>{
 for(const preferredModel of ['gemini-3.5-transcribe-live','gemini-3.8-live-extended-thinking']){
  const agent={metadata:{id:'narrator'},voice:{},instructions:{},modelPreferences:{},live:{stt:{preferredModel,customVocabulary:['legado'],smartTranscription:false}}},models={sttModelId:'gemini-3.5-transcribe-live'},e=optionsEnv();e.context.currentAgent=structuredClone(agent);e.context.state={models,audio:{}};
  e.context.Option=class{constructor(text,value){this.text=text;this.value=value;}};e.context.updateLivePreview=()=>{};
  for(const id of [...source.matchAll(/\$\('(#[\w]+)'\)/g)].map(m=>m[1])){const el=e.element(id);el.options=[];el.add=o=>el.options.push(o);el.classList={toggle(){}};}
  vm.runInContext(source.slice(source.indexOf('function liveDraft('),source.indexOf('function syncLiveFields(')),e.context);e.context.renderLiveEditor();
  const routed=backgroundEnv(agent,models);await routed.run('STT_LIVE_START',{jobId:'stt',agentId:'narrator'});const actual=routed.forwarded[0].payload.modelId;
  assert.equal(e.element('#liveSttModel').value,actual);assert.deepEqual(e.element('#liveSttModel').options.map(o=>o.value),config.LIVE_STT_MODELS);assert.equal(e.element('#liveSttVocabulary').value,'legado');assert.equal(e.element('#liveSttSmart').checked,false);
  e.context.CHAINS={tts:[],vision:[],general:[]};e.context.fillSelect=(el,ids,value)=>{el.options=Array.from(ids);el.value=value;};vm.runInContext(source.slice(source.indexOf('function initModelSelects('),source.indexOf('function renderAgentSelect(')),e.context);e.context.initModelSelects();
  assert.equal(e.element('#agentSttModel').value,actual);assert.deepEqual(e.element('#agentSttModel').options,config.LIVE_STT_MODELS);assert.deepEqual(e.element('#globalStt').options,config.LIVE_STT_MODELS);assert.equal(e.element('#globalStt').value,config.DEFAULTS.sttModelId);
  assert.ok(!routed.forwarded[0].payload.models.includes('gemini-3.5-transcribe-live'));
 }
});
test('background conserva escolha geral e filtra fallback legado sem mudar ordem',async()=>{
 const agent={metadata:{id:'custom'},instructions:{},live:{stt:{preferredModel:'gemini-3.8-live-extended-thinking',fallbackModels:['gemini-3.5-transcribe-live','gemini-3.5-flash-lite','gemini-3.8-live']}}},before=structuredClone(agent),e=backgroundEnv(agent);await e.run('STT_LIVE_START');assert.equal(e.forwarded[0].payload.modelId,'gemini-3.8-live-extended-thinking');assert.deepEqual(Array.from(e.forwarded[0].payload.models),config.modelChain('stt','gemini-3.8-live-extended-thinking'));assert.deepEqual(agent,before);
});
test('salvar modelos globais conserva seleção STT antiga antes de substituí-la',async()=>{
 const e=optionsEnv(),writes=[];e.context.state={models:{sttModelId:'gemini-3.5-transcribe-live',visionModelId:'preservado'}};e.context.deepMerge=config.deepMerge;e.context.chrome.storage={local:{set:async packet=>writes.push(structuredClone(packet))}};
 vm.runInContext(source.slice(source.indexOf('async function saveNs('),source.indexOf('function notice(')),e.context);await e.context.saveNs('models',{sttModelId:'gemini-3.8-live'});assert.equal(writes[0].models.legacySttModelId,'gemini-3.5-transcribe-live');assert.equal(writes[0].models.sttModelId,'gemini-3.8-live');assert.equal(writes[0].models.visionModelId,'preservado');await e.context.saveNs('models',{sttModelId:'gemini-3.8-live-extended-thinking'});assert.equal(writes[1].models.legacySttModelId,'gemini-3.5-transcribe-live');
});
test('background rejeita unary mesmo com flag legado e não inicia captura',async()=>{
 const e=backgroundEnv({metadata:{id:'custom'}}),result=await e.run('STT_TRANSCRIBE_REQUEST');assert.equal(result.success,false);assert.match(result.error,/WebSocket/);assert.equal(e.forwarded.length,0);
});
test('background encaminha setup STT para controller STT sem alterar TTS',async()=>{
 const e=backgroundEnv({metadata:{id:'custom'}});await e.run('LIVE_OFFSCREEN_EVENT',{tabId:5,frameId:2,operation:'STT_LIVE_START',event:'setup-complete'},{url:'chrome-extension://test/offscreen.html'});assert.equal(e.sent[0][1].type,'STT_LIVE_EVENT');await e.run('LIVE_OFFSCREEN_EVENT',{tabId:5,frameId:2,operation:'TTS_LIVE_START',event:'setup-complete'},{url:'chrome-extension://test/offscreen.html'});assert.equal(e.sent[1][1].type,'TTS_PLAYBACK_EVENT');
});
