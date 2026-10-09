const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const contentPath = process.env.CONTENT_SCRIPT_PATH || path.join(__dirname, '..', 'content.js');
const source = fs.readFileSync(contentPath, 'utf8');
const entrypoint = '__require("extension/src/content/entrypoint.ts");';
assert.ok(source.includes(entrypoint), 'Entrypoint do pacote não encontrado');
const audioBase64 = Buffer.alloc(44).toString('base64');

function createTts() {
    const state = { visible: false, hides: 0, requests: [], revoked: [], pendingReplies: [] };
    class Audio extends EventTarget {
        source = '';
        currentTime = 0;
        duration = 1;
        paused = true;
        ended = false;
        get src() { return this.source; }
        set src(value) {
            this.source = value;
            this.currentTime = 0;
            this.ended = false;
            this.paused = true;
            this.error = null;
        }
        play() {
            if (state.blockAutoplay)
                return Promise.reject(new Error('Autoplay bloqueado'));
            this.paused = false;
            this.ended = false;
            this.dispatchEvent(new Event('play'));
            return Promise.resolve();
        }
        pause() {
            this.paused = true;
            this.dispatchEvent(new Event('pause'));
        }
        finish() {
            this.currentTime = this.duration;
            this.paused = true;
            this.ended = true;
            this.dispatchEvent(new Event('ended'));
        }
    }
    const hud = {
        show() { state.visible = true; },
        hide() { state.visible = false; state.hides++; },
        setStatus(kind, label) { state.status = { kind, label }; },
        setTextPreview(text) { state.preview = text; },
        setPlayingState(playing) { this.setStatus(playing ? 'playing' : 'idle', playing ? 'Lendo' : 'Pausado'); },
    };
    let nextUrl = 0;
    const context = vm.createContext({
        Audio, Blob, Buffer,
        URL: { createObjectURL: () => `blob:test-${++nextUrl}`, revokeObjectURL(url) { state.revoked.push(url); } },
        console: { error() {}, warn() {} },
        chrome: { runtime: {
            sendMessage(request, callback) {
                state.requests.push(request);
                if (!callback)
                    return Promise.resolve();
                const reply = () => callback(state.synthesisError
                    ? { success: false, error: state.synthesisError }
                    : { success: true, data: { audioBase64: state.invalidAudio ? 'AA==' : audioBase64, mimeType: 'audio/wav' } });
                if (state.deferSynthesis)
                    state.pendingReplies.push(reply);
                else
                    reply();
            },
        } },
    });
    vm.runInContext(source.replace(entrypoint, 'globalThis.bundledModules = __modules;'), context);
    const cache = { 'extension/src/content/ui/hudController.ts': { exports: { hud } } };
    function load(id) {
        if (cache[id])
            return cache[id].exports;
        const factory = context.bundledModules[id];
        assert.ok(factory, `Módulo não encontrado: ${id}`);
        const module = cache[id] = { exports: {} };
        factory(module, module.exports, load);
        return module.exports;
    }
    const tts = load('extension/src/content/controllers/ttsController.ts').tts;
    return { tts, audio: tts.audio, hud, state };
}

async function finishAudio(env) {
    env.audio.finish();
    await Promise.resolve();
}

test('HUD fecha no fim da narração e preserva áudio para replay', async () => {
    const env = createTts();
    await env.tts.speakText('Texto curto.', 'custom-agent');
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
    const task = env.tts.activeTask;
    await finishAudio(env);
    assert.equal(env.state.visible, false);
    assert.equal(env.state.status.label, 'Concluído');
    assert.equal(env.tts.isProcessing, false);
    assert.equal(env.tts.activeTask, task);
    assert.equal(task.chunkBlobs.size, 1);
    assert.equal(env.state.requests[0].payload.agentId, 'custom-agent');
});

test('texto longo é enviado inteiro em uma única requisição e fecha ao terminar', async () => {
    const env = createTts();
    const text = 'Uma sentença de narração. '.repeat(550).trim();
    await env.tts.speakText(text, 'narrator');
    assert.equal(env.state.requests.length, 1);
    assert.equal(env.state.requests[0].payload.text, text);
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
    await finishAudio(env);
    assert.equal(env.state.visible, false);
    assert.equal(env.state.hides, 1);
    assert.equal(env.state.requests.length, 1);
});

test('HUD permanece aberto enquanto há outra narração na fila', async () => {
    const env = createTts();
    await env.tts.speakText('Primeira narração.', 'narrator');
    await env.tts.speakText('Segunda narração.', 'translator');
    await finishAudio(env);
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
    assert.equal(env.tts.activeTask.agentId, 'translator');
    await finishAudio(env);
    assert.equal(env.state.visible, false);
    assert.equal(env.state.hides, 1);
});

test('pausar e parar manualmente não acionam fechamento por conclusão', async () => {
    const env = createTts();
    await env.tts.speakText('Texto curto.', 'narrator');
    env.tts.togglePlayPause();
    assert.equal(env.audio.paused, true);
    assert.equal(env.state.visible, true);
    env.tts.stop();
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
});

test('falha de síntese mantém a mensagem de erro visível', async () => {
    const env = createTts();
    env.state.synthesisError = 'Chave de API ausente';
    await env.tts.speakText('Texto curto.', 'narrator');
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
    assert.match(env.state.preview, /Chave de API Gemini não configurada/);
});

test('erro no áudio mantém o HUD aberto', async () => {
    const env = createTts();
    await env.tts.speakText('Texto curto.', 'narrator');
    env.audio.dispatchEvent(new Event('error'));
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
});

test('autoplay bloqueado mantém o botão Ouvir disponível', async () => {
    const env = createTts();
    env.state.blockAutoplay = true;
    await env.tts.speakText('Texto curto.', 'narrator');
    await Promise.resolve();
    assert.equal(env.state.visible, true);
    assert.equal(env.state.hides, 0);
    assert.equal(env.state.status.label, 'Clique em Ouvir');
});

test('replay após reabrir HUD fecha ao terminar sem pedir áudio novamente', async () => {
    const env = createTts();
    await env.tts.speakText('Texto curto.', 'narrator');
    await finishAudio(env);
    env.hud.show();
    env.tts.togglePlayPause();
    await Promise.resolve();
    assert.equal(env.state.visible, true);
    assert.equal(env.audio.paused, false);
    await finishAudio(env);
    assert.equal(env.state.visible, false);
    assert.equal(env.state.requests.length, 1);
});

test('narração recebida diretamente também fecha o HUD ao terminar', async () => {
    const env = createTts();
    env.hud.show();
    env.tts.playBase64Audio(audioBase64);
    await Promise.resolve();
    assert.equal(env.state.visible, true);
    assert.equal(env.tts.activeTask, null);
    await finishAudio(env);
    assert.equal(env.state.visible, false);
    assert.equal(env.state.status.label, 'Concluído');
});

test('nova narração após fechar o HUD não repete a anterior', async () => {
    const env = createTts();
    await env.tts.speakText('Texto anterior.', 'narrator');
    const previousUrl = env.audio.src;
    await finishAudio(env);
    assert.equal(env.state.visible, false);
    await env.tts.speakText('Próximo texto.', 'translator');
    assert.equal(env.tts.activeTask.rawText, 'Próximo texto.');
    assert.deepEqual(env.state.requests.map(request => request.payload.text), ['Texto anterior.', 'Próximo texto.']);
    assert.ok(env.state.revoked.includes(previousUrl));
});

test('um texto novo aguarda o replay manual terminar', async () => {
    const env = createTts();
    await env.tts.speakText('Texto anterior.', 'narrator');
    await finishAudio(env);
    env.hud.show();
    env.tts.togglePlayPause();
    await Promise.resolve();
    await env.tts.speakText('Próximo texto.', 'translator');
    assert.equal(env.tts.activeTask.rawText, 'Texto anterior.');
    await finishAudio(env);
    assert.equal(env.tts.activeTask.rawText, 'Próximo texto.');
    await finishAudio(env);
    assert.equal(env.state.visible, false);
});

test('parar depois de concluir libera também o áudio guardado para replay', async () => {
    const env = createTts();
    await env.tts.speakText('Texto anterior.', 'narrator');
    const previousUrl = env.audio.src;
    await finishAudio(env);
    env.tts.stop();
    assert.ok(env.state.revoked.includes(previousUrl));
    assert.equal(env.tts.activeTask, null);
});

test('texto longo sem espaços também usa uma única requisição sem perder caracteres', async () => {
    const env = createTts();
    const text = 'A'.repeat(2400);
    await env.tts.speakText(text, 'narrator');
    assert.equal(env.state.requests.length, 1);
    assert.equal(env.state.requests[0].payload.text, text);
    await finishAudio(env);
    assert.equal(env.state.requests.length, 1);
    assert.equal(env.state.visible, false);
});

test('falha no áudio não prende a fila da próxima narração', async () => {
    const env = createTts();
    await env.tts.speakText('Uma sentença longa. '.repeat(100), 'narrator');
    env.audio.error = { code: 3, message: 'Falha ao decodificar áudio' };
    env.audio.dispatchEvent(new Event('error'));
    assert.equal(env.tts.isProcessing, false);
    assert.equal(env.tts.activeTask, null);
    assert.match(env.state.preview, /Falha ao decodificar áudio/);
    await env.tts.speakText('Próximo texto.', 'translator');
    assert.equal(env.tts.activeTask.rawText, 'Próximo texto.');
});

test('resposta com áudio inválido mostra erro em vez de interromper silenciosamente', async () => {
    const env = createTts();
    env.state.invalidAudio = true;
    await env.tts.speakText('Texto longo. '.repeat(100), 'narrator');
    assert.equal(env.state.status.label, 'Erro no áudio');
    assert.match(env.state.preview, /áudio inválido/i);
    assert.equal(env.state.visible, true);
    assert.equal(env.tts.activeTask, null);
});

test('Ouvir durante a síntese não dispara outra requisição', async () => {
    const env = createTts();
    env.state.deferSynthesis = true;
    await env.tts.speakText('Uma sentença longa. '.repeat(100), 'narrator');
    assert.equal(env.state.requests.length, 1);
    env.tts.togglePlayPause();
    await Promise.resolve();
    assert.equal(env.state.requests.length, 1);
    assert.equal(env.audio.src, '');
    env.state.pendingReplies.shift()();
    await Promise.resolve();
    assert.equal(env.audio.paused, false);
    await finishAudio(env);
    assert.equal(env.state.requests.length, 1);
});

test('narração inteira preserva Unicode, espaços e quebras de linha', async () => {
    const env = createTts();
    const text = 'a😀\n  Texto com espaços e acentos: ação.\n'.repeat(500).trim();
    await env.tts.speakText(text, 'narrator');
    assert.equal(env.state.requests.length, 1);
    assert.equal(env.state.requests[0].payload.text, text);
});

test('replay de texto longo usa o áudio inteiro em cache sem nova síntese', async () => {
    const env = createTts();
    await env.tts.speakText('Uma sentença longa. '.repeat(100), 'narrator');
    await finishAudio(env);
    const requests = env.state.requests.length;
    assert.equal(requests, 1);
    env.hud.show();
    env.tts.togglePlayPause();
    await Promise.resolve();
    await finishAudio(env);
    assert.equal(env.state.requests.length, requests);
    assert.equal(env.state.visible, false);
    assert.equal(env.tts.queue.length, 0);
});

test('resolução tardia de play não sobrescreve o estado Parado', async () => {
    const env = createTts();
    const starting = env.tts.speakText('Texto anterior.', 'narrator');
    env.tts.stop();
    await starting;
    assert.equal(env.state.status.label, 'Parado');
    assert.equal(env.tts.activeTask, null);
});
