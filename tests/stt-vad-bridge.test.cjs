'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
    const listeners=[],sent=[],timers=new Map();
    let timerId=0;
    let terminations=0;
    const context=vm.createContext({console,Map,Uint8Array,atob,performance,
        setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
        chrome:{runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener:fn=>listeners.push(fn)}}},
        Worker:class{
            postMessage(message){
                sent.push(message);
                queueMicrotask(()=>this.onmessage({data:{
                    request:message.request,ok:true,seq:message.seq,base:true,weak:false,timing:{workerMs:1}
                }}));
            }
            terminate(){terminations++;}
        },
    });
    vm.runInContext(fs.readFileSync(process.env.FALAMERMO_VAD_HOST_SOURCE||require.resolve('../stt-vad-host.js'),'utf8'),context);
    const origin={tabId:7,documentId:'document-1',frameId:0,generation:4};
    const sender={id:'fixture',url:'http://127.0.0.1:100/vad-manual',tab:{id:7},documentId:'document-1',frameId:0};
    const call=(payload,from=sender,direct=true)=>new Promise(resolve=>{
        const message={type:direct?'STT_LOCAL_VAD':'STT_VAD_OFFSCREEN',
            target:'offscreen',payload};
        listeners[0](message,from,resolve);
    });
    const manage=payload=>call(payload,{id:'fixture',url:'chrome-extension://fixture/background.js'},false);
    return {sent,origin,sender,call,manage,timers,
        expireIdle(){for(const [id,timer] of [...timers])if(timer.ms===15000){timers.delete(id);timer.fn();}},
        command:payload=>listeners[1]({type:'TTS_OFFSCREEN_COMMAND',target:'offscreen',payload},
            {id:'fixture',url:'chrome-extension://fixture/background.js'}),
        get terminations(){return terminations;}};
}
const packet={operation:'analyze',jobId:'capture',generation:4,seq:1,pcm:btoa(String.fromCharCode(...new Uint8Array(3200))),
    clientSentAt:performance.timeOrigin+performance.now()};
test('análise direta mantém sequência e associação aberta pelo background',async()=>{
    const f=fixture();
    await f.manage({operation:'open',id:'capture',origin:f.origin});
    assert.equal((await f.call(packet)).ok,true);
    assert.equal((await f.call(packet)).ok,false);
    assert.equal((await f.call({...packet,seq:2})).ok,true);
    assert.deepEqual(f.sent.map(m=>m.operation),['open','analyze','analyze']);
});
test('outro documento, aba, frame, geração ou extensão não pode analisar ou fechar captura',async()=>{
    const f=fixture();
    await f.manage({operation:'open',id:'capture',origin:f.origin});
    for(const sender of [
        {...f.sender,documentId:'other'}, {...f.sender,tab:{id:9}},
        {...f.sender,frameId:2}, {...f.sender,id:'other-extension'},
    ]){
        assert.equal((await f.call(packet,sender)).ok,false);
        assert.equal((await f.call({...packet,operation:'close'},sender)).ok,false);
    }
    assert.equal((await f.call({...packet,generation:3})).ok,false);
    assert.equal((await f.call(packet)).ok,true);
});
test('fechamento direto libera worker sem depender da memória do service worker',async()=>{
    const f=fixture();
    await f.manage({operation:'open',id:'capture',origin:f.origin});
    await f.call(packet);
    assert.equal((await f.call({...packet,operation:'close',rollback:true})).ok,true);
    assert.equal(f.terminations,1);
    assert.equal((await f.call({...packet,seq:2})).ok,false);
});
test('análise só aceita operação permitida de captura existente',async()=>{
    const f=fixture();
    assert.equal((await f.call(packet)).ok,false);
    await f.manage({operation:'open',id:'capture',origin:f.origin});
    assert.equal((await f.call({...packet,operation:'dispose'})).ok,false);
    assert.equal((await f.call({...packet,operation:'open'})).ok,false);
    assert.equal((await f.call(packet)).ok,true);
    await tick();
});


test('captura aberta mantém vínculo antes do primeiro PCM e após pausa sem PCM',async()=>{
    const f=fixture();
    await f.manage({operation:'open',id:'capture',origin:f.origin});
    f.expireIdle();
    assert.equal(f.terminations,0);
    assert.equal((await f.call(packet)).ok,true);
    f.expireIdle();
    assert.equal((await f.call({...packet,seq:2})).ok,true);
    assert.equal(f.terminations,0);
});

test('worker sem captura continua liberado pelo timer ocioso',async()=>{
    const f=fixture();
    await f.manage({operation:'prepare'});
    assert.equal([...f.timers.values()].filter(t=>t.ms===15000).length,1);
    f.expireIdle();
    assert.equal(f.terminations,1);
    assert.equal((await f.call(packet)).code,'VAD_CAPTURE_MISSING');
});

test('encerramento normal e perda da origem liberam a captura e permitem limpeza ociosa',async()=>{
    for(const operation of ['STT_LIVE_STOP','STT_LIVE_CANCEL','STT_ORIGIN_LOST']){
        const f=fixture();
        await f.manage({operation:'open',id:'capture',origin:f.origin});
        f.command({operation,jobId:'capture'});
        await tick();
        assert.equal(f.sent.at(-1).operation,'close');
        assert.equal((await f.call(packet)).code,'VAD_CAPTURE_MISSING');
        f.expireIdle();
        assert.equal(f.terminations,1);
    }
});

test('prazo de worker travado permanece ativo durante uma captura',async()=>{
    const f=fixture();
    await f.manage({operation:'open',id:'capture',origin:f.origin});
    assert.ok(![...f.timers.values()].some(t=>t.ms===15000));
    // O prazo por requisição é verificado antes da resposta da simulação.
    const promise=f.call(packet);
    const timer=[...f.timers.values()].find(t=>t.ms===4000);
    assert.ok(timer);
    timer.fn();
    assert.equal((await promise).code,'VAD_WORKER_DISPOSED');
    assert.equal(f.terminations,1);
});
