const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const contentPath = process.env.CONTENT_SCRIPT_PATH || path.join(__dirname, '..', 'content.js');
const source = fs.readFileSync(contentPath, 'utf8');
const entrypoint = '__require("extension/src/content/entrypoint.ts");';
assert.ok(source.includes(entrypoint), 'Entrypoint do pacote não encontrado');

class Element extends EventTarget {
    style = {};
    children = [];
    appendChild(child) {
        child.parent = this;
        this.children.push(child);
    }
    remove() {
        if (this.parent)
            this.parent.children = this.parent.children.filter(child => child !== this);
    }
}

function createLens() {
    const state = { invalid: false, sends: [], speeches: [], lastError: undefined };
    const root = new Element();
    const window = new EventTarget();
    window.devicePixelRatio = 2;
    const timers = new Map();
    let nextTimer = 0;
    const runtime = {
        id: 'test-extension',
        getManifest() {
            if (state.invalid)
                throw new Error('Extension context invalidated.');
            return { manifest_version: 3 };
        },
        get lastError() {
            if (state.throwOnLastError)
                throw new Error('Extension context invalidated.');
            return state.lastError;
        },
        sendMessage(message, callback) {
            state.sends.push(message);
            if (state.invalid || state.invalidateOnSend)
                throw new Error('Extension context invalidated.');
            state.reply = callback;
        },
    };
    const hud = {
        show() { state.shown = true; },
        setStatus(kind, label) { state.status = { kind, label }; },
        setTextPreview(text) { state.preview = text; },
    };
    const context = vm.createContext({
        chrome: { runtime }, window,
        document: { createElement: () => new Element() },
        console: { error() {} },
        setTimeout(callback, milliseconds) {
            timers.set(++nextTimer, { callback, milliseconds });
            return nextTimer;
        },
        clearTimeout(id) { timers.delete(id); },
    });
    // Carrega as funções reais do pacote sem inicializar o restante da extensão.
    vm.runInContext(source.replace(entrypoint, 'globalThis.bundledModules = __modules;'), context);
    const dependencies = {
        'extension/src/content/ui/hudController.ts': { hud },
        'extension/src/content/controllers/ttsController.ts': {
            tts: { speakText: (text, agentId) => state.speeches.push({ text, agentId }) },
        },
        'extension/src/content/ui/shadowDomWrapper.ts': { shadowDom: { getRoot: () => root } },
    };
    const module = { exports: {} };
    context.bundledModules['extension/src/content/controllers/lensController.ts'](
        module, module.exports, id => {
            assert.ok(dependencies[id], `Dependência não simulada: ${id}`);
            return dependencies[id];
        },
    );
    return { lens: module.exports.lens, state, runtime, root, window, timers };
}

const rect = { x: 10, y: 20, width: 100, height: 80, devicePixelRatio: 2 };
function assertRecovery({ state, timers, lens, root }) {
    assert.equal(state.status.kind, 'idle');
    assert.equal(state.status.label, 'Atualize a página');
    assert.match(state.preview, /Atualize a página \(F5\)/);
    assert.doesNotMatch(state.preview, /Extension context invalidated/);
    assert.equal(lens.isSelecting, false);
    assert.equal(root.children.length, 0);
    assert.equal(timers.size, 0);
    assert.equal(state.speeches.length, 0);
}

test('HUD/atalho não inicia seleção com contexto invalidado', () => {
    const env = createLens();
    env.state.invalid = true;
    env.lens.activateLensMode('custom-agent');
    assertRecovery(env);
    assert.equal(env.state.sends.length, 0);
});

test('Ctrl+Shift+arraste não inicia seleção com contexto invalidado', () => {
    const env = createLens();
    env.state.invalid = true;
    env.lens.startDragSelection(10, 20, 'custom-agent');
    assertRecovery(env);
    assert.equal(env.state.sends.length, 0);
});

test('runtime sem ID recebe orientação de recuperação', () => {
    const env = createLens();
    delete env.runtime.id;
    env.lens.activateLensMode();
    assertRecovery(env);
});

test('recarga entre seleção e envio remove overlay e evita envio inválido', () => {
    const env = createLens();
    env.lens.activateLensMode();
    assert.equal(env.root.children.length, 1);
    env.state.invalid = true;
    env.lens.submitSelection(rect);
    assertRecovery(env);
    assert.equal(env.state.sends.length, 0);
});

test('exceção do envio igual à da imagem recebe orientação e limpa timeout', () => {
    const env = createLens();
    env.state.invalidateOnSend = true;
    env.lens.submitSelection(rect, 'custom-agent');
    assertRecovery(env);
});

test('contexto invalidado durante resposta não inicia TTS', () => {
    const env = createLens();
    env.lens.submitSelection(rect);
    env.state.invalid = true;
    env.state.reply({ success: true, data: 'Texto detectado' });
    assertRecovery(env);
});

test('lastError de contexto invalidado recebe orientação', () => {
    const env = createLens();
    env.lens.submitSelection(rect);
    env.state.lastError = { message: 'Extension context invalidated.' };
    env.state.reply();
    assertRecovery(env);
});

test('leitura de lastError que lança exceção não escapa do callback', () => {
    const env = createLens();
    env.lens.submitSelection(rect);
    env.state.throwOnLastError = true;
    assert.doesNotThrow(() => env.state.reply());
    assertRecovery(env);
});

test('resposta saudável preserva retângulo, persona e narração automática', () => {
    const env = createLens();
    env.lens.submitSelection(rect, 'custom-agent');
    const request = env.state.sends[0];
    assert.equal(request.type, 'LENS_ANALYZE_REQUEST');
    assert.equal(request.payload.agentId, 'custom-agent');
    assert.deepEqual(request.payload.rect, rect);
    assert.equal(request.payload.instruction, undefined);
    env.state.reply({ success: true, data: '  Texto detectado  ' });
    assert.equal(env.state.preview, 'Texto detectado');
    assert.deepEqual(env.state.speeches, [{ text: 'Texto detectado', agentId: 'custom-agent' }]);
    assert.equal(env.timers.size, 0);
});

test('seleção por arraste saudável continua enviando coordenadas corretas', () => {
    const env = createLens();
    env.lens.startDragSelection(110, 100, 'custom-agent');
    const up = new Event('mouseup');
    Object.assign(up, { clientX: 10, clientY: 20 });
    env.window.dispatchEvent(up);
    assert.deepEqual(JSON.parse(JSON.stringify(env.state.sends[0].payload.rect)), rect);
    assert.equal(env.root.children.length, 0);
});

test('erros de conexão e API continuam mostrando o motivo original', () => {
    for (const runtimeFailure of [true, false]) {
        const env = createLens();
        env.lens.submitSelection(rect);
        if (runtimeFailure)
            env.state.lastError = { message: 'Could not establish connection.' };
        env.state.reply({ success: false, error: 'Chave de API ausente' });
        assert.equal(env.state.status.label, 'Erro Lens');
        assert.match(env.state.preview, runtimeFailure ? /Could not establish connection/ : /Chave de API ausente/);
        assert.equal(env.timers.size, 0);
    }
});

test('timeout saudável permanece em 30s e ignora resposta tardia', () => {
    const env = createLens();
    env.lens.submitSelection(rect);
    const [id, timer] = [...env.timers][0];
    assert.equal(timer.milliseconds, 30000);
    env.timers.delete(id);
    timer.callback();
    assert.equal(env.state.status.label, 'Timeout Lens');
    env.state.reply({ success: true, data: 'Resposta tardia' });
    assert.equal(env.state.status.label, 'Timeout Lens');
    assert.equal(env.state.speeches.length, 0);
});
test('autorização Lens e troca de aba dão orientação sem narrar nem erro interno', () => {
    for (const code of ['LENS_CAPTURE_PERMISSION_REQUIRED', 'LENS_TAB_CHANGED']) {
        const env = createLens();
        env.lens.submitSelection(rect);
        env.state.reply({ success: false, code, error: 'Volte à aba e tente novamente.' });
        assert.equal(env.state.status.label, code === 'LENS_CAPTURE_PERMISSION_REQUIRED' ? 'Autorizar Lens' : 'Tente novamente');
        assert.equal(env.state.preview, 'Volte à aba e tente novamente.');
        assert.equal(env.state.speeches.length, 0);
        assert.equal(env.timers.size, 0);
    }
});

test('contexto invalidado enquanto aguarda recebe recuperação ao vencer timeout', () => {
    const env = createLens();
    env.lens.submitSelection(rect);
    env.state.invalid = true;
    const [id, timer] = [...env.timers][0];
    env.timers.delete(id);
    timer.callback();
    assertRecovery(env);
});
