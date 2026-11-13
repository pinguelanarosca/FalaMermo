'use strict';
// Silero/ONNX, conversão e transporte MV3 reais; Gemini simulado em perfil descartável.
const fs=require('node:fs');
const cp=require('node:child_process');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHash}=require('node:crypto');
function synthetic(seconds,seed,signal){
    const pcm=Buffer.alloc(seconds*32000);
    for(let i=0;i<pcm.length/2;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        pcm.writeInt16LE(Math.round(signal(i/16000,seed/2147483648-1)*32767),i*2);
    }
    return pcm;
}

module.exports=async({worker,content,evaluate,waitFor,offscreen,job})=>{
    await evaluate(worker,'chrome.storage.local.set({api:{apiKeys:["fixture-a","fixture-b"]},ui:{dictationInsertion:"realtime"},sttVadDetector:"hybrid"})');
    await waitFor('inserção realtime',()=>content('fixtureStt.insertionMode==="realtime"'));
    if(process.env.FALAMERMO_GHOST_PHYSICAL){
        await content(`(()=>{const field=document.createElement('textarea');document.body.append(field);field.focus();void fixtureStt.startLiveRecording('narrator');})()`);
        const id=await waitFor('microfone físico com Silero',()=>content('fixtureStt.isRecording&&fixtureStt.liveCapture?.vad?.ready&&fixtureStt.liveJobId'));
        await new Promise(resolve=>setTimeout(resolve,30000));
        const capture=await content(`(()=>{const c=globalThis.ghostCapture=fixtureStt.liveCapture;return {classified:c.vad.metrics.classified,fallback:c.vad.metrics.fallback,segments:c.chunker.sequence,capturedBytes:c.metrics.capturedBytes,forwardedBytes:c.metrics.forwardedBytes,pcmPeak:c.metrics.pcmPeak,pcmMaxRms:c.metrics.pcmMaxRms,pcmSignalSamples:c.metrics.pcmSignalSamples,sourceRate:c.context.sampleRate,trackState:c.stream.getAudioTracks()[0].readyState};})()`);
        await content('fixtureStt.stopLiveRecording()');
        const state=await waitFor('fim da captura física',async()=>{const s=await job(id);return ['completed','error','insertion-failed'].includes(s.status)&&s;});
        const result={physicalMicrophone:true,controlledHumanSpeech:false,loudspeaker:false,gemini:'simulated',durationMs:30000,jobId:id,...capture,status:state.status,incomplete:state.incomplete};
        if(process.env.FALAMERMO_GHOST_JSON)fs.writeFileSync(process.env.FALAMERMO_GHOST_JSON,JSON.stringify(result,null,2)+'\n');
        console.log(JSON.stringify(result));return;
    }
    await content(`globalThis.fixtureVadInput=true;
        globalThis.ghostInject=async(b64,final)=>{
            const capture=fixtureStt.liveCapture;
            const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
            const samples=new Int16Array(raw.buffer),rate=capture.context.sampleRate;
            const input=Float32Array.from({length:Math.round(samples.length*rate/16000)},(_,i)=>samples[Math.floor(i*16000/rate)]/32768);
            capture.fixtureHandler({data:final?{type:'vad-final-pcm',pcm:input.buffer}:input.buffer});
            await capture.vad.barrier(()=>{});
            await capture.audioQueue.drain();
        };`);
    const source=process.env.FALAMERMO_GHOST_WAV||'/home/Alee/teste-microfone.wav';
    const sourceSha256=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    assert.equal(sourceSha256,'37baccd3beec03c055eb899f257c80d55f758bac3ca9e459471856a3f49769e1','Os rótulos de ruído só valem para o WAV de 25 s conhecido');
    const decoded=cp.spawnSync('ffmpeg',['-v','error','-i',source,'-ar','16000','-ac','1','-f','s16le','pipe:1'],{maxBuffer:16e6});
    assert.equal(decoded.status,0,'WAV local indisponível');
    const wav=decoded.stdout;
    const scaled=gain=>{
        const out=Buffer.from(wav);
        for(let at=0;at<out.length;at+=2)out.writeInt16LE(Math.round(out.readInt16LE(at)*gain),at);
        return out;
    };
    const ambient=wav.subarray(19*32000,25*32000),initial=wav.subarray(0,5*32000);
    const repeat=(pcm,n)=>Buffer.concat(Array.from({length:n},()=>pcm));
    const oh=fs.readFileSync(path.join(__dirname,'vad-oh-sintetico.pcm'));
    const ohMix=synthetic(3,1803,(_,n)=>.02*n);
    for(let i=0;i<oh.length;i+=2)ohMix.writeInt16LE(ohMix.readInt16LE(i)+oh.readInt16LE(i),i);
    const harmonic=seed=>synthetic(2,seed,(t,n)=>{
        const sine=hz=>Math.sin(2*Math.PI*hz*t);
        return (.012+.009*sine(3.2))*(sine(155)+.42*sine(310)+.21*sine(465))+.008*n;
    });
    const cases=[['silence-60s',Buffer.alloc(60*32000)],['recorded-final-noise-30s',repeat(ambient,5)],
        ['recorded-initial-noise-30s',repeat(initial,6)],
        ['recorded-speech-and-ambient',wav],['attenuated-recording-0.1',scaled(.1)],['attenuated-recording-0.03',scaled(.03)],
        ['short-go',fs.readFileSync(path.join(__dirname,'vad-go-sintetico.pcm'))],
        ['short-oh',oh],['short-oh-over-noise',ohMix],
        ['synthetic-harmonic-no-speech-7919',harmonic(7919)],['synthetic-harmonic-no-speech-19661',harmonic(19661)]];
    const results=[];
    const save=()=>{if(process.env.FALAMERMO_GHOST_JSON)fs.writeFileSync(process.env.FALAMERMO_GHOST_JSON,JSON.stringify({sourceSha256,gemini:'simulated',microphone:'fixture',results},null,2)+'\n');};
    for(const [name,pcm] of cases){
        await content(`(()=>{
            const field=document.createElement('textarea');document.body.append(field);field.focus();
            globalThis.ghostField=field;
            void fixtureStt.startLiveRecording('narrator');
        })()`);
        const id=await waitFor('captura híbrida',()=>content('fixtureStt.isRecording&&fixtureStt.liveCapture?.vad?.ready&&fixtureStt.liveJobId'));
        const audio=await offscreen();
        await evaluate(audio,'globalThis.fixtureVadWire=true');
        await content(`(()=>{
            const c=globalThis.ghostCapture=fixtureStt.liveCapture;
            c.ghost={basePackets:0,weakPackets:0,decisions:[],segments:[],created:[]};
            globalThis.ghostOriginalSend??=fixtureStt.sendLiveMessage.bind(fixtureStt);
            const send=ghostOriginalSend;
            fixtureStt.sendLiveMessage=async m=>{
                const r=await send(m);
                if(m.type==='STT_LOCAL_VAD'&&m.payload.operation==='analyze'){
                    c.ghost.basePackets+=Number(r.base===true);c.ghost.weakPackets+=Number(r.weak===true);
                    if(r.base||r.weak)c.ghost.decisions.push({seq:m.payload.seq,base:r.base,weak:r.weak,evidence:r.evidence});
                }
                return r;
            };
            const submit=c.chunker.submitAudioChunk;
            c.chunker.submitAudioChunk=p=>{if(p.endOnly)c.ghost.segments.push(p.chunk);return submit(p);};
            const diagnostic=c.chunker.onDiagnostic;
            c.chunker.onDiagnostic=p=>{if(p.stage==='chunk-created')c.ghost.created.push(p);return diagnostic(p);};
        })()`);
        for(let at=0;at<pcm.length;at+=3200){
            await content('ghostInject('+JSON.stringify(pcm.subarray(at,at+3200).toString('base64'))+','+(at+3200>=pcm.length)+')');
        }
        await content('fixtureStt.stopLiveRecording()');
        await waitFor('conclusão '+name,async()=>{
            const state=await job(id);
            return ['completed','error','insertion-failed'].includes(state.status)&&state;
        }).catch(async error=>{console.error(JSON.stringify(await job(id)));throw error;});
        const actual=await content(`(()=>{const c=ghostCapture;return {jobId:c.jobId,mode:c.vad.metrics.fallback?'rms':'hybrid',
            fallback:c.vad.metrics.fallback,classified:c.vad.metrics.classified,forwardedBytes:c.metrics.forwardedBytes,
            basePackets:c.ghost.basePackets,weakPackets:c.ghost.weakPackets,decisions:c.ghost.decisions,segments:c.ghost.segments,
            created:c.ghost.created,editorCharacters:ghostField.value.length,editorLineBreaks:(ghostField.value.match(/\\n/g)||[]).length};})()`);
        const state=await job(id);
        const diagnostic=await evaluate(worker,'LiveSttDiagnostics.read().then(d=>d.jobs.find(j=>j.jobId==='+JSON.stringify(id)+'))');
        if(actual.segments.length){
            assert.equal(diagnostic.segments.length,actual.segments.length);
            assert.ok(diagnostic.segments.every(s=>s.vadSequenceStart>0&&s.analyzedFrames>0));
            assert.ok(diagnostic.sessions.every(s=>s.sequence>0&&s.sessionId&&s.sentBytes>0));
            assert.equal(diagnostic.sessions.length,actual.segments.length*2);
        }
        results.push({name,inputMs:pcm.length/32,...actual,status:state.status,resultCharacters:state.text.length,incomplete:state.incomplete,
            diagnosticSegments:diagnostic.segments||[],diagnosticSessions:diagnostic.sessions||[]});
        save();console.log(JSON.stringify({...results.at(-1),decisions:actual.decisions.length,segments:actual.segments.length,created:actual.created.length,diagnosticSegments:diagnostic.segments?.length||0,diagnosticSessions:diagnostic.sessions?.length||0}));
        assert.equal(actual.mode,'hybrid',name+' caiu em RMS');
        if(name==='silence-60s'||name.includes('-noise-'))assert.equal(actual.forwardedBytes,0,name+' enviou áudio');
    }
    save();
};
