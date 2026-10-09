const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function environment(sampleRate=24000){
 const events=[],contexts=[],nodes=[];let listener;
 class AudioContext{constructor(){this.sampleRate=sampleRate;this.state='suspended';this.audioWorklet={addModule:async()=>{}};this.destination={};contexts.push(this);}createGain(){return{gain:{value:1},connect(target){this.target=target;return target;}};}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
 class AudioWorkletNode{constructor(){this.sent=[];this.port={postMessage:(data,transfer)=>{this.sent.push(structuredClone(data,{transfer}));}};nodes.push(this);}connect(target){return target;}}
 const context=vm.createContext({console,performance,AudioContext,AudioWorkletNode,structuredClone,DataView,Float32Array,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval(){},clearInterval(){},chrome:{runtime:{getURL:x=>x,onMessage:{addListener(fn){listener=fn;}},sendMessage(msg){events.push(msg.payload);return Promise.resolve();}}},LiveSessions:{LiveSessionManager:class{}},LiveConfig:require('../live-config.js')});
 const source=fs.readFileSync(require.resolve('../offscreen.js'),'utf8');
 vm.runInContext(source.replace(/\}\)\(\);\s*$/,'globalThis.underTest={toFloat,pcmFormat,OrderedPlaybackBuffer};})();'),context);
 return{...context.underTest,events,contexts,nodes,context,command:payload=>new Promise(resolve=>listener({target:'offscreen',type:'LIVE_OFFSCREEN_COMMAND',payload},{},resolve))};
}
test('PCM Int16 LE escala corretamente, respeita byteOffset, recusa ímpar/WAV/estéreo',()=>{
 const e=environment(),bytes=new Uint8Array([99,0,128,0,0,255,127,99]).subarray(1,7),f=e.toFloat(bytes,1);
 assert.deepEqual(Array.from(f),[-1,0,32767/32768]);assert.equal(e.toFloat(new Uint8Array(),1).length,0);
 assert.throws(()=>e.toFloat(new Uint8Array(3),1),/ímpar/);
 assert.throws(()=>e.pcmFormat(new Uint8Array(2),'audio/pcm;rate=24000;channels=2'),/um canal/);
 assert.throws(()=>e.pcmFormat(new TextEncoder().encode('RIFF0000WAVE')),/WAV/);
});
test('fila usa sampleRate real, transfere Float32 sem perder fonte, play só após consumo',async()=>{
 const e=environment(48000),p=new e.OrderedPlaybackBuffer({jobId:'j',playerId:'p',volume:.4,playbackRate:1});await p.init();
 const bytes=new Uint8Array([0,128,255,127]);p.add(0,bytes,false,'audio/pcm;rate=24000');
 assert.equal(e.nodes[0].sent.find(x=>x.type==='enqueue').buffer.byteLength,16);assert.equal(bytes.byteLength,4);assert.equal(p.pending,1);
 assert.equal(e.events.some(x=>x.event==='play'),false);
 e.nodes[0].port.onmessage({data:{type:'first-played',blockId:0,frames:4}});assert.equal(e.events.filter(x=>x.event==='play').length,1);
 assert.equal(e.events.find(x=>x.stage==='destination-connected').volume,.4);
 await p.pause(true);assert.equal(p.ctx.state,'suspended');p.add(1,bytes);assert.equal(e.nodes[0].sent.filter(x=>x.type==='enqueue').length,1);
 await p.pause(false);assert.equal(p.ctx.state,'running');p.stop();assert.equal(p.ctx.state,'closed');assert.equal(p.pending,0);
 const count=e.events.length;e.nodes[0].port.onmessage({data:{type:'first-played'}});assert.equal(e.events.length,count);
});
test('worklet emite frames, pausa sem consumir, retoma e flush descarta fila',()=>{
 let Processor;const messages=[];const context=vm.createContext({AudioWorkletProcessor:class{constructor(){this.port={postMessage:x=>messages.push(x)};}},Float32Array,registerProcessor(_name,cls){Processor=cls;}});
 vm.runInContext(fs.readFileSync(require.resolve('../pcm-player-worklet.js'),'utf8'),context);const p=new Processor(),output=new Float32Array(4);
 p.port.onmessage({data:{type:'enqueue',buffer:new Float32Array([.25,-.5,.75]).buffer,blockId:0}});
 p.port.onmessage({data:{type:'pause',value:true}});p.process([],[[output]]);assert.deepEqual(Array.from(output),[0,0,0,0]);assert.equal(messages.length,0);
 p.port.onmessage({data:{type:'pause',value:false}});p.process([],[[output]]);assert.deepEqual(Array.from(output),[.25,-.5,.75,0]);assert.equal(messages[0].type,'first-played');assert.equal(messages[0].frames,1);assert.equal(messages[1].type,'drain');
 p.port.onmessage({data:{type:'enqueue',buffer:new Float32Array([1]).buffer}});p.port.onmessage({data:{type:'flush'}});p.process([],[[output]]);assert.deepEqual(Array.from(output),[0,0,0,0]);
 p.port.onmessage({data:{type:'enqueue',buffer:new Float32Array([.1,.2,.3,.4]).buffer}});p.port.onmessage({data:{type:'rate',value:2}});p.process([],[[output]]);assert.ok(Math.abs(output[0]-.1)<1e-6);assert.ok(Math.abs(output[1]-.3)<1e-6);assert.equal(output[2],0);
});
test('regressão STT offscreen mantém envio PCM, partial, final e encerramento',async()=>{
 const e=environment(),audio=[],session={socketOpenMs:1,setupCompleteMs:2,sendAudio(bytes,rate){audio.push([bytes.length,rate]);},endAudio(){this.ended=true;}};
 e.context.LiveSessions.LiveSessionManager.prototype.acquire=async()=>session;e.context.LiveSessions.LiveSessionManager.prototype.retire=()=>{};
 e.context.LiveSessions.decodeBase64=x=>new Uint8Array(Buffer.from(x,'base64'));
 const payload={jobId:'stt',modelId:'gemini-3.8-live',apiKeys:['fake-only']};assert.equal((await e.command({...payload,operation:'STT_LIVE_START'})).success,true);
 await e.command({...payload,operation:'STT_LIVE_AUDIO',audioBase64:'AAA=',sampleRate:16000});assert.deepEqual(audio,[[2,16000]]);
 session.handler({serverContent:{interimInputTranscription:{text:'Teste'},inputTranscription:{text:'Teste completo.'}}});assert.equal(e.events.find(x=>x.event==='stt-partial').text,'Teste');
 await e.command({...payload,operation:'STT_LIVE_STOP'});assert.equal(session.ended,true);session.handler({serverContent:{turnComplete:true}});await new Promise(r=>setTimeout(r,1000));assert.equal(e.events.find(x=>x.event==='stt-final').text,'Teste completo.');
});
test('Ouvir inicia seleção com agente ativo sem substituir tarefa em andamento/replay',()=>{
 const source=fs.readFileSync(require.resolve('../content.js'),'utf8'),start=source.indexOf('    hudController_1.hud.onPlayPauseClick ='),end=source.indexOf('    hudController_1.hud.onStopClick',start),calls=[];
 const tts={activeTask:null,isProcessing:false,speakText:(...args)=>calls.push(args),togglePlayPause:()=>calls.push('toggle')},hud={};
 vm.runInNewContext(source.slice(start,end),{hudController_1:{hud},ttsController_1:{tts},textExtractor_1:{getCleanSelectedText:()=>({cleaned:'Teste de áudio.'})},cachedActiveAgentId:'narrator'});
 hud.onPlayPauseClick();assert.deepEqual(calls[0],['Teste de áudio.','narrator']);tts.activeTask={};hud.onPlayPauseClick();assert.equal(calls[1],'toggle');
});
test('ditado simples não transforma; agente transforma antes de publicar final',async()=>{
 for(const transformInstruction of [undefined,'Formate o resultado.']){
  const e=environment(),calls=[],stt={socketOpenMs:1,setupCompleteMs:2,endAudio(){}},transform={sendTurn:async(text,_callback,signal)=>{assert.equal(text,'fala original');assert.equal(signal.aborted,false);return{text:'resultado formatado'};}};
  e.context.LiveSessions.LiveSessionManager.prototype.acquire=async options=>{calls.push(options);return calls.length===1?stt:transform;};e.context.LiveSessions.LiveSessionManager.prototype.retire=()=>{};e.context.LiveSessions.LiveSessionManager.prototype.release=()=>{};
  const payload={jobId:'stt-transform',modelId:'gemini-3.8-live',apiKeys:['fake-only'],transformInstruction};await e.command({...payload,operation:'STT_LIVE_START'});stt.handler({serverContent:{inputTranscription:{text:'fala original'}}});await e.command({...payload,operation:'STT_LIVE_STOP'});stt.handler({serverContent:{turnComplete:true}});await new Promise(r=>setTimeout(r,1000));
  assert.equal(calls.length,transformInstruction?2:1);assert.equal(e.events.find(x=>x.event==='stt-final').text,transformInstruction?'resultado formatado':'fala original');
  if(transformInstruction){assert.equal(calls[1].modelId,'gemini-3.8-live');assert.equal(calls[1].systemInstruction,transformInstruction);assert.equal(calls[1].outputTranscription,true);}
 }
});
test('BackgroundAudio Live retoma sem src unary e conserva requestId',async()=>{
 const calls=[],context=vm.createContext({EventTarget,Event,console,chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async msg=>{calls.push(msg.payload);return{success:true};}}}});
 const source=fs.readFileSync(require.resolve('../content.js'),'utf8');vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");','globalThis.modules=__modules;'),context);
 const module={exports:{}};context.modules['extension/src/content/audio/backgroundAudio.ts'](module,module.exports,()=>{});const audio=new module.exports.BackgroundAudio();audio.reserve();const requestId=audio.requestId;audio.live=true;
 await audio.play();assert.equal(calls[0].operation,'RESUME');assert.equal('src' in calls[0],false);assert.equal(audio.requestId,requestId);audio.pause();assert.equal(calls[1].operation,'PAUSE');
 const start=source.indexOf('    togglePlayPause() {'),end=source.indexOf('    playBase64Audio(',start),method=source.slice(start,end).replace('togglePlayPause()','function togglePlayPause()');
 const testContext={console,audio,called:0};vm.runInNewContext(method+';audio.play=async()=>{called++;};togglePlayPause.call({audio,isFetchingChunk:false});',testContext);assert.equal(testContext.called,1);
});
