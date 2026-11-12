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
            reject(Error('Timeout ' + method + (params.expression?' · '+params.expression.slice(0,100):'')));
        }, 10000);
        pending.set(id, {resolve, reject, timer, method, expression:params.expression?.slice(0,100)});
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

async function waitFor(label, condition, timeoutMs = 9000) {
    const until = Date.now() + timeoutMs;
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

async function target(url, options = {}) {
    const {targetId} = await call('Target.createTarget', {url,...options});
    return {targetId, session: await attach(targetId)};
}

function liveFixture() {
    const NativeAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends NativeAudioContext {
        constructor(options) { super({...options, sinkId: {type: 'none'}}); }
    };
    globalThis.fixtureTurns = [];
    globalThis.fixtureSockets = [];
    globalThis.fixtureSttSetups = [];
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
            fixtureSockets.push(this);
            this.fixtureAccount = new URL(url).searchParams.get('key');
            queueMicrotask(() => { this.readyState = 1; this.onopen(); });
        }
        receive(serverContent) { this.message({serverContent}); }
        message(packet) { if (this.readyState === 1) this.onmessage({data: JSON.stringify(packet)}); }
        send(raw) {
            const packet = JSON.parse(raw);
            if (packet.setup) {
                this.fixtureSetup = packet.setup;
                this.dictation = Boolean(packet.setup.inputAudioTranscription);
                if (this.dictation) fixtureSttSetups.push(packet.setup);
                this.message({setupComplete: {}});
                return;
            }
            if (!this.dictation) {
                fixtureTurns.push(this);
                return;
            }
            const input = packet.realtimeInput;
            if (input?.audio && globalThis.fixtureVadWire) (this.fixtureAudio??=[]).push(input.audio.data);
            const phrase=globalThis.fixtureNumbered?'Bloco '+this.fixtureBlock+'.':'Ditado de teste.';
            if (input?.audio && globalThis.fixtureSilentHypothesis && !this.fixtureSilentReply && !/[^\x00]/.test(atob(input.audio.data))) {
                this.fixtureSilentReply = true;
                this.receive({interimInputTranscription: {text: '¿Qué?'}});
                this.receive({inputTranscription: {text: '¿Qué?', finished: true}});
            }
            if (input?.audio && !this.partial && !globalThis.fixtureNoInterim) {
                this.partial = true;
                this.receive({interimInputTranscription: {text: phrase.slice(0,-1)}});
            }
            if (input?.activityEnd || input?.audioStreamEnd) {
                this.partial = false;
                const complete = () => queueMicrotask(() => this.receive({inputTranscription: {text: phrase, finished: true}, turnComplete: true, interactionStatus: 'IDLE'}));
                if (globalThis.fixtureHoldStt) fixtureSttHeld.push({complete,account:this.fixtureAccount});
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
    if (fs.existsSync(path.join(root,'vad-assets'))) fs.cpSync(path.join(root,'vad-assets'),path.join(extension,'vad-assets'),{recursive:true});
    if(process.env.FALAMERMO_VAD_ONLY){
        const file=path.join(extension,'background.js');
        fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(
            "type: 'STT_VAD_OFFSCREEN', target: 'offscreen', payload",
            "type: 'STT_VAD_OFFSCREEN', target: 'offscreen', payload:{...payload,warm:!globalThis.fixtureVadCold}"
        ).replace(
            'if(globalPanic||!chrome.offscreen?.closeDocument',
            'if(globalThis.fixtureVadKeepOffscreen||globalPanic||!chrome.offscreen?.closeDocument'
        ));
    }
    const offscreenFile = path.join(extension, 'offscreen.html');
    fs.writeFileSync(path.join(extension, 'controls-fixture.js'), '(' + liveFixture.toString() + ')();');
    fs.writeFileSync(offscreenFile, fs.readFileSync(offscreenFile, 'utf8').replace('<body>', '<body><script src="controls-fixture.js"></script>'));
    const playerFile = path.join(extension, 'offscreen.js');
    fs.writeFileSync(playerFile, fs.readFileSync(playerFile, 'utf8').replace(
        'let sent=false;', 'session.socket.fixtureBlock=sequence; let sent=false;'
    ).replace(
        'return stopAllOperations();','return stopAllOperations().then(async result=>{if(globalThis.fixtureHoldPanic)await new Promise(resolve=>globalThis.fixtureReleasePanic=resolve);return result;});'
    ).replace(
        /\}\)\(\);\s*$/, 'globalThis.fixtureJobs = jobs; })();'
    ));
    const contentFile = path.join(extension, 'content.js');
    fs.writeFileSync(contentFile, fs.readFileSync(contentFile, 'utf8').replace(
        'exports.stt = new SttController();', 'globalThis.fixtureStt = exports.stt = new SttController();'
    ).replace(
        'let cachedActiveAgentId = null;', 'let cachedActiveAgentId = null; globalThis.fixtureActiveAgent = () => cachedActiveAgentId;'
    ).replace(
        'capture.unwatch=globalThis.DictationRuntime.watchCapture',
        'if(globalThis.fixtureVadInput){capture.fixtureHandler=node.port.onmessage;node.port.onmessage=event=>{if(event.data?.type==="flushed")capture.fixtureHandler(event);};}capture.unwatch=globalThis.DictationRuntime.watchCapture'
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
                if (message.error) waiter.reject(Error([waiter.method,waiter.expression,message.error.message].filter(Boolean).join(' · ')));
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
    await waitFor('migração inicial da instalação',()=>evaluate(worker,'chrome.storage.local.get("agents").then(value=>!!value.agents)'));
    await evaluate(worker, 'chrome.storage.local.set({api:{apiKeys:["fixture-local"]},sttVadDetector:"rms"})');
    const page = await target('http://127.0.0.1:' + server.address().port+(process.env.FALAMERMO_VAD_MANUAL_PAGE?'/vad-manual':''));
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
    if(!process.env.FALAMERMO_PANIC_ONLY&&!process.env.FALAMERMO_VAD_ONLY)for (const mode of ['final', 'realtime']) {
        await waitFor('background inicializado', () => evaluate(worker, 'typeof chrome !== "undefined" && typeof GlobalJobs !== "undefined"'));
    await evaluate(worker, 'chrome.storage.local.set({ui:{dictationInsertion:' + JSON.stringify(mode) + '}})');
        await waitFor(mode, () => content('fixtureStt.insertionMode === ' + JSON.stringify(mode)));
        for (let cycle = 0; cycle < 2; cycle++) {
            const count = await sttCount();
            await press();
            const jobId = await waitFor('gravando', () => content('fixtureStt.isRecording && fixtureStt.liveJobId')).catch(async error=>{
                console.error('Estado inicial de captura',await state(),await content('fixtureHud.textContent.slice(-450)'));
                throw error;
            });
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
    const defaultInstructions = require('../live-config.js').STT_DEFAULT_INSTRUCTIONS;
    const editedInstructions = 'Preserve siglas.\nMantenha nomes próprios.';
    const editedVocabulary = ['FalaMermo', 'Banco de Dados'];
    if(!process.env.FALAMERMO_VAD_ONLY){
    options = await target(base + 'options.html');
    const recognitionForm = () => optionsEval(`(() => ({
        instructions:document.querySelector('#sttRecognitionInstructions')?.value,
        language:document.querySelector('#sttRecognitionLanguage')?.value,
        vocabulary:document.querySelector('#sttRecognitionVocabulary')?.value
    }))()`);
    const fillRecognition = (instructions,language,vocabulary) => optionsEval(`(() => {
        document.querySelector('#sttRecognitionInstructions').value=${JSON.stringify(instructions)};
        document.querySelector('#sttRecognitionLanguage').value=${JSON.stringify(language)};
        document.querySelector('#sttRecognitionVocabulary').value=${JSON.stringify(vocabulary)};
    })()`);
    const storedRecognition = async () => (await evaluate(worker,'chrome.storage.local.get("sttRecognition")')).sttRecognition;
    await waitFor('preferências STT carregadas',async()=> (await recognitionForm()).instructions);
    assert.deepEqual(await recognitionForm(),{instructions:defaultInstructions,language:'pt-BR',vocabulary:''});
    await fillRecognition(editedInstructions,'auto',' FalaMermo \nBanco de Dados\nFalaMermo');
    await click('#saveSttRecognition',optionsEval);
    const saved = await waitFor('preferências STT salvas',async()=>{
        const item = await storedRecognition();
        return item?.instructions===editedInstructions&&item;
    });
    assert.deepEqual(saved,{instructions:editedInstructions,language:'auto',customVocabulary:editedVocabulary});
    await call('Target.closeTarget',{targetId:options.targetId});
    options = await target(base + 'options.html');
    await waitFor('preferências STT recarregadas',async()=> (await recognitionForm()).instructions===editedInstructions);
    assert.deepEqual(await recognitionForm(),{instructions:editedInstructions,language:'auto',vocabulary:editedVocabulary.join('\n')});
    await click('#restoreSttInstructions',optionsEval);
    await waitFor('instruções padrão restauradas',async()=> (await recognitionForm()).instructions===defaultInstructions);
    assert.deepEqual(await storedRecognition(),{...saved,instructions:defaultInstructions});
    assert.deepEqual(await recognitionForm(),{instructions:defaultInstructions,language:'auto',vocabulary:editedVocabulary.join('\n')});
    await fillRecognition(editedInstructions,'pt-BR',editedVocabulary.join('\n'));
    await click('#saveSttRecognition',optionsEval);
    await waitFor('preferências STT para a captura',async()=> (await storedRecognition())?.language==='pt-BR');
    await call('Target.closeTarget',{targetId:options.targetId});
    console.log('Opções STT: edição, persistência, detecção automática e restauração de instruções');
    }
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
    if(process.env.FALAMERMO_VAD_ONLY){
        await require('./stt-vad-chrome-cases.cjs')({call,worker,content,evaluate,waitFor,offscreen,locate,base,status,job,sleep,page,click,target});
        return;
    }
    if(process.env.FALAMERMO_PANIC_ONLY){
        popup=await target(base+'popup.html');
        const other=await target('http://127.0.0.1:'+server.address().port+'/panic');
        const contextId=await waitFor('content script da segunda aba',()=> (contexts.get(other.session)||[]).find(c=>!c.auxData?.isDefault)?.id);
        const secondContent=expression=>evaluate(other.session,expression,contextId);
        await testPanic(secondContent);
        return;
    }
    await evaluate(worker, 'chrome.storage.local.set({api:{apiKeys:["fixture-local","fixture-overlap","fixture-third","fixture-fourth"]}})');
    await content('const other = document.createElement("textarea"); other.id = "next-dictation"; document.body.append(other)');
    await evaluate(worker, 'chrome.storage.local.set({ui:{dictationInsertion:"realtime"}})');
    await waitFor('modo tempo real', () => content('fixtureStt.insertionMode === "realtime"'));
    await call('Page.bringToFront',{},page.session);
    const readEditorDiagnostics=async id=>{
        const result=await evaluate(worker,'chrome.storage.session.get("liveSttDiagnosticsV1")');
        return result.liveSttDiagnosticsV1?.jobs.find(item=>item.jobId===id);
    };
    for(const rejectLater of [false,true]){
        await content(`(() => {
            const field=document.querySelector('#next-dictation');
            field.value='Antes | depois';field.focus();field.setSelectionRange(6,6);
        })()`);
        if(rejectLater)await evaluate(page.session,`(() => {
            const field=document.querySelector('#next-dictation');
            globalThis.fixtureRejectInput=new AbortController();
            field.addEventListener('beforeinput',event=>{
                if(field.value.includes('Bloco 1.'))event.preventDefault();
            },{signal:fixtureRejectInput.signal});
        })()`);
        await press();
        const id=await waitFor('captura com foco fixo',()=>content('fixtureStt.isRecording&&fixtureStt.liveJobId'));
        await content(`(() => {
            const capture=fixtureStt.liveCapture,handler=capture.node.port.onmessage,pipeline=capture.chunker;
            globalThis.fixtureBlockFeed=0;
            capture.node.port.onmessage=event=>{
                if(event.data?.type==='flushed'){handler(event);return;}
                if(!fixtureBlockFeed)return;
                handler(event);
                if(pipeline.chunk&&pipeline.samples/16-pipeline.chunk.startMs>=600)pipeline.closeChunk('silence');
                if(pipeline.sequence>=fixtureBlockFeed&&!pipeline.chunk)globalThis.fixtureBlockFeed=0;
            };
        })()`);
        await evaluate(await offscreen(),'globalThis.fixtureNoInterim=true;globalThis.fixtureNumbered=true');
        let previousText='',previousRevision=0;
        for(let sequence=1;sequence<=(rejectLater?2:3);sequence++){
            // Entrega um bloco do microfone de teste por revisão observada.
            await content('globalThis.fixtureBlockFeed='+sequence);
            const expected=Array.from({length:sequence},(_,i)=>'Bloco '+(i+1)+'.').join(' ');
            const confirmed=await waitFor('ACK da revisão confirmada',async()=>{
                const current=await job(id);
                return current?.text===expected&&!current.partialText&&current.insertion?.revision===current.textRevision&&current;
            });
            const inserted=!(rejectLater&&sequence===2);
            if(!rejectLater&&sequence===1){
                const setups=await evaluate(await offscreen(),'fixtureSttSetups.slice(-2)');
                assert.equal(setups.length,2);
                for(const setup of setups){
                    assert.equal(setup.model,'models/gemini-3.8-live');
                    assert.deepEqual(setup.inputAudioTranscription,{languageCodes:['pt-BR'],customVocabulary:editedVocabulary});
                    assert.ok(setup.systemInstruction.parts[0].text.startsWith(editedInstructions));
                }
                console.log('STT no Chrome: duas sessões do bloco enviaram o mesmo idioma, vocabulário e instruções');
            }
            assert.equal(confirmed.insertion.inserted,inserted);
            assert.ok(confirmed.textRevision>previousRevision);
            const applied=await waitFor('registro da aplicação no editor',async()=>(await readEditorDiagnostics(id))?.events.find(
                event=>event.stage==='editor-apply'&&event.revision===confirmed.textRevision
            )).catch(async error=>{
                const events=(await readEditorDiagnostics(id))?.events.filter(event=>event.scope==='editor').map(event=>[event.stage,event.revision,event.editorReason]);
                throw Error(error.message+' (revisão '+confirmed.textRevision+', eventos '+JSON.stringify(events)+')');
            });
            assert.equal(applied.before.focused,true);
            assert.equal(applied.after.focused,true);
            assert.equal(applied.before.selectionStart,6);
            assert.equal(applied.after.selectionStart,6);
            assert.equal(applied.after.selectionEnd,6);
            assert.equal(applied.appliedRevision,inserted?confirmed.textRevision:previousRevision);
            assert.equal(await content('document.querySelector("#next-dictation").value'),
                'Antes '+(inserted?expected:previousText)+'| depois','campo após a revisão '+confirmed.textRevision);
            if(!inserted){
                const divergence=(await readEditorDiagnostics(id)).firstEditorDivergence;
                assert.ok(divergence.revision>previousRevision&&divergence.revision<=confirmed.textRevision);
                assert.equal(divergence.editorReason,'EDITOR_REJECTED');
                assert.equal(divergence.before.writes,divergence.after.writes);
            }
            previousText=confirmed.text;
            previousRevision=confirmed.textRevision;
        }
        assert.equal(await content('fixtureStt.isRecording'),true);
        await press();
        const final=await status(id,'completed');
        assert.equal(final.insertion.inserted,!rejectLater);
        assert.equal(final.insertion.revision,final.textRevision);
        await waitFor('ACK final registrado no diagnóstico',async()=>(await readEditorDiagnostics(id))?.events.find(
            event=>event.stage==='editor-ack'&&event.revision===final.textRevision&&event.ackAccepted===true
        ));
        if(rejectLater)await evaluate(page.session,'fixtureRejectInput.abort()');
        else assert.equal(await content('document.querySelector("#next-dictation").value'),'Antes '+final.text+'| depois');
    }
    console.log('STT em primeiro plano: três revisões sem mover o cursor e captura da primeira escrita recusada pelo editor');
    if(attachedAudio)try{await evaluate(attachedAudio.session,'globalThis.fixtureNumbered=false;globalThis.fixtureNoInterim=false');}
    catch(error){if(!/target|session|context/i.test(error.message))throw error;}
    const secondPage = await target('http://127.0.0.1:' + server.address().port + '/other');
    await waitFor('outro content script', async () => (contexts.get(secondPage.session) || []).find(c => !c.auxData?.isDefault));
    const secondContext = (contexts.get(secondPage.session) || []).find(c => !c.auxData?.isDefault).id;
    const secondContent = expression => evaluate(secondPage.session, expression, secondContext);
    await secondContent('globalThis.fixtureHud=document.querySelector("#ext-tts-stt-host").shadowRoot');
    const otherWindow=await target('http://127.0.0.1:'+server.address().port+'/other-window',{newWindow:true});
    const hiddenPage=await target('http://127.0.0.1:'+server.address().port+'/hidden-hud');
    const windowId=async page=>(await call('Browser.getWindowForTarget',{targetId:page.targetId})).windowId;
    assert.equal(await windowId(page),await windowId(secondPage));
    assert.notEqual(await windowId(page),await windowId(otherWindow));
    const viewer=async page=>{
        const context=await waitFor('HUD na janela de teste',async()=>{
            for(const ctx of contexts.get(page.session)||[]){
                if(!ctx.auxData?.isDefault&&await evaluate(page.session,'typeof fixtureStt==="object"&&!!document.querySelector("#ext-tts-stt-host")',ctx.id))return ctx.id;
            }
        });
        const view=expression=>evaluate(page.session,expression,context);
        await view('globalThis.fixtureHud=document.querySelector("#ext-tts-stt-host").shadowRoot');
        return view;
    };
    const windowContent=await viewer(otherWindow),hiddenContent=await viewer(hiddenPage);
    const setAppearance=(view,visible,minimized)=>view('chrome.runtime.sendMessage('+JSON.stringify({
        type:'HUD_GLOBAL_UI_SET',payload:{scope:'tab',visible,minimized}
    })+')');
    const appearance=view=>view(`(() => {
        const hud=fixtureHud.querySelector('.ext-hud-card');
        return {visible:!hud.classList.contains('hidden'),minimized:hud.dataset.minimized==='true',
            right:hud.style.right,bottom:hud.style.bottom};
    })()`);
    const observers=[
        {view:secondContent,visible:true,minimized:true},
        {view:windowContent,visible:true,minimized:false},
        {view:hiddenContent,visible:false,minimized:false}
    ];
    assert.equal((await setAppearance(content,false,true)).success,true);
    for(const observer of observers){
        assert.equal((await setAppearance(observer.view,observer.visible,observer.minimized)).success,true);
        observer.before=await waitFor('estado visual inicial do observador',async()=>{
            const current=await appearance(observer.view);
            return current.visible===observer.visible&&current.minimized===observer.minimized&&current;
        });
    }
    await call('Page.bringToFront',{},page.session);
    await press();
    const activeDictation = await waitFor('primeiro ditado', () => content('fixtureStt.isRecording && fixtureStt.liveJobId'));
    await waitFor('HUD aberto e expandido na origem',async()=>{
        const current=await appearance(content);
        return current.visible&&!current.minimized;
    });
    for(const observer of observers){
        await waitFor('tarefa sincronizada no observador',()=>observer.view(
            '!!fixtureHud.querySelector('+JSON.stringify('[data-job-id="'+activeDictation+'"]')+')'
        ));
        assert.deepEqual(await appearance(observer.view),observer.before);
    }
    console.log('HUD: abertura e expansão somente na origem, com outras abas e outra janela sincronizadas');
    const dictationsBefore = await sttCount();
    await click('#ext-btn-min', content);
    await waitFor('HUD minimizado na segunda aba', () => secondContent('fixtureHud.querySelector(".ext-hud-body").hidden'));
    await waitFor('minimização manual sincronizada na outra janela', () => windowContent('fixtureHud.querySelector(".ext-hud-body").hidden'));
    await call('Target.closeTarget',{targetId:hiddenPage.targetId});
    await call('Target.closeTarget',{targetId:otherWindow.targetId});
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
            await waitFor('duas sessões receberam PCM e encerraram o bloco', () => evaluate(sttSession, 'fixtureSttHeld.length === 2'));
            assert.equal(await evaluate(sttSession, 'new Set(fixtureSttHeld.map(lane => lane.account)).size'), 2);
            assert.equal(await content('fixturePreviousCapture.stream.getAudioTracks()[0].readyState'), 'ended');
            await evaluate(sttSession, 'globalThis.fixtureHoldStt = false');
            await view('document.querySelector(' + JSON.stringify(field) + ').focus()');
            await press(session);
            const second = await waitFor('segunda captura com a primeira em processamento', () => view('fixtureStt.isRecording && fixtureStt.liveJobId'));
            assert.notEqual(second, first);
            assert.equal((await job(first)).status, 'waiting');
            assert.equal(await view('fixtureHud.querySelector("#ext-capture-notice").hidden'), true);
            await evaluate(sttSession, 'fixtureSttHeld.splice(0).forEach(lane => lane.complete())');
            const previous = await status(first, 'completed');
            assert.equal(previous.text, 'Ditado de teste.');
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
    const stopFromSecondTab=async jobId=>{
        const reply=await secondContent('chrome.runtime.sendMessage('+JSON.stringify({type:'HUD_GLOBAL_COMMAND',payload:{jobId,action:'stop'}})+')');
        assert.equal(reply.success,true,reply.error);
    };
    const startEditor=async selector=>{
        await call('Page.bringToFront',{},page.session);
        await content('document.querySelector('+JSON.stringify(selector)+').focus()');
        await press();
        return waitFor('captura do editor',()=>content('fixtureStt.isRecording && fixtureStt.liveJobId'));
    };
    // Vários envios no mesmo job, com o transporte distribuído e ACKs MV3 reais.
    await content(`(() => {
        const form=document.createElement('form');form.id='continuous-composer';
        form.innerHTML='<textarea id="continuous-dictation" aria-label="Mensagem contínua"></textarea><button type="submit">Enviar mensagem</button>';
        document.body.append(form);globalThis.fixtureSentMessages=[];
        form.onsubmit=event=>{
            event.preventDefault();const field=form.querySelector('textarea');fixtureSentMessages.push(field.value);
            const next=field.cloneNode(false);next.value='';field.replaceWith(next);
            next.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
        };
        form.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}};
    })()`);
    await evaluate(worker,'chrome.storage.local.get("ui").then(value=>chrome.storage.local.set({ui:{...value.ui,dictationInsertion:"realtime"}}))');
    await waitFor('inserção contínua configurada',()=>content('fixtureStt.insertionMode==="realtime"'));
    const continuousId=await startEditor('#continuous-dictation');
    await content(`(() => {
        const capture=fixtureStt.liveCapture,handler=capture.node.port.onmessage;
        capture.node.port.onmessage=event=>{if(event.data?.type==='flushed')handler(event);};
        globalThis.fixtureContinuousTrack=capture.stream.getTracks()[0];
        globalThis.fixtureContinuousContext=capture.context;
    })()`);
    await evaluate(await offscreen(),'globalThis.fixtureNoInterim=true;globalThis.fixtureNumbered=true');
    await evaluate(await offscreen(),'globalThis.fixtureSilentHypothesis=true');
    const priorSttSetups=await evaluate(await offscreen(),'fixtureSttSetups.length');
    assert.equal(await content(`(async()=>{
        const capture=fixtureStt.liveCapture,dc=new Int16Array(1600).fill(210),impulse=new Int16Array(1600);
        impulse[0]=32767;
        for(let i=0;i<20;i++)capture.chunker.push(new Uint8Array((i%2?dc:impulse).buffer));
        for(let i=0;i<5;i++)capture.chunker.push(new Uint8Array(3200));
        await capture.audioQueue.drain();return capture.chunker.sequence;
    })()`),0,'ruído de teste não abriu bloco');
    assert.equal(await evaluate(await offscreen(),'fixtureSttSetups.length'),priorSttSetups);
    assert.equal((await job(continuousId)).text,'');
    const {windowId:continuousWindow}=await call('Browser.getWindowForTarget',{targetId:page.targetId});
    for(let sequence=1;sequence<=3;sequence++){
        if(sequence===2){
            // Cinco minutos de PCM silencioso acelerado: nenhuma expiração do destino/captura.
            await content(`(() => {const capture=fixtureStt.liveCapture;for(let i=0;i<3000;i++)capture.chunker.push(new Uint8Array(3200));})()`);
            await call('Page.bringToFront',{},secondPage.session);
            if(process.env.FALAMERMO_HEADED)await call('Browser.setWindowBounds',{windowId:continuousWindow,bounds:{windowState:'minimized'}});
            if(process.env.FALAMERMO_VERIFY_MINIMIZE){
                await waitFor('janela realmente minimizada',async()=> (await call('Browser.getWindowBounds',{windowId:continuousWindow})).bounds.windowState==='minimized');
                assert.equal(await content('document.visibilityState'),'hidden');
                console.log('Minimização nativa confirmada: windowState=minimized e documento hidden, com microfone ativo');
            }
        }
        await content(`(async()=>{
            const capture=fixtureStt.liveCapture,frame=new Uint8Array(3200);const samples=new Int16Array(frame.buffer);for(let i=0;i<samples.length;i++)samples[i]=5000*Math.sin(2*Math.PI*180*i/16000);
            for(let i=0;i<7;i++)capture.chunker.push(frame);
            capture.chunker.closeChunk('silence');capture.metrics.capturedBytes=(capture.metrics.capturedBytes||0)+frame.length*7;
            await capture.audioQueue.drain();
        })()`);
        await waitFor('nova fala após envio '+sequence,async()=>{
            const current=await job(continuousId);
            return current.text.includes('Bloco '+sequence+'.')&&current.insertion?.revision===current.textRevision&&current.insertion.inserted;
        });
        assert.equal(await content('document.querySelector("#continuous-dictation").value'),'Bloco '+sequence+'.');
        assert.equal(await content('fixtureStt.liveJobId'),continuousId);
        assert.equal(await content('fixtureStt.liveCapture.stream.getTracks()[0]===fixtureContinuousTrack&&fixtureContinuousTrack.readyState==="live"&&fixtureStt.liveCapture.context===fixtureContinuousContext'),true);
        assert.deepEqual((await job(continuousId)).textBoundaries,Array.from({length:sequence},(_,i)=>[i+1,(i+1)*9-1]));
        if(sequence===2){
            if(process.env.FALAMERMO_HEADED)await call('Browser.setWindowBounds',{windowId:continuousWindow,bounds:{windowState:'normal'}});
            await call('Page.bringToFront',{},page.session);
            await content('document.querySelector("#continuous-dictation").focus()');
            await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},page.session);
            await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},page.session);
        }else await content('document.querySelector("#continuous-composer button").click()');
        // PCM injetado pelo teste só pode avançar depois do ACK de flush do worklet.
        await waitFor('segmento enviado '+sequence,()=>content('document.querySelector("#continuous-dictation").value===""&&fixtureStt.liveJobs.get('+JSON.stringify(continuousId)+').insertion.sentSegments==='+sequence+'&&!fixtureStt.liveCapture.segmentCut'));
        assert.equal(await content('fixtureStt.liveJobs.get('+JSON.stringify(continuousId)+').insertion.consumedSequence'),sequence);
    }
    assert.ok(await evaluate(await offscreen(),'fixtureSockets.some(socket=>socket.fixtureSilentReply)'));
    await evaluate(await offscreen(),'globalThis.fixtureNoInterim=false;globalThis.fixtureSilentHypothesis=false');
    console.log('STT: DC e impulsos não abriram sessões; hipótese e confirmação ¿Qué? no pre-roll não chegaram ao card/campo');
    await content(`(async()=>{
        const capture=fixtureStt.liveCapture,frame=new Uint8Array(3200);const samples=new Int16Array(frame.buffer);for(let i=0;i<samples.length;i++)samples[i]=5000*Math.sin(2*Math.PI*180*i/16000);
        for(let i=0;i<7;i++)capture.chunker.push(frame);await capture.audioQueue.drain();
    })()`);
    await waitFor('provisório editável do quarto bloco',()=>content('document.querySelector("#continuous-dictation").value==="Bloco 4"'));
    await call('Page.bringToFront',{},page.session);
    await content('(()=>{const field=document.querySelector("#continuous-dictation");field.focus();field.setSelectionRange(field.value.length,field.value.length);})()');
    await call('Input.insertText',{text:' MEU'},page.session);
    await waitFor('corte PCM após edição manual',async()=> (await job(continuousId)).text.includes('Bloco 4.')&&await content('!fixtureStt.liveCapture.segmentCut'));
    assert.equal(await content('document.querySelector("#continuous-dictation").value'),'Bloco 4 MEU');
    await content(`(async()=>{
        const capture=fixtureStt.liveCapture,frame=new Uint8Array(3200);const samples=new Int16Array(frame.buffer);for(let i=0;i<samples.length;i++)samples[i]=5000*Math.sin(2*Math.PI*180*i/16000);
        for(let i=0;i<7;i++)capture.chunker.push(frame);capture.chunker.closeChunk('silence');await capture.audioQueue.drain();
    })()`);
    await waitFor('fala seguinte à edição manual',()=>content('document.querySelector("#continuous-dictation").value==="Bloco 4 MEU Bloco 5."'));
    assert.equal(await content('fixtureStt.liveCapture.stream.getTracks()[0]===fixtureContinuousTrack&&fixtureContinuousTrack.readyState==="live"'),true);
    await content('document.querySelector("#continuous-composer button").click()');
    await waitFor('quarto envio após edição manual',()=>content('fixtureStt.liveJobs.get('+JSON.stringify(continuousId)+').insertion.sentSegments===4&&!fixtureStt.liveCapture.segmentCut'));
    await stopFromSecondTab(continuousId);
    const completedContinuous=await status(continuousId,'completed');
    assert.equal(completedContinuous.text,'Bloco 1. Bloco 2. Bloco 3. Bloco 4. Bloco 5.');
    assert.equal(completedContinuous.insertion.inserted,true);
    assert.equal(await content('document.querySelector("#continuous-dictation").value'),'');
    assert.deepEqual(await content('fixtureSentMessages'),['Bloco 1.','Bloco 2.','Bloco 3.','Bloco 4 MEU Bloco 5.']);
    assert.equal(await content('fixtureContinuousTrack.readyState'), 'ended');
    await content('document.querySelector("#continuous-composer").remove()');
    console.log('STT contínuo MV3: quatro envios no mesmo microfone/contexto/job, edição manual sobre provisório e fala seguinte, editor recriado, Enter, segundo plano, outra aba, pausa PCM de 5 min acelerada e final sem replay');

    const latencies=[];
    for(const adaptive of [false,true]){
        await content('document.querySelector("#next-dictation").value = ""');
        const id=await startEditor('#next-dictation');
        await content('fixtureStt.liveCapture.chunker.adaptive = '+adaptive);
        await evaluate(await offscreen(),'globalThis.fixtureNoInterim=true;globalThis.fixtureNumbered=false');
        await call('Page.bringToFront',{},secondPage.session);
        await waitFor('origem oculta com AudioWorklet do microfone ativo',()=>content('document.visibilityState==="hidden"'));
        await waitFor('primeiro bloco contínuo confirmado',async()=> (await job(id)).insertion?.inserted===true &&
            (await job(id)).text==='Ditado de teste.',18000);
        const result=await waitFor('medição do bloco confirmado',async()=>{
            const measurements=await evaluate(worker,'chrome.storage.session.get("liveSttDiagnosticsV1")');
            return measurements.liveSttDiagnosticsV1?.jobs.find(item=>item.jobId===id)?.events.find(
                event=>event.stage==='inserted'&&event.whileRecording&&!event.provisional&&event.sequence===1);
        });
        latencies.push(result.editorReceivedMs+result.insertionDurationMs);
        assert.equal(await content('fixtureStt.isRecording'),true);
        await stopFromSecondTab(id);
        await status(id,'completed');
    }
    assert.ok(latencies[1]+3000<latencies[0],JSON.stringify(latencies));
    console.log('Latência no Chrome, captura até primeiro texto sem evento provisório (ms): '+latencies.join(' → '));

    await evaluate(worker,`(() => {
        const send=chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage=async (tab,message,...args)=>{
            if(!message.editorDelivery||message.payload.jobId!==globalThis.fixtureLossJob)return send(tab,message,...args);
            if(message.payload.event!=='stt-final'&&!globalThis.fixtureDroppedProgress++){
                throw Error('Entrega progressiva perdida no teste');
            }
            const result=await send(tab,message,...args);
            if(message.payload.event==='stt-final'&&!globalThis.fixtureDroppedAck++)throw Error('ACK final perdido no teste');
            return result;
        };
    })()`);
    for(const seconds of [30,60,180]){
        await content(`(() => {
            const field=document.querySelector('#next-dictation');
            field.value='Antes | depois';field.setSelectionRange(6,6);
            globalThis.fixtureFocusChanges=0;
            field.onfocus=()=>fixtureFocusChanges++;
        })()`);
        const id=await startEditor('#next-dictation');
        await content(`(() => {
            globalThis.fixtureFocusChanges=0;
            const capture=fixtureStt.liveCapture, handler=capture.node.port.onmessage;
            capture.node.port.onmessage=event=>{if(event.data?.type==='flushed')handler(event);};
            const viewer=document.querySelector('textarea');viewer.focus();viewer.setSelectionRange(0,2);
        })()`);
        await evaluate(await offscreen(),'globalThis.fixtureNoInterim=true;globalThis.fixtureNumbered=true');
        await evaluate(worker,`globalThis.fixtureLossJob=${JSON.stringify(id)};globalThis.fixtureDroppedProgress=0;globalThis.fixtureDroppedAck=0`);
        await call('Page.bringToFront',{},secondPage.session);
        await secondContent('document.querySelector("textarea").focus();document.querySelector("textarea").value="Campo da outra aba"');
        await waitFor('aba de origem em segundo plano',()=>content('document.visibilityState==="hidden"'));
        let blocks=0,checkpoint;
        for(let sent=0;sent<seconds*10;){
            const count=Math.min(53,sent===0?53:70,seconds*10-sent);
            blocks=await content(`(async () => {
                const capture=fixtureStt.liveCapture, frame=new Uint8Array(3200);
                const samples=new Int16Array(frame.buffer);for(let i=0;i<samples.length;i++)samples[i]=5000*Math.sin(2*Math.PI*180*i/16000);
                for(let i=0;i<${count};i++)capture.chunker.push(frame);
                capture.metrics.capturedBytes=(capture.metrics.capturedBytes||0)+frame.length*${count};
                await capture.audioQueue.drain();
                return capture.chunker.sequence-Number(Boolean(capture.chunker.chunk));
            })()`);
            sent+=count;
            if(blocks)await waitFor('bloco confirmado com origem oculta',async()=>{
                const current=await job(id);
                return current.text.includes('Bloco '+blocks+'.')&&current.insertion?.revision===current.textRevision;
            });
            if(blocks===1&&!checkpoint)checkpoint=await content('document.querySelector("#next-dictation").value');
        }
        const previous=await job(id);
        assert.ok(previous.insertion.inserted&&previous.text.includes('Bloco 1.'));
        assert.equal(await content('fixtureFocusChanges'),0);
        assert.equal(await secondContent('document.querySelector("textarea").value'),'Campo da outra aba');
        // The framework rolls the field back to its checkpoint without a user edit.
        await content('document.querySelector("#next-dictation").value='+JSON.stringify(seconds===60?checkpoint:'Antes | depois'));
        await stopFromSecondTab(id);
        const final=await status(id,'completed');
        assert.equal(final.insertion.revision,final.textRevision);
        assert.equal(final.insertion.final,true);
        assert.equal(final.insertion.inserted,true);
        assert.equal(await content('document.querySelector("#next-dictation").value'),'Antes '+final.text+'| depois');
        assert.equal(await content('fixtureFocusChanges'),0);
        assert.ok(await evaluate(worker,'fixtureDroppedAck>=2'));
        assert.deepEqual(final.text.match(/Bloco \d+\./g),Array.from({length:final.text.match(/Bloco \d+\./g).length},(_,i)=>'Bloco '+(i+1)+'.'));
        console.log('STT '+seconds+' s de PCM contínuo acelerado: inserção em segundo plano, Stop remoto, reconciliação e ACK repetido');
    }
    await call('Page.bringToFront',{},page.session);
    await content(`(() => {
        const input=document.createElement('input');
        input.id='dictation-input';input.value='Antes | depois';document.body.append(input);
        input.focus();input.setSelectionRange(6,6);
        globalThis.fixtureInput=new DictationRuntime.Insertion(DictationRuntime.captureTarget());
        document.querySelector('textarea').focus();
    })()`);
    assert.equal((await content('fixtureInput.apply("texto")')).inserted,true);
    await content('document.querySelector("#dictation-input").focus();document.querySelector("#dictation-input").setSelectionRange(0,0)');
    await call('Input.insertText',{text:'Manual '},page.session);
    await content('document.querySelector("textarea").focus()');
    assert.equal((await content('fixtureInput.apply("texto revisado")')).inserted,true);
    assert.equal(await content('document.querySelector("#dictation-input").value'),'Manual Antes texto revisado| depois');
    await content('document.querySelector("#dictation-input").focus();document.querySelector("#dictation-input").setSelectionRange(15,19)');
    await call('Input.insertText',{text:'edição'},page.session);
    const edited=await content('document.querySelector("#dictation-input").value');
    assert.equal((await content('fixtureInput.apply("outro texto",{final:true})')).reason,'TARGET_CHANGED');
    assert.equal(await content('document.querySelector("#dictation-input").value'),edited);
    await content('fixtureInput.dispose()');
    await content(`(() => {
        const editor=document.createElement('div');editor.contentEditable='true';
        editor.innerHTML='<p><strong>Antes </strong><em>seleção</em> depois</p>';document.body.append(editor);
        editor.focus();
        const range=document.createRange();range.selectNodeContents(editor.querySelector('em'));
        getSelection().removeAllRanges();getSelection().addRange(range);
        globalThis.fixtureRich=new DictationRuntime.Insertion(DictationRuntime.captureTarget());
        globalThis.fixtureRichField=editor;
        const outside=document.createElement('p');outside.textContent='Selecionado fora';document.body.append(outside);
        const selected=document.createRange();selected.selectNodeContents(outside);
        getSelection().removeAllRanges();getSelection().addRange(selected);
    })()`);
    assert.equal((await content('fixtureRich.apply('+JSON.stringify('primeira linha\nsegunda pro')+')')).inserted,true);
    assert.equal((await content('fixtureRich.apply('+JSON.stringify('primeira linha\nsegunda linha')+',{final:true})')).inserted,true);
    assert.equal(await content('fixtureRichField.querySelector("strong").textContent'),'Antes ');
    assert.equal(await content('fixtureRichField.querySelector("em").innerText'),'primeira linha\nsegunda linha');
    assert.equal(await content('getSelection().toString()'),'Selecionado fora');
    await content('fixtureRich.dispose()');
    console.log('Editores nativos: input conserva edição externa, protege conflito e contenteditable mantém seleção e formatação');

    await evaluate(page.session,`(() => {
        const editor=document.createElement('div');
        editor.id='normalizing-editor';editor.contentEditable='true';
        editor.innerHTML='<p><strong>Antes </strong>Meio [seleção] depois</p>';
        editor.addEventListener('input',()=>editor.normalize());
        document.body.append(editor);
        editor.focus();
        const range=document.createRange(),node=editor.querySelector('p').lastChild;
        range.setStart(node,5);range.setEnd(node,14);
        getSelection().removeAllRanges();getSelection().addRange(range);
    })()`);
    await content('globalThis.fixtureNormalized=new DictationRuntime.Insertion(DictationRuntime.captureTarget())');
    const normalizedFirst=await content('fixtureNormalized.apply("Primeiro.")');
    const normalizedFinal=await content('fixtureNormalized.apply("Primeiro.\\nSegundo.",{final:true})');
    assert.deepEqual({
        first:normalizedFirst.inserted,final:normalizedFinal.inserted,
        prefix:await content('document.querySelector("#normalizing-editor strong").textContent'),
        text:await content('document.querySelector("#normalizing-editor p").innerText')
    },{first:true,final:true,prefix:'Antes ',text:'Antes Meio Primeiro.\nSegundo. depois'});
    await content('fixtureNormalized.dispose()');
    console.log('Contenteditable confirma e atualiza o intervalo mesmo após normalização dos nós pelo site');

    for(const changed of [false,true]){
        await evaluate(page.session,`(() => {
            const editor=document.createElement('div');
            editor.contentEditable='true';editor.id='rewritten-editor';
            editor.innerHTML='<p><strong>Antes </strong>[seleção] depois</p>';
            document.body.append(editor);editor.focus();
            const range=document.createRange(),node=editor.querySelector('p').lastChild;
            range.setStart(node,0);range.setEnd(node,9);
            getSelection().removeAllRanges();getSelection().addRange(range);
            // O site aceita o texto e recria os descendentes do mesmo editor.
            editor.addEventListener('input',()=>queueMicrotask(()=>{editor.innerHTML=editor.innerHTML;}));
        })()`);
        await content('globalThis.fixtureRewritten=new DictationRuntime.Insertion(DictationRuntime.captureTarget())');
        const first=await content(`(async () => {
            const editorTrace={};
            const result=await fixtureRewritten.apply('Primeiro.',{editorTrace});
            return {result,after:editorTrace.after};
        })()`);
        assert.equal(first.result.inserted,true,first.result.reason);
        assert.equal(first.after.rebinds,1);
        assert.equal(first.after.focused,true);
        assert.equal((await content('fixtureRewritten.apply("Primeiro. Segundo.")')).inserted,true);
        if(changed)await evaluate(page.session,`(() => {
            const editor=document.querySelector('#rewritten-editor');
            editor.querySelector('strong').textContent='Texto do site ';
            editor.innerHTML=editor.innerHTML;
        })()`);
        const final=await content('fixtureRewritten.apply("Primeiro. Segundo. Terceiro.",{final:true})');
        assert.equal(final.inserted,!changed,final.reason);
        if(changed)assert.equal(final.reason,'TARGET_CHANGED');
        assert.equal(await content('document.querySelector("#rewritten-editor").textContent'),
            changed?'Texto do site Primeiro. Segundo. depois':'Antes Primeiro. Segundo. Terceiro. depois');
        assert.equal(await content('document.activeElement.id'),'rewritten-editor');
        await content('fixtureRewritten.target.element.remove();fixtureRewritten.dispose()');
    }
    console.log('Contenteditable reancora texto idêntico em nós recriados e preserva uma alteração concorrente');

    for(const mode of ['final','realtime']){
        await evaluate(worker,'chrome.storage.local.set({ui:{dictationInsertion:'+JSON.stringify(mode)+'}})');
        await waitFor(mode,()=>content('fixtureStt.insertionMode==='+JSON.stringify(mode)));
        await evaluate(page.session,`(() => {
            const field=document.querySelector('#next-dictation'),original='Antes [seleção] depois';
            field.value=original;field.setSelectionRange(6,15);
            globalThis.fixtureRestores=0;
            field.addEventListener('change',()=>setTimeout(()=>{
                field.value=original;
                fixtureRestores++;
            },0),{once:true});
        })()`);
        const id=await startEditor('#next-dictation');
        await waitFor('PCM para o editor controlado',()=>content('fixtureStt.liveCapture?.metrics?.forwardedBytes>0'));
        if(mode==='realtime'){
            await content('fixtureStt.liveCapture.chunker.closeChunk("silence")');
            await waitFor('inserção progressiva no editor controlado',async()=>(await job(id)).insertion?.inserted===true);
        }
        await press();
        const result=await status(id,'completed');
        assert.ok(result.text);
        assert.equal(await evaluate(page.session,'fixtureRestores'),1);
        assert.equal(result.insertion.inserted,true,result.insertion.reason);
        assert.equal(result.insertion.final,true);
        assert.equal(result.insertion.revision,result.textRevision);
        assert.equal(await content('document.querySelector("#next-dictation").value'),'Antes '+result.text+' depois');
        const rendered=await waitFor('card com revisão final renderizada',()=>content(`(() => {
            const node=fixtureHud.querySelector('[data-job-id="${id}"]');
            if(node?.querySelector('.fm-global-status').textContent!=='Concluído')return;
            return {text:node.querySelector('.fm-global-text').textContent,note:node.querySelector('.fm-global-note').textContent};
        })()`));
        assert.equal(rendered.text,result.text);
        assert.doesNotMatch(rendered.note,/Inserção não confirmada/);
        console.log('STT '+mode+': card e campo confirmam a revisão final após render que restaurou o valor original');
    }

    const removed=await startEditor('#next-dictation');
    await waitFor('PCM para o destino removido',()=>content('fixtureStt.liveCapture?.metrics?.forwardedBytes>0'));
    await content('document.querySelector("#next-dictation").remove()');
    await press();
    const removedResult=await status(removed,'completed');
    assert.equal(removedResult.insertion.reason,'TARGET_REMOVED');
    assert.ok(removedResult.text);

    const navigated=await target('http://127.0.0.1:'+server.address().port+'/before-navigation');
    const navigationContext=await waitFor('content script antes da navegação',async()=>{
        for(const context of contexts.get(navigated.session)||[]){
            if(!context.auxData?.isDefault&&await evaluate(navigated.session,'typeof fixtureStt==="object"',context.id))return context.id;
        }
    });
    const navigationEval=expression=>evaluate(navigated.session,expression,navigationContext);
    await navigationEval('document.querySelector("textarea").focus();fixtureStt.toggleRecording()');
    const lost=await waitFor('captura em aba descartável',()=>navigationEval('fixtureStt.isRecording&&fixtureStt.liveJobId'));
    await waitFor('PCM persistido antes da navegação',()=>navigationEval('fixtureStt.liveCapture?.metrics?.ackBytes>0'));
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/after-navigation'},navigated.session);
    const lostResult=await status(lost,'completed');
    assert.equal(lostResult.originAvailable,false);
    assert.equal(lostResult.insertion.reason,'ORIGIN_LOST');
    assert.ok(lostResult.text);
    assert.equal(await evaluate(navigated.session,'document.querySelector("textarea").value'),'');
    await call('Target.closeTarget',{targetId:navigated.targetId});
    console.log('Remoção e navegação real preservam o texto no card sem redirecionar a inserção');
    await evaluate(worker, 'chrome.storage.local.set({api:{apiKeys:["fixture-local"]},sttVadDetector:"rms"})');

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

    async function create(text) {
        const result = await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_CREATE"})');
        assert.equal(result.success, true, result.error);
        const id = result.state.activeTaskId;
        await act(id, 'edit', {text});
        return id;
    }
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

    if(process.env.FALAMERMO_HEADED)popup=await target(base+'popup.html');
    await testPanic(secondContent);
    await testTtsVoices();

    async function testTtsVoices(){
        await waitFor('documento anterior encerrado',async()=>!await locate(base+'offscreen.html'));
        await waitFor('agentes das Opções carregados',()=>optionsEval('!!currentAgent'));
        const custom = await optionsEval(`(() => {
            const agent=structuredClone(getAgent('narrator'));
            agent.metadata={...agent.metadata,id:'audit-voice',name:'Voz de teste',isBuiltIn:false};
            agent.voice.preferredVoice='Puck';
            agent.live={...agent.live,voiceName:'Kore',jsonMode:'panel'};
            return agent;
        })()`);
        const original=(await evaluate(worker,'chrome.storage.local.get("agents")')).agents;
        await evaluate(worker,'chrome.storage.local.set('+JSON.stringify({agents:{...original,customAgents:[...original.customAgents,custom]}})+')');
        const hudAgent='.fm-global-agent-row select';
        const selectAgent = (view,selector,id) => view(`(() => {
            const select=(globalThis.fixtureHud||document).querySelector(${JSON.stringify(selector)});
            select.value=${JSON.stringify(id)};
            select.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        await waitFor('agente personalizado no HUD',()=>content(`!!fixtureHud.querySelector('${hudAgent} option[value="audit-voice"]')`));
        await selectAgent(content,hudAgent,'audit-voice');
        await waitFor('agente do HUD sincronizado',async()=>await content('fixtureActiveAgent()')==='audit-voice'&&
            await popupEval('document.querySelector("#agent").value')==='audit-voice');
        assert.match(await popupEval('document.querySelector("#agent").selectedOptions[0].textContent'),/Kore$/);
        await call('Page.bringToFront',{},page.session);
        const text='Seleção para auditar a voz do HUD.';
        await content(`(() => {
            const field=document.querySelector('textarea');
            field.value=${JSON.stringify(text)};
            field.focus();
            field.select();
        })()`);
        for(const type of ['rawKeyDown','keyUp']){
            await call('Input.dispatchKeyEvent',{type,key:'b',code:'KeyB',windowsVirtualKeyCode:66,modifiers:2},page.session);
        }
        const reading=await waitFor('narração do atalho',async()=> (await state()).jobs.find(item=>item.text===text));
        assert.equal(reading.agentId,'audit-voice');
        const audio=await offscreen(),audioEval=expression=>evaluate(audio,expression);
        const wireVoice=index=>audioEval(`fixtureTurns[${index}]?.fixtureSetup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`);
        await waitFor('setup Live do HUD',()=>wireVoice(0));
        assert.equal(await wireVoice(0),'Kore');
        await audioEval('fixtureTurns[0].receive(fixturePcm(30))');
        await status(reading.jobId,'playing');
        await act(reading.jobId,'maximize');
        const task=await waitFor('janela individual',()=>locate(base+'task.html?jobId='+reading.jobId));
        const taskSession=await attach(task.targetId);
        const taskEval=expression=>evaluate(taskSession,expression);
        await waitFor('card na janela individual',()=>taskEval(`document.querySelectorAll('.fm-global-card').length===1`));
        await volume(`[data-job-id="${reading.jobId}"] [data-card-control="volume"]`,'.35',taskEval);
        await volume('[data-control="playbackRate"]','1.4',popupEval);
        const adjusted=async()=>{
            const progress=(await job(reading.jobId)).progress;
            return progress.volume===.35&&progress.playbackRate===1.4;
        };
        await waitFor('volume e velocidade do card',adjusted);
        await selectAgent(popupEval,'#agent','translator');
        await waitFor('agente do popup sincronizado no HUD',async()=>await content('fixtureActiveAgent()')==='translator'&&
            await content(`fixtureHud.querySelector('${hudAgent}').value`)==='translator');
        await click(card(reading.jobId,'playPause'),taskEval);
        const paused=await status(reading.jobId,'paused');
        assert.equal(await adjusted(),true,'trocar agente não redefine controles da narração aberta');
        await waitFor('pausa vista no popup',()=>popupEval(`document.querySelector(${JSON.stringify(card(reading.jobId,'playPause'))}).title==='Retomar esta tarefa'`));
        await click(card(reading.jobId,'playPause'),popupEval);
        const resumed=await status(reading.jobId,'playing');
        assert.ok(resumed.progress.currentTime>=paused.progress.currentTime);
        assert.equal(await audioEval('fixtureTurns.length'),1);
        const fromPopup=await create('Narração da voz escolhida no popup.');
        await act(fromPopup,'play');
        assert.equal(await waitFor('setup da voz do popup',()=>wireVoice(1)),'Charon');
        await audioEval("fixtureTurns[1].receive({...fixturePcm(.25),turnComplete:true,interactionStatus:'IDLE'})");
        await status(fromPopup,'completed');
        await status(reading.jobId,'paused');
        await click(card(reading.jobId,'stop'),taskEval);
        await status(reading.jobId,'cancelled');
        assert.equal((await job(reading.jobId)).text,text);
        await call('Target.closeTarget',{targetId:task.targetId});
        await waitFor('cache e documento liberados após a última narração',async()=>!await locate(base+'offscreen.html'));

        await selectAgent(optionsEval,'#agentSelect','audit-voice');
        await click('[data-open-mode="tts"]',optionsEval);
        await optionsEval(`(() => {
            const voice=document.querySelector('#liveVoice');
            voice.value='Zephyr';
            voice.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
        await click('#saveAgent',optionsEval);
        await waitFor('voz salva no agente',()=>evaluate(worker,`chrome.storage.local.get('agents').then(({agents})=>{
            const agent=agents.customAgents.find(item=>item.metadata.id==='audit-voice');
            return agent.live.voiceName==='Zephyr'&&agent.voice.preferredVoice==='Zephyr';
        })`));
        await waitFor('voz das Opções refletida no popup',()=>popupEval('document.querySelector("#agent").selectedOptions[0]?.textContent.endsWith("Zephyr")'));
        await click('#liveTest',optionsEval);
        const previewDoc=await offscreen();
        const setup=await waitFor('setup da prévia das Opções',()=>evaluate(previewDoc,'fixtureTurns.at(-1)?.fixtureSetup'));
        assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Zephyr');
        await click('#liveStop',optionsEval);
        await waitFor('prévia parada',()=>optionsEval('livePreview===null'));
        await evaluate(worker,'chrome.storage.local.set('+JSON.stringify({agents:original})+')');
        console.log('TTS no Chrome: voz efetiva do HUD, popup e Opções; volume, velocidade, Pause e Resume sincronizados com a janela individual');
    }

    async function testPanic(secondContent){
        await evaluate(worker,'chrome.storage.local.set({api:{apiKeys:["fixture-local"]},sttVadDetector:"rms"})');
        const paused=await create('Áudio pausado durante o pânico');
        const speaking=await create('Áudio que o pânico interrompe');
        const synthesizing=await create('Síntese pendente durante o pânico');
        await act(paused,'play');
        const audio=await offscreen();
        const turns=()=>evaluate(audio,'fixtureTurns.length');
        const send=(index,expression)=>evaluate(audio,'fixtureTurns['+index+'].receive('+expression+')');
        let expectedTurns=await waitFor('turno para preparar pausa',turns);
        await send(expectedTurns-1,'fixturePcm(20)');
        await status(paused,'playing');
        await act(paused,'pause');
        await status(paused,'paused');
        await act(speaking,'play');
        await waitFor('turno da narração ativa',async()=>await turns()===expectedTurns+1);
        await send(expectedTurns++,'fixturePcm(20)');
        await status(speaking,'playing');
        await act(synthesizing,'play');
        await waitFor('síntese ainda sem áudio',async()=>await turns()===expectedTurns+1);
        expectedTurns++;
        await status(synthesizing,'connecting');
        await status(paused,'paused');

        await evaluate(worker,'chrome.storage.local.set({ui:{dictationInsertion:"final"}})');
        await waitFor('ditado convencional',()=>content('fixtureStt.insertionMode==="final"'));
        await content('document.querySelector("textarea").focus();fixtureStt.startLiveRecording("editor")');
        const agentJob=await waitFor('captura para agente',()=>content('fixtureStt.isRecording&&fixtureStt.liveJobId'));
        await waitFor('PCM para agente',()=>content('fixtureStt.liveCapture?.metrics?.forwardedBytes>0'));
        await content('fixtureStt.stopLiveRecording()');
        await status(agentJob,'transforming');
        await waitFor('agente aguardando resposta',async()=>await turns()===expectedTurns+1);

        await evaluate(audio,'globalThis.fixtureHoldStt=true');
        await content('document.querySelector("textarea").focus();fixtureStt.startLiveRecording("narrator")');
        const waiting=await waitFor('captura anterior a Stop',()=>content('fixtureStt.isRecording&&fixtureStt.liveJobId'));
        await waitFor('PCM recuperável do ditado',()=>content('fixtureStt.liveCapture?.metrics?.forwardedBytes>0'));
        await content('globalThis.fixturePanicWaitingTrack=fixtureStt.liveCapture.stream.getTracks()[0];fixtureStt.stopLiveRecording()');
        await status(waiting,'waiting');
        assert.equal(await content('fixturePanicWaitingTrack.readyState'),'ended');
        await secondContent('document.querySelector("textarea").focus();fixtureStt.startLiveRecording("narrator")');
        const recording=await waitFor('microfone em outra aba',()=>secondContent('fixtureStt.isRecording&&fixtureStt.liveJobId'));
        await waitFor('PCM na outra aba',()=>secondContent('fixtureStt.liveCapture?.metrics?.forwardedBytes>0'));
        await secondContent('globalThis.fixturePanicTrack=fixtureStt.liveCapture.stream.getTracks()[0];document.querySelector("textarea").value="Edição manual preservada"');
        options=await target(base+'options.html');
        await waitFor('recuperação STT disponível',()=>optionsEval('typeof SttRealtime!=="undefined"'));
        const pcmBefore=await optionsEval('SttRealtime.recovery.wave('+JSON.stringify(waiting)+').then(result=>result.bytes)');
        const historyBefore=await evaluate(worker,'chrome.storage.local.get("history").then(result=>result.history)');
        await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_UI_SET",payload:{scope:"tab",visible:true,minimized:true}})');
        const panic='[data-action="panic"]';
        assert.equal(await content(`fixtureHud.querySelector('${panic}').title`),'Parar todas as operações');
        assert.equal(await content(`fixtureHud.querySelector('${panic}').getBoundingClientRect().height>0`),true);
        assert.equal(await popupEval(`document.querySelector('${panic}').getBoundingClientRect().height>0`),true);
        const previousTurns=await turns();
        await evaluate(audio,'globalThis.fixtureHoldPanic=true;globalThis.fixturePanicContexts=[...fixtureJobs.values()].map(job=>job.player.ctx)');
        await Promise.all([click(panic,content),click(panic,popupEval)]);
        await waitFor('encerramento visível no HUD minimizado',()=>content(`fixtureHud.querySelector('${panic}').getAttribute('aria-busy')==='true'`));
        await waitFor('offscreen confirmou limpeza',()=>evaluate(audio,'typeof fixtureReleasePanic==="function"'));
        assert.equal(await evaluate(audio,'fixturePanicContexts.every(context=>context.state==="closed")'),true);
        assert.equal(await evaluate(audio,'fixtureSockets.every(socket=>socket.readyState===3)'),true);
        assert.equal(await turns(),previousTurns);
        assert.equal(await secondContent('fixturePanicTrack.readyState'),'ended');
        await evaluate(audio,'fixtureReleasePanic()');
        for(const id of [paused,speaking,synthesizing,agentJob,waiting,recording])await status(id,'cancelled');
        await waitFor('offscreen encerrado pelo pânico',async()=>!await locate(base+'offscreen.html'));
        assert.equal(await secondContent('fixturePanicTrack.readyState'),'ended');
        assert.equal(await secondContent('fixtureStt.liveCapture'),null);
        assert.equal(await secondContent('document.querySelector("textarea").value'),'Edição manual preservada');
        assert.equal(await optionsEval('SttRealtime.recovery.wave('+JSON.stringify(waiting)+').then(result=>result.bytes)'),pcmBefore);
        assert.deepEqual(await evaluate(worker,'chrome.storage.local.get("history").then(result=>result.history)'),historyBefore);
        assert.equal((await job(speaking)).text,'Áudio que o pânico interrompe');

        const newNarration=await create('Narração após o pânico');
        await act(newNarration,'play');
        const nextAudio=await offscreen();
        const late=await evaluate(nextAudio,'chrome.runtime.sendMessage('+JSON.stringify({
            type:'LIVE_OFFSCREEN_EVENT',target:'background',payload:{jobId:waiting,event:'stt-final',eventSeq:999999,text:'Resultado tardio'}
        })+')');
        assert.equal(late.ignored,true);
        assert.notEqual((await job(waiting)).text,'Resultado tardio');
        await waitFor('nova síntese após o pânico',()=>evaluate(nextAudio,'fixtureTurns.length===1'));
        await evaluate(nextAudio,'fixtureTurns[0].receive(fixturePcm(4))');
        await status(newNarration,'playing');
        await secondContent('document.querySelector("textarea").focus();fixtureStt.startLiveRecording("narrator")');
        const newDictation=await waitFor('nova captura após o pânico',()=>secondContent('fixtureStt.isRecording&&fixtureStt.liveJobId'));
        await waitFor('PCM no novo ditado',()=>secondContent('fixtureStt.liveCapture?.metrics?.forwardedBytes>0'));
        await secondContent('fixtureStt.stopLiveRecording()');
        await status(newDictation,'completed');
        await click(panic,popupEval);
        await status(newNarration,'cancelled');
        await optionsEval('toggleLiveSttTest()');
        const optionsCapture=await waitFor('microfone das Opções',()=>optionsEval('liveMic&&!liveMic.starting&&liveMic.jobId'));
        await optionsEval('globalThis.fixtureOptionsTrack=liveMic.stream.getTracks()[0]');
        await click(panic,popupEval);
        await status(optionsCapture,'cancelled');
        assert.equal(await optionsEval('fixtureOptionsTrack.readyState'),'ended');
        console.log('Parar tudo: HUD minimizado e popup, gravação e processamento STT, agente, três estados TTS, PCM, histórico e novas operações');
    }
})().catch(error => {
    console.error(error.stack || error);
    console.error('Log do Chrome em ' + temp);
    process.exitCode = 1;
}).finally(async () => {
    server.close();
    if (chrome) {
        const exited=chrome.exitCode===null&&chrome.signalCode===null?new Promise(resolve=>chrome.once('exit',resolve)):Promise.resolve();
        try { await call('Browser.close'); } catch { chrome.kill(); }
        await exited;
    }
    if (!process.exitCode) fs.rmSync(temp, {recursive: true, force: true});
});
