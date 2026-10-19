const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function environment(sampleRate=24000){
 const events=[],contexts=[],nodes=[];let listener;
 class AudioContext{constructor(){this.sampleRate=sampleRate;this.state='suspended';this.audioWorklet={addModule:async()=>{}};this.destination={};this.gains=[];contexts.push(this);}createGain(){const node={gain:{value:1},connect(target){this.target=target;return target;}};this.gains.push(node);return node;}createBiquadFilter(){return{frequency:{value:0},gain:{value:0},Q:{value:0},connect(target){this.target=target;return target;}};}createConvolver(){return{connect(target){this.target=target;return target;}};}createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{numberOfChannels:channels,length,sampleRate,getChannelData:channel=>data[channel]};}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
 // Run the real processor's message handler; only the AudioContext is simulated here.
 let Processor;vm.runInNewContext(fs.readFileSync(require.resolve('../pcm-player-worklet.js'),'utf8'),{sampleRate,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(_name,type)=>Processor=type});
 class AudioWorkletNode{constructor(){this.sent=[];this.processor=new Processor();this.processor.port.postMessage=data=>queueMicrotask(()=>this.port.onmessage?.({data}));this.port={postMessage:(data,transfer)=>{const copy=structuredClone(data,{transfer});this.sent.push(copy);this.processor.port.onmessage({data:copy});}};nodes.push(this);}connect(target){return target;}}
 const context=vm.createContext({console,performance,AudioContext,AudioWorkletNode,structuredClone,DataView,Float32Array,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval(){},clearInterval(){},chrome:{runtime:{getURL:x=>x,onMessage:{addListener(fn){listener=fn;}},sendMessage(msg){if(['LIVE_OFFSCREEN_EVENT','TTS_PLAYBACK_EVENT'].includes(msg.type))events.push(msg.payload);return Promise.resolve({success:true});}}},LiveSessions:{LiveSessionManager:class{}},SttScheduler:require('../stt-scheduler.js'),LiveConfig:require('../live-config.js')});
 const source=fs.readFileSync(require.resolve('../offscreen.js'),'utf8');
 vm.runInContext(source.replace(/\}\)\(\);\s*$/,'globalThis.underTest={toFloat,pcmFormat,OrderedPlaybackBuffer};})();'),context);
 return{...context.underTest,events,contexts,nodes,context,command:payload=>new Promise(resolve=>listener({target:'offscreen',type:'LIVE_OFFSCREEN_COMMAND',payload},{},resolve))};
}
test('comandos Live sem player ou com request antigo não confirmam pausa inexistente',async()=>{
 const e=environment();for(const operation of ['PAUSE','RESUME','SEEK_PCM']){
  const reply=await e.command({operation,jobId:'missing',playerId:'p',requestId:'old',deltaSeconds:5});
  assert.equal(reply.success,false,operation+' sem player não pode retornar sucesso');
 }
});
test('AudioContext que não suspendeu não pode publicar pausa confirmada',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'pause-failed',playerId:'p'});await p.init();
 p.ctx.suspend=async()=>{};await assert.rejects(p.pause(true),/suspend|pausa/i);
 assert.equal(p.paused,false);assert.equal(e.events.some(event=>event.event==='pause'),false);p.stop();
});
test('pausa ACK silencia ganho final inclusive cauda DSP; volume não desmuta e retoma cursor',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'pause-dsp',playerId:'p',volume:.6,ambience:'hall'});await p.init();p.add(0,new Uint8Array(24000*2*30),true);
 const processor=e.nodes[0].processor;processor.process([],[[new Float32Array(24000*8)]]);await new Promise(r=>setImmediate(r));
 const frame=processor.cursor;await p.pause(true);const status=p.status();assert.equal(status.contextState,'suspended');assert.equal(status.workletPaused,true);assert.equal(status.outputMuted,true);assert.equal(status.positionFrame,frame);assert.ok(status.controlSeq>0);
 p.set(.25,1.2);assert.equal(p.gain.gain.value,0);processor.process([],[[new Float32Array(128)]]);assert.equal(processor.cursor,frame);
 await p.pause(false);assert.equal(p.gain.gain.value,.25);assert.equal(p.status().workletPaused,false);assert.equal(processor.cursor,frame);p.stop();
});
test('seek simultâneo é serial, cumulativo, preserva pausa e não altera outro player',async()=>{
 const e=environment(),a=new e.OrderedPlaybackBuffer({jobId:'a'}),b=new e.OrderedPlaybackBuffer({jobId:'b'});await a.init();await b.init();a.add(0,new Uint8Array(24000*2*40),true);b.add(0,new Uint8Array(24000*2*40),true);
 const processor=e.nodes[0].processor;processor.process([],[[new Float32Array(24000*12)]]);await new Promise(r=>setImmediate(r));await a.pause(true);
 await Promise.all([a.seek(5),a.seek(5),a.seek(-5)]);assert.equal(a.positionFrame,24000*17);assert.equal(a.ctx.state,'suspended');assert.equal(a.gain.gain.value,0);assert.equal(b.positionFrame,0);assert.equal(b.ctx.state,'running');a.stop();b.stop();
});
test('ACK velho/errado não confirma comando e Stop rejeita espera sem publicar pausa',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'ack'});await p.init();const node=e.nodes[0];node.port.postMessage=data=>node.sent.push(data);
 const pausing=p.pause(true);await new Promise(r=>setImmediate(r));const sent=node.sent.at(-1),ack={type:'control-ack',command:'pause',controlSeq:sent.controlSeq,paused:true,frame:0,availableStart:0};
 node.port.onmessage({data:{...ack,controlSeq:sent.controlSeq-1}});node.port.onmessage({data:{...ack,command:'seek'}});node.port.onmessage({data:{...ack,paused:false}});assert.equal(p.ackSeq,0);assert.equal(p.paused,false);
 const rejected=assert.rejects(pausing,/encerrado/);p.stop();await rejected;node.port.onmessage({data:ack});assert.equal(e.events.some(event=>event.event==='pause'),false);assert.equal(p.ctx.state,'closed');
});
test('pausa durante inicialização espera o contexto e eventos first-played atrasados não retomam',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'early-pause'});let release;const original=e.context.AudioContext.prototype.resume;e.context.AudioContext.prototype.resume=async function(){await new Promise(r=>release=r);return original.call(this);};
 const init=p.init();await new Promise(r=>setImmediate(r));const pausing=p.pause(true);release();await init;await pausing;e.nodes[0].port.onmessage({data:{type:'first-played',blockId:0}});await new Promise(r=>setImmediate(r));assert.equal(p.ctx.state,'suspended');assert.equal(e.events.some(event=>event.event==='play'),false);p.stop();
});
test('worklet sem ACK expira sem sucesso visual; ACK posterior não ressuscita o comando',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'timeout'});await p.init();let expire;e.context.setTimeout=(fn,ms)=>ms===3000?(expire=fn,1):setTimeout(fn,ms);e.context.clearTimeout=id=>{if(id!==1)clearTimeout(id);};e.nodes[0].port.postMessage=()=>{};
 const pausing=p.pause(true);await new Promise(r=>setImmediate(r));const rejected=assert.rejects(pausing,/Worklet não confirmou/);expire();await rejected;assert.equal(p.paused,false);assert.equal(p.gain.gain.value,0);assert.equal(p.ctx.state,'suspended');assert.equal(p.controlAcks.size,0);p.stop();
});
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
 e.nodes[0].port.onmessage({data:{type:'first-played',blockId:0,frames:4}});await new Promise(r=>setImmediate(r));assert.equal(e.events.filter(x=>x.event==='play').length,1);
 assert.equal(e.events.find(x=>x.stage==='destination-connected').volume,.4);
 await p.pause(true);assert.equal(p.ctx.state,'suspended');p.add(1,bytes);assert.equal(e.nodes[0].sent.filter(x=>x.type==='enqueue').length,1);
 await p.pause(false);assert.equal(p.ctx.state,'running');p.stop();assert.equal(p.ctx.state,'closed');assert.equal(p.pending,0);
 await new Promise(r=>setImmediate(r));const count=e.events.length;e.nodes[0].port.onmessage({data:{type:'first-played'}});await new Promise(r=>setImmediate(r));assert.equal(e.events.length,count);
});
test('alterar volume/rate emite status público para sincronizar os outros HUDs',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'settings',playerId:'player'});await p.init();p.set(.35,1.4);await new Promise(r=>setImmediate(r));const event=e.events.find(x=>x.event==='settings');assert.equal(event.status.volume,.35);assert.equal(event.status.playbackRate,1.4);p.stop();
});
test('sliders antes do AudioContext ficar pronto não falham e conservam valores na inicialização',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'early-settings',playerId:'player'});assert.doesNotThrow(()=>p.set(.2,1.5));await p.init();assert.equal(p.gain.gain.value,.2);assert.equal(p.rate,1.5);p.stop();
});
test('replay do mesmo card reseta snapshot offscreen com request novo e texto editado',async()=>{
 const e=environment(),resolvers=[];e.context.LiveSessions.LiveSessionManager.prototype.acquire=async()=>({sendTurn:()=>new Promise(resolve=>resolvers.push(resolve))});e.context.LiveSessions.LiveSessionManager.prototype.release=()=>{};e.context.LiveSessions.LiveSessionManager.prototype.retire=()=>{};
 const payload={operation:'TTS_LIVE_START',jobId:'manual-replay',playerId:'manual-replay',requestId:'first',text:'Primeiro texto.',modelId:'gemini-3.8-live',apiKeys:['fake-only']};await e.command(payload);await new Promise(r=>setImmediate(r));resolvers[0]({});await new Promise(r=>setImmediate(r));assert.equal((await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'})).jobs[0].status,'completed');
 await e.command({...payload,requestId:'second',text:'Texto editado.'});await new Promise(r=>setImmediate(r));const state=await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});assert.equal(state.jobs[0].requestId,'second');assert.equal(state.jobs[0].text,'Texto editado.');assert.equal(state.jobs[0].status,'connecting');await e.command({...payload,requestId:'second',operation:'STOP'});resolvers[1]({});
});
test('efeitos configurados chegam ao grafo Live e pitch chega ao worklet, fora do schema Gemini',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'effects',pitchMultiplier:1.3,bass:3,mid:-2,treble:4,ambience:'room',ambienceIntensity:40,volume:.6,playbackRate:1.2});await p.init();assert.deepEqual(Array.from(p.filters,filter=>[filter.type,filter.frequency.value,filter.gain.value]),[['lowshelf',250,3],['peaking',1200,-2],['highshelf',3500,4]]);assert.equal(p.filters[1].Q.value,.8);assert.equal(p.convolver.buffer.numberOfChannels,2);assert.equal(p.convolver.buffer.length,18000);assert.ok(p.convolver.buffer.getChannelData(0).some(value=>value!==0));assert.equal(e.nodes[0].sent.find(packet=>packet.type==='pitch').value,1.3);assert.equal(p.gain.gain.value,.6);assert.equal(p.ctx.gains[1].gain.value,.72);assert.ok(Math.abs(p.ctx.gains[2].gain.value-.3)<1e-10);p.stop();assert.equal(p.ctx.state,'closed');
});
test('pitch multiplica resampling como detune legado, preservando rate, pause e drain',()=>{
 let Processor;const events=[],context=vm.createContext({AudioWorkletProcessor:class{constructor(){this.port={postMessage:packet=>events.push(packet)};}},Float32Array,registerProcessor:(_name,cls)=>Processor=cls});vm.runInContext(fs.readFileSync(require.resolve('../pcm-player-worklet.js'),'utf8'),context);const p=new Processor(),out=new Float32Array(4);p.port.onmessage({data:{type:'enqueue',buffer:new Float32Array([0,.1,.2,.3,.4,.5]).buffer}});p.port.onmessage({data:{type:'pitch',value:1.5}});p.process([],[[out]]);for(const[index,value]of [0,.15,.3,.45].entries())assert.ok(Math.abs(out[index]-value)<1e-6);assert.equal(p.rate,1);assert.equal(events.filter(event=>event.type==='drain').length,1);
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

test('seek PCM usa cursor real, soma cliques, respeita pausa/limites e não duplica drain',()=>{
 let Processor;const messages=[],context=vm.createContext({sampleRate:100,AudioWorkletProcessor:class{constructor(){this.port={postMessage:packet=>messages.push(packet)};}},Float32Array,registerProcessor(_name,cls){Processor=cls;}});
 vm.runInContext(fs.readFileSync(require.resolve('../pcm-player-worklet.js'),'utf8'),context);const p=new Processor(),send=data=>p.port.onmessage({data});
 for(let blockId=0;blockId<4;blockId++)send({type:'enqueue',blockId,buffer:Float32Array.from({length:1000},(_,i)=>(blockId*1000+i)/10000).buffer});
 p.process([],[[new Float32Array(1500)]]);assert.equal(p.cursor,1500);send({type:'pause',value:true});send({type:'seek',deltaSeconds:5});send({type:'seek',deltaSeconds:5});assert.equal(p.cursor,2500);send({type:'seek',deltaSeconds:-5});assert.equal(p.cursor,2000);p.process([],[[new Float32Array(100)]]);assert.equal(p.cursor,2000);
 send({type:'pause',value:false});const sample=new Float32Array(1);p.process([],[[sample]]);assert.ok(Math.abs(sample[0]-.2)<1e-6);send({type:'seek',deltaSeconds:-100});assert.equal(p.cursor,0);p.process([],[[new Float32Array(2000)]]);assert.equal(messages.filter(m=>m.type==='drain').length,2);
 send({type:'seek',deltaSeconds:100});assert.equal(p.cursor,4000);assert.equal(messages.filter(m=>m.type==='drain').length,4);assert.equal(messages.filter(m=>m.type==='first-played').length,1);assert.equal(messages.at(-1).type,'position');
});
test('retrocesso retém só janela recente e flush libera todas as referências PCM',()=>{
 let Processor;const context=vm.createContext({sampleRate:100,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},Float32Array,registerProcessor(_name,cls){Processor=cls;}});vm.runInContext(fs.readFileSync(require.resolve('../pcm-player-worklet.js'),'utf8'),context);const p=new Processor();
 for(let i=0;i<100;i++)p.port.onmessage({data:{type:'enqueue',buffer:new Float32Array(100).buffer}});p.process([],[[new Float32Array(8500)]]);assert.equal(p.queue[0].start,2500);p.port.onmessage({data:{type:'seek',deltaSeconds:-100}});assert.equal(p.cursor,2500);p.port.onmessage({data:{type:'flush'}});assert.equal(p.queue.length,0);assert.equal(p.totalFrames,0);
});
test('player não termina ao drenar pela primeira vez se o usuário retrocedeu; posição é sincronizada',async()=>{
 const e=environment(),p=new e.OrderedPlaybackBuffer({jobId:'seek-player',playerId:'p'});await p.init();p.totalBlocks=1;p.add(0,new Uint8Array(48000),true);p.generationDone=true;
 const port=e.nodes[0].port;await p.seek(-5);const seek=e.nodes[0].sent.find(x=>x.type==='seek');assert.equal(seek.deltaSeconds,-5);assert.equal(seek.controlSeq,1);port.onmessage({data:{type:'drain'}});port.onmessage({data:{type:'position',frame:12000,totalFrames:24000,availableStart:0}});await new Promise(r=>setImmediate(r));assert.equal(p.stopped,false);assert.equal(e.events.filter(x=>x.event==='position').at(-1).status.currentTime,.5);
 port.onmessage({data:{type:'position',frame:24000,totalFrames:24000,availableStart:0}});await new Promise(r=>setImmediate(r));assert.equal(e.events.filter(x=>x.event==='ended').length,1);assert.equal(e.events.find(x=>x.event==='ended').status.paused,false);
});
test('regressão STT offscreen mantém envio PCM, partial, final e encerramento',async()=>{
 const e=environment(),audio=[],session={socketOpenMs:1,setupCompleteMs:2,sendAudio(bytes,rate){audio.push([bytes.length,rate]);},endAudio(){this.ended=true;}};
 e.context.LiveSessions.LiveSessionManager.prototype.acquire=async()=>session;e.context.LiveSessions.LiveSessionManager.prototype.retire=()=>{};
 e.context.LiveSessions.decodeBase64=x=>new Uint8Array(Buffer.from(x,'base64'));
 const payload={jobId:'stt',modelId:'gemini-3.8-live',apiKeys:['fake-only']};assert.equal((await e.command({...payload,operation:'STT_LIVE_START'})).success,true);
 await e.command({...payload,operation:'STT_LIVE_AUDIO',audioBase64:'AAA=',sampleRate:16000});assert.deepEqual(audio,[[2,16000]]);
 session.handler({serverContent:{interimInputTranscription:{text:'Teste'},inputTranscription:{text:'Teste completo.'}}});await new Promise(r=>setImmediate(r));assert.equal(e.events.find(x=>x.event==='stt-partial').text,'Teste');
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
