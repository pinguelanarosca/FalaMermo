'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Jobs=require('../global-jobs.js');
test('telemetria pertence ao job e ao documento, persiste sem alterar status nem apresentação',async()=>{
 const data={},services={storage:{get:async key=>({[key]:data[key]}),set:async v=>Object.assign(data,structuredClone(v))}},r=Jobs.create(services),origin={tabId:7,frameId:0,documentId:'one'};
 await r.start({jobId:'capture',type:'STT',origin});const before=await r.get();
 const sample={sileroProbability:.123456789,tenProbability:.9,confirmed:false,recoveries:3,secret:'ignored'};
 await assert.rejects(r.capture({jobId:'capture',captureTelemetry:sample},{...origin,tabId:8}));
 await r.capture({jobId:'capture',captureTelemetry:sample},origin);const after=await r.get();
 assert.deepEqual(after.jobs[0].captureTelemetry,{sileroProbability:.123456789,tenProbability:.9,confirmed:false,recoveries:3});assert.equal(after.jobs[0].status,before.jobs[0].status);assert.equal(after.jobs[0].collapsed,before.jobs[0].collapsed);
 assert.deepEqual((await Jobs.create(services).get()).jobs[0].captureTelemetry,after.jobs[0].captureTelemetry);
});
test('registry não armazena nem restaura dimensões no estado de apresentação por aba',async()=>{
 const data={},services={storage:{get:async key=>({[key]:data[key]}),set:async v=>Object.assign(data,structuredClone(v))}},r=Jobs.create(services);
 for(const tabId of [1,2])await r.attachHud({tabId,frameId:0,documentId:'doc'+tabId});
 await r.ui({visible:true},1);await r.ui({size:{width:550,height:650}},1);
 for(const tabId of [1,2])assert.equal(Jobs.forHud(await r.get(),tabId).size,undefined);
 await r.ui({minimized:true},1);await r.ui({minimized:false},1);assert.equal(Jobs.forHud(await r.get(),1).visible,true);
 assert.equal(Jobs.forHud(await Jobs.create(services).get(),1).size,undefined);
});
test('criar e reabrir tarefas globais não torna a apresentação global',async()=>{
 const r=Jobs.create();for(const tabId of [1,2])await r.attachHud({tabId,frameId:0,documentId:'doc'+tabId});
 await r.draft({jobId:'draft',origin:{tabId:0}},2);assert.equal(Jobs.forHud(await r.get(),1).visible,false);assert.equal(Jobs.forHud(await r.get(),2).visible,true);
 await r.ui({visible:false},2);await r.reopen('draft',1);assert.equal(Jobs.forHud(await r.get(),2).visible,false);assert.equal(Jobs.forHud(await r.get(),1).visible,true);
});
