'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};

function fixture({keys=['translation-test-key'],ttsError}={}){
 const calls=[],routes=[],session={},snapshots=[],logs=[];let history={enabled:true,maxEntries:50,recentItems:[]};
 const settings={api:{apiKeys:keys},agents:{activeAgentId:'translator',customAgents:[]},models:{visionModelId:'gemini-3.5-flash-lite'},audio:{preferredVoice:'Puck'}};
 const context=vm.createContext({AbortController,structuredClone,console,setTimeout,clearTimeout,
  fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve})),chrome:{storage:{session:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,structuredClone(value))}},runtime:{getURL:file=>'chrome-extension://test/'+file,sendMessage:async message=>{snapshots.push(message);return{success:true};}},tabs:{sendMessage:async()=>({success:true})}}});
 vm.runInContext(require('./load-background.cjs')(require.resolve('../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);
 const overrides={
  'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:{getMany:async()=>settings,get:async name=>name==='history'?history:{},update:async(name,fn)=>{if(name==='history')history=fn(history)||history;}}},
  'extension/src/services/diagnosticLogger.ts':{logDiagnostic:async entry=>logs.push(entry)},
  'extension/src/services/backgroundPlayback.ts':{hasDocument:async()=>false,reserveIntent:async()=>{},handlePlaybackCommand:async payload=>{routes.push(payload);return ttsError?{success:false,error:ttsError}:{success:true};}}
 };
 const cache={};function load(name){if(overrides[name])return overrides[name];if(cache[name])return cache[name].exports;const module=cache[name]={exports:{}};context.modules[name](module,module.exports,load);return module.exports;}
 const router=load('extension/src/background/messageRouter.ts'),sender={url:'https://example.test',tab:{id:1},frameId:0,documentId:'selected-document'};
 const run=(type,payload={},origin=sender)=>router.handleExtensionMessage({type,payload},origin);
 return{calls,routes,logs,snapshots,run,history:()=>history,reply(index,text,status=200){calls[index].resolve({ok:status===200,status,headers:{get:()=>null},text:async()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]})});},state:async()=>(await run('HUD_GLOBAL_GET')).state};
}

test('seleção vira tradução PT-BR e alimenta TTS existente, com agente/voz, uma tarefa e sem comandos de inserção',async()=>{
 const e=fixture(),running=e.run('TRANSLATE_REQUEST',{text:'Good morning. Keep code A-42.',agentId:'translator'});await flush();
 let s=await e.state();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].source,'translation');assert.equal(s.jobs[0].status,'translating');assert.equal(s.visible,true);assert.equal(e.routes.length,0);
 const body=JSON.parse(e.calls[0].options.body);assert.equal(body.contents[0].parts[0].text,'Good morning. Keep code A-42.');assert.match(body.systemInstruction.parts[0].text,/português brasileiro \(PT-BR\)/);assert.ok(!body.contents[0].parts[0].inlineData);
 e.reply(0,'Bom dia. Mantenha o código A-42.');const result=await running;assert.equal(result.success,true);assert.equal(e.routes.length,1);const tts=e.routes[0];assert.equal(tts.operation,'TTS_LIVE_START');assert.equal(tts.text,'Bom dia. Mantenha o código A-42.');assert.equal(tts.literalSelection,true);assert.equal(tts.agentSnapshot,undefined);assert.equal(tts.jobId,result.jobId);assert.ok(tts.voiceName);assert.equal(tts.systemInstruction,require('../live-config.js').LITERAL_NARRATION);
 s=await e.state();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].status,'connecting');assert.equal(s.jobs[0].text,tts.text);assert.equal(s.jobs[0].agentId,'translator');
 await e.run('LIVE_OFFSCREEN_EVENT',{jobId:result.jobId,requestId:tts.requestId,event:'play',eventSeq:1},{url:'chrome-extension://test/offscreen.html'});
 await e.run('LIVE_OFFSCREEN_EVENT',{jobId:result.jobId,requestId:tts.requestId,event:'ended',eventSeq:2},{url:'chrome-extension://test/offscreen.html'});
 assert.equal((await e.state()).jobs[0].status,'completed');assert.equal(e.history().recentItems[0].text,tts.text);assert.equal(e.history().recentItems[0].source,'translation');assert.ok(e.snapshots.every(m=>!m.type?.includes('INSERT')));
});

test('falha Gemini fica na tarefa e não narra; falha TTS conserva tradução recuperável',async()=>{
 const e=fixture(),running=e.run('TRANSLATE_REQUEST',{text:'Hello.'});await flush();e.reply(0,'',503);await flush();
 for(let turn=0;turn<8;turn++){for(const call of e.calls)if(!call.replied){call.replied=true;call.resolve({ok:false,status:503,headers:{get:()=>null},body:{cancel:async()=>{}},text:async()=>''});}await flush();}
 assert.equal((await running).success,false);assert.equal(e.routes.length,0);assert.equal((await e.state()).jobs[0].status,'error');
 const t=fixture({ttsError:'Falha de áudio de teste.'}),play=t.run('TRANSLATE_REQUEST',{text:'Hello.'});await flush();t.reply(0,'Olá.');assert.equal((await play).success,false);const job=(await t.state()).jobs[0];assert.equal(job.status,'error');assert.equal(job.text,'Olá.');assert.match(job.error,/Falha de áudio/);
});

test('Stop durante tradução invalida resposta tardia; seleção vazia e falta de chave não acionam TTS',async()=>{
 const e=fixture(),running=e.run('TRANSLATE_REQUEST',{text:'Hello.'});await flush();const job=(await e.state()).jobs[0];
 assert.equal((await e.run('HUD_GLOBAL_COMMAND',{jobId:job.jobId,action:'stop'})).success,true);e.reply(0,'Tardia.');assert.equal((await running).cancelled,true);assert.equal(e.routes.filter(r=>r.operation==='TTS_LIVE_START').length,0);assert.equal((await e.state()).jobs[0].status,'cancelled');
 const noKey=fixture({keys:[]});assert.equal((await noKey.run('TRANSLATE_REQUEST',{text:'Hello.'})).success,false);assert.equal(noKey.calls.length,0);assert.equal(noKey.routes.length,0);assert.equal((await noKey.state()).jobs[0].status,'error');
 assert.equal((await noKey.run('TRANSLATE_REQUEST',{text:'  '})).success,false);assert.equal((await noKey.state()).jobs.length,1);
});
