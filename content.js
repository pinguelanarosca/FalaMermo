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
    const custom = agentsData?.customAgents?.find((a) => a?.metadata?.id === id);
    const agent = custom || (0, defaultAgents_1.getCanonicalAgent)(id);
    ttsController_1.tts.setVolume(agent?.voice?.volume ?? 1);
    ttsController_1.tts.setSpeed(agent?.voice?.rateMultiplier ?? 1);
    ttsController_1.tts.preferenceAgentId=id;
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
        if (e.ctrlKey && e.shiftKey && e.button === 0) {
            e.preventDefault();
            lensController_1.lens.startDragSelection(e.clientX, e.clientY, cachedActiveAgentId);
        }
    });
    // Listener para mensagens vindas do Background / Popup / Menus
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        switch (message.type) {
            case 'HUD_GLOBAL_STATE': {
                hudController_1.hud.applyGlobalState?.(message.state || message.payload?.state);
                sendResponse({success:true});
                break;
            }
            case 'STT_GLOBAL_STOP': {
                const capture=sttController_1.stt.liveCapture;
                if(!capture||capture.jobId!==message.payload?.jobId){sendResponse({success:false,error:'Captura original indisponível.'});break;}
                void sttController_1.stt.stopLiveRecording(capture.jobId).then(()=>sendResponse({success:true}),error=>{sttController_1.stt.reportRuntimeError(error);sendResponse({success:false,error:'Falha ao concluir captura original.'});});
                return true;
            }
            case 'STT_GLOBAL_STATUS': {
                sendResponse({success:true,...sttController_1.stt.getJobState(message.payload?.jobId)});
                break;
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
                    void sttController_1.stt.handleLiveEvent(message.payload || {}).catch(error => sttController_1.stt.reportRuntimeError(error));
                    sendResponse({ success: true });
                } catch (error) { sttController_1.stt.reportRuntimeError(error); return false; }
                break;
            }
        }
        return true;
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
    static getInstance() {
        if (!HudController.instance) {
            HudController.instance = new HudController();
        }
        return HudController.instance;
    }
    init(cssContent) {
        if (this.container)
            return;
        shadowDomWrapper_1.shadowDom.injectStyles(cssContent);
        const root = shadowDomWrapper_1.shadowDom.getRoot();
        const wrapper = document.createElement('div');
        wrapper.className = 'ext-hud-card hidden';
        wrapper.setAttribute('data-fm-layout','compact-2');
        wrapper.style.right = `${this.posX}px`;
        wrapper.style.bottom = `${this.posY}px`;
        wrapper.innerHTML = `
      <div class="ext-hud-header" id="ext-drag-handle">
        <div class="ext-hud-title">
          <span>⚡ FalaMermo</span>
          <span class="ext-hud-badge idle" id="ext-badge">Pronto</span>
        </div>
        <div id="ext-global-compact" class="fm-global-mini-controls" hidden></div>
        <div class="ext-hud-controls">
          <button class="ext-btn-icon" id="ext-btn-min" title="Ocultar">−</button>
          <button class="ext-btn-icon" id="ext-btn-close" title="Fechar">✕</button>
        </div>
      </div>
      <div class="ext-hud-body">
        <div id="ext-global-jobs"></div>
      </div>
    `;
        root.appendChild(wrapper);
        this.container = wrapper;
        this.badgeElement = wrapper.querySelector('#ext-badge');
        this.previewElement = wrapper.querySelector('#ext-preview');
        this.playPauseBtn = wrapper.querySelector('#ext-btn-play');
        this.volumeSlider = wrapper.querySelector('#ext-vol');
        this.speedSlider = wrapper.querySelector('#ext-speed');
        this.setupListeners(wrapper);
        if(globalThis.GlobalHud){
            this.globalView=globalThis.GlobalHud.mount(wrapper.querySelector('#ext-global-jobs'),{embedded:true,compactControls:wrapper.querySelector('#ext-global-compact'),agentSelector:true,send:message=>chrome.runtime.sendMessage(message),onState:state=>this.applyGlobalState(state)});
        }
    }
    setupListeners(wrapper) {
        const handle = wrapper.querySelector('#ext-drag-handle');
        const closeBtn = wrapper.querySelector('#ext-btn-close');
        const minBtn = wrapper.querySelector('#ext-btn-min');
        const micBtn = wrapper.querySelector('#ext-btn-mic');
        const lensBtn = wrapper.querySelector('#ext-btn-lens');
        const stopBtn = wrapper.querySelector('#ext-btn-stop');
        closeBtn?.addEventListener('click', () => {
            this.hide();
            this.onCloseClick?.();
        });
        minBtn?.addEventListener('click', () => this.updateGlobalUi({minimized:!this.globalMinimized}));
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
        // Suporte a arrastar (Drag and drop)
        handle?.addEventListener('mousedown', (e) => {
            if(e.button!==0||e.target.closest?.('button,input,a,[data-no-drag]'))return;
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            const rect = wrapper.getBoundingClientRect();
            this.posX = window.innerWidth - rect.right;
            this.posY = window.innerHeight - rect.bottom;
            const onMouseMove = (ev) => {
                if (!this.isDragging)
                    return;
                const dx = ev.clientX - this.dragStartX;
                const dy = ev.clientY - this.dragStartY;
                wrapper.style.right = `${Math.max(10, this.posX - dx)}px`;
                wrapper.style.bottom = `${Math.max(10, this.posY - dy)}px`;
            };
            const onMouseUp = (ev) => {
                this.isDragging = false;
                const dx = ev.clientX - this.dragStartX;
                const dy = ev.clientY - this.dragStartY;
                this.posX = Math.max(10, this.posX - dx);
                this.posY = Math.max(10, this.posY - dy);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
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
    show() {
        this.container?.classList.remove('hidden');
        this.updateGlobalUi({visible:true});
    }
    hide() {
        this.container?.classList.add('hidden');
        this.updateGlobalUi({visible:false});
    }
    updateGlobalUi(payload){if(!globalThis.GlobalHud)return;try{void chrome.runtime.sendMessage({type:'HUD_GLOBAL_UI_SET',payload}).then(result=>{if(result?.success&&result.state)this.applyGlobalState(result.state);}).catch(error=>console.error('[HUD visibility]',error?.message||String(error)));}catch(error){console.error('[HUD visibility]',error?.message||String(error));}}
    applyGlobalState(state){if(!state||Number.isFinite(this.globalRevision)&&state.revision<this.globalRevision)return;this.globalRevision=state.revision;this.globalMinimized=state.minimized===true;this.container?.setAttribute?.('data-minimized',String(this.globalMinimized));this.container?.classList.toggle('hidden',state.visible===false);for(const element of this.container?.querySelectorAll('.ext-hud-body')||[]){element.hidden=this.globalMinimized;element.inert=this.globalMinimized;}const jobs=state.jobs||[],playing=jobs.filter(job=>job.type==='TTS'&&job.status==='playing').length,recording=jobs.filter(job=>job.type==='STT'&&job.status==='recording').length,active=jobs.filter(job=>!['ready','completed','error','cancelled'].includes(job.status)).length,badge=this.container?.querySelector('#ext-badge');if(badge){badge.textContent=recording||playing?[recording?recording+' gravando':'',playing?playing+' narrando':''].filter(Boolean).join(' · '):active?active+' em andamento':jobs.some(job=>job.status==='paused')?'Pausado':'Pronto';badge.dataset.state=recording?'recording':playing?'playing':'idle';badge.className='ext-hud-badge '+badge.dataset.state;}const button=this.container?.querySelector('#ext-btn-min');if(button){button.title=this.globalMinimized?'Restaurar HUD':'Minimizar HUD';button.setAttribute('aria-expanded',String(!this.globalMinimized));button.setAttribute('aria-label',button.title);button.textContent=this.globalMinimized?'▢':'−';}this.globalView?.update(state);}
    toggle() {
        if (this.container?.classList.contains('hidden')) {
            this.show();
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
    async speakText(text, agentId) {
        const rawText = text?.trim();
        if (!rawText)
            return;
        if(this.audio?.isBackgroundAudio&&globalThis.GlobalHud){
            const playerId='hud-tts-'+crypto.randomUUID(),playback={playerId,requestId:playerId+':1',...(this.preferenceAgentId===agentId?{volume:this.volume,playbackRate:this.playbackRate}:{})};
            const task={rawText,agentId,playback,paused:false};this.latestGlobalTask=task;this.activeTask=task;hudController_1.hud.show();
            // Cada narração ganha player/request próprios. Não reservar o singleton cancela outra sessão.
            await new Promise(resolve=>{try{chrome.runtime.sendMessage({type:'TTS_REQUEST',payload:{text:rawText,agentId,playback}},response=>{
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
        try {
            if (!this.ensureExtensionContext()) throw new Error('Extension context invalidated.');
            return await chrome.runtime.sendMessage(message);
        } catch (error) {
            if (/extension context invalidated/i.test(error?.message || String(error))) this.invalidateExtensionContext();
            throw error;
        }
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
            if(this.liveCapture)void this.stopLiveRecording(this.liveCapture.jobId).catch(error=>this.reportRuntimeError(error));
        });
    }
    async toggleRecording(agentId) {
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
        this.targetSelection=(0,inputInjector_1.captureDictationTarget)()||this.lastDictationTarget;
        this.targetElement=this.targetSelection?.element||null;
        if(!this.targetElement){hudController_1.hud.setStatus('idle','Selecione um campo editável');return;}
        const jobId=crypto.randomUUID(),generation=(this.liveGeneration||0)+1;
        this.liveJobId=jobId;this.liveGeneration=generation;this.liveTranscript='';this.liveCommitted='';this.resampleCursor=0;this.resamplePrevious=0;
        const capture={jobId,generation,starting:true,pending:Promise.resolve()};this.liveCapture=capture;
        const job={jobId,generation,capture,target:this.targetSelection,committed:'',partial:'',mode:this.insertionMode,cancelled:false,insertion:new globalThis.DictationRuntime.Insertion(this.targetSelection,{normalize:text=>(0,inputInjector_1.normalizeDictatedText)(text)})};this.liveJobs.set(jobId,job);
        globalThis.LiveSttDiagnostics?.capture(capture,'starting');
        hudController_1.hud.show();hudController_1.hud.setStatus('loading','Conectando ditado');hudController_1.hud.setTextPreview('Aguarde “Gravando” antes de falar.');
        const current=()=>this.liveCapture===capture&&this.liveGeneration===generation;
        // Uma recarga pode não produzir outro callback Chrome. Vigia apenas o job ativo, sem reconectar.
        this.contextWatch=setInterval(()=>{try{this.ensureExtensionContext();}catch(error){this.cancelRecording();this.reportRuntimeError(error);}},1000);
        try {
            if(this.preferencesReady)await this.preferencesReady;
            if(!current()||!this.ensureExtensionContext())return;
            if(this.preferencesError)throw new Error('Não foi possível ler a preferência de inserção. Reabra as opções e confirme o modo antes de ditar.');
            job.mode=this.insertionMode;
            globalThis.LiveSttDiagnostics?.capture(capture,'starting',{insertionMode:job.mode});
            const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1}});capture.stream=stream;
            if(!current()){stream.getTracks().forEach(track=>track.stop());return;}
            this.activeStream=stream;
            globalThis.LiveSttDiagnostics?.capture(capture,'microphone-open');
            const opened=await this.sendLiveMessage({type:'STT_LIVE_START',payload:{jobId,playerId:jobId,generation,agentId,realtime:job.mode==='realtime'}});
            if(!current()){this.cancelLiveJob(jobId);return;}
            if(!opened?.success)throw new Error(opened?.error||'Falha ao abrir STT Live.');
            job.transform=opened.transform===true;
            globalThis.LiveSttDiagnostics?.capture(capture,'setup-complete',{insertionMode:job.mode,transform:job.transform});
            if(!this.ensureExtensionContext())return;
            const ctx=new AudioContext({latencyHint:'interactive'});capture.context=ctx;this.liveAudioContext=ctx;await ctx.audioWorklet.addModule(chrome.runtime.getURL('mic-capture-worklet.js'));
            if(!current()||!this.ensureExtensionContext())return;
            const source=ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(ctx,'gemini-mic-capture',{channelCount:1,channelCountMode:'explicit',outputChannelCount:[1]}),mute=ctx.createGain();mute.gain.value=0;source.connect(node).connect(mute).connect(ctx.destination);capture.source=source;capture.node=node;capture.mute=mute;this.liveCaptureNode=node;
            globalThis.LiveSttDiagnostics?.capture(capture,'worklet-ready');
            capture.audioQueue=new globalThis.DictationRuntime.AudioQueue({metrics:capture.metrics||(capture.metrics={}),send:payload=>this.sendLiveMessage({type:'STT_LIVE_AUDIO',payload}),onFailure:error=>{globalThis.LiveSttDiagnostics?.capture(capture,error.code==='ACK_TIMEOUT'?'ack-timeout':'error',{outcome:error.code==='ACK_TIMEOUT'?'ACK_TIMEOUT':'CONNECTION'});return this.handleLiveEvent({jobId,generation,event:'stt-error',error:error.code==='ACK_TIMEOUT'?'O envio de PCM não recebeu confirmação em 10 segundos. O ditado foi interrompido; consulte o diagnóstico STT.':error.message||String(error)});},onProgress:()=>{
                if(!capture.lastDiagnosticAt||Date.now()-capture.lastDiagnosticAt>=1000){capture.lastDiagnosticAt=Date.now();globalThis.LiveSttDiagnostics?.capture(capture,'capture-progress');this.publishCapture(job,capture.stopping?'flushing':'recording');}
            }});
            capture.chunker=job.mode==='realtime'?new globalThis.SttRealtime.CapturePipeline({jobId,realtime:true,submitAudioChunk:packet=>this.submitAudioChunk(capture,packet),onDiagnostic:packet=>globalThis.LiveSttDiagnostics?.capture(capture,packet.stage,packet)}):null;
            node.port.onmessage=event=>{
                if(event.data?.type==='flushed'){capture.flushAcknowledged=true;capture.flushed?.();return;}
                if(!current())return;
                const input=new Float32Array(event.data),pcm=this.resamplePcm16(input,ctx.sampleRate,16000);if(!pcm.length)return;if(globalThis.LiveSttDiagnostics?.observe)globalThis.LiveSttDiagnostics.observe(capture,input,pcm);else{const m=capture.metrics;m.capturedBytes=(m.capturedBytes||0)+pcm.byteLength;m.captureChunks=(m.captureChunks||0)+1;m.capturedFrames=(m.capturedFrames||0)+input.length;}let raw='';if(!capture.chunker)for(let i=0;i<pcm.length;i+=0x8000)raw+=String.fromCharCode(...pcm.subarray(i,i+0x8000));const audioBase64=capture.chunker?undefined:btoa(raw);
                if(capture.chunker)capture.chunker.push(pcm);else capture.audioQueue.push({jobId,playerId:jobId,generation,audioBase64,sampleRate:16000},pcm.byteLength);capture.pending=capture.audioQueue.tail;
                this.liveAudioPending=capture.pending;
            };
            await ctx.resume();if(!current()||!this.ensureExtensionContext())return;
            if(ctx.state!=='running')throw new Error('AudioContext do microfone não está running: '+ctx.state);
            globalThis.LiveSttDiagnostics?.capture(capture,'capture-running');
            capture.starting=false;this.isRecording=true;hudController_1.hud.show();hudController_1.hud.setStatus('recording','Gravando');hudController_1.hud.setTextPreview('Transcrevendo enquanto você fala. Use o atalho novamente para concluir.');
            this.publishCapture(job,'recording');
        } catch(error){if(/extension context invalidated/i.test(error?.message||String(error))){this.invalidateExtensionContext();return;}if(this.liveJobId===jobId){this.cancelRecording();if(this.contextInvalidated)return;hudController_1.hud.setStatus('idle','Falha no STT Live');hudController_1.hud.setTextPreview(error.message||String(error));}}
    }
    async releaseLiveCapture(capture=this.liveCapture){
        if(!capture)return;
        capture.stream?.getTracks().forEach(track=>track.stop());
        capture.chunker?.cancel();
        if(capture.releasing)return capture.releasing;
        if(capture.node)capture.node.port.onmessage=null;
        for(const resource of [capture.node,capture.source,capture.mute]){try{resource?.disconnect();}catch(error){this.reportRuntimeError(error);}}
        if(this.liveCapture===capture){this.liveCapture=null;this.isRecording=false;this.activeStream=null;this.liveCaptureNode=null;this.liveAudioContext=null;this.liveJobId=null;this.clearContextWatch();}
        capture.released=true;capture.releasing=Promise.resolve().then(()=>capture.context?.close()).catch(error=>this.reportRuntimeError(error)).then(()=>globalThis.LiveSttDiagnostics?.capture(capture,'capture-released',{flushAcknowledged:capture.flushAcknowledged===true}));return capture.releasing;
    }
    publishCapture(job,status){
        if(!job||this.contextInvalidated)return;
        const m=job.capture?.metrics||{};
        void this.sendLiveMessage({type:'HUD_CAPTURE_STATE',payload:{jobId:job.jobId,status,capturedChunks:m.captureChunks||0,capturedBytes:m.capturedBytes||0,forwardedChunks:m.forwardedChunks||0,forwardedBytes:m.forwardedBytes||0,pendingChunks:m.pendingChunks||0,microphoneReleased:job.capture?.released===true}}).catch(error=>this.reportRuntimeError(error));
    }
    submitAudioChunk(capture,packet){
        if(capture.released||this.liveJobs.get(capture.jobId)?.cancelled)return;
        const pcm=packet.pcm;let raw='';for(let i=0;i<pcm.length;i+=0x8000)raw+=String.fromCharCode(...pcm.subarray(i,i+0x8000));
        capture.audioQueue.push({jobId:capture.jobId,playerId:capture.jobId,generation:capture.generation,sampleRate:16000,...(packet.endOnly?{endOnly:true}:{audioBase64:btoa(raw)}),chunk:packet.chunk},pcm.byteLength);
    }
    getJobState(jobId){const remembered=this.completedJobs.get(jobId);if(remembered)return{found:true,...remembered};const job=this.liveJobs.get(jobId);return job?{found:true,status:job.finishing?'inserting':job.capture.released?'waiting':job.capture.starting?'connecting':'recording',microphoneReleased:job.capture.released===true}:{found:false};}
    rememberJobResult(jobId,result){this.completedJobs.set(jobId,{status:result.inserted?'completed':'insertion-failed',inserted:result.inserted,reason:result.reason,microphoneReleased:true});while(this.completedJobs.size>32)this.completedJobs.delete(this.completedJobs.keys().next().value);}
    async stopLiveRecording(requestedJobId){
        if(!this.ensureExtensionContext())return;
        const capture=this.liveCapture;if(!capture||capture.stopping||requestedJobId&&capture.jobId!==requestedJobId)return;
        if(capture.starting){this.cancelRecording();if(!this.contextInvalidated)hudController_1.hud.setStatus('idle','Parado');return;}
        try {
        capture.stopping=true;this.isRecording=false;
        const job=this.liveJobs.get(capture.jobId);this.publishCapture(job,'flushing');hudController_1.hud.setStatus('loading','Finalizando envio');
        globalThis.LiveSttDiagnostics?.capture(capture,'capture-stopping');
        const flushed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{capture.metrics.flushTimeouts=(capture.metrics.flushTimeouts||0)+1;reject(Object.assign(Error('O AudioWorklet não confirmou o flush do PCM. Resultado pode estar incompleto.'),{code:'FLUSH_TIMEOUT'}));},1000);capture.flushed=()=>{clearTimeout(timer);resolve();};capture.node.port.postMessage({type:'flush'});});
        capture.stream.getTracks().forEach(track=>track.stop());await flushed;capture.chunker?.finish();await this.releaseLiveCapture(capture);globalThis.LiveSttDiagnostics?.capture(capture,'queue-draining');await capture.audioQueue.drain();
        if(!job||job.cancelled||!this.liveJobs.has(capture.jobId))return;
        globalThis.LiveSttDiagnostics?.capture(capture,'capture-released',{flushAcknowledged:capture.flushAcknowledged===true});
        if(capture.metrics&&!capture.metrics.capturedBytes){job.cancelled=true;job.insertion.invalidate('NO_CAPTURE');job.insertion.dispose();this.liveJobs.delete(job.jobId);this.cancelLiveJob(job.jobId);void globalThis.LiveSttDiagnostics?.emit({jobId:capture.jobId,scope:'result',stage:'error',outcome:'NO_CAPTURE'});if(!this.liveCapture){hudController_1.hud.setStatus('idle','Nenhum PCM capturado');hudController_1.hud.setTextPreview('O microfone abriu, mas o worklet não entregou amostras. Verifique dispositivo, permissão e AudioContext.');}return;}
        this.publishCapture(job,'waiting');if(!this.liveCapture)hudController_1.hud.setStatus('loading','Aguardando Gemini');
        const result=await this.sendLiveMessage({type:'STT_LIVE_STOP',payload:{jobId:capture.jobId,playerId:capture.jobId,generation:capture.generation}});if(!result?.success)throw new Error(result?.error||'Falha ao finalizar ditado.');}
        catch(error){if(error.code==='FLUSH_TIMEOUT')globalThis.LiveSttDiagnostics?.capture(capture,'flush-timeout',{outcome:'FLUSH_TIMEOUT'});await this.handleLiveEvent({jobId:capture.jobId,generation:capture.generation,event:'stt-error',error:error.message});}
    }
    async handleLiveEvent(payload){
        const job=this.liveJobs.get(payload.jobId);if(!job||job.cancelled||payload.generation!==undefined&&payload.generation!==job.generation)return;
        if(Number.isInteger(payload.eventSeq)){if(payload.eventSeq<=job.eventSeq)return;job.eventSeq=payload.eventSeq;}
        if(!this.ensureExtensionContext())return;
        if(payload.event==='stt-error'&&/extension context invalidated/i.test(payload.error||'')){this.invalidateExtensionContext();return;}
        const showLegacy=()=>!this.liveCapture||this.liveCapture.jobId===job.jobId;
        if(payload.event==='stt-cancelled'){
            job.cancelled=true;job.capture?.audioQueue?.close();job.insertion.invalidate('CANCELLED');job.insertion.dispose();await this.releaseLiveCapture(job.capture);this.liveJobs.delete(job.jobId);this.completedJobs.set(job.jobId,{status:'cancelled',inserted:false,reason:'CANCELLED',microphoneReleased:true});while(this.completedJobs.size>32)this.completedJobs.delete(this.completedJobs.keys().next().value);
            if(showLegacy()){hudController_1.hud.setStatus('idle','Parado · cancelado');hudController_1.hud.setTextPreview([job.committed,job.partial].filter(Boolean).join(' ')||'Ditado cancelado.');}return;
        }
        if(payload.event==='stt-partial'||payload.event==='stt-segment'){
            if(typeof payload.confirmedText==='string'){job.committed=payload.confirmedText;job.partial=payload.partialText||'';}
            else if(payload.event==='stt-segment'){job.committed=[job.committed,payload.text].filter(Boolean).join(' ');job.partial='';}
            else job.partial=payload.text||'';
            this.liveCommitted=job.committed;this.liveTranscript=job.partial;
            if(showLegacy()){hudController_1.hud.setStatus(this.isRecording?'recording':'loading',job.partial?'Transcrição provisória':'Transcrição confirmada');hudController_1.hud.setTextPreview([job.committed,job.partial].filter(Boolean).join(' '));}
            if(job.mode==='realtime'&&!job.transform)await this.insertJobText(job,[job.committed,job.partial].filter(Boolean).join(' '),false);
        }
        if(payload.event==='stt-status'&&showLegacy())hudController_1.hud.setStatus(this.isRecording?'recording':'loading',payload.status);
        if(payload.event==='stt-transform-attempt'){job.transform=true;this.publishCapture(job,'transforming');if(showLegacy())hudController_1.hud.setStatus('loading','Transformando');}
        if(payload.event==='stt-error'||payload.event==='stt-final'){
            if(job.finishing)return;job.finishing=true;await this.releaseLiveCapture(job.capture);if(job.cancelled||!this.ensureExtensionContext())return;
            if(payload.event==='stt-error'){job.capture?.audioQueue?.close();this.publishCapture(job,'error');if(showLegacy()){hudController_1.hud.setStatus('idle','Erro STT');hudController_1.hud.setTextPreview(payload.error||'Falha no ditado. O texto recebido continua no cartão da tarefa.');}this.cancelLiveJob(payload.jobId);job.insertion.dispose();this.liveJobs.delete(job.jobId);return;}
            const text=payload.text||job.committed;this.publishCapture(job,'inserting');if(showLegacy())hudController_1.hud.setStatus('loading','Inserindo');const result=await this.insertJobText(job,text,true);if(job.cancelled)return;
            this.rememberJobResult(job.jobId,result);
            this.publishCapture(job,result.inserted?'completed':'insertion-failed');
            if(showLegacy()){hudController_1.hud.setStatus('idle',result.inserted?'Parado · texto inserido':'Parado · texto não inserido');hudController_1.hud.setTextPreview(result.inserted?text:text?'O campo original não está disponível ou foi alterado. Copie a transcrição: '+text:'Nenhuma fala reconhecida.');}
            job.insertion.dispose();this.liveJobs.delete(job.jobId);
        }
    }
    async insertJobText(job,text,final){
        const metrics=job.capture.metrics||(job.capture.metrics={});metrics.insertionAttempts=(metrics.insertionAttempts||0)+1;
        void globalThis.LiveSttDiagnostics?.emit({jobId:job.jobId,scope:'result',stage:'inserting',insertionAttempts:metrics.insertionAttempts,characters:text?.length||0});
        let result;try{result=await job.insertion.apply(text,{final});}catch(error){result={inserted:false,reason:'EDITOR_ERROR'};console.error('[STT insertion]',error?.name||'Error');}
        if(result.inserted)metrics.insertionVerified=(metrics.insertionVerified||0)+1;
        if(final||!result.inserted){void globalThis.LiveSttDiagnostics?.emit({jobId:job.jobId,scope:'result',stage:result.inserted?'inserted':'insertion-failed',outcome:result.inserted?'INSERTED':'INSERTION_FAILED',inserted:result.inserted,characters:text?.length||0});
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
    cancelRecording(notify = true) {
        const jobId=this.liveCapture?.jobId||this.liveJobId||(this.liveJobs.size===1?[...this.liveJobs.keys()][0]:null);
        const cancelled=this.contextInvalidated?[...this.liveJobs.values()]:[this.liveJobs.get(jobId)].filter(Boolean);
        for(const job of cancelled){job.cancelled=true;job.capture?.audioQueue?.close();job.insertion?.invalidate('CANCELLED');job.insertion?.dispose();this.liveJobs.delete(job.jobId);if(notify&&!this.contextInvalidated)this.cancelLiveJob(job.jobId);}
        if(jobId)void globalThis.LiveSttDiagnostics?.emit({jobId,scope:'result',stage:'cancelled',outcome:this.contextInvalidated?'INVALIDATED_CONTEXT':'CANCELLED'});
        this.liveGeneration=(this.liveGeneration||0)+1;
        this.liveJobId=null;this.clearContextWatch();
        void this.releaseLiveCapture().catch(error=>this.reportRuntimeError(error));
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
        if(notify&&this.ensureExtensionContext()&&jobId&&!cancelled.length)this.cancelLiveJob(jobId);
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
    activateLensMode(agentId = 'narrator') {
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
                    }, agentId);
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
    startDragSelection(clientX, clientY, agentId = 'narrator') {
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
                }, agentId);
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
    submitSelection(rect, agentId = 'narrator') {
        this.cleanup();
        if (!this.ensureExtensionContext())
            return;
        hudController_1.hud.show();
        hudController_1.hud.setStatus('loading', 'Analisando tela');
        hudController_1.hud.setTextPreview('Inspecionando a área selecionada com Gemini Vision...');
        let isFinished = false;
        // Timeout client-side global de 30s para garantir que nunca fique travado em "Analisando tela"
        const globalTimeoutId = setTimeout(() => {
            if (isFinished)
                return;
            isFinished = true;
            if (!this.ensureExtensionContext())
                return;
            console.error('[Lens Controller] Timeout global de 30s excedido ao aguardar resposta do Lens.');
            hudController_1.hud.setStatus('idle', 'Timeout Lens');
            hudController_1.hud.setTextPreview('❌ Erro no Lens: Tempo limite de 30s excedido sem resposta.');
        }, 30000);
        try {
            chrome.runtime.sendMessage({
                type: 'LENS_ANALYZE_REQUEST',
                payload: {
                    instruction: undefined,
                    rect,
                    agentId,
                },
            }, (response) => {
                if (isFinished)
                    return;
                isFinished = true;
                clearTimeout(globalTimeoutId);
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
                if (!response || !response.success || !response.data) {
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
                // Narrar AUTOMATICAMENTE o texto extraído da região selecionada!
                if (extractedText && !extractedText.startsWith('❌')) {
                    ttsController_1.tts.speakText(extractedText, agentId);
                }
            });
        }
        catch (err) {
            if (isFinished)
                return;
            isFinished = true;
            clearTimeout(globalTimeoutId);
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
module.exports="/**\n * @license\n * SPDX-License-Identifier: Apache-2.0\n * \n * Estilos encapsulados do HUD flutuante (injetado via Shadow DOM).\n */\n\n:host {\n  all: initial;\n  position: fixed;\n  z-index: 2147483647;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 13px;\n  line-height: 1.4;\n  color: #f1f5f9;\n  user-select: none;\n}\n\n.ext-hud-card {\n  box-sizing: border-box;\n  position: fixed;\n  width: 320px;\n  max-height: calc(100vh - 48px);\n  display: flex;\n  flex-direction: column;\n  background: rgba(15, 23, 42, 0.94);\n  backdrop-filter: blur(12px);\n  -webkit-backdrop-filter: blur(12px);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  border-radius: 12px;\n  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n  overflow: hidden;\n  transition: opacity 0.2s ease, transform 0.2s ease;\n}\n\n.ext-hud-card.hidden {\n  opacity: 0;\n  pointer-events: none;\n  transform: translateY(8px) scale(0.96);\n}\n\n.ext-hud-card[data-minimized=\"true\"]{height:auto!important;min-height:0!important}\n.ext-hud-card[data-minimized=\"true\"]>.ext-hud-body{display:none!important}\n.ext-hud-card,.ext-hud-card *{scrollbar-width:none!important;scrollbar-gutter:auto!important}\n.ext-hud-card::-webkit-scrollbar,.ext-hud-card ::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}\n\n.ext-hud-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 8px 12px;\n  background: rgba(255, 255, 255, 0.04);\n  border-bottom: 1px solid rgba(255, 255, 255, 0.08);\n  cursor: grab;\n  flex-shrink: 0;\n  gap: 6px;\n}\n\n.ext-hud-header:active {\n  cursor: grabbing;\n}\n\n.ext-hud-title {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-weight: 600;\n  font-size: 12px;\n  color: #94a3b8;\n  min-width: 0;\n  white-space: nowrap;\n  overflow: hidden;\n}\n.ext-hud-title>span:first-child{flex:none}\n\n.ext-hud-badge {\n  font-size: 10px;\n  padding: 2px 6px;\n  border-radius: 9999px;\n  font-weight: 500;\n  text-transform: uppercase;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ext-hud-badge.idle { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }\n.ext-hud-badge.playing { background: rgba(59, 130, 246, 0.25); color: #60a5fa; }\n.ext-hud-badge.recording { background: rgba(239, 68, 68, 0.25); color: #f87171; animation: ext-pulse 1.5s infinite; }\n.ext-hud-badge.loading { background: rgba(245, 158, 11, 0.25); color: #fbbf24; }\n\n.ext-hud-controls {\n  display: flex;\n  gap: 4px;\n  flex: none;\n}\n\n.ext-btn-icon {\n  background: transparent;\n  border: none;\n  color: #94a3b8;\n  cursor: pointer;\n  padding: 4px;\n  border-radius: 6px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: all 0.15s;\n}\n\n.ext-btn-icon:hover {\n  background: rgba(255, 255, 255, 0.1);\n  color: #f1f5f9;\n}\n\n.ext-hud-body[hidden]{display:none!important}\n.ext-hud-body {\n  padding: 12px;\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  overflow: hidden;\n}\n#ext-global-jobs{display:flex;flex:1;min-height:0}\n#ext-global-jobs>.fm-global-hud{display:flex;flex-direction:column;flex:1;min-height:0}\n#ext-global-jobs>.fm-global-hud>:not(.fm-global-jobs){flex-shrink:0}\n#ext-global-jobs .fm-global-jobs{flex:1;min-height:0}\n\n.ext-hud-text-preview {\n  max-height: 80px;\n  overflow-y: auto;\n  font-size: 12px;\n  color: #cbd5e1;\n  background: rgba(0, 0, 0, 0.25);\n  border-radius: 6px;\n  padding: 8px;\n  margin-bottom: 10px;\n  border: 1px solid rgba(255, 255, 255, 0.05);\n  word-break: break-word;\n}\n\n.ext-hud-actions {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.ext-btn-primary {\n  background: #3b82f6;\n  color: white;\n  border: none;\n  border-radius: 6px;\n  padding: 6px 12px;\n  font-size: 12px;\n  font-weight: 500;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  transition: background 0.15s;\n}\n\n.ext-btn-primary:hover {\n  background: #2563eb;\n}\n\n.ext-btn-secondary {\n  background: rgba(255, 255, 255, 0.08);\n  color: #cbd5e1;\n  border: 1px solid rgba(255, 255, 255, 0.1);\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 12px;\n  cursor: pointer;\n  transition: background 0.15s;\n}\n\n.ext-btn-secondary:hover {\n  background: rgba(255, 255, 255, 0.15);\n}\n\n.ext-hud-sliders {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 10px;\n  font-size: 11px;\n  color: #94a3b8;\n}\n\n.ext-hud-sliders input[type=\"range\"] {\n  flex: 1;\n  accent-color: #3b82f6;\n  height: 4px;\n}\n\n@keyframes ext-pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.5; }\n}\n\n/* Overlay do Lens */\n.ext-lens-overlay {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.35);\n  z-index: 2147483646;\n  cursor: crosshair;\n}\n\n.ext-lens-box {\n  position: absolute;\n  border: 2px dashed #3b82f6;\n  background: rgba(59, 130, 246, 0.15);\n  pointer-events: none;\n}\n"; module.exports.default=module.exports;
},
};
const __cache={}; function __require(id){if(__cache[id])return __cache[id].exports;const fn=__modules[id];if(!fn)throw new Error("Module not found: "+id);const module={exports:{}};__cache[id]=module;fn(module,module.exports,__require);return module.exports;}
__require("extension/src/content/entrypoint.ts");
})();
