'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TemporalAgreement}=require('../vad-assets/dual.js');
const {CaptureVad}=require('../stt-vad-client.js');
const {CapturePipeline}=require('../stt-realtime.js');
const tick=()=>new Promise(r=>setImmediate(r));
const f=(start,end,probability)=>({start,end,probability});
test('uma janela de cada modelo, correlacionadas por amostras; TEN sozinho não abre',()=>{
 const a=new TemporalAgreement();assert.equal(a.push([f(0,512,.49)],[f(256,512,.99)]).length,0);
 assert.equal(a.push([f(512,1024,.5)],[f(512,768,.5)]).length,1);
 assert.equal(new TemporalAgreement().push([f(0,512,.99)],[f(512,768,.99)]).length,0);
 const b=new TemporalAgreement();assert.equal(b.push([],[f(256,512,.9)]).length,0);assert.equal(b.push([f(0,512,.8)],[]).length,1);
});
test('hangover preserva palavra curta depois de pausa sem nova autorização por pacote',()=>{
 const sent=[],p=new CapturePipeline({jobId:'dual',realtime:true,continuous:true,config:{preRollMs:800},submitAudioChunk:x=>sent.push(x)});
 for(let i=0;i<8;i++)p.push(new Uint8Array(3200),false);
 p.push(new Uint8Array(3200).fill(1),true);p.push(new Uint8Array(3200),false);p.push(new Uint8Array(3200),false);
 const word=new Uint8Array(3200).fill(2);p.push(word,true);p.finish();assert.ok(sent.some(x=>x.pcm.every(v=>v===2)&&x.pcm.length===word.length));assert.equal(p.sequence,1);
});
test('timeout reinicializa, ignora resposta antiga e entrega PCM uma vez em ordem, sem RMS',async()=>{
 let oldResolve,attempt=0;const delivered=[];const v=new CaptureVad({deadlineMs:8,recover:async()=>({ok:true}),analyze:item=>++attempt===1?new Promise(r=>oldResolve=r):{ok:true,seq:item.seq,base:true,weak:false},consume:(pcm,d)=>{assert.ok(d);delivered.push([...pcm]);}});
 await v.prepare({ok:true});const inputs=[new Uint8Array([1,2]),new Uint8Array([3,4])];inputs.forEach(x=>v.push(x));await v.barrier(()=>{});oldResolve({ok:true,seq:1,base:true,weak:false});await tick();assert.deepEqual(delivered,inputs.map(x=>[...x]));assert.equal(v.metrics.recoveries,1);assert.equal(v.metrics.deadlines,1);assert.equal(v.mode,'hybrid');v.cancel();
});
test('falha definitiva preserva PCM e não entrega decisão RMS',async()=>{
 let saved=[];const v=new CaptureVad({recover:async()=>({ok:false}),analyze:async()=>({ok:false}),preserve:async p=>saved=p.map(x=>[...x.pcm]),consume:()=>assert.fail('não pode enviar'),onFailure:()=>{}});await v.prepare({ok:true});v.push(new Uint8Array([1,2]));await tick();await tick();assert.equal(v.mode,'failed');assert.deepEqual(saved,[[1,2]]);v.cancel();
});
test('recuperação aquece contexto já consumido sem duplicá-lo na entrega',async()=>{
 let phase=0,timed=false;const output=[],calls=[];const v=new CaptureVad({deadlineMs:8,recover:async()=>{phase++;return{ok:true};},analyze:i=>{calls.push([phase,i.seq,i.pcm[0]]);if(!timed&&i.pcm[0]===2){timed=true;return new Promise(()=>{});}return{ok:true,seq:i.seq,base:true,weak:false};},consume:p=>output.push(p[0])});
 await v.prepare({ok:true});v.push(new Uint8Array([1,0]));await v.barrier(()=>{});v.push(new Uint8Array([2,0]));await v.barrier(()=>{});assert.deepEqual(output,[1,2]);assert.deepEqual(calls.filter(c=>c[0]===1),[[1,1,1],[1,2,2]]);v.cancel();
});
