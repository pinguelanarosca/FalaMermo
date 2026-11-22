'use strict';
const assert = require('node:assert/strict');

module.exports = async ({content,evaluate,worker,job,status,offscreen,waitFor,sleep,call,page,target,locate,base}) => {
    await call('Page.bringToFront',{},page.session);
    await evaluate(worker,'chrome.storage.local.set({api:{apiKeys:["fixture-1","fixture-2","fixture-3","fixture-4"]},ui:{dictationInsertion:"realtime"}})');
    await evaluate(worker,'globalThis.fixtureVadKeepOffscreen=true;chrome.offscreen.createDocument({url:"offscreen.html",reasons:["AUDIO_PLAYBACK","BLOBS","WORKERS"],justification:"Integração STT isolada"})');
    const remote = await offscreen();
    await evaluate(remote,'globalThis.fixtureLatencyProbe=true;globalThis.fixtureNumbered=true');
    await waitFor('modo tempo real',()=>content('fixtureStt.insertionMode==="realtime"'));
    await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_UI_SET",payload:{visible:true,minimized:false,scope:"tab",interaction:true}})');
    const start = async () => {
        await content('document.querySelector("textarea").value="";document.querySelector("textarea").focus();void fixtureStt.startLiveRecording("narrator")');
        return waitFor('captura em andamento',()=>content('fixtureStt.isRecording&&fixtureStt.liveJobId'));
    };
    const id = await start();
    await content(`(() => {
        const field=document.querySelector('textarea');
        const selector='.fm-global-card[data-job-id="'+fixtureStt.liveJobId+'"] .fm-global-partial';
        const observation=globalThis.fixtureLatencyMarks={};
        const observe=()=>{
            const card=fixtureHud.querySelector(selector);
            if(card?.getClientRects().length&&card.textContent.includes('Bloco 2'))observation.card2??=Date.now();
        };
        const observer=new MutationObserver(observe);
        observer.observe(fixtureHud,{childList:true,subtree:true,characterData:true,attributes:true});
        const onInput=()=>{if(field.value.includes('Bloco 2'))observation.editor2??=Date.now();};
        field.addEventListener('input',onInput);
        globalThis.fixtureEndObservation=()=>{observer.disconnect();field.removeEventListener('input',onInput);};
        observe();
    })()`);
    await waitFor('primeira hipótese no editor',()=>content('document.querySelector("textarea").value.includes("Bloco 1")'));
    await content('if(fixtureStt.liveCapture.chunker.sequence===1&&fixtureStt.liveCapture.chunker.chunk)fixtureStt.liveCapture.chunker.closeChunk("maximum")');
    const received = await waitFor('hipótese do bloco 2 com final do 1 retido',
        ()=>evaluate(remote,'fixtureSttHeld.length>0&&fixtureSockets.find(s=>s.fixtureBlock===2&&s.fixtureHypothesisAt)?.fixtureHypothesisAt'));
    const visible = await waitFor('bloco 2 visível sem liberar final do 1',()=>content('fixtureLatencyMarks.card2'));
    assert.equal(await content('!!fixtureLatencyMarks.editor2'),false);
    assert.equal((await job(id)).partialText,'Bloco 1');
    assert.match((await job(id)).previewText,/Bloco 2/);
    const release = await evaluate(remote,'fixtureSttHeld.splice(0).forEach(x=>x.complete());Date.now()');
    const inserted = await waitFor('bloco 2 no editor depois da consolidação',()=>content('fixtureLatencyMarks.editor2'));
    assert.ok(inserted>=release+850);
    console.log('STT fora de ordem',JSON.stringify({responseToCardMs:visible-received,responseToEditorMs:inserted-received}));
    await content('fixtureEndObservation();void fixtureStt.stopLiveRecording()');
    assert.match((await status(id,'completed')).text,/^Bloco 1\. Bloco 2\./);
    assert.equal((await job(id)).insertion.inserted,true);

    await evaluate(remote,'globalThis.fixtureLatencyProbe=false;globalThis.fixtureNumbered=false');
    const invalid = await start();
    await waitFor('PCM persistido para retentativa de ACK',()=>content('fixtureStt.liveCapture?.metrics.ackBytes>0'));
    await evaluate(worker,'globalThis.fixtureInvalidSttAck=true');
    await content('void fixtureStt.stopLiveRecording()');
    await waitFor('três ACKs inválidos',()=>evaluate(worker,'globalThis.fixtureInvalidSttAttempts>=3'));
    const snapshot = await evaluate(worker,'chrome.runtime.sendMessage({target:"offscreen",type:"TTS_OFFSCREEN_COMMAND",payload:{operation:"GLOBAL_JOBS_SNAPSHOT"}})');
    assert.ok(snapshot.pendingEvents>0);
    assert.ok(await locate(base+'offscreen.html'));
    const options=await target(base+'options.html');
    await call('ServiceWorker.enable',{},options.session);
    await call('ServiceWorker.stopAllWorkers',{},options.session);
    const getState=()=>content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_GET"}).then(r=>r?.state)');
    const recovered=await waitFor('final recuperado pelo novo service worker',async()=>{
        const result=(await getState())?.jobs.find(task=>task.jobId===invalid);
        return result?.status==='completed'&&result;
    },15000);
    assert.equal(recovered.insertion.inserted,true);
    assert.equal(recovered.text,'Ditado de teste.');
    const newWorker=await locate(base+'background.js');
    const restarted=await call('Target.attachToTarget',{targetId:newWorker.targetId,flatten:true});
    assert.equal(await evaluate(restarted.sessionId,'typeof fixtureInvalidSttAck'), 'undefined');
    console.log('STT ACK inválido: retomada após reinício, texto e ACK do editor verificados');

    await call('Page.bringToFront',{},page.session);
    const stopped=await start();
    await waitFor('PCM antes do cancelamento',()=>content('fixtureStt.liveCapture?.metrics.ackBytes>0'));
    const file=await offscreen();
    await evaluate(file,'globalThis.fixtureHoldPanic=true');
    await content('globalThis.fixtureStopTrack=fixtureStt.liveCapture.stream.getAudioTracks()[0]');
    const initiated=Date.now();
    const panic=content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_PANIC"})');
    await waitFor('origem liberou microfone enquanto offscreen retém resposta',
        ()=>content('fixtureStopTrack.readyState==="ended"&&!fixtureStt.liveCapture'));
    const result=await panic;
    const stopMs=Date.now()-initiated;
    assert.equal(result?.remoteStopped,true);
    assert.equal(result.state.jobs.find(task=>task.jobId===stopped)?.status,'cancelled');
    await waitFor('offscreen fechado sem ACK do comando',async()=>!await locate(base+'offscreen.html'));
    const retained=await evaluate(options.session,'SttRealtime.recovery.wave('+JSON.stringify(stopped)+').then(result=>result.bytes)');
    assert.ok(retained>0);
    const next=await start();
    assert.notEqual(next,stopped);
    await waitFor('novo ditado obteve PCM',()=>content('fixtureStt.liveCapture?.metrics.ackBytes>0'));
    await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_PANIC"})');
    console.log('STT Parar tudo sem resposta',JSON.stringify({stopMs,retainedBytes:retained,microphoneReused:true}));

    await content(`(() => {
        const controller=fixtureStt;
        const send=controller.sendLiveMessage.bind(controller);
        controller.sendLiveMessage=message=>{
            if(message.type!=='STT_LIVE_START')return send(message);
            return new Promise(resolve=>globalThis.fixtureLateConnection=()=>{
                controller.sendLiveMessage=send;
                return send(message).then(resolve,error=>resolve({success:false,error:error.message}));
            });
        };
        document.querySelector('textarea').focus();
        void controller.startLiveRecording('narrator');
    })()`);
    const connecting=await waitFor('reserva ativa com conexão pendente',()=>content('typeof fixtureLateConnection==="function"&&fixtureStt.liveCapture?.jobId'));
    await content('globalThis.fixtureConnectingTrack=fixtureStt.liveCapture.stream.getAudioTracks()[0]');
    const beforeConnection=await content('chrome.runtime.sendMessage({type:"HUD_GLOBAL_PANIC"})');
    assert.equal(beforeConnection.state.jobs.find(task=>task.jobId===connecting)?.status,'cancelled');
    await content('fixtureLateConnection()');
    assert.equal(await content('fixtureConnectingTrack.readyState'), 'ended');
    assert.equal(await content('fixtureStt.liveCapture'), null);
    assert.equal((await getState()).jobs.find(task=>task.jobId===connecting)?.status, 'cancelled');
    console.log('STT Parar tudo durante connecting: reserva cancelada e resposta tardia ignorada');
};
