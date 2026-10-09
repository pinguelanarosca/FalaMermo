(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./live-config.js'):root.LiveConfig);if(typeof module==='object'&&module.exports)module.exports=api;else root.LiveSessions=api;})(globalThis,function(config){
'use strict';
const WS='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const ttsDiagnostics=[];
function rememberDiagnostic(session){if(session.options.mode==='dictation'||!config.caps(session.options.modelId).supportsNarration)return;const snapshot=session.diagnosticSnapshot(),index=ttsDiagnostics.findIndex(item=>item.sessionId===session.id);if(index>=0)ttsDiagnostics.splice(index,1);ttsDiagnostics.push(snapshot);if(ttsDiagnostics.length>12)ttsDiagnostics.shift();}
function getTtsDiagnostics(){return structuredClone(ttsDiagnostics);}
function websocketEndpoint(apiVersion='v1beta'){if(!['v1beta','v1alpha'].includes(apiVersion))throw new Error('Versão Live inválida.');return WS.replace('.v1beta.', '.'+apiVersion+'.');}
async function readMessageData(data){if(typeof data==='string')return data;if(typeof Blob!=='undefined'&&data instanceof Blob)return data.text();if(data instanceof ArrayBuffer||ArrayBuffer.isView(data))return new TextDecoder().decode(data);throw new Error('Formato de mensagem WebSocket Live não suportado.');}
function decodeBase64(value){const raw=atob(value),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
function encodeBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function classifyLiveError(error){const status=error?.httpStatus||Number(String(error?.message||'').match(/\b(400|401|403|404|422|429|500|502|503|529)\b/)?.[1]),m=String(error?.message||error||'');if(error?.cancelled||/cancel/i.test(m))return'CANCELLED';if(/invalidated/i.test(m))return'INVALIDATED_CONTEXT';if(status===429||/quota|rate limit/i.test(m))return'QUOTA';if(status===401||status===403||/api.?key|credential/i.test(m))return'AUTH';if(error?.closeCode===1007){const sent=error.lastSentType,phase=error.protocolPhase;if(['setup','turn'].includes(sent)&&['awaiting-setup-complete','awaiting-first-pcm','streaming'].includes(phase)&&/invalid[_ ]argument|invalid (?:argument|json)|unknown (?:field|name)|cannot find field|malformed|unsupported (?:field|parameter)/i.test(error.closeReason||''))return'REQUEST';return'UNKNOWN';}if(status===400||status===422||/invalid.argument|invalid setup|payload/i.test(m))return'REQUEST';if(status===404||/model.*(?:not found|unavailable|denied)/i.test(m))return'MODEL';if(status>=500||/timeout|goaway|closed|socket/i.test(m))return'TRANSIENT';return'NETWORK';}
class LiveSession{
 constructor(manager,options){this.manager=manager;this.options=options.mode==='dictation'?{...options,vad:config.dictationVad(options.modelId,options.vad)}:options;this.id='live-'+Date.now()+'-'+Math.random().toString(36).slice(2);this.ready=false;this.closed=false;this.busy=true;this.lastUsedAt=Date.now();this.resumeHandle=options.resumeHandle||null;this.handler=null;}
 trace(event,extra={}){if(this.options.mode==='dictation'||!config.caps(this.options.modelId).supportsNarration)return;this.protocolLog ||= [];const entry={event,at:new Date().toISOString(),elapsedMs:performance.now()-(this.connectStartedAt||performance.now()),phase:this.protocolPhase||'created',readyState:this.socket?.readyState??null,...extra};this.protocolLog.push(entry);if(this.protocolLog.length>40)this.protocolLog.shift();if(globalThis.LiveTtsDiagnostics){try{rememberDiagnostic(this);globalThis.LiveTtsDiagnostics.captureProtocol(getTtsDiagnostics().find(s=>s.sessionId===this.id));}catch{/* Diagnóstico não interfere no protocolo. */}}}
 diagnosticSnapshot(){const safe=value=>JSON.parse(config.redactSecrets(JSON.stringify(value),[this.options.apiKey,...(this.options.apiKeys||[])]));return safe({model:this.options.modelId,keyId:'key#'+(this.options.keyIndex||1),jobId:this.options.jobId||null,blockId:this.options.blockId??null,sessionId:this.id,url:websocketEndpoint(this.options.apiVersion),phase:this.protocolPhase||'created',socketOpen:this.socketOpenMs!==undefined,setupCompleteReceived:this.setupCompleteMs!==undefined,setup:this.sentSetup||null,turn:this.sentTurn||null,lastSentType:this.lastSentType||null,lastReceivedEvent:this.lastReceivedEvent||null,close:this.closeDetails||null,events:this.protocolLog||[]});}
 sendProtocol(type,message){const wire=JSON.stringify(message);this.socket.send(wire);this.lastSentType=type;if(type==='setup')this.sentSetup=JSON.parse(wire);else this.sentTurn=JSON.parse(wire);this.protocolPhase=type==='setup'?'awaiting-setup-complete':'awaiting-first-pcm';this.trace(type+'-sent');}
 async open(){
  if(this.ready&&!this.closed)return this;
  if(this.opening)return this.opening;
  this.opening=this.connect().finally(()=>{this.opening=null;});
  return this.opening;
 }
 async connect(){
  const route=this.options.mode==='dictation'?'stt':'tts';
  config.assertRouteModel(this.options.modelId,route);
  const builder=route==='stt'?config.buildLiveSttSessionConfig:config.buildLiveSessionConfig;
  // Payload estrutural é validado antes de abrir socket ou consumir outra chave.
  const setup=builder({...this.options,resumeHandle:this.resumeHandle});this.lastSetup=setup;
  const started=performance.now();this.connectStartedAt=started;this.protocolPhase='connecting';this.closed=false;this.closingSocket=false;this.localClose=false;
  const socket=new WebSocket(websocketEndpoint(this.options.apiVersion)+'?key='+encodeURIComponent(this.options.apiKey));this.socket=socket;this.trace('socket-created');
  let openResolve,openReject,setupResolve,setupReject;
  const opened=new Promise((resolve,reject)=>{openResolve=resolve;openReject=reject;});
  const setupDone=new Promise((resolve,reject)=>{setupResolve=resolve;setupReject=reject;});
  // Observa a rejeição mesmo se o socket falhar antes de opened resolver.
  void setupDone.catch(()=>{});
  let openedTimer=setTimeout(()=>openReject(new Error('Timeout ao abrir WebSocket Live.')),12000);
  let setupTimer;
  socket.onopen=()=>{clearTimeout(openedTimer);this.socketOpenMs=performance.now()-started;this.protocolPhase='socket-open';this.trace('socket-open');openResolve();};
  let incoming=Promise.resolve();
  const receive=async event=>{
   let msg;try{const data=await readMessageData(event.data);msg=JSON.parse(data);}catch(error){this.trace('message-parse-error',{error:config.redactSecrets(error.message,[this.options.apiKey])});return;}
   this.lastReceivedEvent={fields:Object.keys(msg),serverContentFields:Object.keys(msg.serverContent||{})};this.trace('message-received',{fields:this.lastReceivedEvent.fields});
   if(msg.serverContent?.interactionStatus)this.trace('interaction-status',{interactionStatus:msg.serverContent.interactionStatus});
   if(msg.sessionResumptionUpdate)this.resumeHandle=msg.sessionResumptionUpdate.resumable?msg.sessionResumptionUpdate.newHandle||null:null;
   if(msg.setupComplete){clearTimeout(setupTimer);this.setupCompleteMs=performance.now()-started;this.ready=true;this.protocolPhase='ready';this.trace('setup-complete');setupResolve();}
   if(msg.goAway){this.retiring=true;this.manager.onGoAway?.(this,msg.goAway.timeLeft);}
   if(msg.serverContent)this.handler?.(msg);
   if(msg.error){const error=new Error(String(msg.error.message||msg.error.status||'Erro Live.'));error.httpStatus=Number(msg.error.code)||undefined;this.trace('server-error',{code:error.httpStatus||null,error:config.redactSecrets(error.message,[this.options.apiKey])});setupReject(error);this.fail(error);}
  };
  socket.onmessage=event=>{incoming=incoming.then(()=>receive(event)).catch(error=>this.fail(error));};
  socket.onerror=()=>{const error=new Error('Falha de rede no WebSocket Live.');this.trace('socket-error');openReject(error);setupReject(error);this.fail(error);};
  socket.onclose=event=>{const phase=this.protocolPhase,reason=config.redactSecrets(String(event.reason||''),[this.options.apiKey]);this.closeDetails={code:event.code,reason,readyState:socket.readyState,at:new Date().toISOString(),phase,local:this.localClose===true};this.trace('socket-close',this.closeDetails);rememberDiagnostic(this);const error=Object.assign(new Error('WebSocket Live fechado ('+event.code+')'+(reason?': '+reason:'.')),{closeCode:event.code,closeReason:reason,protocolPhase:phase,lastSentType:this.lastSentType,protocol:this.diagnosticSnapshot()});openReject(error);setupReject(error);this.fail(error);};
  try{
   await opened;
   setupTimer=setTimeout(()=>setupReject(new Error('Timeout Live aguardando setupComplete.')),12000);
   this.sendProtocol('setup',setup);
   await setupDone;
   return this;
  }catch(error){error.protocol ||= this.diagnosticSnapshot();rememberDiagnostic(this);this.close();throw error;}
  finally{clearTimeout(openedTimer);clearTimeout(setupTimer);}
 }
 fail(error){this.ready=false;this.closed=true;this.handler?.({error:{message:error.message,cause:error}});this.manager.retire(this);}
 async sendTurn(text,onMessage,signal){
  await this.open();if(signal?.aborted)throw signal.reason;
  this.busy=true;this.lastUsedAt=Date.now();
  const chunks=[],transcript=[],started=performance.now();let firstAudio=null,firstText=null,settled=false,timer;
  const result=new Promise((resolve,reject)=>{
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.handler=null;this.busy=false;this.lastUsedAt=Date.now();this.trace(error?'turn-error':'turn-complete');rememberDiagnostic(this);if(error){reject(error);this.manager.retire(this);}else resolve({chunks,text:transcript.join('').trim(),metrics:{socketOpen:this.socketOpenMs,setupComplete:this.setupCompleteMs,firstAudio:firstAudio===null?null:firstAudio-started,firstText:firstText===null?null:firstText-started,turnComplete:performance.now()-started}});};
   const abort=()=>finish(Object.assign(new Error('Turno Live cancelado.'),{cancelled:true}));
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>finish(new Error('Timeout aguardando conclusão do turno Live.')),90000);
   this.handler=msg=>{
    if(msg.error){finish(msg.error.cause||new Error(msg.error.message||'Erro Live.'));return;}
    const sc=msg.serverContent;if(!sc)return;
    for(const part of sc.modelTurn?.parts||[]){const inline=part.inlineData||part.inline_data;if(inline?.data){if(firstAudio===null){firstAudio=performance.now();this.protocolPhase='streaming';this.trace('first-pcm',{mimeType:inline.mimeType||inline.mime_type});}const bytes=decodeBase64(inline.data);chunks.push(bytes);onMessage?.({type:'pcm',bytes,mimeType:inline.mimeType||inline.mime_type||'audio/pcm;rate=24000'});}if(part.text){if(firstText===null)firstText=performance.now();transcript.push(part.text);onMessage?.({type:'text',text:part.text});}}
    if(sc.outputTranscription?.text){if(firstText===null)firstText=performance.now();transcript.push(sc.outputTranscription.text);onMessage?.({type:'text',text:sc.outputTranscription.text});}
    const requiresIdle=config.caps(this.options.modelId).requiresInteractionIdle;
    if(requiresIdle?sc.interactionStatus==='IDLE':sc.turnComplete||sc.interactionStatus==='IDLE')finish();
   };
   try{this.sendProtocol('turn',config.buildLiveTurnMessage(text));}catch(error){finish(error);}
  });
  return result;
 }
 sendAudio(bytes,sampleRate=16000){if(!this.ready||this.closed)throw new Error('Sessão STT Live não está pronta.');if(this.options.vad?.disabled===true&&!this.audioActivity){this.socket.send(JSON.stringify({realtimeInput:{activityStart:{}}}));this.audioActivity=true;}this.socket.send(JSON.stringify({realtimeInput:{audio:{data:encodeBase64(bytes),mimeType:'audio/pcm;rate='+sampleRate}}}));}
 endAudio(){if(!this.ready||this.closed)throw new Error('Sessão STT Live fechada.');this.socket.send(JSON.stringify({realtimeInput:this.options.vad?.disabled===true?{activityEnd:{}}:{audioStreamEnd:true}}));this.audioActivity=false;}
 close(){this.closed=true;this.ready=false;try{if(this.socket&&this.socket.readyState<2&&!this.closingSocket){this.closingSocket=true;this.localClose=true;this.socket.close(1000,'idle');}}catch{}}
}
class LiveSessionManager{
 constructor(){this.pool=new Map();this.resumeHandles=new Map();this.ttl=config.DEFAULTS.liveSessionIdleTtl;this.timer=setInterval(()=>this.sweep(),10000);}
 key(o){return [o.modelId,o.keyIndex,o.voiceName||'',o.mode||'',o.thinkingLevel||'',o.thinkingBudget??'',Boolean(o.outputTranscription),o.systemInstruction||'',JSON.stringify(o.vad||{}),JSON.stringify(o.customVocabulary||[]),o.jsonMode||'panel',JSON.stringify(o.advancedJson||null),o.smartTranscription!==false,JSON.stringify(o.languageCodes||[])].join('|');}
 async acquire(options){config.assertRouteModel(options.modelId,options.mode==='dictation'?'stt':'tts');this.ttl=options.liveSessionIdleTtl||this.ttl;const key=this.key(options),list=this.pool.get(key)||[];let session=list.find(s=>!s.busy&&!s.closed&&!s.retiring);if(!session){session=new LiveSession(this,{...options,resumeHandle:this.resumeHandles.get(key)||null});list.push(session);this.pool.set(key,list);}session.options.jobId=options.jobId;session.options.blockId=options.blockId;session.busy=true;try{await session.open();return session;}catch(error){this.retire(session);this.resumeHandles.delete(key);throw error;}}
 release(session){session.busy=false;session.lastUsedAt=Date.now();if(session.retiring)this.retire(session);}
 retire(session){session.close();for(const [key,list] of this.pool){if(list.includes(session)&&session.resumeHandle)this.resumeHandles.set(key,session.resumeHandle);const next=list.filter(s=>s!==session);if(next.length)this.pool.set(key,next);else this.pool.delete(key);}}
 onGoAway(session){if(!session.busy)this.retire(session);}
 sweep(){const now=Date.now();for(const list of this.pool.values())for(const s of [...list])if(!s.busy&&now-s.lastUsedAt>this.ttl)this.retire(s);}
 closeAll(){for(const list of this.pool.values())for(const s of list)s.close();this.pool.clear();clearInterval(this.timer);}
}
return{LiveSession,LiveSessionManager,classifyLiveError,decodeBase64,encodeBase64,websocketEndpoint,readMessageData,getTtsDiagnostics};
});
