import './tts-config.js';
import './tts-adaptive.js';
import './live-config.js';
import './live-tts-diagnostics.js';
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
chrome.tabs.onRemoved?.addListener(tabId => messageRouter_1.stopPlaybackForTab(tabId).catch(() => {}));
// Roteamento de mensagens assíncronas
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen') return false;
    (0, messageRouter_1.handleExtensionMessage)(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true; // Retorno true mantém a porta de resposta aberta para promessas
});

},
"extension/src/services/backgroundPlayback.ts":function(module,exports,__require){
Object.defineProperty(exports, '__esModule', { value: true });
let creating = null;
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
            url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'],
            justification: 'Iniciar a narração assim que estiver disponível, mesmo com a aba em segundo plano.',
        });
    })();
    try { await creating; } finally { creating = null; }
}
function routeFor(payload, sender) {
    if ((!sender.tab?.id && !sender.url?.startsWith(chrome.runtime.getURL('options.html'))) || !payload.playerId) throw new Error('Player sem origem identificada.');
    return { tabId: sender.tab?.id || 0, frameId: sender.frameId || 0, playerId: payload.playerId };
}
async function send(payload) {
    return chrome.runtime.sendMessage({ type: 'TTS_OFFSCREEN_COMMAND', target: 'offscreen', payload });
}
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
async function handlePlaybackCommand(payload, sender) {
    const route = routeFor(payload, sender);
    if (payload.operation === 'SET') {
        const next = { ...preferences.get(keyFor(route)) };
        if (typeof payload.volume === 'number') next.volume = payload.volume;
        if (typeof payload.playbackRate === 'number') next.playbackRate = payload.playbackRate;
        preferences.set(keyFor(route), next);
    }
    if (payload.operation === 'STOP') preferences.delete(keyFor(route));
    if (payload.operation === 'PLAY' || payload.operation === 'TTS_LIVE_START' || payload.operation === 'STT_LIVE_START') await ensureDocument();
    else if (!await hasDocument()) return { success: true };
    return send({ ...payload, ...route });
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
    if (await hasDocument()) await send({ operation: 'STOP_TAB', tabId });
}
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
exports.handleExtensionMessage = handleExtensionMessage;
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
const liveId=prefix=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
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
async function handleExtensionMessage(message, sender) {
    try {
        switch (message.type) {
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
                const {apiKeys,apiKey,systemInstruction,advancedJson,...event} = message.payload || {};
                if (event.event === 'ranking' && !['REQUEST','CANCELLED','INVALIDATED_CONTEXT','UNKNOWN'].includes(event.result)) {
                    const adaptive=globalThis.TtsAdaptive,config=globalThis.LiveConfig;
                    const api=await chromeStorageAdapter_1.chromeStorage.get('api');
                    const keys=(0,defaultSettings_1.getTtsApiKeys)(api),models=config.LIVE_TTS_MODELS,pairs=adaptive.catalog(models,keys);
                    const pair=pairs.find(item=>item.model===event.modelId&&item.keyIndex===event.keyIndex);
                    if(pair){const data=await adaptive.getStore().snapshot(pairs);const type=['SUCCESS','TRANSIENT','QUOTA','AUTH','MODEL','REQUEST','CANCELLED'].includes(event.result)?event.result:'TRANSIENT';await adaptive.getStore().record(pairs,pair,{type,durationMs:event.durationMs||0,label:type},data.epoch).catch(()=>{});}
                }
                if(event.tabId)await chrome.tabs.sendMessage(event.tabId,{type:event.operation==='STT_LIVE_START'||event.event?.startsWith('stt-')?'STT_LIVE_EVENT':'TTS_PLAYBACK_EVENT',payload:event},{frameId:event.frameId||0}).catch(()=>{});
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
            case 'TTS_PLAYBACK_COMMAND':
                return backgroundPlayback_1.handlePlaybackCommand(message.payload, sender);
            case 'TTS_PLAYBACK_EVENT':
                return backgroundPlayback_1.forwardPlaybackEvent(message.payload, sender);
            case 'TTS_REQUEST': {
                const { text, agentId, voiceName, playback } = message.payload;
                const timing=__require("shared/utils/ttsConfiguration.ts");
                const received=timing.performanceStamp();
                if (!text || !text.trim()) {
                    return { success: false, error: 'Texto não informado para síntese.' };
                }
                {
                    const settings=await chromeStorageAdapter_1.chromeStorage.getMany(['api','agents','models','audio']);
                    const keys=(0,defaultSettings_1.getTtsApiKeys)(settings.api);
                    if(!keys.length)return {success:false,error:'Chave de API Gemini não configurada. Abra as opções para configurar.'};
                    const agent=sender.url&&sender.url.startsWith(chrome.runtime.getURL('options.html'))&&message.payload.previewAgent?message.payload.previewAgent:settings.agents.customAgents?.find(a=>a.metadata.id===agentId)||(0,defaultAgents_1.getCanonicalAgent)(agentId);
                    const live=globalThis.LiveConfig.migrateAgent(agent,settings.models).live,liveOptions=globalThis.LiveConfig.buildAgentLiveOptions(agent,settings.audio,settings.models);
                    const model=globalThis.LiveConfig.LIVE_TTS_MODELS.includes(live.preferredModel)?live.preferredModel:globalThis.LiveConfig.DEFAULTS.ttsModelId;
                    const models=globalThis.LiveConfig.modelChain('tts',model);
                    const keyOrderByModel=await liveKeyOrders(models,keys);
                    const route={playerId:playback?.playerId||liveId('player'),requestId:playback?.requestId||liveId('request')};
                    const payload={...route,...liveOptions,operation:'TTS_LIVE_START',jobId:liveId('job'),generation:Date.now(),text,apiKeys:keys,models,keyOrderByModel,modelId:model,voiceName:voiceName||liveOptions.voiceName,volume:playback?.volume??liveOptions.volume,playbackRate:playback?.playbackRate??liveOptions.playbackRate};
                    const result=await backgroundPlayback_1.handlePlaybackCommand(payload,sender);
                    if(!result?.success)throw new Error(result?.error||'Falha no TTS Live.');
                    void addHistoryLog('tts',text.slice(0,80),agentId,'success');
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
                    await backgroundPlayback_1.handlePlaybackCommand({ playerId, operation: 'STOP' }, sender);
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
            case 'STT_LIVE_START': {
                const settings=await chromeStorageAdapter_1.chromeStorage.getMany(['api','agents','models','audio']);
                const keys=(0,defaultSettings_1.getTtsApiKeys)(settings.api);if(!keys.length)return{success:false,error:'Chave de API Gemini não configurada.'};
                const agent=(sender.url?.startsWith(chrome.runtime.getURL('options.html'))&&message.payload.previewAgent)||settings.agents.customAgents?.find(a=>a.metadata.id===message.payload.agentId)||(0,defaultAgents_1.getCanonicalAgent)(message.payload.agentId);
                const migrated=globalThis.LiveConfig.migrateAgent(agent,settings.models),stt=migrated.live.stt||{};
                const instruction=agent.instructions?.sttFormattingInstruction||'';
                const transform=stt.transform===true||(stt.transform!==false&&agent.metadata?.id!=='narrator'&&Boolean(instruction.trim()));
                const modelId=globalThis.LiveConfig.LIVE_STT_MODELS.includes(stt.preferredModel)?stt.preferredModel:globalThis.LiveConfig.DEFAULTS.sttModelId;
                const models=globalThis.LiveConfig.modelChain('stt',modelId);
                return backgroundPlayback_1.handlePlaybackCommand({...message.payload,operation:'STT_LIVE_START',apiKeys:keys,modelId,models,customVocabulary:stt.customVocabulary,smartTranscription:stt.smartTranscription,languageCodes:stt.languageCodes,thinkingLevel:stt.thinkingLevel,thinkingBudget:stt.thinkingBudget,vad:stt.vad,transformInstruction:transform?instruction:null,transformModels:globalThis.LiveConfig.modelChain('tts',migrated.live.preferredModel),voiceName:migrated.live.voiceName,playerId:message.payload.playerId||message.payload.jobId},sender);
            }
            case 'STT_LIVE_AUDIO':
            case 'STT_LIVE_STOP':
            case 'STT_LIVE_CANCEL':
                return backgroundPlayback_1.handlePlaybackCommand({...message.payload,operation:message.type},sender);
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
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'info',
                    source: 'LENS',
                    operation: 'LENS_REQUEST_START',
                    message: `Iniciando captura e análise visual Lens para aba ${tabId}`,
                });
                try {
                    const startTime = Date.now();
                    const description = await (0, tabCaptureHandler_1.captureAndAnalyzeTab)(tabId, message.payload.instruction, message.payload.agentId, message.payload.rect, sender.url);
                    const durationMs = Date.now() - startTime;
                    await addHistoryLog('vision', description.length > 80 ? description.substring(0, 80) + '...' : description, message.payload.agentId, 'success');
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'info',
                        source: 'LENS',
                        operation: 'LENS_REQUEST_SUCCESS',
                        message: `Análise Lens concluída com sucesso (${description.length} chars)`,
                        durationMs,
                    });
                    return { success: true, data: description };
                }
                catch (err) {
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
        return { success: false, error: messageStr };
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
            if(task === "tts" && err?.ttsFatal)throw err;
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
async function readJsonResponse(response, context, trace) {
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
        const preview = bodyPreview(raw);
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
    async inspectVisionContext(imageBase64, instruction, apiKey, modelId) {
        if (!apiKey) {
            throw new Error('Chave de API Gemini não informada.');
        }
        const { result } = await (0, modelsCatalog_1.executeWithZeroRetryFallback)('vision', modelId, async (targetModel) => {
            const startTime = Date.now();
            await (0, diagnosticLogger_1.logDiagnostic)({
                level: 'info',
                source: 'LENS',
                operation: 'MODEL_ATTEMPT',
                message: `Tentando análise com modelo ${targetModel}`,
                modelId: targetModel,
            });
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort(new Error(`Timeout de 15s excedido no modelo ${targetModel}.`));
            }, MAX_PER_MODEL_TIMEOUT_MS);
            try {
                const endpoint = `${GEMINI_BASE_URL}/models/${targetModel}:generateContent?key=${apiKey}`;
                const payload = {
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    inline_data: {
                                        mime_type: 'image/jpeg',
                                        data: imageBase64,
                                    },
                                },
                                {
                                    text: instruction || 'Extraia e transcreva com exatidão todo o texto visível nesta área selecionada da página. Retorne unicamente o texto extraído, limpo, sem introduções ou observações, pronto para ser lido.',
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
                    const errorText = await readHttpError(response, `Visão ${targetModel}`);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'LENS',
                        operation: 'MODEL_ERROR',
                        modelId: targetModel,
                        httpStatus: response.status,
                        durationMs,
                        message: `Falha HTTP (${response.status}) no modelo ${targetModel}: ${errorText}`,
                        errorDetails: errorText,
                    });
                    throw new Error(`Falha HTTP (${response.status}) no modelo ${targetModel}: ${errorText}`);
                }
                const data = await readJsonResponse(response, `Visão ${targetModel}`);
                const description = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'info',
                    source: 'LENS',
                    operation: 'MODEL_SUCCESS',
                    message: `Modelo ${targetModel} analisou com sucesso`,
                    modelId: targetModel,
                    durationMs,
                });
                return description.trim();
            }
            catch (err) {
                const durationMs = Date.now() - startTime;
                const errMsg = err instanceof Error ? err.message : String(err);
                await (0, diagnosticLogger_1.logDiagnostic)({
                    level: 'error',
                    source: 'LENS',
                    operation: 'MODEL_ERROR',
                    modelId: targetModel,
                    durationMs,
                    message: errMsg,
                    errorDetails: err?.stack || String(err),
                });
                throw err;
            }
            finally {
                clearTimeout(timeoutId);
            }
        });
        return result;
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
                const errorText = await readHttpError(response, 'Listagem de modelos');
                throw new Error(`Erro ao listar modelos: ${errorText}`);
            }
            const data = await readJsonResponse(response, 'Listagem de modelos');
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
async function captureAndAnalyzeTab(tabId, instruction, agentId, rect, expectedUrl) {
    // Timeout Global de 30s para o fluxo inteiro da captura até a resposta
    const GLOBAL_LENS_TIMEOUT_MS = 30000;
    const executionPromise = (async () => {
        const { api: apiSettings, agents: agentsSettings, models: modelsSettings } = await chromeStorageAdapter_1.chromeStorage.getMany(['api', 'agents', 'models']);
        if (!apiSettings.apiKey) {
            throw new Error('Chave de API Gemini não configurada. Abra as opções da extensão.');
        }
        const customAgent = agentsSettings.customAgents?.find((a) => a.metadata.id === agentId);
        const agent = customAgent || (0, defaultAgents_1.getCanonicalAgent)(agentId);
        // captureVisibleTab captura a aba ativa da JANELA, não recebe tabId.
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
        const prompt = instruction || agent.instructions.lensInspectionInstruction || 'Descreva a área selecionada da imagem.';
        return geminiDirectClient_1.geminiDirectClient.inspectVisionContext(base64ToSend, prompt, apiSettings.apiKey, agent.modelPreferences.visionModelId || modelsSettings.visionModelId);
    })();
    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
            reject(new Error('Timeout global de 30s excedido no fluxo do Gemini Lens.'));
        }, GLOBAL_LENS_TIMEOUT_MS);
    });
    try {
        return await Promise.race([executionPromise, timeoutPromise]);
    }
    finally {
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
    chrome.commands.onCommand.addListener(async (command) => {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id)
            return;
        switch (command) {
            case 'read_selection':
                await (0, tabMessenger_1.sendTabMessageSafe)(activeTab.id, activeTab.url, { type: 'CMD_READ_SELECTION' });
                break;
            case 'start_dictation':
                await (0, tabMessenger_1.sendTabMessageSafe)(activeTab.id, activeTab.url, { type: 'CMD_START_DICTATION' });
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
    try {
        const res = await chrome.tabs.sendMessage(tabId, message);
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
                    files: ['tts-config.js','content.js'],
                });
                // Aguarda inicialização do DOM e retenta envio
                await new Promise((resolve) => setTimeout(resolve, 150));
                const retryRes = await chrome.tabs.sendMessage(tabId, message);
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
        // 1. Menu Principal para texto selecionado
        chrome.contextMenus.create({
            id: 'read_selection_menu',
            title: '🔊 Ler em voz alta com Gemini (TTS)',
            contexts: ['selection'],
        });
        // 2. Menu de Tradução
        chrome.contextMenus.create({
            id: 'translate_selection_menu',
            title: '🌐 Traduzir e Ouvir Seleção',
            contexts: ['selection'],
        });
        // 3. Menu de Resumo
        chrome.contextMenus.create({
            id: 'summarize_selection_menu',
            title: '📝 Resumir e Ouvir Seleção',
            contexts: ['selection'],
        });
        // 4. Menu de Ditado para campos de texto
        chrome.contextMenus.create({
            id: 'dictate_menu',
            title: '🎙 Ditar com Gemini (STT)',
            contexts: ['editable'],
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
            case 'translate_selection_menu':
                await (0, tabMessenger_1.sendTabMessageSafe)(tab.id, tab.url, {
                    type: 'CMD_READ_SELECTION',
                    payload: { text: info.selectionText, agentId: 'translator' },
                });
                break;
            case 'summarize_selection_menu':
                await (0, tabMessenger_1.sendTabMessageSafe)(tab.id, tab.url, {
                    type: 'CMD_READ_SELECTION',
                    payload: { text: info.selectionText, agentId: 'summarizer' },
                });
                break;
            case 'dictate_menu':
                await (0, tabMessenger_1.sendTabMessageSafe)(tab.id, tab.url, {
                    type: 'CMD_START_DICTATION',
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
