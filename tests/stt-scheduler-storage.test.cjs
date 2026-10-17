'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const Scheduler=require('../stt-scheduler.js');
function fixture(data={}){
 const storage={async get(key){return{[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}};
 const context=vm.createContext({console,structuredClone,AbortController,chrome:{storage:{session:storage},offscreen:{hasDocument:async()=>false},runtime:{getURL:x=>'chrome-extension://test/'+x}}});
 vm.runInContext(require('./load-background.cjs')(path.join(__dirname,'..','background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);
 const cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};context.modules[id](m,m.exports,load);return m.exports;}
 const route=load('extension/src/background/messageRouter.ts').handleExtensionMessage;
 return{data,route:(type,payload,page='offscreen.html')=>route({type,payload},{url:'chrome-extension://test/'+page})};
}
test('telemetria autenticada usa allowlist e continua consultável após offscreen/worker encerrarem',async()=>{
 const e=fixture(),at=Date.now(),id='acct-'+'a'.repeat(64),secret='fake-only-do-not-store',payload={accounts:[{id,label:'key#1',at,apiKey:secret,models:[{modelId:Scheduler.MODELS[0],quota429:1,cooldownUntil:at+60000,reason:'QUOTA',choiceReason:'LOWER_LOAD',chunkLatencyMs:1200,entries:[{at,input:10,estimated:12,output:3,thoughts:0,text:'private-text'}]}]}],text:'private-text'};
 assert.equal((await e.route('STT_SCHEDULER_SAVE',payload,'content.html')).success,false);assert.equal((await e.route('STT_SCHEDULER_LOAD',null,'options.html')).success,false);assert.equal(Object.keys(e.data).length,0);
 assert.equal((await e.route('STT_SCHEDULER_SAVE',payload)).success,true);const restarted=fixture(e.data),snapshot=await restarted.route('STT_SCHEDULER_GET',null,'options.html');assert.equal(snapshot.success,true);assert.equal(snapshot.diagnostics.persisted,true);assert.equal(snapshot.diagnostics.activeJobs,0);assert.equal(snapshot.diagnostics.accounts[0].account,'key#1');assert.equal(snapshot.diagnostics.accounts[0].models[0].quota429,1);assert.equal(snapshot.diagnostics.accounts[0].models[0].selectionReason,'LOWER_LOAD');assert.equal(snapshot.diagnostics.accounts[0].models[0].chunkLatencyMs,1200);
 const wire=JSON.stringify(e.data);assert.ok(!wire.includes(secret));assert.ok(!wire.includes('private-text'));assert.equal((await restarted.route('STT_SCHEDULER_GET',null,'popup.html')).success,false);
});
test('TTL elimina estado antigo sem acessar credenciais nem criar offscreen',async()=>{
 const e=fixture({[Scheduler.STORAGE_KEY]:{accounts:[{id:'acct-'+'b'.repeat(64),label:'key#2',at:Date.now()-Scheduler.TTL-1,models:[]}]}});const r=await e.route('STT_SCHEDULER_GET',null,'options.html');assert.deepEqual(Array.from(r.diagnostics.accounts),[]);
});
