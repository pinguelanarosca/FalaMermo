const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createBundle(file, raw = {}, overrides = {}) {
    const source = file==='background.js'?require('./load-background.cjs')(path.join(__dirname,'..',file)):fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    const entrypoint = file === 'background.js'
        ? '__require("extension/src/background/index.ts");'
        : '__require("extension/src/content/entrypoint.ts");';
    assert.ok(source.includes(entrypoint));
    const stored = structuredClone(raw);
    const context = vm.createContext({
        AbortController, structuredClone, console,
        chrome: { runtime: {}, storage: { local: {
            get(_keys, callback) { callback(structuredClone(stored)); },
            set(value, callback) { Object.assign(stored, structuredClone(value)); callback(); },
        } } },
    });
    vm.runInContext(source.replace(entrypoint, 'globalThis.modules = __modules;'), context);
    const cache = Object.fromEntries(Object.entries(overrides).map(([id, exports]) => [id, { exports }]));
    function load(id) {
        if (cache[id]) return cache[id].exports;
        const module = cache[id] = { exports: {} };
        assert.ok(context.modules[id], `Módulo ausente: ${id}`);
        context.modules[id](module, module.exports, load);
        return module.exports;
    }
    return { load, stored, context };
}

for (const file of ['background.js', 'content.js']) {
    test(`${file}: storage preserva nove chaves após leitura, atualização e migração`, async () => {
        const keys = Array.from({ length: 9 }, (_, i) => `fake-key-${i + 1}`);
        const raw = {
            api: { apiKey: 'old-key', apiKeys: keys, timeoutMs: 42000, customEndpoint: 'original' },
            history: { recentItems: [{ id: 'original-entry', previewText: 'Original', timestamp: 1 }] },
        };
        const env = createBundle(file, raw);
        const storage = env.load('extension/src/services/storage/chromeStorageAdapter.ts').chromeStorage;
        assert.deepEqual(Array.from((await storage.get('api')).apiKeys), keys);
        await storage.setPartial('api', { timeoutMs: 45000 });
        assert.deepEqual(Array.from(env.stored.api.apiKeys), keys);
        assert.equal(env.stored.api.apiKey, 'old-key');
        assert.equal(env.stored.api.customEndpoint, 'original');
        await storage.setMultiple(await storage.getAll());
        assert.deepEqual(Array.from(env.stored.api.apiKeys), keys);
        assert.equal(env.stored.api.timeoutMs, 45000);
        assert.equal(env.stored.history.recentItems[0].id, 'original-entry');
    });

    test(`${file}: migração aceita bloco separado por ; e mantém chave legada`, () => {
        const settings = createBundle(file).load('shared/constants/defaultSettings.ts');
        const migrated = settings.migrateLegacyStorage({ apiKey: 'old-key', api: { apiKeys: ' fake-key-a;\n fake-key-b; fake-key-a;; ' } });
        assert.equal(migrated.api.apiKey, 'old-key');
        assert.deepEqual(Array.from(migrated.api.apiKeys), ['fake-key-a', 'fake-key-b']);
        const legacy = settings.migrateLegacyStorage({ apiKey: 'old-key' });
        assert.deepEqual(Array.from(settings.getTtsApiKeys(legacy.api)), ['old-key']);
    });
}

test('TTS_REQUEST encaminha a lista salva completa, inclusive sem chave principal', async () => {
    const calls = [];
    const keys = Array.from({ length: 9 }, (_, i) => `fake-key-${i + 1}`);
    const env = createBundle('background.js', { api: { apiKeys: keys } }, {
        'extension/src/services/backgroundPlayback.ts': { async handlePlaybackCommand(payload) { calls.push(payload); return { success: true, blocks: 1 }; } },
        'extension/src/background/tabCaptureHandler.ts': {},
        'extension/src/services/diagnosticLogger.ts': { async logDiagnostic() {} },
    });
    const router = env.load('extension/src/background/messageRouter.ts');
    const text = 'Texto inteiro com ação 😀.\n'.repeat(500);
    const response = await router.handleExtensionMessage({ type: 'TTS_REQUEST', payload: { text, agentId: 'narrator' } }, {});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(response.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operation, 'TTS_LIVE_START');
    assert.equal(calls[0].text, text);
    assert.deepEqual(Array.from(calls[0].apiKeys), keys);
    assert.equal(calls[0].modelId, 'gemini-3.8-live');
    assert.equal(env.stored.history.recentItems[0].status, 'success');
});
test('falha REQUEST ou 1007 inconclusivo não altera ranking/chaves', async () => {
    const env=createBundle('background.js');
    env.context.chrome.runtime.getURL=file=>'chrome-extension://test/'+file;
    let accesses=0;env.context.TtsAdaptive.getStore=()=>{accesses++;throw new Error('Ranking não deve ser acessado.');};
    const router=env.load('extension/src/background/messageRouter.ts');
    for(const result of ['REQUEST','UNKNOWN','CANCELLED']){
        const response=await router.handleExtensionMessage({type:'LIVE_OFFSCREEN_EVENT',payload:{event:'ranking',result,modelId:'gemini-3.8-live',keyIndex:1}},{url:'chrome-extension://test/offscreen.html'});
        assert.equal(response.success,true);
    }
    assert.equal(accesses,0);assert.equal(env.stored.ttsAdaptiveData,undefined);
});
