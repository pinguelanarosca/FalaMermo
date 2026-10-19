const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const base64 = Buffer.alloc(44).toString('base64');
const root = path.join(__dirname, '..');
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function createController() {
    const events = [], requests = [], commands = [];
    const state = { visible: false, hides: 0, engine: null };
    const hud = { show() { state.visible = true; }, hide() { state.visible = false; state.hides++; },
        setTextPreview(text) { state.preview = text; }, setStatus(_type, label) { state.label = label; },
        setPlayingState(playing) { state.playing = playing; } };
    let pending;const pendingCallbacks=[];
    function event(eventName) {
        const packet = { type: 'TTS_PLAYBACK_EVENT', payload: { playerId: state.engine.playerId, event: eventName, status: { ...state.engine, seq: ++state.engine.seq } } };
        for (const handler of events) handler(packet, {}, () => {});
    }
    const context = vm.createContext({ EventTarget, Event, Buffer, Blob, Date, Math,
        URL: { revokeObjectURL() {} }, console: { error() {}, warn() {} },
        chrome: { runtime: { getURL: file => 'chrome-extension://test/' + file, onMessage: { addListener(handler) { events.push(handler); } },
            sendMessage(message, callback) {
                if (message.type === 'TTS_REQUEST') { requests.push(message); pending = { message, callback }; pendingCallbacks.push(callback);return; }
                commands.push(message);
                if (message.type === 'TTS_STOP') return Promise.resolve({ success: true });
                const payload = message.payload;
                if (payload.operation === 'PLAY') {
                    if (!state.engine || state.engine.requestId !== payload.requestId)
                        state.engine = { ...payload, duration: 1, paused: false, ended: false, seq: 0 };
                    state.engine.paused = false;
                    event('play');
                }
                if (payload.operation === 'PAUSE' && state.engine) state.engine.paused = true;
                if (payload.operation === 'SEEK' && state.engine) state.engine.currentTime = payload.currentTime;
                return Promise.resolve({ success: true, status: state.engine && { ...state.engine, seq: ++state.engine.seq } });
            },
        } },
    });
    const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
    vm.runInContext(source.replace('__require("extension/src/content/entrypoint.ts");', 'globalThis.modules=__modules;'), context);
    const cache = { 'extension/src/content/ui/hudController.ts': { exports: { hud } } };
    function load(id) { if (cache[id]) return cache[id].exports; const module = cache[id] = { exports: {} }; context.modules[id](module, module.exports, load); return module.exports; }
    const tts = load('extension/src/content/controllers/ttsController.ts').tts;
    return { tts, requests, commands, state,context,replyAll(){for(const callback of pendingCallbacks)callback({success:true,data:{live:true}});},
        ready() { state.engine = { ...pending.message.payload.playback, duration: 1, currentTime: 0, paused: false, ended: false, seq: 0 }; event('play'); },
        reply() { pending.callback({ success: true, data: { audioBase64: base64, mimeType: 'audio/wav', playback: { ...state.engine, seq: ++state.engine.seq, started: true } } }); },
        end() { state.engine.ended = true; state.engine.paused = true; state.engine.currentTime = 1; event('ended'); },
    };
}
test('HUD global inicia duas narrações independentes na mesma página e controla somente a escolhida',async()=>{
 const env=createController();env.context.GlobalHud={};env.context.crypto=require('node:crypto').webcrypto;
 const first=env.tts.speakText('Primeira narração.','narrator'),second=env.tts.speakText('Segunda narração.','translator');assert.equal(env.requests.length,2);
 const a=env.requests[0].payload.playback,b=env.requests[1].payload.playback;assert.notEqual(a.playerId,b.playerId);assert.notEqual(a.requestId,b.requestId);assert.equal(env.commands.length,0);env.replyAll();await Promise.all([first,second]);env.tts.togglePlayPause();env.tts.stop();await flush();assert.equal(env.commands.filter(message=>message.type==='HUD_GLOBAL_TOGGLE').length,1);assert.ok(env.commands.filter(message=>message.type!=='HUD_GLOBAL_TOGGLE').every(message=>message.payload.playerId===b.playerId&&message.payload.requestId===b.requestId));assert.ok(env.commands.some(message=>message.payload.operation==='STOP'));assert.ok(!env.commands.some(message=>message.type==='TTS_STOP'));
});
test('áudio pronto inicia antes da resposta à página e não toca duas vezes ao receber o callback', async () => {
    const env = createController();
    await env.tts.speakText('Texto completo.', 'narrator');
    assert.equal(env.requests.length, 1);
    assert.equal(env.requests[0].payload.text, 'Texto completo.');
    env.ready();
    assert.equal(env.state.playing, true);
    env.reply(); await flush();
    assert.equal(env.commands.filter(item => item.payload.operation === 'PLAY').length, 0);
    assert.equal(env.tts.audio.paused, false);
});
test('narração terminada antes do callback fecha o HUD e não reinicia quando a aba recebe a resposta', async () => {
    const env = createController();
    await env.tts.speakText('Texto.', 'narrator');
    env.ready(); env.end();
    assert.equal(env.state.visible, false);
    env.reply(); await flush();
    assert.equal(env.tts.audio.ended, true);
    assert.equal(env.state.visible, false);
    assert.equal(env.commands.filter(item => item.payload.operation === 'PLAY').length, 0);
    assert.equal(env.tts.activeTask.chunkBlobs.size, 1);
});
test('replay do player de fundo usa o áudio em cache sem nova síntese', async () => {
    const env = createController();
    await env.tts.speakText('Texto.', 'narrator');
    env.ready(); env.reply(); await flush(); env.end();
    env.tts.togglePlayPause(); await flush();
    assert.equal(env.requests.length, 1);
    const plays = env.commands.filter(item => item.payload.operation === 'PLAY');
    assert.equal(plays.length, 1);
    assert.ok(plays[0].payload.src.startsWith('data:audio/wav;base64,'));
    assert.equal(env.state.playing, true);
});
test('pausa, retomada, volume e velocidade controlam o mesmo player', async () => {
    const env = createController();
    await env.tts.speakText('Texto.', 'narrator');
    env.ready(); env.reply(); await flush();
    env.tts.togglePlayPause(); await flush();
    assert.equal(env.tts.audio.paused, true);
    env.tts.setVolume(.4); env.tts.setSpeed(1.5);
    env.tts.togglePlayPause(); await flush();
    assert.equal(env.tts.audio.paused, false);
    const play = env.commands.find(item => item.payload.operation === 'PLAY');
    assert.equal(play.payload.volume, .4);
    assert.equal(play.payload.playbackRate, 1.5);
    assert.equal(env.requests.length, 1);
});
test('parar descarta eventos e áudio que chegam depois do cancelamento', async () => {
    const env = createController();
    await env.tts.speakText('Texto.', 'narrator');
    env.tts.stop();
    env.ready(); env.reply(); await flush();
    assert.equal(env.state.label, 'Parado');
    assert.equal(env.tts.activeTask, null);
    assert.equal(env.state.playing, false);
    assert.equal(env.commands.filter(item => item.type === 'TTS_STOP').length, 1);
});
function createOffscreen() {
    const messages = [], audios = [];
    let handler;
    class Audio extends EventTarget {
        currentTime = 0; duration = 2; paused = true; ended = false;
        constructor() { super(); audios.push(this); }
        async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
        pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
        removeAttribute() { this.src = ''; }
        load() {}
    }
    const context = vm.createContext({ Audio, structuredClone, setInterval() { return 1; }, clearInterval() {}, chrome: { runtime: {
        onMessage: { addListener(fn) { handler = fn; } }, sendMessage(message) { messages.push(message); return Promise.resolve(); },
    } } });
    vm.runInContext(fs.readFileSync(path.join(root, 'live-config.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'live-session-manager.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8'), context);
    const command = payload => new Promise(resolve => handler({ type: 'TTS_OFFSCREEN_COMMAND', target: 'offscreen', payload }, {}, resolve));
    return { command, messages, audios };
}
test('offscreen separa abas e conserva volume/velocidade e eventos nativos', async () => {
    const env = createOffscreen();
    const request = { tabId: 1, playerId: 'one', requestId: 'r1', operation: 'PLAY', src: 'data:audio/wav;base64,' + base64, volume: .4, playbackRate: 1.5 };
    assert.equal((await env.command(request)).success, true);
    assert.equal((await env.command({ ...request, tabId: 2, playerId: 'two', requestId: 'r2' })).success, true);
    assert.equal(env.audios.length, 2);
    assert.equal(env.audios[0].volume, .4);
    assert.equal(env.audios[0].playbackRate, 1.5);
    await env.command({ ...request, operation: 'PAUSE' });
    assert.equal(env.audios[0].paused, true);
    assert.equal(env.audios[1].paused, false);
    await env.command({ ...request, operation: 'STOP' });
    assert.equal(env.audios[0].src, '');
    assert.equal(env.audios[1].paused, false);
});
test('offscreen ignora comandos atrasados da narração anterior', async () => {
    const env = createOffscreen();
    const request = { tabId: 1, playerId: 'one', requestId: 'r1', operation: 'PLAY', src: 'data:audio/wav;base64,' + base64 };
    await env.command(request); await env.command({ ...request, requestId: 'r2' });
    await env.command({ ...request, operation: 'PAUSE' });
    assert.equal(env.audios[1].paused, false);
});
test('fechar uma aba remove seus players e mantém a outra aba', async () => {
    const env = createOffscreen();
    const request = { tabId: 1, playerId: 'one', requestId: 'r1', operation: 'PLAY', src: 'data:audio/wav;base64,' + base64 };
    await env.command(request); await env.command({ ...request, tabId: 2, playerId: 'two' });
    await env.command({ operation: 'STOP_TAB', tabId: 1 });
    assert.equal(env.audios[0].src, '');
    assert.equal(env.audios[1].paused, false);
});
function createManager() {
    const calls = [], events = [];
    let document = false, creations = 0;
    const context = vm.createContext({ chrome: {
        offscreen: { async hasDocument() { return document; }, async createDocument() { creations++; await flush(); document = true; } },
        runtime: { getURL: file => 'chrome-extension://test/' + file, async sendMessage(message) { calls.push(message.payload); return { success: true, status: { requestId: message.payload.requestId } }; } },
        tabs: { async sendMessage(tabId, message, options) { events.push({ tabId, message, options }); } },
    } });
    vm.runInContext(require('./load-background.cjs')(path.join(root, 'background.js')).replace('__require("extension/src/background/index.ts");', 'globalThis.modules=__modules;'), context);
    const module = { exports: {} };
    context.modules['extension/src/services/backgroundPlayback.ts'](module, module.exports, () => {});
    return { manager: module.exports, calls, events, get creations() { return creations; } };
}
test('pedidos concorrentes compartilham um único documento offscreen e usam suas abas de origem', async () => {
    const env = createManager(), signal = new AbortController().signal;
    await Promise.all([1, 2].map(tabId => env.manager.playGeneratedAudio({ audioBase64: base64 }, { playerId: 'p' + tabId, requestId: 'r', tabId: 999 }, { tab: { id: tabId }, frameId: 2 }, signal)));
    assert.equal(env.creations, 1);
    assert.deepEqual(env.calls.map(c => c.tabId), [1,2]);
    assert.ok(env.calls.every(c => c.frameId === 2));
});
test('cancelamento durante criação do offscreen não inicia áudio', async () => {
    const env = createManager(), controller = new AbortController();
    const pending = env.manager.playGeneratedAudio({ audioBase64: base64 }, { playerId: 'p', requestId: 'r' }, { tab: { id: 1 } }, controller.signal);
    controller.abort();
    await assert.rejects(pending, /cancelada/);
    assert.equal(env.calls.length, 0);
});
test('volume e velocidade escolhidos durante a síntese chegam ao início do áudio', async () => {
    const env = createManager(), sender = { tab: { id: 1 } };
    await env.manager.handlePlaybackCommand({ operation: 'SET', playerId: 'p', volume: .3, playbackRate: 1.4 }, sender);
    await env.manager.playGeneratedAudio({ audioBase64: base64 }, { playerId: 'p', requestId: 'r', volume: 1, playbackRate: 1 }, sender, new AbortController().signal);
    assert.equal(env.calls[0].volume, .3);
    assert.equal(env.calls[0].playbackRate, 1.4);
});
test('eventos só são encaminhados quando enviados pelo player da extensão', async () => {
    const env = createManager(), event = { tabId: 1, frameId: 2, playerId: 'p' };
    await env.manager.forwardPlaybackEvent(event, { url: 'https://example.com' });
    assert.equal(env.events.length, 0);
    await env.manager.forwardPlaybackEvent(event, { url: 'chrome-extension://test/offscreen.html' });
    assert.equal(env.events[0].tabId, 1);
    assert.equal(env.events[0].options.frameId, 2);
});
