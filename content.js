(()=>{
const __modules={
"extension/src/content/entrypoint.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Entrypoint modular do Content Script (Manifest V3).
 * Inicializa controladores, listeners de mensagens e atalhos de teclado editáveis.
 * Possui guard global para impedir injeções e listeners duplicados.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hudController_1 = __require("extension/src/content/ui/hudController.ts");
const ttsController_1 = __require("extension/src/content/controllers/ttsController.ts");
const sttController_1 = __require("extension/src/content/controllers/sttController.ts");
const lensController_1 = __require("extension/src/content/controllers/lensController.ts");
const textExtractor_1 = __require("extension/src/content/dom/textExtractor.ts");
const inputInjector_1 = __require("extension/src/content/dom/inputInjector.ts");
const shortcutMatcher_1 = __require("shared/utils/shortcutMatcher.ts");
const chromeStorageAdapter_1 = __require("extension/src/services/storage/chromeStorageAdapter.ts");
const defaultSettings_1 = __require("shared/constants/defaultSettings.ts");
const defaultAgents_1 = __require("shared/constants/defaultAgents.ts");
// Estilos CSS do HUD
const hud_css_raw_1 = __importDefault(__require("extension/src/content/styles/hud.css?raw"));
let cachedShortcuts = { ...defaultSettings_1.DEFAULT_UI_PREFERENCES.shortcuts };
// Até o storage responder, deixe o background resolver o agente ativo atual.
let cachedActiveAgentId = null;
function applyActiveAgentAudio(agentsData) {
    if (!sttController_1.stt.ensureExtensionContext()) return;
    const id = agentsData?.activeAgentId || 'narrator';
    cachedActiveAgentId = id;
    const tts = ttsController_1.tts;
    // Live resolves the selected agent and its defaults when each narration starts.
    if (tts.audio?.isBackgroundAudio && globalThis.GlobalHud) return;
    const custom = agentsData?.customAgents?.find((a) => a?.metadata?.id === id);
    const agent = custom || (0, defaultAgents_1.getCanonicalAgent)(id);
    tts.setVolume(agent?.voice?.volume ?? 1);
    tts.setSpeed(agent?.voice?.rateMultiplier ?? 1);
}
function initialize() {
    if (window.__STT_TTSBYALEE_INITIALIZED__) {
        return;
    }
    hudController_1.hud.init(hud_css_raw_1.default);
    if (!sttController_1.stt.ensureExtensionContext()) return;
    window.__STT_TTSBYALEE_INITIALIZED__ = true;
    try {
    // A representação desta página pode desaparecer; o player offscreen continua independente.
    // Carrega atalhos configurados pelo usuário
    sttController_1.stt.preferencesReady = chromeStorageAdapter_1.chromeStorage.get('ui').then((uiData) => {
        if (!sttController_1.stt.ensureExtensionContext()) return;
        if (uiData?.shortcuts) {
            cachedShortcuts = { ...cachedShortcuts, ...uiData.shortcuts };
        }
        sttController_1.stt.preferencesError=null;
        sttController_1.stt.insertionMode = uiData?.dictationInsertion === 'realtime' ? 'realtime' : 'final';
    }).catch(error => {sttController_1.stt.preferencesError=error;sttController_1.stt.reportRuntimeError(error);});
    // Carrega e acompanha o agente ativo para que atalhos/HUD respeitem a persona escolhida.
    chromeStorageAdapter_1.chromeStorage.get('agents').then(applyActiveAgentAudio).catch(error => sttController_1.stt.reportRuntimeError(error));
    chromeStorageAdapter_1.chromeStorage.subscribe('agents', (agentsData) => applyActiveAgentAudio(agentsData));
    // Atualiza atalhos em tempo real quando alterados nas Opções da Extensão
    chromeStorageAdapter_1.chromeStorage.subscribe('ui', (newUi) => {
        if (!sttController_1.stt.ensureExtensionContext()) return;
        if (newUi?.shortcuts) {
            cachedShortcuts = { ...cachedShortcuts, ...newUi.shortcuts };
        }
        sttController_1.stt.preferencesError=null;
        sttController_1.stt.insertionMode = newUi?.dictationInsertion === 'realtime' ? 'realtime' : 'final';
    });
    // Conecta ações do HUD aos controladores
    hudController_1.hud.onPlayPauseClick = () => {
        if (!ttsController_1.tts.activeTask && !ttsController_1.tts.isProcessing) {
            const { cleaned } = (0, textExtractor_1.getCleanSelectedText)();
            if (cleaned) {
                ttsController_1.tts.speakText(cleaned, cachedActiveAgentId);
                return;
            }
        }
        ttsController_1.tts.togglePlayPause();
    };
    hudController_1.hud.onStopClick = () => {
        if (sttController_1.stt.isRecording || sttController_1.stt.liveCapture?.starting) {
            void Promise.resolve(sttController_1.stt.stopLiveRecording()).catch(error => sttController_1.stt.reportRuntimeError(error));
        } else {
            sttController_1.stt.cancelRecording();
            ttsController_1.tts.stop();
        }
    };
    hudController_1.hud.onCloseClick = () => {}; // Fechar visualização não cancela tarefas globais.
    hudController_1.hud.onRecordClick = () => sttController_1.stt.toggleRecording(cachedActiveAgentId).catch(error => sttController_1.stt.reportRuntimeError(error));
    hudController_1.hud.onLensClick = () => lensController_1.lens.activateLensMode(cachedActiveAgentId);
    hudController_1.hud.onVolumeChange = (vol) => ttsController_1.tts.setVolume(vol);
    hudController_1.hud.onSpeedChange = (speed) => ttsController_1.tts.setSpeed(speed);
    // Uma tecla mantida não representa outro acionamento do ditado.
    let dictationKey = null;
    const dictationCommands = new Set();
    let nativePress = null;
    let keyboardModifiers = null;
    const keyReleases = new Map();
    const eventTime = event => Number.isFinite(event.timeStamp)
        ? performance.timeOrigin + event.timeStamp
        : Date.now();
    const modifierKeys = {Control: 'ctrl', Alt: 'alt', Shift: 'shift', Meta: 'meta'};
    function endsNativePress(event, shortcut) {
        const modifier = modifierKeys[event.key];
        if (modifier && shortcut[modifier]) return true;
        return shortcutMatcher_1.matchesShortcut({
            key: event.key, code: event.code,
            ctrlKey: false, altKey: false, shiftKey: false, metaKey: false
        }, shortcut.key);
    }
    function releaseNativePress() {
        if (!nativePress) return;
        const {commandId} = nativePress;
        nativePress = null;
        void sttController_1.stt.sendLiveMessage({
            type: 'STT_SHORTCUT_RELEASE', payload: {commandId}
        }).catch(error => sttController_1.stt.reportRuntimeError(error));
    }
    function rememberModifiers(event) {
        if (event.isTrusted === false) return;
        keyboardModifiers = {ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey};
    }
    window.addEventListener('keydown', rememberModifiers, true);
    window.addEventListener('keyup', event => {
        if (event.isTrusted === false) return;
        if ((event.code || event.key) === dictationKey) dictationKey = null;
        rememberModifiers(event);
        keyReleases.set(event.code || event.key, {key:event.key, code:event.code, at:eventTime(event)});
        if (keyReleases.size > 32) keyReleases.delete(keyReleases.keys().next().value);
        if (nativePress && endsNativePress(event, nativePress.shortcut)) releaseNativePress();
    }, true);
    window.addEventListener('blur', () => {
        dictationKey = null;
        keyboardModifiers = null;
        releaseNativePress();
    });
    // Registro de atalhos de teclado dinâmicos e editáveis da página
    window.addEventListener('keydown', (e) => {
        // 1. Ler texto selecionado (Default: Ctrl+B)
        if ((0, shortcutMatcher_1.matchesShortcut)(e, cachedShortcuts.readSelection || 'Ctrl+B')) {
            const { cleaned } = (0, textExtractor_1.getCleanSelectedText)();
            if (cleaned) {
                e.preventDefault();
                ttsController_1.tts.speakText(cleaned, cachedActiveAgentId);
            }
            return;
        }
        // 2. Pausar / Retomar leitura (Default: Pause / Break)
        if ((0, shortcutMatcher_1.matchesShortcut)(e, cachedShortcuts.togglePause || 'Pause')) {
            e.preventDefault();
            ttsController_1.tts.togglePlayPause();
            return;
        }
        // 3. Iniciar / Parar Ditado por voz (Default: Ctrl+Shift+Espaço)
        if ((0, shortcutMatcher_1.matchesShortcut)(e, cachedShortcuts.startDictation || 'Ctrl+Shift+Space')) {
            e.preventDefault();
            if (e.repeat || dictationKey !== null) return;
            dictationKey = e.code || e.key;
            void sttController_1.stt.toggleRecording(cachedActiveAgentId).catch(error => sttController_1.stt.reportRuntimeError(error));
            return;
        }
        // 4. Iniciar Seleção Gemini Lens por teclado (Default: Ctrl+Shift+L)
        if ((0, shortcutMatcher_1.matchesShortcut)(e, cachedShortcuts.lensSelection || 'Ctrl+Shift+L')) {
            e.preventDefault();
            lensController_1.lens.activateLensMode(cachedActiveAgentId);
            return;
        }
        // 5. Alternar exibição do HUD flutuante (Default: Alt+Shift+H)
        if ((0, shortcutMatcher_1.matchesShortcut)(e, cachedShortcuts.toggleHud || 'Alt+Shift+H')) {
            e.preventDefault();
            hudController_1.hud.toggle();
            return;
        }
    });
    // 5. Ctrl+Shift+Arrastar: Gemini Lens (Seleção retangular na página)
    window.addEventListener('mousedown', (e) => {
        if (e.shiftKey && !e.metaKey && e.button === 0 && (e.ctrlKey !== e.altKey)) {
            e.preventDefault();
            lensController_1.lens.startDragSelection(e.clientX, e.clientY, cachedActiveAgentId, e.altKey?'interpret':'literal');
        }
    });
    // Listener para mensagens vindas do Background / Popup / Menus
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        switch (message.type) {
            case 'HUD_TASK_OPEN': {
                void hudController_1.hud.openTask(message.payload?.jobId).then(()=>sendResponse({success:true}),()=>sendResponse({success:false}));
                return true;
            }
            case 'HUD_GLOBAL_STATE': {
                const state=message.state||message.payload?.state;
                ttsController_1.tts.applyGlobalState?.(state);
                hudController_1.hud.applyGlobalState?.(state);
                sendResponse({success:true});
                break;
            }
            case 'STT_GLOBAL_STOP': {
                const capture=sttController_1.stt.liveCapture;
                if(!capture||capture.jobId!==message.payload?.jobId){sendResponse({success:false,error:'Captura original indisponível.'});break;}
                void sttController_1.stt.stopLiveRecording(capture.jobId,message.payload?.stopReason==='origin-lost'?'origin-lost':'user-stop').then(()=>sendResponse({success:true}),error=>{sttController_1.stt.reportRuntimeError(error);sendResponse({success:false,error:'Falha ao concluir captura original.'});});
                return true;
            }
            case 'STT_GLOBAL_CANCEL': {
                void sttController_1.stt.cancelGlobalJob(message.payload?.jobId).then(
                    ()=>sendResponse({success:true,jobId:message.payload?.jobId,microphoneReleased:true}),
                    error=>{sttController_1.stt.reportRuntimeError(error);sendResponse({success:false});});
                return true;
            }
            case 'STT_GLOBAL_STATUS': {
                sendResponse({success:true,...sttController_1.stt.getJobState(message.payload?.jobId)});
                break;
            }
            case 'CMD_TRANSLATE_SELECTION': {
                const targetText=message.payload?.text||(0,textExtractor_1.getCleanSelectedText)().cleaned;
                void chrome.runtime.sendMessage({type:'TRANSLATE_REQUEST',payload:{text:targetText,agentId:message.payload?.agentId||cachedActiveAgentId}}).then(result=>{
                    if(!result?.success&&!result?.cancelled){hudController_1.hud.setStatus('idle','Erro na tradução');hudController_1.hud.setTextPreview(result?.error||'Falha ao traduzir a seleção.');}
                    sendResponse(result);
                }).catch(error=>{hudController_1.hud.setStatus('idle','Erro na tradução');hudController_1.hud.setTextPreview(error.message||String(error));sendResponse({success:false,error:error.message});});
                return true;
            }
            case 'CMD_READ_SELECTION': {
                const payloadText = message.payload?.text;
                const targetText = payloadText || (0, textExtractor_1.getCleanSelectedText)().cleaned;
                if (targetText) {
                    ttsController_1.tts.speakText(targetText, message.payload?.agentId || cachedActiveAgentId);
                }
                sendResponse({ success: true });
                break;
            }
            case 'CMD_START_DICTATION': {
                try {
                    if (!sttController_1.stt.ensureExtensionContext()) return false;
                    const commandId = message.payload?.commandId;
                    if (commandId && dictationCommands.has(commandId)) {
                        sendResponse({ success: true });
                        break;
                    }
                    if (commandId) {
                        dictationCommands.add(commandId);
                        if (dictationCommands.size > 64) dictationCommands.delete(dictationCommands.values().next().value);
                    }
                    if (commandId && message.payload.shortcut) {
                        const shortcut = shortcutMatcher_1.parseShortcut(
                            message.payload.shortcut.replace(/\bCommand\b/g, 'Meta').replace(/\bMacCtrl\b/g, 'Ctrl')
                        );
                        nativePress = {commandId, shortcut};
                        // A tecla pode ter sido solta enquanto o comando cruzava o service worker.
                        const released = [...keyReleases.values()].some(event =>
                            event.at >= message.payload.startedAt && endsNativePress(event, shortcut));
                        const modifiersUp = keyboardModifiers &&
                            Object.values(modifierKeys).some(key => shortcut[key] && !keyboardModifiers[key]);
                        if (released || modifiersUp) releaseNativePress();
                    }
                    void sttController_1.stt.toggleRecording(message.payload?.agentId || cachedActiveAgentId).catch(error => sttController_1.stt.reportRuntimeError(error));
                    sendResponse({ success: true });
                } catch (error) { sttController_1.stt.reportRuntimeError(error); return false; }
                break;
            }
            case 'TOGGLE_HUD': {
                hudController_1.hud.toggle();
                sendResponse({ success: true });
                break;
            }
            case 'TTS_AUDIO_READY': {
                if (message.payload?.audioBase64) {
                    ttsController_1.tts.playBase64Audio(message.payload.audioBase64, message.payload.mimeType);
                }
                sendResponse({ success: true });
                break;
            }
            case 'STT_RESULT': {
                // Resultados sem job/alvo imutável não autorizam editar a página ativa.
                sendResponse({ success: false, error:'Resultado STT sem alvo original vinculado.' });
                break;
            }
            case 'STT_LIVE_EVENT': {
                try {
                    if (!sttController_1.stt.ensureExtensionContext()) return false;
                    if(message.editorDelivery){
                        void sttController_1.stt.handleLiveEvent(message.payload).then(
                            result=>sendResponse({success:true,result}),
                            error=>{sttController_1.stt.reportRuntimeError(error);sendResponse({success:false});});
                        return true;
                    }
                    void sttController_1.stt.handleLiveEvent(message.payload || {}).catch(error => sttController_1.stt.reportRuntimeError(error));
                    sendResponse({ success: true });
                } catch (error) { sttController_1.stt.reportRuntimeError(error); return false; }
                break;
            }
        }
        return false;
    });
    } catch (error) { sttController_1.stt.reportRuntimeError(error); }
}
// Inicia assim que o script de conteúdo é injetado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
}
else {
    initialize();
}

},
"extension/src/content/ui/hudController.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlador de Ciclo de Vida do HUD flutuante no Shadow DOM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hud = exports.HudController = void 0;
const shadowDomWrapper_1 = __require("extension/src/content/ui/shadowDomWrapper.ts");
class HudController {
    static instance;
    container = null;
    badgeElement = null;
    previewElement = null;
    playPauseBtn = null;
    volumeSlider = null;
    speedSlider = null;
    onPlayPauseClick;
    onStopClick;
    onCloseClick;
    onRecordClick;
    onLensClick;
    onVolumeChange;
    onSpeedChange;
    isDragging = false;
    dragStartX = 0;
    dragStartY = 0;
    posX = 24;
    posY = 24;
    panel = null;
    rail = null;
    waveform = null;
    notices = null;
    telemetry = null;
    telemetryJobId = null;
    motionFrame = 0;
    layoutFrame = 0;
    motion = {x:0,y:0,vx:0,vy:0,time:0};
    reducedMotion = false;
    static getInstance() {
        if (!HudController.instance) {
            HudController.instance = new HudController();
        }
        return HudController.instance;
    }
    init(cssContent) {
        if (this.container)
            return;
        this.cssContent=cssContent;
        shadowDomWrapper_1.shadowDom.injectStyles(cssContent);
        const root = shadowDomWrapper_1.shadowDom.getRoot();
        const wrapper = document.createElement('div');
        wrapper.className = 'ext-hud-card hidden';
        wrapper.setAttribute('data-fm-layout','compact-2');
        wrapper.style.right = `${this.posX}px`;
        wrapper.style.bottom = `${this.posY}px`;
        wrapper.innerHTML = `
      <div class="ext-hud-header" id="ext-drag-handle" tabindex="0" role="group" aria-label="Mover HUD. Use as setas quando esta barra estiver em foco.">
        <span class="ext-hud-glass" aria-hidden="true"></span>
        <button class="ext-btn-icon ext-hud-toggle" id="ext-btn-toggle" type="button" title="Minimizar HUD" aria-label="Minimizar HUD" aria-expanded="true" aria-controls="ext-hud-panel"><svg class="ext-hud-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m13 2-9 12h7l-1 8L21 9h-8z"/></svg></button>
        <div class="ext-hud-title">
          <span>FalaMermo</span>
          <span class="ext-hud-badge idle" id="ext-badge">Pronto</span>
        </div>
        <div id="ext-global-compact" class="fm-global-mini-controls" hidden></div>
        <div class="ext-hud-controls" id="ext-global-emergency">
          <button class="ext-btn-icon" id="ext-btn-options" type="button" title="Abrir Opções" aria-label="Abrir Opções">⚙️</button>
          <button class="ext-btn-icon" id="ext-btn-close" title="Ocultar HUD sem parar tarefas" aria-label="Ocultar HUD sem parar tarefas">✕</button>
        </div>
      </div>
      <div class="ext-hud-notices" id="ext-hud-notices">
        <div class="fm-global-message fm-hud-capture-notice" id="ext-panic-notice" role="status" aria-live="polite"></div>
        <div class="fm-global-message fm-hud-capture-notice" id="ext-capture-notice" role="alert" hidden></div>
        <div class="fm-global-message fm-hud-capture-notice fm-hud-microphone-notice" id="ext-microphone-notice" role="alert" hidden><span></span><button class="ext-btn-icon" type="button" title="Dispensar aviso" aria-label="Dispensar aviso de microfone ocupado">✕</button></div>
      </div>
      <div class="ext-hud-panel" id="ext-hud-panel">
        <span class="ext-hud-glass" aria-hidden="true"></span>
        <button id="ext-resize-handle" type="button" aria-label="Redimensionar HUD. Use as setas." title="Redimensionar HUD (arraste ou use as setas)">⌜</button>
        <div class="ext-hud-body"><div id="ext-global-jobs"></div></div>
      </div>
    `;
        root.appendChild(wrapper);
        this.container = wrapper;
        this.applyTransparency(50);
        this.applyContentTransparency(50);
        // One durable appearance preference; storage events update existing HUDs.
        // It is deliberately separate from per-tab presentation in the registry.
        if(globalThis.chrome?.storage?.local){
            let appearanceRevision=0,sizeRevision=0;
            const changed=(changes,area)=>{if(area!=='local')return;if(changes.hudTransparency||changes.hudContentTransparency)appearanceRevision++;if(changes.hudSize)sizeRevision++;if(changes.hudTransparency)this.applyTransparency(changes.hudTransparency.newValue);if(changes.hudContentTransparency)this.applyContentTransparency(changes.hudContentTransparency.newValue);if(changes.hudSize&&!this.resizing)this.applySize(changes.hudSize.newValue);};
            chrome.storage.onChanged?.addListener(changed);
            const read=()=>{const revision=appearanceRevision,sizeReadRevision=sizeRevision;const failed=()=>this.globalView?.notice('Não foi possível recuperar as preferências do HUD.');try{void chrome.storage.local.get(['hudTransparency','hudContentTransparency','hudSize']).then(saved=>{if(revision===appearanceRevision){this.applyTransparency(saved.hudTransparency);this.applyContentTransparency(saved.hudContentTransparency);}if(sizeReadRevision===sizeRevision&&!this.resizing)this.applySize(saved.hudSize);}).catch(failed);}catch{failed();}};
            window.addEventListener('pageshow',read);read();
        }
        this.panel = wrapper.querySelector('.ext-hud-panel');
        this.rail = wrapper.querySelector('#ext-drag-handle');

        this.notices = wrapper.querySelector('#ext-hud-notices');
        this.setupResize(wrapper);
        wrapper.inert = true;
        const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = motionPreference.matches;
        motionPreference.addEventListener('change', event => { this.reducedMotion=event.matches; if(event.matches)this.resetMotion(); });
        window.addEventListener('resize', () => this.queueLayout());
        window.visualViewport?.addEventListener('resize', () => this.queueLayout());
        window.visualViewport?.addEventListener('scroll', () => this.queueLayout());
        if(typeof ResizeObserver!=='undefined'){
            this.layoutObserver = new ResizeObserver(() => this.queueLayout());
            this.layoutObserver.observe(wrapper);
            this.layoutObserver.observe(this.notices);
        }
        this.badgeElement = wrapper.querySelector('#ext-badge');
        this.previewElement = wrapper.querySelector('#ext-preview');
        this.playPauseBtn = wrapper.querySelector('#ext-btn-play');
        this.volumeSlider = wrapper.querySelector('#ext-vol');
        this.speedSlider = wrapper.querySelector('#ext-speed');
        this.setupListeners(wrapper);
        if(globalThis.GlobalHud){
            this.globalView=globalThis.GlobalHud.mount(wrapper.querySelector('#ext-global-jobs'),{embedded:true,panicContainer:wrapper.querySelector('#ext-global-emergency'),panicNotice:wrapper.querySelector('#ext-panic-notice'),compactControls:wrapper.querySelector('#ext-global-compact'),noticeContainer:this.notices,send:message=>chrome.runtime.sendMessage(message),onState:state=>this.applyGlobalState(state),openTask:jobId=>this.openTask(jobId)});
        }
    }
    openTask(jobId){return globalThis.GlobalHud.openTask(jobId,{doc:document,css:this.cssContent,appearanceSource:this.container,send:message=>chrome.runtime.sendMessage(message)});}
    setupListeners(wrapper) {
        // Capture reaches texts, empty surfaces and controls that stop bubbling.
        wrapper.addEventListener?.('click',()=>this.updateGlobalUi({interaction:true}),true);
        wrapper.querySelector('#ext-microphone-notice button')?.addEventListener('click',()=>this.dismissMicrophoneNotice());
        const handle = wrapper.querySelector('#ext-drag-handle');
        const closeBtn = wrapper.querySelector('#ext-btn-close');
        const minBtn = wrapper.querySelector('#ext-btn-toggle');
        wrapper.querySelector('#ext-btn-options')?.addEventListener('click', event => {
            event.stopPropagation();
            const fail=error=>this.globalView?.notice(/context invalidated/i.test(error?.message||'')?'Extensão atualizada. Atualize esta página (F5).':error?.message||'Não foi possível abrir Opções.');
            try{void chrome.runtime.sendMessage({type:'HUD_OPEN_OPTIONS'}).then(result=>{if(!result?.success)fail(new Error(result?.error||'Não foi possível abrir Opções.'));}).catch(fail);}catch(error){fail(error);}
        });
        const micBtn = wrapper.querySelector('#ext-btn-mic');
        const lensBtn = wrapper.querySelector('#ext-btn-lens');
        const stopBtn = wrapper.querySelector('#ext-btn-stop');
        closeBtn?.addEventListener('click', () => {
            this.hide();
            this.onCloseClick?.();
        });
        minBtn?.addEventListener('click', () => this.updateGlobalUi({toggleMinimized:true}));
        this.playPauseBtn?.addEventListener('click', () => this.onPlayPauseClick?.());
        micBtn?.addEventListener('click', () => this.onRecordClick?.());
        lensBtn?.addEventListener('click', () => this.onLensClick?.());
        stopBtn?.addEventListener('click', () => this.onStopClick?.());
        this.volumeSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.onVolumeChange?.(val);
        });
        this.speedSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.onSpeedChange?.(val);
        });
        // Pointer capture keeps the rail usable with mouse, pen and touch.
        handle?.addEventListener('pointerdown', event => {
            if(event.button!==0||event.target.closest?.('button,input,select,textarea,a,[contenteditable],[data-no-drag]'))return;
            event.preventDefault();
            this.isDragging=true;
            wrapper.dataset.dragging='true';
            let lastX=event.clientX,lastY=event.clientY;
            handle.setPointerCapture(event.pointerId);
            const move=ev=>{
                if(ev.pointerId!==event.pointerId)return;
                this.moveHud(ev.clientX-lastX,ev.clientY-lastY);
                lastX=ev.clientX;lastY=ev.clientY;
            };
            const finish=ev=>{
                if(ev?.pointerId!==undefined&&ev.pointerId!==event.pointerId)return;
                this.isDragging=false;wrapper.dataset.dragging='false';
                window.removeEventListener('pointermove',move);
                window.removeEventListener('pointerup',finish);
                window.removeEventListener('pointercancel',finish);
                window.removeEventListener('blur',finish);
                handle.removeEventListener('lostpointercapture',finish);
                if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
                this.endDrag=null;
                this.queueLayout();
            };
            this.endDrag=finish;
            window.addEventListener('pointermove',move);
            window.addEventListener('pointerup',finish);
            window.addEventListener('pointercancel',finish);
            window.addEventListener('blur',finish);
            handle.addEventListener('lostpointercapture',finish);
        });
        handle?.addEventListener('keydown',event=>{
            if(event.target!==handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
            event.preventDefault();const step=event.shiftKey?1:10;
            this.moveHud(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);
        });
    }
    queueLayout(){
        if(!this.panel||this.layoutFrame)return;
        this.layoutFrame=window.requestAnimationFrame(()=>{this.layoutFrame=0;this.constrainPosition();});
    }
    applyTransparency(raw){
        if(!this.container)return;
        const value=typeof raw==='number'&&Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):50;
        const material=(base,opaque,clear)=>value<=50?base+(opaque-base)*(50-value)/50:base+(clear-base)*(value-50)/50;
        for(const [key,base,opaque,clear]of [
            ['panel',.49,.97,.025],['rail',.44,.97,.035]
        ])this.container.style.setProperty('--hud-'+key+'-alpha',String(Number(material(base,opaque,clear).toFixed(4))));
        this.container.dataset.transparency=String(value);
    }
    applyContentTransparency(raw){
        if(!this.container)return;
        const value=typeof raw==='number'&&Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):50;
        for(const [key,base,opaque,clear]of [['card',.76,.96,.68],['active',.8,.97,.72],['control',.78,.96,.74],['surface',.76,.96,.7],['title',.8,.97,.74],['panic',.8,.96,.75],['transport',.6,.9,.55],['button',.04,.2,.02],['indicator',.055,.16,.025],['muted',.025,.12,.01],['transcript',.17,.4,.08]]){
            const alpha=value<=50?base+(opaque-base)*(50-value)/50:base+(clear-base)*(value-50)/50;
            this.container.style.setProperty('--hud-'+key+'-alpha',String(Number(alpha.toFixed(4))));
        }
        this.container.style.setProperty('--hud-border-strength',String(Number((1-value*.008).toFixed(4))));
        this.container.dataset.contentTransparency=String(value);
    }
    applySize(size){
        if(!this.container||!Number.isFinite(size?.width)||!Number.isFinite(size?.height))return;
        // Keep the preference intact; viewport constraints only affect its rendering.
        const width=Math.max(320,Math.min(10000,size.width)),height=Math.max(260,Math.min(10000,size.height));
        const vw=globalThis.window?.visualViewport?.width||document.documentElement.clientWidth,vh=globalThis.window?.visualViewport?.height||document.documentElement.clientHeight;
        this.hudSize={width,height};this.container.dataset.resized='true';
        this.container.style.setProperty('--hud-width',Math.min(width,vw-24)+'px');this.container.style.setProperty('--hud-height',Math.min(height,vh-48)+'px');
        this.queueLayout();
    }
    queueSizeSave(){
        if(this.sizeSaveFrame)return;
        this.sizeSaveFrame=window.requestAnimationFrame(()=>{
            this.sizeSaveFrame=0;const size={...this.hudSize};
            try{void chrome.storage.local.set({hudSize:size}).catch(()=>this.globalView?.notice('Não foi possível salvar o tamanho do HUD.'));}catch{this.globalView?.notice('Não foi possível salvar o tamanho do HUD.');}
        });
    }
    setupResize(wrapper){
        const handle=wrapper.querySelector('#ext-resize-handle');
        handle.addEventListener('pointerdown',event=>{
            if(event.button!==0)return;event.preventDefault();event.stopPropagation();this.resetMotion();this.resizing=true;
            const rect=wrapper.getBoundingClientRect(),x=event.clientX,y=event.clientY;
            handle.setPointerCapture(event.pointerId);
            const move=e=>{if(e.pointerId===event.pointerId){this.applySize({width:rect.width+x-e.clientX,height:rect.height+y-e.clientY});this.queueSizeSave();}};
            const end=e=>{if(e.pointerId!==undefined&&e.pointerId!==event.pointerId)return;this.resizing=false;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);handle.removeEventListener('lostpointercapture',end);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);if(this.hudSize)this.updateGlobalUi({size:this.hudSize});};
            window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);handle.addEventListener('lostpointercapture',end);
        });
        handle.addEventListener('keydown',event=>{
            if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const r=wrapper.getBoundingClientRect(),step=event.shiftKey?1:10;
            this.applySize({width:r.width+(event.key==='ArrowLeft'?step:event.key==='ArrowRight'?-step:0),height:r.height+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)});this.updateGlobalUi({size:this.hudSize});
        });
    }
    constrainPosition(){
        if(!this.panel)return;
        if(this.hudSize&&this.container.dataset.minimized!=='true'){const w=(window.visualViewport?.width||document.documentElement.clientWidth)-24,h=(window.visualViewport?.height||document.documentElement.clientHeight)-48;this.container.style.setProperty('--hud-width',Math.min(this.hudSize.width,w)+'px');this.container.style.setProperty('--hud-height',Math.min(this.hudSize.height,h)+'px');}
        const envelope=this.container.getBoundingClientRect(),viewport=window.visualViewport;
        // The preferred size includes empty space above short/collapsed cards.
        // Bound actual surfaces, excluding the panel's temporary elastic transform.
        let rect=envelope;
        if(this.rail&&Number.isFinite(this.panel.offsetHeight)){
            const rail=this.rail.getBoundingClientRect(),expanded=this.container.dataset.minimized!=='true';
            const panel={left:envelope.left+this.panel.offsetLeft,top:envelope.top+this.panel.offsetTop,right:envelope.left+this.panel.offsetLeft+this.panel.offsetWidth,bottom:envelope.top+this.panel.offsetTop+this.panel.offsetHeight};
            rect=expanded?{left:Math.min(rail.left,panel.left),top:Math.min(rail.top,panel.top),right:Math.max(rail.right,panel.right),bottom:Math.max(rail.bottom,panel.bottom)}:{left:rail.left,top:rail.top,right:rail.right,bottom:rail.bottom};
            rect.width=rect.right-rect.left;rect.height=rect.bottom-rect.top;
        }
        const layoutWidth=document.documentElement.clientWidth||window.innerWidth,layoutHeight=document.documentElement.clientHeight||window.innerHeight;
        const width=viewport?.width||layoutWidth,height=viewport?.height||layoutHeight;
        const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
        const x=Math.min(Math.max(left+12,rect.left),Math.max(left+12,left+width-rect.width-12));
        const y=Math.min(Math.max(top+12,rect.top),Math.max(top+12,top+height-rect.height-12));
        // Correct only an actual viewport overflow. Converting every DOM rect
        // back into right/bottom feeds gutter/rounding differences into the anchor.
        const correctionX=x-rect.left,correctionY=y-rect.top;
        if(Math.abs(correctionX)>.01){this.posX-=correctionX;this.container.style.right=this.posX+'px';}
        if(Math.abs(correctionY)>.01){this.posY-=correctionY;this.container.style.bottom=this.posY+'px';}
        // Notices stay reachable even when the narrow rail is dragged to an edge.
        const notice=this.notices.getBoundingClientRect();
        let noticeX=Math.max(left+12,Math.min(x+rect.width-notice.width,left+width-notice.width-12));
        let noticeY=Math.max(top+12,Math.min(y-notice.height-8,top+height-notice.height-12));
        if(notice.height&&y-notice.height-8<top+12){
            // Near the top edge, use a side instead of covering the lightning/panic controls.
            if(x-notice.width-8>=left+12){noticeX=x-notice.width-8;noticeY=Math.min(y,top+height-notice.height-12);}
            else if(x+rect.width+notice.width+8<=left+width-12){noticeX=x+rect.width+8;noticeY=Math.min(y,top+height-notice.height-12);}
            else if(y+rect.height+8+notice.height<=top+height-12)noticeY=y+rect.height+8;
        }
        this.notices.style.left=noticeX+'px';this.notices.style.top=Math.max(top+12,noticeY)+'px';
    }
    moveHud(dx,dy){
        const previousX=this.posX,previousY=this.posY;
        this.posX-=dx;this.posY-=dy;
        this.container.style.right=this.posX+'px';this.container.style.bottom=this.posY+'px';
        this.constrainPosition();
        if(this.reducedMotion||this.globalMinimized)return;
        this.motion.x=Math.max(-18,Math.min(18,this.motion.x+(this.posX-previousX)*.65));
        this.motion.y=Math.max(-18,Math.min(18,this.motion.y+(this.posY-previousY)*.65));
        if(!this.motionFrame){this.motion.time=0;this.motionFrame=window.requestAnimationFrame(time=>this.animatePanel(time));}
    }
    animatePanel(time){
        const m=this.motion,dt=Math.min(.032,(time-m.time)/1000||.016);m.time=time;
        m.vx+=(-210*m.x-20*m.vx)*dt;m.vy+=(-210*m.y-20*m.vy)*dt;
        m.x+=m.vx*dt;m.y+=m.vy*dt;
        const rect=this.container.getBoundingClientRect(),panelHeight=this.panel.offsetHeight;
        const viewport=window.visualViewport,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||document.documentElement.clientWidth,height=viewport?.height||document.documentElement.clientHeight;
        const x=Math.max(left+12-rect.left,Math.min(left+width-12-(rect.right-this.rail.offsetWidth-10),m.x));
        const y=Math.max(top+12-(rect.bottom-panelHeight),Math.min(top+height-12-rect.bottom,m.y));
        this.panel.style.transform=`translate3d(${x}px,${y}px,0) rotate(${Math.max(-.8,Math.min(.8,x*.04))}deg)`;
        this.container.dataset.moving='true';
        if(Math.abs(m.x)+Math.abs(m.y)+Math.abs(m.vx)+Math.abs(m.vy)<.08){this.resetMotion();return;}
        this.motionFrame=window.requestAnimationFrame(next=>this.animatePanel(next));
    }
    resetMotion(){
        if(this.motionFrame)window.cancelAnimationFrame(this.motionFrame);
        this.motionFrame=0;this.motion={x:0,y:0,vx:0,vy:0,time:0};
        if(this.panel)this.panel.style.transform='';
        if(this.container)this.container.dataset.moving='false';
    }
    setStatus(badge, label) {
        if(typeof this.globalView?.notice==='function'){
            if(/Atualize|Falha|Erro|Selecione|Nenhum PCM/i.test(label||'')){this.localNotice=true;this.globalView.notice(label);}
            else if(['loading','recording','playing'].includes(badge)){this.localNotice=false;this.globalView.notice('');}
        }
        if(globalThis.GlobalHud&&Number.isFinite(this.globalRevision)&&label!=='Atualize a página')return;
        if (this.badgeElement) {
            this.badgeElement.className = `ext-hud-badge ${badge}`;
            this.badgeElement.textContent = label;
        }
    }
    setTextPreview(text) {
        if(this.localNotice&&typeof this.globalView?.notice==='function'){this.globalView.notice(text);return;}
        if (this.previewElement) {
            this.previewElement.textContent = text || 'Nenhum texto selecionado.';
        }
    }
    setCaptureNotice(text) {
        if(text&&typeof text==='object'){return this.setCaptureTelemetry(text);}
        if(!text)this.setCaptureTelemetry(null);
        const notice=this.container?.querySelector('#ext-capture-notice');
        if(!notice)return;
        notice.hidden=!text;
        notice.textContent=text;
        this.queueLayout();
    }
    showMicrophoneBusyNotice(message) {
        if(this.microphoneNoticeTimer)return; // Repeated conflicts never blink or restart the deadline.
        const notice=this.container?.querySelector('#ext-microphone-notice');
        if(!notice)return;
        notice.querySelector('span').textContent=message||'O microfone já está sendo usado por outro ditado.';
        notice.hidden=false;
        // Keep this explicitly requested error reachable for its complete lifetime.
        this.updateGlobalUi({visible:true});
        this.microphoneNoticeTimer=setTimeout(()=>this.dismissMicrophoneNotice(),8000);
        this.queueLayout();
    }
    dismissMicrophoneNotice() {
        clearTimeout(this.microphoneNoticeTimer);this.microphoneNoticeTimer=null;
        const notice=this.container?.querySelector('#ext-microphone-notice');
        if(notice){notice.hidden=true;notice.querySelector('span').textContent='';}
        this.queueLayout();
    }
    setCaptureTelemetry(sample){
        // Same authoritative task and origin-checked capture channel as other metrics.
        // A null sample ends local display only; retain final values on its task.
        if(!sample?.jobId)return;
        try{return chrome.runtime.sendMessage({type:'HUD_CAPTURE_STATE',payload:{jobId:sample.jobId,captureTelemetry:sample}}).then(result=>{if(result?.success&&result.state)this.applyGlobalState(result.state);}).catch(()=>{});}catch{}
    }
    setPlayingState(isPlaying) {
        const label = this.container?.querySelector('#ext-play-label');
        if (label) {
            label.textContent = isPlaying ? '⏸ Pausar' : '▶ Ouvir';
        }
        if (isPlaying) {
            this.setStatus('playing', 'Lendo');
        }
        else {
            this.setStatus('idle', 'Pausado');
        }
    }
    show({tabOnly=false,expand=false,manual=false}={}) {
        const revealLocally=()=>{
            // Messaging may be unavailable after an extension reload. Keep the
            // error notice reachable without opening a previously compact panel.
            if(globalThis.GlobalHud&&(this.globalMinimized!==false||this.container?.classList.contains?.('hidden'))){
                this.globalMinimized=true;
                this.container?.setAttribute?.('data-minimized','true');
                for(const element of this.container?.querySelectorAll?.('.ext-hud-body')||[]){element.hidden=true;element.inert=true;}
                if(this.panel)this.panel.inert=true;
                const button=this.container?.querySelector?.('#ext-btn-toggle');
                if(button){button.title='Restaurar HUD';button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',button.title);}
            }
            this.container?.classList.remove('hidden');
            if(this.container)this.container.inert=false;
            this.queueLayout();
        };
        if(globalThis.GlobalHud){
            // Automatic opening uses the registry so it cannot flash an expanded
            // panel or override a manual presentation choice in this tab.
            return this.updateGlobalUi({visible:true,minimized:true,...(!manual?{automatic:true}:{}),...(tabOnly?{scope:'tab'}:{})},revealLocally);
        }
        // Keep the original local opening for errors before a job exists,
        // including invalidated contexts where messaging is unavailable.
        revealLocally();
    }
    hide() {
        if(!globalThis.GlobalHud){this.container?.classList.add('hidden');if(this.container)this.container.inert=true;return;}
        this.updateGlobalUi({visible:false});
    }
    updateGlobalUi(payload,onFailure){
        if(!globalThis.GlobalHud)return;
        const fail=error=>{this.globalView?.notice(/context invalidated/i.test(error?.message||'')?'Extensão atualizada. Atualize esta página (F5).':error?.message||'Não foi possível atualizar o HUD.');onFailure?.();};
        try{return chrome.runtime.sendMessage({type:'HUD_GLOBAL_UI_SET',payload:{...payload,scope:'tab'}}).then(result=>{if(result?.success&&result.state)this.applyGlobalState(result.state);else fail(new Error(result?.error||'Comando não confirmado.'));}).catch(fail);}catch(error){fail(error);}
    }
    applyGlobalState(state){
        if(!state||Number.isFinite(this.globalRevision)&&state.revision<this.globalRevision)return;
        this.globalRevision=state.revision;this.globalMinimized=state.minimized===true;
        this.container?.setAttribute?.('data-minimized',String(this.globalMinimized));
        this.container?.classList.toggle('hidden',state.visible===false);
        if(this.container)this.container.inert=state.visible===false;
        for(const element of this.container?.querySelectorAll('.ext-hud-body')||[]){element.hidden=this.globalMinimized;element.inert=this.globalMinimized;}
        if(this.panel){this.panel.inert=this.globalMinimized;if(this.globalMinimized||state.visible===false){this.endDrag?.();this.resetMotion();}this.queueLayout();}
        const jobs=state.jobs||[];
        const recording=jobs.filter(job=>job.type==='STT'&&job.status==='recording'&&job.microphoneReleased!==true).length;
        const playing=jobs.filter(job=>{const audio=job.type==='STT'?job.narration:job;return audio?.status==='playing'||audio?.status==='connecting'&&audio.progress?.outputActive===true;}).length;
        const active=jobs.filter(job=>!['ready','completed','error','cancelled','paused'].includes(job.status)).length;
        const paused=jobs.some(job=>job.status==='paused'||job.narration?.status==='paused');
        const failed=jobs.some(job=>job.status==='error'||job.narration?.status==='error');
        const phase=recording?'recording':playing?'playing':active?'loading':paused?'paused':failed?'error':'idle';
        if(this.rail){this.rail.dataset.state=phase;const border=globalThis.GlobalHud?.activeBorder?.(jobs);this.rail.dataset.taskType=border?.type||'neutral';this.rail.dataset.taskRunning=String(border?.running===true);this.rail.dataset.borderJobId=border?.jobId||'';}
        const badge=this.badgeElement;
        if(badge){badge.textContent=recording||playing?[recording?recording+' gravando':'',playing?playing+' narrando':''].filter(Boolean).join(' · '):active?active+' em andamento':paused?'Pausado':failed?'Erro':'Pronto';badge.dataset.state=phase;badge.className='ext-hud-badge '+phase;}
        const button=this.container?.querySelector('#ext-btn-toggle');
        if(button){button.title=this.globalMinimized?'Restaurar HUD':'Minimizar HUD';button.setAttribute('aria-expanded',String(!this.globalMinimized));button.setAttribute('aria-label',button.title);}
        this.globalView?.update(state);
    }
    toggle() {
        if (this.container?.classList.contains('hidden')) {
            this.show({manual:true});
        }
        else {
            this.hide();
        }
    }
}
exports.HudController = HudController;
exports.hud = HudController.getInstance();

},
"extension/src/content/ui/shadowDomWrapper.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shadow DOM Wrapper para isolamento estrito de estilos do HUD flutuante.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shadowDom = exports.ShadowDomWrapper = void 0;
class ShadowDomWrapper {
    static instance;
    hostElement;
    shadowRoot;
    constructor() {
        let host = document.getElementById('ext-tts-stt-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'ext-tts-stt-host';
            document.documentElement.appendChild(host);
        }
        this.hostElement = host;
        this.shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });
    }
    static getInstance() {
        if (!ShadowDomWrapper.instance) {
            ShadowDomWrapper.instance = new ShadowDomWrapper();
        }
        return ShadowDomWrapper.instance;
    }
    getRoot() {
        return this.shadowRoot;
    }
    injectStyles(cssText) {
        const style = document.createElement('style');
        style.textContent = cssText;
        this.shadowRoot.appendChild(style);
    }
}
exports.ShadowDomWrapper = ShadowDomWrapper;
exports.shadowDom = ShadowDomWrapper.getInstance();

},
"extension/src/content/audio/backgroundAudio.ts":function(module,exports,__require){
Object.defineProperty(exports, '__esModule', { value: true });
class BackgroundAudio extends EventTarget {
    isBackgroundAudio = true;
    playerId = `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    serial = 0;
    requestId = '';
    source = '';
    live = false;
    state = { currentTime: 0, duration: NaN, paused: true, ended: false, seq: -1 };
    timestamp = Date.now();
    currentVolume = 1;
    currentRate = 1;
    error = null;
    constructor() {
        super();
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type !== 'TTS_PLAYBACK_EVENT' || message.payload?.playerId !== this.playerId) return false;
            if(message.payload.status)this.apply(message.payload.status, message.payload.event);
            if(message.payload.event==='status')this.dispatchEvent(new CustomEvent('livestatus',{detail:message.payload.status}));
            sendResponse({ success: true });
            return false;
        });
    }
    reserve() {
        this.live = false;
        this.requestId = `${this.playerId}:${++this.serial}`;
        this.state = { currentTime: 0, duration: NaN, paused: true, ended: false, seq: -1 };
        this.timestamp = Date.now();
        this.error = null;
        return { playerId: this.playerId, requestId: this.requestId, volume: this.currentVolume, playbackRate: this.currentRate };
    }
    apply(status, event) {
        if (!status || status.requestId !== this.requestId || status.seq <= this.state.seq) return;
        this.state = { ...status, duration: status.duration ?? NaN };
        this.timestamp = Date.now();
        this.error = status.error;
        if (['play', 'pause', 'ended', 'error'].includes(event)) this.dispatchEvent(new Event(event));
    }
    adopt(src, status) {
        this.source = src;
        this.apply(status);
    }
    get src() { return this.source; }
    set src(value) { this.source = value; this.reserve(); }
    get paused() { return this.state.paused; }
    get ended() { return this.state.ended; }
    get duration() { return this.state.duration; }
    get currentTime() {
        const elapsed = this.paused || this.ended ? 0 : (Date.now() - this.timestamp) / 1000 * this.currentRate;
        const value = this.state.currentTime + elapsed;
        return Number.isFinite(this.duration) ? Math.min(value, this.duration) : value;
    }
    set currentTime(value) {
        this.state.currentTime = Math.max(0, Number(value) || 0);
        this.timestamp = Date.now();
        this.state.ended = false;
        this.control('SEEK', { currentTime: this.state.currentTime }).catch(() => {});
    }
    get volume() { return this.currentVolume; }
    set volume(value) { this.currentVolume = value; this.control('SET', { volume: value }).catch(() => {}); }
    get playbackRate() { return this.currentRate; }
    set playbackRate(value) {
        this.state.currentTime = this.currentTime;
        this.timestamp = Date.now();
        this.currentRate = value;
        this.control('SET', { playbackRate: value }).catch(() => {});
    }
    async control(operation, extra = {}) {
        if (!this.requestId) return { success: true };
        const response = await chrome.runtime.sendMessage({ type: 'TTS_PLAYBACK_COMMAND', payload: {
            operation, playerId: this.playerId, requestId: this.requestId, ...extra,
        } });
        if (!response?.success) throw new Error(response?.error || 'Falha ao controlar o áudio.');
        return response;
    }
    async play() {
        const requestId = this.requestId;
        if (!this.src && !this.live) throw new Error('Áudio indisponível.');
        const response = await this.control(this.live ? 'RESUME' : 'PLAY', { ...(this.live ? {} : {src:this.src}), currentTime: this.currentTime,
            volume: this.currentVolume, playbackRate: this.currentRate,
        });
        if (this.requestId !== requestId) throw new Error('Reprodução cancelada.');
        this.apply(response.status, 'play');
    }
    pause() {
        this.state.currentTime = this.currentTime;
        this.timestamp = Date.now();
        this.state.paused = true;
        this.dispatchEvent(new Event('pause'));
        this.control('PAUSE').catch(() => {});
    }
    cancel() { this.reserve(); this.requestId = ''; this.source = ''; }
}
exports.BackgroundAudio = BackgroundAudio;

},
"extension/src/content/controllers/ttsController.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlador de Text-to-Speech (TTS) no Content Script da Extensão Chrome.
 * - Fila FIFO real de síntese e reprodução.
 * - Auto-play imediato ao sintetizar.
 * - Suporte a Replay ilimitado com o botão 'Ouvir' preservando o áudio sintetizado.
 * - Ciclo de vida robusto: Sintetizando -> Lendo -> Concluído.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tts = exports.TtsController = void 0;
const pcmWav_1 = __require("shared/utils/pcmWav.ts");
const hudController_1 = __require("extension/src/content/ui/hudController.ts");
const MAX_BASE64_AUDIO_LENGTH = 15 * 1024 * 1024; // 15MB
class TtsController {
    audio = null;
    queue = [];
    activeTask = null;
    isProcessing = false;
    isFetchingChunk = false;
    nextTaskId = 1;
    isPaused = false;
    volume = 1.0;
    playbackRate = 1.0;
    constructor() {
        this.audio = typeof chrome.runtime.getURL === 'function' && chrome.runtime.onMessage?.addListener
            ? new (__require("extension/src/content/audio/backgroundAudio.ts").BackgroundAudio)()
            : new Audio();
        this.setupAudioListeners();
        this.debugTiming=false;
        chrome.storage?.local?.get?.('ttsDebugEnabled')?.then?.(settings=>{this.debugTiming=settings.ttsDebugEnabled===true;}).catch(()=>{});
        chrome.storage?.onChanged?.addListener?.((changes,area)=>{if(area==='local'&&changes.ttsDebugEnabled)this.debugTiming=changes.ttsDebugEnabled.newValue===true;});
    }
    setupAudioListeners() {
        if (!this.audio)
            return;
        this.audio.addEventListener('ended', () => {
            this.handleChunkEnded();
        });
        this.audio.addEventListener('error', (e) => {
            console.error('[TTS Controller] Erro no elemento de áudio nativo:', e);
            this.isPaused = false;
            hudController_1.hud.setPlayingState(false);
            hudController_1.hud.setStatus('idle', 'Erro no áudio');
            const task = this.activeTask;
            const reason = this.audio?.error?.message || `código ${this.audio?.error?.code || 'desconhecido'}`;
            hudController_1.hud.setTextPreview(`❌ Falha no áudio: ${reason}`);
            if (task)
                this.finishTaskAndAdvance(task);
        });
        this.audio.addEventListener('pause', () => {
            if (this.audio && this.audio.currentTime < this.audio.duration && !this.audio.ended) {
                this.isPaused = true;
                hudController_1.hud.setPlayingState(false);
            }
        });
        this.audio.addEventListener('playing',()=>{if(!this.audio.isBackgroundAudio)this.activeTask?.trace?.mark("AUDIO_STARTED",{reason:"evento nativo playing"});});
        this.audio.addEventListener('loadeddata',()=>this.activeTask?.trace?.mark("AUDIO_LOAD_END"));
        this.audio.addEventListener('play', () => {
            this.isPaused = false;
            hudController_1.hud.setPlayingState(true);
        });
    }
    /**
     * Adiciona um novo pedido de fala à fila FIFO sem interromper tarefas anteriores.
     */
    async speakText(text, agentId, startedAt=Date.now()) {
        const rawText = text?.trim();
        if (!rawText)
            return;
        if(this.audio?.isBackgroundAudio&&globalThis.GlobalHud){
            const playerId='hud-tts-'+crypto.randomUUID(),playback={playerId,requestId:playerId+':1'};
            const task={rawText,agentId,playback,paused:false};this.latestGlobalTask=task;this.activeTask=task;hudController_1.hud.show();
            // Cada narração ganha player/request próprios. Não reservar o singleton cancela outra sessão.
            await new Promise(resolve=>{try{chrome.runtime.sendMessage({type:'TTS_REQUEST',payload:{text:rawText,agentId,playback,startedAt}},response=>{
                if(response?.cancelled){task.stopped=true;resolve();return;}
                if(chrome.runtime.lastError||!response?.success){task.failed=true;if(this.latestGlobalTask===task){hudController_1.hud.setStatus('idle','Erro TTS');hudController_1.hud.setTextPreview(chrome.runtime.lastError?.message||response?.error||'Falha ao iniciar narração.');}}
                resolve();
            });}catch(error){task.failed=true;console.error('[TTS start]',error?.message||String(error));resolve();}});return;
        }
        // Envia o texto inteiro ao background, sem dividir a narração em trechos.
        const chunks = [rawText];
        const task = {
            id: this.nextTaskId++,
            rawText,
            agentId,
            chunks,
            currentChunkIndex: 0,
            chunkBlobs: new Map(),
        };
        this.queue.push(task);
        hudController_1.hud.show();
        if (!this.isProcessing) {
            await this.processNextInQueue();
        }
    }
    /**
     * Processa a próxima tarefa da fila FIFO em ordem.
     */
    async processNextInQueue() {
        const nextTask = this.queue[0];
        // O último áudio concluído fica apenas como replay, fora da fila.
        if (this.activeTask && this.activeTask !== nextTask)
            this.releaseTaskAudio(this.activeTask);
        if (this.queue.length === 0) {
            this.activeTask = null;
            this.isProcessing = false;
            return;
        }
        this.isProcessing = true;
        this.activeTask = this.queue[0];
        this.activeTask.currentChunkIndex = 0;
        hudController_1.hud.setStatus('loading', 'Sintetizando');
        hudController_1.hud.setTextPreview(this.activeTask.chunks[0]);
        await this.fetchAndPlayChunk(this.activeTask, 0);
    }
    /**
     * Busca e reproduz com auto-play o chunk da tarefa ativa.
     */
    async fetchAndPlayChunk(task, chunkIdx) {
        if (this.activeTask !== task || chunkIdx >= task.chunks.length)
            return;
        const trace=globalThis.TtsConfig?.createTrace({enabled:this.debugTiming||globalThis.__ttsDebug===true,context:"content"});
        task.trace=trace;trace?.mark("CONTENT_ACTION");
        const chunkText = task.chunks[chunkIdx];
        hudController_1.hud.setTextPreview(chunkText);
        // Se já tiver o áudio em cache para este chunk
        const existingUrl = task.chunkBlobs.get(chunkIdx);
        if (existingUrl) {
            this.playObjectUrl(existingUrl, task, chunkIdx);
            return;
        }
        hudController_1.hud.setStatus('loading', 'Sintetizando');
        this.isFetchingChunk = true;
        const playback = this.audio?.isBackgroundAudio ? this.audio.reserve() : undefined;
        try {
            trace?.mark("MESSAGE_SENT");
            chrome.runtime.sendMessage({
                type: 'TTS_REQUEST',
                payload: { text: chunkText, agentId: task.agentId, ...(trace?{trace:trace.packet()}:{}), ...(playback ? { playback } : {}) },
            }, (response) => {
                // Se a tarefa ativa mudou ou foi limpa
                if (this.activeTask !== task || task.currentChunkIndex !== chunkIdx) {
                    return;
                }
                this.isFetchingChunk = false;
                if (chrome.runtime.lastError) {
                    console.error('[TTS Controller] Erro de runtime:', chrome.runtime.lastError.message);
                    hudController_1.hud.setStatus('idle', 'Erro de conexão');
                    this.finishTaskAndAdvance(task);
                    return;
                }
                if (!response || !response.success || (!response.data?.audioBase64 && !response.data?.live)) {
                    const err = response?.error || 'Falha na resposta do Service Worker';
                    console.error('[TTS Controller]', err);
                    if (err.includes('Chave')) {
                        hudController_1.hud.setStatus('idle', 'Chave Ausente');
                        hudController_1.hud.setTextPreview('⚠️ Chave de API Gemini não configurada. Abra as Opções da Extensão para configurar.');
                    }
                    else {
                        hudController_1.hud.setStatus('idle', 'Erro TTS');
                        hudController_1.hud.setTextPreview(`❌ Erro: ${err}`);
                    }
                    this.finishTaskAndAdvance(task);
                    return;
                }
                if(response.data.live){this.audio.live=true;this.audio.source='';if(this.audio.paused)hudController_1.hud.setStatus('loading','Gerando áudio');return;}
                if(response.data.trace&&trace){trace.enabled=true;trace.merge(response.data.trace);trace.mark("MESSAGE_RETURNED");}
                const { audioBase64, mimeType } = response.data;
                trace?.mark("BLOB_START");
                const url = this.createBlobUrlFromBase64(audioBase64, mimeType || 'audio/wav');
                trace?.mark(this.audio?.isBackgroundAudio?'BLOB_NOT_USED':'BLOB_END',{reason:this.audio?.isBackgroundAudio?'data URL, áudio já iniciado no offscreen':'Blob criado para player local'});
                if (url) {
                    task.chunkBlobs.set(chunkIdx, url);
                    this.playObjectUrl(url, task, chunkIdx, response.data.playback);
                }
                else {
                    hudController_1.hud.setStatus('idle', 'Erro no áudio');
                    hudController_1.hud.setTextPreview('❌ O Gemini retornou áudio inválido ou acima do limite permitido.');
                    this.finishTaskAndAdvance(task);
                }
            });
        }
        catch (err) {
            this.isFetchingChunk = false;
            console.error('[TTS Controller] Erro ao despachar TTS_REQUEST:', err);
            hudController_1.hud.setStatus('idle', 'Erro');
            this.finishTaskAndAdvance(task);
        }
    }
    createBlobUrlFromBase64(base64, mimeType) {
        if (!base64 || typeof base64 !== 'string' || base64.length > MAX_BASE64_AUDIO_LENGTH) {
            return null;
        }
        try {
            const rawBytes = (0, pcmWav_1.base64ToUint8Array)(base64);
            if (rawBytes.length < 44)
                return null;
            if (this.audio?.isBackgroundAudio) {
                const clean = base64.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
                return `data:${mimeType};base64,${clean}`;
            }
            const blob = new Blob([rawBytes], { type: mimeType });
            return URL.createObjectURL(blob);
        }
        catch (err) {
            console.error('[TTS Controller] Falha ao criar Blob:', err);
            return null;
        }
    }
    playObjectUrl(objectUrl, task, chunkIdx, playback) {
        if (!this.audio || this.activeTask !== task)
            return;
        if (playback?.started && this.audio.isBackgroundAudio) {
            this.audio.adopt(objectUrl, playback);
            if (this.audio.ended) return;
        }
        else {task.trace?.mark("AUDIO_LOAD_START");this.audio.src = objectUrl;}
        this.audio.volume = this.volume;
        this.audio.playbackRate = this.playbackRate;
        const playbackRequestId = this.audio.isBackgroundAudio ? this.audio.requestId : null;
        if(!playback?.started)task.trace?.mark("PLAY_CALLED");
        const playPromise = playback?.started ? Promise.resolve() : this.audio.play();
        playPromise
            .then(() => {
            if (this.activeTask !== task || task.currentChunkIndex !== chunkIdx || (playbackRequestId && this.audio.requestId !== playbackRequestId))
                return;
            this.isPaused = false;
            hudController_1.hud.setPlayingState(true);
            const chunkNum = chunkIdx + 1;
            const total = task.chunks.length;
            hudController_1.hud.setStatus('playing', total > 1 ? `Lendo (${chunkNum}/${total})` : 'Lendo');
        })
            .catch((err) => {
            if (this.activeTask !== task || task.currentChunkIndex !== chunkIdx || (playbackRequestId && this.audio.requestId !== playbackRequestId))
                return;
            console.warn('[TTS Controller] Autoplay aguardando interação do usuário:', err);
            hudController_1.hud.setPlayingState(false);
            hudController_1.hud.setStatus('idle', 'Clique em Ouvir');
        });
    }
    handleChunkEnded() {
        if (!this.activeTask) {
            // Áudio recebido diretamente, sem tarefa na fila de síntese.
            this.isPaused = false;
            hudController_1.hud.setPlayingState(false);
            hudController_1.hud.setStatus('idle', 'Concluído');
            hudController_1.hud.hide();
            return;
        }
        const task = this.activeTask;
        const nextIdx = task.currentChunkIndex + 1;
        if (nextIdx < task.chunks.length) {
            task.currentChunkIndex = nextIdx;
            this.fetchAndPlayChunk(task, nextIdx);
        }
        else {
            // Tarefa atual concluída
            hudController_1.hud.setPlayingState(false);
            hudController_1.hud.setStatus('idle', 'Concluído');
            this.isPaused = false;
            // Uma tarefa concluída nunca participa do próximo pedido de leitura.
            const idx = this.queue.indexOf(task);
            if (idx !== -1)
                this.queue.splice(idx, 1);
            // Se houver mais tarefas na fila, avança
            if (this.queue.length > 0) {
                this.processNextInQueue();
            }
            else {
                // Preserva só a tarefa ativa em cache para replay manual.
                this.isProcessing = false;
                // Oculta apenas após a última narração da fila.
                hudController_1.hud.hide();
            }
        }
    }
    releaseTaskAudio(task) {
        task.chunkBlobs.forEach((url) => URL.revokeObjectURL(url));
        task.chunkBlobs.clear();
    }
    finishTaskAndAdvance(task) {
        if (this.activeTask === task) {
            const idx = this.queue.indexOf(task);
            if (idx !== -1) {
                this.queue.splice(idx, 1);
            }
            this.releaseTaskAudio(task);
            this.activeTask = null;
            this.isFetchingChunk = false;
            this.processNextInQueue();
        }
    }
    /**
     * Alterna entre Play/Pause ou executa Replay do início se já concluído.
     * Não realiza nova requisição à API ao repetir.
     */
    togglePlayPause() {
        if(globalThis.GlobalHud){try{void chrome.runtime.sendMessage({type:'HUD_GLOBAL_TOGGLE',payload:{}}).catch(error=>console.error('[Global playback]',error?.name||'Error'));}catch(error){console.error('[Global playback]',error?.name||'Error');}return;}
        if(this.latestGlobalTask){const task=this.latestGlobalTask;if(task.failed||task.stopped)return;task.paused=!task.paused;this.controlGlobalTask(task.paused?'PAUSE':'RESUME');return;}
        if (!this.audio || this.isFetchingChunk)
            return;
        if (this.audio.live && !this.audio.ended) {
            if (this.audio.paused) this.audio.play().catch(console.error);
            else this.audio.pause();
            return;
        }
        if (!this.isProcessing && this.activeTask) {
            // Replay é iniciado explicitamente e mantém pedidos novos aguardando.
            this.isProcessing = true;
            this.activeTask.currentChunkIndex = 0;
            this.fetchAndPlayChunk(this.activeTask, 0);
            return;
        }
        if (this.audio.src) {
            if (this.audio.ended || this.audio.currentTime >= (this.audio.duration - 0.1 || 0)) {
                // Replay desde o início
                this.audio.currentTime = 0;
                if (this.activeTask) {
                    this.activeTask.currentChunkIndex = 0;
                    const firstUrl = this.activeTask.chunkBlobs.get(0);
                    if (firstUrl && this.audio.src !== firstUrl) {
                        this.audio.src = firstUrl;
                    }
                }
                this.audio.play()
                    .then(() => {
                    this.isPaused = false;
                    hudController_1.hud.setPlayingState(true);
                    hudController_1.hud.setStatus('playing', 'Lendo');
                })
                    .catch(console.error);
                return;
            }
            if (this.audio.paused) {
                this.audio.play()
                    .then(() => {
                    this.isPaused = false;
                    hudController_1.hud.setPlayingState(true);
                    hudController_1.hud.setStatus('playing', 'Lendo');
                })
                    .catch(console.error);
            }
            else {
                this.audio.pause();
                this.isPaused = true;
                hudController_1.hud.setPlayingState(false);
                hudController_1.hud.setStatus('idle', 'Pausado');
            }
            return;
        }
        if (this.queue.length > 0 && !this.isProcessing) {
            this.processNextInQueue();
        }
    }
    playBase64Audio(base64, mimeType = 'audio/wav') {
        const url = this.createBlobUrlFromBase64(base64, mimeType);
        if (!url || !this.audio)
            return;
        this.audio.src = url;
        this.audio.volume = this.volume;
        this.audio.playbackRate = this.playbackRate;
        this.audio.play().then(() => {
            hudController_1.hud.setPlayingState(true);
            hudController_1.hud.setStatus('playing', 'Lendo');
        }).catch(console.error);
    }
    /**
     * Para a reprodução explicitamente e limpa a fila de tarefas.
     */
    stop() {
        if(this.latestGlobalTask){this.latestGlobalTask.stopped=true;this.controlGlobalTask('STOP');return;}
        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }
        // Revoga URLs Blob criadas para liberar memória
        const tasks = new Set(this.queue);
        if (this.activeTask)
            tasks.add(this.activeTask);
        for (const task of tasks)
            this.releaseTaskAudio(task);
        this.audio?.cancel?.();
        this.queue = [];
        this.activeTask = null;
        this.isProcessing = false;
        this.isFetchingChunk = false;
        this.isPaused = false;
        hudController_1.hud.setPlayingState(false);
        hudController_1.hud.setStatus('idle', 'Parado');
        try {
            chrome.runtime.sendMessage({ type: 'TTS_STOP', ...(this.audio?.isBackgroundAudio ? { payload: { playerId: this.audio.playerId } } : {}) }).catch(() => { });
        }
        catch { }
    }
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if(this.latestGlobalTask){this.controlGlobalTask('SET',{volume:this.volume});return;}
        if (this.audio)
            this.audio.volume = this.volume;
    }
    setSpeed(speed) {
        this.playbackRate = Math.max(0.5, Math.min(2.0, speed));
        if(this.latestGlobalTask){this.controlGlobalTask('SET',{playbackRate:this.playbackRate});return;}
        if (this.audio)
            this.audio.playbackRate = this.playbackRate;
    }
    applyGlobalState(state){
        const task=this.latestGlobalTask;
        const job=task&&state?.jobs?.find(job=>job.requestId===task.playback.requestId);
        if(job&&['cancelling','cancelled'].includes(job.status)){
            task.stopped=true;
            this.latestGlobalTask=null;
            if(this.activeTask===task)this.activeTask=null;
        }
    }
    controlGlobalTask(operation,extra={}){const task=this.latestGlobalTask;if(!task)return;try{void chrome.runtime.sendMessage({type:'TTS_PLAYBACK_COMMAND',payload:{operation,playerId:task.playback.playerId,requestId:task.playback.requestId,...extra}}).then(response=>{if(!response?.success)throw Error(response?.error||'Falha ao controlar narração.');}).catch(error=>console.error('[TTS control]',error?.message||String(error)));}catch(error){console.error('[TTS control]',error?.message||String(error));}}
}
exports.TtsController = TtsController;
exports.tts = new TtsController();

},
"shared/utils/textCleaner.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Funções puras de higienização, normalização e particionamento de texto para TTS/STT.
 * Totalmente agnóstico de DOM ou navegador (regex puras).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanTextForTts = cleanTextForTts;
exports.splitTextIntoChunks = splitTextIntoChunks;
exports.sanitizeDictatedText = sanitizeDictatedText;
/**
 * Remove tags HTML, marcações markdown, URLs prolixas e caracteres não-pronunciáveis
 * para produzir uma leitura fluida e natural no TTS.
 */
function cleanTextForTts(rawText) {
    if (!rawText || typeof rawText !== 'string')
        return '';
    let text = rawText;
    // 1. Remove tags HTML (<div ...>, </span>, etc.)
    text = text.replace(/<[^>]*>/g, ' ');
    // 2. Remove URLs completas (substitui por menção breve ou remove)
    text = text.replace(/https?:\/\/[^\s$.?#].[^\s]*/gi, '');
    // 3. Remove sintaxe Markdown (cabeçalhos #, asteriscos de negrito/itálico, crases de código)
    text = text.replace(/^#+\s+/gm, ''); // Headers Markdown
    text = text.replace(/[*_~`]{1,3}([^*_~`]+)[*_~`]{1,3}/g, '$1'); // Negrito / Itálico
    text = text.replace(/```[\s\S]*?```/g, ' [Bloco de código omitido] '); // Blocos de código
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Links Markdown [Texto](url) -> Texto
    // 4. Normaliza quebras de linha e espaçamentos repetidos
    text = text.replace(/[\r\n]+/g, '. ');
    text = text.replace(/\s{2,}/g, ' ');
    // 5. Normaliza pontuações repetidas (ex: "?????" -> "?", "......" -> "...")
    text = text.replace(/([.!?]){2,}/g, '$1');
    return text.trim();
}
/**
 * Divide textos extensos em blocos menores respeitando fronteiras de sentenças,
 * evitando que frases sejam cortadas no meio durante a síntese de áudio.
 */
function splitTextIntoChunks(text, maxChunkLength = 800) {
    const clean = text.trim();
    if (clean.length <= maxChunkLength) {
        return clean.length > 0 ? [clean] : [];
    }
    const chunks = [];
    // Divide por finalizadores de frases (. ! ? ou quebras)
    const sentences = clean.split(/(?<=[.!?])\s+/);
    let currentChunk = '';
    for (const sentence of sentences) {
        if ((currentChunk + ' ' + sentence).trim().length <= maxChunkLength) {
            currentChunk = (currentChunk + ' ' + sentence).trim();
        }
        else {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }
            // Se uma única sentença for maior que maxChunkLength, divide por vírgulas ou palavras
            if (sentence.length > maxChunkLength) {
                const words = sentence.split(/\s+/);
                let subChunk = '';
                for (const word of words) {
                    if (word.length > maxChunkLength) {
                        if (subChunk.length > 0)
                            chunks.push(subChunk);
                        subChunk = '';
                        // Limita também palavras/trechos sem espaços, sem cortar pares Unicode.
                        for (const character of word) {
                            if (subChunk.length + character.length > maxChunkLength) {
                                chunks.push(subChunk);
                                subChunk = '';
                            }
                            subChunk += character;
                        }
                        continue;
                    }
                    if ((subChunk + ' ' + word).trim().length <= maxChunkLength) {
                        subChunk = (subChunk + ' ' + word).trim();
                    }
                    else {
                        if (subChunk.length > 0)
                            chunks.push(subChunk);
                        subChunk = word;
                    }
                }
                currentChunk = subChunk;
            }
            else {
                currentChunk = sentence;
            }
        }
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    return chunks;
}
/**
 * Formata e limpa o texto resultante de transcrição STT para inserção fluida
 * em campos de formulário e editores de texto.
 */
function sanitizeDictatedText(rawDictation) {
    if (!rawDictation || typeof rawDictation !== 'string')
        return '';
    let text = rawDictation.trim();
    // Garante inicial maiúscula se for início de frase
    if (text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
    }
    // Ajusta espaçamento ao redor de vírgulas, pontos e dois pontos
    text = text.replace(/\s+([.,;:!?])/g, '$1');
    text = text.replace(/([.,;:!?])(?=[a-zA-Z0-9À-ÿ])/g, '$1 ');
    return text;
}

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
"extension/src/content/controllers/sttController.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlador de Speech-to-Text (STT) no Content Script.
 * - Fila FIFO real de transcrição: novos pedidos não cancelam os anteriores.
 * - Normalização estrita de mimeType para 'audio/webm' (sem ;codecs=opus) evitando HTTP 400.
 * - Injeção segura no campo de texto ativo.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stt = exports.SttController = void 0;
const hudController_1 = __require("extension/src/content/ui/hudController.ts");
const inputInjector_1 = __require("extension/src/content/dom/inputInjector.ts");
const diagnosticLogger_1 = __require("extension/src/services/diagnosticLogger.ts");
class SttController {
    mediaRecorder = null;
    audioChunks = [];
    isRecording = false;
    targetElement = null;
    activeStream = null;
    // Fila FIFO de transcrições
    queue = [];
    isProcessingStt = false;
    nextTaskId = 1;
    contextInvalidated = false;
    contextWatch = null;
    liveJobs = new Map();
    completedJobs = new Map();
    insertionMode = 'final';
    ensureExtensionContext() {
        if (this.contextInvalidated) return false;
        try {
            if (!chrome.runtime?.id) throw new Error('Extension context invalidated.');
            chrome.runtime.getManifest();
            return true;
        } catch (error) {
            if (!/extension context invalidated/i.test(error?.message || String(error))) throw error;
            this.invalidateExtensionContext();
            return false;
        }
    }
    invalidateExtensionContext() {
        globalThis.LiveSttDiagnostics?.ending(this.liveCapture,'context-invalidated');
        this.contextInvalidated = true;
        this.cancelRecording(false);
        hudController_1.hud.show();
        hudController_1.hud.setStatus('idle', 'Atualize a página');
        hudController_1.hud.setTextPreview('A extensão foi recarregada ou desconectada desta aba. Atualize a página (F5) antes de ditar novamente.');
    }
    reportRuntimeError(error) {
        if (/extension context invalidated/i.test(error?.message || String(error))) {
            this.invalidateExtensionContext();
            return;
        }
        console.error('[STT lifecycle]', error);
        if (!this.contextInvalidated) {
            hudController_1.hud.setStatus('idle', 'Erro STT');
            hudController_1.hud.setTextPreview(error?.message || String(error));
        }
    }
    clearContextWatch() {
        if (this.contextWatch !== null) clearInterval(this.contextWatch);
        this.contextWatch = null;
    }
    async sendLiveMessage(message) {
        const diagnostic=globalThis.FalaDiagnostics?.start('chrome','capture-message',message.payload?.jobId,{messageType:message.type});let diagnosticCode;
        try {
            if (!this.ensureExtensionContext()) throw new Error('Extension context invalidated.');
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            diagnosticCode='MESSAGE_FAILED';
            if (/extension context invalidated/i.test(error?.message || String(error))) this.invalidateExtensionContext();
            throw error;
        }finally{globalThis.FalaDiagnostics?.finish(diagnostic,{},diagnosticCode);}
    }
    cancelLiveJob(jobId) {
        // Cleanup local precede o envio: sendMessage também pode lançar antes de retornar uma Promise.
        if (!jobId || this.contextInvalidated) return;
        void this.sendLiveMessage({type:'STT_LIVE_CANCEL',payload:{jobId,playerId:jobId}}).catch(error => {
            if (/extension context invalidated/i.test(error?.message || String(error))) this.reportRuntimeError(error);
            else console.error('[STT cancel]', error); // Não altera o HUD de um job posterior.
        });
    }
    constructor() {
        const remember = () => {
            if (this.contextInvalidated || this.liveCapture) return;
            const target = (0, inputInjector_1.captureDictationTarget)();
            if (target) this.lastDictationTarget = target;
        };
        if (typeof document !== 'undefined') {
            document.addEventListener?.('focusin', remember, true);
            document.addEventListener?.('selectionchange', remember);
            document.addEventListener?.('pointerdown', remember, true);
        }
        if (typeof window !== 'undefined') window.addEventListener?.('pagehide', () => {
            for(const job of this.liveJobs.values())job.insertion?.invalidate('TARGET_DOCUMENT_LOST');
            // Não mover a captura ao perder foco. Navegação real invalida só o destino original.
            if(this.liveCapture)void this.stopLiveRecording(this.liveCapture.jobId,'origin-lost').catch(error=>this.reportRuntimeError(error));
        });
    }
    async toggleRecording(agentId) {
        if (this.liveCapture?.stopping || this.liveCapture?.releasing) return;
        if (this.isRecording || this.liveCapture?.starting) {
            await this.stopLiveRecording();
        }
        else if (!this.liveCapture) {
            await this.startLiveRecording(agentId);
        }
    }
    async startLiveRecording(agentId) {
        if (this.liveCapture) return;
        if (!this.ensureExtensionContext()) return;
        hudController_1.hud.setCaptureNotice('');
        this.targetSelection=(0,inputInjector_1.captureDictationTarget)()||this.lastDictationTarget;
        this.targetElement=this.targetSelection?.element||null;
        if(!this.targetElement){hudController_1.hud.setStatus('idle','Selecione um campo editável');return;}
        const jobId=crypto.randomUUID(),generation=(this.liveGeneration||0)+1;
        this.liveJobId=jobId;this.liveGeneration=generation;this.liveTranscript='';this.liveCommitted='';this.resampleCursor=0;this.resamplePrevious=0;
        let settleAdmission;
        const admission=new Promise(resolve=>{settleAdmission=resolve;});
        const capture={jobId,generation,admission,startedAt:Date.now(),starting:true,pending:Promise.resolve()};this.liveCapture=capture;
        const job={jobId,generation,capture,target:this.targetSelection,committed:'',partial:'',mode:this.insertionMode,cancelled:false,insertion:new globalThis.DictationRuntime.SessionInsertion(this.targetSelection,{normalize:text=>(0,inputInjector_1.normalizeDictatedText)(text),onSend:()=>job.mode==='realtime'?this.cutDictationSegment(capture):undefined,onManual:()=>job.mode==='realtime'?this.cutDictationSegment(capture):undefined})};this.liveJobs.set(jobId,job);
        globalThis.LiveSttDiagnostics?.capture(capture,'starting');
        hudController_1.hud.show({tabOnly:true});hudController_1.hud.setStatus('loading','Conectando ditado');hudController_1.hud.setTextPreview('Aguarde “Gravando” antes de falar.');
        const current=()=>this.liveCapture===capture&&this.liveGeneration===generation&&!capture.releasing;
        // Uma recarga pode não produzir outro callback Chrome. Vigia apenas o job ativo, sem reconectar.
        this.contextWatch=setInterval(()=>{try{this.ensureExtensionContext();}catch(error){this.cancelRecording(true,'transport-error');this.reportRuntimeError(error);}},1000);
        try {
            if(this.preferencesReady)await this.preferencesReady;
            if(!current()||!this.ensureExtensionContext())return;
            if(this.preferencesError)throw new Error('Não foi possível ler a preferência de inserção. Reabra as opções e confirme o modo antes de ditar.');
            job.mode=this.insertionMode;
            globalThis.LiveSttDiagnostics?.capture(capture,'starting',{insertionMode:job.mode});
            capture.reservation=this.sendLiveMessage({type:'STT_CAPTURE_RESERVE',payload:{jobId,agentId,startedAt:capture.startedAt,localVad:true}});
            const reservation=await capture.reservation;
            if(!current())return;
            capture.reservation=null;
            if(reservation?.code==='STT_CAPTURE_BUSY'){
                this.cancelRecording(false,'startup-error');
                hudController_1.hud.showMicrophoneBusyNotice(reservation.error);
                return;
            }
            if(!reservation?.success)throw new Error(reservation?.error||'Não foi possível reservar o microfone.');
            capture.reserved=true;
            hudController_1.hud.dismissMicrophoneNotice?.();
            if(!globalThis.GlobalHud)hudController_1.hud.show({tabOnly:true,expand:true});
            for(const previous of this.liveJobs.values()){
                if(previous.generation<generation&&previous.target?.element===job.target.element)previous.insertion.invalidate('TARGET_CHANGED');
            }
            settleAdmission();
            capture.openingMic=navigator.mediaDevices.getUserMedia({audio:{channelCount:1}}).then(stream=>capture.stream=stream);
            const stream=await capture.openingMic;
            if(!current()){stream.getTracks().forEach(track=>track.stop());return;}
            this.activeStream=stream;
            globalThis.LiveSttDiagnostics?.capture(capture,'microphone-open');
            const ctx=new AudioContext({latencyHint:'interactive'});capture.context=ctx;this.liveAudioContext=ctx;
            const [opened]=await Promise.all([
                this.sendLiveMessage({type:'STT_LIVE_START',payload:{jobId,playerId:jobId,generation,agentId,realtime:job.mode==='realtime',chunked:true,distributed:true,editorDelivery:true}}),
                ctx.audioWorklet.addModule(chrome.runtime.getURL('mic-capture-worklet.js'))
            ]);
            if(!current()){this.cancelLiveJob(jobId);return;}
            if(!opened?.success)throw new Error(opened?.error||'Falha ao abrir STT Live.');
            job.transform=job.mode!=='realtime'&&opened.transform===true;
            globalThis.LiveSttDiagnostics?.capture(capture,'setup-complete',{insertionMode:job.mode,transform:job.transform});
            if(!this.ensureExtensionContext())return;
            if(!current()||!this.ensureExtensionContext())return;
            const source=ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(ctx,'gemini-mic-capture',{channelCount:1,channelCountMode:'explicit',outputChannelCount:[1]}),mute=ctx.createGain();mute.gain.value=0;capture.source=source;capture.node=node;capture.mute=mute;this.liveCaptureNode=node;
            globalThis.LiveSttDiagnostics?.capture(capture,'worklet-ready');
            capture.audioQueue=new globalThis.DictationRuntime.AudioQueue({metrics:capture.metrics||(capture.metrics={}),send:payload=>this.sendLiveMessage({type:'STT_LIVE_AUDIO',payload}),onFailure:error=>{globalThis.LiveSttDiagnostics?.ending(capture,error.stopReason||(error.code==='ACK_TIMEOUT'?'ack-timeout':error.code==='BACKPRESSURE'?'backpressure':'queue-error'));globalThis.LiveSttDiagnostics?.capture(capture,error.code==='ACK_TIMEOUT'?'ack-timeout':'error',{outcome:error.code==='ACK_TIMEOUT'?'ACK_TIMEOUT':'CONNECTION'});return this.handleLiveEvent({jobId,generation,event:'stt-error',error:error.code==='ACK_TIMEOUT'?'O envio de PCM não recebeu confirmação em 10 segundos. O ditado foi interrompido; consulte o diagnóstico STT.':error.message||String(error)});},onProgress:()=>{
                if(!capture.lastDiagnosticAt||Date.now()-capture.lastDiagnosticAt>=1000){capture.lastDiagnosticAt=Date.now();globalThis.LiveSttDiagnostics?.capture(capture,'capture-progress');this.publishCapture(job,capture.released?undefined:capture.stopping?'flushing':'recording');}
            }});
            capture.chunker=new globalThis.SttRealtime.CapturePipeline({jobId,realtime:true,continuous:true,adaptive:job.mode==='realtime',submitAudioChunk:packet=>this.submitAudioChunk(capture,packet),onDiagnostic:packet=>globalThis.LiveSttDiagnostics?.capture(capture,packet.stage,packet)});
            if(opened.localVad)this.attachLocalVad(capture);
            else throw Error('A dupla confirmação Silero + TEN não foi disponibilizada.');
            node.port.onmessage=event=>{
                if(event.data?.type==='flushed'){if(capture.segmentCut){const cut=capture.segmentCut;capture.segmentCut=null;clearTimeout(cut.timer);const close=()=>{capture.chunker?.closeChunk('silence');return capture.chunker?.sequence;};if(capture.vad)capture.vad.barrier(close).then(cut.resolve,cut.reject);else cut.resolve(close());return;}capture.flushAcknowledged=true;capture.flushed?.();return;}
                if(!current()||(capture.vad&&capture.stopping&&capture.flushAcknowledged))return;
                try{
                const final=event.data?.type==='vad-final-pcm',input=new Float32Array(final?event.data.pcm:event.data),pcm=this.resamplePcm16(input,ctx.sampleRate,16000);if(!pcm.length)return;if(globalThis.LiveSttDiagnostics?.observe)globalThis.LiveSttDiagnostics.observe(capture,input,pcm);else{const m=capture.metrics;m.capturedBytes=(m.capturedBytes||0)+pcm.byteLength;m.captureChunks=(m.captureChunks||0)+1;m.capturedFrames=(m.capturedFrames||0)+input.length;}let raw='';if(!capture.chunker)for(let i=0;i<pcm.length;i+=0x8000)raw+=String.fromCharCode(...pcm.subarray(i,i+0x8000));const audioBase64=capture.chunker?undefined:btoa(raw);
                if(capture.vad)capture.vad.push(pcm,final);else if(capture.chunker)throw Error('Dupla confirmação indisponível.');else capture.audioQueue.push({jobId,playerId:jobId,generation,audioBase64,sampleRate:16000},pcm.byteLength);capture.pending=capture.audioQueue.tail;
                this.liveAudioPending=capture.pending;
                }catch(error){void Promise.resolve().then(()=>capture.audioQueue.onFailure(error)).catch(failure=>this.reportRuntimeError(failure));}
            };
            capture.unwatch=globalThis.DictationRuntime.watchCapture(capture,{onFailure:error=>capture.audioQueue.onFailure(error),onState:()=>globalThis.LiveSttDiagnostics?.capture(capture,'capture-state')});
            const resumed=ctx.resume().then(()=>null,error=>error);
            if(capture.vad)await capture.vad.preparation;
            if(!current()||!this.ensureExtensionContext())return;
            source.connect(node).connect(mute).connect(ctx.destination);
            const resumeError=await resumed;if(!current()||!this.ensureExtensionContext())return;
            if(resumeError)throw resumeError;
            if(ctx.state!=='running')throw new Error('AudioContext do microfone não está running: '+ctx.state);
            globalThis.LiveSttDiagnostics?.capture(capture,'capture-running');
            capture.starting=false;this.isRecording=true;hudController_1.hud.setStatus('recording','Gravando');hudController_1.hud.setTextPreview('Transcrevendo enquanto você fala. Use o atalho novamente para concluir.');
            this.publishCapture(job,'recording');
        } catch(error){if(/extension context invalidated/i.test(error?.message||String(error))){this.invalidateExtensionContext();return;}if(this.liveJobId===jobId){this.cancelRecording(true,'startup-error');if(this.contextInvalidated)return;hudController_1.hud.setStatus('idle','Falha no STT Live');hudController_1.hud.setTextPreview(error.message||String(error));}}
        finally {settleAdmission();}
    }
    attachLocalVad(capture){
        const {CaptureVad,SETTING}=globalThis.SttVadLocal;
        const pipeline=capture.chunker;
        const send=(operation,extra)=>this.sendLiveMessage({
            type:'STT_LOCAL_VAD',
            ...(['analyze','close'].includes(operation)?{target:'offscreen'}:{}),
            payload:{operation,jobId:capture.jobId,generation:capture.generation,...extra},
        });
        let closed=false,opening;
        capture.closeVad=(rollback=false)=>{
            if(closed)return;
            closed=true;
            try{chrome.storage.onChanged.removeListener(changed);}catch{/* contexto liberado */}
            // O fechamento não pode ultrapassar o registro assíncrono da captura.
            void Promise.resolve(opening).catch(()=>{}).then(()=>send('close',{rollback})).catch(()=>{});
        };
        pipeline.config.preRollMs=800;
        const vad=capture.vad=new CaptureVad({jobId:capture.jobId,
            analyze:({pcm,seq,final})=>send('analyze',{seq,final,clientSentAt:performance.timeOrigin+performance.now(),pcm:btoa(String.fromCharCode(...pcm))}),
            consume:(pcm,decision)=>pipeline.push(pcm,decision.base||Boolean((pipeline.chunk||pipeline.pendingActivityEnd)&&decision.continuation),decision),
            recover:()=>{opening=send('open');return opening;},
            preserve:packets=>send('preserve',{packets:packets.map(item=>({pcm:btoa(String.fromCharCode(...item.pcm)),captureStartMs:item.captureStartMs,captureEndMs:item.captureEndMs}))}).then(result=>{if(!result?.ok)throw Error('PCM não preservado.');}),
            onDecision:(decision,metrics)=>{
                const e=decision.evidence||{};
                if(decision.base&&!capture.firstVoiceAt){
                    capture.firstVoiceAt=Date.now();
                    globalThis.LiveSttDiagnostics?.mark?.(capture.jobId,'stt-first-voice',{timelineAt:capture.firstVoiceAt});
                }
                hudController_1.hud.setCaptureNotice({jobId:capture.jobId,sileroProbability:e.sileroProbability,tenProbability:e.tenProbability,confirmed:!!decision.base,recoveries:metrics.recoveries});
                globalThis.LiveSttDiagnostics?.capture(capture,'vad-decision',{detector:'dual',...e,deadlines:metrics.deadlines,recoveries:metrics.recoveries});
            },
            onFallback:reason=>{
                if(reason==='preserving'){capture.unwatch?.();capture.node?.disconnect();capture.source?.disconnect();capture.stream?.getTracks().forEach(track=>track.stop());}
                const detail=capture.vad.metrics.fallbackAt||{};
                globalThis.LiveSttDiagnostics?.capture(capture,reason==='recovered'?'vad-recovered':'vad-fallback',{
                    detector:'dual',vadFallbackReason:reason,vadSequence:detail.sequence,vadElapsedMs:detail.elapsedMs,
                    deadlines:capture.vad.metrics.deadlines,recoveries:capture.vad.metrics.recoveries,
                });
                hudController_1.hud.setCaptureNotice(reason==='recovered'?'Silero + TEN recuperados.':'Silero + TEN: '+reason+' · PCM em buffer, envio aguardando validação.');
            },
            onFailure:error=>void Promise.resolve().then(()=>capture.audioQueue.onFailure(error)).catch(failure=>this.reportRuntimeError(failure)),
        });
        const changed=(changes,area)=>{
            // A seleção antiga de RMS não autoriza mais o envio de áudio.
        };
        chrome.storage.onChanged.addListener(changed);
        globalThis.LiveSttDiagnostics?.capture(capture,'vad-selected',{detector:'hybrid'});
        opening=send('open');
        vad.prepare(opening).then(ready=>{
            if(ready)globalThis.LiveSttDiagnostics?.capture(capture,'vad-ready',{detector:'hybrid'});
        });
        void chrome.storage.local.get(SETTING).then(settings=>{
            // O fluxo usa sempre confirmação Silero + TEN.
        }).catch(()=>vad.fallback('prepare'));
    }
    cutDictationSegment(capture){
        if(capture.released||capture.stopping||!capture.node)return capture.chunker?.sequence;
        if(capture.segmentCut)return capture.segmentCut.promise;
        const cut={};
        cut.promise=new Promise((resolve,reject)=>{cut.resolve=resolve;cut.reject=reject;});
        cut.timer=setTimeout(()=>{if(capture.segmentCut===cut)capture.segmentCut=null;cut.reject(Error('AudioWorklet não confirmou a fronteira do segmento. O transcript permanece no card.'));},1000);
        capture.segmentCut=cut;
        try{capture.node.port.postMessage({type:'flush'});}catch(error){clearTimeout(cut.timer);capture.segmentCut=null;cut.reject(error);}
        return cut.promise;
    }
    async releaseLiveCapture(capture=this.liveCapture){
        if(!capture)return;
        if(capture.releasing)return capture.releasing;
        globalThis.LiveSttDiagnostics?.ending(capture,capture.stopping?'user-stop':'transport-error');
        capture.unwatch?.();
        if(capture.segmentCut){const cut=capture.segmentCut;capture.segmentCut=null;clearTimeout(cut.timer);cut.resolve(capture.chunker?.sequence);}
        const clearCapture=()=>{
            if(this.liveCapture!==capture)return;
            this.liveCapture=null;this.isRecording=false;this.activeStream=null;this.liveCaptureNode=null;this.liveAudioContext=null;this.liveJobId=null;this.clearContextWatch();
        };
        const release=()=>{
            capture.stream?.getTracks().forEach(track=>track.stop());
            capture.vad?.cancel();
            capture.closeVad?.();
            capture.chunker?.cancel();
            if(capture.node)capture.node.port.onmessage=null;
            for(const resource of [capture.node,capture.source,capture.mute]){try{resource?.disconnect();}catch(error){console.error('[STT cleanup]',error);}}
            capture.released=true;
            const ack=capture.reserved&&this.publishCapture({jobId:capture.jobId,capture});
            if(!ack)clearCapture();
            const closed=Promise.resolve().then(()=>capture.context?.close()).catch(error=>console.error('[STT cleanup]',error));
            return Promise.all([Promise.resolve(ack).then(clearCapture),closed]).then(()=>globalThis.LiveSttDiagnostics?.capture(capture,'capture-released',{flushAcknowledged:capture.flushAcknowledged===true}));
        };
        // getUserMedia não é abortável. Uma resposta tardia precisa ter suas trilhas encerradas antes da liberação.
        if(capture.openingMic&&!capture.stream)capture.releasing=capture.openingMic.catch(()=>{}).then(release);
        else if(capture.reservation&&!capture.reserved)capture.releasing=capture.reservation.catch(()=>null).then(result=>{capture.reserved=result?.success===true;return release();});
        else capture.releasing=release();
        return capture.releasing;
    }
    publishCapture(job,status){
        if(!job||this.contextInvalidated)return;
        const m=job.capture?.metrics||{};
        return this.sendLiveMessage({type:'HUD_CAPTURE_STATE',payload:{jobId:job.jobId,status,capturedChunks:m.captureChunks||0,capturedBytes:m.capturedBytes||0,forwardedChunks:m.forwardedChunks||0,forwardedBytes:m.forwardedBytes||0,pendingChunks:m.pendingChunks||0,microphoneReleased:job.capture?.released===true}}).catch(error=>{if(this.liveGeneration===job.capture?.generation)this.reportRuntimeError(error);else console.error('[STT capture state]',error);});
    }
    submitAudioChunk(capture,packet){
        if(capture.released||this.liveJobs.get(capture.jobId)?.cancelled)return;
        const pcm=packet.pcm;let raw='';for(let i=0;i<pcm.length;i+=0x8000)raw+=String.fromCharCode(...pcm.subarray(i,i+0x8000));
        capture.audioQueue.push({jobId:capture.jobId,playerId:capture.jobId,generation:capture.generation,sampleRate:16000,...(packet.activityEndOnly?{activityEndOnly:true,packetSequence:packet.packetSequence}:packet.endOnly?{endOnly:true}:{audioBase64:btoa(raw)}),chunk:packet.chunk},pcm.byteLength);
    }
    getJobState(jobId){const remembered=this.completedJobs.get(jobId);if(remembered)return{found:true,...remembered};const job=this.liveJobs.get(jobId),capture=job?.capture||(this.liveCapture?.jobId===jobId?this.liveCapture:null);return capture?{found:true,status:job?.finishing?'inserting':capture.released?'waiting':capture.starting?'connecting':'recording',microphoneReleased:capture.released===true}:{found:false};}
    rememberJobResult(jobId,result){this.completedJobs.set(jobId,{...result,status:result.inserted?'completed':'insertion-failed',microphoneReleased:true});while(this.completedJobs.size>32)this.completedJobs.delete(this.completedJobs.keys().next().value);}
    async stopLiveRecording(requestedJobId,stopReason='user-stop'){
        if(!this.ensureExtensionContext())return;
        const capture=this.liveCapture;if(!capture||capture.stopping||capture.releasing||requestedJobId&&capture.jobId!==requestedJobId)return;
        capture.stopping=true;
        globalThis.LiveSttDiagnostics?.ending(capture,stopReason);
        if(capture.starting){this.cancelRecording(true,stopReason);if(!this.contextInvalidated)hudController_1.hud.setStatus('idle','Parado');return;}
        try {
        this.isRecording=false;
        const job=this.liveJobs.get(capture.jobId);this.publishCapture(job,'flushing');hudController_1.hud.setStatus('loading','Finalizando envio');
        globalThis.LiveSttDiagnostics?.capture(capture,'capture-stopping');
        const flushed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{capture.metrics.flushTimeouts=(capture.metrics.flushTimeouts||0)+1;reject(Object.assign(Error('O AudioWorklet não confirmou o flush do PCM. Resultado pode estar incompleto.'),{code:'FLUSH_TIMEOUT'}));},1000);capture.flushed=()=>{clearTimeout(timer);resolve();};capture.node.port.postMessage({type:'flush',...(capture.vad?.mode==='hybrid'?{vadFinal:true}:{})});});
        capture.stream.getTracks().forEach(track=>track.stop());await flushed;if(capture.vad)await capture.vad.barrier(()=>capture.chunker.finish());else capture.chunker?.finish();await this.releaseLiveCapture(capture);globalThis.LiveSttDiagnostics?.capture(capture,'queue-draining');await capture.audioQueue.drain();
        if(!job||job.cancelled||!this.liveJobs.has(capture.jobId))return;
        globalThis.LiveSttDiagnostics?.capture(capture,'capture-released',{flushAcknowledged:capture.flushAcknowledged===true});
        if(capture.metrics&&!capture.metrics.capturedBytes){job.cancelled=true;job.insertion.invalidate('NO_CAPTURE');job.insertion.dispose();this.liveJobs.delete(job.jobId);this.cancelLiveJob(job.jobId);void globalThis.LiveSttDiagnostics?.emit({jobId:capture.jobId,scope:'result',stage:'error',outcome:'NO_CAPTURE'});if(this.liveGeneration===capture.generation){hudController_1.hud.setStatus('idle','Nenhum PCM capturado');hudController_1.hud.setTextPreview('O microfone abriu, mas o worklet não entregou amostras. Verifique dispositivo, permissão e AudioContext.');}return;}
        this.publishCapture(job,'waiting');if(this.liveGeneration===capture.generation)hudController_1.hud.setStatus('loading','Aguardando Gemini');
        const result=await this.sendLiveMessage({type:'STT_LIVE_STOP',payload:{jobId:capture.jobId,playerId:capture.jobId,generation:capture.generation,stopReason}});if(!result?.success)throw new Error(result?.error||'Falha ao finalizar ditado.');}
        catch(error){if(this.contextInvalidated||/extension context invalidated/i.test(error?.message||'')){this.invalidateExtensionContext();return;}if(error.code==='FLUSH_TIMEOUT')globalThis.LiveSttDiagnostics?.capture(capture,'flush-timeout',{outcome:'FLUSH_TIMEOUT'});await this.handleLiveEvent({jobId:capture.jobId,generation:capture.generation,event:'stt-error',error:error.message});}
    }
    async cancelGlobalJob(jobId){
        const job=this.liveJobs.get(jobId);
        const capture=job?.capture||(this.liveCapture?.jobId===jobId?this.liveCapture:null);
        if(job&&!job.cancelled){
            globalThis.LiveSttDiagnostics?.ending(capture,'remote-cancel');
            job.cancelled=true;
            capture?.audioQueue?.close();
            job.insertion.invalidate('CANCELLED');
            job.insertion.dispose();
        }
        if(capture){
            await this.releaseLiveCapture(capture);
            if(capture.context&&capture.context.state!=='closed')await capture.context.close();
        }
        if(!job||this.liveJobs.get(jobId)!==job)return;
        this.liveJobs.delete(jobId);
        this.completedJobs.set(jobId,{status:'cancelled',inserted:false,reason:'CANCELLED',microphoneReleased:true});
        while(this.completedJobs.size>32)this.completedJobs.delete(this.completedJobs.keys().next().value);
        if(this.liveGeneration===job.generation){
            hudController_1.hud.setStatus('idle','Parado · cancelado');
            hudController_1.hud.setTextPreview([job.committed,job.partial].filter(Boolean).join(' ')||'Ditado cancelado.');
        }
    }
    async handleLiveEvent(payload){
        const job=this.liveJobs.get(payload.jobId);
        if(!job){const result=this.completedJobs.get(payload.jobId);if(result?.revision===payload.eventSeq)return result;return;}
        if(job.cancelled||payload.generation!==undefined&&payload.generation!==job.generation)return;
        if(Number.isInteger(payload.eventSeq)){
            const clock=payload.editorDelivery?'editorEventSeq':'eventSeq';
            if(payload.eventSeq<=job[clock])return job.insertionResult?.revision===payload.eventSeq?job.insertionResult:undefined;
            job[clock]=payload.eventSeq;
        }
        if(!this.ensureExtensionContext())return;
        const showLegacy=()=>this.liveGeneration===job.generation;
        if(payload.event==='stt-cancelled'){
            await this.cancelGlobalJob(job.jobId);
            return;
        }
        if(payload.event==='stt-partial'||payload.event==='stt-segment'){
            if(typeof payload.confirmedText==='string'){job.committed=payload.confirmedText;job.partial=payload.partialText||'';}
            else if(payload.event==='stt-segment'){job.committed=[job.committed,payload.text].filter(Boolean).join(' ');job.partial='';}
            else job.partial=payload.text||'';
            if(showLegacy()){this.liveCommitted=job.committed;this.liveTranscript=job.partial;hudController_1.hud.setStatus(this.isRecording?'recording':'loading',job.partial?'Transcrição provisória':'Transcrição confirmada');hudController_1.hud.setTextPreview([job.committed,job.partial].filter(Boolean).join(' '));}
            if(job.mode==='realtime'&&!job.transform)return this.insertJobText(job,[job.committed,job.partial].filter(Boolean).join(' '),false,payload);
            if(payload.editorDelivery)return{revision:payload.eventSeq,final:false,inserted:false,reason:'WAITING_FINAL'};
        }
        if(payload.event==='stt-warning'&&showLegacy())hudController_1.hud.setStatus(this.isRecording?'recording':'loading',payload.warning);
        if(payload.event==='stt-status'&&showLegacy())hudController_1.hud.setStatus(this.isRecording?'recording':'loading',payload.status);
        if(payload.event==='stt-transform-attempt'&&job.mode!=='realtime'){job.transform=true;this.publishCapture(job,'transforming');if(showLegacy())hudController_1.hud.setStatus('loading','Transformando');}
        if(payload.event==='stt-error'||payload.event==='stt-final'){
            globalThis.LiveSttDiagnostics?.ending(job.capture,payload.event==='stt-final'?'final-result':payload.stopReason||'transport-error');
            if(job.finishing)return;job.finishing=true;await this.releaseLiveCapture(job.capture);if(job.cancelled||!this.ensureExtensionContext())return;
            if(payload.event==='stt-error'){job.capture?.audioQueue?.close();this.publishCapture(job,'error');if(showLegacy()){hudController_1.hud.setStatus('idle','Erro STT');hudController_1.hud.setTextPreview(payload.error||'Falha no ditado. O texto recebido continua no cartão da tarefa.');}this.cancelLiveJob(payload.jobId);job.insertion.dispose();this.liveJobs.delete(job.jobId);return;}
            const text=payload.text||job.committed;this.publishCapture(job,'inserting');if(showLegacy())hudController_1.hud.setStatus('loading','Inserindo');const result=await this.insertJobText(job,text,true,payload);if(job.cancelled)return;
            this.rememberJobResult(job.jobId,result);
            if(!payload.editorDelivery)this.publishCapture(job,result.inserted?'completed':'insertion-failed');
            if(showLegacy()){hudController_1.hud.setStatus('idle',payload.outcome==='NO_SPEECH'?'Parado · sem fala confirmada':result.inserted?'Parado · texto inserido':'Parado · texto não inserido');hudController_1.hud.setTextPreview(payload.outcome==='NO_SPEECH'?'Nenhuma fala confirmada por Silero + TEN.':result.inserted?text:text?'O campo original não está disponível ou foi alterado. Copie a transcrição: '+text:'Nenhuma fala reconhecida.');}
            job.insertion.dispose();this.liveJobs.delete(job.jobId);
            return result;
        }
    }
    async insertJobText(job,text,final,payload={}){
        const next=this.liveJobs.get(this.liveCapture?.jobId);
        if(next?.generation>job.generation&&next.target.element===job.target.element)await next.capture.admission;
        const started=Date.now(),metrics=job.capture.metrics||(job.capture.metrics={});metrics.insertionAttempts=(metrics.insertionAttempts||0)+1;
        void globalThis.LiveSttDiagnostics?.emit({jobId:job.jobId,scope:'result',stage:'inserting',insertionAttempts:metrics.insertionAttempts,characters:text?.length||0});
        const isCurrent=()=>!job.cancelled&&(!payload.editorDelivery||payload.eventSeq===job.editorEventSeq);
        const editorTrace=payload.editorDelivery&&globalThis.LiveSttDiagnostics?{}:undefined;
        let result;try{result=payload.outcome==='NO_SPEECH'&&!text?{inserted:false,reason:'EMPTY_TEXT',characters:0}:await job.insertion.apply(text,{final,isCurrent,editorTrace,confirmedText:payload.confirmedText,partialText:payload.partialText,sequence:payload.sequence,textBoundaries:payload.textBoundaries});}catch(error){result={inserted:false,reason:'EDITOR_ERROR'};console.error('[STT insertion]',error?.name||'Error');}
        const first=result.inserted&&!metrics.insertionVerified;if(result.inserted){metrics.insertionVerified=(metrics.insertionVerified||0)+1;metrics.firstInsertionMs??=Date.now()-job.capture.startedAt;}
        if(result.inserted&&result.characters>0&&editorTrace?.editorWriteAt&&!metrics.firstEditorMarked){
            metrics.firstEditorMarked=true;
            globalThis.LiveSttDiagnostics?.mark?.(job.jobId,'stt-first-editor',{revision:payload.eventSeq,timelineAt:editorTrace.editorWriteAt});
        }
        if(first||final||!result.inserted||payload.editorDelivery&&!payload.partialText)void globalThis.LiveSttDiagnostics?.emit({jobId:job.jobId,scope:'result',stage:result.inserted?'inserted':'insertion-failed',outcome:result.inserted?'INSERTED':'INSERTION_FAILED',editorReason:result.reason,inserted:result.inserted,characters:text?.length||0,firstInsertionMs:metrics.firstInsertionMs,insertionDurationMs:Date.now()-started,finalInsertion:final,whileRecording:this.liveCapture===job.capture&&!job.capture.stopping,sequence:payload.sequence,revision:payload.eventSeq,provisional:!!payload.partialText,editorReceivedMs:started-job.capture.startedAt,publicationToEditorMs:Number.isFinite(payload.publishedAt)?started-payload.publishedAt:undefined,dispatchToEditorMs:Number.isFinite(payload.dispatchedAt)?started-payload.dispatchedAt:undefined});
        if(payload.editorDelivery){
            if(result.inserted)job.appliedEditorRevision=payload.eventSeq;
            if(editorTrace&&(first||final||!result.inserted||!payload.partialText))void globalThis.LiveSttDiagnostics.emit({
                jobId:job.jobId,scope:'editor',stage:'editor-apply',revision:payload.eventSeq,sequence:payload.sequence,
                textLineBreaks:typeof text==='string'?(text.match(/\n/g)||[]).length:0,
                appliedRevision:job.appliedEditorRevision||0,characters:text?.length||0,
                inserted:result.inserted,editorReason:result.reason,insertionMode:job.mode,
                finalInsertion:final,provisional:!!payload.partialText,...editorTrace
            });
            result={...result,revision:payload.eventSeq,final};
            if(!job.insertionResult||result.revision>job.insertionResult.revision)job.insertionResult=result;
        }else if(final||!result.inserted){
            if(!this.contextInvalidated)void this.sendLiveMessage({type:'HUD_INSERTION_RESULT',payload:{jobId:job.jobId,inserted:result.inserted,reason:result.reason}}).catch(error=>this.reportRuntimeError(error));}
        return result;
    }
    resamplePcm16(input,from,to){const ratio=from/to,values=[],n=input.length;for(let p=this.resampleCursor;p<n;p+=ratio){const a=Math.floor(p),b=Math.min(n-1,a+1),v=a<0?this.resamplePrevious*(1-(p+1))+input[0]*(p+1):input[a]*(1-(p-a))+input[b]*(p-a);values.push(Math.max(-1,Math.min(1,v)));this.resampleCursor=p+ratio;}this.resampleCursor-=n;this.resamplePrevious=input[n-1]||0;const out=new Int16Array(values.length);values.forEach((v,i)=>out[i]=v<0?v*32768:v*32767);return new Uint8Array(out.buffer);}
    async startRecording() {
        try {
            this.targetElement = document.activeElement;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.activeStream = stream;
            this.audioChunks = [];
            const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';
            this.mediaRecorder = new MediaRecorder(stream, { mimeType: preferredMime });
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            this.mediaRecorder.start(250); // Coleta a cada 250ms
            this.isRecording = true;
            hudController_1.hud.show();
            hudController_1.hud.setStatus('recording', 'Gravando...');
            hudController_1.hud.setTextPreview('Fale no microfone. Pressione Ctrl+Shift+Espaço para concluir.');
        }
        catch (err) {
            console.error('[STT Controller] Falha ao acessar microfone:', err);
            hudController_1.hud.setStatus('idle', 'Permissão negada');
            this.isRecording = false;
        }
    }
    stopRecording(agentId) {
        if (!this.mediaRecorder || !this.isRecording)
            return;
        this.isRecording = false;
        const recorder = this.mediaRecorder;
        const stream = this.activeStream;
        const target = this.targetElement;
        recorder.onstop = async () => {
            // Fecha todas as trilhas do microfone
            stream?.getTracks().forEach((track) => track.stop());
            this.activeStream = null;
            const rawMime = recorder.mimeType || 'audio/webm';
            // Normaliza para 'audio/webm' removendo ;codecs=opus para evitar HTTP 400
            const normalizedMime = rawMime.split(';')[0].trim() || 'audio/webm';
            const blob = new Blob(this.audioChunks, { type: normalizedMime });
            const task = {
                id: this.nextTaskId++,
                blob,
                mimeType: normalizedMime,
                agentId,
                targetElement: target,
            };
            this.queue.push(task);
            this.audioChunks = [];
            (0, diagnosticLogger_1.logDiagnostic)({
                level: 'info',
                source: 'STT',
                operation: 'QUEUE_ENQUEUED',
                message: `Tarefa #${task.id} adicionada à fila STT (${blob.size} bytes, ${normalizedMime})`,
            });
            if (!this.isProcessingStt) {
                this.processNextInQueue();
            }
        };
        recorder.stop();
    }
    cancelRecording(notify = true,stopReason='user-cancel') {
        globalThis.LiveSttDiagnostics?.ending(this.liveCapture,this.contextInvalidated?'context-invalidated':stopReason);
        const jobId=this.liveCapture?.jobId||this.liveJobId||(this.liveJobs.size===1?[...this.liveJobs.keys()][0]:null);
        const cancelled=this.contextInvalidated?[...this.liveJobs.values()]:[this.liveJobs.get(jobId)].filter(Boolean);
        for(const job of cancelled){job.cancelled=true;job.capture?.audioQueue?.close();job.insertion?.invalidate('CANCELLED');job.insertion?.dispose();this.liveJobs.delete(job.jobId);}
        if(jobId)void globalThis.LiveSttDiagnostics?.emit({jobId,scope:'result',stage:'cancelled',outcome:this.contextInvalidated?'INVALIDATED_CONTEXT':'CANCELLED'});
        this.liveGeneration=(this.liveGeneration||0)+1;
        this.liveJobId=null;this.clearContextWatch();
        const release=this.releaseLiveCapture();
        void release.then(()=>{if(notify&&!this.contextInvalidated&&jobId)this.cancelLiveJob(jobId);}).catch(error=>this.reportRuntimeError(error));
        if (this.isRecording && this.mediaRecorder) {
            this.isRecording = false;
            try {
                this.mediaRecorder.stop();
            }
            catch { }
            this.activeStream?.getTracks().forEach((track) => track.stop());
            this.activeStream = null;
            this.audioChunks = [];
        }
        this.queue = [];
        this.isProcessingStt = false;
        this.activeStream?.getTracks().forEach(track=>track.stop());this.activeStream=null;this.isRecording=false;
    }
    async processNextInQueue() {
        if (this.queue.length === 0) {
            this.isProcessingStt = false;
            return;
        }
        this.isProcessingStt = true;
        const task = this.queue[0];
        await (0, diagnosticLogger_1.logDiagnostic)({
            level: 'info',
            source: 'STT',
            operation: 'PROCESSING',
            message: `Processando tarefa #${task.id} da fila STT (${task.blob.size} bytes)`,
        });
        hudController_1.hud.setStatus('loading', 'Transcrevendo');
        hudController_1.hud.setTextPreview(`Processando áudio (${task.blob.size} bytes)...`);
        try {
            const base64 = await this.blobToBase64(task.blob);
            chrome.runtime.sendMessage({
                type: 'STT_TRANSCRIBE_REQUEST',
                payload: {
                    audioBase64: base64,
                    mimeType: task.mimeType,
                    agentId: task.agentId,
                },
            }, async (response) => {
                if (chrome.runtime.lastError) {
                    const err = chrome.runtime.lastError.message || 'Erro de conexão com a extensão';
                    console.error('[STT Controller] Runtime error:', err);
                    hudController_1.hud.setStatus('idle', 'Falha no STT');
                    hudController_1.hud.setTextPreview(`❌ Erro: ${err}`);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'STT',
                        operation: 'QUEUE_COMPLETED',
                        message: `Tarefa #${task.id} finalizada com erro runtime: ${err}`,
                    });
                    this.queue.shift();
                    this.processNextInQueue();
                    return;
                }
                if (!response || !response.success || !response.data?.text) {
                    const err = response?.error || 'Erro na transcrição';
                    console.error('[STT Controller]', err);
                    hudController_1.hud.setStatus('idle', 'Falha no STT');
                    hudController_1.hud.setTextPreview(`❌ Erro: ${err}`);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'error',
                        source: 'STT',
                        operation: 'QUEUE_COMPLETED',
                        message: `Tarefa #${task.id} finalizada com falha: ${err}`,
                    });
                }
                else {
                    const transcribed = response.data.text;
                    hudController_1.hud.setStatus('idle', 'Pronto');
                    hudController_1.hud.setTextPreview(`Ditado: "${transcribed}"`);
                    // Tenta injetar no campo ativo preservado da tarefa
                    (0, inputInjector_1.injectTranscribedText)(transcribed, undefined, task.targetElement);
                    await (0, diagnosticLogger_1.logDiagnostic)({
                        level: 'info',
                        source: 'STT',
                        operation: 'QUEUE_COMPLETED',
                        message: `Tarefa #${task.id} concluída com sucesso`,
                    });
                }
                // Avança na fila FIFO independentemente de sucesso ou falha
                this.queue.shift();
                this.processNextInQueue();
            });
        }
        catch (err) {
            console.error('[STT Controller] Erro ao processar item da fila STT:', err);
            hudController_1.hud.setStatus('idle', 'Erro no STT');
            this.queue.shift();
            this.processNextInQueue();
        }
    }
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result;
                const base64 = result.replace(/^data:[a-z0-9/]+;base64,/, '');
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}
exports.SttController = SttController;
exports.stt = new SttController();

},
"extension/src/content/dom/inputInjector.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Injetor de texto transcrito em campos de input, textarea e contentEditable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectTranscribedText = injectTranscribedText;
exports.captureDictationTarget = captureDictationTarget;
const textCleaner_1 = __require("shared/utils/textCleaner.ts");
exports.normalizeDictatedText = text=> (0,textCleaner_1.sanitizeDictatedText)(text);
function captureDictationTarget() {
    if(globalThis.DictationRuntime)return globalThis.DictationRuntime.captureTarget(document);
    let element=document.activeElement;
    while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;
    if(!element||element.getRootNode?.().host?.id==='ext-tts-stt-host')return null;
    if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement){
        if(element.disabled||element.readOnly||typeof element.selectionStart!=='number')return null;
        return{element,selectionStart:element.selectionStart,selectionEnd:element.selectionEnd};
    }
    if(!element.isContentEditable)return null;
    const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
    return{element,range:range&&element.contains(range.startContainer)&&element.contains(range.endContainer)?range.cloneRange():null};
}
function injectTranscribedText(rawText, targetSelector, explicitTarget, savedSelection) {
    const textToInsert = (0, textCleaner_1.sanitizeDictatedText)(rawText);
    if (!textToInsert)
        return false;
    let targetElement = explicitTarget || null;
    if (!targetElement && targetSelector) {
        targetElement = document.querySelector(targetSelector);
    }
    if (!targetElement || targetElement.isConnected===false || targetElement.disabled || targetElement.readOnly)
        return false;
    // Caso 1: Input ou TextArea padrão
    if (targetElement instanceof HTMLInputElement ||
        targetElement instanceof HTMLTextAreaElement) {
        if(typeof targetElement.selectionStart!=='number')return false;
        const start = Math.min(targetElement.value.length,savedSelection?.selectionStart ?? targetElement.selectionStart);
        const end = Math.min(targetElement.value.length,savedSelection?.selectionEnd ?? targetElement.selectionEnd);
        const originalValue = targetElement.value;
        const prefix = originalValue.substring(0, start);
        const suffix = originalValue.substring(end);
        const spacer = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
        targetElement.focus({preventScroll:true});
        const value=prefix+spacer+textToInsert+suffix,prototype=targetElement instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
        if(setter)setter.call(targetElement,value);else targetElement.value=value;
        targetElement.selectionStart = targetElement.selectionEnd = start + spacer.length + textToInsert.length;
        // Dispara eventos para React / Vue / Angular capturarem a mutação
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    // Caso 2: contentEditable (Gmail, Notion, Slack web, Docs)
    if (targetElement.isContentEditable) {
        const selection = window.getSelection();
        if (selection) {
            targetElement.focus({preventScroll:true});
            let range=savedSelection?.range?.cloneRange()||(selection.rangeCount?selection.getRangeAt(0):null);
            if(!range||!targetElement.contains(range.startContainer)||!targetElement.contains(range.endContainer))return false;
            range.deleteContents();
            const textNode = document.createTextNode(textToInsert);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.collapse(false);
            selection.removeAllRanges();selection.addRange(range);
            targetElement.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
    }
    return false;
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
                try {
                    const error = chrome.runtime.lastError;
                    if (error) return reject(error);
                    const migrated = (0, defaultSettings_1.migrateLegacyStorage)(result || {});
                    resolve(Object.fromEntries(namespaces.map((namespace) => [namespace, migrated[namespace]])));
                } catch (error) {
                    reject(error);
                }
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
        ...(Array.isArray(candidate.recentItems) ? { recentItems: candidate.recentItems } : {}),
    };
}
function mergeLogsSettings(base, candidate) {
    if (!isRecord(candidate))
        return base;
    return {
        ...base,
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
"extension/src/content/controllers/lensController.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Controlador do Gemini Lens / Inspeção Visual no Content Script.
 * Captura seleção retangular (Ctrl+Shift+Arrastar ou atalho/HUD), calcula coordenadas em pixels,
 * extrai o texto visível da região e O NARRA AUTOMATICAMENTE via TTS.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lens = exports.LensController = void 0;
const hudController_1 = __require("extension/src/content/ui/hudController.ts");
const ttsController_1 = __require("extension/src/content/controllers/ttsController.ts");
const shadowDomWrapper_1 = __require("extension/src/content/ui/shadowDomWrapper.ts");
class LensController {
    isSelecting = false;
    startX = 0;
    startY = 0;
    currentX = 0;
    currentY = 0;
    overlayElement = null;
    boxElement = null;
    hasExtensionContext() {
        try {
            if (!chrome.runtime?.id)
                return false;
            // O HUD pode sobreviver à recarga da extensão, mas seu runtime não.
            chrome.runtime.getManifest();
            return true;
        }
        catch {
            return false;
        }
    }
    showInvalidatedContext() {
        this.cleanup();
        hudController_1.hud.show();
        hudController_1.hud.setStatus('idle', 'Atualize a página');
        hudController_1.hud.setTextPreview('⚠️ A extensão foi recarregada ou desconectada desta aba. Atualize a página (F5) e tente o Lens novamente.');
    }
    ensureExtensionContext() {
        if (this.hasExtensionContext())
            return true;
        this.showInvalidatedContext();
        return false;
    }
    showRequestError(error, isException = false) {
        const message = error?.message || String(error);
        if (/extension context invalidated/i.test(message) || !this.hasExtensionContext()) {
            this.showInvalidatedContext();
            return;
        }
        hudController_1.hud.setStatus('idle', 'Erro Lens');
        hudController_1.hud.setTextPreview(`❌ ${isException ? 'Exceção' : 'Erro'} no Lens: ${message}`);
    }
    /**
     * Ativa o modo de seleção Gemini Lens por atalho de teclado ou botão do HUD/Popup.
     * Exibe aviso no topo da tela e aguarda o clique e arraste do usuário.
     */
    activateLensMode(agentId = 'narrator', mode = 'literal') {
        if (!this.ensureExtensionContext())
            return;
        if (this.isSelecting)
            return;
        this.isSelecting = true;
        const root = shadowDomWrapper_1.shadowDom.getRoot();
        const overlay = document.createElement('div');
        overlay.className = 'ext-lens-overlay';
        overlay.style.cssText = 'position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: rgba(15, 23, 42, 0.25);';
        const banner = document.createElement('div');
        banner.innerText = '🔍 Gemini Lens: Clique e arraste para selecionar uma área na página (Esc para cancelar)';
        banner.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #0f172a;
      border: 1px solid #38bdf8;
      color: #38bdf8;
      padding: 10px 22px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      z-index: 2147483647;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      pointer-events: none;
      font-family: system-ui, sans-serif;
    `;
        overlay.appendChild(banner);
        root.appendChild(overlay);
        this.overlayElement = overlay;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                window.removeEventListener('keydown', onKeyDown);
                this.cleanup();
            }
        };
        const onMouseDown = (ev) => {
            ev.preventDefault();
            overlay.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('keydown', onKeyDown);
            this.startX = ev.clientX;
            this.startY = ev.clientY;
            this.currentX = ev.clientX;
            this.currentY = ev.clientY;
            const box = document.createElement('div');
            box.className = 'ext-lens-box';
            box.style.position = 'fixed';
            box.style.border = '2px dashed #38bdf8';
            box.style.background = 'rgba(56, 189, 248, 0.15)';
            box.style.left = `${this.startX}px`;
            box.style.top = `${this.startY}px`;
            box.style.width = '0px';
            box.style.height = '0px';
            box.style.zIndex = '2147483647';
            overlay.appendChild(box);
            this.boxElement = box;
            const onMouseMove = (moveEv) => {
                this.currentX = moveEv.clientX;
                this.currentY = moveEv.clientY;
                this.updateBoxCoordinates();
            };
            const onMouseUp = (upEv) => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                this.currentX = upEv.clientX;
                this.currentY = upEv.clientY;
                const left = Math.min(this.startX, this.currentX);
                const top = Math.min(this.startY, this.currentY);
                const width = Math.abs(this.currentX - this.startX);
                const height = Math.abs(this.currentY - this.startY);
                if (width > 15 && height > 15) {
                    this.submitSelection({
                        x: left,
                        y: top,
                        width,
                        height,
                        devicePixelRatio: window.devicePixelRatio || 1,
                    }, agentId, mode);
                }
                else {
                    this.cleanup();
                }
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };
        overlay.addEventListener('mousedown', onMouseDown);
        window.addEventListener('keydown', onKeyDown);
    }
    /**
     * Inicia a seleção imediatamente quando acionada por Ctrl+Shift+Mousedown (arraste direto).
     */
    startDragSelection(clientX, clientY, agentId = 'narrator', mode = 'literal') {
        if (!this.ensureExtensionContext())
            return;
        if (this.isSelecting)
            return;
        this.isSelecting = true;
        this.startX = clientX;
        this.startY = clientY;
        this.currentX = clientX;
        this.currentY = clientY;
        const root = shadowDomWrapper_1.shadowDom.getRoot();
        const overlay = document.createElement('div');
        overlay.className = 'ext-lens-overlay';
        overlay.style.cssText = 'position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: rgba(15, 23, 42, 0.25);';
        const box = document.createElement('div');
        box.className = 'ext-lens-box';
        box.style.position = 'fixed';
        box.style.border = '2px dashed #38bdf8';
        box.style.background = 'rgba(56, 189, 248, 0.15)';
        box.style.left = `${this.startX}px`;
        box.style.top = `${this.startY}px`;
        box.style.width = '0px';
        box.style.height = '0px';
        box.style.zIndex = '2147483647';
        overlay.appendChild(box);
        root.appendChild(overlay);
        this.overlayElement = overlay;
        this.boxElement = box;
        const onMouseMove = (ev) => {
            this.currentX = ev.clientX;
            this.currentY = ev.clientY;
            this.updateBoxCoordinates();
        };
        const onMouseUp = (ev) => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            this.currentX = ev.clientX;
            this.currentY = ev.clientY;
            const left = Math.min(this.startX, this.currentX);
            const top = Math.min(this.startY, this.currentY);
            const width = Math.abs(this.currentX - this.startX);
            const height = Math.abs(this.currentY - this.startY);
            if (width > 15 && height > 15) {
                this.submitSelection({
                    x: left,
                    y: top,
                    width,
                    height,
                    devicePixelRatio: window.devicePixelRatio || 1,
                }, agentId, mode);
            }
            else {
                this.cleanup();
            }
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }
    updateBoxCoordinates() {
        if (!this.boxElement)
            return;
        const left = Math.min(this.startX, this.currentX);
        const top = Math.min(this.startY, this.currentY);
        const width = Math.abs(this.currentX - this.startX);
        const height = Math.abs(this.currentY - this.startY);
        this.boxElement.style.left = `${left}px`;
        this.boxElement.style.top = `${top}px`;
        this.boxElement.style.width = `${width}px`;
        this.boxElement.style.height = `${height}px`;
    }
    submitSelection(rect, agentId = 'narrator', mode = 'literal') {
        this.cleanup();
        if (!this.ensureExtensionContext())
            return;
        hudController_1.hud.show();
        hudController_1.hud.setStatus('loading', 'Analisando tela');
        hudController_1.hud.setTextPreview('Inspecionando a área selecionada com Gemini Vision...');
        try {
            chrome.runtime.sendMessage({
                type: 'LENS_ANALYZE_REQUEST',
                payload: {
                    instruction: undefined,
                    rect,
                    agentId,
                    mode,
                },
            }, (response) => {
                let runtimeError;
                try {
                    runtimeError = chrome.runtime.lastError;
                }
                catch (err) {
                    this.showRequestError(err, true);
                    return;
                }
                if (!this.ensureExtensionContext())
                    return;
                if (runtimeError) {
                    const err = runtimeError.message || 'Erro de conexão com a extensão';
                    console.error('[Lens Controller] Erro runtime:', err);
                    this.showRequestError(err);
                    return;
                }
                if(response?.cancelled){hudController_1.hud.setStatus('idle','Lens cancelado');return;}
                if (!response || !response.success || typeof response.data !== 'string' || !response.jobId) {
                    const err = response?.error || 'Falha na análise visual do Gemini';
                    if (['LENS_CAPTURE_PERMISSION_REQUIRED', 'LENS_TAB_CHANGED'].includes(response?.code)) {
                        hudController_1.hud.setStatus('idle', response.code === 'LENS_CAPTURE_PERMISSION_REQUIRED' ? 'Autorizar Lens' : 'Tente novamente');
                        hudController_1.hud.setTextPreview(err);
                        return;
                    }
                    console.error('[Lens Controller] Erro de resposta:', err);
                    hudController_1.hud.setStatus('idle', 'Erro Lens');
                    hudController_1.hud.setTextPreview(`❌ Erro no Lens: ${err}`);
                    return;
                }
                const extractedText = String(response.data).trim();
                hudController_1.hud.setStatus('idle', 'Texto Extraído');
                hudController_1.hud.setTextPreview(extractedText || 'Nenhum texto visível detectado na região.');
                // O background mantém análise e narração na mesma tarefa, mesmo se a página fechar.
            });
        }
        catch (err) {
            console.error('[Lens Controller] Exceção ao enviar Lens request:', err);
            this.showRequestError(err, true);
        }
    }
    cleanup() {
        this.isSelecting = false;
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
            this.boxElement = null;
        }
    }
}
exports.LensController = LensController;
exports.lens = new LensController();

},
"extension/src/content/dom/textExtractor.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Extrator e normalizador de texto selecionado no DOM da página ativa.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCleanSelectedText = getCleanSelectedText;
const textCleaner_1 = __require("shared/utils/textCleaner.ts");
function getCleanSelectedText() {
    let raw = '';
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement) {
        const start = activeElement.selectionStart || 0;
        const end = activeElement.selectionEnd || 0;
        if (start !== end) {
            raw = activeElement.value.substring(start, end);
        }
    }
    if (!raw) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
            raw = selection.toString();
        }
    }
    const cleaned = (0, textCleaner_1.cleanTextForTts)(raw);
    return { raw, cleaned };
}

},
"shared/utils/shortcutMatcher.ts":function(module,exports,__require){
"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Utilitário de Parsing, Comparação e Formatação de Atalhos de Teclado Editáveis.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShortcut = parseShortcut;
exports.matchesShortcut = matchesShortcut;
exports.formatShortcutDisplay = formatShortcutDisplay;
exports.recordShortcutFromEvent = recordShortcutFromEvent;
function parseShortcut(shortcutStr) {
    if (!shortcutStr || typeof shortcutStr !== 'string') {
        return { ctrl: false, shift: false, alt: false, meta: false, key: '' };
    }
    const parts = shortcutStr.split('+').map((p) => p.trim());
    let ctrl = false;
    let shift = false;
    let alt = false;
    let meta = false;
    let key = '';
    for (const p of parts) {
        const lower = p.toLowerCase();
        if (lower === 'ctrl' || lower === 'control')
            ctrl = true;
        else if (lower === 'shift')
            shift = true;
        else if (lower === 'alt')
            alt = true;
        else if (lower === 'cmd' || lower === 'meta')
            meta = true;
        else
            key = p;
    }
    return { ctrl, shift, alt, meta, key };
}
function matchesShortcut(event, shortcutStr) {
    if (!shortcutStr || !event)
        return false;
    const parsed = parseShortcut(shortcutStr);
    if (!parsed.key)
        return false;
    const hasCtrlOrMeta = event.ctrlKey || event.metaKey;
    if (parsed.ctrl !== hasCtrlOrMeta)
        return false;
    if (parsed.shift !== event.shiftKey)
        return false;
    if (parsed.alt !== event.altKey)
        return false;
    const targetKey = parsed.key.toLowerCase();
    const eventKey = (event.key || '').toLowerCase();
    const eventCode = (event.code || '').toLowerCase();
    if (targetKey === 'space' || targetKey === 'espaço') {
        return eventKey === ' ' || eventCode === 'space';
    }
    if (targetKey === 'pause' || targetKey === 'break') {
        return eventKey === 'pause' || eventCode === 'pause';
    }
    // Compara tecla de letra, número ou caractere
    if (eventKey === targetKey)
        return true;
    if (eventCode === `key${targetKey}`)
        return true;
    if (eventCode === targetKey)
        return true;
    return false;
}
function formatShortcutDisplay(shortcutStr) {
    if (!shortcutStr)
        return 'Não configurado';
    const parsed = parseShortcut(shortcutStr);
    const parts = [];
    if (parsed.ctrl)
        parts.push('Ctrl');
    if (parsed.alt)
        parts.push('Alt');
    if (parsed.shift)
        parts.push('Shift');
    if (parsed.meta)
        parts.push('Cmd');
    if (parsed.key) {
        let keyLabel = parsed.key.toUpperCase();
        if (keyLabel === 'SPACE')
            keyLabel = 'Espaço';
        parts.push(keyLabel);
    }
    return parts.join(' + ');
}
function recordShortcutFromEvent(e) {
    // Ignora teclas modificadoras isoladas
    if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) {
        return null;
    }
    const parts = [];
    if (e.ctrlKey || e.metaKey)
        parts.push('Ctrl');
    if (e.altKey)
        parts.push('Alt');
    if (e.shiftKey)
        parts.push('Shift');
    let keyStr = e.code.replace(/^Key/, '').replace(/^Digit/, '');
    if (e.key === ' ')
        keyStr = 'Space';
    else if (e.key === 'Pause')
        keyStr = 'Pause';
    else if (!keyStr)
        keyStr = e.key.toUpperCase();
    parts.push(keyStr);
    return parts.join('+');
}

},
"extension/src/content/styles/hud.css?raw":function(module,exports,__require){
module.exports="/**\n * @license\n * SPDX-License-Identifier: Apache-2.0\n * \n * Estilos encapsulados do HUD flutuante (injetado via Shadow DOM).\n */\n\n:host {\n  all: initial;\n  position: fixed;\n  z-index: 2147483647;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 13px;\n  line-height: 1.4;\n  color: #f1f5f9;\n  user-select: none;\n}\n\n.ext-hud-card {\n  box-sizing: border-box;\n  position: fixed;\n  width: var(--hud-width,min(448px, calc(100% - 24px)));\n  height: var(--hud-height,auto);\n  max-height: calc(100vh - 48px);\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) 46px;\n  align-items: end;\n  gap: 10px;\n  pointer-events: none;\n  transition: opacity 180ms ease;\n  color: #e2e8f0;\n}\n.ext-hud-card.hidden { opacity: 0; visibility: hidden; pointer-events: none; }\n.ext-hud-card.hidden * { pointer-events: none !important; }\n.ext-hud-card.hidden .fm-hud-task-wave svg,.ext-hud-card.hidden .ext-hud-header::after { animation-play-state: paused !important; }\n.ext-hud-card[data-minimized=\"true\"] { width: 46px; height: auto; grid-template-columns: 46px; gap: 0; }\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-panel{display:none!important}\n.ext-hud-card,.ext-hud-card *{scrollbar-width:none!important;scrollbar-gutter:auto!important}\n.ext-hud-card::-webkit-scrollbar,.ext-hud-card ::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}\n.ext-hud-card [hidden]{display:none!important}\n.ext-hud-panel, .ext-hud-header {\n  box-sizing: border-box;\n  position: relative; isolation: isolate;\n  pointer-events: auto;\n  text-shadow: 0 1px 1px rgba(2,6,23,.8);\n  border: 1px solid rgba(228,239,255,.16);\n  box-shadow: inset 0 1px rgba(255,255,255,.16), 0 12px 24px -16px rgba(0,0,0,.28), 0 2px 6px -3px rgba(0,0,0,.18);\n}\n/* A sibling material layer avoids filtering the functional layer's backdrop. */\n.ext-hud-glass {\n  position: absolute; inset: 0; z-index: -1;\n  pointer-events: none; border-radius: inherit;\n  background: rgba(12,17,28,var(--hud-panel-alpha,.49));\n  backdrop-filter: none;\n  -webkit-backdrop-filter: none;\n}\n.ext-hud-header>.ext-hud-glass { background: rgba(12,17,28,var(--hud-rail-alpha,.44)); }\n.ext-hud-panel {\n  grid-column: 1; grid-row: 1;\n  min-width: 0; min-height: 0;\n  max-height: min(var(--hud-height,calc(100vh - 48px)),calc(100vh - 48px));\n  display: flex; flex-direction: column;\n  border-radius: 22px;\n  transform-origin: right bottom;\n  overflow: hidden;\n}\n.ext-hud-card[data-moving=\"true\"] .ext-hud-panel { will-change: transform; }\n.ext-hud-header {\n  grid-column: 2; grid-row: 1;\n  position: relative; isolation: isolate;\n  display: flex; flex-direction: column; align-items: center;\n  gap: 10px; padding: 11px 5px 6px;\n  border-radius: 15px; max-height: calc(100vh - 48px);\n  cursor: grab; touch-action: none;\n}\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header { grid-column: 1; }\n.ext-hud-header::before {\n  content: ''; pointer-events: none; position: absolute;\n  right: calc(100% + 1px); bottom: 26px; width: 9px; height: 1px;\n  background: linear-gradient(90deg, rgba(125,211,252,.12), rgba(196,181,253,.35));\n}\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header::before { display: none; }\n.ext-hud-header::after {\n  content: ''; pointer-events: none; position: absolute;\n  left: 0; top: 12%; bottom: 12%; width: 1px;\n  background: linear-gradient(180deg,transparent,rgba(125,211,252,.3),rgba(196,181,253,.8),transparent);\n  background-size: 100% 190%; border-radius: inherit; opacity: .7;\n}\n.ext-hud-header[data-state=\"recording\"]::after { background-image: linear-gradient(180deg,transparent,rgba(251,113,133,.3),rgba(254,202,202,.8),transparent); }\n.ext-hud-header:is([data-state=\"recording\"],[data-state=\"playing\"],[data-state=\"loading\"])::after { animation: ext-rail-flow 5s linear infinite; }\n.ext-hud-header[data-state=\"error\"]::after { background: linear-gradient(transparent,#fbbf24,transparent); }\n.ext-hud-header[data-state=\"paused\"]::after { opacity: .35; }\n.ext-hud-card[data-dragging=\"true\"] .ext-hud-header { cursor: grabbing; border-color: rgba(125,211,252,.42); }\n.ext-hud-mark { width: 19px; height: 19px; flex: none; color: #7dd3fc; }\n.ext-hud-title {\n  display: flex; align-items: center; gap: 9px;\n  writing-mode: vertical-rl; white-space: nowrap;\n  font-size: 12px; font-weight: 650; letter-spacing: .025em;\n  min-height: 0; overflow: hidden; padding: 2px 0;\n  background: rgba(15,23,42,var(--hud-title-alpha,.8)); border-radius: 6px;\n}\n.ext-hud-badge { font-size: 10px; font-weight: 500; color: #c5d0e2; }\n.ext-hud-badge.recording { color: #fda4af; }\n.ext-hud-badge.playing { color: #7dd3fc; }\n.ext-hud-badge:is(.error,.loading) { color: #fcd68d; }\n.ext-hud-controls { display: flex; flex-direction: column; gap: 4px; flex: none; }\n.ext-btn-icon, .ext-hud-header .fm-global-panic, .ext-hud-header .fm-global-mini-controls button {\n  display: flex; align-items: center; justify-content: center;\n  width: 32px; height: 30px; box-sizing: border-box;\n  border: 1px solid rgba(224,240,255,.1); border-radius: 9px;\n  background: rgba(15,23,42,var(--hud-control-alpha,.78)); color: #b9c7da;\n  cursor: pointer; font: 15px/1 system-ui;\n  transition: background-color 150ms ease, border-color 150ms ease;\n}\n.ext-hud-header .fm-global-panic { order: -1; }\n.ext-hud-header .fm-global-mini-controls { flex-direction: column; gap: 4px; }\n.ext-btn-icon:hover, .ext-hud-header button:hover, .ext-hud-header .fm-global-panic:hover { background: rgba(30,41,59,.96); color: #f8fafc; }\n.ext-hud-card :is(button,input,select,summary,[tabindex]):focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }\n.ext-hud-notices { position: fixed; width: min(360px, calc(100% - 24px)); left: 12px; top: 12px; max-height: calc(100vh - 24px); overflow-y: auto; pointer-events: none; z-index: 2; }\n.ext-hud-notices :is(.fm-global-message,.fm-hud-capture-notice):not(:empty) {\n  pointer-events: auto; margin: 0 0 6px; padding: 10px 12px;\n  border: 1px solid rgba(253,186,116,.32); border-radius: 12px;\n  background: rgba(34,26,28,.92); backdrop-filter: blur(18px);\n  color: #fde2bd; font: 12px/1.5 system-ui; overflow-wrap: anywhere;\n}\n.ext-hud-notices :empty { display: none; }\n.ext-hud-notices .fm-hud-microphone-notice { display: flex; align-items: flex-start; gap: 8px; }\n.fm-hud-microphone-notice>span { flex: 1; min-width: 0; }\n.fm-hud-microphone-notice>button { flex: 0 0 28px; width: 28px; height: 26px; }\n.ext-hud-body[hidden]{display:none!important}\n.ext-hud-body { padding: 12px 12px 12px; display: flex; flex-direction: column; min-height: 0; overflow: auto; overscroll-behavior: contain; }\n/* Functional translucency is alpha only; no local backdrop filters. */\n.ext-hud-title,.ext-hud-header button,.fm-global-hud[data-surface=\"hud\"] :is(select,button,.fm-global-card,.fm-global-player,.fm-global-empty) { backdrop-filter: none; -webkit-backdrop-filter: none; }\n#ext-global-jobs{display:flex;flex:1;min-height:0}\n#ext-global-jobs>.fm-global-hud{display:flex;flex-direction:column;flex:1;min-height:0}\n#ext-global-jobs>.fm-global-hud>:not(.fm-global-jobs){flex-shrink:0}\n#ext-global-jobs .fm-global-jobs{flex:0 1 auto;min-height:0}\n/* All redesigned shared-renderer selectors are restricted to the HUD surface. */\n.fm-global-hud[data-surface=\"hud\"] { color: #e7edf9; font-size: 11px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-head { padding: 9px 0; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-heading { font-size: 12px; letter-spacing: -.015em; color: #edf5ff; background: rgba(12,20,36,var(--hud-surface-alpha,.76)); border-radius: 4px; box-shadow: 0 0 0 2px rgba(12,20,36,var(--hud-surface-alpha,.76)); }\n.fm-global-hud[data-surface=\"hud\"] :is(button,select,textarea) { border: 1px solid rgba(224,240,255,.12); border-radius: 9px; background: rgba(12,17,28,var(--hud-button-alpha,.04)); color: #e2e8f0; box-shadow: inset 0 1px rgba(255,255,255,var(--hud-button-alpha,.04)); }\n.fm-global-hud[data-surface=\"hud\"] button { transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease; }\n.fm-global-hud[data-surface=\"hud\"] button:hover { background: rgba(255,255,255,.1); border-color: rgba(174,207,255,.25); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-agent-row { margin-bottom: 10px; gap: 7px; }\n.fm-global-hud[data-surface=\"hud\"] select { padding: 8px 9px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-agent-row :is(select,button) { background: rgba(15,23,42,var(--hud-control-alpha,.78)); }\n.fm-global-hud[data-surface=\"hud\"] option { background: #0c1220; color: #f1f5f9; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-jobs { gap: 8px; max-height: min(46vh, 480px); }\n/* Functional surfaces keep their own opacity, independently of structural glass. */\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card { padding: 10px; border-radius: 15px; border-color: rgba(211,228,255,.1); background: rgba(18,27,48,var(--hud-card-alpha,.76)); box-shadow: inset 0 1px rgba(255,255,255,.06); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card[data-active=\"true\"] { border-color: rgba(125,185,255,.35); background: rgba(18,27,48,var(--hud-active-alpha,.8)); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-empty { background: rgba(12,20,36,var(--hud-surface-alpha,.76)); border-radius: 9px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card[data-collapsed=\"true\"] { padding: 8px 10px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card-header { gap: 5px; flex-wrap: wrap; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-kind { font-size: 11px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-description { color: #c4cfe0; max-width: none; flex-basis: 40px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-status { max-width: 13ch; font-size: 10px; color: #a5d8ff; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card-tools { gap: 3px; margin-left: auto; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card-tools button { width: 24px; min-width: 24px; height: 25px; padding: 0; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-origin { color: #c7d3e5; width: fit-content; max-width: 100%; border: 1px solid rgba(255,255,255,.07); background: rgba(255,255,255,var(--hud-muted-alpha,.025)); padding: 3px 6px; border-radius: 7px; font-size: 10px; margin: 8px 0 5px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-chips { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 4px; margin: 5px 0; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-chip { flex: none; white-space: nowrap; font-size: 10px; line-height: 1.5; padding: 2px 6px; border-radius: 6px; background: rgba(125,211,252,var(--hud-indicator-alpha,.055)); border: 1px solid rgba(125,211,252,.1); color: #b8cfe8; font-variant-numeric: tabular-nums; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-transcript { max-height: 132px; overflow: auto; padding: 8px 9px; margin: 7px 0; border-radius: 10px; background: none; border: 1px solid rgba(210,228,255,.06); user-select: text; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-transcript .fm-global-text { display: inline; margin: 0; padding: 0; border: 0; max-height: none; overflow: visible; background: none; white-space: inherit; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-transcript .fm-global-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-partial { color: #a6b8d3; font-style: italic; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-partial::before { content: ' '; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-note { color: #f4c996; padding: 6px 0; font-size: 10px; }\n.fm-global-hud[data-surface=\"hud\"] button.fm-hud-alert { color: #fcd68d; border-color: rgba(253,186,116,.35); background: rgba(180,83,9,.15); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-actions { gap: 5px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-actions button { flex: 1; min-height: 28px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-settings label { font-size: 10px; min-width: 0; color: #c3d2e7; }\n.fm-global-hud[data-surface=\"hud\"] input[type=\"range\"] { accent-color: #7dd3fc; cursor: pointer; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-player { padding: 10px 0 0; padding-inline: 6px; border-color: rgba(255,255,255,.08); margin-top: 10px; background: rgba(12,20,36,var(--hud-surface-alpha,.76)); border-radius: 10px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-player-state { font-size: 10px; color: #c5d3e8; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-player-buttons { gap: 5px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-player-buttons button { min-height: 31px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-player-buttons [data-action=\"toggle\"] { background: rgba(14,165,233,.2); border-color: rgba(125,211,252,.3); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-seek-note { font-size: 9px; line-height: 1.45; color: #c0cee2; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-metrics { margin-top: 8px; border-top: 1px solid rgba(255,255,255,.06); color: #a8b8cf; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-metrics summary { padding: 7px 0 2px; cursor: pointer; font-size: 10px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-metric-values { display: grid; gap: 5px; max-height: 160px; overflow: auto; padding-top: 6px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-hud-metric { display: block; font-size: 10px; overflow-wrap: anywhere; user-select: text; }\n@media(max-width:360px) { .ext-hud-body { padding: 12px 8px 8px; } .fm-global-hud[data-surface=\"hud\"] .fm-global-status { max-width: 10ch; } }\n@media(max-height:480px) { .ext-hud-title { max-height: 90px; } .ext-hud-card[data-minimized=\"true\"] .ext-hud-title { display: none; } .fm-global-hud[data-surface=\"hud\"] .fm-global-player .fm-global-settings { margin-top: 5px; } }\n@media(max-height:340px) { .ext-hud-header { gap: 4px; padding: 6px 5px; } .ext-hud-title { display: none; } .ext-hud-controls,.ext-hud-header .fm-global-mini-controls { gap: 2px; } .ext-hud-header button,.ext-hud-header .fm-global-mini-controls button { height: 24px; } }\n@media(prefers-reduced-motion:reduce) { .ext-hud-card, .ext-hud-card * { animation: none !important; transition: none !important; } .ext-hud-panel { transform: none !important; } }\n\n.ext-hud-text-preview {\n  max-height: 80px;\n  overflow-y: auto;\n  font-size: 12px;\n  color: #cbd5e1;\n  background: rgba(0, 0, 0, 0.25);\n  border-radius: 6px;\n  padding: 8px;\n  margin-bottom: 10px;\n  border: 1px solid rgba(255, 255, 255, 0.05);\n  word-break: break-word;\n}\n\n.ext-hud-actions {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ext-btn-primary {\n  background: #3b82f6;\n  color: white;\n  border: none;\n  border-radius: 6px;\n  padding: 6px 12px;\n  font-size: 12px;\n  font-weight: 500;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  transition: background 0.15s;\n}\n\n.ext-btn-primary:hover {\n  background: #2563eb;\n}\n\n.ext-btn-secondary {\n  background: rgba(255, 255, 255, 0.08);\n  color: #cbd5e1;\n  border: 1px solid rgba(255, 255, 255, 0.1);\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 12px;\n  cursor: pointer;\n  transition: background 0.15s;\n}\n\n.ext-btn-secondary:hover {\n  background: rgba(255, 255, 255, 0.15);\n}\n\n.ext-hud-sliders {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 10px;\n  font-size: 11px;\n  color: #94a3b8;\n}\n\n.ext-hud-sliders input[type=\"range\"] {\n  flex: 1;\n  accent-color: #3b82f6;\n  height: 4px;\n}\n\n@keyframes ext-pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.5; }\n}\n\n/* Overlay do Lens */\n.ext-lens-overlay {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.35);\n  z-index: 2147483646;\n  cursor: crosshair;\n}\n\n.ext-lens-box {\n  position: absolute;\n  border: 2px dashed #3b82f6;\n  background: rgba(59, 130, 246, 0.15);\n  pointer-events: none;\n}\n\n/* Identical transport material in cards, global player and minimized rail. */\n.ext-hud-card .fm-global-hud[data-surface=\"hud\"] .fm-hud-transport,\n.ext-hud-card .ext-hud-header .fm-hud-transport {\n  height: 30px; min-height: 30px; box-sizing: border-box;\n  display: inline-flex; align-items: center; justify-content: center;\n  padding: 0; border: 1px solid rgba(125,185,255,.24); border-radius: 9px;\n  background: rgba(20,60,88,var(--hud-transport-alpha,.6)); color: #bae6fd;\n  font: 13px/1 Arial,sans-serif; box-shadow: inset 0 1px rgba(255,255,255,var(--hud-button-alpha,.04));\n  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;\n}\n.ext-hud-card .fm-global-hud[data-surface=\"hud\"] .fm-hud-transport:hover,\n.ext-hud-card .ext-hud-header .fm-hud-transport:hover { background: rgba(30,80,110,.76); border-color: rgba(125,211,252,.4); color: #f0f9ff; }\n.ext-hud-card .fm-hud-transport:is([data-action=\"previous\"],[data-action=\"next\"]) { font-size: 10px; letter-spacing: -2px; padding-right: 2px; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-player-buttons { grid-template-columns: repeat(4,1fr); }\n\n.ext-hud-card[data-resized=\"true\"] .ext-hud-panel { height: auto; }\n.ext-hud-card[data-resized=\"true\"] .ext-hud-body { flex: 1; }\n.ext-hud-card[data-resized=\"true\"] .fm-global-jobs { max-height: none; }\n#ext-resize-handle { position: absolute; z-index: 3; left: 1px; top: 1px; width: 18px; height: 18px; padding: 0; border: 0; background: none; color: rgba(180,210,235,.65); cursor: nwse-resize; touch-action: none; font: 16px/1 system-ui; }\n#ext-resize-handle:hover { color: #bae6fd; }\n\n.fm-hud-chip { display: inline-flex; align-items: center; gap: 4px; }\n.fm-hud-chip::before { content: ''; width: 12px; height: 12px; flex: none; background: currentColor; mask: var(--metric-icon) center/contain no-repeat; -webkit-mask: var(--metric-icon) center/contain no-repeat; }\n.fm-hud-task-wave { margin-bottom: 7px; height: 22px; overflow: hidden; color: #fb7185; }\n.fm-hud-task-wave svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; transform: scaleY(.12); }\n.fm-hud-task-wave[data-active=\"true\"] { color: #38bdf8; }\n.fm-hud-task-wave[data-active=\"true\"] svg { animation: ext-player-wave 1.2s ease-in-out infinite alternate; }\n@keyframes ext-player-wave { from { transform: scaleY(.35); } to { transform: scaleY(1); } }\n.fm-hud-chip[data-icon=\"forwardedChunks\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M12%2016V3m-4%204%204-4%204%204M4%2014v6h16v-6%22/%3E%3C/svg%3E\"); }\n.fm-hud-chip[data-icon=\"pendingChunks\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M9%205h12M9%2012h12M9%2019h12M3%205h1M3%2012h1M3%2019h1%22/%3E%3C/svg%3E\"); }\n.fm-hud-chip[data-icon=\"completedBlocks\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m4%2012%205%205L20%206%22/%3E%3C/svg%3E\"); }\n.fm-hud-chip[data-icon=\"totalBlocks\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M3%203h7v7H3zm11%200h7v7h-7zM3%2014h7v7H3zm11%200h7v7h-7z%22/%3E%3C/svg%3E\"); }\n.fm-hud-chip[data-icon=\"currentTime\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%2210%22/%3E%3Cpath%20d%3D%22M12%205v7l4%202%22/%3E%3C/svg%3E\"); }\n.fm-hud-chip[data-icon=\"duration\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M5%203h14M5%2021h14M7%203c0%205%2010%2013%2010%2018M17%203C17%208%207%2016%207%2021%22/%3E%3C/svg%3E\"); }\n\n.fm-hud-task-wave[data-active=\"false\"] svg { stroke-width: 10; }\n\n.fm-hud-task-wave[data-active=\"true\"][data-mode=\"stt\"] { color: #fb7185; }\n.fm-hud-chip[data-icon=\"capturedChunks\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M12%203v13m-4-4%204%204%204-4M4%2014v6h16v-6%22/%3E%3C/svg%3E\"); }\n.fm-hud-chip[data-icon=\"blocks\"] { --metric-icon: url(\"data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22black%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M3%203h7v7H3zm11%200h7v7h-7zM3%2014h7v7H3zm11%200h7v7h-7z%22/%3E%3C/svg%3E\"); }\n\n@keyframes ext-rail-flow { from { background-position: 0 190%; } to { background-position: 0 -190%; } }\n\n/* Only the contour is colored. Functional backgrounds remain independent. */\n@property --fm-border-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header::before,\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header::after { display: none; animation: none; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card { position: relative; isolation: isolate; }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card[data-task-type=\"narration\"],\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header[data-task-type=\"narration\"] { --task-main: #2563EB; --task-accent: #38BDF8; --task-glow: rgba(56,189,248,.5); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card[data-task-type=\"dictation\"],\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header[data-task-type=\"dictation\"] { --task-main: #10A37F; --task-accent: #34D399; --task-glow: rgba(16,185,129,.45); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card[data-task-type=\"lens\"],\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header[data-task-type=\"lens\"] { --task-main: #EA580C; --task-accent: #FB923C; --task-glow: rgba(251,146,60,.5); }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card:is([data-task-type=\"narration\"],[data-task-type=\"dictation\"],[data-task-type=\"lens\"])::before,\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header:is([data-task-type=\"narration\"],[data-task-type=\"dictation\"],[data-task-type=\"lens\"])::before {\n  content: ''; display: block; position: absolute; inset: -1px; width: auto; height: auto; padding: 2px; border-radius: inherit; pointer-events: none; z-index: 1;\n  background: conic-gradient(from var(--fm-border-angle),var(--task-main) 0deg 110deg,var(--task-accent) 140deg,#fff 146deg 148deg,var(--task-accent) 154deg,var(--task-main) 180deg 290deg,var(--task-accent) 320deg,#fff 326deg 328deg,var(--task-accent) 334deg,var(--task-main) 360deg);\n  -webkit-mask: linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);\n  mask: linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);\n  -webkit-mask-composite: xor; mask-composite: exclude;\n  opacity: var(--hud-border-strength,.6); animation: fm-task-border-turn 4s linear infinite;\n}\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card:is([data-task-type=\"narration\"],[data-task-type=\"dictation\"],[data-task-type=\"lens\"])::after,\n.ext-hud-card[data-minimized=\"true\"] .ext-hud-header:is([data-task-type=\"narration\"],[data-task-type=\"dictation\"],[data-task-type=\"lens\"])::after {\n  content: ''; display: block; position: absolute; inset: 0; width: auto; height: auto; border-radius: inherit; pointer-events: none; background: none;\n  box-shadow: inset 0 0 7px var(--task-glow),0 0 9px var(--task-glow);\n  opacity: var(--hud-border-strength,.6); animation: fm-task-border-glow 3s ease-in-out infinite;\n}\n@keyframes fm-task-border-turn { to { --fm-border-angle: 360deg; } }\n@keyframes fm-task-border-glow { 0%,100% { opacity: calc(var(--hud-border-strength,.6) * .55); } 50% { opacity: var(--hud-border-strength,.6); } }\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card:not([data-task-running=\"true\"])::before,\n.fm-global-hud[data-surface=\"hud\"] .fm-global-card:not([data-task-running=\"true\"])::after,\n.ext-hud-card:is(.hidden,[data-minimized=\"true\"]) .fm-global-card::before,\n.ext-hud-card:is(.hidden,[data-minimized=\"true\"]) .fm-global-card::after { animation-play-state: paused; }\n@media(prefers-reduced-motion:reduce) { .fm-global-hud[data-surface=\"hud\"] .fm-global-card::before,.fm-global-hud[data-surface=\"hud\"] .fm-global-card::after,.ext-hud-card[data-minimized=\"true\"] .ext-hud-header::before,.ext-hud-card[data-minimized=\"true\"] .ext-hud-header::after { animation: none !important; } }\n\n/* Dedicated task content, without a browser window or an additional outer frame. */\n.fm-task-float { position: fixed; pointer-events: auto; box-sizing: border-box; border: 0; padding: 0; border-radius: 14px; background: rgba(12,17,28,var(--hud-panel-alpha,.49)); color: #e2e8f0; }\n.fm-task-content,.fm-task-float .fm-global-hud { height: 100%; min-height: 0; }\n.fm-task-float .fm-global-hud { display: flex; flex-direction: column; padding: 0; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-jobs { flex: 1; min-height: 0; max-height: none; overflow: hidden; margin: 0; padding: 0; display: flex; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-card { flex: 1; width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; align-self: stretch; box-sizing: border-box; overflow: auto; padding: 12px; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-card-header { cursor: grab; touch-action: none; padding-right: 28px; flex: none; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-detail { flex: 1; min-height: 50px; display: flex; flex-direction: column; overflow: auto; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-editor { flex: 1; min-height: 80px; max-height: none; resize: none; box-sizing: border-box; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-hud-transcript { flex: 1; max-height: 45%; min-height: 44px; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-hud-task-wave { flex: none; margin-right: 30px; cursor: grab; touch-action: none; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] :is(.fm-global-actions,.fm-global-settings,.fm-hud-metrics) { flex: none; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-settings { padding-right: 18px; }\n.fm-task-float .fm-global-hud[data-surface=\"hud\"] .fm-global-note { max-height: 72px; overflow: auto; }\n.fm-task-float .fm-global-empty { cursor: grab; padding-right: 42px; }\n.fm-task-float .fm-task-close { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; z-index: 3; }\n.fm-task-resize { position: absolute; bottom: 3px; right: 3px; z-index: 3; width: 20px; height: 20px; border: 0; border-radius: 5px; background: none; color: #a5c8dc; cursor: nwse-resize; touch-action: none; font: 17px/1 system-ui; }\n.fm-task-float :is(button,input,summary,textarea,[tabindex]):focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }\n"; module.exports.default=module.exports;
},
};
const __cache={}; function __require(id){if(__cache[id])return __cache[id].exports;const fn=__modules[id];if(!fn)throw new Error("Module not found: "+id);const module={exports:{}};__cache[id]=module;fn(module,module.exports,__require);return module.exports;}
__require("extension/src/content/entrypoint.ts");
})();
