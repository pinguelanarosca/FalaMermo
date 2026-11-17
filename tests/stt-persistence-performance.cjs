'use strict';
// Real Chrome IndexedDB; only the remote provider is controlled. No keys or microphone.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-stt-perf-'));
fs.mkdirSync(out,{recursive:true,mode:0o700});let browser,buffer='',serial=0;const pending=new Map();
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},180000);pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});}
async function evaluate(session,expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function benchmark(label,historyCount,packets){
 const source=label==='working'?fs.readFileSync(path.join(root,'stt-realtime.js'),'utf8'):cp.execFileSync('git',['show',label+':stt-realtime.js'],{cwd:root,encoding:'utf8'});
 await evaluate(globalThis.session,source);
 return evaluate(globalThis.session,`(${run.toString()})(${JSON.stringify({label,historyCount,packets})})`);
}
async function run({label,historyCount,packets}){
 const samples=[],metrics={transactions:0,getAll:0,gets:0};
 const txOriginal=IDBDatabase.prototype.transaction,getAllOriginal=IDBObjectStore.prototype.getAll,getOriginal=IDBObjectStore.prototype.get;
 IDBDatabase.prototype.transaction=function(...args){metrics.transactions++;return txOriginal.apply(this,args);};IDBObjectStore.prototype.getAll=function(...args){metrics.getAll++;return getAllOriginal.apply(this,args);};IDBObjectStore.prototype.get=function(...args){metrics.gets++;return getOriginal.apply(this,args);};
 const store=new SttRealtime.RecoveryStore({name:'performance-'+label+'-'+historyCount+'-'+Date.now(),onArchive:()=>{}});
 try{
 const db=await store.open();await new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readwrite'),jobs=tx.objectStore('jobs');for(let i=0;i<historyCount;i++)jobs.put({jobId:'history-'+i,createdAt:i,state:'completed',bytes:0,packets:0,settings:{instructions:'historical-config '.repeat(128)}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
 await store.start('dictation');metrics.transactions=metrics.getAll=metrics.gets=0;
 const pcm=new Uint8Array(3200);for(let i=0;i<pcm.length;i++)pcm[i]=i%251;
 const begin=performance.now();
 for(let i=1;i<=packets;i++){const at=performance.now();await store.append('dictation',{pcm,chunk:{packetSequence:i,sequence:Math.ceil(i/120),startMs:(i-1)*100,endMs:i*100,overlapMs:0}});samples.push(performance.now()-at);}
 const elapsed=performance.now()-begin,counts={...metrics};
 const saved=await store.packets('dictation'),job=(await store.list()).find(j=>j.jobId==='dictation');
 const exact=saved.length===packets&&saved.every((p,i)=>p.packetSequence===i+1&&new Uint8Array(p.pcm).every((v,n)=>v===pcm[n]));if(!exact)throw Error('PCM mismatch');
 const ordered=[...samples].sort((a,b)=>a-b),q=p=>ordered[Math.min(ordered.length-1,Math.floor(p*ordered.length))];
 return{label,historyCount,packets,audioSeconds:packets/10,pcmBytes:job.bytes,elapsedMs:elapsed,packetsPerSecond:packets*1000/elapsed,meanMs:elapsed/packets,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:ordered.at(-1),counts,exact,latenciesMs:samples};
 }finally{IDBDatabase.prototype.transaction=txOriginal;IDBObjectStore.prototype.getAll=getAllOriginal;IDBObjectStore.prototype.get=getOriginal;const db=await store.open();const name=db.name;db.close();indexedDB.deleteDatabase(name);}
}
async function runQueue({label,plannedPackets=18000,intervalMs=3}){
 const store=new SttRealtime.RecoveryStore({name:'queue-'+label+'-'+Date.now(),onArchive:()=>{}}),db=await store.open();
 await new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readwrite');for(let i=0;i<120;i++)tx.objectStore('jobs').put({jobId:'old-'+i,state:'completed',bytes:0,createdAt:i,settings:{instructions:'historical-config '.repeat(128)}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});await store.start('long');
 const errors={BACKPRESSURE:0,ACK_TIMEOUT:0,CHUNK_TIMEOUT:0},metrics={},persist=[],timeline=[],wire=[],newAudio=[],input=[];let peak=0,created=0,closed=0,arrival=0;
 const transport=new SttRealtime.DistributedDictation({jobId:'long',copies:1,retain:async p=>{const at=performance.now();await store.append('long',p);persist.push(performance.now()-at);},onFailure:e=>{if(e.code in errors)errors[e.code]++;},openLane:async options=>{created++;return{timeoutMs:15000,send:(pcm,hasNewSpeech)=>{wire.push(pcm.slice());if(hasNewSpeech)newAudio.push(pcm.slice());},end:()=>queueMicrotask(()=>options.receive({inputTranscription:{text:'block '+options.sequence,finished:true}})),close:()=>closed++,confirm:()=>{}};}});
 const queue=new DictationRuntime.AudioQueue({metrics,onFailure:e=>{if(e.code in errors)errors[e.code]++;},onProgress:m=>{peak=Math.max(peak,m.pendingChunks);},send:async p=>{await transport.submitAudioChunk(p);return{success:true};}});
 const pipeline=new SttRealtime.CapturePipeline({jobId:'long',realtime:true,continuous:true,submitAudioChunk:p=>queue.push(p,p.pcm.length)});
 const pcm=new Uint8Array(3200);for(let i=0;i<pcm.length;i++)pcm[i]=i%251;const begin=performance.now();
 while(arrival<plannedPackets&&!queue.failure){arrival++;new DataView(pcm.buffer).setUint32(0,arrival,true);input.push(pcm.slice());pipeline.push(pcm.slice(),true);if(arrival%100===0)timeline.push({atMs:performance.now()-begin,packets:arrival,pending:metrics.pendingChunks,persistencePending:transport.queuedPackets,blocks:transport.pendingBlocks});await new Promise(r=>setTimeout(r,intervalMs));}
 pipeline.finish();const inputEnded=performance.now();let failed=null,result;
 try{await queue.drain();result=await transport.finish();}catch(e){failed=e.code||e.message;}
 const ended=performance.now(),stored=await store.packets('long'),sorted=[...persist].sort((a,b)=>a-b),size=a=>a.reduce((sum,p)=>sum+p.byteLength,0);
 const digest=async parts=>{const bytes=new Uint8Array(size(parts));let offset=0;for(const p of parts){bytes.set(new Uint8Array(p),offset);offset+=p.byteLength;}return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');};
 const inputHash=await digest(input),wireHash=await digest(wire),newAudioHash=await digest(newAudio),storedHash=await digest(stored.map(p=>p.pcm));
 const outcome={label,plannedPackets,arrivedPackets:arrival,representedAudioSeconds:arrival/10,intervalMs,elapsedMs:ended-begin,drainMs:ended-inputEnded,peakPending:peak,pendingAtLastSample:timeline.at(-1)?.pending,pendingAfterDrain:metrics.pendingChunks,queueWaitMaxMs:metrics.maxQueueWaitMs,ackPackets:metrics.ackChunks,wireBytes:size(wire),contextBytes:size(wire)-size(newAudio),storedBytes:size(stored.map(p=>p.pcm)),persistedPackets:persist.length,persistMeanMs:persist.reduce((a,b)=>a+b,0)/persist.length,persistP95Ms:sorted[Math.floor(sorted.length*.95)],throughputPps:persist.length*1000/(ended-begin),errors,failed,sessionsCreated:created,sessionsClosed:closed,exact:inputHash===newAudioHash&&newAudioHash===storedHash,storedEqualsNewAudio:newAudioHash===storedHash,hashes:{input:inputHash,wire:wireHash,newAudio:newAudioHash,stored:storedHash},result,timeline};
 transport.cancel();db.close();indexedDB.deleteDatabase(db.name);return outcome;
}
async function diagnosticLoad(){
 const original=chrome.runtime.sendMessage.bind(chrome.runtime),pending=[],job={jobId:crypto.randomUUID(),startedAt:Date.now()},started=performance.now();let messages=0;
 chrome.runtime.sendMessage=(...args)=>{messages++;const response=original(...args);pending.push(response);return response;};
 try{for(let i=0;i<1000;i++)LiveSttDiagnostics.capture(job,'vad-decision',{detector:'dual',analyzedFrames:3,tenFrames:6,dualConfirmations:i%2,dualRejections:1-i%2,sileroProbability:.8,tenProbability:.8});LiveSttDiagnostics.ending(job,'user-stop');const dispatchMs=performance.now()-started;await Promise.all(pending);return{messages,dispatchMs,drainMs:performance.now()-started-dispatchMs};}finally{chrome.runtime.sendMessage=original;}
}
async function integrity(){
 const archive=TaskArchive.getDefault(),store=new SttRealtime.RecoveryStore({name:'integrity-'+Date.now(),maxJobBytes:24,maxTotalBytes:24,archive,onArchive:()=>{}}),pcm=new Uint8Array([1,2,3,4,5,6,7,8]),packet=n=>({pcm,chunk:{packetSequence:n,sequence:1,startMs:0,endMs:1,overlapMs:0}});
 for(const id of ['old','pinned','current']){await store.start(id);await store.append(id,packet(1));if(id!=='current')await store.update(id,{state:'completed'});}await store.pin('pinned',true);await store.append('current',packet(2));
 const active=await store.list(),saved=await archive.packets('old');if(active.some(j=>j.jobId==='old')||!active.find(j=>j.jobId==='pinned')?.pinned||saved.length!==1||!new Uint8Array(saved[0].pcm).every((v,i)=>v===pcm[i]))throw Error('Archive integrity failed');
 let noRoom=false;try{await store.restoreArchived('old');}catch(e){noRoom=e.code==='RECOVERY_LIMIT';}if(!noRoom)throw Error('Pinned/recording must remain protected');
 await store.pin('pinned',false);await store.restoreArchived('old');if(!(await store.list()).some(j=>j.jobId==='old'))throw Error('Restore failed');
 const concurrent=new SttRealtime.RecoveryStore({name:'concurrent-'+Date.now(),maxJobBytes:32,maxTotalBytes:24,onArchive:()=>{}});for(const id of ['a','b']){await concurrent.start(id);await concurrent.append(id,packet(1));}
 const peer=new SttRealtime.RecoveryStore({name:concurrent.name,maxJobBytes:32,maxTotalBytes:24,onArchive:()=>{}}),attempts=await Promise.allSettled([concurrent.append('a',packet(2)),peer.append('b',packet(2))]),jobs=await concurrent.list();if(attempts.filter(r=>r.status==='fulfilled').length!==1||jobs.reduce((sum,j)=>sum+j.bytes,0)!==24)throw Error('Concurrent budget failed');
 const duplicate=new SttRealtime.RecoveryStore({name:'duplicate-'+Date.now(),maxJobBytes:16,maxTotalBytes:16});await duplicate.start('dup');await duplicate.append('dup',packet(1));let rejected=false;try{await duplicate.append('dup',packet(1));}catch{rejected=true;}const dup=(await duplicate.list())[0];if(!rejected||dup.bytes!==8||dup.packets!==1)throw Error('Duplicate was not rolled back');await duplicate.append('dup',packet(2));let perJob=false;try{await duplicate.append('dup',packet(3));}catch(e){perJob=e.code==='RECOVERY_LIMIT';}if(!perJob||(await duplicate.list())[0].bytes!==16)throw Error('Job limit failed');
 return{archiveExact:true,activeBudgetBytes:active.reduce((sum,j)=>sum+j.bytes,0),pinnedAndRecordingProtected:true,restoreExact:true,concurrentBudgetBytes:24,concurrentSuccesses:1,duplicateTransactionRolledBack:true,perJobLimitPreserved:true};
}
(async()=>{try{
 browser=cp.spawn('google-chrome',['--headless','--no-sandbox','--disable-background-networking','--no-first-run','--enable-unsafe-extension-debugging','--remote-debugging-pipe','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});browser.stderr.pipe(fs.createWriteStream(path.join(out,'chrome.log')));browser.stdio[4].on('data',b=>{buffer+=b;let at;while((at=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
 const version=await call('Browser.getVersion'),{id}=await call('Extensions.loadUnpacked',{path:root});const {targetId}=await call('Target.createTarget',{url:'chrome-extension://'+id+'/offscreen.html'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});globalThis.session=sessionId;
 await evaluate(sessionId,`new Promise(r=>{if(document.readyState==='complete')r();else addEventListener('load',r,{once:true});})`);
 await evaluate(sessionId,fs.readFileSync(path.join(root,'dictation-runtime.js'),'utf8'));
 const results=[];const labels=process.argv.includes('--working-only')?['working']:process.argv.includes('--baseline')?['v1.0.6','v1.0.7']:['v1.0.6','v1.0.7','working'];if(!process.argv.includes('--queues-only')&&!process.argv.includes('--integrity-only')&&!process.argv.includes('--diagnostics-only'))for(const history of [0,120])for(const label of labels){const result=await benchmark(label,history,1800);results.push(result);console.log(JSON.stringify({...result,latenciesMs:undefined}));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({version,results},null,2));}
 if(process.argv.includes('--diagnostics-only'))for(const label of labels){await evaluate(sessionId,label==='working'?fs.readFileSync(path.join(root,'live-stt-diagnostics.js'),'utf8'):cp.execFileSync('git',['show',label+':live-stt-diagnostics.js'],{cwd:root,encoding:'utf8'}));const result={label,...await evaluate(sessionId,`(${diagnosticLoad.toString()})()`)};results.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(out,'diagnostics.json'),JSON.stringify({version,results},null,2));}
 if(process.argv.includes('--queues-only'))for(const label of labels){const source=label==='working'?fs.readFileSync(path.join(root,'stt-realtime.js'),'utf8'):cp.execFileSync('git',['show',label+':stt-realtime.js'],{cwd:root,encoding:'utf8'});await evaluate(sessionId,source);const result=await evaluate(sessionId,`(${runQueue.toString()})(${JSON.stringify({label,plannedPackets:process.argv.includes('--long')?18000:1800})})`);results.push(result);console.log(JSON.stringify({...result,timeline:undefined,result:undefined,hashes:undefined}));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({version,results},null,2));}
 if(process.argv.includes('--integrity-only')){await evaluate(sessionId,fs.readFileSync(path.join(root,'stt-realtime.js'),'utf8'));const result=await evaluate(sessionId,`(${integrity.toString()})()`);console.log(JSON.stringify(result));fs.writeFileSync(path.join(out,'integrity.json'),JSON.stringify({version,result},null,2));}
 }finally{browser?.kill();for(const p of pending.values())clearTimeout(p.timer);}})().catch(e=>{console.error(e);process.exitCode=1;});
