'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=process.env.FALAMERMO_AUDIT_SOURCE||path.resolve(__dirname,'..');
const core=require(path.join(root,'diagnostics-runtime.js')),jobs=require(path.join(root,'global-jobs.js'));
const jobId='86e66711-639b-46df-8001-f16503e08248',origin={tabId:1,frameId:0,documentId:'original'};

test('final recusado preserva transcript integral e edição manual, sem sucesso falso nem evento tardio vencedor',async()=>{
 const data={},history={enabled:true,recentItems:[]};let saved=history;
 const services={storage:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)},getHistory:async()=>saved,updateHistory:async fn=>saved=fn(saved)};
 const r=jobs.create(services);await r.start({jobId,type:'STT',editorDelivery:true,origin});
 await r.event({jobId,event:'stt-final',eventSeq:7,text:'Transcrição integral para recuperação.'});
 const state=await r.insertion({jobId,revision:7,final:true,inserted:false,reason:'MANUAL_EDIT_PRESERVED'},origin);
 assert.equal(state.jobs[0].status,'error');assert.equal(state.jobs[0].insertion.inserted,false);assert.equal(state.jobs[0].text,'Transcrição integral para recuperação.');assert.equal(saved.recentItems[0].status,'error');assert.equal(saved.recentItems[0].text,state.jobs[0].text);
 await r.insertion({jobId,revision:6,final:true,inserted:true},origin);assert.equal((await r.get()).jobs[0].insertion.inserted,false);
 const restored=jobs.create(services);assert.equal((await restored.get()).jobs[0].status,'error');assert.equal((await restored.get()).jobs[0].controls.copy,true);
});

test('perda do documento durante entrega final conserva transcrição sem marcar inserção concluída',async()=>{
 const r=jobs.create();await r.start({jobId,type:'STT',editorDelivery:true,origin});await r.event({jobId,event:'stt-final',text:'Texto final.',eventSeq:3});await r.originLost({...origin,captureGone:true});
 const job=(await r.get()).jobs[0];assert.equal(job.status,'error');assert.equal(job.insertion.reason,'ORIGIN_LOST');assert.equal(job.text,'Texto final.');
});

test('snapshot antigo concluído com inserção negada é restaurado com estado coerente, sem perder conteúdo',async()=>{
 const old={revision:1,jobs:[{jobId,type:'STT',status:'completed',text:'Texto antigo recuperável.',origin,insertion:{inserted:false,reason:'MANUAL_EDIT_PRESERVED'}}]};
 const r=jobs.create({storage:{get:async()=>({[jobs.STORAGE_KEY]:old})}}),s=await r.get();assert.equal(s.jobs[0].status,'error');assert.equal(s.jobs[0].text,old.jobs[0].text);assert.equal(old.jobs[0].status,'completed');
});

test('ausência de fala confirmada é terminal normal, sem falso erro de inserção',async()=>{
 const r=jobs.create();await r.start({jobId,type:'STT',editorDelivery:true,origin});await r.event({jobId,event:'stt-final',outcome:'NO_SPEECH',text:'',eventSeq:4});const s=await r.insertion({jobId,revision:4,final:true,inserted:false,reason:'EMPTY_TEXT'},origin);
 assert.equal(s.jobs[0].status,'completed');assert.equal(s.jobs[0].outcome,'NO_SPEECH');assert.equal(s.jobs[0].incomplete,false);
});

test('68 exceções repetidas mantêm contagem, origem, operação e stack sem URL/conteúdo/credencial',()=>{
 const d=core.create({context:'content'}),extensionUrl='chrome-extension://test/';
 const error={name:'TypeError',message:'PRIVATE_TRANSCRIPT sk-private',stack:'TypeError: PRIVATE_TRANSCRIPT sk-private\n at secretUserFunction (chrome-extension://test/content.js:121:9)\n at page (https://private.test/user-secret.js?key=PRIVATE_KEY:4:5)'};
 assert.equal(typeof d.exception,'function');for(let i=0;i<68;i++)d.exception({filename:extensionUrl+'content.js',error},{extensionUrl});d.flush();
 const es=d.snapshot().events;assert.equal(es.length,1);const e=es[0];assert.equal(e.details.eventCount,68);assert.equal(e.details.exceptionOrigin,'extension');assert.equal(e.details.exceptionName,'TypeError');assert.equal(e.details.operation,'script-error');assert.deepEqual(e.details.stack,[{file:'content.js',line:121,column:9},{file:'page-script',line:4,column:5}]);assert.match(e.details.fingerprint,/^[a-f0-9]{8}$/);
 assert.doesNotMatch(JSON.stringify(es),/PRIVATE_|private\.test|secretUserFunction|sk-private|user-secret/);
});

test('exceção da página não é atribuída à extensão; origem ausente permanece desconhecida',()=>{
 const d=core.create(),extensionUrl='chrome-extension://test/';
 d.exception({filename:'https://page.test/a.js',error:{name:'ReferenceError',stack:'ReferenceError\n at https://page.test/a.js:3:8'}},{extensionUrl});d.exception({},{extensionUrl});d.flush();
 assert.deepEqual(d.snapshot().events.map(e=>e.details.exceptionOrigin),['page','unknown']);assert.ok(d.snapshot().events.every(e=>e.code==='UNHANDLED_ERROR'));
});

test('encerramentos esperados não viram avisos; falhas reais e inserção impedida continuam explícitas',()=>{
 const d=core.create();for(const stopReason of ['user-stop','user-cancel','origin-lost','final-result'])d.legacy('stt',{jobId,scope:'capture',stage:'capture-ending',stopReason});
 assert.ok(d.snapshot().events.every(e=>e.severity==='info'));
 d.legacy('stt',{jobId,scope:'result',stage:'insertion-failed',outcome:'INSERTION_FAILED',editorReason:'MANUAL_EDIT_PRESERVED',finalInsertion:true});assert.equal(d.snapshot().events.at(-1).severity,'warn');
 d.legacy('stt',{jobId,scope:'result',stage:'insertion-failed',outcome:'INSERTION_FAILED',editorReason:'EDITOR_REVERTED'});assert.equal(d.snapshot().events.at(-1).severity,'error');assert.equal(d.snapshot().events.at(-1).code,'INSERTION_FAILED');
 d.legacy('stt',{jobId,scope:'result',stage:'insertion-failed',editorReason:'EMPTY_TEXT'});assert.equal(d.snapshot().events.at(-1).severity,'info');
});

test('probabilidades VAD, contagens, revisões e razão de inserção sobrevivem à sanitização central',()=>{
 const d=core.create();d.legacy('stt',{jobId,scope:'capture',stage:'vad-decision',sileroMaxProbability:.7,tenMaxProbability:.9,dualConfirmations:3,dualRejections:6,analyzedFrames:32,pendingChunks:0});d.flush();
 const details=d.snapshot().events[0].details;for(const key of ['sileroMaxProbability','tenMaxProbability','dualConfirmations','dualRejections','analyzedFrames','pendingChunks'])assert.ok(key in details,key);
 d.legacy('stt',{jobId,scope:'editor',stage:'editor-ack',revision:7,appliedRevision:5,editorReason:'MANUAL_EDIT_PRESERVED'});assert.equal(d.snapshot().events.at(-1).details.revision,7);
});

test('contexto invalidado encerra transporte diagnóstico e remove seu timer/listener sem cascata',async()=>{
 let calls=0,cleared=0,removed=0;const timers=[];
 const r={chrome:{runtime:{getURL:x=>'chrome-extension://test/'+x,sendMessage(){calls++;throw Error('Extension context invalidated.');}},storage:{local:{get:async()=>({})},onChanged:{addListener(){},removeListener(){removed++;}}}},setInterval(fn){timers.push(fn);return 1;},clearInterval(){cleared++;},addEventListener(){}};
 const d=core.create({context:'content'});d.install(r);await d.ready;await d.send();for(let i=0;i<4;i++)await d.send();
 assert.equal(calls,1);assert.equal(cleared,1);assert.equal(removed,1);
});

test('fechar aba com múltiplos contextos gera um encerramento informativo; falha real não é ocultada',async()=>{
 const d=core.create(),listeners=[],c=vm.createContext({FalaDiagnostics:d,DiagnosticsCore:core,setInterval(){},Date,console,chrome:{runtime:{id:'test',getURL:x=>'chrome-extension://test/'+x,onMessage:{addListener:fn=>listeners.push(fn)}},storage:{session:{get:async()=>({})},local:{get:async()=>({})},onChanged:{addListener(){}}},tabs:{onRemoved:{addListener:fn=>c.removed=fn}}}});
 vm.runInContext(fs.readFileSync(path.join(root,'diagnostics-background.js'),'utf8'),c);await c.DiagnosticsHub.ready;
 for(let i=0;i<5;i++)listeners[0]({type:'DIAGNOSTICS_BATCH',payload:{sourceId:'content-1794694348211-test'+i,context:'content',events:[]}},{id:'test',tab:{id:2},url:'https://page.test',frameId:i,documentId:'doc'+i},()=>{});
 c.removed(2);const endings=d.snapshot().events.filter(e=>e.stage==='context-ending');assert.equal(endings.length,1);assert.equal(endings[0].details.count,5);assert.equal(endings[0].severity,'info');
 assert.ok(!d.snapshot().events.some(e=>e.code==='CONTEXT_INTERRUPTED'));
});
