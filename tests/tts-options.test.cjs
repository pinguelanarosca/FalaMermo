const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const optionsPath = process.env.OPTIONS_SCRIPT_PATH || path.join(__dirname, '..', 'options.js');
const source = fs.readFileSync(optionsPath, 'utf8');
const entrypoint = source.lastIndexOf('main().catch(');
assert.ok(entrypoint >= 0, 'Entrypoint de opções não encontrado');

function createOptions({ text = 'Texto para narração.', status = 200, emptyAudio = false, replies = [] } = {}) {
    const calls = [];
    const writes = [], messages = [], timers = new Map();
    let nextTimer = 0;
    const html = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
    const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
        value: '', textContent: '', style: {}, classList: { add() {}, remove() {} },
    }]));
    elements.ttsTestText.value = text;
    const adaptive=require('../tts-adaptive.js'),adaptiveStore=adaptive.createStore();
    const context = vm.createContext({
        atob, structuredClone, AbortController, LiveConfig:require('../live-config.js'), TtsConfig: require("../tts-config.js"), TtsAdaptive:adaptive,
        setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
        chrome: {
            storage: { local: { async set(value) { writes.push(structuredClone(value)); } } },
            runtime: { async sendMessage(message) { messages.push(message);const keys=vm.runInContext('getTtsApiKeys(state.api)',context),pairs=adaptive.catalog(Object.keys(require('../tts-config.js').TTS_MODEL_CAPABILITIES),Array.from(keys));if(message.type==='TTS_RANKING_GET')return {success:true,data:await adaptiveStore.snapshot(pairs)};if(message.type==='TTS_RANKING_RECORD'){const pair=pairs.find(p=>adaptive.id(p)===message.payload.pairId);return {success:true,...await adaptiveStore.record(pairs,pair,message.payload.event,message.payload.epoch)};}return { success: true }; } },
        },
        window: { addEventListener() {} },
        document: { querySelector(selector) {
            assert.ok(elements[selector.slice(1)], `Controle ausente no HTML: ${selector}`);
            return elements[selector.slice(1)];
        } },
        async fetch(url, options) {
            const reply = replies[calls.length] || {};
            const httpStatus = reply.status ?? status;
            const missingAudio = reply.emptyAudio ?? emptyAudio;
            calls.push({ modelId: url.match(/\/models\/([^:]+):/)[1], key: options.headers['x-goog-api-key'] || new URL(url).searchParams.get('key'), body: JSON.parse(options.body) });
            if (reply.never)
                return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
            if (reply.networkError)
                throw new Error(reply.networkError);
            return {
                ok: httpStatus === 200, status: httpStatus, statusText: '',
                headers: { get: name => name==='content-type' ? 'application/json' : name==='retry-after' ? reply.retryAfter || null : null },
                async text() {
                    if(reply.bodyNever)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
                    return JSON.stringify(httpStatus === 200
                        ? { candidates: [{ content: { parts: missingAudio ? [] : [{ inlineData: { data: Buffer.alloc(120).toString('base64') } }] } }] }
                        : { error: { message: reply.message || 'Falha simulada da API' } });
                },
            };
        },
    });
    // Executa o teste de voz real com agente configurado, sem inicializar a página.
    vm.runInContext(source.slice(0, entrypoint) + `
        globalThis.runSynthesis = (modelId, apiKey = 'test-key', apiKeys = [], ttsConfig, live) => {
            state = { api: { apiKey, apiKeys }, models: { ttsModelId: 'gemini-3.8-flash-lite-tts' } };
            currentAgent = {
                metadata:{id:'narrator'},live,
                modelPreferences: { ttsModelId: modelId },
                instructions: { ttsSystemInstruction: 'Leia com calma.' },
                voice: { preferredVoice: 'Kore', rateMultiplier: 1, pitchMultiplier: 1 }, ttsConfig,
            };
            pullAgentFromFields = () => {};
            return synthesizeCurrent();
        };
        globalThis.initSettings = raw => { state = normalizeState(raw); setupApi(); };
        globalThis.getSettings = () => structuredClone(state);
    `, context);
    return { calls, writes, messages, elements, timers, synthesize: context.runSynthesis,
        initSettings: context.initSettings, getSettings: context.getSettings,
        expireTtsTimers() {
            for (const [id, timer] of [...timers]) {
                if (timer.delay < 8000) continue;
                timers.delete(id);
                timer.callback();
            }
        },
    };
}

test('prévia TTS encaminha texto completo ao background Live sem fetch unary',async()=>{
 const text='Texto inteiro com ação 😀.\n'.repeat(500).trim(),env=createOptions({text});await env.synthesize('gemini-3.1-flash-live-preview');
 const message=env.messages.find(m=>m.type==='TTS_REQUEST');assert.equal(env.calls.length,0);assert.equal(message.payload.text,text);assert.equal(message.payload.previewAgent.modelPreferences.ttsModelId,'gemini-3.1-flash-live-preview');
 const preview=JSON.parse(env.elements.ttsPayload.textContent);assert.equal(preview.setup.setup.model,'models/gemini-3.1-flash-live-preview');assert.equal(preview.turn.clientContent.turns[0].parts[0].text,text);assert.equal(preview.setup.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');assert.ok(!JSON.stringify(message).includes('test-key'));
});
test('configuração convencional antiga é preservada mas execução efetiva usa Live',async()=>{
 const env=createOptions();await env.synthesize('gemini-3.8-flash-tts');const agent=env.messages.find(m=>m.type==='TTS_REQUEST').payload.previewAgent;
 assert.equal(agent.modelPreferences.ttsModelId,'gemini-3.8-flash-tts');assert.equal(env.calls.length,0);assert.equal(JSON.parse(env.elements.ttsPayload.textContent).setup.setup.model,'models/gemini-3.8-live');
});
test('preview Live nos três modos usa builder sem permitir JSON convencional',async()=>{
 const config=require('../live-config.js');for(const jsonMode of ['panel','override','complete']){
  const modelId='gemini-3.8-live',setup=config.buildLiveSessionConfig({modelId,voiceName:'Kore',systemInstruction:'Leia com calma.'});
  const live={preferredModel:modelId,jsonMode,advancedJson:jsonMode==='complete'?setup:jsonMode==='override'?{setup:{outputAudioTranscription:{}}}:null},env=createOptions();
  await env.synthesize(modelId,'test-key',[],{},live);const shown=JSON.parse(env.elements.ttsPayload.textContent);assert.deepEqual(shown.setup,config.buildLiveSessionConfig(config.buildAgentLiveOptions(env.messages.find(m=>m.type==='TTS_REQUEST').payload.previewAgent)));assert.equal(env.calls.length,0);
 }
 for(const advancedJson of ['{',{setup:{model:'models/gemini-3.8-flash-tts'}}]){
  const env=createOptions();await assert.rejects(env.synthesize('gemini-3.8-live','test-key',[],{},{preferredModel:'gemini-3.8-live',jsonMode:'complete',advancedJson}));assert.equal(env.messages.length,0);assert.equal(env.calls.length,0);
 }
});
test('texto vazio, chave ausente ou pool excessivo não iniciam prévia nem HTTP',async()=>{
 const empty=createOptions({text:'   '});await assert.rejects(empty.synthesize('gemini-3.8-live'),/Digite um texto/);
 const noKey=createOptions();await assert.rejects(noKey.synthesize('gemini-3.8-live',''),/Configure sua chave/);
 const tooMany=createOptions();await assert.rejects(tooMany.synthesize('gemini-3.8-live','',Array.from({length:10},(_,i)=>'fake-'+i)),/no máximo 9/);
 for(const env of [empty,noKey,tooMany]){assert.equal(env.calls.length,0);assert.equal(env.messages.length,0);assert.equal(env.timers.size,0);}
});

test('salvar bloco com nove chaves preserva chave principal e outras configurações', async () => {
    const env = createOptions();
    env.initSettings({ api: { apiKey: 'old-key', timeoutMs: 42000, customEndpoint: 'endpoint-original' } });
    const keys = Array.from({ length: 9 }, (_, i) => `fake-key-${i + 1}`);
    env.elements.apiKeys.value = keys.join(';\n') + '; ; fake-key-1;';
    await env.elements.saveApi.onclick();
    const saved = env.writes[0].api;
    assert.deepEqual(Array.from(saved.apiKeys), keys);
    assert.equal(saved.apiKey, 'old-key');
    assert.equal(saved.timeoutMs, 42000);
    assert.equal(saved.customEndpoint, 'endpoint-original');
    assert.equal(env.calls.length, 0);
    assert.equal(env.messages.length, 0);
    env.initSettings({ api: saved });
    assert.equal(env.elements.apiKeys.value, keys.join(';') + ';');
});

test('lista sem chave principal usa a primeira para compatibilidade e permite limpar o pool', async () => {
    const env = createOptions();
    env.initSettings({});
    env.elements.apiKeys.value = ' fake-key-a;\n fake-key-b;';
    await env.elements.saveApi.onclick();
    assert.equal(env.writes[0].api.apiKey, 'fake-key-a');
    env.elements.apiKeys.value = '';
    await env.elements.saveApi.onclick();
    assert.deepEqual(Array.from(env.writes[1].api.apiKeys), []);
    assert.equal(env.writes[1].api.apiKey, 'fake-key-a');
});

test('mais de nove chaves não sobrescrevem a configuração nem fazem chamada', async () => {
    const env = createOptions();
    env.initSettings({ api: { apiKey: 'old-key', apiKeys: ['saved-key'] } });
    env.elements.apiKeys.value = Array.from({ length: 10 }, (_, i) => `fake-key-${i}`).join(';');
    await env.elements.saveApi.onclick();
    await env.elements.testApi.onclick();
    assert.equal(env.writes.length, 0);
    assert.equal(env.calls.length, 0);
    assert.equal(env.messages.length, 0);
    assert.deepEqual(Array.from(env.getSettings().api.apiKeys), ['saved-key']);
    assert.match(env.elements.apiStatus.textContent, /no máximo 9/);
});

test('botão de conexão salva a lista e testa somente a chave principal', async () => {
    const env = createOptions();
    env.initSettings({ api: { apiKey: 'old-key' } });
    env.elements.apiKeys.value = 'fake-key-a;fake-key-b;';
    await env.elements.testApi.onclick();
    assert.deepEqual(Array.from(env.writes[0].api.apiKeys), ['fake-key-a', 'fake-key-b']);
    assert.equal(env.messages.length, 1);
    assert.equal(env.messages[0].payload.apiKey, 'old-key');
});

test('importar bloco de notas carrega nove chaves e só salva ao clicar no botão', async () => {
    const env = createOptions();
    env.initSettings({ api: { apiKey: 'old-key' } });
    const keys = Array.from({ length: 9 }, (_, i) => `fake-key-${i + 1}`);
    env.elements.apiKeysFile.files = [{ async text() { return '\uFEFF' + keys.join(';\r\n') + ';'; } }];
    await env.elements.apiKeysFile.onchange();
    assert.equal(env.elements.apiKeys.value, keys.join(';') + ';');
    assert.equal(env.writes.length, 0);
    assert.equal(env.calls.length, 0);
    await env.elements.saveApi.onclick();
    assert.deepEqual(Array.from(env.writes[0].api.apiKeys), keys);
});

test('arquivo com mais de nove chaves não apaga a lista atual', async () => {
    const env = createOptions();
    env.initSettings({ api: { apiKey: 'old-key', apiKeys: ['saved-key'] } });
    env.elements.apiKeysFile.files = [{ async text() { return Array.from({ length: 10 }, (_, i) => `fake-key-${i}`).join(';'); } }];
    await env.elements.apiKeysFile.onchange();
    assert.equal(env.elements.apiKeys.value, 'saved-key;');
    assert.match(env.elements.apiStatus.textContent, /no máximo 9/);
    assert.equal(env.writes.length, 0);
});
test('direção da persona é mantida, parâmetros unary não entram no setup Live',async()=>{
 const env=createOptions();await env.synthesize('gemini-3.8-flash-tts','fake',['fake-a','fake-b'],{voiceId:'voice_demo',languageCode:'pt-BR',accent:'Mineiro',emotion:'Serena',outputFormat:'AUDIO_L16',sampleRate:16000});
 const setup=JSON.parse(env.elements.ttsPayload.textContent).setup.setup;assert.match(setup.systemInstruction.parts[0].text,/Mineiro/);assert.match(setup.systemInstruction.parts[0].text,/Serena/);assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');assert.ok(!JSON.stringify(setup).includes('voice_demo'));assert.ok(!JSON.stringify(setup).includes('languageCode'));assert.equal(env.calls.length,0);
});
test('perfil legado de diálogo permanece salvo sem acionar TTS convencional',async()=>{
 const ttsConfig={mode:'dialogue',speakers:[{name:'Ana',voice:'Kore'},{name:'Bruno',voice:'Puck'}]},env=createOptions({text:'Ana: Olá.\\nBruno: Bom dia.'});await env.synthesize('gemini-3.8-flash-tts','fake',[],ttsConfig);
 const agent=env.messages.find(m=>m.type==='TTS_REQUEST').payload.previewAgent;assert.deepEqual(JSON.parse(JSON.stringify(agent.ttsConfig)),ttsConfig);assert.equal(env.calls.length,0);assert.equal(JSON.parse(env.elements.ttsPayload.textContent).setup.setup.model,'models/gemini-3.8-live');
});
