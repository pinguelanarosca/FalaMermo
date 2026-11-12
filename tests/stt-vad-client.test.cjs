'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {CaptureVad} = require('../stt-vad-client.js');
const {CapturePipeline} = require('../stt-realtime.js');
const {AudioQueue} = require('../dictation-runtime.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const packet = (n, voiced = true) => {
    const pcm = new Uint8Array(3200);
    const samples = new Int16Array(pcm.buffer);
    if (voiced) for (let i = 0; i < samples.length; i++) samples[i] = 5500 * Math.sin(i / (3 + n / 20));
    return pcm;
};
const yes = item => ({ok:true, seq:item.seq, base:true, weak:false});
const no = item => ({...yes(item), base:false});

async function fixture(analyze, options = {}) {
    const applied = [];
    const sent = [];
    const errors = [];
    const pipeline = new CapturePipeline({
        jobId:'fixture', realtime:true, continuous:true, adaptive:true, config:{preRollMs:800},
        submitAudioChunk:entry=>sent.push(entry),
    });
    const vad = new CaptureVad({
        analyze,
        consume(pcm, decision) {
            applied.push([digest(pcm), decision ? decision.seq : null]);
            pipeline.push(pcm, decision === undefined ? undefined : decision.base || (!pipeline.chunk && decision.weak));
        },
        onFallback:()=>{pipeline.config.preRollMs=500;},
        onFailure:error=>errors.push(error),
        ...options,
    });
    vad.prepare(Promise.resolve({ok:true}));
    await tick();
    return {vad,pipeline,applied,sent,errors};
}

test('falha antes do primeiro ACK local preserva PCM e ordem na mesma pipeline RMS', async () => {
    const {vad,pipeline,applied,sent,errors} = await fixture(() => Promise.reject(Error('worker perdido')));
    const inputs = [packet(1),packet(2),packet(3)];
    inputs.forEach(pcm=>vad.push(pcm));
    await vad.barrier(()=>pipeline.finish());
    assert.equal(vad.metrics.fallback,'analysis');
    assert.deepEqual(applied,inputs.map(pcm=>[digest(pcm),null]));
    assert.deepEqual(sent.filter(p=>p.pcm.length).map(p=>digest(p.pcm)),inputs.map(digest));
    assert.deepEqual(sent.map(p=>p.chunk.packetSequence),[1,2,3,4]);
    assert.deepEqual(errors,[]);
});

test('erro após ACK local não reprocessa PCM nem bloco já encerrado', async () => {
    const {vad,pipeline,applied,sent} = await fixture(item=>item.seq===1?yes(item):{ok:false});
    const first = packet(1);
    const next = packet(2);
    vad.push(first);
    await vad.barrier(()=>pipeline.closeChunk('silence'));
    const committed = sent.slice();
    vad.push(next);
    await vad.barrier(()=>pipeline.finish());
    assert.deepEqual(applied,[[digest(first),1],[digest(next),null]]);
    assert.deepEqual(sent.slice(0,committed.length),committed);
    assert.deepEqual(sent.map(p=>p.chunk.sequence),[1,1,2,2]);
});

test('troca manual drena uma vez, respeita barreira e descarta ACK tardio', async () => {
    let complete;
    const {vad,pipeline,applied,sent} = await fixture(item=>new Promise(resolve=>{complete=()=>resolve(yes(item));}));
    const inputs = [packet(4),packet(5),packet(6)];
    vad.push(inputs[0]);
    const boundary = vad.barrier(()=>pipeline.closeChunk('silence'));
    vad.push(inputs[1]);
    await tick();
    vad.fallback('manual');
    await boundary;
    complete();
    vad.push(inputs[2]);
    await tick();
    await vad.barrier(()=>pipeline.finish());
    assert.deepEqual(applied,inputs.map(pcm=>[digest(pcm),null]));
    assert.deepEqual(sent.map(p=>p.chunk.sequence),[1,1,2,2,2]);
    assert.equal(vad.metrics.classified,0);
});

test('deadline e limite de fila preservam todos os pacotes ainda pendentes', async () => {
    for (const [options,expected] of [[{deadlineMs:6},'deadline'],[{maxPackets:2},'backpressure']]) {
        const {vad,applied} = await fixture(()=>new Promise(()=>{}),options);
        const inputs = [packet(7),packet(8),packet(9)];
        inputs.forEach(pcm=>vad.push(pcm));
        await vad.barrier(()=>{});
        assert.equal(vad.metrics.fallback,expected);
        assert.deepEqual(applied,inputs.map(pcm=>[digest(pcm),null]));
        assert.equal(vad.bytes,0);
    }
});

test('falha de preparo fixa RMS desde o primeiro pacote, mesmo após resposta tardia', async () => {
    const applied = [];
    const vad = new CaptureVad({consume:(pcm,decision)=>applied.push([digest(pcm),decision]),
        analyze:()=>assert.fail('não deve analisar'),onFallback:()=>{}});
    let resolve;
    vad.prepare(new Promise(done=>{resolve=done;}));
    const pcm = packet(1);
    vad.push(pcm);
    resolve({ok:true});
    await tick();
    assert.equal(vad.metrics.fallback,'not-ready');
    assert.deepEqual(applied,[[digest(pcm),undefined]]);
});

test('resgate só abre blocos, mantém cauda validada e fallback conserva pre-roll já retido', async () => {
    const {vad,pipeline,sent} = await fixture(item=>({...no(item),weak:item.seq>=9}));
    const inputs = Array.from({length:14},(_,i)=>packet(i,false));
    for (const pcm of inputs) {
        vad.push(pcm);
        await vad.barrier(()=>{});
    }
    assert.equal(sent[0].pcm.length,25600);
    assert.equal(sent.at(-1).chunk.cutReason,'silence');
    assert.equal(sent.at(-1).chunk.endMs,1400);
    for (let i=0;i<8;i++) {
        vad.push(packet(i,false));
        await vad.barrier(()=>{});
    }
    // A regra auxiliar continua positiva, mas o caso seguinte usa um histórico de silêncio separado.
    const other=await fixture(no);
    for(let i=0;i<8;i++){other.vad.push(packet(i,false));await other.vad.barrier(()=>{});}
    other.vad.fallback('manual');
    other.vad.push(packet(15));
    assert.equal(other.pipeline.config.preRollMs,500);
    assert.equal(other.sent[0].pcm.length,25600);
    assert.ok(pipeline.sequence>0);
});

test('cancelamento invalida resposta em voo e rejeita barreira sem entregar PCM', async () => {
    let complete;
    const {vad,applied} = await fixture(item=>new Promise(resolve=>{complete=()=>resolve(yes(item));}));
    vad.push(packet(1));
    const barrier=vad.barrier(()=>assert.fail('barreira cancelada'));
    await tick();
    vad.cancel();
    await assert.rejects(barrier,/encerrada/);
    complete();
    await tick();
    assert.deepEqual(applied,[]);
    assert.equal(vad.bytes,0);
});

test('ACK de transporte perdido antes/depois do processamento remoto não reenvia pacote', async () => {
    for (const delivered of [false,true]) {
        const calls=[];
        const remote=[];
        const metrics={};
        const queue=new AudioQueue({metrics,onFailure:()=>{},send:async payload=>{
            calls.push(payload.id);
            if (delivered) remote.push(payload.id);
            return {success:false,error:'ACK indisponível'};
        }});
        queue.push({id:1},3200);
        queue.push({id:2},3200);
        await assert.rejects(queue.drain(),/ACK indisponível/);
        assert.deepEqual(calls,[1]);
        assert.deepEqual(remote,delivered?[1]:[]);
        assert.equal(metrics.ackBytes||0,0);
    }
});

test('fallback registra fronteira real de PCM parcial, instante e prazo sem estimar seq*100',async()=>{
    let resolve;
    const {vad}=await fixture(item=>new Promise(done=>{resolve=()=>done(yes(item));}));
    vad.push(new Uint8Array(1600));
    await tick();
    vad.fallback('manual');
    const at=vad.metrics.fallbackAt;
    assert.equal(at.sequence,1);
    assert.equal(at.captureMs,0);
    assert.equal(at.captureEndMs,50);
    assert.equal(at.pendingBytes,1600);
    assert.equal(at.deadlineMs,75);
    assert.equal(typeof at.wallAt,'number');
    resolve();
    await tick();
});


test('rejeição preserva código do host sem relaxar validação de respostas',async()=>{
    const {vad}=await fixture(()=>({ok:false,code:'VAD_CAPTURE_MISSING'}));
    vad.push(packet(1));
    await vad.barrier(()=>{});
    assert.equal(vad.metrics.fallback,'analysis');
    assert.equal(vad.metrics.classified,0);
    assert.equal(vad.metrics.fallbackAt.responseValidation.code,'VAD_CAPTURE_MISSING');
    assert.equal(vad.metrics.fallbackAt.responseValidation.ok,false);
});
