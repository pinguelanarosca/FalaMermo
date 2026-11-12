(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SttRealtime=api;})(globalThis,function(){
'use strict';
const CONFIG=Object.freeze({sampleRate:16000,minChunkMs:600,maxChunkMs:12000,silenceMs:500,rmsThreshold:.004,preRollMs:500,overlapMs:200,maxQueuedChunks:8,maxQueuedBytes:960000,maxPendingPackets:320,settleMs:900});
const failure=(message,code='STT_PIPELINE')=>Object.assign(new Error(message),{code});
function pcmRms(bytes,forVad=false){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=bytes.byteLength/2||1;
 let sum=0,squares=0,min=Infinity,max=-Infinity,minCount=0,maxCount=0;
 for(let i=0;i<bytes.byteLength;i+=2){
  const sample=view.getInt16(i,true);squares+=sample*sample;
  if(!forVad)continue;
  sum+=sample;
  if(sample<min){min=sample;minCount=1;}else if(sample===min)minCount++;
  if(sample>max){max=sample;maxCount=1;}else if(sample===max)maxCount++;
 }
 // Uma amostra isolada num nível constante é um impulso digital, não uma vocalização.
 if(forVad&&count>=3&&Math.max(minCount,maxCount)>=count-1)return 0;
 const mean=forVad?sum/count:0;
 return Math.sqrt(Math.max(0,squares/count-mean*mean))/32768;
}
class CapturePipeline{
 constructor({jobId,realtime=false,continuous=false,adaptive=false,submitAudioChunk,onDiagnostic=()=>{},config={}}){this.jobId=jobId;this.realtime=realtime;this.continuous=continuous;this.adaptive=adaptive;this.submitAudioChunk=submitAudioChunk;this.onDiagnostic=onDiagnostic;this.config={...CONFIG,...config,...(continuous?{overlapMs:0}:{})};const c=this.config;if(!jobId||typeof submitAudioChunk!=='function'||![c.minChunkMs,c.maxChunkMs,c.silenceMs,c.preRollMs,c.overlapMs,c.rmsThreshold].every(Number.isFinite)||c.minChunkMs<0||c.maxChunkMs<c.minChunkMs||c.maxChunkMs<=0||c.silenceMs<=0||c.preRollMs<0||c.preRollMs>c.maxChunkMs||c.overlapMs<0||c.overlapMs>=c.minChunkMs||c.rmsThreshold<=0)throw failure('Configuração VAD inválida.');this.sequence=0;this.packetSequence=0;this.samples=0;this.noise=0;this.closed=false;this.chunk=null;this.tail=new Uint8Array();this.idle=new Uint8Array();this.skippedSilenceBytes=0;this.prefix=null;}
 diagnostic(stage,extra={}){this.onDiagnostic({stage,...extra});}
 emit(pcm,endOnly=false,cutReason){const c=this.chunk,meta={jobId:this.jobId,chunkId:c.chunkId,sequence:c.sequence,packetSequence:++this.packetSequence,startMs:c.startMs,endMs:this.samples/16,durationMs:this.samples/16-c.startMs,overlapMs:c.overlapMs,speechAfterOverlap:c.speechAfterOverlap,status:endOnly?'closed':'streaming',...(cutReason?{cutReason}:{})};this.submitAudioChunk({pcm,endOnly,chunk:meta});if(endOnly)this.diagnostic('chunk-created',meta);}
 push(bytes,decision){if(this.closed)return false;if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.byteLength%2)throw failure('PCM STT inválido.');if(!this.realtime){this.submitAudioChunk({pcm:bytes});return true;}
  const ms=bytes.byteLength/32,rms=pcmRms(bytes,true),threshold=Math.max(this.config.rmsThreshold,this.noise*3),rmsVoiced=rms>=(this.chunk?.speech?threshold*.7:threshold);if(!rmsVoiced)this.noise=this.noise*.98+rms*.02;
  const voiced=decision??rmsVoiced;
  // O overlap já foi enviado no bloco anterior. Sozinho ele não é fala nova:
  // aguarde a próxima voz em vez de criar um turno vazio que expiraria no transporte.
  if(!this.chunk&&!voiced){const joined=new Uint8Array(this.idle.length+bytes.length);joined.set(this.idle);joined.set(bytes,this.idle.length);const keep=Math.min(joined.length,Math.round(this.config.preRollMs*32));this.skippedSilenceBytes+=joined.length-keep;this.idle=joined.slice(joined.length-keep);this.gapMs=(this.gapMs||0)+ms;if(this.gapMs>=this.config.silenceMs){this.prefix=null;if(this.pendingActivityEnd){this.pendingActivityEnd=false;this.submitAudioChunk({pcm:new Uint8Array(),activityEndOnly:true,packetSequence:++this.packetSequence});}}this.samples+=bytes.length/2;return true;}
  if(!this.chunk){this.pendingActivityEnd=false;const overlapMs=(this.prefix?.length||0)/32,prefix=new Uint8Array((this.prefix?.length||0)+this.idle.length);if(this.prefix)prefix.set(this.prefix);prefix.set(this.idle,this.prefix?.length||0);this.prefix=null;this.idle=new Uint8Array();this.gapMs=0;this.chunk={chunkId:this.jobId+':'+(++this.sequence),sequence:this.sequence,startMs:(this.samples-prefix.length/2)/16,overlapMs,speech:overlapMs>0,speechAfterOverlap:false,silenceMs:0};if(prefix.length)this.emit(prefix);}
  const c=this.chunk;if(voiced){c.speech=true;c.speechAfterOverlap=true;c.silenceMs=0;}else c.silenceMs+=ms;
  this.samples+=bytes.byteLength/2;this.emit(bytes);
  const retained=Math.round(this.config.overlapMs*32);if(retained){const joined=new Uint8Array(this.tail.length+bytes.length);joined.set(this.tail);joined.set(bytes,this.tail.length);this.tail=joined.slice(-retained);}
  const duration=this.samples/16-c.startMs;
  const target=this.sequence===1?3500:5200;
  const adaptiveCut=this.adaptive&&duration>=target&&(c.silenceMs>=160||duration>=target+1800);
  if(c.speech&&duration>=this.config.minChunkMs&&c.silenceMs>=this.config.silenceMs)this.closeChunk('silence');
  else if(duration>=this.config.maxChunkMs||adaptiveCut)this.closeChunk('maximum');
  return true;
 }
 closeChunk(reason){if(!this.chunk)return;this.emit(new Uint8Array(),true,reason);this.pendingActivityEnd=reason==='maximum'&&this.continuous;this.prefix=reason==='maximum'&&this.tail.length?this.tail.slice():null;this.tail=new Uint8Array();this.chunk=null;}
 finish(){if(this.closed)return;this.closeChunk('finalization');this.skippedSilenceBytes+=this.idle.length;if(this.skippedSilenceBytes)this.diagnostic('vad-silence',{skippedSilenceMs:this.skippedSilenceBytes/32});this.closed=true;this.idle=new Uint8Array();this.prefix=null;}
 cancel(){this.closed=true;this.chunk=null;this.tail=new Uint8Array();this.idle=new Uint8Array();this.prefix=null;}
}
function tokens(text){return[...text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].map(match=>({word:match[0].normalize('NFC').toLocaleLowerCase('pt-BR'),start:match.index,end:match.index+match[0].length}));}
function mergeTranscriptionChunks(chunks){const sorted=[...chunks].sort((a,b)=>a.sequence-b.sequence);let result='',expected=1;for(const chunk of sorted){if(chunk.sequence!==expected)break;expected++;let value=typeof chunk.text==='string'?chunk.text.trim():'';if(result&&value&&chunk.overlapMs>0){const left=tokens(result),right=tokens(value),limit=Math.min(left.length,right.length,Math.max(1,Math.ceil(chunk.overlapMs/200)));let duplicate=0;for(let n=1;n<=limit;n++)if(left.slice(-n).every((token,i)=>token.word===right[i].word))duplicate=n;if(duplicate&&(duplicate<right.length||chunk.speechAfterOverlap===false))value=value.slice(right[duplicate-1].end).replace(/^[\s,;:.!?]+/u,'');}if(value)result+=(result?' ':'')+value;}return result;}
class TranscriptionMerger{
 constructor(){this.chunks=new Map();this.closed=false;}
 set(chunk){if(this.closed)return false;if(!Number.isInteger(chunk.sequence)||chunk.sequence<1)throw failure('Sequência de transcrição inválida.');const previous=this.chunks.get(chunk.sequence);if(previous?.status==='final')return false;this.chunks.set(chunk.sequence,{...chunk});return true;}
 snapshot(){const all=[...this.chunks.values()],confirmedText=mergeTranscriptionChunks(all.filter(c=>c.status==='final')),text=mergeTranscriptionChunks(all);return{text,confirmedText,partialText:text.startsWith(confirmedText)?text.slice(confirmedText.length).trimStart():text};}
 cancel(){this.closed=true;this.chunks.clear();}
}
// Um transporte sequencial na mesma sessão Live. Nenhuma chave/modelo pertence a esta interface.
class LiveChunkTransport{
 constructor({jobId,sendAudio,endAudio,onPartial=()=>{},onChunk=()=>{},onFailure=()=>{},onDiagnostic=()=>{},requiresIdle=false,timeoutMs=15000,config={},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{jobId,sendAudio,endAudio,onPartial,onChunk,onFailure,onDiagnostic,requiresIdle,timeoutMs,now});
  // Timers WebIDL exigem Window: this.setTimer() não pode receber o transporte como receptor.
  this.setTimer=setTimer.bind(globalThis);this.clearTimer=clearTimer.bind(globalThis);this.config={...CONFIG,...config};this.chunks=new Map();this.merger=new TranscriptionMerger();this.pendingBytes=0;this.packetSequence=0;this.next=1;this.cancelled=false;this.stopping=false;this.active=null;this.latencies=[];}
 diagnostic(stage,chunk=this.active,extra={}){this.onDiagnostic({stage,sequence:chunk?.sequence,chunkId:chunk?.chunkId,overlapMs:chunk?.overlapMs,startMs:chunk?.startMs,endMs:chunk?.endMs,durationMs:chunk?chunk.endMs-chunk.startMs:undefined,pendingChunks:this.chunks.size,pendingBytes:this.pendingBytes,...extra});}
 submitAudioChunk({pcm,chunk,endOnly=false}){if(this.cancelled||this.stopping)throw failure('Tarefa STT encerrada.','CANCELLED');try{
  if(!chunk||chunk.jobId!==this.jobId||chunk.chunkId!==this.jobId+':'+chunk.sequence||!Number.isSafeInteger(chunk.sequence)||chunk.sequence<this.next||!Number.isSafeInteger(chunk.packetSequence)||chunk.packetSequence!==this.packetSequence+1||chunk.status!==(endOnly?'closed':'streaming')||![chunk.startMs,chunk.endMs,chunk.overlapMs].every(v=>Number.isFinite(v)&&v>=0)||chunk.endMs<chunk.startMs||!(pcm instanceof Uint8Array)||(!endOnly&&!pcm.length)||pcm.length%2||endOnly&&pcm.length)throw failure('Identidade/ordem do chunk STT inválida.');
  let item=this.chunks.get(chunk.sequence);if(!item){if(chunk.sequence!==(this.lastCreatedSequence||0)+1)throw failure('Chunk STT fora da sequência de captura.');if(this.chunks.size>=this.config.maxQueuedChunks)throw failure('Fila STT cheia; ditado interrompido sem descartar áudio silenciosamente.','BACKPRESSURE');item={...chunk,queuedAt:this.now(),frames:[],text:'',interim:'',status:'streaming',closed:false};this.chunks.set(item.sequence,item);this.lastCreatedSequence=item.sequence;}
  if(item.closed||item.startMs!==chunk.startMs||item.overlapMs!==chunk.overlapMs||chunk.endMs<item.endMs)throw failure('Chunk STT já encerrado ou fronteira inválida.');
  if(this.pendingBytes+pcm.length>this.config.maxQueuedBytes)throw failure('Fila STT excedeu 30 segundos de PCM pendente; ditado interrompido.','BACKPRESSURE');
  this.packetSequence=chunk.packetSequence;item.endMs=chunk.endMs;if(chunk.speechAfterOverlap===true)item.speechAfterOverlap=true;if(pcm.length){item.frames.push(pcm);this.pendingBytes+=pcm.length;}if(endOnly){if(!['silence','maximum','finalization'].includes(chunk.cutReason))throw failure('Motivo de corte inválido.');item.closed=true;item.cutReason=chunk.cutReason;this.diagnostic('chunk-queued',item,{cutReason:item.cutReason});}this.flush();return true;
 }catch(error){this.fail(error);throw error;}}
 flush(){if(this.cancelled)return;try{if(!this.active){this.active=this.chunks.get(this.next)||null;if(!this.active){this.maybeFinish();return;}this.active.sentAt=this.now();this.diagnostic('chunk-send',this.active,{queueWaitMs:this.active.sentAt-this.active.queuedAt});}
  const c=this.active;while(c.frames.length){const pcm=c.frames.shift();this.sendAudio(pcm);this.pendingBytes-=pcm.length;}
  if(c.closed&&!c.awaiting){c.awaiting=true;c.closedAt=this.now();this.deadline=this.setTimer(()=>this.fail(failure('Timeout aguardando transcrição do chunk STT.','CHUNK_TIMEOUT')),this.timeoutMs);this.endAudio();this.tryComplete();}
 }catch(error){this.fail(error);throw error;}}
 receive(sc){if(this.cancelled||!this.active||!sc.inputTranscription&&!sc.interimInputTranscription&&!sc.turnComplete&&!sc.interactionStatus)return;const c=this.active;if(sc.inputTranscription?.text||sc.interimInputTranscription?.text){this.clearTimer(this.settle);this.settle=null;c.firstResponseAt??=this.now();}if(sc.interactionStatus){this.interactionStatus=sc.interactionStatus;c.idle=sc.interactionStatus==='IDLE';}if(sc.interimInputTranscription?.text)c.interim=sc.interimInputTranscription.text;if(sc.inputTranscription?.text){c.text+=sc.inputTranscription.text;c.interim='';this.diagnostic('chunk-response',c,{characters:c.text.length,latencyMs:this.now()-(c.closedAt??c.sentAt),inputFinished:sc.inputTranscription.finished===true});}if(sc.inputTranscription?.finished)c.inputFinished=true;if(sc.turnComplete)c.turnComplete=true;
  this.merger.set({...c,text:[c.text,c.interim].filter(Boolean).join(' '),status:'partial'});this.onPartial({...this.merger.snapshot(),sequence:c.sequence});this.tryComplete();
 }
 tryComplete(){const c=this.active;if(!c?.awaiting||!c.text.trim())return;if(this.requiresIdle&&this.interactionStatus!=='IDLE'){this.clearTimer(this.settle);this.settle=null;return;}if(c.inputFinished)this.complete();else if(!this.settle)this.settle=this.setTimer(()=>{this.settle=null;this.complete();},this.config.settleMs);}
 complete(){const c=this.active;if(this.cancelled||!c||this.requiresIdle&&this.interactionStatus!=='IDLE')return;this.clearTimer(this.deadline);this.clearTimer(this.settle);this.settle=null;this.merger.set({...c,text:c.text,status:'final'});const latencyMs=this.now()-(c.closedAt??c.sentAt);this.latencies.push(latencyMs);if(this.latencies.length>100)this.latencies.shift();const snapshot=this.merger.snapshot();this.diagnostic('chunk-merge',c,{characters:snapshot.text.length,latencyMs,confirmationWaitMs:c.firstResponseAt===undefined?0:this.now()-c.firstResponseAt,inputFinished:c.inputFinished===true,turnComplete:c.turnComplete===true,meanChunkLatencyMs:this.latencies.reduce((a,b)=>a+b,0)/this.latencies.length,cutReason:c.cutReason});this.onChunk({...snapshot,sequence:c.sequence,latencyMs});this.chunks.delete(c.sequence);this.next++;this.active=null;try{this.flush();}catch{/* fail() já informou e encerrou a tarefa. */}}
 finish(){if(this.finishPromise)return this.finishPromise;this.stopping=true;this.finishPromise=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});this.finishPromise.catch(()=>{});if(this.cancelled)this.reject(failure('Ditado cancelado.','CANCELLED'));else{const last=[...this.chunks.values()].at(-1);if(last&&!last.closed){last.closed=true;last.cutReason='finalization';}try{this.flush();}catch{/* Falha propagada pela promessa e pelo callback. */}}return this.finishPromise;}
 maybeFinish(){if(this.stopping&&!this.chunks.size&&!this.cancelled)this.resolve?.({...this.merger.snapshot(),meanChunkLatencyMs:this.latencies.length?this.latencies.reduce((a,b)=>a+b,0)/this.latencies.length:null});}
 fail(error){if(this.cancelled)return;this.diagnostic('chunk-error',this.active,{outcome:error.code==='BACKPRESSURE'?'BACKPRESSURE':error.code==='CHUNK_TIMEOUT'?'CHUNK_TIMEOUT':'CONNECTION',stopReason:error.code==='BACKPRESSURE'?'backpressure':error.code==='CHUNK_TIMEOUT'?'chunk-timeout':'transport-error'});this.cancel(error);this.onFailure(error);}
 cancel(error=failure('Ditado cancelado.','CANCELLED')){if(this.cancelled)return;this.cancelled=true;this.clearTimer(this.deadline);this.clearTimer(this.settle);this.chunks.clear();this.pendingBytes=0;this.active=null;this.merger.cancel();this.reject?.(error);}
}
// O áudio de recuperação pertence ao ditado, nunca à telemetria ou às credenciais.
// Sem TTL/evicção: material inconclusivo só é removido por ação explícita do usuário.
class RecoveryStore{
 constructor({indexedDB,maxJobBytes=64*1024*1024,maxTotalBytes=256*1024*1024,name='stt-audio-recovery-v1'}={}){Object.assign(this,{indexedDB,maxJobBytes,maxTotalBytes,name});}
 open(){if(this.opening)return this.opening;let provider;try{provider=this.indexedDB||globalThis.indexedDB;}catch{return Promise.reject(failure('IndexedDB STT bloqueado neste contexto.','RECOVERY_STORAGE'));}if(!provider)return Promise.reject(failure('IndexedDB indisponível; não é seguro iniciar STT sem recuperação local.','RECOVERY_STORAGE'));return this.opening=new Promise((resolve,reject)=>{const r=provider.open(this.name,1);r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('jobs',{keyPath:'jobId'});db.createObjectStore('audio',{keyPath:['jobId','packetSequence']}).createIndex('jobId','jobId');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(failure('Não foi possível abrir a recuperação STT local.','RECOVERY_STORAGE'));r.onblocked=()=>reject(failure('Recuperação STT bloqueada por outra página.','RECOVERY_STORAGE'));});}
 async transaction(stores,work){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');let value,reason;tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(reason||failure('Falha ao preservar áudio STT local.','RECOVERY_STORAGE'));const fail=e=>{reason=e;tx.abort();};try{work(tx,v=>value=v,fail);}catch(e){fail(e);}});}
 start(jobId){return this.transaction(['jobs'],(tx,done,fail)=>{const store=tx.objectStore('jobs'),r=store.getAll();r.onsuccess=()=>{if(r.result.some(j=>j.jobId===jobId))return fail(failure('Recuperação STT já existe para este job; nenhum replay foi iniciado.','REQUEST'));if(r.result.length>=129)return fail(failure('Limite de ditados retidos atingido. Exporte/remova recuperações antigas em Opções.','RECOVERY_LIMIT'));const job={jobId,createdAt:Date.now(),state:'recording',bytes:0,packets:0,blocks:0,unresolved:0};store.add(job);done(job);};});}
 append(jobId,packet){return this.transaction(['jobs','audio'],(tx,done,fail)=>{const jobs=tx.objectStore('jobs'),r=jobs.get(jobId);r.onsuccess=()=>{const job=r.result;if(!job||job.state!=='recording')return fail(failure('Recuperação STT não está disponível para gravação.','RECOVERY_STORAGE'));const b=jobs.get('__budget');b.onsuccess=()=>{const budget=b.result||{jobId:'__budget',bytes:0},size=packet.pcm.byteLength;if(job.bytes+size>this.maxJobBytes||budget.bytes+size>this.maxTotalBytes)return fail(failure('Limite do áudio de recuperação STT atingido. O material anterior foi preservado; exporte/remova recuperações em Opções.','RECOVERY_LIMIT'));tx.objectStore('audio').add({jobId,packetSequence:packet.chunk.packetSequence,sequence:packet.chunk.sequence,startMs:packet.chunk.startMs,endMs:packet.chunk.endMs,overlapMs:packet.chunk.overlapMs,pcm:packet.pcm.slice().buffer});job.bytes+=size;job.packets++;budget.bytes+=size;jobs.put(job);jobs.put(budget);done(job);};};});}
 update(jobId,patch){return this.transaction(['jobs'],(tx,done)=>{const store=tx.objectStore('jobs'),r=store.get(jobId);r.onsuccess=()=>{if(!r.result)return;const job=r.result;for(const key of ['state','blocks','unresolved','transcribed','noSpeech','ambiguous','unresolvedSequences'])if(patch[key]!==undefined)job[key]=patch[key];store.put(job);done(job);};});}
 async list(){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('jobs'),r=tx.objectStore('jobs').getAll();r.onsuccess=()=>resolve(r.result.filter(j=>j.jobId!=='__budget'));r.onerror=()=>reject(failure('Falha ao ler recuperações STT.','RECOVERY_STORAGE'));});}
 async packets(jobId,sequence){const db=await this.open();return new Promise((resolve,reject)=>{const r=db.transaction('audio').objectStore('audio').index('jobId').getAll(jobId);r.onsuccess=()=>resolve(r.result.filter(p=>sequence===undefined||p.sequence===sequence).sort((a,b)=>a.packetSequence-b.packetSequence));r.onerror=()=>reject(failure('Falha ao ler PCM STT retido.','RECOVERY_STORAGE'));});}
 async wave(jobId,sequence){const packets=await this.packets(jobId,sequence),size=packets.reduce((sum,p)=>sum+p.pcm.byteLength,0);if(!size)throw failure('Nenhum PCM retido para este ditado/bloco.','REQUEST');const header=new ArrayBuffer(44),v=new DataView(header),ascii=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};ascii(0,'RIFF');v.setUint32(4,36+size,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,size,true);return{blob:new Blob([header,...packets.map(p=>p.pcm)],{type:'audio/wav'}),bytes:size,packets:packets.length,silencesCompacted:true};}
 async download(jobId,sequence){const{blob,...metadata}=await this.wave(jobId,sequence),url=URL.createObjectURL(blob);try{const a=document.createElement('a');a.href=url;a.download='stt-'+jobId+(sequence===undefined?'':'-bloco-'+sequence)+'.wav';a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}return metadata;}
 remove(jobId,{force=false}={}){return this.transaction(['jobs','audio'],(tx,done,fail)=>{const jobs=tx.objectStore('jobs'),r=jobs.get(jobId);r.onsuccess=()=>{const job=r.result;if(!job)return;if(job.state==='recording'&&!force)return fail(failure('Pare o ditado antes de remover seu áudio de recuperação.','REQUEST'));const b=jobs.get('__budget');b.onsuccess=()=>{const budget=b.result||{jobId:'__budget',bytes:0};budget.bytes=Math.max(0,budget.bytes-job.bytes);jobs.put(budget);jobs.delete(jobId);const cursor=tx.objectStore('audio').index('jobId').openCursor(jobId);cursor.onsuccess=()=>{const row=cursor.result;if(row){row.delete();row.continue();}};done({removed:true,bytes:job.bytes});};};});}
}
// Entrada é um fluxo da sessão. Não há ID obrigatório de bloco na transcrição Gemini.
// Nunca se aguarda texto para encaminhar áudio, nem se atribui resposta tardia ao próximo bloco.
class DictationTransport{
 constructor({jobId,sendAudio,endAudio,retain=async()=>{},onPartial=()=>{},onChunk=()=>{},onWarning=()=>{},onFailure=()=>{},onDiagnostic=()=>{},requiresIdle=false,timeoutMs=15000,config={},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{jobId,sendAudio,endAudio,retain,onPartial,onChunk,onWarning,onFailure,onDiagnostic,requiresIdle,timeoutMs,now});this.config={...CONFIG,...config};this.setTimer=setTimer.bind(globalThis);this.clearTimer=clearTimer.bind(globalThis);this.blocks=new Map();this.timeline=[];this.offsetKeys=new Set();this.unfinishedActivities=new Set();this.pendingBytes=0;this.pendingPackets=0;this.packetSequence=0;this.next=1;this.work=Promise.resolve();this.cancelled=false;this.stopping=false;this.revision=0;this.ambiguous=false;}
 diagnostic(stage,c,extra={}){this.onDiagnostic({stage,sequence:c?.sequence,chunkId:c?.chunkId,startMs:c?.startMs,endMs:c?.endMs,durationMs:c?c.endMs-c.startMs:undefined,overlapMs:c?.overlapMs,pendingBytes:this.pendingBytes,pendingChunks:this.pendingPackets,...extra});}
 snapshot(){
  // Offsets podem reiniciar entre atividades. Só ordena dentro de um trecho correlacionável.
  const spans=[];for(const p of this.timeline){const last=spans.at(-1);if(p.scope&&last?.[0].scope===p.scope)last.push(p);else spans.push([p]);}
  const ordered=spans.flatMap(span=>span[0].scope?[...span].sort((a,b)=>a.start-b.start||a.order-b.order):span),text=ordered.reduce((s,p,i)=>s+((ordered[i-1]?.finished||/[.!?…]$/.test(s))&&s&&!/\s$/.test(s)&&!/^\s|^[,;:.!?]/.test(p.text)?' ':'')+p.text,'').trim(),unresolved=[...this.blocks.values()].filter(c=>c.state==='unresolved').length;
  return{text,confirmedText:text,partialText:this.interim||'',incomplete:unresolved>0||this.ambiguous||!!this.interim,unresolved,ambiguous:this.ambiguous};
 }
 resumeEpoch(){this.connectionEpoch=(this.connectionEpoch||0)+1;this.unfinishedActivities.clear();this.lastFinishedActivity=null;}
 get idle(){return!this.openBlock&&!this.pendingPackets;}
 get stats(){const all=[...this.blocks.values()];return{blocks:all.length,unresolved:all.filter(c=>c.state==='unresolved').length,transcribed:all.filter(c=>c.state==='transcribed').length,noSpeech:all.filter(c=>c.state==='no-speech').length,ambiguous:this.ambiguous};}
 submitAudioChunk(packet){
  if(this.cancelled||this.stopping)return Promise.reject(failure('Tarefa STT encerrada.','CANCELLED'));
  try{
   if(packet.activityEndOnly){if(packet.packetSequence!==this.packetSequence+1||packet.pcm.length)throw failure('Fim de atividade STT fora de ordem.');this.packetSequence=packet.packetSequence;const work=this.work.then(async()=>{if(this.cancelled)return;const activity=this.openBlock?.activity;if(activity!==undefined){await this.endAudio();this.openBlock=null;this.closeActivity(activity);}});this.work=work.catch(error=>this.fail(error));return work;}
   const{pcm,chunk:c,endOnly=false}=packet;
   if(!c||c.jobId!==this.jobId||c.chunkId!==this.jobId+':'+c.sequence||!Number.isSafeInteger(c.sequence)||c.sequence<1||c.packetSequence!==this.packetSequence+1||c.status!==(endOnly?'closed':'streaming')||![c.startMs,c.endMs,c.overlapMs].every(n=>Number.isFinite(n)&&n>=0)||c.endMs<c.startMs||!(pcm instanceof Uint8Array)||pcm.byteLength%2||(!endOnly&&!pcm.length)||(endOnly&&pcm.length))throw failure('Identidade/ordem do bloco STT inválida.');
   let block=this.blocks.get(c.sequence);
   if(!block){if(c.sequence!==this.next||this.blocks.size>=10000)throw failure('Sequência/limite de blocos STT inválido.','BACKPRESSURE');this.next++;block={...c,state:'pending',hasText:false};this.blocks.set(c.sequence,block);}
   if(block.closed||block.startMs!==c.startMs||block.overlapMs!==c.overlapMs||c.endMs<block.endMs)throw failure('Fronteira STT inválida.');
   if(this.pendingBytes+pcm.length>this.config.maxQueuedBytes||this.pendingPackets>=this.config.maxPendingPackets)throw failure('Fila de envio STT congestionada; áudio anterior retido para recuperação.','BACKPRESSURE');
   if(endOnly&&!['silence','maximum','finalization'].includes(c.cutReason))throw failure('Motivo de corte STT inválido.');
   Object.assign(block,{endMs:c.endMs,...(endOnly?{closed:true,cutReason:c.cutReason}:{})});this.packetSequence=c.packetSequence;this.pendingBytes+=pcm.length;this.pendingPackets++;
   const work=this.work.then(async()=>{
    if(this.cancelled)return;
    if(pcm.length){await this.retain(packet);if(this.cancelled)return;block.hasSignal=block.hasSignal||pcm.some(byte=>byte!==0);block.sentAt??=this.now();if(!this.openBlock)this.activitySequence=(this.activitySequence||0)+1;block.activity=this.activitySequence;this.unfinishedActivities.add(block.activity);this.openBlock=block;const epoch=this.connectionEpoch||0;await this.sendAudio(pcm);if(epoch!==(this.connectionEpoch||0))this.unfinishedActivities.add(block.activity);}
    else{
     block.closedAt=this.now();
     // Máximo é apenas fronteira local. Fala contínua não reinicia a atividade remota.
     if(block.cutReason!=='maximum'){this.openBlock=null;await this.endAudio();if(!this.cancelled)this.closeActivity(block.activity);}
     if(this.cancelled)return;this.diagnostic('chunk-queued',block,{cutReason:block.cutReason});
    }
   }).finally(()=>{this.pendingBytes-=pcm.length;this.pendingPackets--;});
   this.work=work.catch(error=>this.fail(error));return work;
  }catch(error){this.fail(error);return Promise.reject(error);}
 }
 closeActivity(activity){for(const c of this.blocks.values())if(c.activity===activity&&c.state==='pending'){c.closedAt=this.now();if(!c.hasSignal){c.state='no-speech';this.diagnostic('chunk-no-speech',c,{outcome:'NO_SPEECH'});}else{c.deadline=this.setTimer(()=>this.unresolved(c),this.timeoutMs);if(c.hasText)this.settleBlock(c);}}}
 settleBlock(c){if(!c.closedAt&&c.closedAt!==0)return;this.clearTimer(c.settle);c.settle=this.setTimer(()=>{if(this.cancelled||c.state!=='pending')return;c.state='transcribed';this.clearTimer(c.deadline);this.diagnostic('chunk-merge',c,{latencyMs:this.now()-c.closedAt});this.onChunk({...this.snapshot(),sequence:c.sequence,latencyMs:this.now()-c.closedAt});this.maybeFinish();},this.config.settleMs);}
 unresolved(c){if(this.cancelled||c.state!=='pending')return;c.state='unresolved';this.clearTimer(c.settle);this.diagnostic('chunk-unresolved',c,{outcome:'NO_TRANSCRIPTION'});this.onWarning({code:'NO_TRANSCRIPTION',sequence:c.sequence,...this.snapshot()});this.maybeFinish();}
 receive(sc){
  if(this.cancelled||this.finished)return;
  if(sc.interactionStatus)this.interactionStatus=sc.interactionStatus;
  const input=sc.inputTranscription;
  if(sc.interimInputTranscription?.text){this.interim=sc.interimInputTranscription.text;this.onPartial(this.snapshot());}
  if(input&&typeof input.text==='string'){
   const candidates=[...this.blocks.values()].filter(c=>c.sentAt!==undefined&&(c.state==='pending'||c.state==='unresolved')),activities=new Set(candidates.map(c=>c.activity)),group=activities.size===1?candidates:[],c=group[0];
   if(input.text){
    const offset=value=>typeof value==='string'&&/^\d+(?:\.\d+)?s$/.test(value)?parseFloat(value)*1000:null,start=offset(input.startOffset),end=offset(input.endOffset),epoch=this.connectionEpoch||0,activity=this.unfinishedActivities.size===1?[...this.unfinishedActivities][0]:this.unfinishedActivities.size===0?this.lastFinishedActivity:null,scope=activity!=null&&start!==null&&end!==null?epoch+':'+activity:null,key=scope?JSON.stringify([scope,start,end,input.text]):null;
    if(key&&this.offsetKeys.has(key))return;
    if(this.timeline.reduce((n,p)=>n+p.text.length,0)+input.text.length>1000000){this.fail(failure('Limite de texto STT atingido; texto confirmado e áudio local preservados.','BACKPRESSURE'));return;}
    if(key)this.offsetKeys.add(key);this.timeline.push({text:input.text,start,end,epoch,scope,order:++this.revision,finished:input.finished===true});this.interim='';
    if(group.length&&group.every(c=>c.state==='pending')){for(const c of group){c.hasText=true;if(input.finished===true&&c.closed){c.state='transcribed';this.clearTimer(c.deadline);this.clearTimer(c.settle);}else this.settleBlock(c);}}else this.ambiguous=true;
    this.diagnostic('input-transcription',c,{characters:input.text.length,ambiguous:this.ambiguous});this.onPartial(this.snapshot());this.onChunk({...this.snapshot(),resultSequence:this.revision});
   }else if(input.finished===true&&c&&!c.hasText&&c.state==='pending'&&c.closed){
    // Mesmo confirmação vazia não demonstra ausência de fala em PCM com sinal.
    this.unresolved(c);
   }
  }
  if(input?.finished===true&&this.unfinishedActivities.size===1){this.lastFinishedActivity=[...this.unfinishedActivities][0];this.unfinishedActivities.clear();}
  // turnComplete/generationComplete/voiceActivity não comprovam transcrição nem silêncio.
  if(this.stopping&&(input?.text||sc.interimInputTranscription?.text)){this.clearTimer(this.finalSettle);this.finalSettle=this.setTimer(()=>{this.finalSettle=null;this.maybeFinish();},this.config.settleMs);}
  this.maybeFinish();
 }
 finish(){if(this.finishPromise)return this.finishPromise;this.stopping=true;this.finishPromise=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});this.finishPromise.catch(()=>{});if(this.cancelled){this.reject(failure('Ditado cancelado.','CANCELLED'));return this.finishPromise;}void this.work.then(async()=>{if(this.cancelled)return;if(this.openBlock){const activity=this.openBlock.activity;await this.endAudio();this.openBlock=null;this.closeActivity(activity);}if(this.cancelled)return;this.sendFinished=true;this.stopDeadline=this.setTimer(()=>{for(const c of this.blocks.values())if(c.state==='pending')this.unresolved(c);this.finishResult();},this.requiresIdle?90000:this.timeoutMs);this.finalSettle=this.setTimer(()=>{this.finalSettle=null;this.maybeFinish();},this.config.settleMs);this.maybeFinish();}).catch(error=>this.fail(error));return this.finishPromise;}
 maybeFinish(){if(!this.stopping||!this.sendFinished||this.cancelled||this.finalSettle&&!this.timeline.at(-1)?.finished||this.requiresIdle&&this.interactionStatus!=='IDLE'||[...this.blocks.values()].some(c=>c.state==='pending'))return;if(this.blocks.size&&!this.timeline.at(-1)?.finished)return;this.finishResult();}
 finishResult(){if(this.cancelled||this.finished)return;this.finished=true;for(const c of this.blocks.values()){this.clearTimer(c.deadline);this.clearTimer(c.settle);}this.clearTimer(this.stopDeadline);this.clearTimer(this.finalSettle);this.resolve?.({...this.snapshot(),...this.stats});}
 fail(error){if(this.cancelled)return;this.diagnostic('error',this.openBlock,{outcome:'CONNECTION'});this.cancel(error);this.onFailure(error);}
 cancel(error=failure('Ditado cancelado.','CANCELLED')){if(this.cancelled)return;this.cancelled=true;for(const c of this.blocks.values()){this.clearTimer(c.deadline);this.clearTimer(c.settle);}this.clearTimer(this.stopDeadline);this.clearTimer(this.finalSettle);this.reject?.(error);}
}
// One Live session carries one local block. Its responses need no remote block ID.
class DistributedDictation {
 constructor({jobId,retain,openLane,budget={take:()=>true,release:()=>{}},copies=2,
   onPartial=()=>{},onChunk=()=>{},onWarning=()=>{},onFailure=()=>{},config={},
   setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now}){
  Object.assign(this,{jobId,retain,openLane,budget,copies,onPartial,onChunk,onWarning,onFailure,now});
  this.setTimer=setTimer.bind(globalThis);
  this.clearTimer=clearTimer.bind(globalThis);
  this.config={...CONFIG,...config};
  this.work=Promise.resolve();
  this.blocks=new Map();
  this.counts={blocks:0,unresolved:0,transcribed:0,noSpeech:0};
  this.gaps=[];
  this.packetSequence=0;
  this.nextPublish=1;
  this.textBoundaries=[];
  this.queuedPackets=0;
  this.queuedBytes=0;
  this.bufferedBytes=0;
  this.pendingBlocks=0;
  this.text='';
  this.tail=new Uint8Array();
 }
 get stats(){return {...this.counts,unresolvedSequences:[...this.gaps].sort((a,b)=>a-b)};}
 snapshot(partialText=''){
  return {text:this.text,confirmedText:this.text,partialText,textBoundaries:this.textBoundaries.map(boundary=>[...boundary]),incomplete:this.counts.unresolved>0,...this.stats};
 }
 submitAudioChunk(packet){
  if(this.stopping||this.cancelled)return Promise.reject(failure('Tarefa STT encerrada.','CANCELLED'));
  const bytes=packet.pcm?.byteLength||0;
  if(this.queuedPackets>=this.config.maxPendingPackets||this.queuedBytes+bytes>this.config.maxQueuedBytes){
   const error=failure('Fila de persistência STT excedida; áudio anterior preservado.','BACKPRESSURE');
   this.fail(error);
   return Promise.reject(error);
  }
  this.queuedPackets++;
  this.queuedBytes+=bytes;
  const work=this.work.then(()=>this.accept(packet)).finally(()=>{
   this.queuedPackets--;
   this.queuedBytes-=bytes;
  });
  this.work=work.catch(error=>this.fail(error));
  return work;
 }
 async accept(packet){
  if(this.cancelled)return;
  const {pcm,chunk,endOnly=false,activityEndOnly=false}=packet;
  if(!(pcm instanceof Uint8Array)||pcm.byteLength%2||(chunk?.packetSequence??packet.packetSequence)!==this.packetSequence+1){
   throw failure('PCM ou ordem de pacote STT inválida.');
  }
  this.packetSequence++;
  if(activityEndOnly){
   if(pcm.length||chunk||this.current)throw failure('Fim de atividade STT inválido.');
   this.tail=new Uint8Array();
   return;
  }
  if(!chunk||chunk.jobId!==this.jobId||chunk.chunkId!==this.jobId+':'+chunk.sequence||
     !Number.isSafeInteger(chunk.sequence)||chunk.status!==(endOnly?'closed':'streaming')||
     ![chunk.startMs,chunk.endMs,chunk.overlapMs].every(n=>Number.isFinite(n)&&n>=0)||
     chunk.endMs<chunk.startMs||(endOnly?pcm.length||!['silence','maximum','finalization'].includes(chunk.cutReason):!pcm.length)){
   throw failure('Identidade ou fronteira do bloco STT inválida.');
  }
  const previous=this.current;
  if(previous?(chunk.sequence!==previous.sequence||chunk.startMs!==previous.startMs||
     chunk.overlapMs!==previous.sourceOverlapMs||chunk.endMs<previous.endMs):
     (endOnly||chunk.sequence!==this.counts.blocks+1||this.counts.blocks>=10000)){
   throw failure('Sequência de blocos STT inválida.');
  }
  if(endOnly){
   this.close(previous,chunk.cutReason);
   return;
  }
  await this.retain(packet);
  if(this.cancelled)return;
  const block=previous||this.createBlock(chunk);
  block.endMs=chunk.endMs;
  // O primeiro pacote pode ser só pre-roll; a fala nova chega nos seguintes.
  if(chunk.speechAfterOverlap===true)block.speechAfterOverlap=true;
  const keep=Math.round(this.config.overlapMs*32);
  if(keep){
   const suffix=pcm.subarray(Math.max(0,pcm.length-keep));
   const prefix=this.tail.subarray(Math.max(0,this.tail.length-(keep-suffix.length)));
   this.tail=new Uint8Array(prefix.length+suffix.length);
   this.tail.set(prefix);
   this.tail.set(suffix,prefix.length);
  }
  this.enqueue(block,pcm,chunk.speechAfterOverlap!==false);
 }
 createBlock(chunk){
  const context=chunk.startMs===this.previousEnd&&chunk.overlapMs===0?this.tail:new Uint8Array();
  this.tail=new Uint8Array();
  const block={sequence:chunk.sequence,startMs:chunk.startMs,endMs:chunk.endMs,
   sourceOverlapMs:chunk.overlapMs,overlapMs:chunk.overlapMs+context.length/32,speechAfterOverlap:chunk.speechAfterOverlap,
   lanes:[],packets:[],offset:0,admitted:0};
  this.blocks.set(block.sequence,block);
  this.current=block;
  this.counts.blocks++;
  if(this.pendingBlocks>=this.config.maxQueuedChunks)return block;
  block.processing=true;
  this.pendingBlocks++;
  const accounts=new Set();
  for(let copy=1;copy<=this.copies;copy++){
   const lane={copy,cursor:0,text:'',interim:'',controller:new AbortController()};
   block.lanes.push(lane);
   void this.connect(block,lane,accounts);
  }
  if(context.length)this.enqueue(block,context);
  return block;
 }
 async connect(block,lane,accounts){
  try{
   const session=await this.openLane({
    sequence:block.sequence,copy:lane.copy,accounts,signal:lane.controller.signal,
    receive:(content,afterAudioEnd,afterNewSpeech)=>this.receive(block,lane,content,afterAudioEnd,afterNewSpeech),
    fail:error=>this.endLane(block,lane,error)
   });
   if(lane.done){session.close();return;}
   lane.session=session;
   block.admitted++;
   this.flushLane(block,lane);
  }catch(error){this.endLane(block,lane,error);}
 }
 enqueue(block,pcm,hasNewSpeech=false){
  if(block.lanes.every(lane=>lane.done))return;
  if(this.bufferedBytes+pcm.length>this.config.maxQueuedBytes||!this.budget.take(pcm.length)){
   // Only lanes still waiting for setup hold PCM after the other lane has sent it.
   for(const lane of block.lanes)if(!lane.session&&!lane.done)this.endLane(block,lane,failure('Buffer STT cheio.','BACKPRESSURE'));
   for(const lane of block.lanes)if(!lane.done)this.send(block,lane,{pcm,hasNewSpeech});
   return;
  }
  this.bufferedBytes+=pcm.length;
  block.packets.push({pcm,hasNewSpeech});
  for(const lane of block.lanes)this.flushLane(block,lane);
  this.trim(block);
 }
 send(block,lane,{pcm,hasNewSpeech}){
  if(hasNewSpeech)lane.sentNewSpeech=true;
  try{lane.session.send(pcm,hasNewSpeech);}catch(error){this.endLane(block,lane,error);}
 }
 flushLane(block,lane){
  if(lane.done||!lane.session)return;
  while(!lane.done&&lane.cursor<block.offset+block.packets.length){
   this.send(block,lane,block.packets[lane.cursor++-block.offset]);
  }
  this.trim(block);
  if(lane.done||!block.closed||lane.ended)return;
  lane.ended=true;
  lane.deadline=this.setTimer(()=>this.endLane(block,lane,failure('Prazo de resposta STT esgotado.','CHUNK_TIMEOUT')),lane.session.timeoutMs);
  try{lane.session.end();}catch(error){this.endLane(block,lane,error);}
 }
 trim(block){
  const consumed=Math.min(block.offset+block.packets.length,...block.lanes.filter(lane=>!lane.done).map(lane=>lane.cursor));
  for(const {pcm} of block.packets.splice(0,consumed-block.offset)){
   this.bufferedBytes-=pcm.length;
   this.budget.release(pcm.length);
  }
  block.offset=consumed;
 }
 receive(block,lane,content,afterAudioEnd,afterNewSpeech){
  // Setup, pre-roll e overlap não contêm a primeira fala nova desta réplica.
  if(lane.done||!lane.session||!lane.sentNewSpeech||afterNewSpeech===false)return;
  const input=content.inputTranscription;
  if(typeof input?.text==='string'&&input.text){
   if(lane.text.length+input.text.length>100000){
    this.endLane(block,lane,failure('Limite de texto do bloco STT.','BACKPRESSURE'));
    return;
   }
   lane.text+=input.text;
   lane.interim='';
  }
  if(typeof content.interimInputTranscription?.text==='string')lane.interim=content.interimInputTranscription.text.slice(0,100000);
  if(block.sequence===this.nextPublish&&(input?.text||content.interimInputTranscription)){
   this.publishPartial(block);
  }
  if(!lane.ended)return;
  if(afterAudioEnd!==false){
   if(content.interactionStatus)lane.interactionStatus=content.interactionStatus;
   if(content.turnComplete||content.interactionStatus==='IDLE')lane.turnEnded=true;
   if(input?.finished===true)lane.inputFinished=true;
  }
  if(lane.session.requiresIdle&&lane.interactionStatus!=='IDLE'){
   this.clearTimer(lane.settle);
   lane.settle=null;
   return;
  }
  if(lane.inputFinished&&lane.text.trim()){this.complete(block,lane);return;}
  // inputTranscription may arrive after turnComplete. Accept nonempty input after a quiet window.
  if(lane.turnEnded&&lane.text.trim()&&(lane.settle==null||input?.text)){
   this.clearTimer(lane.settle);
   lane.settle=this.setTimer(()=>this.complete(block,lane),this.config.settleMs);
  }
 }
 publishPartial(block){
  if(!block||block.settled||this.cancelled)return;
  const source=block.lanes.find(lane=>!lane.done&&(lane.text||lane.interim));
  let partial=source?[source.text.trim(),source.interim.trim()].filter(Boolean).join(' '):'';
  if(partial&&block.overlapMs&&this.previousResolved){
   const prior=this.text.slice(-240).trimStart();
   const merged=mergeTranscriptionChunks([{sequence:1,text:prior},{...block,sequence:2,text:partial}]);
   const suffix=merged.slice(prior.length).trimStart();
   // Só remove a correspondência literal; ausência de repetição não invalida a prévia.
   partial=suffix;
  }
  if(partial!==this.partial){this.partial=partial;this.onPartial({...this.snapshot(partial),sequence:block.sequence});}
 }
 close(block,reason){
  block.closed=true;
  block.closedAt=this.now();
  this.previousEnd=reason==='maximum'?block.endMs:undefined;
  if(reason!=='maximum')this.tail=new Uint8Array();
  this.current=null;
  for(const lane of block.lanes)this.flushLane(block,lane);
  if(block.lanes.every(lane=>lane.done))this.complete(block);
 }
 endLane(block,lane,error){
  if(lane.done)return;
  lane.done=true;
  this.clearTimer(lane.deadline);
  this.clearTimer(lane.settle);
  if(lane.session)lane.session.close(error);
  lane.controller.abort();
  this.trim(block);
  if(block.closed&&block.lanes.every(copy=>copy.done))this.complete(block);
  else if(block.sequence===this.nextPublish)this.publishPartial(block);
 }
 complete(block,winner){
  if(block.settled||this.cancelled)return;
  block.settled=true;
  block.text=winner?.text.trim()||'';
  if(block.processing)this.pendingBlocks--;
  if(winner){
   this.counts.transcribed++;
   winner.session.confirm(this.now()-block.closedAt);
  }else{
   this.counts.unresolved++;
   this.gaps.push(block.sequence);
  }
  for(const lane of block.lanes)this.endLane(block,lane);
  if(!winner||block.admitted<2)this.onWarning({sequence:block.sequence,gap:!winner});
  this.publish();
 }
 publish(){
  let advanced=false;
  while(this.blocks.get(this.nextPublish)?.settled){
   const block=this.blocks.get(this.nextPublish);
   this.blocks.delete(this.nextPublish++);
   if(block.text){
    // A janela só permite remover correspondência literal na fronteira acústica.
    const prior=this.text.slice(-240).trimStart();
    const merged=mergeTranscriptionChunks([{sequence:1,text:prior},{...block,sequence:2,overlapMs:this.previousResolved?block.overlapMs:0}]);
    const suffix=prior?merged.slice(prior.length):merged;
    if(this.text.length+suffix.length>1000000){
     this.fail(failure('Limite de texto STT; áudio local preservado.','BACKPRESSURE'));
     return;
    }
    this.text+=suffix;
   }
   this.textBoundaries.push([block.sequence,this.text.length]);
   this.previousResolved=!!block.text;
   advanced=true;
  }
  if(advanced){
   this.partial='';
   this.onChunk({...this.snapshot(),sequence:this.nextPublish-1});
   this.publishPartial(this.blocks.get(this.nextPublish));
  }
  if(this.inputClosed&&!this.blocks.size)this.resolve?.(this.snapshot());
 }
 finish(){
  if(this.finishing)return this.finishing;
  this.stopping=true;
  this.finishing=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
  if(this.cancelled)this.reject(failure('Ditado cancelado.','CANCELLED'));
  else void this.work.then(()=>{
   if(this.cancelled)return;
   if(this.current)this.close(this.current,'finalization');
   this.tail=new Uint8Array();
   this.inputClosed=true;
   this.publish();
  }).catch(error=>this.fail(error));
  return this.finishing;
 }
 fail(error){if(!this.cancelled){this.cancel(error);this.onFailure(error);}}
 cancel(error=failure('Ditado cancelado.','CANCELLED')){
  if(this.cancelled)return;
  this.cancelled=true;
  for(const block of this.blocks.values())for(const lane of block.lanes)this.endLane(block,lane);
  this.blocks.clear();
  this.tail=new Uint8Array();
  this.reject?.(error);
 }
}
return{CONFIG,pcmRms,CapturePipeline,mergeTranscriptionChunks,TranscriptionMerger,LiveChunkTransport,DictationTransport,DistributedDictation,RecoveryStore,recovery:new RecoveryStore()};
});
