'use strict';
// DOM, ErrorEvents, Silero/TEN WASM e fila local reais; perfil descartável, sem Gemini.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=process.env.FALAMERMO_AUDIT_SOURCE||root,out=fs.mkdtempSync(path.join(os.tmpdir(),'falamermo-runtime-audit-'));
let chrome,id=0,buffer='';const pending=new Map();
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('Timeout '+method));},15000);pending.set(n,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id:n,method,params,sessionId})+'\0');});}
async function evaluate(sessionId,expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.result.description||r.exceptionDetails.text);return r.result.value;}
async function browserCases(){
 const results=[];const check=async(name,fn)=>{try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}};
 const assert=(v,message)=>{if(!v)throw Error(message);};
 const make=()=>{const e=document.createElement('div');e.contentEditable='true';e.innerHTML='<p><br></p>';document.body.append(e);e.focus();const r=document.createRange();r.setStart(e.firstChild,0);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);return e;};
 const select=e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 await check('primeira escrita após rerender de placeholder preserva alvo lógico e final',async()=>{
  const e=make(),s=new DictationRuntime.Insertion(DictationRuntime.captureTarget(),{settleMs:5});e.innerHTML='<p><br></p>';
  const first=await s.apply('Primeira fala.',{sequence:1});assert(first.inserted,first.reason);assert((await s.apply('Primeira fala completa.',{sequence:1,final:true})).inserted,'final');assert(e.textContent==='Primeira fala completa.','conteúdo');s.dispose();e.remove();
 });
 await check('rerender antes da primeira escrita não apaga conteúdo externo',async()=>{
  const e=make(),s=new DictationRuntime.SessionInsertion(DictationRuntime.captureTarget(),{settleMs:5});e.textContent='Conteúdo externo.';assert(!(await s.apply('Não sobrescrever.',{final:true})).inserted,'recusar');assert(e.textContent==='Conteúdo externo.','externo preservado');s.dispose();e.remove();
 });
 await check('snapshot atrasado conserva offset original; destino removido não lança exceção',async()=>{
  const e=make();e.textContent='Antes depois';const range=document.createRange();range.setStart(e.firstChild,6);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);const target=DictationRuntime.captureTarget();e.innerHTML='<p>Antes depois</p>';
  const s=new DictationRuntime.Insertion(target,{settleMs:5}),r=await s.apply('fala ',{final:true});assert(r.inserted,r.reason);assert(e.textContent==='Antes fala depois','offset original');s.dispose();
  select(e);const removed=DictationRuntime.captureTarget();e.remove();const cancelled=new DictationRuntime.Insertion(removed);assert(!(await cancelled.apply('Não inserir.',{final:true})).inserted,'destino removido');cancelled.dispose();
 });
 await check('envio e limpeza confirmados durante captura retomam somente o próximo segmento',async()=>{
  const e=make(),form=document.createElement('form'),button=document.createElement('button');document.body.append(form);form.append(e,button);button.type='submit';select(e);
  form.onsubmit=event=>{event.preventDefault();e.innerHTML='<p><br></p>';};const s=new DictationRuntime.SessionInsertion(DictationRuntime.captureTarget(),{settleMs:5,onSend:()=>1});
  assert((await s.apply('Segmento enviado.',{sequence:1,textBoundaries:[[1,17]]})).inserted,'primeiro');button.click();await pause(10);
  const full='Segmento enviado. Fala nova.';const r=await s.apply(full,{sequence:2,textBoundaries:[[1,17],[2,full.length]],final:true});assert(r.inserted,r.reason);assert(e.textContent==='Fala nova.','não repetir segmento enviado');s.dispose();form.remove();
 });
 await check('edição manual simultânea ao provisório é preservada até o final',async()=>{
  const e=make(),s=new DictationRuntime.SessionInsertion(DictationRuntime.captureTarget(),{settleMs:35});let edited=false;e.addEventListener('input',()=>{if(edited)return;edited=true;setTimeout(()=>{e.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:'manual'}));e.textContent='Texto manual do usuário.';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'manual'}));},0);});
  await s.apply('Provisório.',{sequence:1});const r=await s.apply('Texto final reconhecido.',{sequence:1,final:true});assert(!r.inserted,'não confirmar inserção falsa');assert(e.textContent==='Texto manual do usuário.','manual preservado');s.dispose();e.remove();
 });
 await check('troca de foco não desvia inserção; navegação durante escrita invalida ACK',async()=>{
  const e=make(),s=new DictationRuntime.SessionInsertion(DictationRuntime.captureTarget(),{settleMs:25}),other=document.createElement('textarea');document.body.append(other);other.value='Outro destino';other.focus();const applying=s.apply('Texto do destino original.',{final:true});setTimeout(()=>s.invalidate('TARGET_DOCUMENT_LOST'),0);const r=await applying;assert(!r.inserted,'ACK após navegação');assert(other.value==='Outro destino','outro campo intocado');s.dispose();e.remove();other.remove();
 });
 return results;
}
(async()=>{try{
 chrome=spawn(process.env.FALAMERMO_CHROME||'google-chrome',['--headless','--no-sandbox','--no-first-run','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});chrome.stderr.pipe(fs.createWriteStream(path.join(out,'chrome.log')));chrome.stdio[4].on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
 const version=await call('Browser.getVersion'),loaded=await call('Extensions.loadUnpacked',{path:root}),base='chrome-extension://'+loaded.id+'/';
 const {targetId}=await call('Target.createTarget',{url:base+'options.html'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});await evaluate(sessionId,'new Promise(r=>document.readyState==="complete"?r():addEventListener("load",r,{once:true}))');
 for(const file of ['dictation-runtime.js','diagnostics-runtime.js'])await evaluate(sessionId,fs.readFileSync(path.join(source,file),'utf8')+'\n//# sourceURL='+base+file);
 const cases=await evaluate(sessionId,'('+browserCases.toString()+')()');console.log(JSON.stringify({version,cases}));
 if(!process.env.FALAMERMO_AUDIT_SOURCE){
  const exceptions=await evaluate(sessionId,`(async()=>{const d=DiagnosticsCore.create();const own=e=>d.exception(e,{extensionUrl:chrome.runtime.getURL('')});addEventListener('error',own);for(let i=0;i<8;i++)setTimeout(()=>DictationRuntime.textOf(null),0);await new Promise(r=>setTimeout(r,100));removeEventListener('error',own);d.flush();return d.snapshot();})()`);
  assert.equal(exceptions.events.length,1);assert.equal(exceptions.events[0].details.eventCount,8);assert.equal(exceptions.events[0].details.exceptionOrigin,'extension');assert.ok(exceptions.events[0].details.stack.some(f=>f.file==='dictation-runtime.js'));assert.ok(!JSON.stringify(exceptions).includes(base));console.log('PASS: 8 ErrorEvents reais, contagem única e stack sanitizada.');
  await evaluate(sessionId,`globalThis.auditWorker=new Worker('stt-vad-worker.js');globalThis.auditRequests=new Map();globalThis.auditSeq=0;auditWorker.onmessage=({data})=>{const f=auditRequests.get(data.request);if(f){auditRequests.delete(data.request);f(data);}};globalThis.auditCall=p=>new Promise(resolve=>{const request=++auditSeq;auditRequests.set(request,resolve);auditWorker.postMessage({...p,request});});`);
  assert.equal((await evaluate(sessionId,'auditCall({operation:"prepare",warm:true})')).ok,true);
  const voice=fs.readFileSync(path.join(root,'tests/vad-go-sintetico.pcm'));const low=Buffer.from(voice);for(let i=0;i<low.length;i+=2)low.writeInt16LE(Math.round(low.readInt16LE(i)*.1),i);
  const vad=[];for(const [name,pcm]of [['silence',Buffer.alloc(low.length)],['voice-low-volume',low]]){
   await evaluate(sessionId,`globalThis.auditPackets=[];globalThis.auditEvidence={confirmations:0,classified:0};globalThis.auditPipeline=new SttRealtime.CapturePipeline({jobId:'audit-${name}',realtime:true,continuous:true,submitAudioChunk:p=>auditPackets.push(p)});globalThis.auditVad=new SttVadLocal.CaptureVad({jobId:'audit-${name}',analyze:item=>auditCall({operation:'analyze',id:'audit-${name}',seq:item.seq,bytes:item.pcm.buffer.slice(0),final:item.final}),consume:(pcm,decision)=>{auditEvidence.classified++;auditEvidence.confirmations+=decision.evidence.dualConfirmations;auditPipeline.push(pcm,decision.base||Boolean((auditPipeline.chunk||auditPipeline.pendingActivityEnd)&&decision.continuation),decision);}});auditVad.prepare(auditCall({operation:'open',id:'audit-${name}'}))`);
   let packets=0;for(let at=0;at<pcm.length;at+=3200){const bytes=pcm.subarray(at,at+3200);await evaluate(sessionId,`auditVad.push(Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0)),${at+3200>=pcm.length})`);packets++;}
   const result=await evaluate(sessionId,`auditVad.barrier(()=>auditPipeline.finish()).then(()=>({classified:auditEvidence.classified,confirmations:auditEvidence.confirmations,sentBytes:auditPackets.reduce((n,p)=>n+p.pcm.byteLength,0),pending:auditVad.queue.length}))`);
   assert.equal(result.classified,packets);assert.equal(result.pending,0);if(name==='silence'){assert.equal(result.confirmations,0);assert.equal(result.sentBytes,0);}else{assert.ok(result.confirmations>0);assert.ok(result.sentBytes>0);}vad.push({name,...result});await evaluate(sessionId,`auditVad.cancel();auditCall({operation:'close',id:'audit-${name}'})`);
  }
  console.log(JSON.stringify({vad}));await evaluate(sessionId,'auditWorker.terminate()');fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({version,cases,exceptions,vad},null,2));
 }
 if(process.env.FALAMERMO_AUDIT_BASELINE){
  await evaluate(sessionId,'globalThis.auditCurrentCore=DiagnosticsCore');
  await evaluate(sessionId,fs.readFileSync(path.join(process.env.FALAMERMO_AUDIT_BASELINE,'diagnostics-runtime.js'),'utf8'));
  const cpu=await evaluate(sessionId,`(()=>{const measure=api=>{const d=api.create({settings:{mode:'normal'}}),q=d.queue('persist-send','86e66711-639b-46df-8001-f16503e08248'),at=performance.now();for(let i=0;i<18000;i++){const token=q.enter({packetSequence:i,bytes:3200});q.begin(token);const span=d.start('stt','persist-packet',undefined,{packetSequence:i,bytes:3200});d.finish(span);q.leave(token);if(i%100===0)d.flush();}d.flush();return performance.now()-at;};const before=[],after=[];for(let round=0;round<7;round++){if(round%2){after.push(measure(auditCurrentCore));before.push(measure(DiagnosticsCore));}else{before.push(measure(DiagnosticsCore));after.push(measure(auditCurrentCore));}}before.sort((a,b)=>a-b);after.sort((a,b)=>a-b);return{packets:18000,rounds:7,baselineMedianMs:before[3],currentMedianMs:after[3]};})()`);
  fs.writeFileSync(path.join(out,'cpu-comparison.json'),JSON.stringify(cpu,null,2));console.log(JSON.stringify({cpuComparison:cpu}));
 }
 assert.ok(cases.every(c=>c.passed),JSON.stringify(cases.filter(c=>!c.passed)));console.log('PASS: '+cases.length+' cenários de editor; artefatos: '+out);
}finally{if(chrome){const exit=chrome.exitCode===null&&chrome.signalCode===null?new Promise(r=>chrome.once('exit',r)):Promise.resolve();try{await call('Browser.close');}catch{chrome.kill();}await exit;}for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Chrome encerrado'));}fs.rmSync(path.join(out,'profile'),{recursive:true,force:true,maxRetries:5,retryDelay:100});}})().catch(e=>{console.error(e.stack||e);console.error('Artefatos: '+out);process.exitCode=1;});
