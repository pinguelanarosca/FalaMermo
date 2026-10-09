(()=>{
'use strict';
const manager=new LiveSessions.LiveSessionManager(),jobs=new Map(),dictations=new Map(),legacyPlayers=new Map();
const routeKey=p=>p.tabId+':'+(p.frameId||0)+':'+(p.playerId||p.jobId||'');
function publicEvent(payload,event,extra={}){globalThis.LiveTtsDiagnostics?.captureEvent(payload,event,extra);const {apiKeys,apiKey,text,systemInstruction,advancedJson,customVocabulary,transformInstruction,previewAgent,...safe}=payload;chrome.runtime.sendMessage({type:'LIVE_OFFSCREEN_EVENT',target:'background',payload:{...safe,event,...extra}}).catch(()=>{});}
function legacyEvent(payload,event,status){chrome.runtime.sendMessage({type:'TTS_PLAYBACK_EVENT',target:'background',payload:{tabId:payload.tabId,frameId:payload.frameId||0,playerId:payload.playerId,event,status}}).catch(()=>{});}
const playbackDiagnostics=[];
globalThis.LivePlaybackDiagnostics={snapshot:()=>structuredClone(playbackDiagnostics)};
function pcmFormat(bytes,mimeType='audio/pcm;rate=24000'){
 if(!/^audio\/pcm(?:;|$)/i.test(mimeType))throw new Error('Formato de áudio Live não é PCM.');
 if(bytes.byteLength%2)throw new Error('PCM Int16 desalinhado: quantidade ímpar de bytes.');
 const rate=Number(mimeType.match(/(?:^|;)\s*rate=(\d+)/i)?.[1]||24000),channels=Number(mimeType.match(/(?:^|;)\s*channels=(\d+)/i)?.[1]||1);
 if(!Number.isFinite(rate)||rate<=0||channels!==1)throw new Error('PCM Live exige taxa válida e um canal.');
 if(bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WAVE')throw new Error('Header WAV inesperado no PCM Live bruto.');
 return{mimeType,encoding:'PCM signed Int16',bitDepth:16,endianness:'little',sampleRate:rate,channels,bytes:bytes.byteLength,frames:bytes.byteLength/2};
}
function toFloat(bytes,rate){if(!bytes.byteLength)return new Float32Array(0);pcmFormat(bytes);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.byteLength/2,output=new Float32Array(Math.max(1,Math.round(n/rate)));for(let i=0;i<output.length;i++){const p=i*rate,a=Math.min(n-1,Math.floor(p)),b=Math.min(n-1,a+1),t=p-a;output[i]=(view.getInt16(a*2,true)*(1-t)+view.getInt16(b*2,true)*t)/32768;}return output;}
class OrderedPlaybackBuffer{
 constructor(payload){this.payload=payload;this.blocks=new Map();this.next=0;this.stopped=false;this.paused=false;this.volume=Math.max(0,Math.min(1,payload.volume??1));this.rate=Math.max(.5,Math.min(2,payload.playbackRate??1));this.pending=0;this.seq=0;this.firstPlayedAt=null;}
 status(ended=false){return{playerId:this.payload.playerId,requestId:this.payload.requestId,seq:++this.seq,currentTime:0,duration:null,paused:this.paused||ended,ended,volume:this.volume,playbackRate:this.rate};}
 record(stage,extra={}){const event={jobId:this.payload.jobId,stage,at:Date.now(),contextState:this.ctx?.state||null,contextSampleRate:this.ctx?.sampleRate||null,...extra};let log=playbackDiagnostics.find(x=>x.jobId===event.jobId);if(!log){log={jobId:event.jobId,events:[]};playbackDiagnostics.push(log);if(playbackDiagnostics.length>12)playbackDiagnostics.shift();}log.events.push(event);if(log.events.length>60)log.events.shift();globalThis.LiveTtsDiagnostics?.capturePlayback(globalThis.LivePlaybackDiagnostics.snapshot().find(x=>x.jobId===event.jobId));publicEvent(this.payload,'pcm-diagnostic',event);}
async init(){try{this.ctx=new AudioContext({sampleRate:24000,latencyHint:'interactive'});await this.ctx.audioWorklet.addModule(chrome.runtime.getURL('pcm-player-worklet.js'));if(this.stopped)throw Object.assign(new Error('Reprodução cancelada.'),{cancelled:true});this.node=new AudioWorkletNode(this.ctx,'gemini-pcm-player');this.record('worklet-ready');this.node.port.onmessage=e=>{if(this.stopped)return;if(e.data.type==='drain'){this.pending=Math.max(0,this.pending-1);this.maybeEnd();}if(e.data.type==='first-played'&&this.firstPlayedAt===null){this.firstPlayedAt=performance.now();this.record('first-frame-consumed',e.data);publicEvent(this.payload,'first-playback',{firstPcmPlayedAt:Date.now()});publicEvent(this.payload,'play',{status:this.status()});}};this.gain=this.ctx.createGain();this.gain.gain.value=this.volume;this.node.connect(this.gain).connect(this.ctx.destination);this.record('destination-connected',{volume:this.volume,muted:this.volume===0,paused:this.paused,playbackRate:this.rate});await this.ctx.resume();if(this.ctx.state&&this.ctx.state!=='running')throw new Error('AudioContext não iniciou: '+this.ctx.state);this.record('context-running');}catch(error){this.stop();throw error;}}
 add(index,bytes,done=false,mimeType){if(this.stopped)return;let block=this.blocks.get(index);if(!block){block={chunks:[],done:false};this.blocks.set(index,block);}if(bytes?.length){const format=pcmFormat(bytes,mimeType);if(!block.received){block.received=true;this.record('pcm-received',{blockId:index,...format});}block.chunks.push({bytes,format});}if(done)block.done=true;this.flush();}
 discard(index){if(index>=this.next)this.blocks.delete(index);}
 flush(){if(this.stopped||this.paused)return;while(true){const block=this.blocks.get(this.next);if(!block)return;while(block.chunks.length){const {bytes,format}=block.chunks.shift(),pcm=toFloat(bytes,format.sampleRate/(this.ctx.sampleRate||24000));this.pending++;const frames=pcm.length;this.node.port.postMessage({type:'rate',value:this.rate});this.node.port.postMessage({type:'enqueue',buffer:pcm.buffer,blockId:this.next},[pcm.buffer]);if(!block.enqueued){block.enqueued=true;this.record('player-enqueue',{blockId:this.next,frames,sourceBytes:format.bytes});}}if(!block.done)return;this.blocks.delete(this.next);this.next++;}}
 maybeEnd(){if(!this.stopped&&this.generationDone&&this.pending===0&&this.next>=this.totalBlocks){publicEvent(this.payload,'ended',{status:this.status(true)});jobs.delete(routeKey(this.payload));this.stop();}}
 async pause(value){this.paused=value;this.node?.port.postMessage({type:'pause',value});if(value)await this.ctx?.suspend();else{await this.ctx?.resume();this.flush();}this.record(value?'paused':'resumed');publicEvent(this.payload,value?'pause':'play',{status:this.status()});}
 set(volume,rate){if(Number.isFinite(volume)){this.volume=Math.max(0,Math.min(1,volume));this.gain.gain.value=this.volume;}if(Number.isFinite(rate)){this.rate=Math.max(.5,Math.min(2,rate));this.node?.port.postMessage({type:'rate',value:this.rate});}this.record('settings-applied',{volume:this.volume,playbackRate:this.rate});}
 stop(){if(this.stopped)return;this.stopped=true;this.blocks.clear();this.pending=0;this.node?.port.postMessage({type:'flush'});this.ctx?.close().catch(()=>{});this.record('stopped');}
}
function keyOrder(job,index,modelId){const saved=job.payload.keyOrderByModel?.[modelId],base=Array.isArray(saved)?saved:job.payload.apiKeys.map((_,k)=>k),rotated=base.slice(index%Math.max(1,base.length)).concat(base.slice(0,index%Math.max(1,base.length)));return [...new Set(rotated)].filter(k=>Number.isInteger(k)&&k>=0&&k<job.payload.apiKeys.length&&!job.cooldowns.has(modelId+':'+k));}
async function attemptBlock(job,index){
 const {payload,controller,blocks,player}=job,errors=[];
 for(const modelId of LiveConfig.modelChain('tts',payload.modelId,payload.models||[])){
  if(!LiveConfig.caps(modelId).supportsNarration)continue;
  for(const k of keyOrder(job,index,modelId)){
   if(controller.signal.aborted)throw controller.signal.reason;
   const started=performance.now();let session,streamedPcm=false;
   try{
    publicEvent(payload,'status',{status:'Gerando '+(index+1)+'/'+blocks.length,blockId:index,modelId,keyLabel:'key#'+(k+1)});
    session=await manager.acquire({...payload,modelId,blockId:index,apiKey:payload.apiKeys[k],keyIndex:k+1,...(modelId===payload.modelId?{}:{jsonMode:'panel',advancedJson:null})});
    publicEvent(payload,'setup-complete',{blockId:index,modelId,keyLabel:'key#'+(k+1),socketOpenMs:session.socketOpenMs,setupCompleteMs:session.setupCompleteMs,...(payload.tabId===0?{actualSetup:session.lastSetup}:{})});
    const result=await session.sendTurn(blocks[index],part=>{if(part.type==='pcm'&&!controller.signal.aborted){if(!job.firstPcmAt){job.firstPcmAt=Date.now();publicEvent(payload,'first-pcm',{blockId:index,modelId,keyLabel:'key#'+(k+1),firstPcmAt:job.firstPcmAt,...pcmFormat(part.bytes,part.mimeType)});}if(player.next===index)streamedPcm=true;player.add(index,part.bytes,false,part.mimeType);}},controller.signal);
    if(controller.signal.aborted)throw controller.signal.reason;
    if(Array.isArray(result.chunks)&&result.chunks.length===0)throw new Error('Modelo Live não retornou áudio; resposta indisponível.');
    player.add(index,null,true);manager.release(session);
    player.record('turn-complete',{blockId:index,modelId,keyId:'key#'+(k+1)});
    publicEvent(payload,'ranking',{result:'SUCCESS',blockId:index,modelId,keyIndex:k+1,durationMs:performance.now()-started,metrics:result.metrics});
    return;
   }catch(error){
    if(session)manager.retire(session);
    player.discard(index);
    const kind=LiveSessions.classifyLiveError(error),message=LiveConfig.redactSecrets(error.message||String(error),payload.apiKeys);
    if(error.protocol)publicEvent(payload,'protocol-diagnostic',{blockId:index,modelId,keyLabel:'key#'+(k+1),phase:error.protocolPhase||error.protocol.phase,setupCompleteReceived:error.protocol.setupCompleteReceived,close:error.protocol.close,lastSentType:error.protocol.lastSentType,lastReceivedEvent:error.protocol.lastReceivedEvent});
    publicEvent(payload,'ranking',{result:kind,blockId:index,modelId,keyIndex:k+1,durationMs:performance.now()-started,error:message});
    if(kind==='QUOTA'||kind==='AUTH')job.cooldowns.add(modelId+':'+k);
    if(kind==='REQUEST'||kind==='CANCELLED'||kind==='INVALIDATED_CONTEXT'||streamedPcm)throw error;
    errors.push(modelId+' key#'+(k+1)+': '+message);
   }
  }
 }
 throw new Error('Fallback Live esgotado no bloco '+(index+1)+': '+errors.join(' | '));
}
async function runTts(job){const {payload,controller,blocks,player}=job,workers=Math.min(blocks.length,payload.apiKeys.length,Math.max(1,payload.maxParallelLiveSessions||3));let cursor=0;try{await Promise.all(Array.from({length:workers},async()=>{while(cursor<blocks.length&&!controller.signal.aborted){const index=cursor++;await attemptBlock(job,index);}}));if(controller.signal.aborted)return;player.generationDone=true;publicEvent(payload,'generation-complete',{blocks:blocks.length});player.maybeEnd();}catch(error){const cancelled=controller.signal.aborted;controller.abort(error);player.stop();if(jobs.get(routeKey(payload))===job)jobs.delete(routeKey(payload));if(!cancelled)publicEvent(payload,'error',{error:LiveConfig.redactSecrets(error.message||String(error),payload.apiKeys)});}}
async function startTts(payload){LiveConfig.assertRouteModel(payload.modelId,'tts');LiveConfig.buildLiveSessionConfig(payload);const id=routeKey(payload),prior=jobs.get(id);if(prior){prior.controller.abort(Object.assign(new Error('Substituído.'),{cancelled:true}));prior.player.stop();jobs.delete(id);}const blocks=LiveConfig.splitLiveNarrationBlocks(payload.text,payload.chunkSize);if(!blocks.length)throw new Error('Texto vazio.');const player=new OrderedPlaybackBuffer(payload);player.totalBlocks=blocks.length;const job={payload,blocks,player,controller:new AbortController(),cooldowns:new Set()};jobs.set(id,job);try{await player.init();if(job.controller.signal.aborted||jobs.get(id)!==job)throw Object.assign(new Error('Inicialização Live cancelada.'),{cancelled:true});}catch(error){player.stop();if(jobs.get(id)===job)jobs.delete(id);throw error;}publicEvent(payload,'status',{status:'Conectando',blocks:blocks.length});void runTts(job);return{success:true,jobId:payload.jobId,blocks:blocks.length};}
async function transformTranscript(d,transcript){const {payload}=d,models=LiveConfig.modelChain('tts',payload.transformModels?.[0],payload.transformModels||LiveConfig.eligibleModels('tts'));let last;for(const modelId of models)for(let k=0;k<payload.apiKeys.length;k++){let session;try{publicEvent(payload,'stt-transform-attempt',{modelId,keyLabel:'key#'+(k+1)});session=await manager.acquire({modelId,apiKey:payload.apiKeys[k],keyIndex:k+1,mode:'agent',systemInstruction:payload.transformInstruction,outputTranscription:true,voiceName:payload.voiceName||'Kore'});const output=await session.sendTurn(transcript,null,d.controller.signal);manager.release(session);if(output.text)return output.text;throw new Error('Agente Live não retornou texto de saída.');}catch(error){last=error;if(session)manager.retire(session);const kind=LiveSessions.classifyLiveError(error);if(['REQUEST','CANCELLED','INVALIDATED_CONTEXT'].includes(kind))throw error;}}throw last||new Error('Transformação Live indisponível.');}
function commitNativeDictation(d){if(!d.pendingText?.trim())return;const text=d.pendingText.trim();d.pendingText='';d.finalParts.push(text);publicEvent(d.payload,'stt-segment',{text});}
function sttDiagnostic(d,stage,extra={}){void globalThis.LiveSttDiagnostics?.emit({jobId:d.payload.jobId,scope:'transport',stage,modelId:d.payload.modelId,receivedChunks:d.receivedChunks||0,receivedBytes:d.receivedBytes||0,interactionStatus:d.interactionStatus,...d.session?.sttSnapshot?.(),...extra});}
function finalizeDictation(d){if(d.finalized||d.controller.signal.aborted)return;if(LiveConfig.caps(d.payload.modelId).requiresInteractionIdle&&d.interactionStatus!=='IDLE'){d.controller.abort();if(d.session)manager.retire(d.session);if(dictations.get(d.payload.jobId)===d)dictations.delete(d.payload.jobId);sttDiagnostic(d,'error',{outcome:'TIMEOUT'});publicEvent(d.payload,'stt-error',{error:'Timeout aguardando interactionStatus IDLE no ditado Live.'});return;}commitNativeDictation(d);d.finalized=true;clearTimeout(d.finalTimer);const text=d.finalParts.join(' ').trim();const finish=async()=>{try{if(!text){const outcome=!d.receivedBytes?'CAPTURE_NOT_SENT':d.sawInterim?'INTERIM_ONLY':'NO_TRANSCRIPTION';sttDiagnostic(d,'error',{outcome});throw new Error(!d.receivedBytes?'Nenhum PCM chegou ao WebSocket STT.':d.sawInterim?'Timeout: apenas transcrição provisória recebida; nenhum resultado final.':'PCM enviado ao Gemini, mas nenhuma transcrição recebida até o timeout.');}publicEvent(d.payload,'stt-status',{status:d.payload.transformInstruction?'Transformando com agente':'Concluído'});const final=d.payload.transformInstruction?await transformTranscript(d,text):text;if(d.controller.signal.aborted)return;sttDiagnostic(d,'final',{outcome:'FINAL',characters:final.length});publicEvent(d.payload,'stt-final',{text:final});}catch(error){if(!d.controller.signal.aborted)publicEvent(d.payload,'stt-error',{error:LiveConfig.redactSecrets(error.message||String(error),d.payload.apiKeys)});}finally{if(d.session)manager.retire(d.session);if(dictations.get(d.payload.jobId)===d)dictations.delete(d.payload.jobId);}};void finish();}
async function startStt(payload){
 if(dictations.has(payload.jobId))throw new Error('Sessão STT duplicada.');
 const d={payload,finalParts:[],pendingText:'',stopped:false,finalized:false,controller:new AbortController(),finalTimer:null};dictations.set(payload.jobId,d);
 const models=LiveConfig.modelChain('stt',payload.modelId,payload.models||[]);let last;
 try{
  LiveConfig.assertRouteModel(payload.modelId,'stt');
  connecting:for(const modelId of models)for(let k=0;k<payload.apiKeys.length;k++){
   if(d.controller.signal.aborted)throw Object.assign(new Error('Ditado cancelado.'),{cancelled:true});
   try{
    publicEvent(payload,'stt-connect-attempt',{modelId,keyLabel:'key#'+(k+1)});
    const session=await manager.acquire({modelId,apiKey:payload.apiKeys[k],keyIndex:k+1,mode:'dictation',jobId:payload.jobId,vad:payload.vad,languageCodes:payload.languageCodes,customVocabulary:payload.customVocabulary,smartTranscription:payload.smartTranscription,thinkingLevel:payload.thinkingLevel,thinkingBudget:payload.thinkingBudget});
    if(d.controller.signal.aborted){manager.retire(session);throw Object.assign(new Error('Ditado cancelado.'),{cancelled:true});}
    d.session=session;d.native=LiveConfig.caps(modelId).sttProtocol==='native-audio';d.payload={...payload,modelId};break connecting;
   }catch(error){last=error;if(d.controller.signal.aborted)throw error;publicEvent(payload,'stt-connect-error',{modelId,keyLabel:'key#'+(k+1),error:LiveConfig.redactSecrets(error.message||String(error),payload.apiKeys)});if(['REQUEST','CANCELLED','INVALIDATED_CONTEXT'].includes(LiveSessions.classifyLiveError(error)))throw error;}
  }
  if(!d.session)throw last||new Error('Nenhuma chave/modelo STT Live elegível.');
  d.session.handler=msg=>{
   if(d.controller.signal.aborted||d.finalized)return;
   if(msg.error){d.controller.abort();clearTimeout(d.finalTimer);sttDiagnostic(d,'error',{outcome:'CONNECTION',closeCode:msg.error.cause?.closeCode});publicEvent(d.payload,'stt-error',{error:LiveConfig.redactSecrets(msg.error.message||'Sessão STT encerrada.',payload.apiKeys)});manager.retire(d.session);if(dictations.get(payload.jobId)===d)dictations.delete(payload.jobId);return;}
   if(msg.voiceActivity)sttDiagnostic(d,'server-event',{voiceActivity:msg.voiceActivity.type});
   const sc=msg.serverContent;if(!sc)return;
   if(sc.modelTurn||sc.generationComplete||sc.interrupted||sc.waitingForInput){if(!d.lastServerDiagnosticAt||Date.now()-d.lastServerDiagnosticAt>=1000){d.lastServerDiagnosticAt=Date.now();sttDiagnostic(d,'server-event',{generationComplete:sc.generationComplete===true,interrupted:sc.interrupted===true,waitingForInput:sc.waitingForInput===true});}}
   if(sc.interactionStatus){d.interactionStatus=sc.interactionStatus;if(sc.interactionStatus==='IN_PROGRESS'&&LiveConfig.caps(d.payload.modelId).requiresInteractionIdle){clearTimeout(d.finalTimer);d.finalTimer=setTimeout(()=>finalizeDictation(d),90000);}}
   if(sc.interimInputTranscription?.text){d.sawInterim=true;sttDiagnostic(d,'input-interim');publicEvent(d.payload,'stt-partial',{text:sc.interimInputTranscription.text});}
   // Áudio/modelTurn/outputTranscription do assistente nunca entram no ditado ou no player.
   if(sc.inputTranscription?.text){
    sttDiagnostic(d,'input-transcription',{characters:sc.inputTranscription.text.length});
    if(d.native){d.pendingText+=sc.inputTranscription.text;publicEvent(d.payload,'stt-partial',{text:d.pendingText});}
    else{d.finalParts.push(sc.inputTranscription.text);publicEvent(d.payload,'stt-segment',{text:sc.inputTranscription.text});}
   }
   if(d.native&&(sc.inputTranscription?.finished||sc.turnComplete||sc.interrupted))commitNativeDictation(d);
   if(sc.turnComplete){if(d.stopped)d.stopTurnComplete=true;sttDiagnostic(d,'turn-complete',{turnComplete:true});}
   // inputTranscription é independente de turnComplete. Sem texto, conserva o deadline maior.
   if(d.stopped&&(!LiveConfig.caps(d.payload.modelId).requiresInteractionIdle||d.interactionStatus==='IDLE')&&(d.finalParts.length||d.pendingText?.trim())&&(d.stopTurnComplete||sc.inputTranscription?.finished||d.interactionStatus==='IDLE')){clearTimeout(d.finalTimer);if(!d.native&&sc.turnComplete)finalizeDictation(d);else d.finalTimer=setTimeout(()=>finalizeDictation(d),900);}
  };
  sttDiagnostic(d,'setup-complete',{setupComplete:true});publicEvent(d.payload,'setup-complete',{modelId:d.payload.modelId,socketOpenMs:d.session.socketOpenMs,setupCompleteMs:d.session.setupCompleteMs});return{success:true,jobId:payload.jobId,modelId:d.payload.modelId};
 }catch(error){if(d.session)manager.retire(d.session);if(dictations.get(payload.jobId)===d)dictations.delete(payload.jobId);throw error;}
}
function legacyStatus(payload,p){const a=p.audio;return{playerId:payload.playerId,requestId:p.requestId,seq:++p.seq,currentTime:a.currentTime,duration:Number.isFinite(a.duration)?a.duration:null,paused:a.paused,ended:a.ended,volume:a.volume,playbackRate:a.playbackRate};}
async function legacyCommand(payload){const id=routeKey(payload);if(payload.operation==='STOP_TAB'){for(const [key,p] of legacyPlayers)if(p.tabId===payload.tabId){p.audio.pause();p.audio.removeAttribute?.('src');p.audio.load?.();legacyPlayers.delete(key);}return{success:true};}if(payload.operation==='STOP'){const p=legacyPlayers.get(id);if(p){p.audio.pause();p.audio.removeAttribute?.('src');p.audio.load?.();legacyPlayers.delete(id);}return{success:true};}let p=legacyPlayers.get(id);if(payload.operation==='PLAY'){if(!p||p.requestId!==payload.requestId){p?.audio.pause();const audio=new Audio();p={audio,requestId:payload.requestId,tabId:payload.tabId,seq:0};legacyPlayers.set(id,p);for(const [native,event] of [['playing','play'],['pause','pause'],['ended','ended'],['error','error']])audio.addEventListener(native,()=>{if(legacyPlayers.get(id)===p)legacyEvent(payload,event,legacyStatus(payload,p));});audio.src=payload.src;audio.volume=payload.volume??1;audio.playbackRate=payload.playbackRate??1;}await p.audio.play();return{success:true,status:legacyStatus(payload,p)};}if(!p||p.requestId!==payload.requestId)return{success:true};if(payload.operation==='PAUSE')p.audio.pause();if(payload.operation==='SEEK')p.audio.currentTime=payload.currentTime||0;if(payload.operation==='SET'){if(Number.isFinite(payload.volume))p.audio.volume=payload.volume;if(Number.isFinite(payload.playbackRate))p.audio.playbackRate=payload.playbackRate;}return{success:true,status:legacyStatus(payload,p)};}
async function command(payload){
 if(payload.operation==='TTS_LIVE_START')return startTts(payload);
 if(payload.operation==='STT_LIVE_START')return startStt(payload);
 if(payload.operation==='STT_LIVE_AUDIO'){const d=dictations.get(payload.jobId);if(!d?.session||d.stopped||d.finalized||d.controller.signal.aborted)return{success:false,error:'Ditado Live não está capturando.'};const bytes=LiveSessions.decodeBase64(payload.audioBase64);d.receivedChunks=(d.receivedChunks||0)+1;d.receivedBytes=(d.receivedBytes||0)+bytes.byteLength;try{d.session.sendAudio(bytes,payload.sampleRate||16000);}catch(error){sttDiagnostic(d,'error',{outcome:'CONNECTION'});throw error;}if(!d.lastDiagnosticAt||Date.now()-d.lastDiagnosticAt>=1000){d.lastDiagnosticAt=Date.now();sttDiagnostic(d,'audio-sent');}if(!d.firstAudioSent){d.firstAudioSent=true;publicEvent(d.payload,'stt-audio-sent',{bytes:bytes.byteLength,sampleRate:payload.sampleRate||16000});}return{success:true};}
 if(payload.operation==='STT_LIVE_STOP'){const d=dictations.get(payload.jobId);if(d?.session&&!d.stopped&&!d.finalized){d.stopped=true;d.session.endAudio();sttDiagnostic(d,'activity-end');clearTimeout(d.finalTimer);d.finalTimer=setTimeout(()=>finalizeDictation(d),LiveConfig.caps(d.payload.modelId).requiresInteractionIdle?90000:15000);}return{success:true};}
 if(payload.operation==='STT_LIVE_CANCEL'){const d=dictations.get(payload.jobId);if(d){sttDiagnostic(d,'cancelled',{outcome:'CANCELLED'});d.controller.abort();clearTimeout(d.finalTimer);if(d.session)manager.retire(d.session);dictations.delete(payload.jobId);}return{success:true};}
 const id=routeKey(payload),job=jobs.get(id);
 if(payload.operation==='STOP'||payload.operation==='STOP_TAB'){for(const [key,j] of jobs)if(payload.operation==='STOP_TAB'?j.payload.tabId===payload.tabId:key===id){j.controller.abort(Object.assign(new Error('Cancelado.'),{cancelled:true}));j.player.stop();jobs.delete(key);}return legacyCommand(payload);}
 if(job&&payload.requestId===job.payload.requestId){if(payload.operation==='PAUSE')await job.player.pause(true);if(payload.operation==='RESUME'||payload.operation==='PLAY')await job.player.pause(false);if(payload.operation==='SET')job.player.set(payload.volume,payload.playbackRate);return{success:true,status:job.player.status()};}
 return legacyCommand(payload);
}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{if(message.target!=='offscreen'||!['LIVE_OFFSCREEN_COMMAND','TTS_OFFSCREEN_COMMAND'].includes(message.type))return false;if(message.payload?.operation==='TTS_LIVE_START')publicEvent(message.payload,'pcm-diagnostic',{stage:'offscreen-command-received',at:Date.now()});command(message.payload).then(respond,error=>respond({success:false,error:LiveConfig.redactSecrets(error.message||String(error),message.payload?.apiKeys||[])}));return true;});
})();
