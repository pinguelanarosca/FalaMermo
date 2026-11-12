'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const go = fs.readFileSync(path.join(__dirname,'vad-go-sintetico.pcm'));

module.exports = async ({call,worker,content,evaluate,waitFor,offscreen,locate,base,status,job,page,click,target}) => {
    const results = {};
    if(process.env.FALAMERMO_VAD_MANUAL_PAGE){
        await target(base+'options.html');
        await call('Page.bringToFront',{},page.session);
    }
    const save=()=>{if(process.env.FALAMERMO_VAD_JSON)fs.writeFileSync(process.env.FALAMERMO_VAD_JSON,JSON.stringify(results,null,2)+'\n');};
    const fromWorker = expr => evaluate(worker,expr);
    await fromWorker('globalThis.fixtureVadKeepOffscreen=true;chrome.storage.local.set({api:{apiKeys:["fixture-a","fixture-b","fixture-c","fixture-d"]}})');
    await content(`(() => {
        globalThis.fixtureVadInput=true;
        const controller=fixtureStt;
        const send=controller.sendLiveMessage.bind(controller);
        controller.sendLiveMessage=async message=>{
            const hook=globalThis.fixtureVadHook;
            return hook ? hook(message,send) : send(message);
        };
        const resample=controller.resamplePcm16.bind(controller);
        controller.resamplePcm16=(...args)=>{
            const pcm=resample(...args);
            globalThis.fixtureCanonical?.push(pcm);
            return pcm;
        };
        globalThis.fixtureInject=async (b64, count, drain=true, final=false)=>{
            const capture=controller.liveCapture;
            const pcm=Uint8Array.from(atob(b64),s=>s.charCodeAt(0));
            const samples=new Int16Array(pcm.buffer);
            const rate=capture.context.sampleRate;
            for(let j=0;j<count;j++){
                const started=performance.now();
                const input=new Float32Array(Math.round(samples.length*rate/16000));
                for(let i=0;i<input.length;i++)input[i]=samples[Math.min(samples.length-1,Math.floor(i*16000/rate))]/32768;
                capture.fixtureHandler({data:final?{type:'vad-final-pcm',pcm:input.buffer}:input.buffer});
                if(drain&&capture.vad)await capture.vad.barrier(()=>{});
                (capture.fixtureLocal??=[]).push(performance.now()-started);
                if(drain&&capture.metrics.pendingChunks)await capture.audioQueue.drain();
                if(globalThis.fixturePaced)await new Promise(resolve=>setTimeout(resolve,Math.max(0,100-performance.now()+started)));
            }
        };
    })()`);
    const zero = Buffer.alloc(3200);
    const fixtures = Array.from({length:Math.ceil(go.length/3200)}, (_,i)=>{
        const pcm=Buffer.alloc(3200);
        go.copy(pcm,0,i*3200,(i+1)*3200);
        return pcm;
    });
    const inject = (pcm,count=1,drain=true,final=false) => content(`fixtureInject(${JSON.stringify(pcm.toString('base64'))},${count},${drain},${final})`);
    const snapshot = () => content(`(() => {
        const c=fixtureStt.liveCapture||fixtureVadPrevious;
        return {mode:c.vad?.mode||"rms-default",metrics:c.vad?.metrics,transport:c.metrics,
            captureSamples:c.chunker.samples,sequence:c.chunker.sequence,rate:c.context.sampleRate,
            localP95:[...(c.fixtureLocal||[])].sort((a,b)=>a-b)[Math.max(0,Math.ceil((c.fixtureLocal||[]).length*.95)-1)]};
    })()`);
    const setMode = async (mode,hybrid) => {
        if(hybrid===null){
            await fromWorker(`chrome.storage.local.set({ui:{dictationInsertion:${JSON.stringify(mode)}}}).then(()=>chrome.storage.local.remove("sttVadDetector"))`);
            await waitFor('modo padrão',()=>content(`fixtureStt.insertionMode===${JSON.stringify(mode)}`));
            return;
        }
        await fromWorker(`chrome.storage.local.set({ui:{dictationInsertion:${JSON.stringify(mode)}},sttVadDetector:${JSON.stringify(hybrid?'hybrid':'rms')}})`);
        await waitFor('modo de inserção',()=>content(`fixtureStt.insertionMode===${JSON.stringify(mode)}`));
    };
    const prepare = async (warm) => {
        await fromWorker(`globalThis.fixtureVadCold=${!warm}`);
        const at=performance.now();
        const result=await fromWorker(`(async()=>{
            if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({
                url:"offscreen.html",reasons:["AUDIO_PLAYBACK","BLOBS","WORKERS"],justification:"Teste local isolado de VAD"
            });
            return chrome.runtime.sendMessage({target:"offscreen",type:"STT_VAD_OFFSCREEN",payload:{operation:"prepare",warm:${warm}}});
        })()`);
        assert.equal(result?.ok,true,JSON.stringify(result));
        return { ...result.timing, browserRoundTripMs:performance.now()-at };
    };
    const begin = async ({mode='realtime',hybrid=false,ready=true}={}) => {
        await setMode(mode,hybrid);
        await content(`(() => {
            globalThis.fixtureCanonical=[];
            const field=document.createElement('textarea');document.body.append(field);field.focus();
            void fixtureStt.startLiveRecording('narrator');
        })()`);
        const id=await waitFor('captura MV3',()=>content('fixtureStt.isRecording&&fixtureStt.liveJobId'));
        await content(`(() => {
            const capture=globalThis.fixtureVadPrevious=fixtureStt.liveCapture;
            const submit=capture.chunker.submitAudioChunk;
            capture.fixtureBoundaries={};
            capture.chunker.submitAudioChunk=entry=>{
                const c=entry.chunk;
                if(c)capture.fixtureBoundaries[c.sequence]=[c.startMs,c.endMs];
                return submit(entry);
            };
        })()`);
        if(hybrid&&ready&&mode==='realtime')await waitFor('Silero associado à captura',()=>content('fixtureStt.liveCapture?.vad?.ready'));
        const audio=await offscreen();
        await evaluate(audio,'globalThis.fixtureVadWire=true;globalThis.fixtureNumbered=true');
        return {id,audio};
    };
    const finish = async ({id}) => {
        await content('fixtureStt.stopLiveRecording()');
        await status(id,'completed');
        return snapshot();
    };
    const cleanOffscreen = async () => {
        await fromWorker('chrome.offscreen.hasDocument().then(exists=>exists&&chrome.offscreen.closeDocument())');
        await waitFor('offscreen encerrado',async()=>!(await locate(base+'offscreen.html')));
    };
    const speech = async () => {for(const pcm of fixtures)await inject(pcm);};
    const canonical = async () => Buffer.concat((await content('fixtureCanonical.map(p=>btoa(String.fromCharCode(...p)))')).map(p=>Buffer.from(p,'base64')));
    const wire = async audio => evaluate(audio,`fixtureSockets.filter(s=>s.fixtureAudio?.length).map(s=>({
        sequence:s.fixtureBlock, packets:s.fixtureAudio, closed:s.readyState===3
    }))`);
    const cpu = async () => {
        const {processInfo}=await call('SystemInfo.getProcessInfo');
        let rssKiB=0, pssKiB=0, pssCount=0;
        for(const process of processInfo){
            try{rssKiB+=Number(fs.readFileSync('/proc/'+process.id+'/status','utf8').match(/^VmRSS:\s+(\d+)/m)?.[1]||0);}catch{}
            try{
                const pss=fs.readFileSync('/proc/'+process.id+'/smaps_rollup','utf8').match(/^Pss:\s+(\d+)/m)?.[1];
                if(pss){pssKiB+=Number(pss);pssCount++;}
            }catch{}
        }
        return {rssKiB,pssKiB,pssCount,processCount:processInfo.length,cpuSeconds:processInfo.reduce((n,row)=>n+row.cpuTime,0)};
    };
    const checks = async (audio,start=0) => {
        const input=await canonical();
        const bounds=await content('fixtureVadPrevious.fixtureBoundaries');
        const rows=(await wire(audio)).slice(start).sort((a,b)=>a.sequence-b.sequence);
        const bySequence=new Map();
        for (const row of rows) {
            const packets=row.packets.map(p=>Buffer.from(p,'base64'));
            const bytes=Buffer.concat(packets);
            assert.ok(bounds[row.sequence],`bloco ${row.sequence} sem fronteira local`);
            const [startMs,endMs]=bounds[row.sequence];
            const offset=Math.round(endMs*32)-bytes.length;
            assert.ok(offset>=0&&Math.round(startMs*32)-offset>=0&&Math.round(startMs*32)-offset<=6400);
            assert.ok(bytes.equals(input.subarray(offset,offset+bytes.length)),
                `réplica do bloco ${row.sequence} divergiu no intervalo canônico ${offset}–${offset+bytes.length}`);
            assert.equal(offset%2,0);
            const matches=bySequence.get(row.sequence)||[];
            matches.push({bytes:bytes.length,sha256:sha(bytes),offset,packets:row.packets.length,
                packetHashesSha256:sha(Buffer.concat(packets.map(p=>Buffer.from(sha(p),'hex'))))});
            bySequence.set(row.sequence,matches);
        }
        assert.ok(bySequence.size>0,'nenhum bloco simulado recebeu PCM');
        for(const replicas of bySequence.values()){
            assert.equal(replicas.length,2);
            assert.deepEqual(replicas[0],replicas[1]);
        }
        return {inputBytes:input.length,inputSha256:sha(input),replicas:Object.fromEntries(bySequence)};
    };
    console.log('VAD: preparando sonda Chrome');
    if(process.env.FALAMERMO_VAD_IDLE_FIRST){
        await prepare(true);
        const run=await begin({hybrid:true});
        await new Promise(resolve=>setTimeout(resolve,16000));
        await inject(fixtures[0]);
        results.firstAfterIdle=await snapshot();
        if(process.env.FALAMERMO_VAD_EXPECT_IDLE_HEALTHY){
            assert.equal(results.firstAfterIdle.mode,'hybrid',JSON.stringify(results.firstAfterIdle));
            assert.equal(results.firstAfterIdle.metrics.fallback,undefined);
            await new Promise(resolve=>setTimeout(resolve,16000));
            await inject(fixtures[1]);
            results.afterPauseWithoutPcm=await snapshot();
            assert.equal(results.afterPauseWithoutPcm.mode,'hybrid');
            assert.equal(results.afterPauseWithoutPcm.metrics.classified,2);
        }
        await content('fixtureStt.cancelRecording(true,"user-stop")');
        await waitFor('liberação',()=>content('!fixtureStt.liveCapture'));
        results.complete=true;
        save();
        console.log(JSON.stringify(results,null,2));
        return;
    }
    if(process.env.FALAMERMO_VAD_DEADLINE_CASES){
        await prepare(true);
        const run=await begin({hybrid:true});
        await inject(zero,3);
        const blocked=fromWorker('(()=>{const until=performance.now()+120;while(performance.now()<until){};return true;})()');
        await inject(fixtures[0]);
        await blocked;
        const diagnostic=await snapshot();
        if(process.env.FALAMERMO_VAD_EXPECT_DIRECT){
            assert.equal(diagnostic.mode,'hybrid',JSON.stringify(diagnostic));
            assert.equal(diagnostic.metrics.fallback,undefined);
            const options=await target(base+'options.html');
            await call('ServiceWorker.enable',{},options.session);
            await call('ServiceWorker.stopAllWorkers',{},options.session);
            await inject(zero,10);
            const restarted=await snapshot();
            assert.equal(restarted.mode,'hybrid',JSON.stringify(restarted));
            assert.equal(restarted.metrics.fallback,undefined);
            results.serviceWorkerRestart=restarted;
        }
        await content('fixtureStt.cancelRecording(true,"user-stop")');
        await waitFor('liberação do microfone',()=>content('!fixtureStt.liveCapture'));
        results.backgroundContention=diagnostic;
        results.complete=true;
        save();
        console.log(JSON.stringify(results,null,2));
        return;
    }
    await fromWorker('chrome.storage.local.remove("sttVadDetector")');
    const optionsPage=await target(base+'options.html');
    await waitFor('seletor de detector nas Opções',()=>evaluate(optionsPage.session,
        'document.querySelector("#sttVadDetector")?.value==="hybrid"'));
    await call('Target.closeTarget',{targetId:optionsPage.targetId});
    await call('Page.bringToFront',{},page.session);
    await prepare(true);
    const defaultRun=await begin({hybrid:null});
    assert.equal((await snapshot()).mode,'hybrid');
    await speech();
    results.hybridDefault=await finish(defaultRun);
    assert.equal(results.hybridDefault.metrics.fallback,undefined);
    save();
    console.log('STT integrado: Silero padrão sem preferência prévia e seletor de Opções carregado');
    const cpuBefore=await call('SystemInfo.getProcessInfo');
    const metricsSession=page.session;
    await call('Performance.enable',{},metricsSession);
    const perf=()=>call('Performance.getMetrics',{},metricsSession).then(result=>Object.fromEntries(result.metrics.map(row=>[row.name,row.value])));
    const firstInput=fixtures[0];
    for(const warm of [false,true]){
        await cleanOffscreen();
        const preparation=await prepare(warm);
        const ipc=`(payload)=>chrome.runtime.sendMessage({target:"offscreen",type:"STT_VAD_OFFSCREEN",payload})`;
        const probe=async payload=>{
            const result=await fromWorker(`(${ipc})(${JSON.stringify({id:'isolated-probe',warm,...payload})})`);
            assert.equal(result.ok,true,JSON.stringify(result));
            return result;
        };
        await probe({operation:'open'});
        const at=performance.now();
        const {timing,scores}=await probe({operation:'analyze',seq:1,pcm:firstInput.toString('base64')});
        const probeMs=performance.now()-at;
        await probe({operation:'close'});
        results[warm?'warm':'cold']={preparation,first:{...timing,scores,probeMs}};
        console.log('VAD: primeiro pacote',warm?'aquecido':'frio',results[warm?'warm':'cold'].first);
    }
    assert.deepEqual(results.cold.first.scores,results.warm.first.scores);
    await cleanOffscreen();
    for(const mode of ['rms','hybrid']){
        if(mode==='hybrid'){await cleanOffscreen();await prepare(true);}
        const run=await begin({hybrid:mode==='hybrid'});
        await content('globalThis.fixturePaced=true');
        const wall=performance.now();
        const before=await perf();
        const offPerf=async()=>{
            await call('Performance.enable',{},run.audio);
            return call('Performance.getMetrics',{},run.audio).then(result=>Object.fromEntries(result.metrics.map(row=>[row.name,row.value])));
        };
        const offBefore=await offPerf();
        const resourceBefore=await cpu();
        await inject(zero,10);
        await speech();
        // Sessões por bloco devem mudar sem reinicializar a análise da mesma captura.
        await inject(zero,20);
        await speech();
        await inject(zero,10);
        const retained=await finish(run);
        await content('fixturePaced=false');
        const after=await perf();
        const offAfter=await offPerf();
        const resourceAfter=await cpu();
        results[mode]={...await checks(run.audio),retained,elapsedMs:performance.now()-wall,
            resourceBefore,resourceAfter,
            pageTaskMs:(after.TaskDuration-before.TaskDuration)*1000,pageHeapDelta:after.JSHeapUsedSize-before.JSHeapUsedSize,
            offscreenTaskMs:(offAfter.TaskDuration-offBefore.TaskDuration)*1000,offscreenHeapDelta:offAfter.JSHeapUsedSize-offBefore.JSHeapUsedSize};
        assert.equal(retained.metrics?.fallback,undefined,JSON.stringify(retained));
        assert.equal(Object.keys(results[mode].replicas).length,2);
        save();
        console.log('VAD: A/B',mode,'duas réplicas por bloco, SHA-256 canônico');
    }
    assert.equal(results.rms.inputSha256,results.hybrid.inputSha256);
    results.shortConsecutive=[];
    const oh=fs.readFileSync(path.join(__dirname,'vad-oh-sintetico.pcm'));
    for(let cycle=0;cycle<3;cycle++){
        await prepare(true);
        const run=await begin({hybrid:true});
        const priorWireCount=(await wire(run.audio)).length;
        await content('fixturePaced=true');
        await inject(zero,3);
        const starts=[];
        for(let repeat=0;repeat<2;repeat++){
            const start=(await snapshot()).captureSamples*2;
            starts.push([start,start+oh.length]);
            for(let at=0;at<oh.length;at+=3200){
                const pcm=Buffer.alloc(3200);
                oh.copy(pcm,0,at,at+3200);
                await inject(pcm);
            }
            await inject(zero,10);
        }
        const active=await snapshot();
        assert.equal(active.mode,'hybrid',JSON.stringify(active));
        const stats=await finish(run);
        await content('fixturePaced=false');
        assert.equal(stats.metrics.fallback,undefined);
        const hashes=await checks(run.audio,priorWireCount);
        for(const [start,end] of starts){
            assert.ok(Object.values(hashes.replicas).some(([copy])=>copy.offset<=start&&copy.offset+copy.bytes>=end),
                'início/fim de vocalização sintética fora das duas réplicas');
        }
        results.shortConsecutive.push({cycle,activeMode:active.mode,fallback:stats.metrics.fallback||null,stats,...hashes});
        save();
    }
    console.log('VAD: três capturas consecutivas, duas vocalizações sintéticas integrais por captura, híbrido ativo');

    await cleanOffscreen();
    await prepare(true);
    const manual=await begin({hybrid:true});
    await speech();
    await waitFor('PCM aceito antes de trocar',()=>content('fixtureStt.liveCapture.metrics.ackBytes>0'));
    const switchingOptions=await target(base+'options.html');
    await waitFor('seletor RMS pronto',()=>evaluate(switchingOptions.session,
        'typeof document.querySelector("#sttVadDetector")?.onchange==="function"'));
    await call('Page.bringToFront',{},page.session);
    await content(`globalThis.fixtureVadHook=(message,send)=>message.type==='STT_LOCAL_VAD'&&message.payload.operation==='analyze'?
        send(message).then(result=>new Promise(resolve=>globalThis.fixtureLateAck=()=>resolve(result))):send(message)`);
    await inject(fixtures[0],1,false);
    await waitFor('ACK local retido',()=>content('typeof fixtureLateAck==="function"'));
    await evaluate(switchingOptions.session,`(() => {
        const field=document.querySelector('#sttVadDetector');
        field.value='rms';field.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitFor('rollback manual',()=>content('fixtureStt.liveCapture.vad.metrics.fallback==="manual"'));
    await call('Target.closeTarget',{targetId:switchingOptions.targetId});
    await call('Page.bringToFront',{},page.session);
    await content('fixtureLateAck();fixtureVadHook=null');
    await speech();
    const switched=await finish(manual);
    results.manual={...await checks(manual.audio),stats:switched};
    assert.equal(switched.metrics.fallback,'manual');
    console.log('VAD: rollback manual e ACK tardio, sem replay');

    await cleanOffscreen();
    await prepare(true);
    const failure=await begin({hybrid:true});
    // Reiniciar o offscreen sem PCM comprometido. A análise perde estado; STT mantém a política original de recuperação.
    await inject(zero,4);
    await cleanOffscreen();
    await prepare(true);
    await evaluate(await offscreen(),'globalThis.fixtureVadWire=true');
    const tone=Buffer.alloc(3200);
    for(let i=0;i<1600;i++)tone.writeInt16LE(Math.round(6000*Math.sin(i/9)),i*2);
    await inject(tone,1,false);
    await waitFor('fallback após offscreen',()=>content('fixtureVadPrevious.vad.metrics.fallback'));
    const afterRestart=await snapshot();
    assert.equal(afterRestart.metrics.fallback,'analysis');
    await waitFor('falha STT original após perda do offscreen',()=>content('!fixtureStt.liveCapture'));
    const restarted=await begin({hybrid:true});
    await speech();
    const restartedStats=await finish(restarted);
    results.offscreenRestart={fallback:afterRestart.metrics.fallback,previousJobStatus:(await job(failure.id))?.status,
        newCapture:restartedStats.metrics, ...await checks(restarted.audio)};
    assert.equal(restartedStats.metrics.fallback,undefined);
    console.log('VAD: offscreen encerrado e recriado; nova captura íntegra');

    await cleanOffscreen();
    await prepare(true);
    const pause=await begin({hybrid:true});
    await speech();
    await inject(zero,10);
    const atPause=await snapshot();
    if(process.env.FALAMERMO_VAD_REAL_PAUSE)await content('fixturePaced=true');
    const pauseStarted=performance.now();
    for(let i=0;i<20;i++)await inject(zero,30);
    const pauseWallMs=performance.now()-pauseStarted;
    await content('fixturePaced=false');
    const duringPause=await snapshot();
    assert.equal(duringPause.sequence,atPause.sequence);
    assert.equal(duringPause.captureSamples-atPause.captureSamples,960000);
    const pauseClassified=duringPause.metrics.classified-atPause.metrics.classified;
    assert.equal(duringPause.mode,'hybrid',JSON.stringify(duringPause));
    assert.equal(pauseClassified,600);

    const send=(type,payload)=>content(`chrome.runtime.sendMessage(${JSON.stringify({type,payload})})`);
    const task=await send('HUD_GLOBAL_CREATE');
    assert.equal(task.success,true,task.error);
    const narration=task.state.activeTaskId;
    assert.equal((await send('HUD_GLOBAL_COMMAND',{jobId:narration,action:'edit',text:'Narração simulada concorrente.'})).success,true);
    await click('[data-job-id="'+narration+'"] [data-action="playPause"]',content);
    await waitFor('TTS simulado em conexão',()=>evaluate(pause.audio,'fixtureTurns.length'));
    await evaluate(pause.audio,'fixtureTurns.at(-1).receive(fixturePcm(10))');
    await status(narration,'playing');
    const playing=()=>evaluate(pause.audio,'fixtureJobs.get('+JSON.stringify(narration)+').player.status()');
    const beforePlayback=await playing();
    await speech();
    await inject(zero,10);
    const afterPlayback=await playing();
    assert.ok(afterPlayback.currentTime>beforePlayback.currentTime);
    assert.equal((await job(narration)).status,'playing');
    const pauseResult=await finish(pause);
    assert.equal(pauseResult.metrics.fallback,undefined,JSON.stringify(pauseResult));
    assert.equal(pauseResult.transport.ackBytes,pauseResult.transport.queuedBytes);
    results.pauseAndTts={pauseSamples:duringPause.captureSamples-atPause.captureSamples,
        pauseClassified,pauseWallMs,blocks:pauseResult.sequence,
        playbackBefore:beforePlayback.currentTime,playbackAfter:afterPlayback.currentTime,
        fallback:pauseResult.metrics.fallback||null,fallbackAt:pauseResult.metrics.fallbackAt||null,
        ...await checks(pause.audio)};
    assert.equal(results.pauseAndTts.blocks,2);
    await send('HUD_GLOBAL_COMMAND',{jobId:narration,action:'stop'});
    await status(narration,'cancelled');
    save();
    console.log('VAD: 60 s de PCM silencioso, retomada e TTS concorrente',results.pauseAndTts.fallback);

    await cleanOffscreen();
    await prepare(true);
    const deadline=await begin({hybrid:true});
    await speech();
    await content(`globalThis.fixtureVadHook=(message,send)=>message.type==='STT_LOCAL_VAD'&&message.payload.operation==='analyze'?
        send(message).then(result=>new Promise(resolve=>setTimeout(()=>resolve(result),150))):send(message)`);
    await inject(tone);
    const timedOut=await snapshot();
    assert.equal(timedOut.metrics.fallback,'deadline');
    await content('fixtureVadHook=null');
    await inject(tone);
    const deadlineResult=await finish(deadline);
    results.deadline={fallbackAt:timedOut.metrics.fallbackAt,stats:deadlineResult,...await checks(deadline.audio)};
    console.log('VAD: prazo local excedido, retorno para RMS, PCM e ACK íntegros');

    results.transportAck=[];
    for(const delivered of [false,true]){
        await cleanOffscreen();
        await prepare(true);
        const run=await begin({hybrid:true});
        await speech();
        await waitFor('ACK de transporte confirmado',()=>content('fixtureStt.liveCapture.metrics.ackBytes>0'));
        const pcmCount=async()=> (await wire(run.audio)).reduce((n,row)=>n+row.packets.length,0);
        const before=await pcmCount();
        await content(`globalThis.fixtureTransportAttempts=0;globalThis.fixtureVadHook=async(message,send)=>{
            if(message.type!=='STT_LIVE_AUDIO'||!message.payload.audioBase64)return send(message);
            fixtureTransportAttempts++;
            if(${delivered})await send(message);
            return {success:false,error:'ACK simulado perdido'};
        }`);
        await inject(tone,2,false);
        await waitFor('captura encerrada após perda do ACK',()=>content('!fixtureStt.liveCapture'));
        const attempts=await content('fixtureTransportAttempts');
        assert.equal(attempts,1);
        assert.equal(await pcmCount()-before,delivered?2:0);
        await content('fixtureVadHook=null');
        results.transportAck.push({delivered,attempts,bothCopiesPackets:await pcmCount()-before,status:(await job(run.id))?.status});
    }
    console.log('VAD: falha de ACK de transporte antes/depois de enviar PCM, sem retransmissão');

    await cleanOffscreen();
    await prepare(true);
    const panicRun=await begin({hybrid:true});
    await speech();
    const panicResult=await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_PANIC"})');
    assert.equal(panicResult.success,true,panicResult.error);
    await waitFor('Parar tudo libera Silero e captura',()=>content('!fixtureStt.liveCapture'));
    assert.equal(await fromWorker('chrome.offscreen.hasDocument()'),false);
    assert.equal(await content('fixtureVadPrevious.vad.mode'),'closed');
    assert.equal(await content('fixtureVadPrevious.vad.bytes'),0);
    results.panic={success:true,offscreenClosed:true,detectorClosed:true};
    console.log('STT integrado: Parar tudo libera captura, worker Silero e offscreen');

    await cleanOffscreen();
    const normal=await begin({mode:'final',hybrid:true});
    await speech();
    assert.equal((await snapshot()).mode,'hybrid');
    const normalStats=await finish(normal);
    assert.ok(normalStats.metrics.classified>0);
    assert.equal(normalStats.metrics.fallback,undefined);
    results.normal={...await checks(normal.audio),stats:normalStats};
    results.processCpu={before:cpuBefore.processInfo,after:(await call('SystemInfo.getProcessInfo')).processInfo};
    results.complete=true;
    save();
    console.log(JSON.stringify(results,null,2));
};
