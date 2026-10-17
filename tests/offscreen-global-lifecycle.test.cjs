'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const LiveConfig=require('../live-config.js'),flush=()=>new Promise(r=>setImmediate(r));
function fixture(deliver=()=>({success:true}),customize=()=>({})){
 const events=[],sessions=[],timers=new Map();let listener,nextTimer=0;
 class Manager{async acquire(options){const s={options,sent:[],socketOpenMs:1,setupCompleteMs:2,sendAudio(bytes){this.sent.push(bytes.length);},endAudio(){this.ended=true;},close(){this.closed=true;},...customize(options)};sessions.push(s);return s;}release(s){s.busy=false;}retire(s){s.closed=true;s.options?.onRetire?.(s);}}
 const context=vm.createContext({console,performance,structuredClone,AbortController,Uint8Array,DataView,Float32Array,
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),SttScheduler:require('../stt-scheduler.js'),LiveConfig,SttRealtime:require('../stt-realtime.js'),
  LiveSessions:{LiveSessionManager:Manager,decodeBase64:x=>Uint8Array.from(Buffer.from(x,'base64')),classifyLiveError:require('../live-session-manager.js').classifyLiveError},
  chrome:{runtime:{onMessage:{addListener:fn=>listener=fn},getURL:x=>x,async sendMessage(msg){events.push(structuredClone(msg));return deliver(msg);}}}});
 vm.runInContext(fs.readFileSync(require.resolve('../offscreen.js'),'utf8'),context);
 const command=payload=>new Promise(resolve=>listener({type:'LIVE_OFFSCREEN_COMMAND',target:'offscreen',payload},{},resolve));
 const fire=async ms=>{for(const[id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn();}await flush();};
 return{command,sessions,events,timers,fire};
}
const start=id=>({operation:'STT_LIVE_START',jobId:id,modelId:'gemini-3.8-live',apiKeys:['fake-for-unit-test-'+id],tabId:12,frameId:0,documentId:'original-document'});
test('realtime delimita antes do Stop, atualiza um job e transforma consolidado uma única vez',async()=>{
 let transforms=0;const e=fixture(undefined,options=>options.mode==='agent'?{sendTurn:async text=>{transforms++;assert.equal(text,'Primeira. Segunda.');return{text:'Consolidado.'};}}:{endAudio(){this.endCount=(this.endCount||0)+1;}});await e.command({...start('live-chunks'),realtime:true,transformInstruction:'Instrução original do agente.'});let tail=Promise.resolve();
 const capture=new(require('../stt-realtime.js').CapturePipeline)({jobId:'live-chunks',realtime:true,submitAudioChunk:p=>{tail=tail.then(()=>e.command({operation:'STT_LIVE_AUDIO',jobId:'live-chunks',chunk:p.chunk,...(p.endOnly?{endOnly:true}:{audioBase64:Buffer.from(p.pcm).toString('base64')})}));}});
 function frame(value){const bytes=new Uint8Array(3200),view=new DataView(bytes.buffer);for(let i=0;i<bytes.length;i+=2)view.setInt16(i,value,true);return bytes;}
 for(let n=0;n<2;n++){capture.push(frame(3000));for(let i=0;i<5;i++)capture.push(frame(0));}capture.finish();await tail;assert.equal(e.sessions.length,1);assert.equal(e.sessions[0].endCount,1);
 e.sessions[0].handler({serverContent:{inputTranscription:{text:'Primeira.'},turnComplete:true}});await flush();assert.equal(transforms,0);assert.ok(e.events.some(m=>m.payload?.event==='stt-partial'&&m.payload.jobId==='live-chunks'));await e.fire(900);assert.equal(e.sessions[0].endCount,2);assert.equal(transforms,0);
 await e.command({operation:'STT_LIVE_STOP',jobId:'live-chunks'});e.sessions[0].handler({serverContent:{inputTranscription:{text:'Segunda.'},turnComplete:true}});await e.fire(900);await flush();assert.equal(transforms,1);assert.equal(e.events.filter(m=>m.payload?.event==='stt-final').length,1);assert.equal(e.events.find(m=>m.payload?.event==='stt-final').payload.text,'Consolidado.');assert.equal(new Set(e.events.filter(m=>m.payload?.event?.startsWith('stt-')).map(m=>m.payload.jobId)).size,1);
});
test('cancelar realtime com chunks em fila ignora respostas tardias e não transforma',async()=>{
 let transforms=0;const e=fixture(undefined,options=>options.mode==='agent'?{sendTurn:async()=>{transforms++;return{text:'Nunca.'};}}:{});await e.command({...start('cancel-chunks'),realtime:true,transformInstruction:'Formatação original.'});
 await e.command({operation:'STT_LIVE_AUDIO',jobId:'cancel-chunks',audioBase64:'AAA=',chunk:{jobId:'cancel-chunks',chunkId:'cancel-chunks:1',sequence:1,packetSequence:1,startMs:0,endMs:.0625,overlapMs:0,status:'streaming'}});await e.command({operation:'STT_LIVE_CANCEL',jobId:'cancel-chunks'});await flush();const count=e.events.length;e.sessions[0].handler({serverContent:{inputTranscription:{text:'Tardio.'},turnComplete:true}});await e.fire(900);assert.equal(e.events.length,count);assert.equal(transforms,0);assert.equal((await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'})).jobs[0].status,'cancelled');
});
test('dois ditados mantêm PCM, origem, segmentos e cancelamento independentes; sem limite de gravação',async()=>{
 const e=fixture();await e.command(start('one'));await e.command(start('two'));await flush();
 assert.ok([...e.timers.values()].every(t=>t.ms===250),'somente debounce de diagnóstico, sem timer de duração de gravação');
 await e.command({operation:'STT_LIVE_AUDIO',jobId:'one',audioBase64:'AAA=',sampleRate:16000});
 await e.command({operation:'STT_LIVE_AUDIO',jobId:'two',audioBase64:'AAAAAA==',sampleRate:16000});
 assert.deepEqual(e.sessions.map(s=>s.sent),[[2],[4]]);
 e.sessions[0].handler({serverContent:{interimInputTranscription:{text:'provisório'},inputTranscription:{text:'confirmado'}}});await flush();
 const packets=e.events.filter(x=>x.payload?.event==='stt-partial').map(x=>x.payload);
 assert.equal(packets[0].confirmed,false);assert.equal(packets[0].confirmedText,'');assert.equal(packets[1].confirmed,true);assert.equal(packets[1].confirmedText,'confirmado');assert.equal(packets[1].partialText,'');
 await e.command({operation:'STT_LIVE_CANCEL',jobId:'one'});await flush();
 const count=e.events.length;e.sessions[0].handler({serverContent:{inputTranscription:{text:'atrasado'},turnComplete:true}});await flush();assert.equal(e.events.length,count);
 const state=await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});assert.deepEqual(Array.from(state.activeJobIds),['two']);assert.equal(e.sessions[1].closed,undefined);
 assert.equal(state.jobs.find(x=>x.jobId==='one').status,'cancelled');assert.equal(state.jobs.find(x=>x.jobId==='two').origin.documentId,'original-document');
 await e.command({operation:'STT_LIVE_CANCEL',jobId:'two'});
});
test('perda de origem finaliza apenas PCM já recebido, preserva texto incompleto e não reproduz saída do assistente',async()=>{
 const e=fixture();await e.command(start('lost'));e.sessions[0].handler({serverContent:{inputTranscription:{text:'resultado recuperável'},outputTranscription:{text:'não é ditado'},modelTurn:{parts:[{text:'não é ditado'}]}}});
 await e.command({operation:'STT_ORIGIN_LOST',jobId:'lost'});assert.equal(e.sessions[0].ended,true);
 e.sessions[0].handler({serverContent:{turnComplete:true}});await e.fire(900);
 const result=e.events.find(x=>x.payload?.event==='stt-final').payload;assert.equal(result.text,'resultado recuperável');assert.equal(result.incomplete,true);
 const state=await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'});assert.equal(state.activeJobIds.length,0);assert.equal(state.jobs[0].incomplete,true);assert.equal(e.sessions[0].closed,true);
 assert.ok(e.events.some(x=>x.type==='LIVE_OFFSCREEN_IDLE'));
});
test('evento terminal rejeitado tem retries finitos, snapshot recuperável e ACK posterior libera fechamento',async()=>{
 let reject=true;const e=fixture(msg=>{if(reject&&msg.payload?.event==='stt-final')throw Error('worker reiniciando');return{success:true};});
 await e.command(start('retry'));e.sessions[0].handler({serverContent:{inputTranscription:{text:'resultado final'}}});await e.command({operation:'STT_LIVE_STOP',jobId:'retry'});e.sessions[0].handler({serverContent:{turnComplete:true}});await e.fire(900);
 assert.equal(e.events.filter(x=>x.payload?.event==='stt-final').length,3);assert.equal(e.events.some(x=>x.type==='LIVE_OFFSCREEN_IDLE'),false);
 const snapshot=await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'}),job=snapshot.jobs[0];assert.equal(job.text,'resultado final');assert.equal(job.status,'inserting');assert.equal(snapshot.activeJobIds.length,0);
 reject=false;await e.command({operation:'GLOBAL_JOBS_ACK',sequences:{retry:job.eventSeq}});await flush();assert.ok(e.events.some(x=>x.type==='LIVE_OFFSCREEN_IDLE'));
 const seq=e.events.filter(x=>x.type==='LIVE_OFFSCREEN_EVENT').map(x=>x.payload.eventSeq);assert.ok(seq.every((v,i)=>i===0||v>=seq[i-1]));
});
test('cancelar transformação com AbortError não abre próximas chaves/modelos nem publica final atrasado',async()=>{
 const e=fixture(undefined,options=>options.mode==='agent'?{sendTurn(_text,_callback,signal){return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}:{});
 await e.command({...start('transform-cancel'),apiKeys:Array.from({length:9},(_,i)=>'fake-'+i),transformInstruction:'Instrução pública de teste.'});e.sessions[0].handler({serverContent:{inputTranscription:{text:'Texto de teste.'}}});await e.command({operation:'STT_LIVE_STOP',jobId:'transform-cancel'});e.sessions[0].handler({serverContent:{turnComplete:true}});await e.fire(900);assert.equal(e.sessions.length,2);
 await e.command({operation:'STT_LIVE_CANCEL',jobId:'transform-cancel'});await flush();assert.equal(e.sessions.length,2);assert.ok(e.sessions.every(s=>s.closed));assert.equal(e.events.some(x=>x.payload?.event==='stt-final'),false);assert.equal((await e.command({operation:'GLOBAL_JOBS_SNAPSHOT'})).jobs[0].status,'cancelled');
});
test('scheduler integra nove jobs realtime com afinidade de sessão, cancelamento individual e finais ordenados',async()=>{
 const e=fixture(),keys=Array.from({length:9},(_,i)=>'unit-independent-'+i),ids=keys.map((_,i)=>'concurrent-'+i);
 const starts=await Promise.all(ids.map(id=>e.command({...start(id),apiKeys:keys,realtime:true,agentId:'agent-preserved',vad:{disabled:false}})));
 assert.ok(starts.every(x=>x.success));assert.equal(e.sessions.length,9);assert.equal(new Set(e.sessions.map(s=>s.options.keyIndex)).size,9);assert.ok(e.sessions.every(s=>s.options.modelId==='gemini-3.8-live'&&s.options.vad.disabled));
 for(const id of ids){const packets=[],capture=new(require('../stt-realtime.js').CapturePipeline)({jobId:id,realtime:true,submitAudioChunk:p=>packets.push(p)});for(let turn=0;turn<2;turn++){const pcm=new Uint8Array(3200);new Int16Array(pcm.buffer).fill(3000);capture.push(pcm);for(let n=0;n<5;n++)capture.push(new Uint8Array(3200));}capture.finish();for(const p of packets)assert.equal((await e.command({operation:'STT_LIVE_AUDIO',jobId:id,sampleRate:16000,chunk:p.chunk,...(p.endOnly?{endOnly:true}:{audioBase64:Buffer.from(p.pcm).toString('base64')})})).success,true);}
 const first=e.sessions.find(s=>s.options.jobId===ids[0]);await e.command({operation:'STT_LIVE_CANCEL',jobId:ids[0]});const before=e.events.length;first.handler({serverContent:{inputTranscription:{text:'Nunca inserir.'}}});assert.equal(e.events.length,before);
 // Acquires concorrentes não garantem ordem de criação: identidade vem do jobId, não do índice.
 const active=e.sessions.filter(s=>s.options.jobId!==ids[0]);assert.equal(active.length,8);assert.equal(first.sent.length,6);
 for(const s of active)s.handler({usageMetadata:{promptTokenCount:200},serverContent:{inputTranscription:{text:s.options.jobId+' primeiro.'}}});await e.fire(900);
 for(const s of active){assert.equal(s.sent.length,12);await e.command({operation:'STT_LIVE_STOP',jobId:s.options.jobId});s.handler({serverContent:{inputTranscription:{text:'Segundo.'}}});}await e.fire(900);await flush();
 const finals=e.events.filter(x=>x.payload?.event==='stt-final');assert.equal(finals.length,8);for(const f of finals)assert.equal(f.payload.text,f.payload.jobId+' primeiro. Segundo.');assert.equal(e.sessions.length,9,'nenhuma sessão adicional por chunk');
 const diagnostic=await e.command({operation:'STT_SCHEDULER_SNAPSHOT'});assert.equal(diagnostic.diagnostics.activeJobs,0);assert.ok(diagnostic.diagnostics.accounts.every(a=>a.activeJobs===0));
});
test('429 de socket após PCM não faz fallback; job seguinte evita a conta em cooldown',async()=>{
 const e=fixture(),apiKeys=['unit-account-1','unit-account-2'];await e.command({...start('socket-a'),apiKeys});const old=e.sessions[0];await e.command({operation:'STT_LIVE_AUDIO',jobId:'socket-a',audioBase64:'AAA=',sampleRate:16000});old.handler({error:{message:'quota',cause:Object.assign(Error('429 quota'),{httpStatus:429})}});await flush();assert.equal(e.sessions.length,1);assert.equal(old.closed,true);
 await e.command({...start('socket-b'),apiKeys});assert.equal(e.sessions.length,2);assert.equal(e.sessions[1].options.keyIndex,2);const failed=await e.command({operation:'STT_LIVE_AUDIO',jobId:'socket-a',audioBase64:'AAA='});assert.equal(failed.success,false);assert.equal(old.sent.length,1);await e.command({operation:'STT_LIVE_CANCEL',jobId:'socket-b'});
});
