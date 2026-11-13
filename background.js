import './tts-config.js';
import './tts-adaptive.js';
import './live-config.js';
import './live-tts-diagnostics.js';
import './live-stt-diagnostics.js';
import './task-archive.js';
import './global-jobs.js';
import './stt-scheduler.js';
(()=>{
const __modules={
"extension/src/background/index.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entrypoint do Service Worker da Extensão Chrome (Manifest V3).
 * Orientado a eventos, ultraleve e sem dependência de DOM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const messageRouter_1 = __require("extension/src/background/messageRouter.ts");
const commandHandler_1 = __require("extension/src/background/commandHandler.ts");
const contextMenuHandler_1 = __require("extension/src/background/contextMenuHandler.ts");
const chromeStorageAdapter_1 = __require("extension/src/services/storage/chromeStorageAdapter.ts");
// Inicialização de ciclo de vida
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[EXT TTS STT] Extensão inicializada (${details.reason})`);
    // Garante que o storage possua os namespaces padrão inicializados
    const allSettings = await chromeStorageAdapter_1.chromeStorage.getAll();
    await chromeStorageAdapter_1.chromeStorage.setMultiple(globalThis.LiveConfig.migrateStorage(allSettings));
});
// Registro dos listeners de atalhos e menus
(0, commandHandler_1.registerCommandHandlers)();
(0, contextMenuHandler_1.setupContextMenus)();
chrome.tabs.onRemoved?.addListener(tabId => messageRouter_1.originLost({tabId,captureGone:true,tabClosed:true}).catch(error => console.warn('[GlobalJobs] Falha ao finalizar origem encerrada:',error.message)));
chrome.tabs.onUpdated?.addListener((tabId,change) => {
    if(change.discarded===true)void messageRouter_1.originLost({tabId,captureGone:true}).catch(error=>console.warn('[GlobalJobs] Falha ao atualizar origem:',error.message));
    else if(change.status==='complete')void messageRouter_1.verifyOriginDocuments(tabId).catch(error=>console.warn('[GlobalJobs] Falha ao verificar origem:',error.message));
});
chrome.storage.onChanged?.addListener((changes,area) => {if(area==='local'&&changes.history)void messageRouter_1.historyChanged(changes.history.newValue).catch(error=>console.warn('[GlobalJobs] Falha ao sincronizar histórico:',error.message));});
// Roteamento de mensagens assíncronas
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen'||['HUD_GLOBAL_STATE','LIVE_OPTIONS_EVENT','STT_GLOBAL_STOP','STT_GLOBAL_CANCEL','STT_GLOBAL_STATUS','STT_SHORTCUT_RELEASE'].includes(message.type)) return false;
    (0, messageRouter_1.handleExtensionMessage)(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true; // Retorno true mantém a porta de resposta aberta para promessas
});

},
"extension/src/services/backgroundPlayback.ts":function(module,exports,__require){
Object.defineProperty(exports, '__esModule', { value: true });
let creating = null;
let pendingStarts = 0;
const preferences = new Map();
const keyFor = route => `${route.tabId}:${route.frameId || 0}:${route.playerId}`;
async function hasDocument() {
    if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
    if (chrome.runtime.getContexts) {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
        return contexts.length > 0;
    }
    const pages = await clients.matchAll();
    return pages.some(page => page.url === chrome.runtime.getURL('offscreen.html'));
}
async function ensureDocument() {
    if (creating) return creating;
    creating = (async () => {
        if (!await hasDocument()) await chrome.offscreen.createDocument({
            url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK','BLOBS','WORKERS'],
            justification: 'Reproduzir PCM e processar frames Blob recebidos pelo WebSocket Gemini Live, inclusive durante ditado sem áudio de saída.',
        });
    })();
    try { await creating; } finally { creating = null; }
}
function routeFor(payload, sender) {
    if ((!sender.tab?.id && !['options.html','popup.html'].some(page=>sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL(page))) || !payload.playerId) throw new Error('Player sem origem identificada.');
    return { tabId: sender.tab?.id || 0, frameId: sender.frameId || 0, ...(sender.documentId?{documentId:sender.documentId}:{}), playerId: payload.playerId };
}
async function send(payload) {
    return chrome.runtime.sendMessage({ type: 'TTS_OFFSCREEN_COMMAND', target: 'offscreen', payload });
}
async function localVad(payload,canStart=()=>true) {
    if(!canStart())return{ok:false,code:'VAD_CANCELLED'};
    if (payload.operation === 'prepare') await ensureDocument();
    if(!canStart())return{ok:false,code:'VAD_CANCELLED'};
    return chrome.runtime.sendMessage({ type: 'STT_VAD_OFFSCREEN', target: 'offscreen', payload });
}
exports.localVad = localVad;
async function playGeneratedAudio(result, playback, sender, signal) {
    const route = routeFor(playback, sender);
    const timing=globalThis.TtsConfig,trace=timing.getTrace(result.trace?.id);
    trace?.mark('OFFSCREEN_CREATE_START');
    await ensureDocument();
    trace?.mark('OFFSCREEN_CREATE_END');
    if (signal.aborted) throw new Error('Reprodução cancelada pelo usuário.');
    const response = await send({ ...playback, ...preferences.get(keyFor(route)), ...route,
        operation: 'PLAY', src: `data:${result.mimeType || 'audio/wav'};base64,${result.audioBase64}`, currentTime: 0,
        ...(trace?.enabled?{trace:trace.packet()}:{}),
    });
    if (!response?.success) throw new Error(response?.error || 'Falha ao iniciar a narração.');
    if(trace&&response.trace){trace.merge(response.trace);result.trace=trace.snapshot();}
    return { started: true, ...response.status };
}
async function handlePlaybackCommand(payload, sender, canStart, signal) {
    const route = routeFor(payload, sender);
    if (payload.operation === 'SET') {
        const next = { ...preferences.get(keyFor(route)) };
        if (typeof payload.volume === 'number') next.volume = payload.volume;
        if (typeof payload.playbackRate === 'number') next.playbackRate = payload.playbackRate;
        preferences.set(keyFor(route), next);
    }
    if (payload.operation === 'STOP') preferences.delete(keyFor(route));
    const starts=['PLAY','TTS_LIVE_START','STT_LIVE_START'].includes(payload.operation);
    if(starts)pendingStarts++;
    try {
        if(starts)await ensureDocument();
        else if(!await hasDocument())return{success:true};
        if(canStart&&!await canStart())return{success:false,error:'Ditado cancelado antes de conectar.'};
        signal?.throwIfAborted();
        return await send({...payload,...route});
    }
    finally{if(starts)pendingStarts--;}
}
async function forwardPlaybackEvent(payload, sender) {
    if (sender.url !== chrome.runtime.getURL('offscreen.html')) return { success: false };
    if(payload.trace&&payload.event==='play'){
        const timing=globalThis.TtsConfig,trace=timing.getTrace(payload.trace.id);
        if(trace){trace.merge(payload.trace);void __require("extension/src/services/storage/chromeStorageAdapter.ts").chromeStorage.update('logs',logs=>({...logs,ttsTraces:[trace.snapshot(),...(logs.ttsTraces||[]).filter(item=>item.id!==trace.id)].slice(0,8)}));}
    }
    await chrome.tabs.sendMessage(payload.tabId, { type: 'TTS_PLAYBACK_EVENT', payload }, { frameId: payload.frameId || 0 }).catch(() => {});
    return { success: true };
}
async function stopPlaybackForTab(tabId) {
    for (const key of preferences.keys()) if (key.startsWith(`${tabId}:`)) preferences.delete(key);
    // Playback lives offscreen; closing its source tab is not a stop command.
}
exports.reserveIntent=async playbackIntent=>{if(await hasDocument())await send({operation:'PLAYBACK_INTENT',playbackIntent});};
exports.hasDocument=hasDocument;
exports.send=send;
exports.isStarting=()=>pendingStarts>0||creating!==null;
exports.stopAll=async()=>{
    preferences.clear();
    await creating?.catch(()=>{});
    if(!await hasDocument())return true;
    let timer;
    try{
        await Promise.race([send({operation:'STOP_ALL_OPERATIONS'}),new Promise((_,reject)=>{
            timer=setTimeout(()=>reject(new Error('Documento sem confirmação de encerramento.')),15000);
        })]);
    }catch(error){if(await hasDocument())console.warn('[Parar tudo] Encerrando documento sem confirmação.',error?.name);}
    finally{clearTimeout(timer);}
    if(await hasDocument())await chrome.offscreen.closeDocument();
    return !await hasDocument();
};
exports.playGeneratedAudio = playGeneratedAudio;
exports.handlePlaybackCommand = handlePlaybackCommand;
exports.forwardPlaybackEvent = forwardPlaybackEvent;
exports.stopPlaybackForTab = stopPlaybackForTab;

},
"extension/src/background/messageRouter.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Roteador de mensagens tipado da Extensão Chrome (Service Worker).
 * Despacha requisições entre Content Script, Popup e Options com suporte a cancelamento de TTS,
 * recorte no Lens e gravação de logs de histórico.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleExtensionMessage = async (message,sender,guiJob)=>{
 const startsNarration=message.type==='HUD_GLOBAL_COMMAND'&&['play','narrate','resume'].includes(message.payload?.action);
 const tracks=startsNarration||['STT_CAPTURE_RESERVE','STT_LIVE_START','TTS_REQUEST',
  'TTS_PLAYBACK_COMMAND','HUD_GLOBAL_TOGGLE','LENS_ANALYZE_REQUEST'].includes(message.type);
 const controller=tracks?new AbortController():null;
 if(controller)pendingOperations.add(controller);
 const startKey=message.type==='TTS_REQUEST'&&ttsStartKey(sender,message.payload?.playback);
 if(startKey)pendingTtsStarts.set(controller,startKey);
 if(message.type==='TTS_PLAYBACK_COMMAND'&&message.payload?.operation==='STOP'){
  const stopKey=ttsStartKey(sender,message.payload);
  for(const [start,key] of pendingTtsStarts){
   if(key===stopKey)start.abort(Object.assign(Error('Narração interrompida pelo usuário.'),{cancelled:true}));
  }
 }
 let reply;
 try{
  if(controller&&globalPanic)await globalPanic.catch(()=>{});
  controller?.signal.throwIfAborted();
  if(['STT_CAPTURE_RESERVE','TTS_REQUEST'].includes(message.type)&&message.payload?.startedAt<lastPanicAt)
   return {success:false,cancelled:true,error:'Operação interrompida por Parar tudo.'};
  reply=await handleExtensionMessage(message,sender,guiJob,controller?.signal);
 }catch(error){reply={success:false,error:error.message,cancelled:controller?.signal.aborted===true};}
 finally{if(controller){pendingOperations.delete(controller);pendingTtsStarts.delete(controller);}}
 if(!reply?.state?.tabHud)return reply;
 return {...reply,state:viewHud(reply.state,senderOrigin(sender))};
};
const defaultAgents_1 = __require("shared/constants/defaultAgents.ts");
const defaultSettings_1 = __require("shared/constants/defaultSettings.ts");
const chromeStorageAdapter_1 = __require("extension/src/services/storage/chromeStorageAdapter.ts");
const geminiDirectClient_1 = __require("extension/src/services/geminiDirectClient.ts");
const tabCaptureHandler_1 = __require("extension/src/background/tabCaptureHandler.ts");
const diagnosticLogger_1 = __require("extension/src/services/diagnosticLogger.ts");
const backgroundPlayback_1 = __require("extension/src/services/backgroundPlayback.ts");
let activeTtsAbortController = null;
let diagnosticTtsController = null;
const playbackControllers = new Map();
const pendingOperations=new Set();
const pendingTtsStarts=new Map();
const lensOperations=new Map();
let globalPanic,lastPanicAt=0;
let playbackIntent=Date.now()*1000;
const nextPlaybackIntent=()=>playbackIntent=Math.max(playbackIntent+1,Date.now()*1000);
const audioJob=job=>globalThis.GlobalJobs.audioJob(job);
const liveId=prefix=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
const globalViewers=new Map();
const viewerRecoveries=new Map();
function deliveryDeadline(work){
 let timer;
 return Promise.race([work,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error('Confirmação do documento indisponível.')),1500);
 })]).finally(()=>clearTimeout(timer));
}
function stopViewerRecovery(key){const pending=viewerRecoveries.get(key);if(pending)clearTimeout(pending.timer);viewerRecoveries.delete(key);}
function recoverViewer(key,viewer,attempt=0){
 if(viewerRecoveries.has(key)||globalViewers.get(key)!==viewer||attempt>=3)return;
 const timer=setTimeout(async()=>{viewerRecoveries.delete(key);if(globalViewers.get(key)!==viewer)return;try{const state=await globalJobs.get();await deliveryDeadline(chrome.tabs.sendMessage(viewer.tabId,{type:'HUD_GLOBAL_STATE',target:'global-hud',state:viewHud(state,viewer)},viewer.documentId?{documentId:viewer.documentId}:{frameId:viewer.frameId}));}catch{recoverViewer(key,viewer,attempt+1);}},[100,400,1000][attempt]);
 viewerRecoveries.set(key,{timer});
}
const viewerStorageKey='falamermo.globalHudViewers.v1';
let viewerWrites=Promise.resolve();
function persistViewers(){const next=viewerWrites.catch(()=>{}).then(()=>chrome.storage.session?.set({[viewerStorageKey]:[...globalViewers.values()].slice(-512)}));viewerWrites=next;return next;}
const cleanPage=sender=>['options.html','popup.html','task.html'].find(page=>sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL(page));
const senderOrigin=sender=>({tabId:sender.tab?.id||0,frameId:sender.frameId||0,...(sender.documentId?{documentId:sender.documentId}:{}),...(cleanPage(sender)?{page:cleanPage(sender)}:{})});
function ttsStartKey(sender,playback){
 if(typeof playback?.playerId!=='string'||typeof playback.requestId!=='string')return null;
 const {tabId,frameId,documentId,page}=senderOrigin(sender);
 return JSON.stringify([tabId,frameId,documentId,page,playback.playerId,playback.requestId]);
}
const allowedHudSender=sender=>Boolean(sender.tab?.id||cleanPage(sender));
const vadSetting='sttVadDetector';
let vadOwner;
const hybridRequested=async()=>true;
const sameVadOwner=(payload,sender)=>Boolean(vadOwner&&payload)&&vadOwner.id===payload.jobId&&
    vadOwner.generation===payload.generation&&vadOwner.documentId===sender.documentId&&
    vadOwner.tabId===sender.tab?.id&&vadOwner.frameId===sender.frameId&&vadOwner.page===(sender.tab?undefined:cleanPage(sender));
const viewHud=(state,viewer)=>globalThis.GlobalJobs.forHud(state,viewer?.page?0:viewer?.tabId);
const globalJobs=globalThis.GlobalJobs.create({storage:chrome.storage?.session,
 taskArchive:globalThis.TaskArchive.getDefault(),
 warn:message=>console.warn('[GlobalJobs]',message),
 getHistory:()=>chromeStorageAdapter_1.chromeStorage.get('history'),
 updateHistory:fn=>chromeStorageAdapter_1.chromeStorage.update('history',fn),
 ...(chrome.tabs?.get&&chrome.tabs?.update?{getTab:id=>chrome.tabs.get(id),updateTab:(id,value)=>chrome.tabs.update(id,value)}:{}),
 notify:state=>{
  const packet={type:'HUD_GLOBAL_STATE',target:'global-hud'};
  // A frozen document can retain an open response port. UI delivery cannot hold the registry queue.
  for(const [key,viewer] of globalViewers){
   void deliveryDeadline(chrome.tabs.sendMessage(viewer.tabId,{...packet,state:viewHud(state,viewer)},viewer.documentId?{documentId:viewer.documentId}:{frameId:viewer.frameId}))
    .then(()=>stopViewerRecovery(key),()=>recoverViewer(key,viewer));
  }
  void deliveryDeadline(chrome.runtime.sendMessage({...packet,state:viewHud(state)})).catch(()=>{});
 }
});
let globalRecovery=null;
async function recoverGlobalJobs(){if(globalRecovery)return globalRecovery;globalRecovery=(async()=>{const saved=await chrome.storage.session?.get(viewerStorageKey);for(const viewer of saved?.[viewerStorageKey]||[])if(Number.isInteger(viewer.tabId)&&viewer.tabId>0&&Number.isInteger(viewer.frameId)){const safe={tabId:viewer.tabId,frameId:viewer.frameId,...(typeof viewer.documentId==='string'?{documentId:viewer.documentId}: {}),...(['options.html','popup.html','task.html'].includes(viewer.page)?{page:viewer.page}:{})};globalViewers.set(`${safe.tabId}:${safe.frameId}:${safe.documentId||''}`,safe);}await globalJobs.get();if(backgroundPlayback_1.hasDocument){const present=await backgroundPlayback_1.hasDocument();const response=present?await backgroundPlayback_1.send({operation:'GLOBAL_JOBS_SNAPSHOT'}):{success:true,jobs:[]};if(response?.success&&Array.isArray(response.jobs)){const persisted=await globalJobs.reconcile(response.jobs);if(present)await backgroundPlayback_1.send({operation:'GLOBAL_JOBS_ACK',sequences:Object.fromEntries(persisted.jobs.map(job=>[job.jobId,job.narration?.eventSeq??job.eventSeq]))});}}await globalJobs.restoreProtections();
 for(const job of (await globalJobs.get()).jobs.filter(globalThis.GlobalJobs.holdsMicrophone))await recoverSttCapture(job);
 if(globalPanic)return;
 for(const job of (await globalJobs.get()).jobs.filter(job=>job.editorDelivery))scheduleEditorDelivery(job);
 for(const job of (await globalJobs.get()).jobs.filter(job=>job.type==='STT'&&job.originAvailable&&['inserting','error'].includes(job.status))){
  if(job.editorDelivery&&job.status==='inserting')continue;
  let status;try{status=await deliveryDeadline(sendToOrigin(job,{type:'STT_GLOBAL_STATUS',payload:{jobId:job.jobId}}));}catch{}
  if(globalPanic)return;
  if(status?.found&&['completed','insertion-failed'].includes(status.status)){await globalJobs.insertion({jobId:job.jobId,inserted:status.inserted===true,reason:status.reason||'RECOVERED_RESULT'},job.origin);continue;}
  if(status?.found&&status.status==='cancelled'){await globalJobs.event({jobId:job.jobId,event:'stt-cancelled'});continue;}
  if(status?.found){await sendToOrigin(job,{type:job.origin.tabId?'STT_LIVE_EVENT':'LIVE_OPTIONS_EVENT',payload:{jobId:job.jobId,eventSeq:job.eventSeq,event:job.status==='inserting'?'stt-final':'stt-error',text:job.text,error:job.error,incomplete:job.incomplete}}).catch(()=>{});}
  else if(job.status==='inserting')await globalJobs.originLost({...job.origin,jobId:job.jobId});
 }
})();try{await globalRecovery;}catch(error){globalRecovery=null;throw error;}}
async function sendToOrigin(job,message){if(job.origin.tabId&&job.origin.page!=='options.html')return chrome.tabs.sendMessage(job.origin.tabId,message,job.origin.documentId?{documentId:job.origin.documentId}:{frameId:job.origin.frameId});return chrome.runtime.sendMessage({...message,target:'stt-origin',origin:job.origin});}
const editorDeliveries=new Map();
function scheduleEditorDelivery(job){
 if(globalPanic||!job?.editorDelivery||job.status==='cancelling'||!job.origin.tabId||!job.textRevision)return;
 const final=job.transcriptFinal===true,provisional=Boolean(job.partialText);
 const trace=(stage,extra={})=>{void globalThis.LiveSttDiagnostics?.record?.({
  jobId:job.jobId,scope:'editor',stage,revision:job.textRevision,sequence:job.textSequence,
  characters:job.text.length+(provisional?job.partialText.length+(job.text?1:0):0),
  finalInsertion:final,provisional,incomplete:job.incomplete,ackRevision:job.insertion?.revision||0,...extra
 }).catch(()=>{});};
 if(!job.originAvailable){
  if(final)trace('editor-delivery-exhausted',{editorReason:'ORIGIN_LOST'});
  return;
 }
 if(
    globalThis.GlobalJobs.TERMINAL.has(job.status)||job.textRevision<=(job.insertion?.revision||0))return;
 const previous=editorDeliveries.get(job.jobId);
 if(previous?.revision>=job.textRevision)return;
 clearTimeout(previous?.timer);
 const delivery={revision:job.textRevision,attempt:0};
 editorDeliveries.set(job.jobId,delivery);
 const payload={jobId:job.jobId,eventSeq:job.textRevision,editorDelivery:true,
  event:final?'stt-final':'stt-partial',text:job.text,confirmedText:job.text,partialText:job.partialText,sequence:job.textSequence,textBoundaries:job.textBoundaries,publishedAt:job.publishedAt};
 const attempt=async()=>{
  if(globalPanic||editorDeliveries.get(job.jobId)!==delivery)return;
  delivery.attempt++;
  if(!provisional||delivery.attempt>1)trace('editor-dispatch',{deliveryAttempt:delivery.attempt});
  let deadline,timedOut=false,editorReason='EDITOR_ACK_MISSING';
  try{
   const reply=await Promise.race([
    sendToOrigin(job,{type:'STT_LIVE_EVENT',editorDelivery:true,payload:{...payload,dispatchedAt:Date.now()}}),
    new Promise(resolve=>{deadline=setTimeout(()=>{timedOut=true;resolve();},3000);})
   ]);
   const result=reply?.result;
   if(reply?.success&&result?.revision===delivery.revision&&result.final===final){
    const stored=result.reason==='WAITING_FINAL'?null:(await globalJobs.insertion({...result,jobId:job.jobId},job.origin)).jobs.find(item=>item.jobId===job.jobId);
    if(!provisional||!result.inserted)trace('editor-ack',{
     deliveryAttempt:delivery.attempt,editorReason:result.reason,inserted:result.inserted,
     ackRevision:result.revision,publishedRevision:stored?.textRevision,ackAccepted:stored?.insertion?.revision===result.revision
    });
    if(editorDeliveries.get(job.jobId)===delivery)editorDeliveries.delete(job.jobId);
    return;
   }
   editorReason=timedOut?'EDITOR_ACK_TIMEOUT':result?'EDITOR_ACK_MISMATCH':'EDITOR_ACK_MISSING';
  }catch{editorReason='EDITOR_MESSAGE_FAILED';}
  finally{clearTimeout(deadline);}
  if(editorDeliveries.get(job.jobId)!==delivery)return;
  const current=await globalJobs.find({jobId:job.jobId});
  if(editorDeliveries.get(job.jobId)!==delivery)return;
  if(delivery.attempt<4&&current?.originAvailable&&current.status!=='cancelling'&&!globalThis.GlobalJobs.TERMINAL.has(current.status)){
   trace('editor-delivery-missed',{deliveryAttempt:delivery.attempt,editorReason,publishedRevision:current.textRevision});
   delivery.timer=setTimeout(()=>void attempt(),[0,200,500,1000][delivery.attempt]);
  }else{
   if(current?.textRevision===delivery.revision&&(!current.originAvailable||!globalThis.GlobalJobs.TERMINAL.has(current.status))){
    trace('editor-delivery-exhausted',{deliveryAttempt:delivery.attempt,editorReason:current.originAvailable?editorReason:'ORIGIN_LOST'});
   }
   editorDeliveries.delete(job.jobId);
  }
 };
 void attempt();
}
async function recoverSttCapture(job){
 let capture;
 try{capture=await deliveryDeadline(sendToOrigin(job,{type:'STT_GLOBAL_STATUS',payload:{jobId:job.jobId}}));}
 catch(error){if(!/Receiving end does not exist|No (?:frame|document) with id|No tab with id/i.test(error.message))return;}
 if(capture?.found&&!capture.microphoneReleased)return;
 if(!capture?.found&&job.captureAdmission==='reserved'){
  await globalJobs.event({jobId:job.jobId,event:'stt-cancelled',microphoneReleased:true});
 }else await globalJobs.capture({jobId:job.jobId,microphoneReleased:true},job.origin);
}
async function cancelCaptureAtOrigin(job){
 try{
  const result=await sendToOrigin(job,{type:'STT_GLOBAL_CANCEL',payload:{jobId:job.jobId}});
  return result?.success===true&&result.microphoneReleased===true;
 }catch(error){
  // Chrome confirms that this document no longer exists.
  return /Receiving end does not exist|No (?:frame|document) with id|No tab with id/i.test(error.message);
 }
}
function stopAllOperations(){
 if(globalPanic)return globalPanic;
 lastPanicAt=Date.now();
 const reason=Object.assign(new Error('Operação interrompida por Parar tudo.'),{cancelled:true});
 for(const controller of pendingOperations)controller.abort(reason);
 activeTtsAbortController?.abort(reason);
 diagnosticTtsController?.abort(reason);
 for(const controller of playbackControllers.values())controller.abort(reason);
 const work=(async()=>{
  try{await recoverGlobalJobs();}
  catch(error){console.warn('[Parar tudo] Falha ao reconciliar o registro.',error?.name);}
  const affected=await globalJobs.beginPanic().catch(error=>{
   console.warn('[Parar tudo] Registro de tarefas indisponível.',error?.name);
   return null;
  });
  for(const job of affected||[]){
   clearTimeout(editorDeliveries.get(job.jobId)?.timer);
   editorDeliveries.delete(job.jobId);
  }
  const remote=backgroundPlayback_1.stopAll().catch(()=>false);
  const closing=(affected||[]).map(async job=>{
   const local=job.type==='STT'&&(job.status==='cancelling'||globalThis.GlobalJobs.holdsMicrophone(job))
    ?cancelCaptureAtOrigin(job):Promise.resolve(false);
   // A late microphone permission result still owns the old capture and can confirm later.
   const settled=Promise.all([remote,local]).then(([remoteStopped,captureReleased])=>
    globalJobs.finishPanic(job,{remoteStopped,captureReleased}));
   await deliveryDeadline(settled).catch(()=>{});
  });
  await Promise.all(closing);
  const remoteStopped=await remote;
  if(!affected)return{success:false,error:'Não foi possível confirmar a parada das capturas.'};
  const state=await globalJobs.get();
  return {success:true,remoteStopped,pending:!remoteStopped||state.jobs.some(job=>
   job.status==='cancelling'||job.narration?.status==='cancelling'||affected.some(old=>old.jobId===job.jobId&&globalThis.GlobalJobs.holdsMicrophone(job))),state};
 })();
 globalPanic=work;
 void work.finally(()=>{if(globalPanic===work)globalPanic=null;}).catch(()=>{});
 return work;
}
async function handleOriginLost(query){await recoverGlobalJobs();for(const[key,viewer]of globalViewers)if(viewer.tabId===query.tabId&&(query.frameId===undefined||viewer.frameId===query.frameId)&&(!query.documentId||viewer.documentId===query.documentId)){stopViewerRecovery(key);globalViewers.delete(key);}await persistViewers();const affected=await globalJobs.originLost(query);for(const job of affected){
 // A navigation can start before pagehide. Give the original document its normal PCM drain;
 // a closed/destroyed document rejects immediately, then offscreen finalizes available input.
 if(!query.captureGone)try{await deliveryDeadline(sendToOrigin(job,{type:'STT_GLOBAL_STOP',payload:{jobId:job.jobId,stopReason:'origin-lost'}}));}catch{}
 if(await backgroundPlayback_1.hasDocument?.())await backgroundPlayback_1.send({operation:'STT_ORIGIN_LOST',jobId:job.jobId,playerId:job.playerId,...job.origin}).catch(error=>globalJobs.fail(job.jobId,error.message));
}}
exports.originLost=handleOriginLost;
exports.verifyOriginDocuments=async tabId=>{
 await recoverGlobalJobs();
 const active=(await globalJobs.get()).jobs.filter(job=>job.type==='STT'&&job.originAvailable&&job.origin.tabId===tabId&&
  job.origin.documentId&&!globalThis.GlobalJobs.TERMINAL.has(job.status));
 for(const job of active){
  try{await deliveryDeadline(sendToOrigin(job,{type:'STT_GLOBAL_STATUS',payload:{jobId:job.jobId}}));}
  catch(error){
   if(/Receiving end does not exist|No (?:frame|document) with id|No tab with id/i.test(error.message)){
    await handleOriginLost({...job.origin,jobId:job.jobId,captureGone:true});
   }
  }
 }
};
exports.historyChanged=async()=>{await recoverGlobalJobs();return globalJobs.historyChanged(()=>chromeStorageAdapter_1.chromeStorage.get('history'));};
const guiCommands=new Map();
const taskWindows=new Map();
const taskWindowsKey='falamermo.taskWindows.v1';
let globalPlaybackCommand=Promise.resolve(),globalVolumeCommands=Promise.resolve();
function setGlobalVolume(payload){const work=globalVolumeCommands.catch(()=>{}).then(async()=>{
 await recoverGlobalJobs();const volume=payload?.volume;if(!Number.isFinite(volume))return{success:false,error:'Volume inválido.'};
 if(await backgroundPlayback_1.hasDocument()){const result=await backgroundPlayback_1.send({operation:'SET_GLOBAL',volume});if(!result?.success)return result;}
 return{success:true,state:await globalJobs.globalSettings({volume})};
});globalVolumeCommands=work;return work;}

async function toggleGlobalPlayback(intent={},signal){
 const work=globalPlaybackCommand.catch(()=>{}).then(async()=>{
  const state=await globalJobs.get();
  signal?.throwIfAborted();
  const audio=state.jobs.map(audioJob);
  const active=audio.find(job=>job.status==='playing')||
   audio.find(job=>job.status==='connecting'&&job.progress.outputActive);
  const action=intent.action||(active?'pause':'resume');
  const paused=audio.filter(job=>job.status==='paused')
   .sort((a,b)=>b.pausedAt-a.pausedAt||b.updatedAt-a.updatedAt||b.jobId.localeCompare(a.jobId));
  const target=action==='pause'?active:action==='resume'&&!active
   ?paused.find(job=>job.jobId===state.playback?.selectedJobId)||paused[0]
   :null;
  if(!target||intent.jobId&&intent.jobId!==target.jobId||
     intent.requestId&&intent.requestId!==target.requestId)return{success:true,state};
  return controlGlobalJob({jobId:target.jobId,requestId:target.requestId,action},signal);
 });
 globalPlaybackCommand=work;
 return work;
}
async function controlGlobalJob(payload,signal){
 if(['play','resume','narrate'].includes(payload.action))payload={...payload,playbackIntent:nextPlaybackIntent()};
 const work=(guiCommands.get(payload.jobId)||Promise.resolve()).catch(()=>{}).then(()=>runGlobalJobCommand(payload,signal));
 guiCommands.set(payload.jobId,work);
 try{return await work;}finally{if(guiCommands.get(payload.jobId)===work)guiCommands.delete(payload.jobId);}
}
async function runGlobalJobCommand(payload,signal){let job=await globalJobs.find({jobId:payload.jobId});signal?.throwIfAborted();if(!job)return{success:false,error:'Tarefa não encontrada.'};
 if(['stop','pause','resume','seek','set'].includes(payload.action)&&payload.requestId&&payload.requestId!==(job.type==='STT'&&globalThis.GlobalJobs.TERMINAL.has(job.status)?audioJob(job).requestId:job.requestId))return{success:false,error:'Controle de reprodução antigo. Atualize o painel; a tarefa atual foi preservada.'};
 if(payload.action==='stop'&&lensOperations.has(job.jobId)){
  lensOperations.get(job.jobId).abort(Object.assign(new Error('Seleção cancelada.'),{cancelled:true}));
 }
 if(payload.action==='select')return{success:true,state:await globalJobs.ui({activeTaskId:job.jobId})};
 if(payload.action==='collapse')return{success:true,state:await globalJobs.collapse(payload)};
 if(payload.action==='edit')return{success:true,state:await globalJobs.edit(payload)};
 if(['play','narrate'].includes(payload.action)&&payload.expectedText!==undefined&&payload.expectedText!==(job.type==='STT'?job.workingText??job.text:job.text))return{success:false,error:'O texto foi alterado em outro painel. Revise a tarefa antes de narrar.'};
 if(payload.action==='reopen')return{success:true,state:await globalJobs.reopen(job.jobId)};
 if(payload.action==='maximize'){
  if(!taskWindows.has(job.jobId)){const saved=(await chrome.storage.session?.get(taskWindowsKey))?.[taskWindowsKey];if(Number.isInteger(saved?.[job.jobId]))taskWindows.set(job.jobId,saved[job.jobId]);}
  const windowId=taskWindows.get(job.jobId);
  if(windowId){try{await chrome.windows.update(windowId,{focused:true});return{success:true};}catch{taskWindows.delete(job.jobId);}}
  const opened=await chrome.windows.create({url:chrome.runtime.getURL('task.html')+'?jobId='+encodeURIComponent(job.jobId),type:'popup',width:700,height:640,focused:true});
  if(opened?.id){taskWindows.set(job.jobId,opened.id);await chrome.storage.session?.set({[taskWindowsKey]:Object.fromEntries([...taskWindows].slice(-128))});}return{success:true};
 }
 if((job.status==='cancelling'||job.narration?.status==='cancelling')&&['play','narrate','resume','pause','stop','seek'].includes(payload.action))return{success:false,error:'Tarefa em encerramento.'};
 if(payload.action==='play'||payload.action==='narrate'){
  if(job.type==='STT'&&!globalThis.GlobalJobs.TERMINAL.has(job.status))return{success:true,state:await globalJobs.get()};
  const audio=audioJob(job);
  if(!globalThis.GlobalJobs.TERMINAL.has(audio.status)){
   if(audio.status==='paused')return runGlobalJobCommand({...payload,action:'resume'},signal);
   if(await backgroundPlayback_1.hasDocument?.()){signal?.throwIfAborted();const result=await backgroundPlayback_1.send({operation:'CLAIM_PLAYBACK',jobId:job.jobId,playerId:job.playerId,requestId:audio.requestId,playbackIntent:payload.playbackIntent,...job.origin});if(!result?.success)return result||{success:false,error:'Player não confirmou o Play.'};}
   return{success:true,state:await globalJobs.get()};
  }
  if(!audio.text.trim())return{success:false,error:'Tarefa sem texto para narrar.'};
  const response=await handleExtensionMessage({type:'TTS_REQUEST',payload:{text:audio.text,agentId:job.agentId,playbackIntent:payload.playbackIntent,playback:{playerId:job.playerId,requestId:liveId('request'),...audio.progress}}},{url:chrome.runtime.getURL('popup.html')},job,signal);
  return{...response,state:await globalJobs.get()};
 }
 if(payload.action==='remove'){
  await globalJobs.remove(job.jobId);return{success:true,state:await globalJobs.get()};
 }
 if(payload.action==='seekWords')return{success:false,error:'O PCM Live não fornece timestamps por palavra. Navegação exata indisponível; nenhuma posição estimada foi aplicada.'};
 if(!['stop','pause','resume','set','seek'].includes(payload.action))return{success:false,error:'Controle inválido.'};
 const narrating=job.type==='STT'&&globalThis.GlobalJobs.TERMINAL.has(job.status);if(narrating)job={...audioJob(job),narration:true};
 if(payload.action==='pause'&&!['playing','connecting'].includes(job.status)||payload.action==='resume'&&job.status!=='paused')return{success:true,state:await globalJobs.get()};
 if(payload.action==='seek'&&(job.type!=='TTS'||!job.progress||!Number.isFinite(job.progress.availableEnd)||![-5,5].includes(payload.deltaSeconds)))return{success:false,error:'Buffer PCM navegável indisponível.'};
 if(job.type==='STT'){
  if(payload.action!=='stop')return{success:false,error:'Controle indisponível para ditado.'};
  if(globalThis.GlobalJobs.TERMINAL.has(job.status))return{success:true};
  if(['flushing','inserting'].includes(job.status))return{success:false,error:'Aguarde a etapa de finalização atual.'};
  if(['waiting','transforming'].includes(job.status)){if(await backgroundPlayback_1.hasDocument?.())await backgroundPlayback_1.send({operation:'STT_LIVE_CANCEL',jobId:job.jobId,playerId:job.playerId,...job.origin});else await sendToOrigin(job,{type:job.origin.tabId?'STT_LIVE_EVENT':'LIVE_OPTIONS_EVENT',payload:{jobId:job.jobId,event:'stt-cancelled'}}).catch(()=>{});await globalJobs.event({jobId:job.jobId,event:'stt-cancelled'});return{success:true};}
  await globalJobs.stopped(job.jobId);let response;try{response=await sendToOrigin(job,{type:'STT_GLOBAL_STOP',payload:{jobId:job.jobId}});}catch{}
  if(!response?.success){await globalJobs.originLost({...job.origin,jobId:job.jobId});if(await backgroundPlayback_1.hasDocument?.())await backgroundPlayback_1.send({operation:'STT_ORIGIN_LOST',jobId:job.jobId,playerId:job.playerId,...job.origin});}return{success:true};
 }
 let commandEventSeq,commandStatus;const operation={stop:'STOP',pause:'PAUSE',resume:'RESUME',set:'SET',seek:'SEEK_PCM'}[payload.action];
 if(!globalThis.GlobalJobs.TERMINAL.has(job.status)&&await backgroundPlayback_1.hasDocument?.()){
  signal?.throwIfAborted();
  const result=await backgroundPlayback_1.send({operation,jobId:job.jobId,playerId:job.playerId,requestId:job.requestId,...job.origin,...(payload.playbackIntent?{playbackIntent:payload.playbackIntent}:{}),...(payload.action==='seek'?{deltaSeconds:payload.deltaSeconds}:{}),...(Number.isFinite(payload.volume)?{volume:Math.max(0,Math.min(1,payload.volume))}:{}),...(Number.isFinite(payload.playbackRate)?{playbackRate:Math.max(.5,Math.min(2,payload.playbackRate))}:{})});
  if(!result?.success)return result||{success:false,error:'Player não confirmou o comando.'};
  commandEventSeq=result.eventSeq;commandStatus=result.status;
  if(['pause','resume','seek'].includes(payload.action)){
   const paused=payload.action==='seek'?job.status==='paused':payload.action==='pause';
   if(result.operation!==operation||commandStatus?.jobId!==job.jobId||commandStatus?.playerId!==job.playerId||commandStatus?.requestId!==job.requestId||!Number.isInteger(commandEventSeq)||!Number.isInteger(commandStatus.controlSeq)||commandStatus.controlSeq<1||commandStatus.controlSeq<=(job.progress.controlSeq||0)||commandStatus.paused!==paused||commandStatus.workletPaused!==paused||commandStatus.contextState!==(paused?'suspended':'running')||paused&&commandStatus.outputMuted!==true)return{success:false,error:'Player não confirmou o estado efetivo de áudio. Reabra o painel para consultar a tarefa.'};
  }
 }else if(['pause','resume','seek'].includes(payload.action))return{success:false,error:'Player indisponível. Reabra a tarefa para consultar o resultado.'};
 if(['pause','resume','seek'].includes(payload.action))await globalJobs.event({jobId:job.jobId,requestId:job.requestId,...(job.narration?{narration:true}:{}),event:payload.action==='seek'?'position':payload.action==='pause'?'pause':commandStatus.playbackState==='playing'?'play':'buffering',status:commandStatus,eventSeq:commandEventSeq});
 if(payload.action==='stop')await globalJobs.stopped(job.jobId,'flushing',job.narration===true);if(payload.action==='set')await globalJobs.settings(payload);return{success:true,state:await globalJobs.get()};
}
async function liveKeyOrders(models,keys){
 const adaptive=globalThis.TtsAdaptive,pairs=adaptive.catalog(models,keys),data=await adaptive.getStore().snapshot(pairs),ranked=adaptive.orderPairs(data,pairs);
 // A pontuação só ordena chaves dentro do modelo; nunca ordena modelos.
 return Object.fromEntries(models.map(model=>[model,ranked.filter(pair=>pair.model===model&&pair.eligible).map(pair=>pair.keyIndex-1)]));
}
exports.stopPlaybackForTab = async tabId => {
    for (const [key, controller] of playbackControllers) if (key.startsWith(`${tabId}:`)) {
        controller.abort('Aba fechada');
        playbackControllers.delete(key);
    }
    await backgroundPlayback_1.stopPlaybackForTab(tabId);
};
async function addHistoryLog(type, previewText, agentId, status = 'success', errorDetails) {
    try {
        const newItem = {
            id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            type,
            agentId: agentId || 'narrator',
            previewText: status === 'error' ? `❌ [ERRO] ${previewText}` : previewText,
            status,
            errorDetails,
        };
        await chromeStorageAdapter_1.chromeStorage.update('history', (historyData) => {
            if (historyData.enabled === false)
                return;
            return {
                ...historyData,
                recentItems: [newItem, ...(historyData.recentItems || [])].slice(0, historyData.maxEntries || 50),
            };
        });
    }
    catch (err) {
        console.warn('[HistoryLog] Falha ao gravar histórico:', err);
    }
}
async function handleExtensionMessage(message, sender, guiJob, signal) {
    try {
        switch (message.type) {
            case 'STT_SCHEDULER_LOAD':
            case 'STT_SCHEDULER_SAVE': {
                if(sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('offscreen.html'))return{success:false};
                const scheduler=globalThis.SttScheduler,key=scheduler.STORAGE_KEY;
                if(message.type==='STT_SCHEDULER_LOAD')return{success:true,state:scheduler.sanitize((await chrome.storage.session.get(key))[key])};
                await chrome.storage.session.set({[key]:scheduler.sanitize(message.payload)});return{success:true};
            }
            case 'STT_SCHEDULER_GET': {
                if(sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('options.html'))return{success:false};
                if(await backgroundPlayback_1.hasDocument())return backgroundPlayback_1.send({operation:'STT_SCHEDULER_SNAPSHOT'});
                const state=globalThis.SttScheduler.sanitize((await chrome.storage.session.get(globalThis.SttScheduler.STORAGE_KEY))[globalThis.SttScheduler.STORAGE_KEY]);
                return{success:true,diagnostics:{persisted:true,...globalThis.SttScheduler.summarize(state)}};
            }
            case 'HUD_GLOBAL_GET': {
                if(!allowedHudSender(sender))return{success:false,error:'Painel sem origem válida.'};
                await recoverGlobalJobs();
                const origin=senderOrigin(sender);
                if(origin.tabId){
                    const old=(await globalJobs.get()).jobs.filter(job=>job.origin.tabId===origin.tabId&&job.origin.frameId===origin.frameId&&job.origin.documentId&&origin.documentId&&job.origin.documentId!==origin.documentId);
                    for(const job of old)await handleOriginLost({...job.origin,captureGone:true});
                    globalViewers.set(`${origin.tabId}:${origin.frameId}:${origin.documentId||''}`,origin);
                    await persistViewers();
                }
                const state=await globalJobs.get();
                for(const job of state.jobs){
                    if(job.origin.tabId===origin.tabId&&job.origin.frameId===origin.frameId&&job.origin.documentId===origin.documentId)scheduleEditorDelivery(job);
                }
                return{success:true,state};
            }
            case 'HUD_GLOBAL_SET':
                if(!allowedHudSender(sender))return{success:false};
                return setGlobalVolume(message.payload);
            case 'HUD_GLOBAL_TOGGLE':
                if(!allowedHudSender(sender))return{success:false};
                await recoverGlobalJobs();return toggleGlobalPlayback(message.payload,signal);
            case 'HUD_GLOBAL_REOPEN':
                if(!allowedHudSender(sender))return{success:false};
                await recoverGlobalJobs();return{success:true,state:await globalJobs.reopen(message.payload?.jobId)};
            case 'HUD_GLOBAL_PIN':
                if(cleanPage(sender)!=='options.html')return{success:false,error:'Fixação disponível nas opções.'};
                await recoverGlobalJobs();return{success:true,state:await globalJobs.pin(message.payload?.jobId,message.payload?.pinned===true)};
            case 'STT_RECOVERY_ARCHIVED':
                if(sender.url!==chrome.runtime.getURL('offscreen.html'))return{success:false};
                await recoverGlobalJobs();return{success:true,state:await globalJobs.recoveryArchived(message.payload?.count)};
            case 'HUD_GLOBAL_UI_SET': {
                if(!allowedHudSender(sender))return{success:false};
                const payload=message.payload||{},origin=senderOrigin(sender);
                if(payload.scope==='tab'&&(!origin.tabId||origin.page))return{success:false,error:'HUD sem aba de origem.'};
                await recoverGlobalJobs();
                const state=payload.scope==='tab'
                    ?await globalJobs.ui({visible:payload.visible,minimized:payload.minimized},origin.tabId)
                    :await globalJobs.ui(payload);
                return{success:true,state};
            }
            case 'HUD_OPEN_OPTIONS':
                if(!allowedHudSender(sender))return{success:false};
                await chrome.runtime.openOptionsPage();
                return{success:true};
            case 'HUD_GLOBAL_CREATE': {
                if(!allowedHudSender(sender))return{success:false};
                await recoverGlobalJobs();
                const agents=await chromeStorageAdapter_1.chromeStorage.get('agents');
                const agent=globalThis.LiveConfig.resolveAgent(agents,null,defaultAgents_1.DEFAULT_AGENTS,defaultAgents_1.AGENT_ID_ALIASES);
                return{success:true,state:await globalJobs.draft({jobId:liveId('manual'),agentId:agent.metadata.id,origin:{tabId:0,frameId:0}})};
            }
            case 'HUD_HISTORY_CLEAR':
                if(cleanPage(sender)!=='options.html')return{success:false,error:'Limpeza disponível somente nas opções.'};
                await recoverGlobalJobs();return{success:true,state:await globalJobs.clearHistory(),history:await chromeStorageAdapter_1.chromeStorage.get('history')};
            case 'HUD_GLOBAL_COMMAND':
                if(!allowedHudSender(sender))return{success:false};
                await recoverGlobalJobs();return controlGlobalJob(message.payload||{},signal);
            case 'HUD_GLOBAL_PANIC':
                if(!allowedHudSender(sender))return{success:false,error:'Painel sem origem válida.'};
                return stopAllOperations();
            case 'HUD_CAPTURE_STATE':
                if(!allowedHudSender(sender))return{success:false};
                await recoverGlobalJobs();return{success:true,state:await globalJobs.capture(message.payload||{},senderOrigin(sender))};
            case 'HUD_INSERTION_RESULT':
                if(!allowedHudSender(sender))return{success:false};
                await recoverGlobalJobs();return{success:true,state:await globalJobs.insertion(message.payload||{},senderOrigin(sender))};
            case 'LIVE_OFFSCREEN_IDLE': {
                if(sender.url!==chrome.runtime.getURL('offscreen.html'))return{success:false};
                if(globalPanic||!chrome.offscreen?.closeDocument||backgroundPlayback_1.isStarting?.())return{success:true};
                const state=await globalJobs.get();
                if(state.jobs.some(job=>!globalThis.GlobalJobs.TERMINAL.has(audioJob(job).status)||!globalThis.GlobalJobs.TERMINAL.has(job.status)&&job.status!=='inserting'))return{success:true};
                const latest=await backgroundPlayback_1.send({operation:'GLOBAL_JOBS_SNAPSHOT'});
                if(!globalPanic&&latest?.success&&(latest.activeJobIds||latest.jobs?.filter(job=>!globalThis.GlobalJobs.TERMINAL.has(job.status))||[]).length===0&&!backgroundPlayback_1.isStarting?.())await chrome.offscreen.closeDocument();
                return{success:true};
            }
            case 'LIVE_STT_DIAGNOSTIC': {
                if(!sender.tab&&![chrome.runtime.getURL('options.html'),chrome.runtime.getURL('offscreen.html')].includes(sender.url?.split(/[?#]/)[0]))return{success:false};
                return globalThis.LiveSttDiagnostics.record(message.payload);
            }
            case 'LIVE_STT_DIAGNOSTICS_GET': {
                if(sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('options.html'))return{success:false};
                return{success:true,diagnostics:await globalThis.LiveSttDiagnostics.read()};
            }
            case 'LIVE_TTS_DIAGNOSTIC': {
                if (sender.url !== chrome.runtime.getURL('offscreen.html')) return { success: false };
                return globalThis.LiveTtsDiagnostics.record(message.payload);
            }
            case 'LIVE_TTS_DIAGNOSTICS_GET': {
                if (sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('options.html')) return { success: false };
                return { success: true, diagnostics: await globalThis.LiveTtsDiagnostics.read() };
            }
            case 'LIVE_OFFSCREEN_EVENT': {
                if (sender.url !== chrome.runtime.getURL('offscreen.html')) return { success: false };
                if(globalPanic)return{success:true,ignored:true};
                await recoverGlobalJobs();
                if(globalPanic)return{success:true,ignored:true};
                const {apiKeys,apiKey,systemInstruction,advancedJson,...event} = message.payload || {};
                const registered=event.jobId?await globalJobs.find({jobId:event.jobId}):null;
                if(globalPanic||event.jobId&&!registered)return{success:true,ignored:true};
                const eventJob=event.narration?registered?.narration:registered;
                if(['cancelling','cancelled'].includes(eventJob?.status))return{success:true,ignored:true};
                if(event.jobId){
                    const applied=await globalJobs.event(event);
                    if(registered.editorDelivery&&['stt-partial','stt-segment','stt-final'].includes(event.event)){
                        scheduleEditorDelivery(await globalJobs.find({jobId:event.jobId}));
                        return{success:true};
                    }
                    if(!applied.changed)return{success:true,duplicate:true};
                }
                if (event.event === 'ranking' && !['REQUEST','CANCELLED','INVALIDATED_CONTEXT','UNKNOWN'].includes(event.result)) {
                    const adaptive=globalThis.TtsAdaptive,config=globalThis.LiveConfig;
                    const api=await chromeStorageAdapter_1.chromeStorage.get('api');
                    const keys=(0,defaultSettings_1.getTtsApiKeys)(api),models=config.LIVE_TTS_MODELS,pairs=adaptive.catalog(models,keys);
                    const pair=pairs.find(item=>item.model===event.modelId&&item.keyIndex===event.keyIndex);
                    if(pair){const data=await adaptive.getStore().snapshot(pairs);const type=['SUCCESS','TRANSIENT','QUOTA','AUTH','MODEL','REQUEST','CANCELLED'].includes(event.result)?event.result:'TRANSIENT';await adaptive.getStore().record(pairs,pair,{type,durationMs:event.durationMs||0,label:type},data.epoch).catch(()=>{});}
                }
                if(event.narration)return{success:true};
                const destination=registered?.origin||event;
                if(registered?.originAvailable===false)return{success:true};
                if(destination.page==='options.html')void chrome.runtime.sendMessage({type:'LIVE_OPTIONS_EVENT',payload:event}).catch(()=>{});
                else if(destination.tabId)await chrome.tabs.sendMessage(destination.tabId,{type:event.operation==='STT_LIVE_START'||event.event?.startsWith('stt-')?'STT_LIVE_EVENT':'TTS_PLAYBACK_EVENT',payload:event},destination.documentId?{documentId:destination.documentId}:{frameId:destination.frameId||0}).catch(()=>{});
                else if(event.tabId===0)void chrome.runtime.sendMessage({type:'LIVE_OPTIONS_EVENT',payload:event}).catch(()=>{});
                return { success: true };
            }
            case 'TTS_RANKING_GET':
            case 'TTS_RANKING_RECORD':
            case 'TTS_RANKING_RESET':
            case 'TTS_ADAPTIVE_LOG': {
                if(sender.url!==chrome.runtime.getURL('options.html'))return {success:false,error:'Ranking disponível apenas nas opções.'};
                const adaptive=globalThis.TtsAdaptive,config=globalThis.TtsConfig,api=await chromeStorageAdapter_1.chromeStorage.get('api');
                const keys=(0,defaultSettings_1.getTtsApiKeys)(api),base=globalThis.LiveConfig.eligibleModels('tts'),preferred=message.payload?.preferredModel;
                const models=[...new Set([preferred,...base])].filter(model=>base.includes(model)),pairs=adaptive.catalog(models,keys),store=adaptive.getStore();
                if(message.type==='TTS_ADAPTIVE_LOG'){
                    const entry=message.payload?.entry||{};
                    void (0,diagnosticLogger_1.logDiagnostic)({level:entry.level==='error'?'error':'info',source:'TTS',operation:String(entry.operation||'TTS_ADAPTIVE').slice(0,60),modelId:base.includes(entry.modelId)?entry.modelId:undefined,durationMs:entry.durationMs,httpStatus:entry.httpStatus,message:config.redactTtsSecrets(String(entry.message||'').slice(0,4000),keys)});
                    return {success:true};
                }
                if(message.type==='TTS_RANKING_RESET')return {success:true,data:await store.reset(pairs)};
                if(message.type==='TTS_RANKING_RECORD'){
                    const raw=message.payload?.event||{},pair=pairs.find(pair=>adaptive.id(pair)===message.payload?.pairId);
                    if(!pair||!['SUCCESS','TRANSIENT','QUOTA','AUTH','MODEL','REQUEST','CANCELLED'].includes(raw.type))return {success:false,error:'Métrica TTS inválida.'};
                    if(raw.type==='SUCCESS'&&(!Number.isFinite(raw.durationMs)||raw.durationMs<0))return {success:false,error:'Latência inválida.'};
                    const event={type:raw.type,label:['TIMEOUT','DEMAND','TRANSIENT','QUOTA','AUTH','MODEL_NOT_FOUND','MODEL_PERMISSION'].includes(raw.label)?raw.label:raw.type,durationMs:Number.isFinite(raw.durationMs)?Math.max(0,raw.durationMs):0,headersMs:Number.isFinite(raw.headersMs)?Math.max(0,raw.headersMs):undefined,httpStatus:Number.isInteger(raw.httpStatus)?raw.httpStatus:null,retryAfterMs:Number.isFinite(raw.retryAfterMs)?Math.min(86400000,Math.max(0,raw.retryAfterMs)):undefined,keyWide:raw.keyWide===true};
                    return {success:true,...await store.record(pairs,pair,event,message.payload.epoch)};
                }
                const data=await store.snapshot(pairs);
                const ranked=adaptive.orderPairs(data,pairs);
                return {success:true,data,ranking:models.flatMap(model=>ranked.filter(pair=>pair.model===model))};
            }
            case 'TTS_DEBUG_STORE': {
                if(sender.url!==chrome.runtime.getURL('options.html'))return {success:false};
                const trace=message.payload;
                if(!trace?.id||!Array.isArray(trace.events)||trace.events.length>300)return {success:false};
                await chromeStorageAdapter_1.chromeStorage.update('logs',logs=>({...logs,ttsTraces:[trace,...(logs.ttsTraces||[])].slice(0,8)}));
                return {success:true};
            }
            case 'TTS_DIAGNOSTIC_STOP':
                if(sender.url===chrome.runtime.getURL('options.html'))diagnosticTtsController?.abort(new Error('Diagnóstico TTS cancelado.'));
                return {success:true};
            case 'TTS_DIAGNOSTIC_REQUEST': {
                if(sender.url!==chrome.runtime.getURL('options.html'))return {success:false,error:'Diagnóstico disponível apenas nas opções.'};
                return {success:false,error:'Diagnóstico unary desativado. Use o teste Gemini Live e os diagnósticos TTS persistidos.'};
                const config=__require("shared/utils/ttsConfiguration.ts"),trace=config.createTrace({...message.payload.trace,enabled:true,context:'background'});
                trace.mark('BACKGROUND_RECEIVED');
                diagnosticTtsController?.abort(new Error('Diagnóstico anterior cancelado.'));
                const controller=new AbortController();diagnosticTtsController=controller;
                try{
                    const api=await chromeStorageAdapter_1.chromeStorage.get('api');
                    const data=await geminiDirectClient_1.geminiDirectClient.synthesizeSpeech({...message.payload.request,text:'Olá mundo',trace:trace.packet(),diagnostic:{singleAttempt:true,keyIndex:message.payload.keyIndex}},api,controller.signal);
                    return {success:true,data,trace:trace.snapshot()};
                }catch(error){trace.mark('REQUEST_ERROR',{error:__require("shared/utils/ttsConfiguration.ts").redactTtsSecrets(error.message)});return {success:false,error:error.message,trace:trace.snapshot()};}
                finally{if(diagnosticTtsController===controller)diagnosticTtsController=null;}
            }
            case 'TTS_PLAYBACK_COMMAND': {
                await recoverGlobalJobs();
                const payload={...message.payload,...(['PLAY','RESUME'].includes(message.payload?.operation)?{playbackIntent:nextPlaybackIntent()}: {})},job=await globalJobs.find({...message.payload,...senderOrigin(sender)});
                if(job&&!await globalJobs.hasOrigin(job.jobId,senderOrigin(sender)))return{success:false,error:'Player pertence a outro documento.'};
                const result=await backgroundPlayback_1.handlePlaybackCommand({...payload,...(job?{jobId:job.jobId}: {})},sender,undefined,signal);
                if(job&&payload.operation==='STOP'&&result?.success)await globalJobs.stopped(job.jobId);
                return result;
            }
            case 'TTS_PLAYBACK_EVENT':
                return backgroundPlayback_1.forwardPlaybackEvent(message.payload, sender);
            case 'TTS_REQUEST': {
                const { text, agentId, voiceName, playback } = message.payload;
                const intent=message.payload.playbackIntent||nextPlaybackIntent();
                const timing=__require("shared/utils/ttsConfiguration.ts");
                const received=timing.performanceStamp();
                if (!text || !text.trim()) {
                    return { success: false, error: 'Texto não informado para síntese.' };
                }
                {
                    const settings=await chromeStorageAdapter_1.chromeStorage.getMany(['api','agents','models','audio']);
                    const keys=(0,defaultSettings_1.getTtsApiKeys)(settings.api);
                    if(!keys.length)return {success:false,error:'Chave de API Gemini não configurada. Abra as opções para configurar.'};
                    signal?.throwIfAborted();
                    await backgroundPlayback_1.reserveIntent?.(intent);
                    const agent=sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL('options.html')&&message.payload.previewAgent?message.payload.previewAgent:globalThis.LiveConfig.resolveAgent(settings.agents,agentId,defaultAgents_1.DEFAULT_AGENTS,defaultAgents_1.AGENT_ID_ALIASES);
                    const live=globalThis.LiveConfig.migrateAgent(agent,settings.models).live,liveOptions=globalThis.LiveConfig.buildAgentLiveOptions(agent,settings.audio,settings.models);
                    if(guiJob?.source==='lens'){liveOptions.literalSelection=true;liveOptions.selectionReadingInstruction=guiJob.lensMode==='interpret'?'':guiJob.lensReadingInstruction??globalThis.LiveConfig.lensInstructions(agent).lensReadingInstruction;liveOptions.systemInstruction=liveOptions.selectionReadingInstruction||globalThis.LiveConfig.LITERAL_NARRATION;}
                    const model=globalThis.LiveConfig.LIVE_TTS_MODELS.includes(live.preferredModel)?live.preferredModel:globalThis.LiveConfig.DEFAULTS.ttsModelId;
                    const models=globalThis.LiveConfig.modelChain('tts',model);
                    const keyOrderByModel=await liveKeyOrders(models,keys);
                    const route={playerId:playback?.playerId||liveId('player'),requestId:playback?.requestId||liveId('request')};
                    const payload={...route,...liveOptions,operation:'TTS_LIVE_START',jobId:guiJob?.jobId||liveId('job'),generation:Date.now(),playbackIntent:intent,...(guiJob?.type==='STT'?{narration:true}:{}),text,apiKeys:keys,models,keyOrderByModel,modelId:model,voiceName:voiceName||liveOptions.voiceName,volume:playback?.volume??liveOptions.volume,playbackRate:playback?.playbackRate??liveOptions.playbackRate};
                    await recoverGlobalJobs();
                    payload.globalVolume=(await globalJobs.get()).playback.volume;
                    if(guiJob)await globalJobs.preparePlayback(payload,signal);
                    else await globalJobs.start({...payload,type:'TTS',origin:senderOrigin(sender),agentId:agent.metadata.id,agentSnapshot:agent},undefined,signal);
                    const playbackSender=guiJob?.origin.tabId?{...sender,tab:{id:guiJob.origin.tabId},frameId:guiJob.origin.frameId,...(guiJob.origin.documentId?{documentId:guiJob.origin.documentId}:{})}:sender;
                    let result;try{result=await backgroundPlayback_1.handlePlaybackCommand(payload,playbackSender,undefined,signal);signal?.throwIfAborted();if(!result?.success)throw new Error(result?.error||'Falha no TTS Live.');}catch(error){if(signal?.aborted)throw error;if(payload.narration)await globalJobs.event({jobId:payload.jobId,requestId:payload.requestId,narration:true,event:'error',error:error.message});else await globalJobs.fail(payload.jobId,error.message);throw error;}
                    return {success:true,data:{jobId:payload.jobId,modelUsed:model,blocks:result.blocks,live:true}};
                }
                // REMOVIDO: Cancelamento automático de solicitações anteriores.
                // A fila FIFO é mantida no ttsController no content script.
                const currentController = new AbortController();
                activeTtsAbortController = currentController;
                const playbackKey = playback?.playerId && sender.tab?.id ? `${sender.tab.id}:${sender.frameId || 0}:${playback.playerId}` : null;
                if (playbackKey) playbackControllers.set(playbackKey, currentController);
                const releaseController = () => {
                    if (playbackKey && playbackControllers.get(playbackKey) === currentController) playbackControllers.delete(playbackKey);
                    if (activeTtsAbortController === currentController) activeTtsAbortController = null;
                };
                const settings = await chromeStorageAdapter_1.chromeStorage.getMany(['api', 'agents', 'models', 'audio']).catch(error => {
                    releaseController();
                    throw error;
                });
                const { api: apiSettings, agents: agentsSettings, models: modelsSettings, audio: audioSettings } = settings;
                const trace=timing.createTrace({...message.payload.trace,enabled:message.payload.trace?.enabled,context:'background',secrets:(0,defaultSettings_1.getTtsApiKeys)(apiSettings)});
                trace.mark('BACKGROUND_RECEIVED',{},received);
                trace.mark('SETTINGS_LOADED',{durationMs:timing.performanceStamp().now-received.now});
                if (!(0, defaultSettings_1.getTtsApiKeys)(apiSettings).length) {
                    const err = 'Chave de API Gemini não configurada. Abra as opções para configurar.';
                    void addHistoryLog('tts', text.substring(0, 60), agentId, 'error', err);
                    void (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'TTS',
                        operation: 'TTS_REQUEST',
                        message: err,
                    });
                    releaseController();
                    return { success: false, error: err };
                }
                const customAgent = agentsSettings.customAgents?.find((a) => a.metadata.id === agentId);
                const agent = customAgent || (0, defaultAgents_1.getCanonicalAgent)(agentId);
                const ttsModelId = agent.modelPreferences.ttsModelId || modelsSettings.ttsModelId;
                const voice = voiceName || agent.voice.preferredVoice || audioSettings.preferredVoice;
                const startDiagnostic = (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'info',
                    source: 'TTS',
                    operation: 'TTS_REQUEST_START',
                    message: `Iniciando síntese de ${text.length} caracteres via modelo ${ttsModelId}`,
                    modelId: ttsModelId,
                });
                try {
                    const startTime = Date.now();
                    const result = await geminiDirectClient_1.geminiDirectClient.synthesizeSpeech({
                        text,
                        voiceName: voice,
                        systemInstruction: agent.instructions.ttsSystemInstruction,
                        ttsConfig: agent.ttsConfig,
                        modelId: ttsModelId,
                        trace:trace.packet(),
                    }, apiSettings, currentController.signal);
                    if (playback?.playerId && sender.tab?.id && !currentController.signal.aborted) {
                        try {
                            result.playback = await backgroundPlayback_1.playGeneratedAudio(result, playback, sender, currentController.signal);
                        }
                        catch (error) { result.playbackError = error.message || String(error); }
                    }
                    const durationMs = Date.now() - startTime;
                    void addHistoryLog('tts', text.length > 80 ? text.substring(0, 80) + '...' : text, agentId, 'success');
                    void (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'info',
                        source: 'TTS',
                        operation: 'TTS_REQUEST_SUCCESS',
                        message: `Síntese concluída com sucesso via modelo ${result.modelUsed}`,
                        modelId: result.modelUsed,
                        durationMs,
                    });
                    return { success: true, data: result };
                }
                catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    void addHistoryLog('tts', text.substring(0, 60), agentId, 'error', errMsg);
                    void (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'TTS',
                        operation: 'TTS_REQUEST_ERROR',
                        message: `Falha na síntese TTS: ${errMsg}`,
                        errorDetails: err?.stack || String(err),
                    });
                    throw err;
                }
                finally {
                    void startDiagnostic;
                    if(trace.enabled)void chromeStorageAdapter_1.chromeStorage.update('logs',logs=>({...logs,ttsTraces:[trace.snapshot(),...(logs.ttsTraces||[]).filter(item=>item.id!==trace.id)].slice(0,8)}));
                    releaseController();
                }
            }
            case 'TTS_STOP': {
                const playerId = message.payload?.playerId;
                if (playerId && sender.tab?.id) {
                    const playbackKey = `${sender.tab.id}:${sender.frameId || 0}:${playerId}`;
                    playbackControllers.get(playbackKey)?.abort('Interrompido por TTS_STOP');
                    playbackControllers.delete(playbackKey);
                    const job=await globalJobs.find({playerId,...senderOrigin(sender)});
                    if(job&&!await globalJobs.hasOrigin(job.jobId,senderOrigin(sender)))return{success:false,error:'Player pertence a outro documento.'};
                    const result=await backgroundPlayback_1.handlePlaybackCommand({ playerId,operation:'STOP',...(job?{jobId:job.jobId,requestId:job.requestId}: {})},sender);
                    if(!result?.success)return result||{success:false,error:'Player não confirmou a parada.'};
                    if(job)await globalJobs.stopped(job.jobId);
                    return { success: true };
                }
                if (activeTtsAbortController) {
                    activeTtsAbortController.abort('Interrompido por TTS_STOP');
                    activeTtsAbortController = null;
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'info',
                        source: 'TTS',
                        operation: 'TTS_STOP',
                        message: 'Síntese interrompida explicitamente pelo usuário.',
                    });
                }
                return { success: true };
            }
            case 'STT_TRANSCRIBE_REQUEST':
                return {success:false,error:'STT unary descontinuado; use STT_LIVE_START por WebSocket.'};
            case 'STT_RECOGNITION_SAVE': {
                if(cleanPage(sender)!=='options.html')return{success:false,error:'Salve as preferências STT nas Opções.'};
                const changes=message.payload||{};
                let preferences;
                await chromeStorageAdapter_1.chromeStorage.update('sttRecognition', current=>{
                    preferences=globalThis.LiveConfig.normalizeSttRecognition(changes.restoreInstructions===true
                        ?{...current,instructions:globalThis.LiveConfig.STT_DEFAULT_INSTRUCTIONS}
                        :changes);
                    return preferences;
                });
                return {success:true,preferences};
            }
            case 'STT_CAPTURE_RESERVE': {
                if(!allowedHudSender(sender))return{success:false,error:'Origem do ditado indisponível.'};
                await recoverGlobalJobs();
                for(const job of (await globalJobs.get()).jobs.filter(job=>!job.originAvailable&&globalThis.GlobalJobs.holdsMicrophone(job)))await recoverSttCapture(job);
                const {jobId,agentId}=message.payload;
                try {
                    await globalJobs.start({jobId,agentId,type:'STT',origin:senderOrigin(sender)},'reserve-stt',signal);
                    if(sender.tab?.id&&message.payload.localVad===true){
                        void hybridRequested().then(enabled=>enabled&&backgroundPlayback_1.localVad({operation:'prepare'},()=>!globalPanic&&!signal?.aborted)).catch(()=>{});
                    }
                } catch(error) {
                    if(error.code!=='STT_CAPTURE_BUSY')throw error;
                    return {success:false,code:error.code,error:error.message,otherTab:error.otherTab};
                }
                return {success:true};
            }
            case 'STT_LIVE_START': {
                const settings=await chromeStorageAdapter_1.chromeStorage.getMany(['api','agents','models','audio','sttRecognition']);
                const keys=(0,defaultSettings_1.getTtsApiKeys)(settings.api);if(!keys.length)return{success:false,error:'Chave de API Gemini não configurada.'};
                const agent=(sender.url?.split(/[?#]/)[0]===chrome.runtime.getURL('options.html')&&message.payload.previewAgent)||globalThis.LiveConfig.resolveAgent(settings.agents,message.payload.agentId,defaultAgents_1.DEFAULT_AGENTS,defaultAgents_1.AGENT_ID_ALIASES);
                const migrated=globalThis.LiveConfig.migrateAgent(agent,settings.models),stt=migrated.live.stt||{};
                const instruction=agent.instructions?.sttFormattingInstruction||'';
                const transform=message.payload.realtime!==true&&(stt.transform===true||(stt.transform!==false&&agent.metadata?.id!=='narrator'&&Boolean(instruction.trim())));
                const modelId=globalThis.LiveConfig.LIVE_STT_MODELS.includes(stt.preferredModel)?stt.preferredModel:globalThis.LiveConfig.DEFAULTS.sttModelId;
                const models=globalThis.LiveConfig.modelChain('stt',modelId);
                await recoverGlobalJobs();
                const sttRecognition=globalThis.LiveConfig.normalizeSttRecognition(settings.sttRecognition);
                const payload={...message.payload,schedulerPolicy:globalThis.SttScheduler.policy(settings.api?.sttScheduler),agentId:agent.metadata.id,operation:'STT_LIVE_START',apiKeys:keys,modelId,models,sttRecognition,thinkingLevel:stt.thinkingLevel,thinkingBudget:stt.thinkingBudget,vad:stt.vad,transformInstruction:transform?instruction:null,transformModels:globalThis.LiveConfig.modelChain('tts',migrated.live.preferredModel),voiceName:migrated.live.voiceName,playerId:message.payload.playerId||message.payload.jobId};
                await globalJobs.start({...payload,type:'STT',origin:senderOrigin(sender),agentId:agent.metadata.id,agentSnapshot:agent},'start-stt',signal);
                try{const result=await backgroundPlayback_1.handlePlaybackCommand(payload,sender,async()=>{
                    const job=await globalJobs.find({jobId:payload.jobId});
                    return job?.originAvailable&&globalThis.GlobalJobs.holdsMicrophone(job)&&job.status==='connecting';
                },signal);signal?.throwIfAborted();if(!result?.success)throw new Error(result?.error||'Falha no STT Live.');
                    if((sender.tab?.id&&payload.editorDelivery===true||cleanPage(sender)==='options.html')&&
                        await hybridRequested().catch(()=>false)){
                        signal?.throwIfAborted();
                        vadOwner={id:payload.jobId,generation:payload.generation,documentId:sender.documentId,tabId:sender.tab?.id,frameId:sender.frameId,page:sender.tab?undefined:cleanPage(sender)};
                        return {...result,localVad:true};
                    }
                    return result;
                }catch(error){if(signal?.aborted)throw error;await globalJobs.fail(payload.jobId,error.message);throw error;}
            }
            case 'STT_LOCAL_VAD': {
                const payload=message.payload;
                if(!sameVadOwner(payload,sender))return{ok:false};
                const {operation,seq,pcm,final,rollback,clientSentAt,packets}=payload;
                const backgroundAt=performance.timeOrigin+performance.now();
                if(!['open','analyze','close','preserve'].includes(operation))return{ok:false};
                if(operation==='close')vadOwner=undefined;
                try{return await backgroundPlayback_1.localVad({operation,id:payload.jobId,seq,pcm,final,rollback,clientSentAt,backgroundAt,packets,
                    ...(operation==='open'?{origin:{tabId:sender.tab?.id,documentId:sender.documentId,frameId:sender.frameId,generation:payload.generation,page:sender.tab?undefined:cleanPage(sender)}}:{})});}
                catch{return{ok:false};}
            }
            case 'STT_LIVE_AUDIO':
            case 'STT_LIVE_STOP':
            case 'STT_LIVE_CANCEL': {
                await recoverGlobalJobs();
                if(!await globalJobs.hasOrigin(message.payload?.jobId,senderOrigin(sender)))return{success:false,error:'Ditado pertence a outro documento ou foi encerrado.'};
                const job=await globalJobs.find({jobId:message.payload?.jobId});
                if(['cancelling','cancelled'].includes(job?.status))return{success:message.type==='STT_LIVE_CANCEL',error:'Ditado encerrado.'};
                const result=await backgroundPlayback_1.handlePlaybackCommand({...message.payload,operation:message.type},sender);
                if(message.type==='STT_LIVE_STOP'&&result?.success)await globalJobs.stopped(message.payload.jobId,'waiting');
                if(message.type==='STT_LIVE_CANCEL'&&result?.success)await globalJobs.event({jobId:message.payload.jobId,event:'stt-cancelled'});
                return result;
            }
            case 'TEST_API_KEY': {
                const isValid = await geminiDirectClient_1.geminiDirectClient.testApiKey(message.payload.apiKey);
                return { success: isValid, error: isValid ? undefined : 'Chave inválida ou sem permissão de acesso.' };
            }
            case 'DISCOVER_MODELS': {
                const apiSettings = await chromeStorageAdapter_1.chromeStorage.get('api');
                if (!apiSettings.apiKey) {
                    return { success: false, error: 'Chave de API não informada.' };
                }
                const discovered = await geminiDirectClient_1.geminiDirectClient.discoverAvailableModels(apiSettings.apiKey);
                await chromeStorageAdapter_1.chromeStorage.setPartial('models', {
                    discoveredModels: discovered,
                    discoveryCacheTimestamp: Date.now(),
                });
                return { success: true, data: discovered };
            }
            case 'LENS_ANALYZE_REQUEST': {
                const tabId = sender.tab?.id;
                if (!tabId) {
                    return { success: false, error: 'Aba não identificada para captura visual.' };
                }
                const mode=message.payload?.mode??'literal';
                if(!['literal','interpret'].includes(mode))return{success:false,error:'Modo Lens inválido.'};
                await recoverGlobalJobs();
                const controller=new AbortController();
                const cancel=()=>controller.abort(signal.reason);
                signal?.addEventListener('abort',cancel,{once:true});
                if(signal?.aborted)cancel();
                const jobId=liveId('lens');
                lensOperations.set(jobId,controller);
                let selectionJob;
                try {
                    selectionJob=await globalJobs.start({jobId,type:'TTS',source:'lens',lensMode:mode,origin:senderOrigin(sender),agentId:message.payload.agentId,collapsed:false},undefined,controller.signal);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'info',
                        source: 'LENS',
                        operation: 'LENS_REQUEST_START',
                        message: `Iniciando captura e análise visual Lens para aba ${tabId}`,
                    });
                    const startTime = Date.now();
                    let resolvedAgentId=message.payload.agentId,readingInstruction;
                    const description = await (0, tabCaptureHandler_1.captureAndAnalyzeTab)(tabId, message.payload.instruction, message.payload.agentId, message.payload.rect, sender.url,(id,reading)=>{resolvedAgentId=id;readingInstruction=reading;},controller.signal,mode);
                    controller.signal.throwIfAborted();
                    const extractedText=String(description).trim();
                    selectionJob=await globalJobs.selectionResult({jobId,text:extractedText,agentId:resolvedAgentId,lensReadingInstruction:readingInstruction,warning:extractedText?'':globalThis.LiveConfig.SELECTION_NO_TEXT},controller.signal);
                    const durationMs = Date.now() - startTime;
                    await addHistoryLog('vision', description.length > 80 ? description.substring(0, 80) + '...' : description, resolvedAgentId, 'success');
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'info',
                        source: 'LENS',
                        operation: 'LENS_REQUEST_SUCCESS',
                        message: `Análise Lens concluída com sucesso (${description.length} chars)`,
                        durationMs,
                    });
                    controller.signal.throwIfAborted();
                    if(extractedText){
                        const result=await handleExtensionMessage({type:'TTS_REQUEST',payload:{text:extractedText,agentId:resolvedAgentId,playback:{playerId:selectionJob.playerId,requestId:liveId('request')}}},sender,selectionJob,controller.signal);
                        if(!result.success)throw new Error(result.error||'Falha ao iniciar narração da seleção.');
                    }
                    return { success: true, data: extractedText, jobId };
                }
                catch (err) {
                    if(controller.signal.aborted){if(selectionJob)await globalJobs.stopped(jobId);return{success:false,cancelled:true,jobId};}
                    if(selectionJob)await globalJobs.fail(jobId,err?.message||String(err));
                    if (err?.code === 'LENS_CAPTURE_PERMISSION_REQUIRED') {
                        try {
                            await chrome.tabs.create({ url: chrome.runtime.getURL('lens-permission.html') + '?tabId=' + tabId, ...(Number.isInteger(sender.tab.windowId) ? { windowId: sender.tab.windowId } : {}) });
                            return { success: false, code: err.code, error: 'Autorize a captura na página Lens aberta pela extensão. Depois volte à aba e selecione a área novamente.' };
                        } catch {
                            return { success: false, code: err.code, error: 'Não foi possível abrir a autorização Lens. Tente novamente pelo botão Lens.' };
                        }
                    }
                    if (err?.code === 'LENS_TAB_CHANGED') return { success: false, code: err.code, error: err.message };
                    const errMsg = err instanceof Error ? err.message : String(err);
                    await addHistoryLog('vision', 'Análise de Seleção de Tela', message.payload.agentId, 'error', errMsg);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'LENS',
                        operation: 'LENS_REQUEST_ERROR',
                        message: `Falha na análise Lens: ${errMsg}`,
                        errorDetails: err?.stack || String(err),
                    });
                    throw err;
                }
                finally {
                    lensOperations.delete(jobId);
                    signal?.removeEventListener('abort',cancel);
                }
            }
            case 'TOGGLE_HUD': {
                if (sender.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, message);
                }
                return { success: true };
            }
            default:
                return { success: false, error: `Tipo de mensagem desconhecido: ${message.type}` };
        }
    }
    catch (err) {
        const messageStr = err instanceof Error ? err.message : String(err);
        console.error('[MessageRouter] Erro no processamento da mensagem:', messageStr);
        return { success: false, error: messageStr,...(signal?.aborted?{cancelled:true}:{}) };
    }
}

},
"shared/constants/defaultAgents.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fonte Única de Verdade (SSOT) para os 8 Agentes Padrão Reais do Sistema.
 * Preserva integralmente os 8 agentes originais com seus IDs legítimos,
 * nomes, descrições, vozes e instruções por modalidade (TTS, STT, Lens).
 * Modelos preferidos alinhados com o catálogo oficial congelado da API Gemini.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_ID_ALIASES = exports.DEFAULT_AGENT_ID = exports.DEFAULT_AGENTS = void 0;
exports.resolveCanonicalAgentId = resolveCanonicalAgentId;
exports.getCanonicalAgent = getCanonicalAgent;
exports.DEFAULT_AGENTS = [
    {
        metadata: {
            id: 'narrator',
            name: 'Narrador Fluido',
            description: 'Leitura expressiva, humana e fluida com pontuação natural e ritmo dinâmico.',
            category: 'productivity',
            icon: 'Volume2',
            color: '#3b82f6',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Puck',
            pitchMultiplier: 1.0,
            rateMultiplier: 1.0,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é um narrador profissional e dinâmico. Leia o texto de forma expressiva, clara e envolvente. ' +
                'Ignore metadados da página, URLs, numeração de rodapé ou botões de navegação. ' +
                'Respeite pausas e respirações humanas.',
            sttFormattingInstruction: 'Transcreva a fala capturada com máxima fidelidade. Insira pontuação gramaticalmente correta, ' +
                'elimine vícios de linguagem e hesitações (como "hã", "é", "tipo") e formate parágrafos coerentes.',
            lensInspectionInstruction: 'Descreva o conteúdo visual principal da página ou elemento focado em uma narração concisa e informativa.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'translator',
            name: 'Tradutor Simultâneo',
            description: 'Traduz instantaneamente o texto para o idioma de destino e o narra com pronúncia nativa.',
            category: 'translation',
            icon: 'Languages',
            color: '#10b981',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Charon',
            pitchMultiplier: 1.0,
            rateMultiplier: 0.95,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é um tradutor simultâneo profissional. Detecte o idioma de origem do texto. ' +
                'Se o texto for em língua estrangeira, traduza-o para o português com fluência e precisão idiomática e leia diretamente a tradução. ' +
                'Se for em português, traduza e leia em inglês com pronúncia límpida.',
            sttFormattingInstruction: 'Transcreva o áudio traduzindo o conteúdo falado diretamente para o idioma de destino selecionado, ' +
                'mantendo fidelidade semântica e vocabulário técnico apropriado.',
            lensInspectionInstruction: 'Extraia e traduza todos os textos visíveis na área capturada da tela.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'summarizer',
            name: 'Resumidor Executivo',
            description: 'Sintetiza artigos e páginas longas em tópicos verbais densos e objetivos.',
            category: 'productivity',
            icon: 'Sparkles',
            color: '#8b5cf6',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Fenrir',
            pitchMultiplier: 1.0,
            rateMultiplier: 1.05,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é um analista executivo. Em vez de ler todo o texto prolixo, produza uma síntese ' +
                'dos pontos centrais em 3 a 5 pontos-chave e leia essa síntese com tom confiante, conciso e profissional.',
            sttFormattingInstruction: 'Transcreva o áudio capturado e formate como uma lista ordenada de tópicos executivos e planos de ação.',
            lensInspectionInstruction: 'Sintetize os dados de gráficos, tabelas ou formulários da tela em um resumo auditivo de alto nível.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'editor',
            name: 'Revisor Gramatical & Ditado',
            description: 'Ideal para ditar respostas, emails e artigos; corrige gramática e eleva o estilo.',
            category: 'editorial',
            icon: 'FileText',
            color: '#f59e0b',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Kore',
            pitchMultiplier: 1.0,
            rateMultiplier: 1.0,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Analise a redação do texto fornecido. Leia o texto corrigindo sutilmente eventuais deslizes gramaticais ' +
                'ou inadequações de concordância para que a audição soe culta e agradável.',
            sttFormattingInstruction: 'Você é um copidesque e redator sênior. Ao ditar, transforme a fala espontânea em um texto escrito ' +
                'perfeito, polido, com vocabulário refinado e estrutura de frases impecável, pronto para envio profissional.',
            lensInspectionInstruction: 'Inspecione a redação do documento ou página visível e aponte sugestões de revisão gramatical.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'explainer',
            name: 'Professor Didático',
            description: 'Explica conceitos complexos de forma simples e didática com analogias claras.',
            category: 'productivity',
            icon: 'GraduationCap',
            color: '#06b6d4',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Aoede',
            pitchMultiplier: 1.0,
            rateMultiplier: 0.95,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é um educador didático usando o método Feynman. Explique o texto selecionado ' +
                'de forma compreensível para qualquer público, decompondo jargões técnicos em analogias do cotidiano.',
            sttFormattingInstruction: 'Transcreva a explicação falada estruturando-a com títulos conceituais, tópicos numerados e conclusões claras.',
            lensInspectionInstruction: 'Explique visualmente o diagrama, infográfico ou conceito apresentado na tela capturada.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'developer',
            name: 'Assistente de Código & Dev',
            description: 'Leitura técnica de código-fonte, erros e sintaxe; transcrição com termos de programação.',
            category: 'productivity',
            icon: 'Code',
            color: '#14b8a6',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Fenrir',
            pitchMultiplier: 1.0,
            rateMultiplier: 1.05,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é um engenheiro de software sênior. Ao ler código ou stacktraces, verbalize a lógica, ' +
                'parâmetros e estruturas de controle de forma inteligível sem soletrar caracteres desnecessários.',
            sttFormattingInstruction: 'Transcreva o áudio preservando convenções de programação (camelCase, snake_case), ' +
                'palavras-chave de linguagem e blocos de código com indentação correta.',
            lensInspectionInstruction: 'Analise o código, erro no console ou interface de desenvolvimento na tela e proponha a solução técnica.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'podcast',
            name: 'Estilo Podcast',
            description: 'Tom conversacional, dinâmico e envolvente como um apresentador de podcast.',
            category: 'productivity',
            icon: 'Mic',
            color: '#f43f5e',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Puck',
            pitchMultiplier: 1.0,
            rateMultiplier: 1.05,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é o apresentador de um podcast popular. Transforme o texto em uma narrativa engajante, ' +
                'com entonação vibrante, humor sutil e ritmo estimulante que prenda a atenção do ouvinte.',
            sttFormattingInstruction: 'Transcreva a fala mantendo a autenticidade e entusiasmo da conversa, estruturando diálogos dinâmicos.',
            lensInspectionInstruction: 'Comente os elementos visuais da página como se estivesse apresentando uma transmissão ao vivo com seus ouvintes.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
    {
        metadata: {
            id: 'accessibility',
            name: 'Leitor de Acessibilidade',
            description: 'Audiodescrição detalhada e leitura com contexto estrutural (tabelas, títulos e links).',
            category: 'accessibility',
            icon: 'Eye',
            color: '#ec4899',
            isBuiltIn: true,
            version: 1,
        },
        voice: {
            preferredVoice: 'Aoede',
            pitchMultiplier: 1.0,
            rateMultiplier: 0.9,
            volume: 1.0,
        },
        instructions: {
            ttsSystemInstruction: 'Você é um especialista em acessibilidade e audiodescrição. Leia o texto indicando claramente ' +
                'hierarquias de títulos, legendas de imagens e contexto para usuários com deficiência visual.',
            sttFormattingInstruction: 'Transcreva a voz preservando pontuação fonética e marcações semânticas com precisão absoluta.',
            lensInspectionInstruction: 'Realize audiodescrição minuciosa dos elementos visuais, layout, botões e imagens da tela ativa.',
        },
        modelPreferences: {
            ttsModelId: 'gemini-3.8-flash-lite-tts',
            sttModelId: 'gemini-3.5-flash-lite',
        },
    },
];
exports.DEFAULT_AGENT_ID = 'narrator';
exports.AGENT_ID_ALIASES = {
    'narrador': 'narrator',
    'tradutor': 'translator',
    'resumidor': 'summarizer',
    'revisor': 'editor',
    'explicador': 'explainer',
    'didatico': 'explainer',
    'programador': 'developer',
    'desenvolvedor': 'developer',
    'conversacional': 'podcast',
    'acessibilidade': 'accessibility',
    'narrator-fluid': 'narrator',
    'translator-polyglot': 'translator',
    'summarizer-exec': 'summarizer',
    'editor-grammar': 'editor',
    'accessibility-lens': 'accessibility',
};
function resolveCanonicalAgentId(rawId) {
    if (!rawId || typeof rawId !== 'string')
        return exports.DEFAULT_AGENT_ID;
    const trimmed = rawId.trim();
    if (exports.AGENT_ID_ALIASES[trimmed]) {
        return exports.AGENT_ID_ALIASES[trimmed];
    }
    const found = exports.DEFAULT_AGENTS.find(a => a.metadata.id === trimmed);
    return found ? found.metadata.id : exports.DEFAULT_AGENT_ID;
}
function getCanonicalAgent(idOrAlias) {
    const canonicalId = resolveCanonicalAgentId(idOrAlias);
    return exports.DEFAULT_AGENTS.find(a => a.metadata.id === canonicalId) || exports.DEFAULT_AGENTS[0];
}

},
"extension/src/services/storage/chromeStorageAdapter.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Implementação de IStorageService sobre chrome.storage.local.
 * Garante que a extensão consuma estritamente o AppStorageSchema unificado.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.chromeStorage = exports.ChromeStorageAdapter = void 0;
const defaultSettings_1 = __require("shared/constants/defaultSettings.ts");
const LEGACY_STORAGE_KEYS = {
    api: ['apiKey'],
    agents: ['activeAgentId', 'customAgents'],
    audio: ['audioSettings'],
    models: ['modelSettings'],
    ui: ['uiPreferences'],
};
class ChromeStorageAdapter {
    pendingUpdates = new Map();
    static instance;
    static getInstance() {
        if (!ChromeStorageAdapter.instance) {
            ChromeStorageAdapter.instance = new ChromeStorageAdapter();
        }
        return ChromeStorageAdapter.instance;
    }
    async get(namespace) {
        const settings = await this.getMany([namespace]);
        return settings[namespace];
    }
    async getMany(namespaces) {
        const keys = [...new Set(namespaces.flatMap((namespace) => [namespace, ...(LEGACY_STORAGE_KEYS[namespace] || [])]))];
        return new Promise((resolve, reject) => {
            // Inclui os aliases legados sem copiar histórico/logs em leituras de configuração.
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                const migrated = (0, defaultSettings_1.migrateLegacyStorage)(result || {});
                resolve(Object.fromEntries(namespaces.map((namespace) => [namespace, migrated[namespace]])));
            });
        });
    }
    async getAll() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (result) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                const state = (0, defaultSettings_1.migrateLegacyStorage)(result || {});
                resolve(state);
            });
        });
    }
    async set(namespace, value) {
        const normalizedValue = (0, defaultSettings_1.normalizeStorageNamespace)(namespace, value);
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [namespace]: normalizedValue }, () => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve();
            });
        });
    }
    async update(namespace, updater) {
        const previous = this.pendingUpdates.get(namespace) || Promise.resolve();
        const operation = previous.catch(() => {}).then(async () => {
            const current = await this.get(namespace);
            const updated = updater(current);
            if (updated !== undefined) {
                await this.set(namespace, updated);
            }
        });
        this.pendingUpdates.set(namespace, operation);
        const release = () => {
            if (this.pendingUpdates.get(namespace) === operation) {
                this.pendingUpdates.delete(namespace);
            }
        };
        operation.then(release, release);
        return operation;
    }
    async setPartial(namespace, partial) {
        return this.update(namespace, (current) => typeof current === 'object' && current !== null
            ? { ...current, ...partial }
            : partial);
    }
    async setMultiple(partial) {
        const normalized = {};
        for (const [key, value] of Object.entries(partial)) {
            if (value !== undefined) {
                const namespace = key;
                normalized[namespace] = (0, defaultSettings_1.normalizeStorageNamespace)(namespace, value);
            }
        }
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(normalized, () => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve();
            });
        });
    }
    async reset() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.clear(() => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                chrome.storage.local.set(defaultSettings_1.DEFAULT_STORAGE_STATE, () => {
                    if (chrome.runtime.lastError)
                        return reject(chrome.runtime.lastError);
                    resolve();
                });
            });
        });
    }
    subscribe(namespace, callback) {
        const listener = (changes, areaName) => {
            if (areaName === 'local' && changes[namespace]) {
                callback((0, defaultSettings_1.normalizeStorageNamespace)(namespace, changes[namespace].newValue), changes[namespace].oldValue === undefined
                    ? undefined
                    : (0, defaultSettings_1.normalizeStorageNamespace)(namespace, changes[namespace].oldValue));
            }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => {
            chrome.storage.onChanged.removeListener(listener);
        };
    }
}
exports.ChromeStorageAdapter = ChromeStorageAdapter;
exports.chromeStorage = ChromeStorageAdapter.getInstance();

},
"shared/constants/defaultSettings.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Configurações e Preferências Padrão do Sistema (Single Source of Truth).
 * Organizado estritamente pelos namespaces: api, agents, audio, models, ui, history.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_APP_STORAGE = exports.DEFAULT_STORAGE_STATE = exports.DEFAULT_LOGS_SETTINGS = exports.DEFAULT_HISTORY_SETTINGS = exports.DEFAULT_UI_PREFERENCES = exports.DEFAULT_MODELS_SETTINGS = exports.DEFAULT_AUDIO_SETTINGS = exports.DEFAULT_AGENTS_SETTINGS = exports.DEFAULT_API_SETTINGS = void 0;
exports.migrateLegacyStorage = migrateLegacyStorage;
exports.normalizeStorageNamespace = normalizeStorageNamespace;
exports.parseApiKeys = parseApiKeys;
exports.getTtsApiKeys = getTtsApiKeys;
const defaultAgents_1 = __require("shared/constants/defaultAgents.ts");
const modelsCatalog_1 = __require("shared/constants/modelsCatalog.ts");
exports.DEFAULT_API_SETTINGS = {
    apiKey: '',
    apiKeys: [],
    timeoutMs: 30000,
};
exports.DEFAULT_AGENTS_SETTINGS = {
    activeAgentId: defaultAgents_1.DEFAULT_AGENT_ID,
    customAgents: [],
    favoriteAgentIds: ['narrator', 'translator', 'summarizer'],
};
exports.DEFAULT_AUDIO_SETTINGS = {
    sampleRate: 24000, // Padrão LINEAR16 24kHz Gemini TTS
    preferredVoice: 'Puck',
    autoPlay: true,
    volume: 1.0,
    pitchMultiplier: 1.0,
    rateMultiplier: 1.0,
};
exports.DEFAULT_MODELS_SETTINGS = {
    ttsModelId: (0, modelsCatalog_1.getFallbackModelForTask)('tts'), // gemini-3.8-flash-lite-tts
    sttModelId: (0, modelsCatalog_1.getFallbackModelForTask)('stt'), // gemini-3.5-flash-lite
    visionModelId: (0, modelsCatalog_1.getFallbackModelForTask)('vision'), // gemini-3.5-flash-lite
    generalModelId: (0, modelsCatalog_1.getFallbackModelForTask)('general'), // gemini-3.5-flash-lite
    discoveredModels: [],
    discoveryCacheTimestamp: undefined,
};
exports.DEFAULT_UI_PREFERENCES = {
    hudPosition: { x: 24, y: 24 },
    theme: 'system',
    autoInject: true,
    dictationInsertion: 'final',
    shortcuts: {
        toggleHud: 'Alt+Shift+H',
        readSelection: 'Ctrl+B',
        startDictation: 'Ctrl+Shift+Space',
        togglePause: 'Pause',
        lensSelection: 'Ctrl+Shift+L',
    },
};
exports.DEFAULT_HISTORY_SETTINGS = {
    enabled: true,
    maxEntries: 50,
    retentionDays: 365,
    recentItems: [],
};
exports.DEFAULT_LOGS_SETTINGS = {
    enabled: true,
    maxEntries: 100,
    items: [],
};
exports.DEFAULT_STORAGE_STATE = {
    api: exports.DEFAULT_API_SETTINGS,
    agents: exports.DEFAULT_AGENTS_SETTINGS,
    audio: exports.DEFAULT_AUDIO_SETTINGS,
    models: exports.DEFAULT_MODELS_SETTINGS,
    ui: exports.DEFAULT_UI_PREFERENCES,
    sttRecognition: globalThis.LiveConfig.normalizeSttRecognition(),
    history: exports.DEFAULT_HISTORY_SETTINGS,
    logs: exports.DEFAULT_LOGS_SETTINGS,
};
exports.DEFAULT_APP_STORAGE = exports.DEFAULT_STORAGE_STATE;
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function parseApiKeys(value) {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(';') : [];
    return [...new Set(entries.filter((key) => typeof key === 'string').map((key) => key.trim()).filter(Boolean))];
}
function getTtsApiKeys(settings) {
    if (!isRecord(settings))
        return parseApiKeys(settings);
    const keys = parseApiKeys(settings.apiKeys);
    return keys.length ? keys : parseApiKeys(settings.apiKey);
}
function cloneDefaultStorage() {
    return {
        api: { ...exports.DEFAULT_API_SETTINGS, apiKeys: [] },
        agents: {
            ...exports.DEFAULT_AGENTS_SETTINGS,
            customAgents: [...exports.DEFAULT_AGENTS_SETTINGS.customAgents],
            favoriteAgentIds: [...exports.DEFAULT_AGENTS_SETTINGS.favoriteAgentIds],
        },
        audio: { ...exports.DEFAULT_AUDIO_SETTINGS },
        models: {
            ...exports.DEFAULT_MODELS_SETTINGS,
            discoveredModels: [...exports.DEFAULT_MODELS_SETTINGS.discoveredModels],
        },
        ui: {
            ...exports.DEFAULT_UI_PREFERENCES,
            hudPosition: { ...exports.DEFAULT_UI_PREFERENCES.hudPosition },
            shortcuts: { ...exports.DEFAULT_UI_PREFERENCES.shortcuts },
        },
        sttRecognition: globalThis.LiveConfig.normalizeSttRecognition(),
        history: {
            ...exports.DEFAULT_HISTORY_SETTINGS,
            recentItems: [...exports.DEFAULT_HISTORY_SETTINGS.recentItems],
        },
        logs: {
            ...exports.DEFAULT_LOGS_SETTINGS,
            items: [...exports.DEFAULT_LOGS_SETTINGS.items],
        },
    };
}
function mergeApiSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    return {
        ...base,
        ...(typeof candidate.apiKey === 'string' ? { apiKey: candidate.apiKey } : {}),
        ...(Array.isArray(candidate.apiKeys) || typeof candidate.apiKeys === 'string'
            ? { apiKeys: parseApiKeys(candidate.apiKeys) }
            : {}),
        ...(typeof candidate.customEndpoint === 'string' ? { customEndpoint: candidate.customEndpoint } : {}),
        ...(typeof candidate.timeoutMs === 'number' && Number.isFinite(candidate.timeoutMs) && candidate.timeoutMs > 0
            ? { timeoutMs: candidate.timeoutMs }
            : {}),
    };
}
function mergeAgentsSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    return {
        ...base,
        ...(typeof candidate.activeAgentId === 'string' ? { activeAgentId: candidate.activeAgentId } : {}),
        ...(Array.isArray(candidate.customAgents) ? { customAgents: candidate.customAgents } : {}),
        ...(Array.isArray(candidate.favoriteAgentIds)
            ? { favoriteAgentIds: candidate.favoriteAgentIds.filter((id) => typeof id === 'string') }
            : {}),
    };
}
function mergeAudioSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    const next = { ...base };
    if (typeof candidate.sampleRate === 'number' && Number.isFinite(candidate.sampleRate) && candidate.sampleRate >= 8000 && candidate.sampleRate <= 96000)
        next.sampleRate = candidate.sampleRate;
    if (typeof candidate.preferredVoice === 'string')
        next.preferredVoice = candidate.preferredVoice;
    if (typeof candidate.autoPlay === 'boolean')
        next.autoPlay = candidate.autoPlay;
    if (typeof candidate.volume === 'number' && Number.isFinite(candidate.volume) && candidate.volume >= 0 && candidate.volume <= 1)
        next.volume = candidate.volume;
    if (typeof candidate.pitchMultiplier === 'number' && Number.isFinite(candidate.pitchMultiplier) && candidate.pitchMultiplier >= 0.2 && candidate.pitchMultiplier <= 3)
        next.pitchMultiplier = candidate.pitchMultiplier;
    if (typeof candidate.rateMultiplier === 'number' && Number.isFinite(candidate.rateMultiplier) && candidate.rateMultiplier >= 0.2 && candidate.rateMultiplier <= 3)
        next.rateMultiplier = candidate.rateMultiplier;
    return next;
}
function mergeModelsSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    const next = { ...base };
    if (typeof candidate.ttsModelId === 'string')
        next.ttsModelId = candidate.ttsModelId;
    if (typeof candidate.sttModelId === 'string')
        next.sttModelId = candidate.sttModelId;
    if (typeof candidate.visionModelId === 'string')
        next.visionModelId = candidate.visionModelId;
    if (typeof candidate.generalModelId === 'string')
        next.generalModelId = candidate.generalModelId;
    if (Array.isArray(candidate.discoveredModels))
        next.discoveredModels = candidate.discoveredModels;
    if (typeof candidate.discoveryCacheTimestamp === 'number' && Number.isFinite(candidate.discoveryCacheTimestamp)) {
        next.discoveryCacheTimestamp = candidate.discoveryCacheTimestamp;
    }
    return next;
}
function mergeUiSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    const next = {
        ...base,
        hudPosition: { ...base.hudPosition },
        shortcuts: { ...base.shortcuts },
    };
    if (candidate.theme === 'dark' || candidate.theme === 'light' || candidate.theme === 'system')
        next.theme = candidate.theme;
    if (typeof candidate.autoInject === 'boolean')
        next.autoInject = candidate.autoInject;
    if (candidate.dictationInsertion === 'realtime' || candidate.dictationInsertion === 'final')
        next.dictationInsertion = candidate.dictationInsertion;
    if (isRecord(candidate.hudPosition)) {
        if (typeof candidate.hudPosition.x === 'number' && Number.isFinite(candidate.hudPosition.x))
            next.hudPosition.x = candidate.hudPosition.x;
        if (typeof candidate.hudPosition.y === 'number' && Number.isFinite(candidate.hudPosition.y))
            next.hudPosition.y = candidate.hudPosition.y;
    }
    if (isRecord(candidate.shortcuts)) {
        for (const key of Object.keys(next.shortcuts)) {
            const value = candidate.shortcuts[key];
            if (typeof value === 'string')
                next.shortcuts[key] = value;
        }
    }
    return next;
}
function mergeHistorySettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    return {
        ...base,
        ...(typeof candidate.enabled === 'boolean' ? { enabled: candidate.enabled } : {}),
        ...(typeof candidate.maxEntries === 'number' && Number.isFinite(candidate.maxEntries) && candidate.maxEntries > 0
            ? { maxEntries: Math.floor(candidate.maxEntries) }
            : {}),
        ...(Number.isFinite(candidate.retentionDays)?{retentionDays:Math.max(1,Math.min(3650,Math.floor(candidate.retentionDays)))}:{}),
        ...(Array.isArray(candidate.recentItems) ? { recentItems: candidate.recentItems } : {}),
    };
}
function mergeLogsSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    return {
        ...base,
        ...(Array.isArray(candidate.ttsTraces)?{ttsTraces:candidate.ttsTraces.slice(0,8)}:{}),
        ...(typeof candidate.enabled === 'boolean' ? { enabled: candidate.enabled } : {}),
        ...(typeof candidate.maxEntries === 'number' && Number.isFinite(candidate.maxEntries) && candidate.maxEntries > 0
            ? { maxEntries: Math.floor(candidate.maxEntries) }
            : {}),
        ...(Array.isArray(candidate.items) ? { items: candidate.items } : {}),
    };
}
/**
 * Função pura de migração para transformar dados brutos e desestruturados
 * de versões antigas do storage na estrutura namespaced canônica.
 */
function migrateLegacyStorage(raw) {
    const state = cloneDefaultStorage();
    if (!raw || typeof raw !== 'object')
        return state;
    // Migração do namespace api
    if (typeof raw.apiKey === 'string')
        state.api.apiKey = raw.apiKey;
    state.api = mergeApiSettings(state.api, raw.api);
    // Migração do namespace agents
    if (typeof raw.activeAgentId === 'string')
        state.agents.activeAgentId = raw.activeAgentId;
    if (Array.isArray(raw.customAgents))
        state.agents.customAgents = raw.customAgents;
    state.agents = mergeAgentsSettings(state.agents, raw.agents);
    // Migração do namespace audio
    state.audio = mergeAudioSettings(state.audio, isRecord(raw.audioSettings) ? raw.audioSettings : raw.audio);
    // Migração do namespace models
    state.models = mergeModelsSettings(state.models, isRecord(raw.modelSettings) ? raw.modelSettings : raw.models);
    // Migração do namespace ui
    state.ui = mergeUiSettings(state.ui, isRecord(raw.uiPreferences) ? raw.uiPreferences : raw.ui);
    // A escolha STT atual não pode ser substituída por um alias de UI antigo.
    if (isRecord(raw.ui) && (raw.ui.dictationInsertion === 'realtime' || raw.ui.dictationInsertion === 'final'))
        state.ui.dictationInsertion = raw.ui.dictationInsertion;
    if (raw.sttRecognition!==undefined)
        state.sttRecognition = globalThis.LiveConfig.normalizeSttRecognition(raw.sttRecognition);
    // Migração do namespace history
    state.history = mergeHistorySettings(state.history, raw.history);
    // Migração do namespace logs
    state.logs = mergeLogsSettings(state.logs, raw.logs);
    return state;
}
/**
 * Normaliza um namespace isolado usando exatamente as mesmas regras da migração.
 * Isso evita que leituras diretas de storage burlem a validação/migração global.
 */
function normalizeStorageNamespace(namespace, value) {
    return migrateLegacyStorage({ [namespace]: value })[namespace];
}

},
"shared/constants/modelsCatalog.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Catálogo Canônico de Modelos Gemini CONGELADO DEFINITIVAMENTE.
 *
 * WHITELIST ESTREITA E IMUTÁVEL:
 *
 * 1. TTS (EXATAMENTE 4 MODELOS NESSA ORDEM ESTREITA):
 *    1. gemini-3.8-flash-lite-tts (Gemini 3.8 Flash-Lite TTS)
 *    2. gemini-3.8-flash-tts (Gemini 3.8 Flash TTS)
 *    3. gemini-3.1-flash-tts-preview (Gemini 3.1 Flash TTS)
 *    4. gemini-2.5-flash-preview-tts (Gemini 2.5 Flash TTS)
 *
 * 2. STT UNARY / GERAL / VISÃO (EXATAMENTE 2 MODELOS NESSA ORDEM ESTREITA):
 *    1. gemini-3.5-flash-lite (Gemini 3.5 Flash-Lite)
 *    2. gemini-3.1-flash-lite (Gemini 3.1 Flash-Lite)
 *
 * 3. TESTE DA CHAVE DE API:
 *    - gemini-3.1-flash-lite
 *
 * REGRAS DE INTEGRIDADE:
 * - TTS e STT são 100% independentes.
 * - sttModelId !== ttsModelId.
 * - Modelos TTS NUNCA entram no seletor STT.
 * - Modelos STT / Flash-Lite NUNCA entram no seletor TTS.
 * - Modelos Flash-Lite operam STT Unary via generateContent (áudio multimodal). Não possuem suporte STT Live WebSocket.
 * - Maps Grounding é uma capability e NUNCA um modelo.
 * - Descoberta dinâmica por models.list() NUNCA adiciona modelos fora desta whitelist.
 *
 * MOTOR DE FALLBACK (Zero-Retry):
 * - TTS: exatamente 3.8-flash-lite-tts -> 3.8-flash-tts -> 3.1-flash-tts-preview -> 2.5-flash-preview-tts.
 * - STT / Geral / Vision: exatamente 3.5-flash-lite -> 3.1-flash-lite.
 * - Auth Test: exatamente 3.1-flash-lite -> 3.5-flash-lite.
 * - Cada modelo é chamado no máximo uma vez por operação.
 * - Qualquer erro encerra a tentativa daquele modelo e avança imediatamente ao próximo sem retry ou backoff.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_FALLBACK_CHAINS = exports.MODEL_ALIASES = exports.LEGACY_MODEL_MIGRATIONS = exports.KNOWN_MODELS = exports.DEFAULT_GENERAL_MODEL = exports.DEFAULT_VISION_MODEL = exports.DEFAULT_STT_MODEL = exports.DEFAULT_TTS_MODEL = exports.AUTH_TEST_INITIAL_MODEL = exports.STT_LIVE_MODELS_WHITELIST = exports.FLASH_LITE_MODELS_WHITELIST = exports.VISION_MODELS_WHITELIST = exports.GENERAL_MODELS_WHITELIST = exports.STT_UNARY_MODELS_WHITELIST = exports.STT_GENERAL_MODELS_WHITELIST = exports.TTS_MODELS_WHITELIST = void 0;
exports.getFallbackChainForTask = getFallbackChainForTask;
exports.getFallbackModelForTask = getFallbackModelForTask;
exports.normalizeModelId = normalizeModelId;
exports.validateAgentModelIntegrity = validateAgentModelIntegrity;
exports.executeWithZeroRetryFallback = executeWithZeroRetryFallback;
/**
 * 1. WHITELIST OFICIAL E ORDEM EXATA DOS MODELOS TTS (EXATAMENTE 4)
 */
exports.TTS_MODELS_WHITELIST = [
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-preview-tts',
];
/**
 * 2. WHITELIST OFICIAL E ORDEM EXATA DE STT UNARY, VISÃO E MODELOS GERAIS (EXATAMENTE 2)
 */
exports.STT_GENERAL_MODELS_WHITELIST = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
];
// Whitelists tipadas e modeladas por tarefa específica
exports.STT_UNARY_MODELS_WHITELIST = exports.STT_GENERAL_MODELS_WHITELIST;
exports.GENERAL_MODELS_WHITELIST = exports.STT_GENERAL_MODELS_WHITELIST;
exports.VISION_MODELS_WHITELIST = exports.STT_GENERAL_MODELS_WHITELIST;
exports.FLASH_LITE_MODELS_WHITELIST = exports.STT_GENERAL_MODELS_WHITELIST;
// STT Live: Os modelos Flash-Lite do catálogo congelado não suportam protocolo WebSocket Live.
// Declarado explicitamente vazio para evitar falsa atribuição semântica.
exports.STT_LIVE_MODELS_WHITELIST = [];
/**
 * 3. MODELO PADRÃO PARA TESTE DE CHAVE E CONECTIVIDADE
 */
exports.AUTH_TEST_INITIAL_MODEL = 'gemini-3.1-flash-lite';
/**
 * 4. MODELOS DEFAULT
 */
exports.DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
exports.DEFAULT_STT_MODEL = 'gemini-3.5-flash-lite';
exports.DEFAULT_VISION_MODEL = 'gemini-3.5-flash-lite';
exports.DEFAULT_GENERAL_MODEL = 'gemini-3.5-flash-lite';
/**
 * Catálogo Canônico com descritores reais dos modelos da whitelist congelada.
 */
exports.KNOWN_MODELS = {
    // =========================================================================
    // MODELOS TTS (Ordem Exata 1 a 4)
    // =========================================================================
    'gemini-3.8-flash-lite-tts': {
        id: 'gemini-3.8-flash-lite-tts',
        displayName: 'Gemini 3.8 Flash-Lite TTS',
        description: 'Modelo de áudio de alta eficiência e ultrabaixa latência para leitura e TTS padrão.',
        category: 'tts',
        tier: 'lite',
        inputModalities: { text: true, image: false, audio: false, video: false },
        outputModalities: { text: false, audio: true, image: false },
        tasks: {
            general: { supported: false },
            vision: { supported: false },
            stt: { supported: false },
            tts: { supported: true, method: 'generateContent' },
            live: { supported: false },
        },
        capabilities: { mapsGrounding: false },
        apiMethods: ['generateContent'],
        streaming: false,
        deprecated: false,
        availability: 'ga',
        recommendedMaxTokens: 4096,
    },
    'gemini-3.8-flash-tts': {
        id: 'gemini-3.8-flash-tts',
        displayName: 'Gemini 3.8 Flash TTS',
        description: 'Modelo flagship de síntese vocal com suporte a entonações expressivas e diálogos.',
        category: 'tts',
        tier: 'flash',
        inputModalities: { text: true, image: false, audio: false, video: false },
        outputModalities: { text: false, audio: true, image: false },
        tasks: {
            general: { supported: false },
            vision: { supported: false },
            stt: { supported: false },
            tts: { supported: true, method: 'generateContent' },
            live: { supported: false },
        },
        capabilities: { mapsGrounding: false },
        apiMethods: ['generateContent'],
        streaming: false,
        deprecated: false,
        availability: 'ga',
        recommendedMaxTokens: 8192,
    },
    'gemini-3.1-flash-tts-preview': {
        id: 'gemini-3.1-flash-tts-preview',
        displayName: 'Gemini 3.1 Flash TTS',
        description: 'Modelo TTS balanceado para leitura natural em preview.',
        category: 'tts',
        tier: 'preview',
        inputModalities: { text: true, image: false, audio: false, video: false },
        outputModalities: { text: false, audio: true, image: false },
        tasks: {
            general: { supported: false },
            vision: { supported: false },
            stt: { supported: false },
            tts: { supported: true, method: 'generateContent' },
            live: { supported: false },
        },
        capabilities: { mapsGrounding: false },
        apiMethods: ['generateContent'],
        streaming: false,
        deprecated: false,
        availability: 'preview',
        recommendedMaxTokens: 4096,
    },
    'gemini-2.5-flash-preview-tts': {
        id: 'gemini-2.5-flash-preview-tts',
        displayName: 'Gemini 2.5 Flash TTS',
        description: 'Modelo de síntese vocal com compatibilidade para endpoints 2.5.',
        category: 'tts',
        tier: 'preview',
        inputModalities: { text: true, image: false, audio: false, video: false },
        outputModalities: { text: false, audio: true, image: false },
        tasks: {
            general: { supported: false },
            vision: { supported: false },
            stt: { supported: false },
            tts: { supported: true, method: 'generateContent' },
            live: { supported: false },
        },
        capabilities: { mapsGrounding: false },
        apiMethods: ['generateContent'],
        streaming: false,
        deprecated: false,
        availability: 'preview',
        recommendedMaxTokens: 4096,
    },
    // =========================================================================
    // STT UNARY / MODELOS GERAIS FLASH-LITE (Ordem Exata 1 a 2)
    // =========================================================================
    'gemini-3.5-flash-lite': {
        id: 'gemini-3.5-flash-lite',
        displayName: 'Gemini 3.5 Flash-Lite',
        description: 'Modelo Flash-Lite intermediário para transcrição STT Unary via generateContent, visão multimodal e tarefas gerais.',
        category: 'general_multimodal',
        tier: 'lite',
        inputModalities: { text: true, image: true, audio: true, video: true },
        outputModalities: { text: true, audio: false, image: false },
        tasks: {
            general: { supported: true },
            vision: { supported: true, method: 'generateContent' },
            stt: { supported: true, method: 'generateContent' },
            tts: { supported: false },
            live: { supported: false }, // Flash-Lite não é STT Live WebSocket
        },
        capabilities: { mapsGrounding: true },
        apiMethods: ['generateContent', 'generateContentStream'],
        streaming: true,
        deprecated: false,
        availability: 'ga',
        recommendedMaxTokens: 8192,
    },
    'gemini-3.1-flash-lite': {
        id: 'gemini-3.1-flash-lite',
        displayName: 'Gemini 3.1 Flash-Lite',
        description: 'Modelo leve de ultrabaixa latência para autenticação, testes de conectividade, STT Unary e visão.',
        category: 'general_multimodal',
        tier: 'lite',
        inputModalities: { text: true, image: true, audio: true, video: true },
        outputModalities: { text: true, audio: false, image: false },
        tasks: {
            general: { supported: true },
            vision: { supported: true, method: 'generateContent' },
            stt: { supported: true, method: 'generateContent' },
            tts: { supported: false },
            live: { supported: false }, // Flash-Lite não é STT Live WebSocket
        },
        capabilities: { mapsGrounding: true },
        apiMethods: ['generateContent', 'generateContentStream'],
        streaming: true,
        deprecated: false,
        availability: 'ga',
        recommendedMaxTokens: 8192,
    },
};
exports.LEGACY_MODEL_MIGRATIONS = {
    // TTS Legados
    'gemini-tts': { targetModelId: 'gemini-3.8-flash-lite-tts', category: 'tts', reason: 'Alias genérico de TTS' },
    'gemini-3.8-tts': { targetModelId: 'gemini-3.8-flash-tts', category: 'tts', reason: 'Alias curto de TTS 3.8' },
    'gemini-3.1-tts': { targetModelId: 'gemini-3.1-flash-tts-preview', category: 'tts', reason: 'Alias preview de TTS 3.1' },
    'gemini-2.5-tts': { targetModelId: 'gemini-2.5-flash-preview-tts', category: 'tts', reason: 'Alias legado de TTS 2.5' },
    // STT Legados (Modelos especializados anteriores migrados para a família Flash-Lite congelada)
    'gemini-3.5-transcribe': { targetModelId: 'gemini-3.5-flash-lite', category: 'stt', reason: 'Modelo especializado STT legado migrado para Flash-Lite' },
    'gemini-3.5-transcribe-live': { targetModelId: 'gemini-3.5-flash-lite', category: 'stt', reason: 'Modelo especializado Live legado migrado para Flash-Lite Unary' },
    'gemini-transcribe': { targetModelId: 'gemini-3.5-flash-lite', category: 'stt', reason: 'Alias genérico legado de STT' },
    'gemini-stt': { targetModelId: 'gemini-3.5-flash-lite', category: 'stt', reason: 'Alias genérico legado de STT' },
    // Modelos Gerais / Pro Legados
    'gemini-3.8-flash': { targetModelId: 'gemini-3.5-flash-lite', category: 'general', reason: 'Modelo geral 3.8 migrado para Flash-Lite congelado' },
    'gemini-3.1-pro-preview': { targetModelId: 'gemini-3.1-flash-lite', category: 'general', reason: 'Modelo Pro experimental migrado para Flash-Lite congelado' },
    'gemini-2.5-flash': { targetModelId: 'gemini-3.5-flash-lite', category: 'general', reason: 'Modelo geral 2.5 migrado para Flash-Lite congelado' },
    'gemini-flash': { targetModelId: 'gemini-3.5-flash-lite', category: 'general', reason: 'Alias genérico flash' },
};
/**
 * Mapa direto para resolução rápida de aliases.
 */
exports.MODEL_ALIASES = Object.fromEntries(Object.entries(exports.LEGACY_MODEL_MIGRATIONS).map(([key, val]) => [key, val.targetModelId]));
/**
 * CADEIAS DE FALLBACK EXATAS CONGELADAS (Zero-Retry):
 * - TTS: gemini-3.8-flash-lite-tts -> gemini-3.8-flash-tts -> gemini-3.1-flash-tts-preview -> gemini-2.5-flash-preview-tts
 * - STT / STT Unary / Geral / Vision: gemini-3.5-flash-lite -> gemini-3.1-flash-lite
 * - Auth Test: gemini-3.1-flash-lite -> gemini-3.5-flash-lite
 */
exports.TASK_FALLBACK_CHAINS = {
    tts: exports.TTS_MODELS_WHITELIST,
    stt: exports.STT_UNARY_MODELS_WHITELIST,
    stt_unary: exports.STT_UNARY_MODELS_WHITELIST,
    vision: exports.VISION_MODELS_WHITELIST,
    general: exports.GENERAL_MODELS_WHITELIST,
    auth_test: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
};
/**
 * Retorna a cadeia estrita de modelos para uma tarefa.
 */
function getFallbackChainForTask(task) {
    return exports.TASK_FALLBACK_CHAINS[task] || exports.STT_GENERAL_MODELS_WHITELIST;
}
/**
 * Retorna o primeiro modelo garantido para uma tarefa.
 */
function getFallbackModelForTask(task) {
    return getFallbackChainForTask(task)[0];
}
/**
 * Normaliza um ID de modelo para a whitelist estrita baseado na tarefa pretendida.
 */
function normalizeModelId(rawModelId, task = 'general') {
    if (!rawModelId || typeof rawModelId !== 'string') {
        return getFallbackModelForTask(task);
    }
    const trimmed = rawModelId.trim();
    const chain = getFallbackChainForTask(task);
    if (chain.includes(trimmed)) {
        return trimmed;
    }
    // Verifica mapeamento explícito de migração legado
    if (exports.LEGACY_MODEL_MIGRATIONS[trimmed]) {
        const migration = exports.LEGACY_MODEL_MIGRATIONS[trimmed];
        if (chain.includes(migration.targetModelId)) {
            return migration.targetModelId;
        }
    }
    return getFallbackModelForTask(task);
}
/**
 * Validação de integridade:
 * - sttModelId !== ttsModelId
 * - Modelos TTS só na whitelist TTS
 * - Modelos STT só na whitelist STT/Geral
 */
function validateAgentModelIntegrity(modelPreferences) {
    const tts = modelPreferences?.ttsModelId || exports.DEFAULT_TTS_MODEL;
    const stt = modelPreferences?.sttModelId || exports.DEFAULT_STT_MODEL;
    if (tts === stt) {
        return {
            valid: false,
            error: `Violação de integridade: o modelo STT (${stt}) nunca pode ser igual ao modelo TTS (${tts}).`,
        };
    }
    if (!exports.TTS_MODELS_WHITELIST.includes(tts)) {
        return {
            valid: false,
            error: `Modelo TTS "${tts}" inválido. Permitidos: ${exports.TTS_MODELS_WHITELIST.join(', ')}`,
        };
    }
    if (!exports.STT_GENERAL_MODELS_WHITELIST.includes(stt)) {
        return {
            valid: false,
            error: `Modelo STT "${stt}" inválido. Permitidos: ${exports.STT_GENERAL_MODELS_WHITELIST.join(', ')}`,
        };
    }
    return { valid: true };
}
async function executeWithZeroRetryFallback(task, preferredModelId, executor) {
    if (['tts','stt','stt_unary'].includes(task)) throw new Error('Áudio convencional desativado. TTS/STT exigem Gemini Live WebSocket.');
    const baseChain = getFallbackChainForTask(task);
    const candidateModels = [];
    if (preferredModelId && baseChain.includes(preferredModelId)) {
        candidateModels.push(preferredModelId);
    }
    for (const m of baseChain) {
        if (!candidateModels.includes(m)) {
            candidateModels.push(m);
        }
    }
    const triedModels = [];
    const errors = [];
    for (const modelId of candidateModels) {
        if (triedModels.includes(modelId)) {
            continue;
        }
        triedModels.push(modelId);
        try {
            const result = await executor(modelId);
            return {
                result,
                usedModelId: modelId,
                attempts: triedModels,
            };
        }
        catch (err) {
            if(err?.cancelled||task === "tts" && err?.ttsFatal)throw err;
            const errorMsg = err instanceof Error ? err.message : String(err);
            errors.push({ modelId, error: errorMsg });
        }
    }
    const formattedErrors = errors
        .map((e, idx) => `[${idx + 1}] Modelo "${e.modelId}": ${e.error}`)
        .join(' | ');
    throw new Error(`Falha total na cadeia de fallback para "${task}". Todos os ${triedModels.length} modelos falharam sem retry. Detalhes: ${formattedErrors}`);
}

},
"shared/utils/ttsConfiguration.ts":function(module,exports,__require){
// O mesmo módulo carregado pelo editor; nenhum construtor duplicado no bundle.
module.exports = globalThis.TtsConfig;
},
"extension/src/services/lensPool.ts":function(module,exports,__require){
"use strict";
// Compartilha apenas as políticas puras e o storage serializado do ranking existente.
// Reservas e saúde Lens ficam isoladas dos transportes STT/TTS.
const adaptive=globalThis.TtsAdaptive;
const LIMITS=Object.freeze({perSelection:2,global:4,keys:9,modelTimeoutMs:15000});
const STORAGE_KEY='lensAdaptiveData';
function create(services={}){
    const now=services.now||Date.now,timer=services.setTimeout||setTimeout,clear=services.clearTimeout||clearTimeout;
    const storage=services.storage;
    const store=adaptive.createStore(storage?{
        async get(){const data=await storage.get(STORAGE_KEY);return{[adaptive.STORAGE_KEY]:data?.[STORAGE_KEY]};},
        async set(data){await storage.set({[STORAGE_KEY]:data[adaptive.STORAGE_KEY]});}
    }:undefined);
    const rounds=new Set(),busyAccounts=new Set(),cooldowns=new Map(),authCooldowns=new Map();
    let active=0,pumping=false,again=false;
    function emit(round,entry){try{Promise.resolve(round.log({source:'LENS',...entry})).catch(()=>{});}catch{}}
    function record(round,attempt,event){
        const updated=adaptive.updatePair(attempt.pair,event,now());
        cooldowns.set(adaptive.id(attempt.pair),updated.cooldownUntil);
        if(event.type==='AUTH'&&event.keyWide)authCooldowns.set(attempt.pair.keyId,updated.cooldownUntil);
        void store.record(round.pairs,attempt.pair,event,round.epoch,now()).catch(()=>{
            emit(round,{level:'error',operation:'LENS_POOL_STORAGE_ERROR',message:'Falha ao persistir saúde do pool Lens.'});
        });
    }
    function release(round,attempt){
        if(!round.running.delete(attempt))return;
        active--;busyAccounts.delete(attempt.pair.keyId);
    }
    function finish(round,error,value,winner){
        if(round.done)return;
        round.done=true;clear(round.timer);round.signal?.removeEventListener('abort',round.cancel);rounds.delete(round);
        for(const attempt of [...round.running]){
            release(round,attempt);
            if(attempt!==winner)attempt.controller.abort(error||Object.assign(new Error('Outra conta venceu a seleção.'),{cancelled:true}));
        }
        error?round.reject(error):round.resolve(value);
        schedule();
    }
    function launch(round,pair){
        const controller=new AbortController(),attempt={pair,controller,started:now(),settled:false};
        active++;busyAccounts.add(pair.keyId);round.tried.add(adaptive.id(pair));round.running.add(attempt);
        emit(round,{level:'info',operation:'LENS_RACE_ATTEMPT',modelId:pair.model,message:`${pair.model} · key#${pair.keyIndex} · concorrência Lens ${active}/${LIMITS.global}`});
        let abort;
        const cancelled=new Promise((_,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});});
        const request=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return round.execute(pair,controller.signal);});
        void Promise.race([request,cancelled]).then(value=>{
            if(round.done)return;
            if(typeof value!=='string'||!value.trim()||value.trim().startsWith('❌'))throw new Error('Resposta de visão sem texto válido.');
            attempt.settled=true;
            record(round,attempt,{type:'SUCCESS',httpStatus:200,durationMs:now()-attempt.started});
            emit(round,{level:'info',operation:'LENS_RACE_WINNER',modelId:pair.model,message:`${pair.model} · key#${pair.keyIndex} venceu; demais respostas descartadas.`});
            finish(round,null,value.trim(),attempt);
        }).catch(error=>{
            if(round.done)return;
            attempt.settled=true;
            const decision=adaptive.classify(error),safe=globalThis.TtsConfig.redactTtsSecrets(error?.message||String(error),round.keys);
            record(round,attempt,{...decision,httpStatus:error?.httpStatus,durationMs:now()-attempt.started,retryAfterMs:adaptive.retryAfterMs(error?.retryAfter)});
            round.errors.push(`key#${pair.keyIndex}: ${safe}`);
            emit(round,{level:'error',operation:'LENS_RACE_ERROR',modelId:pair.model,httpStatus:error?.httpStatus,message:`key#${pair.keyIndex} · ${decision.label} · ${safe}`});
        }).finally(()=>{
            controller.signal.removeEventListener('abort',abort);
            release(round,attempt);schedule();
        });
    }
    function schedule(){
        again=true;if(pumping)return;pumping=true;
        void (async()=>{
            while(again){
                again=false;
                for(const round of rounds){
                    if(round.done)continue;
                    let data;
                    try{data=await store.snapshot(round.pairs);}catch{finish(round,new Error('Não foi possível consultar os limites do pool Lens.'));continue;}
                    if(round.done)continue;
                    round.epoch=data.epoch;
                    const candidates=adaptive.orderPairs(data,round.pairs,now()).filter(pair=>pair.model===round.model&&pair.eligible&&!round.tried.has(adaptive.id(pair))&&!(cooldowns.get(adaptive.id(pair))>now())&&!(authCooldowns.get(pair.keyId)>now()));
                    while(round.running.size<LIMITS.perSelection&&active<LIMITS.global){
                        const pair=candidates.find(pair=>!round.tried.has(adaptive.id(pair))&&!busyAccounts.has(pair.keyId));
                        if(!pair)break;
                        launch(round,pair);
                    }
                    if(!round.running.size&&!candidates.length)finish(round,new Error(round.errors.length?round.errors.join(' | '):'Nenhuma conta Lens elegível; cooldown ou pares já utilizados.'));
                }
            }
        })().finally(()=>{pumping=false;if(again)schedule();});
    }
    function run({model,models,keys,signal,execute,log=()=>{}}){
        const unique=[...new Set(keys)].slice(0,LIMITS.keys);
        return new Promise((resolve,reject)=>{
            const round={model,keys:unique,pairs:adaptive.catalog(models,unique),signal,execute,log,resolve,reject,tried:new Set(),running:new Set(),errors:[],done:false};
            round.cancel=()=>finish(round,Object.assign(new Error(signal.reason?.message||'Seleção cancelada.'),{cancelled:true}));
            if(signal?.aborted){round.cancel();return;}
            signal?.addEventListener('abort',round.cancel,{once:true});
            round.timer=timer(()=>{
                const error=new Error(`Timeout de 15s excedido no modelo ${model}.`);
                for(const attempt of round.running)if(!attempt.settled)record(round,attempt,{type:'TRANSIENT',label:'TIMEOUT',durationMs:now()-attempt.started});
                finish(round,error);
            },LIMITS.modelTimeoutMs);
            rounds.add(round);schedule();
        });
    }
    return{run};
}
let shared;
exports.LIMITS=LIMITS;exports.STORAGE_KEY=STORAGE_KEY;exports.create=create;
exports.run=options=>(shared||(shared=create({storage:globalThis.chrome?.storage?.session}))).run(options);
},
"extension/src/services/geminiDirectClient.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cliente Direct REST para a API Gemini (Google AI Studio) na Extensão Chrome.
 * Utiliza fetch nativo com fallback por chave e depois por modelo no TTS,
 * e timeouts por modalidade com AbortController.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiDirectClient = exports.GeminiDirectClient = void 0;
const modelsCatalog_1 = __require("shared/constants/modelsCatalog.ts");
const defaultSettings_1 = __require("shared/constants/defaultSettings.ts");
const pcmWav_1 = __require("shared/utils/pcmWav.ts");
const diagnosticLogger_1 = __require("extension/src/services/diagnosticLogger.ts");
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_PER_MODEL_TIMEOUT_MS = 15000; // 15 segundos por modelo
// O fetch do Service Worker deve receber resposta antes do limite de 30s do Chrome.

const MAX_BASE64_AUDIO_LENGTH = 15 * 1024 * 1024; // 15MB limite de segurança
function redactApiKeys(value, keys) {
    let safe = String(value);
    for (const key of [...keys].sort((a, b) => b.length - a.length)) {
        safe = safe.split(key).join('[chave ocultada]');
        safe = safe.split(encodeURIComponent(key)).join('[chave ocultada]');
    }
    return safe;
}
function isGemini38Tts(modelId) {
    return modelId.startsWith('gemini-3.8-') && modelId.endsWith('-tts');
}
function bodyPreview(body) {
    const compact = body.replace(/\s+/g, ' ').trim();
    return compact.length > 400 ? `${compact.slice(0, 400)}…` : compact;
}
async function readJsonResponse(response, context, trace, {includeBodyPreview=true}={}) {
    const raw = await response.text();
    trace?.mark("HTTP_BODY_END");
    trace?.mark("PARSE_START");
    const contentType = response.headers.get('content-type') || '';
    if (!raw.trim()) {
        throw new Error(`${context}: resposta vazia (HTTP ${response.status}).`);
    }
    try {
        const parsed=JSON.parse(raw.replace(/^\uFEFF/, ''));
        trace?.mark('PARSE_END');return parsed;
    }
    catch (err) {
        const preview = includeBodyPreview?bodyPreview(raw):'';
        throw new Error(`${context}: resposta não-JSON (HTTP ${response.status}${contentType ? `, ${contentType}` : ''}).${preview ? ` Corpo: ${preview}` : ''}`, { cause: err });
    }
}
async function readHttpError(response, context, trace, controller) {
    let deadline;
    let raw;
    try{raw = controller&&(response.status===400||response.status===422)?await Promise.race([response.text(),new Promise((_,reject)=>{deadline=setTimeout(()=>{const error=new Error(`HTTP ${response.status}: payload inválido; body de erro não terminou em 250 ms.`);error.httpStatus=response.status;controller?.abort(error);reject(error);},250);})]):await response.text();}
    finally{clearTimeout(deadline);}
    trace?.mark("HTTP_BODY_END");
    if (!raw.trim())
        return `${context}: HTTP ${response.status} ${response.statusText}`.trim();
    try {
        const parsed = JSON.parse(raw);
        if(controller)controller.ttsRetryDelay=parsed.error?.details?.find(detail=>detail.retryDelay)?.retryDelay;
        if (typeof parsed.error === 'string')
            return parsed.error;
        if (parsed.error && typeof parsed.error.message === 'string')
            return parsed.error.message;
        if (typeof parsed.message === 'string')
            return parsed.message;
    }
    catch {
        // A API também pode devolver texto/HTML em falhas de proxy. Mantemos um preview.
    }
    return bodyPreview(raw) || `${context}: HTTP ${response.status}`;
}
class GeminiDirectClient {
    /**
     * Ranking passivo por modelo × chave, sempre com a narração inteira.
     * Não repete o mesmo par modelo/chave e encerra no primeiro áudio válido.
     */
    async synthesizeSpeech(request, apiSettings, parentSignal) { throw new Error('TTS convencional desativado. Use TTS_REQUEST via Gemini Live WebSocket.');
        const apiKeys = (0, defaultSettings_1.getTtsApiKeys)(apiSettings);
        if (!apiKeys.length) throw new Error('Chave de API Gemini não informada.');
        if (apiKeys.length > 9) throw new Error('Informe no máximo 9 chaves para o fallback TTS.');
        const config = __require("shared/utils/ttsConfiguration.ts"), adaptive = globalThis.TtsAdaptive;
        const trace = config.createTrace({...request.trace,context:'background',secrets:apiKeys});
        const store = adaptive.getStore(), log = entry => (0, diagnosticLogger_1.logDiagnostic)(entry);
        const models = [...new Set([request.modelId,...modelsCatalog_1.TTS_MODELS_WHITELIST])].filter(model=>Object.hasOwn(config.TTS_MODEL_CAPABILITIES,model));
        const diagnostic = request.diagnostic?.singleAttempt ? {model:request.modelId,keyIndex:request.diagnostic.keyIndex||1} : null;
        if(diagnostic&&(!models.includes(diagnostic.model)||!Number.isInteger(diagnostic.keyIndex)||diagnostic.keyIndex<1||diagnostic.keyIndex>apiKeys.length))throw new Error('Modelo/índice de chave inválido para diagnóstico.');
        const payloads=new Map(),bodies=new Map();
        // A configuração explicitamente escolhida continua sendo validada antes de consumir quota.
        if(Object.hasOwn(config.TTS_MODEL_CAPABILITIES,request.modelId)){
            try{payloads.set(request.modelId,config.buildPayload(request,request.modelId,trace));}
            catch(error){void log({level:'error',source:'TTS',operation:'TTS_PAYLOAD_ERROR',message:config.redactTtsSecrets(error.message,apiKeys)+'; ranking preservado; fallback NÃO'});throw error;}
        }
        const result=await adaptive.run({models,keys:apiKeys,text:request.text,trace,signal:parentSignal,diagnostic,
            snapshot:pairs=>store.snapshot(pairs),record:(...args)=>store.record(...args),log,
            prepare:modelId=>{if(!payloads.has(modelId))payloads.set(modelId,config.buildPayload(request,modelId,trace));if(!bodies.has(modelId))bodies.set(modelId,JSON.stringify(payloads.get(modelId)));return bodies.get(modelId);},
            execute:async(pair,info,body)=>{
                const modelId=pair.model,controller=new AbortController();
                const timeoutId=setTimeout(()=>controller.abort(new Error(`Timeout de ${(info.timeoutMs/1000).toFixed(2)}s excedido no modelo ${modelId}.`)),info.timeoutMs);
                const cancel=()=>controller.abort(parentSignal?.reason||new Error('TTS cancelado.'));
                parentSignal?.addEventListener('abort',cancel,{once:true});
                const requestStart=config.performanceStamp().now;let headersReceived;
                try{
                    trace.mark('FETCH_START',info);
                    const response=await fetch(`${GEMINI_BASE_URL}/models/${modelId}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKeys[pair.keyIndex-1]},body,signal:controller.signal});
                    headersReceived=config.performanceStamp().now;trace.mark('HTTP_HEADERS',{...info,httpStatus:response.status});
                    if(!response.ok){const error=new Error(`Falha HTTP (${response.status}) no modelo ${modelId}: ${config.redactTtsSecrets(await readHttpError(response,`TTS ${modelId}`,trace,controller),apiKeys)}`);error.httpStatus=response.status;error.retryAfter=response.headers.get('retry-after')||controller.ttsRetryDelay;throw error;}
                    const data=await readJsonResponse(response,`TTS ${modelId}`,trace);
                    const audioReceived=config.performanceStamp().now;
                    if(data?.error){const error=new Error(config.redactTtsSecrets(data.error.message||data.error.status||'Erro TTS',apiKeys));error.httpStatus=response.status;error.ttsFatal=data.error.status==='INVALID_ARGUMENT';throw error;}
                    trace.mark('AUDIO_EXTRACT_START',info);
                    const part=data.candidates?.[0]?.content?.parts?.find(part=>part.inlineData?.data||part.inline_data?.data);
                    const rawBase64=part?.inlineData?.data||part?.inline_data?.data;
                    if(typeof rawBase64!=='string'||!rawBase64.length)throw new Error(`Modelo ${modelId} não retornou dados de áudio na resposta.`);
                    if(rawBase64.length>MAX_BASE64_AUDIO_LENGTH)throw new Error('Áudio retornado excede o limite seguro de 15MB.');
                    const rawBytes=(0,pcmWav_1.base64ToUint8Array)(rawBase64);
                    const prepared=config.prepareAudio(rawBytes,part.inlineData?.mimeType||part.inline_data?.mime_type||'',config.getOutputSampleRate(request.ttsConfig,modelId));
                    const audioBase64=prepared.bytes===rawBytes?rawBase64:(0,pcmWav_1.uint8ArrayToBase64)(prepared.bytes);
                    trace.mark('AUDIO_EXTRACT_END',{...info,bytes:prepared.bytes.length});
                    return {value:{audioBase64,mimeType:prepared.mimeType,sampleRate:prepared.sampleRate},metrics:{durationMs:audioReceived-requestStart,headersMs:headersReceived-requestStart}};
                }catch(error){const failure=controller.signal.aborted?controller.signal.reason:error;failure.apiDurationMs=config.performanceStamp().now-requestStart;throw failure;}
                finally{clearTimeout(timeoutId);parentSignal?.removeEventListener('abort',cancel);}
            }
        });
        return {...result,...(trace.enabled?{trace:trace.snapshot()}: {})};
    }
    /**
     * Transcreve áudio gravado via protocolo STT Unary.
     */
    async transcribeAudio(request, apiKey, parentSignal) { throw new Error('STT convencional desativado. Use STT_LIVE_START via Gemini Live WebSocket.');
        if (!apiKey) {
            throw new Error('Chave de API Gemini não informada.');
        }
        const promptText = request.formattingInstruction
            ? `Transcreva o seguinte áudio respeitando estritamente esta instrução: ${request.formattingInstruction}`
            : 'Transcreva o áudio com pontuação e ortografia correta, sem adicionar introduções ou conclusões.';
        const rawMime = request.mimeType || 'audio/webm';
        const normalizedMime = rawMime.split(';')[0].trim() || 'audio/webm';
        const { result } = await (0, modelsCatalog_1.executeWithZeroRetryFallback)('stt_unary', request.modelId, async (modelId) => {
            if (parentSignal?.aborted) {
                throw new Error('Operação STT cancelada.');
            }
            const startTime = Date.now();
            await (0, diagnosticLogger_1.logDiagnostic)({
                level: 'info',
                source: 'STT',
                operation: 'MODEL_ATTEMPT',
                message: `Tentando modelo ${modelId} com mimeType: ${normalizedMime}`,
                modelId,
            });
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort(new Error(`Timeout de 15s excedido no modelo ${modelId}.`));
            }, MAX_PER_MODEL_TIMEOUT_MS);
            const onParentAbort = () => controller.abort(parentSignal?.reason);
            if (parentSignal) {
                parentSignal.addEventListener('abort', onParentAbort, { once: true });
            }
            try {
                const endpoint = `${GEMINI_BASE_URL}/models/${modelId}:generateContent?key=${apiKey}`;
                const payload = {
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    inline_data: {
                                        mime_type: normalizedMime,
                                        data: request.audioBase64,
                                    },
                                },
                                {
                                    text: promptText,
                                },
                            ],
                        },
                    ],
                };
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                const durationMs = Date.now() - startTime;
                if (!response.ok) {
                    const errorText = await readHttpError(response, `STT ${modelId}`);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'STT',
                        operation: 'MODEL_ERROR',
                        modelId,
                        httpStatus: response.status,
                        durationMs,
                        message: `Falha HTTP (${response.status}) no modelo ${modelId}: ${errorText}`,
                        errorDetails: errorText,
                    });
                    throw new Error(`Falha HTTP (${response.status}) no modelo ${modelId}: ${errorText}`);
                }
                const data = await readJsonResponse(response, `STT ${modelId}`);
                const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!textOutput) {
                    const msg = `Modelo ${modelId} não retornou transcrição.`;
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'warn',
                        source: 'STT',
                        operation: 'MODEL_ERROR',
                        modelId,
                        durationMs,
                        message: msg,
                    });
                    throw new Error(msg);
                }
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'info',
                    source: 'STT',
                    operation: 'MODEL_SUCCESS',
                    message: `Modelo ${modelId} transcreveu com sucesso`,
                    modelId,
                    durationMs,
                });
                return textOutput.trim();
            }
            catch (err) {
                const durationMs = Date.now() - startTime;
                const errMsg = err instanceof Error ? err.message : String(err);
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'error',
                    source: 'STT',
                    operation: 'MODEL_ERROR',
                    modelId,
                    durationMs,
                    message: errMsg,
                    errorDetails: err?.stack || String(err),
                });
                throw err;
            }
            finally {
                clearTimeout(timeoutId);
                if (parentSignal) {
                    parentSignal.removeEventListener('abort', onParentAbort);
                }
            }
        });
        return result;
    }
    /**
     * Inspeciona conteúdo visual com a whitelist Vision/Geral.
     */
    async inspectVisionContext(imageBase64, instruction, apiSettings, modelId, options={}) {
        const keys=defaultSettings_1.getTtsApiKeys(apiSettings).slice(0,9);
        if(!keys.length)throw new Error('Chave de API Gemini não informada.');
        const pool=__require("extension/src/services/lensPool.ts");
        const models=modelsCatalog_1.getFallbackChainForTask('vision');
        const {result}=await modelsCatalog_1.executeWithZeroRetryFallback('vision',modelId,targetModel=>{
            options.signal?.throwIfAborted();
            const payload=(options.literalOcr?globalThis.LiveConfig.buildSelectionOcrPayload:globalThis.LiveConfig.buildVisionPayload)({modelId:targetModel,imageBase64,mimeType:options.mimeType||'image/jpeg',instruction:instruction||'Extraia e transcreva com exatidão todo o texto visível nesta área selecionada da página. Retorne unicamente o texto extraído, limpo, sem introduções ou observações, pronto para ser lido.'});
            const body=JSON.stringify(payload);
            return pool.run({model:targetModel,models,keys,signal:options.signal,log:entry=>diagnosticLogger_1.logDiagnostic(entry),execute:async(pair,signal)=>{
                signal.throwIfAborted();
                const response=await fetch(`${GEMINI_BASE_URL}/models/${targetModel}:generateContent?key=${encodeURIComponent(keys[pair.keyIndex-1])}`,{
                    method:'POST',headers:{'Content-Type':'application/json'},body,signal
                });
                signal.throwIfAborted();
                if(!response.ok){
                    // Corpos de erro podem ecoar imagem/instruções. Status e Retry-After bastam.
                    const retryAfter=response.headers.get('retry-after');
                    void response.body?.cancel().catch(()=>{});
                    throw Object.assign(new Error(`Falha HTTP (${response.status}) no modelo ${targetModel}: HTTP ${response.status}`),{httpStatus:response.status,retryAfter});
                }
                const data=await readJsonResponse(response,`Visão ${targetModel}`,undefined,{includeBodyPreview:false});
                signal.throwIfAborted();
                const candidate=data.candidates?.[0];
                if(data.error||data.promptFeedback?.blockReason||candidate?.finishReason&&candidate.finishReason!=='STOP')throw new Error('Resposta de visão bloqueada ou sem conclusão válida.');
                const text=(candidate?.content?.parts||[]).filter(part=>part.thought!==true&&typeof part.text==='string').map(part=>part.text).join('').trim();
                if(options.selectionMode==='interpret'&&!text)throw new Error('Resposta de interpretação vazia.');
                return options.literalOcr?JSON.stringify({text:globalThis.LiveConfig.parseSelectionOcr(text)}):options.selectionMode==='interpret'?JSON.stringify({text}):text;
            }});
        });
        return options.literalOcr||options.selectionMode==='interpret'?globalThis.LiveConfig.parseSelectionOcr(result):result;
    }
    async testApiKey(apiKey) {
        try {
            await (0, modelsCatalog_1.executeWithZeroRetryFallback)('auth_test', modelsCatalog_1.AUTH_TEST_INITIAL_MODEL, async (modelId) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                try {
                    const endpoint = `${GEMINI_BASE_URL}/models/${modelId}?key=${apiKey}`;
                    const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
                    if (!response.ok) {
                        throw new Error(`Chave recusada no modelo ${modelId} (${response.status})`);
                    }
                    return true;
                }
                finally {
                    clearTimeout(timeoutId);
                }
            });
            return true;
        }
        catch (_) {
            return false;
        }
    }
    async discoverAvailableModels(apiKey) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
            const endpoint = `${GEMINI_BASE_URL}/models?key=${apiKey}`;
            const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
            if (!response.ok) {
                await readHttpError(response, 'Listagem de modelos');
                throw new Error(`Erro ao listar modelos: HTTP ${response.status}`);
            }
            const data = await readJsonResponse(response, 'Listagem de modelos',undefined,{includeBodyPreview:false});
            const modelsList = data.models || [];
            const allowedIds = new Set([
                ...modelsCatalog_1.TTS_MODELS_WHITELIST,
                ...modelsCatalog_1.FLASH_LITE_MODELS_WHITELIST,
                ...modelsCatalog_1.STT_UNARY_MODELS_WHITELIST,
            ]);
            return modelsList
                .map((m) => ({
                id: String(m.name || '').replace(/^models\//, ''),
                displayName: String(m.displayName || ''),
                description: String(m.description || ''),
                supportedGenerationMethods: Array.isArray(m.supportedGenerationMethods)
                    ? m.supportedGenerationMethods
                    : [],
                discoveredAt: Date.now(),
            }))
                .filter((m) => allowedIds.has(m.id));
        }
        catch(error){throw Object.assign(new Error(redactApiKeys(error?.message||String(error),[apiKey])),{name:error?.name||'Error'});}
        finally {
            clearTimeout(timeoutId);
        }
    }
}
exports.GeminiDirectClient = GeminiDirectClient;
exports.geminiDirectClient = new GeminiDirectClient();

},
"shared/utils/pcmWav.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Funções matemáticas e binárias puras de processamento PCM e WAV de alta performance.
 * 100% agnóstico de ambiente (Zero DOM, Zero AudioContext, Zero Node.js fs).
 * Implementado com processamento em blocos (chunking) para evitar travamento da main thread.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.base64ToUint8Array = base64ToUint8Array;
exports.uint8ArrayToBase64 = uint8ArrayToBase64;
exports.createWavHeader = createWavHeader;
exports.pcmToWav = pcmToWav;
exports.wavToPcm = wavToPcm;
exports.calculatePcmDurationMs = calculatePcmDurationMs;
/**
 * Converte base64 string para Uint8Array de forma ultra-rápida e segura.
 */
function base64ToUint8Array(base64) {
    // Limpeza robusta de qualquer prefixo data URI (ex: data:audio/webm;codecs=opus;base64,)
    let cleanBase64 = base64.trim();
    if (cleanBase64.includes(',')) {
        cleanBase64 = cleanBase64.split(',')[1];
    }
    cleanBase64 = cleanBase64.replace(/\s/g, '');
    if (typeof Uint8Array.fromBase64 === 'function') {
        return Uint8Array.fromBase64(cleanBase64);
    }
    if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(cleanBase64, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    // Suporte em Browser / Service Worker via atob nativo com TypedArray
    if (typeof atob === 'function') {
        const binaryString = atob(cleanBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
    // Fallback puro para ambientes restritos sem atob/Buffer
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
    }
    let bufferLength = cleanBase64.length * 0.75;
    if (cleanBase64[cleanBase64.length - 1] === '=') {
        bufferLength--;
        if (cleanBase64[cleanBase64.length - 2] === '=') {
            bufferLength--;
        }
    }
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < cleanBase64.length; i += 4) {
        const encoded1 = lookup[cleanBase64.charCodeAt(i)];
        const encoded2 = lookup[cleanBase64.charCodeAt(i + 1)];
        const encoded3 = lookup[cleanBase64.charCodeAt(i + 2)];
        const encoded4 = lookup[cleanBase64.charCodeAt(i + 3)];
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (encoded3 !== 64 && p < bufferLength) {
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        }
        if (encoded4 !== 64 && p < bufferLength) {
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
    }
    return bytes;
}
/**
 * Converte Uint8Array para base64 string de alta velocidade sem travamento de loop.
 */
function uint8ArrayToBase64(bytes) {
    if (typeof bytes.toBase64 === 'function') {
        return bytes.toBase64();
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    if (typeof btoa === 'function') {
        const CHUNK_SIZE = 8192;
        const chunks = [];
        const len = bytes.length;
        for (let i = 0; i < len; i += CHUNK_SIZE) {
            const end = Math.min(i + CHUNK_SIZE, len);
            const sub = bytes.subarray(i, end);
            chunks.push(String.fromCharCode(...sub));
        }
        return btoa(chunks.join(''));
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    const byteLength = bytes.byteLength;
    const byteRemainder = byteLength % 3;
    const mainLength = byteLength - byteRemainder;
    let a, b, c, d;
    let chunk;
    for (let i = 0; i < mainLength; i += 3) {
        chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        a = (chunk & 16515072) >> 18;
        b = (chunk & 258048) >> 12;
        c = (chunk & 4032) >> 6;
        d = chunk & 63;
        base64 += chars[a] + chars[b] + chars[c] + chars[d];
    }
    if (byteRemainder === 1) {
        chunk = bytes[mainLength];
        a = (chunk & 252) >> 2;
        b = (chunk & 3) << 4;
        base64 += chars[a] + chars[b] + '==';
    }
    else if (byteRemainder === 2) {
        chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
        a = (chunk & 64512) >> 10;
        b = (chunk & 1008) >> 4;
        c = (chunk & 15) << 2;
        base64 += chars[a] + chars[b] + chars[c] + '=';
    }
    return base64;
}
/**
 * Cria cabeçalho WAV de 44 bytes para dados PCM Linear 16-bit.
 */
function createWavHeader(dataLength, sampleRate = 24000, numChannels = 1, bitDepth = 16) {
    const header = new Uint8Array(44);
    const view = new DataView(header.buffer);
    const byteRate = (sampleRate * numChannels * bitDepth) / 8;
    const blockAlign = (numChannels * bitDepth) / 8;
    // "RIFF" chunk
    header[0] = 0x52; // R
    header[1] = 0x49; // I
    header[2] = 0x46; // F
    header[3] = 0x46; // F
    view.setUint32(4, 36 + dataLength, true); // chunkSize
    // "WAVE" format
    header[8] = 0x57; // W
    header[9] = 0x41; // A
    header[10] = 0x56; // V
    header[11] = 0x45; // E
    // "fmt " sub-chunk
    header[12] = 0x66; // f
    header[13] = 0x6d; // m
    header[14] = 0x74; // t
    header[15] = 0x20; // " "
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, byteRate, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitDepth, true); // BitsPerSample
    // "data" sub-chunk
    header[36] = 0x64; // d
    header[37] = 0x61; // a
    header[38] = 0x74; // t
    header[39] = 0x61; // a
    view.setUint32(40, dataLength, true); // Subchunk2Size
    return header;
}
/**
 * Converte dados brutos PCM 16-bit para container WAV completo.
 */
function pcmToWav(pcmData, sampleRate = 24000, numChannels = 1, bitDepth = 16) {
    const header = createWavHeader(pcmData.byteLength, sampleRate, numChannels, bitDepth);
    const wavBytes = new Uint8Array(header.byteLength + pcmData.byteLength);
    wavBytes.set(header, 0);
    wavBytes.set(pcmData, header.byteLength);
    return wavBytes;
}
/**
 * Extrai dados PCM puros de um container WAV válido.
 */
function wavToPcm(wavBytes) {
    const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
    // Validar "RIFF" e "WAVE"
    const isRiff = wavBytes[0] === 0x52 && wavBytes[1] === 0x49 && wavBytes[2] === 0x46 && wavBytes[3] === 0x46;
    const isWave = wavBytes[8] === 0x57 && wavBytes[9] === 0x41 && wavBytes[10] === 0x56 && wavBytes[11] === 0x45;
    if (!isRiff || !isWave) {
        throw new Error('Arquivo fornecido não é um container WAV válido.');
    }
    let offset = 12;
    let sampleRate = 24000;
    let numChannels = 1;
    let bitDepth = 16;
    let pcmData = new Uint8Array(0);
    while (offset < wavBytes.byteLength - 8) {
        const chunkId = String.fromCharCode(wavBytes[offset], wavBytes[offset + 1], wavBytes[offset + 2], wavBytes[offset + 3]);
        const chunkSize = view.getUint32(offset + 4, true);
        if (chunkId === 'fmt ') {
            numChannels = view.getUint16(offset + 10, true);
            sampleRate = view.getUint32(offset + 12, true);
            bitDepth = view.getUint16(offset + 22, true);
        }
        else if (chunkId === 'data') {
            pcmData = wavBytes.slice(offset + 8, offset + 8 + chunkSize);
            break;
        }
        offset += 8 + chunkSize;
    }
    const durationMs = calculatePcmDurationMs(pcmData.byteLength, sampleRate, numChannels, bitDepth);
    return {
        pcmData,
        metadata: {
            sampleRate,
            channels: numChannels,
            bitDepth,
            byteLength: pcmData.byteLength,
            durationMs,
        },
    };
}
/**
 * Calcula a duração aproximada em ms a partir do tamanho dos bytes PCM.
 */
function calculatePcmDurationMs(byteLength, sampleRate, numChannels = 1, bitDepth = 16) {
    const bytesPerSample = (bitDepth / 8) * numChannels;
    if (bytesPerSample === 0 || sampleRate === 0)
        return 0;
    const totalSamples = byteLength / bytesPerSample;
    return Math.round((totalSamples / sampleRate) * 1000);
}

},
"extension/src/services/diagnosticLogger.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Serviço Centralizado de Logging e Diagnóstico Técnico.
 * Grava eventos de runtime, falhas de modelo, requisições de API, timeouts e estados do sistema
 * de forma persistente no namespace 'logs' do chrome.storage.local.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logDiagnostic = logDiagnostic;
exports.clearDiagnosticLogs = clearDiagnosticLogs;
const chromeStorageAdapter_1 = __require("extension/src/services/storage/chromeStorageAdapter.ts");
async function logDiagnostic(entry) {
    try {
        const newItem = {
            id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            level: entry.level,
            source: entry.source,
            operation: entry.operation,
            message: entry.message,
            modelId: entry.modelId,
            httpStatus: entry.httpStatus,
            durationMs: entry.durationMs,
            errorDetails: entry.errorDetails,
        };
        let enabled = false;
        await chromeStorageAdapter_1.chromeStorage.update('logs', (logsData) => {
            if (logsData.enabled === false)
                return;
            enabled = true;
            const max = logsData.maxEntries || 100;
            return { ...logsData, items: [newItem, ...(logsData.items || [])].slice(0, max) };
        });
        if (enabled) {
            console.log(`[DiagnosticLog][${entry.source}][${entry.level.toUpperCase()}] ${entry.operation}: ${entry.message}`);
        }
    }
    catch (err) {
        console.warn('[DiagnosticLogger] Falha ao persistir log técnico:', err);
    }
}
async function clearDiagnosticLogs() {
    try {
        await chromeStorageAdapter_1.chromeStorage.setPartial('logs', { items: [] });
    }
    catch (err) {
        console.warn('[DiagnosticLogger] Falha ao limpar logs técnicos:', err);
    }
}

},
"extension/src/background/tabCaptureHandler.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gerenciador de Captura de Tela e Análise Visual (Lens) no Service Worker.
 * Executa recorte local da área selecionada com base em coordenadas e devicePixelRatio.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureAndAnalyzeTab = captureAndAnalyzeTab;
const geminiDirectClient_1 = __require("extension/src/services/geminiDirectClient.ts");
const chromeStorageAdapter_1 = __require("extension/src/services/storage/chromeStorageAdapter.ts");
const defaultAgents_1 = __require("shared/constants/defaultAgents.ts");
const pcmWav_1 = __require("shared/utils/pcmWav.ts");
const diagnosticLogger_1 = __require("extension/src/services/diagnosticLogger.ts");
async function captureAndAnalyzeTab(tabId, instruction, agentId, rect, expectedUrl, onAgentResolved, parentSignal, mode = 'literal') {
    const controller=new AbortController(),signal=controller.signal;
    const cancel=()=>controller.abort(parentSignal.reason);
    parentSignal?.addEventListener('abort',cancel,{once:true});
    if(parentSignal?.aborted)cancel();
    // Timeout Global de 30s para o fluxo inteiro da captura até a resposta
    const GLOBAL_LENS_TIMEOUT_MS = 30000;
    const executionPromise = (async () => {
        const { api: apiSettings, agents: agentsSettings, models: modelsSettings } = await chromeStorageAdapter_1.chromeStorage.getMany(['api', 'agents', 'models']);
        if (!__require("shared/constants/defaultSettings.ts").getTtsApiKeys(apiSettings).length) {
            throw new Error('Chave de API Gemini não configurada. Abra as opções da extensão.');
        }
        const agent=globalThis.LiveConfig.resolveAgent(agentsSettings,agentId,defaultAgents_1.DEFAULT_AGENTS,defaultAgents_1.AGENT_ID_ALIASES);
        onAgentResolved?.(agent.metadata.id,globalThis.LiveConfig.lensInstructions(agent).lensReadingInstruction);
        // captureVisibleTab captura a aba ativa da JANELA, não recebe tabId.
        signal?.throwIfAborted();
        const target = await chrome.tabs.get(tabId);
        const tabChanged = () => Object.assign(new Error('A aba mudou durante a seleção. Volte à página desejada e tente o Lens novamente.'), { code: 'LENS_TAB_CHANGED' });
        if (!target.active || (expectedUrl && target.url && target.url !== expectedUrl) || target.pendingUrl) throw tabChanged();
        let dataUrl;
        try {
            dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, { format: 'jpeg', quality: 90 });
        } catch (error) {
            if (/(?:<all_urls>|activeTab).*(?:required|not in effect)/i.test(error?.message || '')) {
                throw Object.assign(new Error('O Lens precisa de autorização para capturar a área selecionada.'), { code: 'LENS_CAPTURE_PERMISSION_REQUIRED' });
            }
            throw error;
        }
        signal?.throwIfAborted();
        const afterCapture = await chrome.tabs.get(tabId);
        if (!afterCapture.active || afterCapture.windowId !== target.windowId || afterCapture.pendingUrl || (target.url && afterCapture.url !== target.url)) throw tabChanged();
        let base64ToSend = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        // Se houver seleção retangular com dimensões válidas, recorta a imagem antes do envio à Gemini
        if (rect && rect.width > 10 && rect.height > 10) {
            try {
                const response = await fetch(dataUrl);
                const blob = await response.blob();
                const imageBitmap = await createImageBitmap(blob);
                const dpr = rect.devicePixelRatio || 1;
                const cropX = Math.max(0, Math.round(rect.x * dpr));
                const cropY = Math.max(0, Math.round(rect.y * dpr));
                const cropW = Math.min(imageBitmap.width - cropX, Math.round(rect.width * dpr));
                const cropH = Math.min(imageBitmap.height - cropY, Math.round(rect.height * dpr));
                if (cropW <= 10 || cropH <= 10) {
                    throw new Error(`Dimensões de recorte inválidas após DPR: ${cropW}x${cropH}px`);
                }
                const offscreen = new OffscreenCanvas(cropW, cropH);
                const ctx = offscreen.getContext('2d');
                if (!ctx) {
                    throw new Error('Falha ao obter contexto 2D para OffscreenCanvas');
                }
                ctx.drawImage(imageBitmap, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
                const croppedBlob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
                const arrayBuffer = await croppedBlob.arrayBuffer();
                base64ToSend = (0, pcmWav_1.uint8ArrayToBase64)(new Uint8Array(arrayBuffer));
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'info',
                    source: 'LENS',
                    operation: 'CROP_SELECTION_SUCCESS',
                    message: `Seleção de tela recortada com sucesso: ${cropW}x${cropH}px (DPR ${dpr})`,
                });
            }
            catch (cropErr) {
                const cropErrMsg = cropErr instanceof Error ? cropErr.message : String(cropErr);
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'error',
                    source: 'LENS',
                    operation: 'CROP_SELECTION_FAILED',
                    message: `Falha ao recortar seleção de tela: ${cropErrMsg}. NUNCA enviando captura integral.`,
                    errorDetails: cropErr?.stack || String(cropErr),
                });
                // NUNCA envia tela inteira quando existe seleção. Lança erro explícito.
                throw new Error(`Falha no recorte da seleção de tela: ${cropErrMsg}`);
            }
        }
        signal?.throwIfAborted();
        const prompt = mode==='interpret'?(globalThis.LiveConfig.lensInstructions(agent).lensInspectionInstruction.trim()||'Descreva a região selecionada com clareza e objetividade.'):globalThis.LiveConfig.LITERAL_SELECTION_OCR;
        return geminiDirectClient_1.geminiDirectClient.inspectVisionContext(base64ToSend,prompt,apiSettings,agent.modelPreferences.visionModelId||modelsSettings.visionModelId,{selectionMode:mode,literalOcr:mode!=='interpret',agentId:agent.metadata.id,mimeType:'image/jpeg',signal});
    })();
    let timerId,abort;
    const timeoutPromise = new Promise((_, reject) => {
        abort=()=>reject(signal.reason);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
        timerId = setTimeout(() => {
            controller.abort(new Error('Timeout global de 30s excedido no fluxo do Gemini Lens.'));
        }, GLOBAL_LENS_TIMEOUT_MS);
    });
    try {
        return await Promise.race([executionPromise, timeoutPromise]);
    }
    finally {
        signal?.removeEventListener('abort',abort);
        parentSignal?.removeEventListener('abort',cancel);
        if (timerId)
            clearTimeout(timerId);
    }
}

},
"extension/src/background/commandHandler.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gerenciador de atalhos de teclado (chrome.commands) no Service Worker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommandHandlers = registerCommandHandlers;
const tabMessenger_1 = __require("extension/src/utils/tabMessenger.ts");
function registerCommandHandlers() {
    let dictationPress = null;
    chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'STT_SHORTCUT_RELEASE' && dictationPress &&
            sender.tab?.id === dictationPress.tabId && sender.frameId === 0 &&
            message.payload?.commandId === dictationPress.commandId) dictationPress = null;
        return false;
    });
    chrome.tabs.onRemoved?.addListener(tabId => {
        if (dictationPress?.tabId === tabId) dictationPress = null;
    });
    chrome.tabs.onUpdated?.addListener((tabId, change) => {
        if (dictationPress?.tabId === tabId && change.status === 'loading') dictationPress = null;
    });
    chrome.commands.onCommand.addListener(async (command, commandTab) => {
        if (command === 'start_dictation') {
            if (dictationPress) return;
            const press = {commandId: crypto.randomUUID(), startedAt: performance.timeOrigin + performance.now()};
            dictationPress = press;
            let accepted = false;
            try {
                const activeTab = commandTab || (await chrome.tabs.query({active: true, currentWindow: true}))[0];
                if (!activeTab?.id) return;
                press.tabId = activeTab.id;
                const binding = (await chrome.commands.getAll()).find(item => item.name === command);
                const result = await tabMessenger_1.sendTabMessageSafe(activeTab.id, activeTab.url, {
                    type: 'CMD_START_DICTATION',
                    payload: {commandId: press.commandId, startedAt: press.startedAt, shortcut: binding?.shortcut}
                });
                accepted = Boolean(binding?.shortcut && result.success);
            } finally {
                if (!accepted && dictationPress === press) dictationPress = null;
            }
            return;
        }
        const activeTab = commandTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!activeTab || !activeTab.id)
            return;
        switch (command) {
            case 'read_selection':
                await (0, tabMessenger_1.sendTabMessageSafe)(activeTab.id, activeTab.url, { type: 'CMD_READ_SELECTION' });
                break;
            case 'toggle_hud':
                await (0, tabMessenger_1.sendTabMessageSafe)(activeTab.id, activeTab.url, { type: 'TOGGLE_HUD' });
                break;
            default:
                console.warn(`[Command] Comando não reconhecido: ${command}`);
                break;
        }
    });
}

},
"extension/src/utils/tabMessenger.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Utilitário seguro para comunicação com Content Scripts em abas do Chrome.
 * - Evita o erro 'Receiving end does not exist'
 * - Injeta o Content Script dinamicamente se a aba foi aberta antes do carregamento da extensão
 * - Ignora páginas de sistema protegidas (chrome://, edge://, about:)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRestrictedUrl = isRestrictedUrl;
exports.sendTabMessageSafe = sendTabMessageSafe;
function isRestrictedUrl(url) {
    if (!url)
        return true;
    return (url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.startsWith('view-source:') ||
        url.startsWith('chrome-untrusted://') ||
        url.startsWith('https://chrome.google.com/webstore') ||
        url.startsWith('https://chromewebstore.google.com'));
}
async function sendTabMessageSafe(tabId, tabUrl, message) {
    if (isRestrictedUrl(tabUrl)) {
        return {
            success: false,
            restricted: true,
            error: 'Páginas internas do navegador (chrome://, about:) são protegidas e não permitem scripts de extensão.',
        };
    }
    const deliver = () => message.type === 'CMD_START_DICTATION'
        ? chrome.tabs.sendMessage(tabId, message, {frameId: 0})
        : chrome.tabs.sendMessage(tabId, message);
    try {
        const res = await deliver();
        return { success: true, ...res };
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Se o content script ainda não foi injetado (ex: aba aberta antes da extensão carregar)
        if (errorMsg.includes('Receiving end does not exist') ||
            errorMsg.includes('Could not establish connection')) {
            try {
                // Injeta CSS e Script programaticamente
                await chrome.scripting.insertCSS({
                    target: { tabId },
                    files: ['content.css'],
                }).catch(() => { });
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: message.type==='CMD_START_DICTATION'?['tts-config.js','live-stt-diagnostics.js','global-hud.js','dictation-runtime.js','stt-realtime.js','content.js']:['tts-config.js','content.js'],
                });
                // Aguarda inicialização do DOM e retenta envio
                await new Promise((resolve) => setTimeout(resolve, 150));
                const retryRes = await deliver();
                return { success: true, ...retryRes };
            }
            catch (injectErr) {
                return {
                    success: false,
                    error: 'Recarregue a página (F5) para habilitar o assistente nesta aba.',
                };
            }
        }
        return { success: false, error: errorMsg };
    }
}

},
"extension/src/background/contextMenuHandler.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gerenciador de Menus de Contexto (botão direito) no Service Worker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupContextMenus = setupContextMenus;
const tabMessenger_1 = __require("extension/src/utils/tabMessenger.ts");
function createMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'read_selection_menu',
            title: 'Narrar',
            contexts: ['selection'],
        });
    });
}
function setupContextMenus() {
    // Cria os menus imediatamente ao iniciar o Service Worker
    createMenus();
    // Garante a criação em eventos de ciclo de vida
    chrome.runtime.onInstalled.addListener(() => {
        createMenus();
    });
    chrome.runtime.onStartup.addListener(() => {
        createMenus();
    });
    // Listener de clique no menu de contexto
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        if (!tab || !tab.id)
            return;
        switch (info.menuItemId) {
            case 'read_selection_menu':
                await (0, tabMessenger_1.sendTabMessageSafe)(tab.id, tab.url, {
                    type: 'CMD_READ_SELECTION',
                    payload: { text: info.selectionText },
                });
                break;
        }
    });
}

},
};
const __cache={}; function __require(id){if(__cache[id])return __cache[id].exports;const fn=__modules[id];if(!fn)throw new Error("Module not found: "+id);const module={exports:{}};__cache[id]=module;fn(module,module.exports,__require);return module.exports;}
__require("extension/src/background/index.ts");
})();
