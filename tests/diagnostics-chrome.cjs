'use strict';
// Actual extension, Chrome UI/IPC/IndexedDB and official WASM detectors. No credentials.
// The long queue benchmark controls the remote provider; it does not measure Gemini latency.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-diagnostics-'));let chrome,n=0,buffer='';const pending=new Map();
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>{pending.delete(id);reject(Error('timeout '+method));},240000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});}
async function evaluate(sessionId,expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function page(url){const {targetId}=await call('Target.createTarget',{url}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});await evaluate(sessionId,`new Promise(r=>{if(document.readyState==='complete')r();else addEventListener('load',r,{once:true});})`);return{targetId,sessionId};}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<60;i++){if(await fn())return;await delay(100);}throw Error('Não observado: '+label);}
const jobId='a1234567-1234-1234-1234-123456789abc';
(async()=>{try{
 chrome=spawn(process.env.FALAMERMO_CHROME||'google-chrome',['--headless','--no-sandbox','--no-first-run','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});chrome.stderr.pipe(fs.createWriteStream(path.join(out,'chrome.log')));chrome.stdio[4].on('data',b=>{buffer+=b;let at;while((at=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
 const version=await call('Browser.getVersion'),{id}=await call('Extensions.loadUnpacked',{path:root}),base='chrome-extension://'+id+'/';
 const options=await page(base+'options.html'),offscreen=await page(base+'offscreen.html');
 assert.equal(await evaluate(options.sessionId,`document.querySelector('a[href="diagnostics.html"]').textContent.includes('Central de Diagnóstico')`),true);
 const central=await page(base+'diagnostics.html');await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false},central.sessionId);
 const targets=await call('Target.getTargets'),bg=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url===base+'background.js');assert.ok(bg);const {sessionId:bgSession}=await call('Target.attachToTarget',{targetId:bg.targetId,flatten:true});
 await evaluate(bgSession,'DiagnosticsHub.ready');
 const configure=async mode=>{const result=await evaluate(options.sessionId,`chrome.runtime.sendMessage({type:'DIAGNOSTICS_CONFIG',config:{mode:'${mode}',capacity:4000}})`);assert.equal(result.success,true);await evaluate(offscreen.sessionId,`FalaDiagnostics.configure({mode:'${mode}',capacity:4000})`);};
 await configure('forensic');
 await evaluate(options.sessionId,`(async()=>{await FalaDiagnostics.ready;LiveSttDiagnostics.capture({jobId:'${jobId}'},'capture-running');await FalaDiagnostics.send();})()`);
 await evaluate(offscreen.sessionId,`(async()=>{LiveSttDiagnostics.emit({jobId:'${jobId}',scope:'transport',stage:'setup-complete',sessionId:'live-1791482000000-abc',sequence:1});LiveTtsDiagnostics.captureEvent({operation:'TTS_LIVE_START',jobId:'manual-1791482000000-test'},'first-pcm',{bytes:3200});await FalaDiagnostics.send();})()`);
 await until(()=>evaluate(central.sessionId,`document.querySelectorAll('#events tr').length>=3`),'timeline');
 const duplicate=await evaluate(options.sessionId,`(async()=>{const sourceId='options-'+Date.now()+'-dedup',event={component:'stt',category:'transport',stage:'error',severity:'error',jobId:'${jobId}',at:Date.now(),sourceId,sourceSeq:1,context:'options',code:'ACK_TIMEOUT',details:{sequence:9999}},payload={sourceId,context:'options',events:[event]};const first=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_BATCH',payload}),second=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_BATCH',payload}),rejected=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_BATCH',payload:{...payload,context:'content'}}),snapshot=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_GET',export:true});return{first:first.success,second:second.success,rejected:rejected.success,count:snapshot.events.filter(e=>e.sourceId===sourceId).length};})()`);
 assert.deepEqual(duplicate,{first:true,second:true,rejected:false,count:1});
 const summary=await evaluate(options.sessionId,`chrome.runtime.sendMessage({type:'LIVE_STT_DIAGNOSTICS_GET'})`);assert.equal(summary.success,true);assert.ok(summary.diagnostics.jobs.some(j=>j.jobId===jobId&&j.capture&&j.transport));
 await evaluate(offscreen.sessionId,`Promise.reject(Error('PRIVATE_TEST_CREDENTIAL'));undefined`);await delay(100);await evaluate(offscreen.sessionId,'FalaDiagnostics.send()');
 const snapshot=await evaluate(options.sessionId,`chrome.runtime.sendMessage({type:'DIAGNOSTICS_GET',export:true})`);assert.equal(snapshot.success,true);assert.ok(snapshot.events.some(e=>e.jobId===jobId&&e.context==='options'));assert.ok(snapshot.events.some(e=>e.jobId===jobId&&e.context==='offscreen'));assert.ok(snapshot.events.some(e=>e.component==='tts'));assert.ok(snapshot.events.some(e=>e.code==='UNHANDLED_REJECTION'));
 await evaluate(central.sessionId,`document.getElementById('component').value='tts';document.getElementById('component').dispatchEvent(new Event('change'));`);
 assert.equal(await evaluate(central.sessionId,`[...document.querySelectorAll('#events tr')].every(r=>r.children[1].textContent.startsWith('tts /'))`),true);
 await evaluate(central.sessionId,`document.getElementById('component').value='';document.getElementById('component').dispatchEvent(new Event('change'));document.getElementById('pause').click();`);
 const before=await evaluate(central.sessionId,`document.getElementById('events').textContent`);
 await evaluate(offscreen.sessionId,`(async()=>{FalaDiagnostics.event({component:'stt',category:'transport',stage:'error',jobId:'${jobId}',severity:'error',code:'CHUNK_TIMEOUT',details:{text:'PRIVATE_TEST_TRANSCRIPT',apiKey:'PRIVATE_TEST_CREDENTIAL',bytes:3200}});await FalaDiagnostics.send();})()`);
 await delay(650);assert.equal(await evaluate(central.sessionId,`document.getElementById('events').textContent`),before);
 await evaluate(central.sessionId,`document.getElementById('pause').click();`);await until(()=>evaluate(central.sessionId,`document.getElementById('events').textContent.includes('CHUNK_TIMEOUT')`),'retomada');
 const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},central.sessionId);fs.writeFileSync(path.join(out,'central.png'),Buffer.from(screenshot.data,'base64'));
 await evaluate(central.sessionId,`document.getElementById('clear').click()`);assert.equal(await evaluate(central.sessionId,`document.querySelectorAll('#events tr').length`),0);
 await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out});await evaluate(central.sessionId,`document.getElementById('save').click()`);
 await until(async()=>fs.readdirSync(out).some(f=>f.endsWith('.json')),'download JSON');
 const exportPath=path.join(out,fs.readdirSync(out).find(f=>f.endsWith('.json'))),exported=JSON.parse(fs.readFileSync(exportPath,'utf8'));assert.ok(exported.events.length>=snapshot.events.length);assert.ok(!JSON.stringify(exported).includes('PRIVATE_TEST_'));assert.ok(exported.events.some(e=>e.code==='CHUNK_TIMEOUT'));
 await call('Target.closeTarget',{targetId:central.targetId});
 await evaluate(offscreen.sessionId,`(async()=>{FalaDiagnostics.event({component:'system',category:'task',stage:'state-transition',jobId:'${jobId}',details:{status:'cancelled'}});await FalaDiagnostics.send();})()`);
 assert.ok((await evaluate(options.sessionId,`chrome.runtime.sendMessage({type:'DIAGNOSTICS_GET',export:true})`)).events.some(e=>e.stage==='state-transition'));
 await evaluate(bgSession,'DiagnosticsHub.checkpoint()');assert.ok(await evaluate(bgSession,`chrome.storage.session.get(DiagnosticsCore.CHECKPOINT_KEY).then(v=>v[DiagnosticsCore.CHECKPOINT_KEY].events.length>0)`));
 const ui={screenshot:path.join(out,'central.png'),optionsLink:true,correlationAcrossContexts:true,filter:true,pause:true,clearOnlyView:true,download:exportPath,sanitized:true,closedPageCollection:true,checkpoint:true,deduplication:duplicate.count===1,legacyProjection:true,unhandledRejection:true};
 console.log(JSON.stringify({version,ui}));fs.writeFileSync(path.join(out,'ui-results.json'),JSON.stringify({version,ui},null,2));if(process.argv.includes('--ui-only')&&!process.argv.includes('--view-performance')){console.log(JSON.stringify({out,PASS:true}));return;}
 if(process.argv.includes('--view-performance')){
  const monitor=await page(base+'diagnostics.html');await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false},monitor.sessionId);await call('Performance.enable',{},monitor.sessionId);
  const metrics=async()=>Object.fromEntries((await call('Performance.getMetrics',{},monitor.sessionId)).metrics.map(m=>[m.name,m.value]));
  const emit=async(first,count)=>evaluate(offscreen.sessionId,`(async()=>{for(let i=${first};i<${first+count};i++)FalaDiagnostics.event({component:'stt',category:'capture',stage:'packet-created',jobId:'${jobId}',details:{packetSequence:i,bytes:3200}});for(let i=0;i<8;i++)await FalaDiagnostics.send();})()`);
  const before=await metrics();await emit(1,600);await until(()=>evaluate(monitor.sessionId,`document.querySelectorAll('#events tr').length===500`),'500 linhas');await delay(600);const loaded=await metrics();
  await evaluate(monitor.sessionId,`globalThis.retainedRow=document.querySelectorAll('#events tr')[100]`);await emit(601,50);await until(()=>evaluate(monitor.sessionId,`document.getElementById('events').textContent.includes('"packetSequence":650')`),'atualização incremental');await delay(50);const updated=await metrics();
  const retained=await evaluate(monitor.sessionId,`retainedRow.isConnected&&document.querySelectorAll('#events tr').length===500`);assert.equal(retained,true);
  const delta=(a,b)=>Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k+'Ms',(b[k]-a[k])*1000]));
  const viewPerformance={initial600:delta(before,loaded),append50:delta(loaded,updated),domRows:500,reusedExistingRows:retained,note:'renderer counters over observation windows; includes polling and callbacks, not exclusive function CPU'};console.log(JSON.stringify({viewPerformance}));fs.writeFileSync(path.join(out,'view-performance.json'),JSON.stringify(viewPerformance,null,2));console.log(JSON.stringify({out,PASS:true}));return;
 }
 // Real capture using Chrome's virtual input and the production AudioWorklet/resampler/VAD client.
 await evaluate(options.sessionId,`globalThis.testVadWorker=new Worker('stt-vad-worker.js');globalThis.vadPending=new Map();globalThis.vadSerial=0;testVadWorker.onmessage=({data})=>{const resolve=vadPending.get(data.request);if(resolve){vadPending.delete(data.request);resolve(data);}};globalThis.vadCall=data=>new Promise(resolve=>{const request=++vadSerial;vadPending.set(request,resolve);testVadWorker.postMessage({...data,request});});`);
 assert.equal((await evaluate(options.sessionId,`vadCall({operation:'prepare',warm:true})`)).ok,true);
 const capture=await evaluate(options.sessionId,`(async()=>{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true}),context=new AudioContext({sampleRate:16000});await context.audioWorklet.addModule(chrome.runtime.getURL('mic-capture-worklet.js'));
  const jobId=crypto.randomUUID(),source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'gemini-mic-capture'),mute=context.createGain(),state={cursor:0,previous:0},capture={jobId,stream,context,node,source,mute};mute.gain.value=0;source.connect(node).connect(mute).connect(context.destination);
  let packets=0,consumed=0,failures=0;const vad=new SttVadLocal.CaptureVad({jobId,analyze:item=>vadCall({operation:'analyze',id:jobId,seq:item.seq,bytes:item.pcm.buffer.slice(0),final:item.final}),consume:()=>consumed++,onFailure:()=>failures++,recover:()=>vadCall({operation:'open',id:jobId})});await vad.prepare(vadCall({operation:'open',id:jobId}));
  node.port.onmessage=({data})=>{if(!(data instanceof ArrayBuffer))return;const input=new Float32Array(data),pcm=resampleLiveTest(input,context.sampleRate,state);LiveSttDiagnostics.observe(capture,input,pcm);packets++;vad.push(pcm);};LiveSttDiagnostics.capture(capture,'capture-running');await context.resume();await new Promise(r=>setTimeout(r,3200));source.disconnect();node.disconnect();stream.getTracks().forEach(t=>t.stop());await vad.barrier(()=>{});LiveSttDiagnostics.ending(capture,'user-stop');vad.cancel();await context.close();await vadCall({operation:'close',id:jobId});await FalaDiagnostics.send();return{jobId,packets,consumed,failures,capturedBytes:capture.metrics.capturedBytes};
 })()`);
 assert.ok(capture.packets>=20);assert.equal(capture.consumed,capture.packets);assert.equal(capture.failures,0);console.log(JSON.stringify({capture}));
 await evaluate(options.sessionId,'testVadWorker.terminate()');
 // CPU-only instrumentation, wall clock measured in the real Chrome engine, 30 min at 10 packets/s.
 const cpu=await evaluate(offscreen.sessionId,`(()=>{
  const results=[];for(const mode of ['off','normal','forensic']){const samples=[];for(let round=0;round<5;round++){
   const d=DiagnosticsCore.create({context:'offscreen',settings:{mode}}),q=d.queue('persist-send','${jobId}'),at=performance.now();
   for(let i=0;i<18000;i++){const token=q.enter({packetSequence:i,bytes:3200});q.begin(token);const span=d.start('stt','persist-packet','${jobId}',{packetSequence:i,bytes:3200});d.finish(span);q.leave(token);if(i%100===0)d.flush();}d.flush();samples.push(performance.now()-at);
  }samples.sort((a,b)=>a-b);results.push({mode,packets:18000,medianMs:samples[2],runsMs:samples});}return results;
 })()`);console.log(JSON.stringify({cpu}));
 // Same production queue/transport/recovery benchmark for all modes. Controlled remote responses only.
 const source=fs.readFileSync(path.join(root,'tests/stt-persistence-performance.cjs'),'utf8'),runSource=source.slice(source.indexOf('async function runQueue('),source.indexOf('async function diagnosticLoad(')).replaceAll("'long'",JSON.stringify(jobId));
 await evaluate(offscreen.sessionId,fs.readFileSync(path.join(root,'dictation-runtime.js'),'utf8'));
 const results=[];for(const mode of ['off','normal','forensic']){
  await configure(mode);const result=await evaluate(offscreen.sessionId,`(${runSource})(${JSON.stringify({label:'diagnostics-'+mode,plannedPackets:process.argv.includes('--long')?18000:1800,intervalMs:3})})`);assert.equal(result.exact,true);assert.equal(result.failed,null);assert.equal(result.pendingAfterDrain,0);assert.deepEqual(result.errors,{BACKPRESSURE:0,ACK_TIMEOUT:0,CHUNK_TIMEOUT:0});const telemetry=await evaluate(offscreen.sessionId,`(()=>{const s=FalaDiagnostics.snapshot();return{retained:s.retained,bytes:s.bytes,dropped:s.dropped,aggregateLost:s.aggregateLost,failures:s.failures,config:s.config};})()`);results.push({mode,...result,telemetry});console.log(JSON.stringify({mode,...result,telemetry,timeline:undefined,result:undefined,hashes:undefined}));fs.writeFileSync(path.join(out,'performance.json'),JSON.stringify({version,cpu,capture,results},null,2));
 }
 console.log(JSON.stringify({out,PASS:true}));
 }finally{chrome?.kill();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('fim'));}}})().catch(error=>{console.error(error);console.error('Artefatos: '+out);process.exitCode=1;});
