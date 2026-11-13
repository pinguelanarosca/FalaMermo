'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {CapturePipeline}=require('../stt-realtime.js');
const {voicePcm}=require('./stt-audio-fixture.cjs');

test('evidência VAD não muda PCM, fronteiras ou decisão de uma palavra curta',()=>{
    const run=instrumented=>{
        const packets=[],events=[];
        const pipeline=new CapturePipeline({jobId:'trace',realtime:true,continuous:true,
            submitAudioChunk:p=>packets.push(p),onDiagnostic:e=>events.push(e)});
        for(let seq=1;seq<=30;seq++){
            const voiced=seq===11,pcm=voiced?voicePcm():new Uint8Array(3200);
            pipeline.push(pcm,voiced,instrumented?{seq,base:voiced,weak:false,
                evidence:{analyzedFrames:3,hybridFrames:voiced?1:0,rescueFrames:0,sileroMaxProbability:voiced?.6:.01}}:undefined);
        }
        pipeline.finish();return {packets,event:events.find(e=>e.stage==='chunk-created')};
    };
    const before=run(false),after=run(true);
    assert.deepEqual(after.packets,before.packets);
    assert.equal(after.event.voicedPacketMs,100);
    assert.equal(after.event.basePacketMs,100);
    assert.equal(after.event.vadSequenceStart,11);
    assert.equal(after.event.vadSequenceEnd,16);
    assert.equal(after.event.hybridFrames,1);
    assert.equal(after.event.sileroMaxProbability,.6);
    assert.equal(after.event.analyzedFrames,18);
});

test('resumos separados preservam segmento e duas sessões após rotação dos eventos, sem conteúdo privado',async()=>{
    const store={};
    const context=vm.createContext({chrome:{storage:{session:{get:async k=>({[k]:store[k]}),set:async v=>Object.assign(store,v)}}}});
    vm.runInContext(fs.readFileSync(require.resolve('../live-stt-diagnostics.js'),'utf8'),context);
    const diag=context.LiveSttDiagnostics,jobId='00000000-0000-4000-8000-000000000000';
    await diag.record({jobId,scope:'capture',stage:'chunk-created',sequence:1,chunkId:jobId+':1',durationMs:1300,
        voicedPacketMs:100,basePacketMs:0,rescuePacketMs:100,vadSequenceStart:9,vadSequenceEnd:14,
        text:'private-text',pcm:'private-pcm',apiKey:'private-key'});
    for(const [sessionId,characters,inputLineBreaks] of [['live-1794500000000-first',4,0],['live-1794500000001-second',20,1]]){
        await diag.record({jobId,scope:'transport',stage:'server-message',sessionId,sequence:1,characters,inputLineBreaks,afterNewSpeech:true,...(characters===4?{inputFinished:true}:{} )});
    }
    for(let revision=0;revision<45;revision++)await diag.record({jobId,scope:'editor',stage:'editor-apply',sequence:1,revision,
        textLineBreaks:0,before:{fieldLineBreaks:0,value:'private-value'},after:{fieldLineBreaks:0}});
    const job=(await diag.read()).jobs[0];
    assert.equal(job.events.length,40);
    assert.equal(job.segments.length,1);
    assert.equal(job.segments[0].rescuePacketMs,100);
    assert.equal(job.sessions.length,2);
    assert.deepEqual(Array.from(job.sessions,s=>[s.characters,s.inputLineBreaks]),[[4,0],[20,1]]);
    assert.equal(job.transport.inputFinished,undefined,'flag de outra sessão vazou no snapshot');
    assert.equal(job.editor.after.fieldLineBreaks,0);
    assert.doesNotMatch(JSON.stringify(job),/private-/);
});

test('limites dos resumos e sanitização continuam aplicados ao diagnóstico exportado',async()=>{
    const diag=require('../live-stt-diagnostics.js'),jobId='00000000-0000-4000-8000-000000000000',now=Date.now();
    const capture={jobId,stage:'chunk-created',scope:'capture',sequence:1,chunkId:jobId+':1'};
    const segment=()=>({...capture,text:'private-text'});
    const session=()=>({jobId,scope:'transport',stage:'server-message',sessionId:'live-1794500000000-test',apiKey:'private-key'});
    const cleaned=diag.clean({jobs:[{jobId,updatedAt:now,events:[capture],segments:Array.from({length:80},segment),sessions:Array.from({length:90},session)}]},now);
    assert.equal(cleaned.jobs[0].segments.length,32);
    assert.equal(cleaned.jobs[0].sessions.length,64);
    assert.doesNotMatch(JSON.stringify(cleaned),/private-/);
});
