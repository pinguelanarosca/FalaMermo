(()=>{
'use strict';
const manager=new LiveSessions.LiveSessionManager(),jobs=new Map(),dictations=new Map(),legacyPlayers=new Map();
// Live jobs own their identity. A visual player/route must never replace another job.
const routeKey=p=>p.jobId||p.tabId+':'+(p.frameId||0)+':'+(p.playerId||'');
const jobViews=new Map(),eventQueues=new Map(),unacknowledged=new Map();
// Only this queue grants audible output. Synthesis may continue while another task plays.
let playbackQueue=Promise.resolve(),latestIntent=0,globalVolume=1,globalVolumeInitialized=false;
const playbackPlayers=new Set(),PLAYBACK_CACHE_LIMIT=128*1024*1024;
function playbackBytes(){
 let bytes=0;
 for(const player of playbackPlayers){
  if(!player.blocks)continue;
  bytes+=Math.max(0,player.enqueuedFrames-player.availableStart)*Float32Array.BYTES_PER_ELEMENT;
  for(const block of player.blocks.values()){
   for(const chunk of block.chunks)bytes+=chunk.cacheBytes;
  }
 }
 return bytes;
}
function playbackIntent(player,intent){player.intent=Number.isSafeInteger(intent)?intent:latestIntent+1;latestIntent=Math.max(latestIntent,player.intent);player.desired='play';playbackPlayers.add(player);}
function coordinate(work){const task=playbackQueue.catch(()=>{}).then(work);playbackQueue=task.catch(()=>{});return task;}
function activatePlayback(player){
 return coordinate(async()=>{
  if(player.stopped||player.desired!=='play')return;
  if(player.intent!==latestIntent){
   player.desired='pause';
   await player.pause(true);
   return;
  }
  // A resume without PCM arms this request without taking output away from another job.
  if(player.managed&&!player.authorized&&!player.hasPlayablePcm()){
   await player.pause(false);
   if(!player.stopped&&!player.paused){
    player.flush();
    await player.publishPlaybackState();
   }
   return;
  }
  for(const other of playbackPlayers){
   if(other===player||other.stopped||!other.authorized)continue;
   other.desired='pause';
   other.authorized=false;
   await other.pause(true);
  }
  if(player.stopped||player.desired!=='play'||player.intent!==latestIntent){
   if(!player.stopped){player.desired='pause';await player.pause(true);}
   return;
  }
  player.authorized=true;
  try{
   if(player.managed){
    await player.pause(false);
    if(player.stopped)return;
    if(player.desired!=='play'||player.intent!==latestIntent){
     player.authorized=false;
     player.desired='pause';
     await player.pause(true);
     return;
    }
    player.gain.gain.value=effectiveVolume(player);
    player.flush();
    await player.publishPlaybackState();
   }else await player.pause(false);
  }catch(error){
   player.authorized=false;
   throw error;
  }
 });
}
function effectiveVolume(player){return player.volume*globalVolume;}

function viewFor(p){let v=jobViews.get(p.jobId);if(!v||v.requestId!==p.requestId){v={jobId:p.jobId,type:p.operation==='STT_LIVE_START'?'STT':'TTS',origin:{tabId:p.tabId||0,frameId:p.frameId||0,documentId:p.documentId||null},playerId:p.playerId,requestId:p.requestId,status:'connecting',...(p.narration?{narration:true}:{}),text:p.operation==='STT_LIVE_START'?'':p.text||'',partialText:'',createdAt:Date.now(),updatedAt:Date.now(),eventSeq:0,progress:{}};jobViews.set(p.jobId,v);}return v;}
function applyView(p,event,extra){if(!p.jobId)return;const v=viewFor(p);v.eventSeq++;v.updatedAt=Date.now();if(extra.modelId)v.modelId=extra.modelId;
 if(p.editorDelivery&&['stt-partial','stt-segment','stt-final'].includes(event)){v.textRevision=v.eventSeq;v.textSequence=extra.sequence;v.publishedAt=extra.publishedAt;v.transcriptFinal=event==='stt-final';}
 if(Array.isArray(extra.textBoundaries))v.textBoundaries=extra.textBoundaries.map(pair=>[...pair]);
 else if(event==='stt-final')delete v.textBoundaries;
 if(event==='play'||event==='first-playback')v.status='playing';if(event==='buffering')v.status='connecting';if(event==='pause'){v.status='paused';v.pausedAt=Date.now();}if(event==='ended')v.status='completed';if(event==='error'||event==='stt-error'){v.status='error';v.incomplete=true;v.error=extra.error;}
 if(event==='playback-warning'){v.warning=extra.warning;v.capacityWarning=true;}
 if(event==='cancelled'||event==='stt-cancelled'){v.status='cancelled';v.incomplete=true;}
 if(event==='setup-complete'&&v.type==='STT')v.status='recording';
 if(event==='stt-origin-lost'){v.incomplete=true;v.status='waiting';v.originLost=true;}
 if(event==='stt-warning'){v.incomplete=v.incomplete||extra.incomplete!==false;v.error=extra.warning;}
 if(event==='stt-status')v.status=/Transformando/i.test(extra.status)?'transforming':/Finalizando/i.test(extra.status)?'flushing':/Inserindo/i.test(extra.status)?'inserting':/Gravando/i.test(extra.status)?'recording':'waiting';
 if(event==='stt-partial'){if(typeof extra.confirmedText==='string')v.text=extra.confirmedText;v.partialText=typeof extra.partialText==='string'?extra.partialText:extra.confirmed?'':extra.text||'';}
 if(event==='stt-segment'){v.text=typeof extra.confirmedText==='string'?extra.confirmedText:[v.text,extra.text].filter(Boolean).join(' ');v.partialText='';}
 if(event==='stt-final'){v.text=extra.text||'';v.partialText='';v.status='inserting';v.incomplete=extra.incomplete===true||v.incomplete===true;}
 if(event==='block-complete')v.progress={...v.progress,completedBlocks:extra.completed,totalBlocks:extra.blocks};
 if(extra.status&&typeof extra.status==='object'){v.paused=extra.status.paused;const {currentTime,duration,availableStart,availableEnd,volume,playbackRate,contextState,workletPaused,outputMuted,outputActive,positionFrame,controlSeq}=extra.status;v.progress={...v.progress,currentTime,duration,availableStart,availableEnd,volume,playbackRate,contextState,workletPaused,outputMuted,outputActive,positionFrame,controlSeq};}
 return v;
}
function eventTimeout(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Confirmação de evento indisponível.')),5000);})]).finally(()=>clearTimeout(timer));}
function publicEvent(payload,event,extra={}){const current=jobs.get(routeKey(payload));if(current&&current.payload.requestId!==payload.requestId)return Promise.resolve();globalThis.LiveTtsDiagnostics?.captureEvent(payload,event,extra);const v=applyView(payload,event,extra);const {apiKeys,apiKey,schedulerPolicy,text,systemInstruction,advancedJson,customVocabulary,transformInstruction,previewAgent,sttRecognition,...safe}=payload;const packet={...safe,event,...extra,eventSeq:v?.eventSeq};
 const id=payload.jobId||'legacy',previous=eventQueues.get(id)||Promise.resolve();
 const delivered=previous.catch(()=>{}).then(async()=>{for(let attempt=0;attempt<3;attempt++){try{const ack=await eventTimeout(Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'LIVE_OFFSCREEN_EVENT',target:'background',payload:packet})));if(ack?.success===false)throw Error('Evento não confirmado.');if(['stt-final','ended','stt-error','error','cancelled','stt-cancelled'].includes(event))unacknowledged.delete(id);return;}catch{unacknowledged.set(id,packet.eventSeq);}}void globalThis.LiveSttDiagnostics?.emit({jobId:id,scope:'transport',stage:'event-delivery-error',outcome:'EVENT_DELIVERY_FAILED'});});
 eventQueues.set(id,delivered);void delivered.finally(()=>{if(eventQueues.get(id)===delivered)eventQueues.delete(id);});return delivered;
}
function activeJobIds(){return[...jobs.values()].map(j=>j.payload.jobId).concat([...dictations.keys()]);}
function notifyIdle(){if(jobs.size||dictations.size||legacyPlayers.size)return;void Promise.all([...eventQueues.values(),...(sttScheduler?[sttScheduler.flush()]:[])]).then(()=>{if(jobs.size||dictations.size||legacyPlayers.size||unacknowledged.size)return;chrome.runtime.sendMessage({type:'LIVE_OFFSCREEN_IDLE',target:'background',payload:{}}).catch(()=>{});});}
function globalSnapshot(){const active=new Set(activeJobIds());const recent=[...jobViews.values()].filter(v=>active.has(v.jobId)||Date.now()-v.updatedAt<86400000);const terminal=recent.filter(v=>!active.has(v.jobId)).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,50);for(const [id]of jobViews)if(!active.has(id)&&!terminal.some(v=>v.jobId===id))jobViews.delete(id);return{success:true,playback:{volume:globalVolume},activeJobIds:[...active],jobs:structuredClone([...recent.filter(v=>active.has(v.jobId)),...terminal])};}
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
function resampledFrames(frames,rate){return Math.max(1,Math.round(frames/rate));}
function toFloat(bytes,rate){if(!bytes.byteLength)return new Float32Array(0);pcmFormat(bytes);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.byteLength/2,output=new Float32Array(resampledFrames(n,rate));for(let i=0;i<output.length;i++){const p=i*rate,a=Math.min(n-1,Math.floor(p)),b=Math.min(n-1,a+1),t=p-a;output[i]=(view.getInt16(a*2,true)*(1-t)+view.getInt16(b*2,true)*t)/32768;}return output;}
class OrderedPlaybackBuffer{
 constructor(payload){this.payload=payload;this.blocks=new Map();this.next=0;this.stopped=false;this.paused=false;this.volume=Math.max(0,Math.min(1,payload.volume??1));this.rate=Math.max(.5,Math.min(2,payload.playbackRate??1));this.pending=0;this.seq=0;this.firstPlayedAt=null;this.rendering=false;this.publishedPlaybackState=null;this.positionFrame=0;this.enqueuedFrames=0;this.availableStart=0;this.controlSeq=0;this.ackSeq=0;this.workletPaused=false;this.controlQueue=Promise.resolve();this.controlAcks=new Map();this.controlling=false;}
 hasPlayablePcm(){
  return this.enqueuedFrames>this.positionFrame||Boolean(this.blocks.get(this.next)?.chunks.length);
 }
 hasCachedPcm(){
  return this.enqueuedFrames>this.availableStart||[...this.blocks.values()].some(block=>block.chunks.length>0);
 }
 playbackState(){
  if(this.paused)return 'paused';
  if(this.rendering&&this.authorized&&this.ctx?.state==='running')return 'playing';
  return 'connecting';
 }
 publishPlaybackState(){
  const state=this.playbackState();
  if(state===this.publishedPlaybackState||this.stopped)return;
  this.publishedPlaybackState=state;
  if(state==='playing'&&!this.firstPlaybackPublished){
   this.firstPlaybackPublished=true;
   publicEvent(this.payload,'first-playback',{firstPcmPlayedAt:Date.now(),status:this.status()});
  }
  return publicEvent(this.payload,state==='playing'?'play':'buffering',{status:this.status()});
 }
 status(ended=false){return{playbackState:this.playbackState(),outputActive:this.authorized===true&&!this.paused,jobId:this.payload.jobId,playerId:this.payload.playerId,requestId:this.payload.requestId,seq:++this.seq,currentTime:this.positionFrame/(this.ctx?.sampleRate||24000),duration:this.enqueuedFrames/(this.ctx?.sampleRate||24000),availableStart:this.availableStart/(this.ctx?.sampleRate||24000),availableEnd:this.enqueuedFrames/(this.ctx?.sampleRate||24000),paused:ended?false:this.paused,ended,volume:this.volume,playbackRate:this.rate,contextState:this.ctx?.state,workletPaused:this.workletPaused,outputMuted:this.stopped||this.gain?.gain.value===0,positionFrame:this.positionFrame,controlSeq:this.ackSeq};}
 record(stage,extra={}){const event={jobId:this.payload.jobId,stage,at:Date.now(),contextState:this.ctx?.state||null,contextSampleRate:this.ctx?.sampleRate||null,...extra};let log=playbackDiagnostics.find(x=>x.jobId===event.jobId);if(!log){log={jobId:event.jobId,events:[]};playbackDiagnostics.push(log);if(playbackDiagnostics.length>12)playbackDiagnostics.shift();}log.events.push(event);if(log.events.length>60)log.events.shift();globalThis.LiveTtsDiagnostics?.capturePlayback(globalThis.LivePlaybackDiagnostics.snapshot().find(x=>x.jobId===event.jobId));publicEvent(this.payload,'pcm-diagnostic',event);}
 connectEffects(){const p=this.payload;let output=this.node;if([p.bass,p.mid,p.treble].some(value=>Number.isFinite(value)&&value!==0)){this.filters=[];for(const [type,frequency,value]of [['lowshelf',250,p.bass],['peaking',1200,p.mid],['highshelf',3500,p.treble]]){const filter=this.ctx.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.gain.value=value||0;if(type==='peaking')filter.Q.value=.8;output.connect(filter);output=filter;this.filters.push(filter);}}
  const intensity=(p.ambienceIntensity??30)/100;if(p.ambience&&p.ambience!=='none'&&intensity>0){const seconds={studio:.35,room:.75,warm:1.1,hall:1.8}[p.ambience]||.6,length=Math.floor(this.ctx.sampleRate*seconds),impulse=this.ctx.createBuffer(2,length,this.ctx.sampleRate);for(let channel=0;channel<2;channel++){const values=impulse.getChannelData(channel);for(let i=0;i<length;i++)values[i]=(Math.random()*2-1)*Math.pow(1-i/length,p.ambience==='hall'?2:3);}this.convolver=this.ctx.createConvolver();this.convolver.buffer=impulse;const dry=this.ctx.createGain(),wet=this.ctx.createGain();dry.gain.value=1-Math.min(.75,intensity*.7);wet.gain.value=Math.min(.75,intensity*.75);output.connect(dry);output.connect(this.convolver);this.convolver.connect(wet);dry.connect(this.gain);wet.connect(this.gain);}else output.connect(this.gain);this.gain.connect(this.ctx.destination);this.node.port.postMessage({type:'pitch',value:p.pitchMultiplier??1});
 }
 init(){return this.ready||=this.initialize();}
 async initialize(){try{this.ctx=new AudioContext({sampleRate:24000,latencyHint:'interactive'});await this.ctx.audioWorklet.addModule(chrome.runtime.getURL('pcm-player-worklet.js'));if(this.stopped)throw Object.assign(new Error('Reprodução cancelada.'),{cancelled:true});this.node=new AudioWorkletNode(this.ctx,'gemini-pcm-player');this.record('worklet-ready');this.node.port.onmessage=e=>{if(this.stopped)return;const data=e.data;if(data.type==='control-ack'){const pending=this.controlAcks.get(data.controlSeq);if(!pending||data.command!==pending.command||typeof data.paused!=='boolean'||!Number.isFinite(data.frame)||!Number.isFinite(data.availableStart))return;if(pending.command==='pause'&&data.paused!==pending.value)return;this.controlAcks.delete(data.controlSeq);clearTimeout(pending.timer);this.ackSeq=data.controlSeq;this.workletPaused=data.paused;this.positionFrame=data.frame;this.availableStart=data.availableStart;pending.resolve(data);return;}if(data.type==='position'){this.positionFrame=data.frame;this.availableStart=data.availableStart;if(!this.controlling)publicEvent(this.payload,'position',{status:this.status()});this.maybeEnd();}if(data.type==='drain'){this.pending=Math.max(0,this.pending-1);this.maybeEnd();}if(data.type==='first-played'&&this.firstPlayedAt===null){
 this.firstPlayedAt=performance.now();
 this.record('first-frame-consumed',data);
 if(!this.managed&&!this.paused&&!this.controlling){
  publicEvent(this.payload,'first-playback',{firstPcmPlayedAt:Date.now(),status:this.status()});
  publicEvent(this.payload,'play',{status:this.status()});
 }
}
if(data.type==='playback-state'&&this.managed&&data.controlSeq===this.ackSeq){
 this.rendering=data.rendering===true;
 if(!this.paused&&!this.controlling&&this.authorized)void this.publishPlaybackState();
}};this.gain=this.ctx.createGain();this.gain.gain.value=this.managed?0:effectiveVolume(this);this.connectEffects();this.record('destination-connected',{volume:this.volume,muted:this.volume===0,paused:this.paused,playbackRate:this.rate});await this.ctx.resume();if(this.ctx.state!=='running')throw new Error('AudioContext não iniciou: '+this.ctx.state);this.record('context-running');}catch(error){this.stop();throw error;}}
 add(index,bytes,done=false,mimeType){
  if(this.stopped)return;
  let chunk;
  if(bytes?.length){
   const format=pcmFormat(bytes,mimeType);
   const rate=format.sampleRate/(this.ctx.sampleRate||24000);
   // Reserve the larger representation before this chunk can wait in a paused or out-of-order block.
   const cacheBytes=Math.max(bytes.byteLength,resampledFrames(format.frames,rate)*Float32Array.BYTES_PER_ELEMENT);
   if(this.managed&&playbackBytes()+cacheBytes>PLAYBACK_CACHE_LIMIT){
    throw Object.assign(Error('Limite de 128 MB do cache de reprodução atingido. Geração interrompida; áudio já recebido preservado em pausa. Libere outras narrações com Stop antes de gerar novamente.'),{code:'PLAYBACK_CACHE_LIMIT'});
   }
   chunk={bytes,format,rate,cacheBytes};
  }
  let block=this.blocks.get(index);
  if(!block){
   block={chunks:[],done:false};
   this.blocks.set(index,block);
  }
  if(chunk){
   if(!block.received){
    block.received=true;
    this.record('pcm-received',{blockId:index,...chunk.format});
   }
   block.chunks.push(chunk);
  }
  if(done)block.done=true;
  this.flush();
 }
 discard(index){if(index>=this.next)this.blocks.delete(index);}
 flush(){if(this.stopped||this.paused)return;if(this.managed&&!this.authorized){
  while(this.blocks.get(this.next)?.done&&!this.blocks.get(this.next).chunks.length){this.blocks.delete(this.next);this.next++;}this.maybeEnd();
  if(this.blocks.get(this.next)?.chunks.length&&!this.activation&&this.desired==='play'){
   this.activation=activatePlayback(this).catch(error=>publicEvent(this.payload,'playback-warning',{warning:error.message})).finally(()=>{this.activation=null;});
  }return;
 }
 while(true){
  const block=this.blocks.get(this.next);
  if(!block)return;
  while(block.chunks.length){
   const {bytes,format,rate}=block.chunks.shift(),pcm=toFloat(bytes,rate);
   const frames=pcm.length;
   this.node.port.postMessage({type:'rate',value:this.rate});
   this.node.port.postMessage({type:'enqueue',buffer:pcm.buffer,blockId:this.next},[pcm.buffer]);
   this.pending++;
   this.enqueuedFrames+=frames;
   if(!block.enqueued){
    block.enqueued=true;
    this.record('player-enqueue',{blockId:this.next,frames,sourceBytes:format.bytes});
   }
  }
  if(!block.done)return;
  this.blocks.delete(this.next);
  this.next++;
 }}
 maybeEnd(){if(!this.stopped&&!this.paused&&!this.controlling&&this.generationDone&&this.pending===0&&this.positionFrame>=this.enqueuedFrames&&this.next>=this.totalBlocks){publicEvent(this.payload,'ended',{status:this.status(true)});jobs.delete(routeKey(this.payload));this.stop();notifyIdle();}}
 control(work){const task=this.controlQueue.catch(()=>{}).then(async()=>{await this.ready;if(this.stopped||!this.node)throw Error('Player PCM encerrado.');this.controlling=true;try{return await work();}catch(error){if(this.stopped)throw error;this.gain.gain.value=0;await this.contextAction('suspend','suspended').catch(()=>{});if(this.stopped)throw error;this.rendering=false;this.authorized=false;this.record('control-error',{...this.status()});if(this.managed&&!this.paused)void this.publishPlaybackState();throw error;}finally{this.controlling=false;this.maybeEnd();}});this.controlQueue=task.catch(()=>{});return task;}
 async contextAction(action,state){let timer;try{await Promise.race([this.ctx[action](),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout AudioContext '+action+'.')),3000);})]);if(this.stopped||this.ctx.state!==state)throw Error('AudioContext não confirmou '+action+': '+this.ctx.state);}finally{clearTimeout(timer);}}
 workletCommand(command,values){const controlSeq=++this.controlSeq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.controlAcks.delete(controlSeq);reject(Error('Worklet não confirmou '+command+'.'));},3000);this.controlAcks.set(controlSeq,{resolve,reject,timer,command,value:values.value});this.node.port.postMessage({type:command,...values,controlSeq});});}
 seek(deltaSeconds){return this.control(async()=>{if(![-5,5].includes(deltaSeconds)||!this.enqueuedFrames)throw Error('Buffer PCM navegável indisponível.');if(this.paused)await this.contextAction('resume','running');await this.workletCommand('seek',{deltaSeconds});if(this.paused)await this.contextAction('suspend','suspended');this.record('seeked',{...this.status()});await publicEvent(this.payload,'position',{status:this.status()});return this.status();});}
 pause(value){return this.control(async()=>{if(this.paused===value&&this.workletPaused===value&&this.ctx.state===(value?'suspended':'running'))return this.status();if(value){this.rendering=false;this.gain.gain.value=0;if(this.ctx.state==='suspended')await this.contextAction('resume','running');await this.workletCommand('pause',{value:true});await this.contextAction('suspend','suspended');}else{await this.contextAction('resume','running');if(this.managed&&this.authorized&&(this.desired!=='play'||this.intent!==latestIntent))return this.status();this.gain.gain.value=!this.managed||this.authorized?effectiveVolume(this):0;await this.workletCommand('pause',{value:false});}if(this.stopped)throw Error('Player PCM encerrado.');this.paused=value;if(!value&&!this.managed)this.flush();this.record(value?'paused':'resumed',{...this.status()});if(value)this.publishedPlaybackState='paused';if(value||!this.managed)await publicEvent(this.payload,value?'pause':'play',{status:this.status()});return this.status();});}
 set(volume,rate){if(Number.isFinite(volume)){this.volume=Math.max(0,Math.min(1,volume));if(this.gain&&!this.paused&&!this.controlling&&(!this.managed||this.authorized))this.gain.gain.value=effectiveVolume(this);}if(Number.isFinite(rate)){this.rate=Math.max(.5,Math.min(2,rate));this.node?.port.postMessage({type:'rate',value:this.rate});}this.record('settings-applied',{volume:this.volume,playbackRate:this.rate});publicEvent(this.payload,'settings',{status:this.status()});}
 stop(){
  if(this.stopped)return this.closed;
  this.stopped=true;
  this.authorized=false;
  if(this.gain)this.gain.gain.value=0;
  for(const pending of this.controlAcks.values()){
   clearTimeout(pending.timer);
   pending.reject(Error('Player PCM encerrado.'));
  }
  this.controlAcks.clear();
  this.blocks.clear();
  this.pending=0;
  if(this.node){
   this.node.onprocessorerror=null;
   this.node.port.onmessage=null;
   try{this.node.port.postMessage({type:'flush'});}catch{/* The processor may already have failed. */}
   this.node.port.close?.();
   this.node.disconnect?.();
  }
  this.gain?.disconnect?.();
  for(const filter of this.filters||[])filter.disconnect?.();
  if(this.convolver){
   this.convolver.disconnect?.();
   this.convolver.buffer=null;
  }
  this.node=this.gain=this.filters=this.convolver=null;
  if(this.ctx)this.ctx.onstatechange=null;
  playbackPlayers.delete(this);
  let timer,closing;
  try{if(this.ctx&&this.ctx.state!=='closed')closing=this.ctx.close();}
  catch(error){closing=Promise.reject(error);}
  this.closed=Promise.race([Promise.resolve(closing),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error('Timeout encerrando AudioContext.')),3000);
  })]).then(()=>!this.ctx||this.ctx.state==='closed',()=>false).then(success=>{
   this.record(success?'stopped':'control-error',this.status());
   return success;
  }).finally(()=>clearTimeout(timer));
  return this.closed;
 }
}
function keyOrder(job,index,modelId){const saved=job.payload.keyOrderByModel?.[modelId],base=Array.isArray(saved)?saved:job.payload.apiKeys.map((_,k)=>k),rotated=base.slice(index%Math.max(1,base.length)).concat(base.slice(0,index%Math.max(1,base.length)));return [...new Set(rotated)].filter(k=>Number.isInteger(k)&&k>=0&&k<job.payload.apiKeys.length&&!job.cooldowns.has(modelId+':'+k));}
async function attemptBlock(job,index){
 const {payload,controller,blocks,player}=job,errors=[];
 for(const modelId of LiveConfig.modelChain('tts',payload.modelId,payload.models||[])){
  if(!LiveConfig.caps(modelId).supportsNarration)continue;
  for(const k of keyOrder(job,index,modelId)){
   if(controller.signal.aborted)throw controller.signal.reason;
   const started=performance.now();let session,receivedPcm=false,streamedPcm=false;
   try{
    publicEvent(payload,'status',{status:'Gerando '+(index+1)+'/'+blocks.length,blockId:index,modelId,keyLabel:'key#'+(k+1)});
    session=await manager.acquire({...payload,signal:controller.signal,modelId,blockId:index,apiKey:payload.apiKeys[k],keyIndex:k+1,...(modelId===payload.modelId?{}:{jsonMode:'panel',advancedJson:null})});
    controller.signal.throwIfAborted();
    publicEvent(payload,'setup-complete',{blockId:index,modelId,keyLabel:'key#'+(k+1),socketOpenMs:session.socketOpenMs,setupCompleteMs:session.setupCompleteMs,...(payload.tabId===0?{actualSetup:session.lastSetup}:{})});
    const result=await session.sendTurn(blocks[index],part=>{
     if(part.type!=='pcm'||!part.bytes.byteLength||controller.signal.aborted)return;
     if(!job.firstPcmAt){
      job.firstPcmAt=Date.now();
      publicEvent(payload,'first-pcm',{blockId:index,modelId,keyLabel:'key#'+(k+1),firstPcmAt:job.firstPcmAt,...pcmFormat(part.bytes,part.mimeType)});
     }
     if(player.next===index)streamedPcm=true;
     try{player.add(index,part.bytes,false,part.mimeType);}
     catch(error){
      if(error.code!=='PLAYBACK_CACHE_LIMIT')throw error;
      controller.abort(error);
      return;
     }
     receivedPcm=true;
    },controller.signal,{collectPcm:false});
    if(controller.signal.aborted)throw controller.signal.reason;
    if(!receivedPcm)throw new Error('Modelo Live não retornou áudio; resposta indisponível.');
    player.add(index,null,true);manager.release(session);
    player.record('turn-complete',{blockId:index,modelId,keyId:'key#'+(k+1)});
    job.completedBlocks=(job.completedBlocks||0)+1;publicEvent(payload,'block-complete',{blockId:index,completed:job.completedBlocks,blocks:blocks.length});publicEvent(payload,'ranking',{result:'SUCCESS',blockId:index,modelId,keyIndex:k+1,durationMs:performance.now()-started,metrics:result.metrics});
    return;
   }catch(error){
    if(session)manager.retire(session);
    if(controller.signal.aborted)throw controller.signal.reason;
    const kind=LiveSessions.classifyLiveError(error),message=LiveConfig.redactSecrets(error.message||String(error),payload.apiKeys);
    if(error.protocol)publicEvent(payload,'protocol-diagnostic',{blockId:index,modelId,keyLabel:'key#'+(k+1),phase:error.protocolPhase||error.protocol.phase,setupCompleteReceived:error.protocol.setupCompleteReceived,close:error.protocol.close,lastSentType:error.protocol.lastSentType,lastReceivedEvent:error.protocol.lastReceivedEvent});
    publicEvent(payload,'ranking',{result:kind,blockId:index,modelId,keyIndex:k+1,durationMs:performance.now()-started,error:message});
    if(kind==='QUOTA'||kind==='AUTH')job.cooldowns.add(modelId+':'+k);
    if(controller.signal.aborted||kind==='REQUEST'||kind==='CANCELLED'||kind==='INVALIDATED_CONTEXT'||
      streamedPcm||player.blocks.get(index)?.enqueued)throw error;
    player.discard(index);
    errors.push(modelId+' key#'+(k+1)+': '+message);
   }
  }
 }
 throw new Error('Fallback Live esgotado no bloco '+(index+1)+': '+errors.join(' | '));
}
function failTts(job,error){
 const {payload,player,controller}=job,id=routeKey(payload);
 if(player.stopped||jobs.get(id)!==job)return;
 controller.abort(error);
 const closing=player.stop();
 jobs.delete(id);
 publicEvent(payload,'error',{error:LiveConfig.redactSecrets(error.message||String(error),payload.apiKeys)});
 void closing.then(notifyIdle);
}
async function runTts(job){
 const {payload,controller,blocks,player}=job;
 const workers=Math.min(blocks.length,payload.apiKeys.length,Math.max(1,payload.maxParallelLiveSessions||3));
 let cursor=0;
 try{
  await Promise.all(Array.from({length:workers},async()=>{
   while(cursor<blocks.length&&!controller.signal.aborted)await attemptBlock(job,cursor++);
  }));
  if(controller.signal.aborted)return;
  player.generationDone=true;
  publicEvent(payload,'generation-complete',{blocks:blocks.length});
  player.maybeEnd();
 }catch(error){
  if(player.stopped)return;
  const reason=controller.signal.reason||error;
  controller.abort(error);
  if(!player.hasCachedPcm()){failTts(job,reason);return;}
  player.desired='pause';
  player.authorized=false;
  if(player.gain)player.gain.gain.value=0;
  try{await coordinate(()=>player.pause(true));}
  catch(controlError){failTts(job,controlError);return;}
  if(player.stopped)return;
  // Close the buffered blocks so the retained audio can finish after a user resumes it.
  player.totalBlocks=Math.max(player.next,...[...player.blocks.keys()].map(index=>index+1));
  for(let index=player.next;index<player.totalBlocks;index++){
   const block=player.blocks.get(index)||{chunks:[]};
   block.done=true;
   player.blocks.set(index,block);
  }
  player.generationDone=true;
  await publicEvent(payload,'playback-warning',{warning:LiveConfig.redactSecrets(reason.message||String(reason),payload.apiKeys)});
 }
}
async function startTts(payload){
 payload={...payload,mode:'narration'};
 LiveConfig.assertRouteModel(payload.modelId,'tts');
 LiveConfig.buildLiveSessionConfig(payload);
 const id=routeKey(payload),prior=jobs.get(id);
 if(prior){
  if(prior.payload.requestId!==payload.requestId)throw Error('Já existe uma narração em geração ou em cache para esta tarefa.');
  return{success:true,jobId:payload.jobId,blocks:prior.blocks.length};
 }
 if(playbackBytes()>=PLAYBACK_CACHE_LIMIT)throw Error('Cache de reprodução cheio; narrações pausadas preservadas. Libere áudio com Stop antes de gerar outra tarefa.');
 const blocks=LiveConfig.splitLiveNarrationBlocks(payload.text,payload.chunkSize);
 if(!blocks.length)throw new Error('Texto vazio.');
 const player=new OrderedPlaybackBuffer(payload);
 player.managed=true;
 player.authorized=false;
 playbackIntent(player,payload.playbackIntent);
 player.totalBlocks=blocks.length;
 const job={payload,blocks,player,controller:new AbortController(),cooldowns:new Set()};
 jobs.set(id,job);
 try{
  await player.init();
  if(job.controller.signal.aborted||jobs.get(id)!==job)throw Object.assign(new Error('Inicialização Live cancelada.'),{cancelled:true});
 }catch(error){
  player.stop();
  if(jobs.get(id)===job)jobs.delete(id);
  notifyIdle();
  throw error;
 }
 player.node.onprocessorerror=()=>failTts(job,Error('O processador de reprodução PCM falhou.'));
 player.ctx.onstatechange=()=>{
  if(player.ctx.state==='closed')failTts(job,Error('AudioContext da narração foi encerrado.'));
  else if(player.authorized&&!player.controlling&&!player.paused)void player.publishPlaybackState();
 };
 publicEvent(payload,'status',{status:'Conectando',blocks:blocks.length});
 void runTts(job);
 return{success:true,jobId:payload.jobId,blocks:blocks.length};
}
async function transformTranscript(d,transcript){const {payload}=d,models=LiveConfig.modelChain('tts',payload.transformModels?.[0],payload.transformModels||LiveConfig.eligibleModels('tts'));let last;for(const modelId of models)for(let k=0;k<payload.apiKeys.length;k++){if(d.controller.signal.aborted)throw Object.assign(new Error('Transformação cancelada.'),{cancelled:true});let session;try{publicEvent(payload,'stt-transform-attempt',{modelId,keyLabel:'key#'+(k+1)});session=await manager.acquire({modelId,apiKey:payload.apiKeys[k],keyIndex:k+1,mode:'agent',signal:d.controller.signal,agentId:payload.agentId,jobId:payload.jobId,systemInstruction:payload.transformInstruction,outputTranscription:true,voiceName:payload.voiceName||'Kore'});if(d.controller.signal.aborted)throw Object.assign(new Error('Transformação cancelada.'),{cancelled:true});const output=await session.sendTurn(transcript,null,d.controller.signal);manager.release(session);if(output.text)return output.text;throw new Error('Agente Live não retornou texto de saída.');}catch(error){last=error;if(session)manager.retire(session);if(d.controller.signal.aborted)throw Object.assign(new Error('Transformação cancelada.'),{cancelled:true});const kind=LiveSessions.classifyLiveError(error);if(['REQUEST','CANCELLED','INVALIDATED_CONTEXT'].includes(kind))throw error;}}throw last||new Error('Transformação Live indisponível.');}
function confirmedText(d){return [...d.finalParts,d.pendingText||''].filter(Boolean).join(' ').trim();}
function commitNativeDictation(d){if(!d.pendingText?.trim())return;const text=d.pendingText.trim();d.pendingText='';d.finalParts.push(text);publicEvent(d.payload,'stt-segment',{text,confirmedText:confirmedText(d),partialText:''});}
async function preserveSttAudio(work){try{return await eventTimeout(work);}catch(error){if(error.code)throw error;throw Object.assign(Error('Armazenamento do áudio STT sem confirmação. Material já retido continua disponível em Opções.'),{code:'RECOVERY_STORAGE'});}}
function recoveryState(d,state){if(!d.recoveryStarted)return;return preserveSttAudio(d.recovery.update(d.payload.jobId,{state,...d.chunkTransport?.stats})).catch(()=>{sttDiagnostic(d,'error',{outcome:'RECOVERY_STORAGE'});});}
function realtimeFailure(d,error,stopReason=error.code==='BACKPRESSURE'?'backpressure':error.code==='RECOVERY_STORAGE'?'recovery-storage':error.code==='RECOVERY_LIMIT'?'recovery-limit':'transport-error'){
 if(d.controller.signal.aborted||d.finalized)return;
 if(['RECOVERY_STORAGE','RECOVERY_LIMIT'].includes(error.code))getSttScheduler().release(d.lease);else getSttScheduler().fail(d.lease,error);d.controller.abort(error);d.chunkTransport?.cancel(error);clearTimeout(d.finalTimer);if(d.session)retireDictation(d);
 // Mantém o offscreen vivo até o estado do journal ser confirmado ou falhar explicitamente.
 d.recoveryEnding=Promise.resolve(d.distributed?d.chunkTransport?.work:undefined).then(()=>recoveryState(d,'interrupted')).finally(()=>{if(dictations.get(d.payload.jobId)===d)dictations.delete(d.payload.jobId);notifyIdle();});
 sttDiagnostic(d,'error',{stopReason,errorKind:LiveSessions.classifyLiveError(error),outcome:error.code==='BACKPRESSURE'?'BACKPRESSURE':'CONNECTION',closeCode:error.closeCode});publicEvent(d.payload,'stt-error',{stopReason,incomplete:true,recoveryAvailable:!!d.retainedBytes,error:LiveConfig.redactSecrets(error.message||String(error),d.payload.apiKeys)});
}
function publishSttPartial(d,result){if(d.timings.firstResponseMs===undefined){d.timings.firstResponseMs=performance.now()-d.startedAt;sttDiagnostic(d,'input-transcription',{sequence:result.sequence});}return publicEvent(d.payload,'stt-partial',{confirmed:false,...result,publishedAt:Date.now()});}
async function ensureDictationSession(d){if(!d.awaitingResume)return;if(!d.resuming)d.resuming=(async()=>{const old=d.session;if(!old.resumeHandle)throw Error('Sessão remota expirou sem token de retomada; áudio local preservado.');sttDiagnostic(d,'session-resuming');const next=await manager.acquire({...old.options,resumeHandle:old.resumeHandle,signal:d.controller.signal});if(d.controller.signal.aborted){manager.retire(next);throw Object.assign(Error('Ditado cancelado.'),{cancelled:true});}d.session=next;d.lease.session=next;d.chunkTransport.resumeEpoch();next.handler=d.handleSessionMessage;d.awaitingResume=false;sttDiagnostic(d,'session-resumed');publicEvent(d.payload,'stt-status',{status:'Gravando · sessão remota retomada'});})();try{await d.resuming;}finally{d.resuming=null;}}
function realtimeTransport(d){return new globalThis.SttRealtime.DictationTransport({
 jobId:d.payload.jobId,setTimer:setTimeout,clearTimer:clearTimeout,requiresIdle:LiveConfig.caps(d.payload.modelId).requiresInteractionIdle,timeoutMs:LiveConfig.caps(d.payload.modelId).requiresInteractionIdle?90000:15000,
 retain:async packet=>{await preserveSttAudio(d.recovery.append(d.payload.jobId,packet));d.retainedBytes=(d.retainedBytes||0)+packet.pcm.byteLength;},
 sendAudio:async bytes=>{await ensureDictationSession(d);if((d.session.socket?.bufferedAmount||0)>SttRealtime.CONFIG.maxQueuedBytes)throw Object.assign(Error('WebSocket STT congestionado; áudio retido para recuperação.'),{code:'BACKPRESSURE'});sendSttAudio(d,bytes);},
 endAudio:()=>{if(!d.awaitingResume){endSttAudio(d);sttDiagnostic(d,'activity-end');}},
 onPartial:result=>{if(result.text||result.partialText)publishSttPartial(d,result);},
 onChunk:result=>{if(Number.isFinite(result.latencyMs))getSttScheduler().recordChunk(d.lease,result.latencyMs);d.finalParts=result.text?[result.text]:[];publicEvent(d.payload,'stt-segment',{resultSequence:result.resultSequence,text:result.text,confirmedText:result.confirmedText,partialText:'',incomplete:result.incomplete});},
 onWarning:result=>{d.incomplete=true;sttDiagnostic(d,'chunk-unresolved',{sequence:result.sequence,chunkId:d.payload.jobId+':'+result.sequence,outcome:'NO_TRANSCRIPTION'});publicEvent(d.payload,'stt-warning',{incomplete:true,recoveryAvailable:!!d.retainedBytes,warning:'Trecho sem transcrição conclusiva. O ditado continua; áudio preservado localmente para recuperação.'});void recoveryState(d,'recording');},
 onFailure:error=>realtimeFailure(d,error),onDiagnostic:packet=>sttDiagnostic(d,packet.stage,packet)
 });}
function sttDiagnostic(d,stage,extra={}){void globalThis.LiveSttDiagnostics?.emit({jobId:d.payload.jobId,scope:'transport',stage,modelId:d.payload.modelId,receivedChunks:d.receivedChunks||0,receivedBytes:d.receivedBytes||0,interactionStatus:d.interactionStatus,...d.session?.sttSnapshot?.(),...d.timings,elapsedMs:performance.now()-d.startedAt,sessionId:d.session?.id,keyLabel:d.lease?'key#'+d.lease.keyIndex:undefined,socketOpenMs:d.session?.socketOpenMs,setupCompleteMs:d.session?.setupCompleteMs,chunked:!!d.chunkTransport,...extra});}
let distributedPcmBytes=0;
const distributedPcmBudget={
 take(bytes){
  if(distributedPcmBytes+bytes>8*SttRealtime.CONFIG.maxQueuedBytes)return false;
  distributedPcmBytes+=bytes;
  return true;
 },
 release(bytes){distributedPcmBytes-=bytes;}
};
function distributedTransport(d,models,scheduler){
 const {payload}=d;
 return new SttRealtime.DistributedDictation({
  jobId:payload.jobId,budget:distributedPcmBudget,copies:Math.min(2,new Set(payload.apiKeys).size),
  setTimer:setTimeout,clearTimer:clearTimeout,now:()=>performance.now(),
  async retain(packet){
   await preserveSttAudio(d.recovery.append(payload.jobId,packet));
   d.retainedBytes=(d.retainedBytes||0)+packet.pcm.byteLength;
  },
  async openLane({sequence,copy,accounts,signal,receive,fail}){
   const lease=await scheduler.admit({
    jobId:payload.jobId+':'+sequence+':'+copy,generation:payload.generation,
    keys:payload.apiKeys,models,config:payload.schedulerPolicy,signal,blockAccounts:accounts,
    open:({modelId,keyIndex,signal})=>manager.acquire({
     modelId,apiKey:payload.apiKeys[keyIndex-1],keyIndex,signal,mode:'dictation',jobId:payload.jobId,blockId:sequence,
     vad:{...payload.vad,disabled:true},sttRecognition:payload.sttRecognition,
     thinkingLevel:payload.thinkingLevel,thinkingBudget:payload.thinkingBudget
    })
   });
   const {session,modelId,keyIndex}=lease,requiresIdle=LiveConfig.caps(modelId).requiresInteractionIdle;
   const metric={sequence,copy,keyLabel:'key#'+keyIndex,sessionId:session.id,modelId};
   let sent=false;
   session.handler=(message,wire)=>{
    if(message.error){fail(message.error.cause||Error(message.error.message||'Sessão STT encerrada.'));return;}
    scheduler.observe(lease,message);
    if(message.serverContent)receive(message.serverContent,wire?.afterAudioEnd,wire?.afterNewSpeech);
   };
   return {
    requiresIdle,timeoutMs:requiresIdle?90000:15000,
    send(bytes,hasNewSpeech){
     if((session.socket?.bufferedAmount||0)>SttRealtime.CONFIG.maxQueuedBytes){
      throw Object.assign(Error('WebSocket STT congestionado.'),{code:'BACKPRESSURE'});
     }
     scheduler.sendAudio(lease,bytes,pcm=>session.sendAudio(pcm,16000,hasNewSpeech));
     if(!sent){sent=true;sttDiagnostic(d,'chunk-send',metric);}
     if(!d.firstAudioSent){
      d.firstAudioSent=true;
      d.timings.firstPcmMs=performance.now()-d.startedAt;
      sttDiagnostic(d,'first-pcm',metric);
      publicEvent(payload,'stt-audio-sent',{bytes:bytes.byteLength,sampleRate:16000});
     }
    },
    end(){scheduler.endAudio(lease,()=>session.endAudio());},
    confirm(latencyMs){scheduler.recordChunk(lease,latencyMs);sttDiagnostic(d,'chunk-merge',{...metric,latencyMs});},
    close(error){
     session.handler=null;
     manager.retire(session);
     if(error)scheduler.fail(lease,error);else scheduler.release(lease);
    }
   };
  },
  onPartial:result=>publishSttPartial(d,result),
  onChunk:result=>{
   d.finalParts=result.text?[result.text]:[];
   publicEvent(payload,'stt-segment',{text:result.text,confirmedText:result.text,partialText:'',incomplete:result.incomplete,sequence:result.sequence,textBoundaries:result.textBoundaries,publishedAt:Date.now()});
  },
  onWarning:({sequence,gap})=>{
   if(gap){d.incomplete=true;void recoveryState(d);}
   sttDiagnostic(d,gap?'chunk-unresolved':'chunk-degraded',{sequence,...(gap?{outcome:'NO_TRANSCRIPTION'}:{})});
   if(!gap&&d.redundancyWarning)return;
   if(!gap)d.redundancyWarning=true;
   publicEvent(payload,'stt-warning',{sequence,incomplete:gap,recoveryAvailable:!!d.retainedBytes,
    warning:gap?'Bloco '+sequence+' sem transcrição conclusiva. Áudio preservado para recuperação.':'Proteção reduzida: nem todos os blocos puderam usar duas sessões independentes.'});
  },
  onFailure:error=>realtimeFailure(d,error)
 });
}
function finalizeDictation(d){
 if(!d.stopped||d.finalized||d.controller.signal.aborted)return;
 if(!d.distributed&&LiveConfig.caps(d.payload.modelId).requiresInteractionIdle&&d.interactionStatus!=='IDLE'){
  d.controller.abort();clearTimeout(d.finalTimer);void recoveryState(d,'interrupted');if(d.session)retireDictation(d);if(dictations.get(d.payload.jobId)===d)dictations.delete(d.payload.jobId);sttDiagnostic(d,'error',{outcome:'TIMEOUT'});publicEvent(d.payload,'stt-error',{incomplete:true,recoveryAvailable:!!d.retainedBytes,error:'Timeout aguardando interactionStatus IDLE no ditado Live.'});notifyIdle();return;
 }
 commitNativeDictation(d);d.finalized=true;clearTimeout(d.finalTimer);const text=d.finalParts.join(' ').trim();
 const finish=async()=>{
  try{
   if(!text){const outcome=d.chunkTransport&&!d.receivedBytes?'NO_SPEECH':!d.receivedBytes?'CAPTURE_NOT_SENT':d.sawInterim?'INTERIM_ONLY':'NO_TRANSCRIPTION';sttDiagnostic(d,'error',{outcome});throw new Error(outcome==='NO_SPEECH'?'Nenhuma fala detectada pelo VAD; confira o nível do microfone.':!d.receivedBytes?'Nenhum PCM chegou ao WebSocket STT.':d.sawInterim?'Timeout: apenas transcrição provisória recebida; nenhum resultado final.':'PCM enviado ao Gemini sem transcrição conclusiva.'+(d.retainedBytes?' Áudio preservado localmente para recuperação em Opções.':''));}
   let final=text;
   if(d.payload.transformInstruction){publicEvent(d.payload,'stt-status',{status:'Transformando com agente'});const started=performance.now();sttDiagnostic(d,'transform-start');final=await transformTranscript(d,text);sttDiagnostic(d,'transform-complete',{transformDurationMs:performance.now()-started});}
   if(d.controller.signal.aborted)return;
   await recoveryState(d,d.incomplete?'incomplete':'completed');if(d.controller.signal.aborted)return;publicEvent(d.payload,'stt-status',{status:'Inserindo'});sttDiagnostic(d,'final',{outcome:'FINAL',characters:final.length});await publicEvent(d.payload,'stt-final',{text:final,confirmedText:final,partialText:'',...(!d.payload.transformInstruction&&d.distributed?{textBoundaries:d.chunkTransport.snapshot().textBoundaries}:{}),incomplete:d.originLost===true||d.incomplete===true,recoveryAvailable:!!d.retainedBytes,publishedAt:Date.now()});
  }catch(error){if(!d.controller.signal.aborted)await recoveryState(d,'incomplete');if(!d.controller.signal.aborted)await publicEvent(d.payload,'stt-error',{incomplete:true,recoveryAvailable:!!d.retainedBytes,error:LiveConfig.redactSecrets(error.message||String(error),d.payload.apiKeys)});}
  finally{if(d.session)retireDictation(d);if(dictations.get(d.payload.jobId)===d)dictations.delete(d.payload.jobId);notifyIdle();}
 };d.finishing=finish();
}
let sttScheduler;
function retireDictation(d){if(d.session)manager.retire(d.session);sttScheduler?.release(d.lease);}
function getSttScheduler(){return sttScheduler||=globalThis.SttScheduler.create({setTimer:setTimeout,clearTimer:clearTimeout,classify:LiveSessions.classifyLiveError,retire:session=>manager.retire(session),load:async()=>{const reply=await chrome.runtime.sendMessage({type:'STT_SCHEDULER_LOAD'});return reply?.state;},save:async state=>{const reply=await chrome.runtime.sendMessage({type:'STT_SCHEDULER_SAVE',payload:state});if(reply?.success===false)throw Error('STT scheduler storage unavailable.');}});}
function sendSttAudio(d,bytes){getSttScheduler().sendAudio(d.lease,bytes,pcm=>d.session.sendAudio(pcm,16000));}
function endSttAudio(d){getSttScheduler().endAudio(d.lease,()=>d.session.endAudio());}
async function startStt(payload){
 if(payload.realtime===true)payload={...payload,transformInstruction:null,transformModels:undefined};
 if(dictations.has(payload.jobId))throw new Error('Sessão STT duplicada.');
 const d={payload,startedAt:performance.now(),timings:{},finalParts:[],pendingText:'',stopped:false,finalized:false,controller:new AbortController(),finalTimer:null};dictations.set(payload.jobId,d);
 const models=LiveConfig.modelChain('stt',payload.modelId,payload.models||[]),scheduler=getSttScheduler();
 try{
  LiveConfig.assertRouteModel(payload.modelId,'stt');if(payload.realtime===true||payload.chunked===true){d.recovery=globalThis.SttRecovery||SttRealtime.recovery;d.recoveryOpening=preserveSttAudio(d.recovery.start(payload.jobId,payload)).then(()=>{d.recoveryStarted=true;});await d.recoveryOpening;}sttDiagnostic(d,'connecting');
  if(payload.distributed===true&&payload.chunked===true){
   if(d.controller.signal.aborted)throw d.controller.signal.reason;
   d.distributed=true;
   d.chunkTransport=distributedTransport(d,models,scheduler);
   publicEvent(payload,'stt-status',{status:'Gravando · blocos STT distribuídos'});
   return{success:true,jobId:payload.jobId,modelId:payload.modelId,transform:!!payload.transformInstruction};
  }
  d.lease=await scheduler.admit({jobId:payload.jobId,generation:payload.generation,keys:payload.apiKeys,models,signal:d.controller.signal,config:payload.schedulerPolicy,onAttempt:({modelId,keyIndex})=>publicEvent(payload,'stt-connect-attempt',{modelId,keyLabel:'key#'+keyIndex}),onAttemptError:({modelId,keyIndex,error})=>publicEvent(payload,'stt-connect-error',{modelId,keyLabel:'key#'+keyIndex,error:LiveConfig.redactSecrets(error.message||String(error),payload.apiKeys)}),open:({modelId,keyIndex,signal})=>manager.acquire({modelId,apiKey:payload.apiKeys[keyIndex-1],keyIndex,signal,mode:'dictation',jobId:payload.jobId,vad:payload.realtime===true||payload.chunked===true?{...payload.vad,disabled:true}:payload.vad,sttRecognition:payload.sttRecognition,thinkingLevel:payload.thinkingLevel,thinkingBudget:payload.thinkingBudget})});
  d.timings.admissionMs=performance.now()-d.startedAt;d.session=d.lease.session;d.native=LiveConfig.caps(d.lease.modelId).sttProtocol==='native-audio';d.payload={...payload,modelId:d.lease.modelId};
  if(payload.realtime===true||payload.chunked===true)d.chunkTransport=realtimeTransport(d);
  d.session.handler=msg=>{
   if(d.controller.signal.aborted||d.finalized)return;
   if(msg.error){const error=msg.error.cause||Error(msg.error.message||'Sessão STT encerrada.');if(d.chunkTransport?.idle&&!d.stopped&&d.session.resumeHandle&&['TRANSIENT','NETWORK'].includes(LiveSessions.classifyLiveError(error))){d.awaitingResume=true;d.session.handler=null;sttDiagnostic(d,'session-remote-wait',{closeCode:error.closeCode});publicEvent(d.payload,'stt-status',{status:'Gravando · conexão remota encerrada; retomada na próxima fala'});return;}realtimeFailure(d,error,'socket-error');return;}
   scheduler.observe(d.lease,msg);
   if(msg.voiceActivity)sttDiagnostic(d,'server-event',{voiceActivity:msg.voiceActivity.type});
   const sc=msg.serverContent;if(!sc)return;
   if(d.chunkTransport){if(sc.interactionStatus)d.interactionStatus=sc.interactionStatus;d.chunkTransport.receive(sc);return;}
   if(sc.modelTurn||sc.generationComplete||sc.interrupted||sc.waitingForInput){if(!d.lastServerDiagnosticAt||Date.now()-d.lastServerDiagnosticAt>=1000){d.lastServerDiagnosticAt=Date.now();sttDiagnostic(d,'server-event',{generationComplete:sc.generationComplete===true,interrupted:sc.interrupted===true,waitingForInput:sc.waitingForInput===true});}}
   if(sc.interactionStatus){d.interactionStatus=sc.interactionStatus;if(d.stopped&&sc.interactionStatus==='IN_PROGRESS'&&LiveConfig.caps(d.payload.modelId).requiresInteractionIdle){clearTimeout(d.finalTimer);d.finalTimer=setTimeout(()=>finalizeDictation(d),90000);}}
   if(sc.interimInputTranscription?.text){d.sawInterim=true;sttDiagnostic(d,'input-interim');publishSttPartial(d,{text:sc.interimInputTranscription.text,confirmedText:confirmedText(d),partialText:sc.interimInputTranscription.text});}
   // Áudio/modelTurn/outputTranscription do assistente nunca entram no ditado ou no player.
   if(sc.inputTranscription?.text){
    sttDiagnostic(d,'input-transcription',{characters:sc.inputTranscription.text.length});
    if(d.native){d.pendingText+=sc.inputTranscription.text;publishSttPartial(d,{text:d.pendingText,confirmed:true,confirmedText:confirmedText(d),partialText:''});}
    else{d.finalParts.push(sc.inputTranscription.text);publicEvent(d.payload,'stt-segment',{text:sc.inputTranscription.text,confirmedText:confirmedText(d),partialText:''});}
   }
   if(d.native&&(sc.inputTranscription?.finished||sc.turnComplete||sc.interrupted))commitNativeDictation(d);
   if(sc.turnComplete){if(d.stopped)d.stopTurnComplete=true;sttDiagnostic(d,'turn-complete',{turnComplete:true});}
   // inputTranscription é independente de turnComplete. Sem texto, conserva o deadline maior.
   if(d.stopped&&(!LiveConfig.caps(d.payload.modelId).requiresInteractionIdle||d.interactionStatus==='IDLE')&&(d.finalParts.length||d.pendingText?.trim())&&(d.stopTurnComplete||sc.inputTranscription?.finished||d.interactionStatus==='IDLE')){clearTimeout(d.finalTimer);if(!d.native&&sc.turnComplete)finalizeDictation(d);else d.finalTimer=setTimeout(()=>finalizeDictation(d),900);}
  };
  d.handleSessionMessage=d.session.handler;sttDiagnostic(d,'setup-complete',{setupComplete:true});publicEvent(d.payload,'setup-complete',{modelId:d.payload.modelId,socketOpenMs:d.session.socketOpenMs,setupCompleteMs:d.session.setupCompleteMs});return{success:true,jobId:payload.jobId,modelId:d.payload.modelId,transform:!!payload.transformInstruction};
 }catch(error){if(!d.controller.signal.aborted)await recoveryState(d,'interrupted');if(d.session)retireDictation(d);if(dictations.get(payload.jobId)===d)dictations.delete(payload.jobId);notifyIdle();throw error;}
}
function legacyStatus(payload,p){const a=p.audio;return{playerId:payload.playerId,requestId:p.requestId,seq:++p.seq,currentTime:a.currentTime,duration:Number.isFinite(a.duration)?a.duration:null,paused:a.paused,ended:a.ended,volume:p.volume,playbackRate:a.playbackRate};}
function releaseLegacyPlayer(player){
 player.stopped=true;
 player.authorized=false;
 playbackPlayers.delete(player);
 player.audio.pause();
 player.audio.removeAttribute?.('src');
 player.audio.load?.();
}
async function legacyCommand(payload){
 const id=routeKey(payload);let p=legacyPlayers.get(id);
 const release=releaseLegacyPlayer;
 if(payload.operation==='STOP_TAB'){for(const[key,player]of legacyPlayers)if(player.tabId===payload.tabId){release(player);legacyPlayers.delete(key);}return{success:true};}
 if(payload.operation==='STOP'){if(p&&p.requestId===payload.requestId){release(p);legacyPlayers.delete(id);}return{success:true};}
 if(payload.operation==='PLAY'||payload.operation==='RESUME'){
  if(!p){if(!payload.src)return{success:false,error:'Áudio indisponível; solicite uma nova narração.'};
   const audio=new Audio();p={audio,requestId:payload.requestId,tabId:payload.tabId,seq:0,volume:payload.volume??1,authorized:false,stopped:false,
    async pause(value){if(value)this.audio.pause();else{this.audio.volume=effectiveVolume(this);await this.audio.play();}}};legacyPlayers.set(id,p);
   for(const[native,event]of [['playing','play'],['pause','pause'],['ended','ended'],['error','error']])audio.addEventListener(native,()=>{if(legacyPlayers.get(id)!==p)return;const status=legacyStatus(payload,p);legacyEvent(payload,event,status);if(event==='ended'||event==='error'){release(p);legacyPlayers.delete(id);notifyIdle();}});
   audio.src=payload.src;audio.volume=effectiveVolume(p);audio.playbackRate=payload.playbackRate??1;
  }
  if(p.requestId!==payload.requestId)return{success:false,error:'Controle de reprodução antigo.'};
  playbackIntent(p,payload.playbackIntent);await activatePlayback(p);return{success:true,status:legacyStatus(payload,p)};
 }
 if(!p||p.requestId!==payload.requestId)return{success:true};
 if(payload.operation==='PAUSE'){p.desired='pause';p.authorized=false;await coordinate(()=>p.pause(true));}
 if(payload.operation==='SEEK')p.audio.currentTime=payload.currentTime||0;
 if(payload.operation==='SET'){if(Number.isFinite(payload.volume)){p.volume=payload.volume;p.audio.volume=effectiveVolume(p);}if(Number.isFinite(payload.playbackRate))p.audio.playbackRate=payload.playbackRate;}
 return{success:true,status:legacyStatus(payload,p)};
}
function cancelDictation(d){
 if(d.cancelling)return d.cancelling;
 if(d.recoveryEnding)return d.recoveryEnding;
 const jobId=d.payload.jobId;
 d.cancelling=(async()=>{
  sttDiagnostic(d,'cancelled',{outcome:'CANCELLED',stopReason:'user-cancel'});
  d.controller.abort(Object.assign(Error('Ditado cancelado.'),{cancelled:true}));
  d.chunkTransport?.cancel();
  clearTimeout(d.finalTimer);
  if(d.session)retireDictation(d);
  await Promise.allSettled([d.recoveryOpening,d.chunkTransport?.work,d.finishing]);
  await recoveryState(d,'cancelled');
  if(dictations.get(jobId)===d)dictations.delete(jobId);
  publicEvent(d.payload,'stt-cancelled');
  notifyIdle();
 })();
 return d.cancelling;
}
let panicCleanup;
function stopAllOperations(){
 if(panicCleanup)return panicCleanup;
 const reason=Object.assign(Error('Parada global solicitada.'),{cancelled:true});
 const releases=[];
 for(const [key,job] of jobs){
  job.controller.abort(reason);
  releases.push((async()=>await job.player.stop())());
  jobs.delete(key);
 }
 for(const [key,player] of legacyPlayers){
  releases.push((async()=>releaseLegacyPlayer(player))());
  legacyPlayers.delete(key);
 }
 for(const d of dictations.values())releases.push(cancelDictation(d));
 // This document is closed by the service worker after recovery writes settle.
 manager.closeAll();
 panicCleanup=Promise.allSettled(releases).then(async results=>{
  await sttScheduler?.flush();
  return{success:results.every(result=>result.status==='fulfilled'&&result.value!==false)};
 });
 return panicCleanup;
}
async function command(payload){
 if(payload.operation==='STOP_ALL_OPERATIONS')return stopAllOperations();
 if(panicCleanup&&!['GLOBAL_JOBS_SNAPSHOT','GLOBAL_JOBS_ACK','STT_SCHEDULER_SNAPSHOT'].includes(payload.operation))return{success:false,error:'Documento de áudio em encerramento.'};
 if(payload.operation==='STT_SCHEDULER_SNAPSHOT')return{success:true,diagnostics:sttScheduler?.snapshot()||{version:1,activeJobs:0,accounts:[]}};
 if(payload.operation==='GLOBAL_JOBS_SNAPSHOT')return globalSnapshot();
 if(payload.operation==='GLOBAL_JOBS_ACK'){for(const [id,seq]of Object.entries(payload.sequences||{}))if(Number.isFinite(seq)&&seq>=(unacknowledged.get(id)??Infinity))unacknowledged.delete(id);notifyIdle();return{success:true};}
 if(payload.operation==='PLAYBACK_INTENT'){if(Number.isSafeInteger(payload.playbackIntent))latestIntent=Math.max(latestIntent,payload.playbackIntent);return{success:true};}
 if(payload.operation==='SET_GLOBAL'){
  globalVolumeInitialized=true;
  if(Number.isFinite(payload.volume))globalVolume=Math.max(0,Math.min(1,payload.volume));
  for(const player of playbackPlayers){if(player.audio)player.audio.volume=effectiveVolume(player);else if(player.gain&&!player.paused&&!player.controlling&&player.authorized)player.gain.gain.value=effectiveVolume(player);}
  return{success:true,playback:{volume:globalVolume}};
 }
 if(payload.operation==='TTS_LIVE_START'){if(!globalVolumeInitialized&&Number.isFinite(payload.globalVolume)){globalVolume=payload.globalVolume;globalVolumeInitialized=true;}return startTts(payload);}
 if(payload.operation==='STT_LIVE_START')return startStt(payload);
 // Só Stop/perda de origem inicia a espera final. Ausência de texto não para a captura.
 if((payload.operation==='STT_LIVE_STOP'||payload.operation==='STT_ORIGIN_LOST')&&dictations.get(payload.jobId)?.chunkTransport){const d=dictations.get(payload.jobId);if(d.stopped||d.finalized)return{success:true};d.stopped=true;d.stoppedAt=performance.now();d.stopReason=payload.operation==='STT_ORIGIN_LOST'||payload.stopReason==='origin-lost'?'origin-lost':'user-stop';sttDiagnostic(d,'session-ending',{stopReason:d.stopReason});if(payload.operation==='STT_ORIGIN_LOST'){d.originLost=true;publicEvent(d.payload,'stt-origin-lost');}sttDiagnostic(d,'awaiting-gemini');publicEvent(d.payload,'stt-status',{status:'Aguardando Gemini'});void d.chunkTransport.finish().then(result=>{if(d.controller.signal.aborted)return;d.finalParts=result.text?[result.text]:[];d.pendingText='';d.incomplete=d.incomplete||result.incomplete;sttDiagnostic(d,'consolidated',{stopToFinalMs:performance.now()-d.stoppedAt,characters:result.text.length,unresolved:result.unresolved});finalizeDictation(d);},()=>{});return{success:true};}
 if(payload.operation==='STT_LIVE_AUDIO'){
  const d=dictations.get(payload.jobId);if((!d?.session&&!d?.distributed)||d.stopped||d.finalized||d.controller.signal.aborted)return{success:false,error:'Ditado Live não está capturando.'};
  const boundary=!!d.chunkTransport&&(payload.endOnly===true||payload.activityEndOnly===true);
  if(!boundary)LiveConfig.buildLiveAudioMessage(payload.audioBase64,payload.sampleRate??16000);
  const bytes=boundary?new Uint8Array():LiveSessions.decodeBase64(payload.audioBase64);d.receivedChunks=(d.receivedChunks||0)+1;d.receivedBytes=(d.receivedBytes||0)+bytes.byteLength;
  try{if(d.chunkTransport)await d.chunkTransport.submitAudioChunk({pcm:bytes,chunk:payload.chunk,endOnly:payload.endOnly===true,activityEndOnly:payload.activityEndOnly===true,packetSequence:payload.packetSequence});else sendSttAudio(d,bytes);}catch(error){realtimeFailure(d,error);throw error;}
  if(d.distributed)return{success:true};
  if(!d.lastDiagnosticAt||Date.now()-d.lastDiagnosticAt>=1000){d.lastDiagnosticAt=Date.now();sttDiagnostic(d,'audio-sent');}
  if(bytes.length&&!d.firstAudioSent){d.firstAudioSent=true;d.timings.firstPcmMs=performance.now()-d.startedAt;sttDiagnostic(d,'first-pcm');publicEvent(d.payload,'stt-audio-sent',{bytes:bytes.byteLength,sampleRate:payload.sampleRate||16000});}return{success:true};
 }
 if(payload.operation==='STT_LIVE_STOP'||payload.operation==='STT_ORIGIN_LOST'){const d=dictations.get(payload.jobId);if(d&&payload.operation==='STT_ORIGIN_LOST'){d.originLost=true;publicEvent(d.payload,'stt-origin-lost');}if(d?.session&&!d.stopped&&!d.finalized){d.stopped=true;d.stopReason=payload.operation==='STT_ORIGIN_LOST'||payload.stopReason==='origin-lost'?'origin-lost':'user-stop';sttDiagnostic(d,'session-ending',{stopReason:d.stopReason});endSttAudio(d);sttDiagnostic(d,'activity-end');sttDiagnostic(d,'awaiting-gemini');publicEvent(d.payload,'stt-status',{status:'Aguardando Gemini'});clearTimeout(d.finalTimer);d.finalTimer=setTimeout(()=>finalizeDictation(d),LiveConfig.caps(d.payload.modelId).requiresInteractionIdle?90000:15000);}else if(d&&!d.session&&!d.finalized&&d.originLost){d.controller.abort();dictations.delete(payload.jobId);publicEvent(d.payload,'stt-cancelled');notifyIdle();}return{success:true};}
 if(payload.operation==='STT_LIVE_CANCEL'){
  const d=dictations.get(payload.jobId);
  if(d)await cancelDictation(d);
  return{success:true};
 }
 const id=routeKey(payload),job=jobs.get(id)||(!payload.jobId?[...jobs.values()].find(j=>j.payload.tabId===payload.tabId&&(j.payload.frameId||0)===(payload.frameId||0)&&j.payload.playerId===payload.playerId&&j.payload.requestId===payload.requestId):null);
 if(payload.operation==='STOP'||payload.operation==='STOP_TAB'){if(payload.operation==='STOP'&&job&&(payload.requestId!==job.payload.requestId||payload.playerId!==job.payload.playerId))return{success:false,error:'Solicitação de parada antiga; reprodução atual preservada.'};for(const [key,j] of jobs)if(payload.operation==='STOP_TAB'?j.payload.tabId===payload.tabId:j===job){j.controller.abort(Object.assign(new Error('Cancelado.'),{cancelled:true}));const closed=await j.player.stop();jobs.delete(key);if(!closed)return{success:false,error:'AudioContext não confirmou encerramento; saída foi silenciada.'};publicEvent(j.payload,'cancelled');}const result=await legacyCommand(payload);notifyIdle();return result;}
 if(job&&payload.requestId===job.payload.requestId&&payload.playerId===job.payload.playerId){if(payload.operation==='CLAIM_PLAYBACK'){playbackIntent(job.player,payload.playbackIntent);if(job.player.paused||job.player.authorized)await activatePlayback(job.player);else job.player.flush();}if(payload.operation==='PAUSE'){job.player.desired='pause';job.player.authorized=false;if(job.player.gain)job.player.gain.gain.value=0;await coordinate(()=>job.player.pause(true));}if(payload.operation==='RESUME'||payload.operation==='PLAY'){playbackIntent(job.player,payload.playbackIntent);await activatePlayback(job.player);}if(payload.operation==='SET')job.player.set(payload.volume,payload.playbackRate);if(payload.operation==='SEEK_PCM')await job.player.seek(payload.deltaSeconds);return{success:true,operation:payload.operation,status:job.player.status(),eventSeq:jobViews.get(job.payload.jobId)?.eventSeq};}
 if(payload.jobId||payload.operation==='SEEK_PCM')return{success:false,error:'Player PCM ou solicitação não está mais disponível. Reabra o painel.'};
 return legacyCommand(payload);
}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{if(message.target!=='offscreen'||!['LIVE_OFFSCREEN_COMMAND','TTS_OFFSCREEN_COMMAND'].includes(message.type))return false;if(message.payload?.operation==='TTS_LIVE_START')publicEvent(message.payload,'pcm-diagnostic',{stage:'offscreen-command-received',at:Date.now()});command(message.payload).then(respond,error=>respond({success:false,error:LiveConfig.redactSecrets(error.message||String(error),message.payload?.apiKeys||[])}));return true;});
})();
