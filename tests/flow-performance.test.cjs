const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const bundleRoot = process.env.FLOW_SCRIPT_ROOT || path.join(__dirname, '..');

function createBundle(file = 'background.js', raw = {}, failures = 0) {
    const source = file === 'background.js' ? require('./load-background.cjs')(path.join(bundleRoot,file)) : fs.readFileSync(path.join(bundleRoot,file),'utf8');
    const entry = file === 'background.js' ? '__require("extension/src/background/index.ts");' : '__require("extension/src/content/entrypoint.ts");';
    const stored = structuredClone(raw);
    const trace = { reads: [], writes: [], requests: [], captures: 0, serializations: 0, failRead: false };
    const chrome = { runtime: {}, tabs: { async get(id) { return { id, active: true, windowId: 7 }; }, async captureVisibleTab(windowId) { assert.equal(windowId, 7); trace.captures++; return 'data:image/jpeg;base64,aW1hZ2Vt'; } }, storage: { local: {
        get(keys, callback) {
            trace.reads.push(keys === null ? null : Array.from(Array.isArray(keys) ? keys : [keys]));
            const selected = keys === null ? stored : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in stored).map(key => [key, stored[key]]));
            const snapshot = structuredClone(selected);
            const fail = trace.failRead;
            trace.failRead = false;
            queueMicrotask(() => {
                if (fail) chrome.runtime.lastError = { message: 'Falha simulada de storage' };
                callback(snapshot);
                delete chrome.runtime.lastError;
            });
        },
        set(value, callback) {
            trace.writes.push(structuredClone(value));
            queueMicrotask(() => { Object.assign(stored, structuredClone(value)); callback(); });
        },
    } } };
    const context = vm.createContext({
        Buffer, AbortController, structuredClone, setTimeout, clearTimeout, chrome,
        console: { log() {}, warn() {}, error() {} },
        JSON: { parse: JSON.parse, stringify(value) { if (value?.contents) trace.serializations++; return JSON.stringify(value); } },
        async fetch(url, options) {
            const status = trace.requests.length < failures ? 429 : 200;
            const modelId = url.match(/models\/([^:]+):/)[1];
            trace.requests.push({ modelId, key: options.headers['x-goog-api-key'] || new URL(url).searchParams.get('key'), body: JSON.parse(options.body), readsAtStart: trace.reads.length });
            return { ok: status === 200, status, headers: { get: () => 'application/json' }, async text() {
                return JSON.stringify(status === 200
                    ? { candidates: [{ content: { parts: modelId.endsWith('-tts') || modelId.endsWith('-tts-preview')
                        ? [{ inlineData: { data: Buffer.alloc(120).toString('base64') } }]
                        : [{ text: 'Resultado simulado.' }] } }] }
                    : { error: { message: 'Quota exceeded' } });
            } };
        },
    });
    vm.runInContext(source.replace(entry, 'globalThis.factories = __modules;'), context);
    const cache = {};
    function load(id) {
        if (cache[id]) return cache[id].exports;
        const module = cache[id] = { exports: {} };
        assert.ok(context.factories[id], `Módulo ausente: ${id}`);
        context.factories[id](module, module.exports, load);
        return module.exports;
    }
    return { load, stored, trace };
}

for (const file of ['background.js', 'content.js']) {
    test(`${file}: leitura seletiva preserva todos os aliases legados sem carregar logs/histórico`, async () => {
        const raw = {
            apiKey: 'fake-key', activeAgentId: 'translator', customAgents: [{ metadata: { id: 'custom-original' } }],
            audioSettings: { volume: .7, preferredVoice: 'Kore' }, modelSettings: { ttsModelId: 'gemini-3.8-flash-tts' },
            uiPreferences: { shortcuts: { readSelection: 'Alt+R' } },
            logs: { items: [{ message: 'x'.repeat(100000) }] }, history: { recentItems: [{ previewText: 'y'.repeat(100000) }] },
        };
        const env = createBundle(file, raw);
        const storage = env.load('extension/src/services/storage/chromeStorageAdapter.ts').chromeStorage;
        const settings = env.load('shared/constants/defaultSettings.ts');
        const expected = settings.migrateLegacyStorage(raw);
        const namespaces = ['api', 'agents', 'audio', 'models', 'ui'];
        const actual = await storage.getMany(namespaces);
        for (const namespace of namespaces)
            assert.equal(JSON.stringify(actual[namespace]), JSON.stringify(expected[namespace]));
        assert.equal(env.trace.reads.length, 1);
        assert.ok(!env.trace.reads[0].some(key => ['logs', 'history'].includes(key)));
        env.stored.api = { apiKey: 'new-fake-key' };
        assert.equal((await storage.get('api')).apiKey, 'new-fake-key');
    });

    test(`${file}: logs simultâneos preservam ordem, limite e todos os eventos recentes`, async () => {
        const env = createBundle(file, { logs: { maxEntries: 5, enabled: true, items: [] } });
        const logger = env.load('extension/src/services/diagnosticLogger.ts');
        await Promise.all(Array.from({ length: 10 }, (_, i) => logger.logDiagnostic({ level: 'info', source: 'TTS', operation: 'EVENT_' + i, message: 'Evento ' + i })));
        assert.deepEqual(Array.from(env.stored.logs.items, item => item.operation), ['EVENT_9', 'EVENT_8', 'EVENT_7', 'EVENT_6', 'EVENT_5']);
        assert.equal(env.stored.logs.maxEntries, 5);
        assert.equal(env.trace.reads.length, 10);
        assert.equal(env.trace.writes.length, 10);
        await Promise.all([
            logger.logDiagnostic({ level: 'info', source: 'TTS', operation: 'BEFORE_CLEAR', message: 'Antes' }),
            logger.clearDiagnosticLogs(),
            logger.logDiagnostic({ level: 'info', source: 'TTS', operation: 'AFTER_CLEAR', message: 'Depois' }),
        ]);
        assert.deepEqual(Array.from(env.stored.logs.items, item => item.operation), ['AFTER_CLEAR']);
        env.stored.logs.enabled = false;
        const writes = env.trace.writes.length;
        await logger.logDiagnostic({ level: 'info', source: 'TTS', operation: 'DISABLED', message: 'Desativado' });
        assert.equal(env.trace.writes.length, writes);
    });

    test(`${file}: falha de storage não prende atualizações seguintes nem perde a configuração`, async () => {
        const env = createBundle(file, { api: { apiKey: 'fake-key', apiKeys: ['fake-a', 'fake-b'], timeoutMs: 30000 } });
        const storage = env.load('extension/src/services/storage/chromeStorageAdapter.ts').chromeStorage;
        env.trace.failRead = true;
        const first = storage.setPartial('api', { timeoutMs: 40000 });
        const second = storage.setPartial('api', { timeoutMs: 45000 });
        await assert.rejects(first, error => /Falha simulada/.test(error.message));
        await second;
        assert.equal(env.stored.api.timeoutMs, 45000);
        assert.deepEqual(Array.from(env.stored.api.apiKeys), ['fake-a', 'fake-b']);
        assert.equal(env.stored.api.apiKey, 'fake-key');
    });
}

test('TTS Live encaminha uma vez texto e chaves, sem requisição unary', async () => {
    const keys = Array.from({ length: 9 }, (_, i) => 'fake-key-' + i);
    const env = createBundle('background.js', { api: { apiKeys: keys }, logs: { enabled: true, items: [] } });
    const calls = [];
    const playback = env.load('extension/src/services/backgroundPlayback.ts');
    playback.handlePlaybackCommand = async payload => { calls.push(payload); return { success: true, blocks: 3 }; };
    const text = 'Texto inteiro com ação 😀.\n'.repeat(500);
    const router = env.load('extension/src/background/messageRouter.ts');
    const result = await router.handleExtensionMessage({ type: 'TTS_REQUEST', payload: { text, agentId: 'narrator' } }, {});
    assert.equal(result.success, true);
    assert.equal(result.data.live, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'TTS_LIVE_START');
    assert.equal(calls[0].text, text);
    assert.deepEqual(Array.from(calls[0].apiKeys), keys);
    assert.equal(calls[0].modelId, 'gemini-3.8-live');
    assert.equal(env.trace.requests.length, 0);
    assert.equal(env.trace.reads.filter(keys=>keys.includes('api')).length, 1);
});

test('popup envia após injetar o script sem espera fixa e carrega somente configuração necessária', async () => {
    const elements = Object.fromEntries(['agent', 'notice', 'status', 'read', 'dictate', 'hud', 'settings'].map(id => [id, { value: 'narrator', append() {} }]));
    const trace = { waits: 0, sends: 0, reads: [] };
    const context = vm.createContext({
        document: { querySelector: selector => elements[selector.slice(1)], createElement: () => ({ append() {} }) },
        Option: function() {},
        setTimeout(callback) { trace.waits++; callback(); },
        chrome: {
            storage: { local: { async get(keys) { trace.reads.push(Array.from(keys)); return { api: { apiKey: 'fake-key' }, agents: { customAgents: [], activeAgentId: 'narrator' } }; } }, onChanged: { addListener() {} } },
            tabs: { async query() { return [{ id: 1, url: 'https://example.test' }]; }, async sendMessage() { if (++trace.sends === 1) throw new Error('Script ausente'); } },
            scripting: { async insertCSS() {}, async executeScript() {} }, runtime: { openOptionsPage() {} },
        },
    });
    vm.runInContext(fs.readFileSync(path.join(bundleRoot, 'popup.js'), 'utf8'), context);
    await elements.read.onclick();
    assert.equal(trace.sends, 2);
    assert.equal(trace.waits, 0);
    assert.equal(elements.status.textContent, 'Pronto');
    assert.deepEqual(trace.reads[0], ['api', 'agents']);
});

test('STT unary legado fica desativado por padrão', async () => {
    const env = createBundle('background.js', { api: { apiKey: 'fake-primary' } });
    const router = env.load('extension/src/background/messageRouter.ts');
    const response = await router.handleExtensionMessage({ type: 'STT_TRANSCRIBE_REQUEST', payload: { agentId: 'narrator', audioBase64: 'YXVkaW8=' } }, {});
    assert.equal(response.success, false);
    assert.equal(env.trace.requests.length, 0);
});
for (const type of ['LENS_ANALYZE_REQUEST']) {
    test(`${type}: configuração é lida uma vez e mantém instrução, modelo e chave da persona`, async () => {
        const env = createBundle('background.js', {
            api: { apiKey: 'fake-primary', apiKeys: ['fake-tts-only'] },
            agents: { customAgents: [{
                metadata: { id: 'custom-original' },
                instructions: { sttFormattingInstruction: 'Mantenha meus termos.', lensInspectionInstruction: 'Descreva as legendas.' },
                modelPreferences: { sttModelId: 'gemini-3.1-flash-lite', visionModelId: 'gemini-3.1-flash-lite' },
            }] },
        });
        const router = env.load('extension/src/background/messageRouter.ts');
        const response = await router.handleExtensionMessage({ type, payload: {
            agentId: 'custom-original', audioBase64: 'YXVkaW8=', mimeType: 'audio/webm;codecs=opus',
        } }, type === 'LENS_ANALYZE_REQUEST' ? { tab: { id: 1 } } : {});
        assert.equal(response.success, true);
        assert.equal(env.trace.requests.length, 1);
        const request = env.trace.requests[0];
        assert.equal(request.modelId, 'gemini-3.1-flash-lite');
        assert.equal(request.key, 'fake-primary');
        assert.equal(env.trace.reads.filter(keys => keys.includes('api')).length, 1);
        const parts = request.body.contents[0].parts;
        assert.ok(parts.some(part => part.text?.includes(type === 'STT_TRANSCRIBE_REQUEST' ? 'Mantenha meus termos.' : 'Descreva as legendas.')));
        assert.equal(env.trace.captures, type === 'LENS_ANALYZE_REQUEST' ? 1 : 0);
        assert.equal(env.stored.history.recentItems[0].agentId, 'custom-original');
    });
}
