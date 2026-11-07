'use strict';
// Chrome/MV3, teclado, microfone de teste e AudioWorklets reais. Apenas o servidor Live é simulado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'falamermo-controls-'));
const extension = path.join(temp, 'extension');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><textarea autofocus aria-label="Campo de ditado"></textarea>');
});
let chrome;
const pending = new Map();
const contexts = new Map();
let sequence = 0;

function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(Error('Timeout ' + method));
        }, 10000);
        pending.set(id, {resolve, reject, timer});
        chrome.stdio[3].write(JSON.stringify({id, method, params, sessionId}) + '\0');
    });
}

async function evaluate(sessionId, expression, contextId) {
    const {result, exceptionDetails} = await call('Runtime.evaluate', {
        expression, contextId, awaitPromise: true, returnByValue: true, userGesture: true
    }, sessionId);
    if (exceptionDetails) throw Error(result.description || exceptionDetails.text);
    return result.value;
}

async function waitFor(label, condition) {
    const until = Date.now() + 9000;
    do {
        const result = await condition();
        if (result) return result;
        await sleep(30);
    } while (Date.now() < until);
    throw Error('Estado não encontrado: ' + label);
}

async function attach(targetId) {
    const {sessionId} = await call('Target.attachToTarget', {targetId, flatten: true});
    await call('Runtime.enable', {}, sessionId);
    return sessionId;
}

async function target(url) {
    const {targetId} = await call('Target.createTarget', {url});
    return {targetId, session: await attach(targetId)};
}

function liveFixture() {
    const NativeAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends NativeAudioContext {
        constructor(options) { super({...options, sinkId: {type: 'none'}}); }
    };
    globalThis.fixtureTurns = [];
    globalThis.fixtureSttHeld = [];
    globalThis.fixturePcm = (seconds = 1) => {
        const frames = new Int16Array(Math.round(seconds * 24000));
        for (let i = 0; i < frames.length; i++) frames[i] = Math.sin(i * Math.PI * 440 / 24000) * 3000;
        const bytes = new Uint8Array(frames.buffer);
        let raw = '';
        for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return {modelTurn: {parts: [{inlineData: {data: btoa(raw), mimeType: 'audio/pcm;rate=24000'}}]}};
    };
    globalThis.WebSocket = class {
        readyState = 0;
        bufferedAmount = 0;
        constructor(url) {
            if (!url.startsWith('wss://generativelanguage.googleapis.com/')) throw Error('Host inesperado');
            queueMicrotask(() => { this.readyState = 1; this.onopen(); });
        }
        receive(serverContent) { this.message({serverContent}); }
        message(packet) { if (this.readyState === 1) this.onmessage({data: JSON.stringify(packet)}); }
        send(raw) {
            const packet = JSON.parse(raw);
            if (packet.setup) {
                this.dictation = Boolean(packet.setup.inputAudioTranscription);
                this.message({setupComplete: {}});
                return;
            }
            if (!this.dictation) {
                fixtureTurns.push(this);
                return;
            }
            const input = packet.realtimeInput;
            if (input?.audio && !this.partial) {
                this.partial = true;
                this.receive({interimInputTranscription: {text: 'Ditado de teste'}});
            }
            if (input?.activityEnd || input?.audioStreamEnd) {
                this.partial = false;
                const complete = () => this.receive({inputTranscription: {text: 'Ditado de teste.', finished: true}, turnComplete: true, interactionStatus: 'IDLE'});
                if (globalThis.fixtureHoldStt) fixtureSttHeld.push(complete);
                else complete();
            }
        }
        close(code, reason) {
            this.readyState = 3;
            queueMicrotask(() => this.onclose?.({code, reason}));
        }
    };
}

(async () => {
    fs.mkdirSync(extension);
    for (const file of fs.readdirSync(root)) {
        if (/\.(js|html|css|json)$/.test(file)) fs.copyFileSync(path.join(root, file), path.join(extension, file));
    }
    fs.cpSync(path.join(root, 'icons'), path.join(extension, 'icons'), {recursive: true});
    const offscreenFile = path.join(extension, 'offscreen.html');
    fs.writeFileSync(path.join(extension, 'controls-fixture.js'), '(' + liveFixture.toString() + ')();');
    fs.writeFileSync(offscreenFile, fs.readFileSync(offscreenFile, 'utf8').replace('<body>', '<body><script src="controls-fixture.js"></script>'));
    const playerFile = path.join(extension, 'offscreen.js');
    fs.writeFileSync(playerFile, fs.readFileSync(playerFile, 'utf8').replace(
        /\}\)\(\);\s*$/, 'globalThis.fixtureJobs = jobs; })();'
    ));
    const contentFile = path.join(extension, 'content.js');
    fs.writeFileSync(contentFile, fs.readFileSync(contentFile, 'utf8').replace(
        'exports.stt = new SttController();', 'globalThis.fixtureStt = exports.stt = new SttController();'
    ));
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const args = [
        '--no-sandbox', '--ozone-platform=x11', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
        '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe',
        '--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        '--user-data-dir=' + path.join(temp, 'profile'), 'about:blank'
    ];
    if (!process.env.FALAMERMO_HEADED) args.unshift('--headless');
    chrome = spawn(process.env.FALAMERMO_CHROME || 'google-chrome', args, {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});
    chrome.stderr.pipe(fs.createWriteStream(path.join(temp, 'chrome.log')));
    let buffer = '';
    chrome.stdio[4].on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\0')) >= 0) {
            const message = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (message.method === 'Runtime.executionContextCreated') {
                const list = contexts.get(message.sessionId) || [];
                list.push(message.params.context);
                contexts.set(message.sessionId, list);
            }
            const waiter = pending.get(message.id);
            if (waiter) {
                pending.delete(message.id);
                clearTimeout(waiter.timer);
                if (message.error) waiter.reject(Error(JSON.stringify(message.error)));
                else waiter.resolve(message.result);
            }
        }
    });
    console.log((await call('Browser.getVersion')).product);
    const {id} = await call('Extensions.loadUnpacked', {path: extension});
    const base = 'chrome-extension://' + id + '/';
    const locate = async url => (await call('Target.getTargets')).targetInfos.find(item => item.url === url);
    const worker = await attach((await waitFor('service worker MV3', () => locate(base + 'background.js'))).targetId);
    await waitFor('background inicializado', () => evaluate(worker, 'typeof chrome !== "undefined" && typeof GlobalJobs !== "undefined"'));
    await evaluate(worker, 'chrome.storage.local.set({api:{apiKeys:["fixture-local"]}})');
    const page = await target('http://127.0.0.1:' + server.address().port);
    const isolated = await waitFor('content script MV3', async () => {
        for (const context of contexts.get(page.session) || []) {
            if (!context.auxData?.isDefault && await evaluate(page.session, 'typeof fixtureStt === "object"', context.id)) return context.id;
        }
    });
    const content = expression => evaluate(page.session, expression, isolated);
    await content('globalThis.fixtureHud=document.querySelector("#ext-tts-stt-host").shadowRoot');
    const state = async () => (await evaluate(worker, 'chrome.storage.session.get("falamermo.globalJobs.v1")'))['falamermo.globalJobs.v1'];
    const job = async id => (await state()).jobs.find(item => item.jobId === id);
    const key = (type, autoRepeat = false, session = page.session) => call('Input.dispatchKeyEvent', {
        type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: 10, autoRepeat
    }, session);
    const press = async session => { await key('rawKeyDown', false, session); await key('keyUp', false, session); };
    const sttCount = async () => ((await state())?.jobs || []).filter(item => item.type === 'STT').length;
    let sttJobId;
    for (const mode of ['final', 'realtime']) {
        await waitFor('background inicializado', () => evaluate(worker, 'typeof chrome !== "undefined" && typeof GlobalJobs !== "undefined"'));
    await evaluate(worker, 'chrome.storage.local.set({ui:{dictationInsertion:' + JSON.stringify(mode) + '}})');
        await waitFor(mode, () => content('fixtureStt.insertionMode === ' + JSON.stringify(mode)));
        for (let cycle = 0; cycle < 2; cycle++) {
            const count = await sttCount();
            await press();
            const jobId = await waitFor('gravando', () => content('fixtureStt.isRecording && fixtureStt.liveJobId'));
            await waitFor('PCM do microfone', () => content('fixtureStt.liveCapture?.metrics?.forwardedBytes > 0'));
            await key('rawKeyDown');
            await waitFor('microfone liberado', () => content('!fixtureStt.liveCapture'));
            await key('rawKeyDown', true);
            await key('rawKeyDown', true);
            assert.equal(await content('fixtureStt.liveCapture'), null, 'repetição reabriu a captura antes da soltura');
            await key('keyUp');
            await waitFor('final STT', async () => (await job(jobId)).status === 'completed');
            assert.equal(await sttCount(), count + 1, 'repetição da tecla reabriu o ditado');
            sttJobId = jobId;
            assert.equal(await content('fixtureStt.isRecording'), false);
        }
        console.log('STT ' + mode + ': Start → Stop → Start → Stop, com repetição');
    }
    let popup, options;
    const popupEval = expression => evaluate(popup.session, expression);
    const optionsEval = expression => evaluate(options.session, expression);
    const command = async (type, payload) => {
        const result = await popupEval('chrome.runtime.sendMessage(' + JSON.stringify({type, payload}) + ')');
        assert.equal(result.success, true, result.error);
        return result;
    };
    const act = (jobId, action, extra = {}) => command('HUD_GLOBAL_COMMAND', {jobId, action, ...extra});
    const button = (selector, evaluateView) => evaluateView(
        '(() => { const button = (globalThis.fixtureHud || document).querySelector(' + JSON.stringify(selector) +
        '); if (!button || button.disabled || button.hidden) return false; button.click(); return true; })()'
    );
    const click = (selector, evaluateView = popupEval) => waitFor(selector, () => button(selector, evaluateView));
    const openHudSettings = async () => {
        await waitFor('aba anterior de opções fechada', async () => !(await locate(base + 'options.html')));
        const position = await content(`(() => {
            const rect = fixtureHud.querySelector('button[aria-label="Configurações"]').getBoundingClientRect();
            return {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
        })()`);
        await call('Target.activateTarget', {targetId: page.targetId});
        for (const type of ['mousePressed', 'mouseReleased']) {
            await call('Input.dispatchMouseEvent', {type, ...position, button:'left', clickCount:1}, page.session);
        }
        const {targetId} = await waitFor('engrenagem do HUD abriu options.html', () => locate(base + 'options.html'));
        return {targetId, session: await attach(targetId)};
    };
    const card = (id, action) => '[data-job-id="' + id + '"] [data-action="' + action + '"]';
    const toggle = '[data-action="toggle"]';
    const status = (id, expected, narration = false) => waitFor(id + ' ' + expected, async () => {
        const found = await job(id);
        return (narration ? found?.narration?.status : found?.status) === expected && found;
    });
    let attachedAudio;
    const offscreen = () => waitFor('offscreen MV3 inicializado', async () => {
        const found = await locate(base + 'offscreen.html');
        if (!found) return;
        try {
            if (attachedAudio?.targetId !== found.targetId) {
                attachedAudio = {targetId: found.targetId, session: await attach(found.targetId)};
            }
            if (await evaluate(attachedAudio.session, 'typeof fixtureJobs === "object"')) return attachedAudio.session;
        } catch (error) {
            if (!/target|session|context/i.test(error.message)) throw error;
        }
    });
    const secondPage = await target('http://127.0.0.1:' + server.address().port + '/other');
    await waitFor('outro content script', async () => (contexts.get(secondPage.session) || []).find(c => !c.auxData?.isDefault));
    const secondContext = (contexts.get(secondPage.session) || []).find(c => !c.auxData?.isDefault).id;
    const secondContent = expression => evaluate(secondPage.session, expression, secondContext);
    await secondContent('globalThis.fixtureHud=document.querySelector("#ext-tts-stt-host").shadowRoot');
    await press();
    const activeDictation = await waitFor('primeiro ditado', () => content('fixtureStt.isRecording && fixtureStt.liveJobId'));
    const dictationsBefore = await sttCount();
    await click('#ext-btn-min', content);
    await waitFor('HUD minimizado na segunda aba', () => secondContent('fixtureHud.querySelector(".ext-hud-body").hidden'));
    await secondContent('fixtureStt.toggleRecording()');
    assert.equal(await secondContent('fixtureStt.liveCapture'), null);
    assert.equal(await sttCount(), dictationsBefore);
    assert.equal(await secondContent('fixtureHud.querySelector(".ext-hud-card").classList.contains("hidden")'), false);
    assert.equal(await secondContent(`(() => {
        const alert = [...fixtureHud.querySelectorAll('[role="alert"]')].find(node => node.getBoundingClientRect().height > 0);
        return alert?.textContent;
    })()`), 'Já existe um ditado em andamento em outra aba.');
    assert.equal(await secondContent('fixtureHud.querySelector(".ext-hud-body").hidden'), true);
    assert.doesNotMatch(await secondContent('fixtureHud.querySelector(".ext-hud-card").innerText'), /atualize|recarregue|F5/i);
    assert.equal(await content('fixtureHud.querySelector("#ext-capture-notice").hidden'), true);
    assert.equal(await content('fixtureStt.liveJobId'), activeDictation);
    await click('#ext-btn-min', content);
    await waitFor('HUD restaurado', () => content('!fixtureHud.querySelector(".ext-hud-body").hidden'));
    options = await openHudSettings();
    assert.equal((await job(activeDictation)).status, 'recording');
    assert.equal((await state()).minimized, false);
    await waitFor('Opções carregadas', () => optionsEval('typeof toggleLiveSttTest === "function" && !!currentAgent'));
    await optionsEval('toggleLiveSttTest()');
    assert.equal(await optionsEval('liveMic'), null);
    assert.match(await optionsEval('document.querySelector("#sttStatus").textContent'), /ditado em andamento/);
    await waitFor('PCM', () => content('fixtureStt.liveCapture?.metrics?.forwardedBytes > 0'));
    await press();
    await status(activeDictation, 'completed');
    await secondContent('fixtureStt.toggleRecording()');
    const retried = await waitFor('ditado na segunda aba após liberação', () => secondContent('fixtureStt.isRecording && fixtureStt.liveJobId'));
    assert.equal(await secondContent('fixtureHud.querySelector(".ext-hud-card").innerText.includes("Já existe um ditado")'), false);
    await waitFor('PCM da segunda aba', () => secondContent('fixtureStt.liveCapture?.metrics?.forwardedBytes > 0'));
    await secondContent('fixtureStt.toggleRecording()');
    await status(retried, 'completed');
    await optionsEval('toggleLiveSttTest()');
    const optionsJob = await waitFor('Opções gravando', () => optionsEval('liveMic && !liveMic.starting && liveMic.jobId'));
    await secondContent('fixtureStt.toggleRecording()');
    assert.equal(await secondContent('fixtureStt.liveCapture'), null);
    await waitFor('PCM de Opções', () => optionsEval('liveMic?.metrics?.forwardedBytes > 0'));
    await optionsEval('toggleLiveSttTest()');
    await status(optionsJob, 'completed');
    await call('Target.closeTarget', {targetId: options.targetId});
    options = await openHudSettings();
    assert.equal((await state()).minimized, false);
    await call('Target.closeTarget', {targetId: options.targetId});
    console.log('HUD minimizado: aviso local, exclusividade e novo ditado após liberação. Engrenagem abriu options.html durante e após o ditado');

    await evaluate(worker, 'chrome.storage.local.set({api:{apiKeys:["fixture-local","fixture-overlap"]}})');
    await content('const other = document.createElement("textarea"); other.id = "next-dictation"; document.body.append(other)');
    for (const mode of ['final', 'realtime']) {
        await evaluate(worker, 'chrome.storage.local.set({ui:{dictationInsertion:' + JSON.stringify(mode) + '}})');
        for (const [label, view, session, field] of [
            ['mesma aba', content, page.session, '#next-dictation'],
            ['outra aba', secondContent, secondPage.session, 'textarea']
        ]) {
            await waitFor(mode, () => content('fixtureStt.insertionMode === ' + JSON.stringify(mode)));
            await waitFor(mode, () => view('fixtureStt.insertionMode === ' + JSON.stringify(mode)));
            await content('document.querySelector("textarea").focus()');
            await press();
            const first = await waitFor('primeira captura', () => content('fixtureStt.isRecording && fixtureStt.liveJobId'));
            await content('globalThis.fixturePreviousCapture = fixtureStt.liveCapture');
            await waitFor('PCM da primeira captura', () => content('fixtureStt.liveCapture?.metrics?.forwardedBytes > 0'));
            const sttSession = await offscreen();
            await evaluate(sttSession, 'globalThis.fixtureHoldStt = true');
            await press();
            await status(first, 'waiting');
            await waitFor('resultado antigo retido pelo servidor de teste', () => evaluate(sttSession, 'fixtureSttHeld.length > 0'));
            assert.equal(await content('fixturePreviousCapture.stream.getAudioTracks()[0].readyState'), 'ended');
            await evaluate(sttSession, 'globalThis.fixtureHoldStt = false');
            await view('document.querySelector(' + JSON.stringify(field) + ').focus()');
            await press(session);
            const second = await waitFor('segunda captura com a primeira em processamento', () => view('fixtureStt.isRecording && fixtureStt.liveJobId'));
            assert.notEqual(second, first);
            assert.equal((await job(first)).status, 'waiting');
            assert.equal(await view('fixtureHud.querySelector("#ext-capture-notice").hidden'), true);
            await evaluate(sttSession, 'fixtureSttHeld.splice(0).forEach(complete => complete())');
            const previous = await status(first, 'completed');
            assert.match(previous.text, /Ditado de teste/);
            assert.equal(await view('fixtureStt.liveJobId'), second);
            assert.equal(await view('fixtureStt.liveCapture.stream.getAudioTracks()[0].readyState'), 'live');
            await waitFor('PCM da segunda captura', () => view('fixtureStt.liveCapture?.metrics?.forwardedBytes > 0'));
            await press(session);
            const next = await status(second, 'completed');
            assert.match(next.text, /Ditado de teste/);
            assert.equal(next.insertion.inserted, true);
            console.log('STT ' + mode + ' na ' + label + ': nova gravação com resultado anterior pendente e conclusão isolada');
        }
    }
    await evaluate(worker, 'chrome.storage.local.set({api:{apiKeys:["fixture-local"]}})');

    if (process.env.FALAMERMO_NATIVE_SHORTCUT) {
        await call('Target.activateTarget', {targetId: page.targetId});
        await call('Page.bringToFront', {}, page.session);
        await content('document.querySelector("textarea").focus()');
        await waitFor('foco do Chrome', () => content('document.hasFocus()'));
        const shortcuts = await evaluate(worker, 'chrome.commands.getAll()');
        assert.equal(shortcuts.find(command => command.name === 'start_dictation')?.shortcut, 'Alt+Shift+D');
        await evaluate(worker, 'globalThis.fixtureCommands=0;chrome.commands.onCommand.addListener(c=>{if(c==="start_dictation")fixtureCommands++;})');
        const native = down => execFileSync('python3', ['-c', `import ctypes as c
x=c.CDLL('libX11.so.6'); t=c.CDLL('libXtst.so.6')
x.XOpenDisplay.restype=c.c_void_p
d=c.c_void_p(x.XOpenDisplay(None)); assert d.value
for key in ${down ? "['Alt_L','Shift_L','d']" : "['d','Shift_L','Alt_L']"}:
    code=x.XKeysymToKeycode(d,x.XStringToKeysym(key.encode()))
    t.XTestFakeKeyEvent(d,code,${down ? 1 : 0},0)
x.XSync(d,0); x.XCloseDisplay(d)
`]);
        for (const mode of ['final', 'realtime']) {
          await evaluate(worker, 'chrome.storage.local.set({ui:{dictationInsertion:' + JSON.stringify(mode) + '}})');
          await waitFor(mode, () => content('fixtureStt.insertionMode === ' + JSON.stringify(mode)));
          for (let cycle = 0; cycle < 2; cycle++) {
            const before = await evaluate(worker, 'fixtureCommands');
            const jobsBefore = await sttCount();
            native(true);
            try { await waitFor('comando Chrome', () => content('fixtureStt.isRecording')); }
            finally { native(false); }
            const active = await content('fixtureStt.liveJobId');
            await waitFor('PCM nativo', () => content('fixtureStt.liveCapture?.metrics?.forwardedBytes > 0'));
            native(true);
            try {
                await status(active, 'completed');
                // Hold beyond the X11 repeat threshold after the capture has stopped.
                await sleep(850);
            } finally { native(false); }
            assert.ok(await evaluate(worker, 'fixtureCommands') > before + 2, 'teste precisa provocar repetição nativa');
            assert.equal(await sttCount(), jobsBefore + 1, 'repetição nativa criou outro ditado');
            assert.equal(await content('fixtureStt.liveCapture'), null);
          }
          console.log('Atalho nativo Alt+Shift+D em ' + mode + ': Start → Stop → Start → Stop, com tecla mantida');
        }
    }

    if (process.env.FALAMERMO_HEADED) {
        await call('Target.activateTarget', {targetId: page.targetId});
        await evaluate(worker, 'chrome.action.openPopup()');
        const opened = await waitFor('pop-up do botão da extensão', () => locate(base + 'popup.html'));
        popup = {targetId: opened.targetId, session: await attach(opened.targetId)};
        console.log('Pop-up aberto pela ação nativa da extensão');
    } else popup = await target(base + 'popup.html');

    const create = async text => {
        const result = await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_CREATE"})');
        assert.equal(result.success, true, result.error);
        const id = result.state.activeTaskId;
        await act(id, 'edit', {text});
        return id;
    };
    const a = await create('Teste de narração A.');
    const b = await create('Teste de narração B.');
    await click(card(a, 'playPause'), content);
    const audio = await offscreen();
    const playback = expression => evaluate(audio, expression);
    const turns = () => playback('fixtureTurns.length');
    const send = (index, expression) => playback('fixtureTurns[' + index + '].receive(' + expression + ')');
    const player = id => playback('fixtureJobs.get(' + JSON.stringify(id) + ')?.player.status()');
    const turnA = (await waitFor('turno A', turns)) - 1;
    await click(card(a, 'playPause'), content);
    await status(a, 'paused');
    await click(toggle);
    await status(a, 'connecting');
    assert.equal((await player(a)).currentTime, 0);
    assert.equal(await turns(), turnA + 1);
    assert.equal(await popupEval('document.querySelector(' + JSON.stringify(toggle) + ').disabled'), true);

    await send(turnA, 'fixturePcm(.6)');
    await status(a, 'playing');
    await status(a, 'connecting');
    assert.equal((await player(a)).currentTime, .6);
    await click(toggle, content);
    await status(a, 'paused');
    await send(turnA, 'fixturePcm(12)');
    await click(toggle);
    await status(a, 'playing');
    console.log('HUD/pop-up: Resume sem PCM, fim do buffer, Pause e retomada sem outra síntese');

    const volume = async (selector, value, view) => view(`(() => {
        const input = (globalThis.fixtureHud || document).querySelector(${JSON.stringify(selector)});
        input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await volume('[data-job-id="' + a + '"] [data-card-control="volume"]', '.4', content);
    await volume('[data-control="volume"]', '.5', popupEval);
    await waitFor('volume individual e global', async () => (await player(a)).volume === .4 && (await state()).playback.volume === .5);
    assert.ok(Math.abs(await playback(`fixtureJobs.get(${JSON.stringify(a)}).player.gain.gain.value`) - .2) < 1e-6);

    await click(card(b, 'playPause'));
    await waitFor('turno B', async () => await turns() === turnA + 2);
    assert.equal((await job(a)).status, 'playing');
    await send(turnA + 1, 'fixturePcm(10)');
    await status(b, 'playing');
    await status(a, 'paused');
    const pausedPosition = (await player(a)).currentTime;
    assert.ok(pausedPosition > .6);
    assert.equal((await player(a)).contextState, 'suspended');
    assert.equal((await player(b)).volume, 1);
    await click(toggle);
    await status(b, 'paused');
    await click(toggle, content);
    await status(b, 'playing');
    await click(card(a, 'playPause'), content);
    await status(a, 'playing');
    await status(b, 'paused');
    assert.ok((await player(a)).currentTime >= pausedPosition);
    assert.equal(await turns(), turnA + 2);
    await call('Target.closeTarget', {targetId: popup.targetId});
    assert.equal((await player(a)).playbackState, 'playing');
    await click('#ext-btn-close', content);
    await waitFor('HUD fechado', async () => (await state()).visible === false);
    assert.equal((await player(a)).playbackState, 'playing');
    await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_UI_SET",payload:{visible:true}})');
    await waitFor('HUD reaberto', async () => (await state()).visible === true);
    options = await openHudSettings();
    assert.equal((await player(a)).playbackState, 'playing');
    assert.equal((await state()).minimized, false);
    await call('Target.closeTarget', {targetId: options.targetId});
    console.log('Engrenagem abriu options.html durante a narração, sem alterar a reprodução');
    console.log('TTS exclusivo, volumes independentes, posição preservada e fechamento do HUD e pop-up');

    await click(card(b, 'stop'), content);
    await status(b, 'cancelled');
    assert.equal(await player(b), undefined);
    assert.equal((await player(a)).playbackState, 'playing');
    await click(card(b, 'playPause'), content);
    await waitFor('nova síntese após Stop', async () => await turns() === turnA + 3);
    await send(turnA + 2, "{interactionStatus:'IDLE',turnComplete:true}");
    // Empty results can fall back to the next existing model. Reject the next attempt explicitly.
    await waitFor('fallback sem PCM', async () => await turns() === turnA + 4);
    await playback("fixtureTurns.at(-1).message({error:{code:400,message:'Falha simulada no transporte Live'}})");
    await status(b, 'error');
    assert.equal((await player(a)).playbackState, 'playing');
    console.log('Stop descarta somente o áudio do card, novo Play sintetiza e falha sem PCM fica visível');

    // A completed STT job narrates through the same player, keeping its transcript.
    const transcript = (await job(sttJobId)).text;
    await click(card(sttJobId, 'collapse'), content);
    await click(card(sttJobId, 'playPause'), content);
    await waitFor('turno da narração STT', async () => await turns() === turnA + 5);
    await send(turnA + 4, 'fixturePcm(8)');
    await status(sttJobId, 'playing', true);
    await status(a, 'paused');
    await click(card(sttJobId, 'playPause'), content);
    await status(sttJobId, 'paused', true);
    await click(card(sttJobId, 'stop'), content);
    await status(sttJobId, 'cancelled', true);
    assert.equal((await job(sttJobId)).text, transcript);
    assert.equal((await job(a)).status, 'paused');
    console.log('Card STT: Play/Pause/Stop no próprio áudio, com transcrição preservada');
    await click(card(b, 'playPause'), content);
    await waitFor('última narração', async () => await turns() === turnA + 6);
    await send(turnA + 5, "{...fixturePcm(.5),interactionStatus:'IDLE',turnComplete:true}");
    await status(b, 'completed');
    assert.equal((await job(a)).status, 'paused');
    console.log('Fim natural mantém as outras narrações pausadas');
})().catch(error => {
    console.error(error.stack || error);
    console.error('Log do Chrome em ' + temp);
    process.exitCode = 1;
}).finally(async () => {
    server.close();
    if (chrome) {
        try { await call('Browser.close'); } catch { chrome.kill(); }
    }
    if (!process.exitCode) fs.rmSync(temp, {recursive: true, force: true});
});
