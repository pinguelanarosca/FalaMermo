'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../stt-scheduler.js'),{classifyLiveError}=require('../live-session-manager.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const KEYS=Array.from({length:9},(_,i)=>'unit-only-account-'+(i+1));
const [FIRST,SECOND]=api.MODELS;
function fixture(extra={}){
 let clock=1000,n=0;const timers=new Map(),retired=[],calls=[],saved=[];
 const scheduler=api.create({now:()=>clock,setTimer(fn,ms){const id=++n;timers.set(id,{fn,ms,at:clock+ms});return id;},clearTimer:id=>timers.delete(id),classify:classifyLiveError,retire:s=>{retired.push(s);s.closed=true;},...extra});
 const start=(jobId,options={})=>scheduler.admit({jobId,keys:KEYS,models:[FIRST,SECOND],open:async pair=>{calls.push(pair);return{id:jobId,sent:[]};},...options});
 const advance=async ms=>{clock+=ms;for(const[id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}await flush();};
 const until=async predicate=>{for(let i=0;i<1000&&!predicate();i++)await flush();assert.ok(predicate(),'condição assíncrona não atingida');};
 return{scheduler,start,timers,retired,calls,saved,advance,until,clock:()=>clock};
}
test('nove admissões concorrentes reservam nove contas sem corrida de modelos nem sessão compartilhada',async()=>{
 const e=fixture(),leases=await Promise.all(KEYS.map((_,i)=>e.start('job-'+i)));
 assert.equal(new Set(leases.map(j=>j.account.id)).size,9);assert.equal(new Set(leases.map(j=>j.session)).size,9);assert.deepEqual(e.calls.map(x=>x.keyIndex).sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9]);assert.ok(e.calls.every(x=>x.modelId===FIRST));assert.equal(e.scheduler.snapshot().activeJobs,9);
 for(const j of leases){const received=[];for(let i=0;i<2;i++){e.scheduler.sendAudio(j,new Uint8Array(3200),bytes=>received.push([j.session.id,bytes.length]));e.scheduler.endAudio(j,()=>{});}assert.deepEqual(received,[[j.jobId,3200],[j.jobId,3200]]);e.scheduler.release(j);}assert.equal(e.scheduler.snapshot().activeJobs,0);
});
test('conta ocupada espera sem saltar modelo; liberação acorda apenas admissão elegível',async()=>{
 const e=fixture(),a=await e.start('a',{keys:KEYS.slice(0,1)}),b=e.start('b',{keys:KEYS.slice(0,1)});await e.until(()=>e.scheduler.snapshot().waiting===1);await flush();assert.equal(e.calls.length,1);e.scheduler.release(a);const second=await b;assert.equal(second.modelId,FIRST);assert.equal(e.calls.length,2);e.scheduler.release(second);
});
test('limite global não é burlado por trocar conta/modelo; espera expira em 2s',async()=>{
 const e=fixture(),a=await e.start('a',{config:{maxSessions:1}}),b=e.start('b',{config:{maxSessions:1}});await e.until(()=>[...e.timers.values()].some(t=>t.ms===2000));const failed=assert.rejects(b,{code:'ADMISSION_TIMEOUT'});await e.advance(2000);await failed;assert.equal(e.calls.length,1);e.scheduler.release(a);
});
test('fila de admissão tem limite e cancelamento do aguardando não cancela ativo',async()=>{
 const e=fixture(),a=await e.start('a',{keys:KEYS.slice(0,1)}),c=new AbortController(),b=e.start('b',{keys:KEYS.slice(0,1),signal:c.signal,config:{maxWaiting:1}});await e.until(()=>[...e.timers.values()].some(t=>t.ms===2000));await assert.rejects(e.start('c',{config:{maxWaiting:1}}),{code:'BACKPRESSURE'});c.abort();await assert.rejects(b,/cancelado/);assert.equal(e.scheduler.snapshot().activeJobs,1);e.scheduler.release(a);
});
test('preferência e Zero-Retry: todas nove contas de um modelo antes do próximo',async()=>{
 const e=fixture(),calls=[];await assert.rejects(e.start('x',{models:[SECOND,FIRST],open:async p=>{calls.push([p.modelId,p.keyIndex]);throw Object.assign(Error('429 quota'),{httpStatus:429});}}));assert.deepEqual(calls, [SECOND,FIRST].flatMap(m=>KEYS.map((_,i)=>[m,i+1])));assert.equal(new Set(calls.map(x=>x.join('|'))).size,18);assert.equal(e.scheduler.snapshot().activeJobs,0);
});
test('429 observado persiste cooldown por conta/modelo; não repete par no job nem espera retry',async()=>{
 const e=fixture(),calls=[],a=await e.start('a',{keys:KEYS.slice(0,2),open:async p=>{calls.push(p.keyIndex);if(p.keyIndex===1)throw Object.assign(Error('quota'),{httpStatus:429,retryAfterMs:90000});return{};}});assert.deepEqual(calls,[1,2]);e.scheduler.release(a);
 const state=e.scheduler.exportState(),again=fixture({load:()=>state}),b=await again.start('b',{keys:KEYS.slice(0,2)});assert.equal(b.keyIndex,2);assert.equal(again.scheduler.snapshot().accounts.find(x=>x.account==='key#1').models[0].quota429,1);again.scheduler.release(b);await again.advance(90001);const c=await again.start('c',{keys:KEYS.slice(0,2)});assert.equal(c.keyIndex,1);again.scheduler.release(c);
});
test('AUTH 401 desabilita conta entre modelos, 403 é restrito ao modelo',async()=>{
 for(const status of [401,403]){const e=fixture(),seen=[];await assert.rejects(e.start('a',{keys:KEYS.slice(0,1),open:async p=>{seen.push(p.modelId);throw Object.assign(Error('denied'),{httpStatus:status});}}));assert.deepEqual(seen,status===401?[FIRST]:[FIRST,SECOND]);}
});
test('REQUEST e cancelamento não gastam outras contas/modelos',async()=>{
 const e=fixture();let calls=0;await assert.rejects(e.start('a',{open:async()=>{calls++;throw Object.assign(Error('invalid setup'),{httpStatus:400});}}));assert.equal(calls,1);assert.equal(e.scheduler.snapshot().activeJobs,0);
 const c=new AbortController();c.abort();await assert.rejects(e.start('b',{signal:c.signal}),/cancelado/);assert.equal(e.calls.length,0);
});
test('timeout antes da admissão faz fallback uma vez e retira acquire que resolve atrasado',async()=>{
 const e=fixture();let finish;const p=e.start('a',{config:{setupMs:10},open:pair=>pair.keyIndex===1?new Promise(r=>finish=r):Promise.resolve({keyIndex:pair.keyIndex})});await e.until(()=>!!finish);await e.advance(10);const j=await p;assert.equal(j.keyIndex,2);const old={};finish(old);await flush();assert.ok(e.retired.includes(old));assert.equal(e.scheduler.snapshot().activeJobs,1);e.scheduler.release(j);
});
test('cancelar acquire pendente libera reserva e ignora sessão tardia sem novas tentativas',async()=>{
 const e=fixture(),c=new AbortController();let finish,calls=0;const p=e.start('a',{signal:c.signal,open:()=>{calls++;return new Promise(r=>finish=r);}});await e.until(()=>!!finish);c.abort();await assert.rejects(p,/cancelado/);finish({});await flush();assert.equal(calls,1);assert.equal(e.retired.length,1);assert.equal(e.scheduler.snapshot().activeJobs,0);
});
test('afinidade após PCM: socket/429 encerra lease, sem trocar nem reenviar áudio',async()=>{
 const e=fixture(),a=await e.start('a'),b=await e.start('b');let sends=0;e.scheduler.sendAudio(a,new Uint8Array(3200),()=>sends++);e.scheduler.fail(a,Object.assign(Error('429 quota'),{httpStatus:429}));assert.throws(()=>e.scheduler.sendAudio(a,new Uint8Array(3200),()=>sends++),/cancelado/);assert.equal(sends,1);assert.equal(e.calls.length,2);assert.equal(b.keyIndex,2);assert.equal(e.scheduler.snapshot().activeJobs,1);e.scheduler.release(b);
});
test('TPM estimado inclui contexto nos turnos; usage high-water não duplica snapshot e recobra próxima geração',async()=>{
 const e=fixture(),a=await e.start('a',{config:{setupTokens:0}});
 for(let i=0;i<2;i++){e.scheduler.sendAudio(a,new Uint8Array(32000),()=>{});e.scheduler.endAudio(a,()=>{});}let m=e.scheduler.snapshot().accounts[0].models[0];assert.equal(m.estimatedTpm,75);
 e.scheduler.observe(a,{usageMetadata:{promptTokenCount:100,responseTokenCount:15,thoughtsTokenCount:2}});e.scheduler.observe(a,{usageMetadata:{promptTokenCount:100,responseTokenCount:15,thoughtsTokenCount:2}});m=e.scheduler.snapshot().accounts[0].models[0];assert.equal(m.observedInputTpm,100);assert.equal(m.outputTokens60s,15);
 e.scheduler.observe(a,{serverContent:{turnComplete:true}});e.scheduler.observe(a,{usageMetadata:{promptTokenCount:120,responseTokenCount:20}});m=e.scheduler.snapshot().accounts[0].models[0];assert.equal(m.observedInputTpm,220);assert.equal(m.effectiveTpm,220);e.scheduler.release(a);await e.advance(60001);assert.equal(e.scheduler.snapshot().accounts[0].models[0].effectiveTpm,0);
});
test('quota TPM conhecida desvia novo job e interrompe envio antes do socket sem migrar',async()=>{
 const e=fixture(),config={setupTokens:0,horizonSeconds:1,limits:{[FIRST]:100},headroom:1},a=await e.start('a',{config});e.scheduler.observe(a,{usageMetadata:{promptTokenCount:90}});let sent=0;assert.throws(()=>e.scheduler.sendAudio(a,new Uint8Array(32000),()=>sent++),{code:'STT_TPM_LIMIT'});assert.equal(sent,0);e.scheduler.fail(a,Error('budget exhausted'));const b=await e.start('b',{config});assert.equal(b.keyIndex,2);assert.equal(b.modelId,FIRST);e.scheduler.release(b);
});
test('substituição/reordenação de credencial não transfere quota nem lease do job original',async()=>{
 const e=fixture(),a=await e.start('a');const old=a.account.id,b=await e.start('b',{keys:[...KEYS].reverse()});assert.equal(b.keyIndex,1);assert.notEqual(b.account.id,old);assert.equal(a.keyIndex,1);e.scheduler.release(a);e.scheduler.release(b);
 const c=await e.start('c',{keys:['changed-unit-key']});assert.notEqual(c.account.id,old);e.scheduler.release(c);
});
test('sanitização, persistência, TTL e storage rejeitado não expõem conteúdo nem invalidam áudio',async()=>{
 const saved=[],e=fixture({save:s=>saved.push(s)}),a=await e.start('a');e.scheduler.observe(a,{usageMetadata:{promptTokenCount:12,text:'private-content',apiKey:KEYS[0]}});e.scheduler.release(a);await e.scheduler.flush();const wire=JSON.stringify(saved);assert.ok(!wire.includes(KEYS[0]));assert.ok(!wire.includes('private-content'));assert.ok(!JSON.stringify(e.scheduler.snapshot()).includes('acct-'));
 const clean=api.sanitize({...saved[0],apiKey:KEYS[0]},e.clock());assert.equal(clean.apiKey,undefined);assert.equal(api.sanitize(saved[0],e.clock()+api.TTL+1).accounts.length,0);
 const f=fixture({load:()=>Promise.reject(Error('storage down')),save:()=>Promise.reject(Error('storage down'))}),b=await f.start('b');await f.scheduler.flush();assert.equal(f.scheduler.snapshot().activeJobs,1);f.scheduler.release(b);
});
test('reservas atômicas de TPM com limite de sessões >1 não admitem oversubscription',async()=>{
 const e=fixture(),config={maxPerAccount:2,setupTokens:0,horizonSeconds:12,headroom:1,limits:{[FIRST]:400}},a=await e.start('a',{keys:KEYS.slice(0,1),models:[FIRST],config});await assert.rejects(e.start('b',{keys:KEYS.slice(0,1),models:[FIRST],config}),{code:'STT_UNAVAILABLE'});assert.equal(e.calls.length,1);e.scheduler.release(a);
});
test('TPM pode ser específico por conta sem transferir orçamento ao reordenar slots',async()=>{
 const e=fixture(),a=await e.start('a'),id=a.account.id;e.scheduler.release(a);const config={accountLimits:{[id]:{[FIRST]:100}}},b=await e.start('b',{config});assert.notEqual(b.account.id,id);assert.equal(b.modelId,FIRST);e.scheduler.release(b);
 const policy=api.policy({accountLimits:{'secret-key':{[FIRST]:999},[id]:{[FIRST]:100}}});assert.deepEqual(Object.keys(policy.accountLimits),[id]);
});
test('ledger opaco impede reabrir job concluído, inclusive após recuperação do offscreen',async()=>{
 const e=fixture(),a=await e.start('once');e.scheduler.release(a);await assert.rejects(e.start('once'),/já processado/);assert.equal(e.calls.length,1);const raw=e.scheduler.exportState();assert.equal(raw.operations.length,1);assert.ok(!JSON.stringify(raw).includes('once'));
 const recovered=fixture({load:()=>raw});await assert.rejects(recovered.start('once'),/já processado/);assert.equal(recovered.calls.length,0);const b=await recovered.start('new-operation');recovered.scheduler.release(b);
});
test('compactação limita telemetria sem apagar débito e snapshots não confundem zero com ausência de usage',async()=>{
 const e=fixture(),a=await e.start('many');for(let n=0;n<1100;n++)e.scheduler.observe(a,{usageMetadata:{promptTokenCount:1},serverContent:{turnComplete:true}});const state=e.scheduler.exportState(),m=e.scheduler.snapshot().accounts[0].models[0];assert.ok(state.accounts[0].models[0].entries.length<=1024);assert.equal(m.observedInputTpm,1100);assert.equal(m.usageMessages,1100);e.scheduler.recordChunk(a,1500);e.scheduler.release(a);const final=e.scheduler.snapshot().accounts[0].models[0];assert.equal(final.chunkLatencyMs,1500);assert.equal(final.selectionReason,'LOWER_LOAD');assert.equal(final.statusReason,'RELEASED');
});
test('jobs curtos sucessivos distribuem carga mesmo com relógio empatado',async()=>{
 const e=fixture(),counts=new Map();for(let n=0;n<18;n++){const j=await e.start('sequential-'+n);counts.set(j.keyIndex,(counts.get(j.keyIndex)||0)+1);e.scheduler.release(j);}assert.equal(counts.size,9);assert.ok([...counts.values()].every(n=>n===2));
});
test('orçamento local esgotado não é registrado como 429 nem falha de rede',async()=>{
 const e=fixture(),a=await e.start('budget'),cause=Object.assign(Error('budget'),{code:'STT_TPM_LIMIT'});e.scheduler.fail(a,cause);const m=e.scheduler.snapshot().accounts[0].models[0];assert.equal(m.statusReason,'TPM');assert.equal(m.quota429,0);assert.equal(m.cooldownUntil,0);
});
test('storage sem resposta tem deadline e não bloqueia admissão/cleanup indefinidamente',async()=>{
 const e=fixture({load:()=>new Promise(()=>{})}),p=e.start('storage-hung');await e.until(()=>[...e.timers.values()].some(t=>t.ms===2000));await e.advance(2000);const a=await p;assert.equal(e.scheduler.snapshot().storageHealthy,false);e.scheduler.release(a);
});
