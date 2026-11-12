'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const readBackground=require('./load-background.cjs');
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const keys=Array.from({length:9},(_,i)=>'fixture-key-'+(i+1)),models=['gemini-3.5-flash-lite','gemini-3.1-flash-lite'];
function environment(){
 const calls=[],logs=[],data={},timers=new Map();let clock=1000,nextTimer=0;
 const storage={async get(key){return{[key]:structuredClone(data[key])};},async set(value){Object.assign(data,structuredClone(value));}};
 const context=vm.createContext({AbortController,structuredClone,setTimeout,clearTimeout,console});
 vm.runInContext(readBackground(require.resolve('../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);
 const m={exports:{}};context.modules['extension/src/services/lensPool.ts'](m,m.exports,()=>{});
 const services={storage,now:()=>clock,setTimeout(fn,ms){timers.set(++nextTimer,{fn,at:clock+ms});return nextTimer;},clearTimeout(id){timers.delete(id);}};
 const pool=m.exports.create(services);
 const execute=(pair,signal)=>new Promise((resolve,reject)=>{calls.push({pair,signal,resolve,reject});});
 const run=(extra={})=>pool.run({model:models[0],models,keys,execute,log:packet=>logs.push(packet),...extra});
 return{pool,run,calls,logs,data,storage,module:m.exports,advance:async ms=>{clock+=ms;for(const[id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}await flush();},restart:()=>m.exports.create(services)};
}
const failure=(status,retryAfter)=>Object.assign(new Error('HTTP '+status),{httpStatus:status,retryAfter});
for(const winner of [0,1])test('primeira resposta válida vence (conta '+(winner+1)+') e perdedora tardia é ignorada',async()=>{
 const e=environment(),running=e.run();await flush();assert.equal(e.calls.length,2);
 assert.notEqual(e.calls[0].pair.keyId,e.calls[1].pair.keyId);
 e.calls[winner].resolve('  Vencedora '+winner+'  ');assert.equal(await running,'Vencedora '+winner);
 assert.equal(e.calls[1-winner].signal.aborted,true);
 e.calls[1-winner].resolve('Não substituir');await flush();assert.equal(e.calls.length,2);
 assert.equal(e.logs.filter(x=>x.operation==='LENS_RACE_WINNER').length,1);
 assert.ok(!JSON.stringify(e.data).includes('fixture-key-'));
});
test('falha de uma conta repõe só a vaga; a sobrevivente continua ativa',async()=>{
 const e=environment(),running=e.run();await flush();e.calls[0].reject(failure(503));await flush();
 assert.equal(e.calls.length,3);assert.equal(e.calls[1].signal.aborted,false);assert.equal(e.calls[2].pair.keyIndex,3);
 e.calls[1].resolve('Sobrevivente');assert.equal(await running,'Sobrevivente');assert.equal(e.calls[2].signal.aborted,true);
});
test('duas contas indisponíveis usam duas substitutas, sem nove simultâneas',async()=>{
 const e=environment(),running=e.run();await flush();e.calls[0].reject(failure(503));e.calls[1].reject(failure(429,'45'));await flush();
 assert.equal(e.calls.length,4);assert.deepEqual(e.calls.slice(2).map(x=>x.pair.keyIndex),[3,4]);
 e.calls[3].resolve('Quarta conta');assert.equal(await running,'Quarta conta');
});
test('texto vazio/erro não é vencedor; resultado válido é único',async()=>{
 const e=environment(),running=e.run();await flush();e.calls[0].resolve('  ');await flush();assert.equal(e.calls.length,3);
 e.calls[2].resolve('❌ falha');await flush();assert.equal(e.calls.length,4);
 e.calls[1].resolve('Válido');assert.equal(await running,'Válido');assert.equal(e.logs.filter(x=>x.operation==='LENS_RACE_WINNER').length,1);
});
test('Zero-Retry esgota cada par uma vez e mantém ordem de modelos',async()=>{
 const e=environment();let stopped=false;
 const run=(async()=>{try{for(const model of models)try{return await e.run({model,keys:keys.slice(0,3)});}catch{}throw Error('esgotado');}finally{stopped=true;}})();
 const checked=assert.rejects(run,/esgotado/);
 for(let turn=0;turn<12&&!stopped;turn++){await flush();for(const c of e.calls)if(!c.finished){c.finished=true;c.reject(failure(503));}}
 await checked;assert.equal(e.calls.length,6);assert.equal(new Set(e.calls.map(c=>c.pair.model+'|'+c.pair.keyId)).size,6);
 assert.deepEqual(e.calls.map(c=>c.pair.model),[...Array(3).fill(models[0]),...Array(3).fill(models[1])]);
});
test('Stop aborta as duas tentativas e não inicia substitutas nem aceita resposta tardia',async()=>{
 const e=environment(),controller=new AbortController(),running=e.run({signal:controller.signal});const checked=assert.rejects(running,/cancelad/);
 await flush();controller.abort(Error('Seleção cancelada.'));await checked;
 assert.ok(e.calls.every(c=>c.signal.aborted));for(const c of e.calls)c.resolve('Tardia');await flush();assert.equal(e.calls.length,2);
 assert.equal(e.logs.filter(x=>x.operation==='LENS_RACE_WINNER').length,0);
});
test('cancelamento antes da admissão não faz chamadas',async()=>{
 const e=environment(),c=new AbortController();c.abort();await assert.rejects(e.run({signal:c.signal}));await flush();assert.equal(e.calls.length,0);
});
test('limite global é quatro e conta não é usada simultaneamente por seleções distintas',async()=>{
 const e=environment(),controllers=Array.from({length:4},()=>new AbortController());
 const outcomes=controllers.map(c=>e.run({signal:c.signal}).then(v=>v,()=>null));await flush();
 assert.equal(e.calls.length,4);assert.equal(new Set(e.calls.map(c=>c.pair.keyId)).size,4);
 e.calls[0].resolve('Primeira');await flush();
 const live=e.calls.filter(c=>!c.signal.aborted&&c!==e.calls[0]);assert.ok(live.length<=4);
 assert.equal(new Set(live.map(c=>c.pair.keyId)).size,live.length);assert.ok(e.calls.length>4);
 for(const c of controllers)c.abort(Error('Seleção cancelada'));await Promise.all(outcomes);
});
test('quota 429/Retry-After é persistida no namespace Lens e respeitada ao reiniciar pool',async()=>{
 const e=environment(),running=e.run();await flush();e.calls[0].reject(failure(429,'60'));await flush();e.calls[1].resolve('Boa conta');await running;await flush();
 const serialized=JSON.stringify(e.data);assert.ok(serialized.includes('lensAdaptiveData'));assert.ok(!serialized.includes('ttsAdaptiveData'));assert.ok(serialized.includes('QUOTA'));
 const restarted=e.restart(),start=e.calls.length,next=restarted.run({model:models[0],models,keys,execute:(pair,signal)=>new Promise(resolve=>e.calls.push({pair,signal,resolve})),log:()=>{}});
 await flush();assert.ok(e.calls.slice(start).every(c=>c.pair.keyIndex!==1));e.calls[start].resolve('Sem reutilizar quota');await next;
 await e.advance(60001);
});
test('credencial inválida fica indisponível também no fallback de modelo',async()=>{
 const e=environment(),running=e.run({keys:keys.slice(0,2)});const checked=assert.rejects(running);await flush();
 e.calls[0].reject(failure(401));e.calls[1].reject(failure(503));await checked;await flush();
 const next=e.run({model:models[1],keys:keys.slice(0,2)});await flush();assert.equal(e.calls.at(-1).pair.keyIndex,2);assert.equal(e.calls.length,3);
 e.calls.at(-1).resolve('Modelo seguinte');await next;
});
test('timeout por modelo aborta tentativas, ignora tardias e permite o modelo seguinte',async()=>{
 const e=environment(),running=e.run();const checked=assert.rejects(running,/Timeout de 15s/);await flush();await e.advance(15000);await checked;
 assert.ok(e.calls.every(c=>c.signal.aborted));for(const c of e.calls)c.resolve('Tardia');await flush();
 const next=e.run({model:models[1]});await flush();assert.equal(e.calls.length,4);e.calls[2].resolve('Fallback');assert.equal(await next,'Fallback');
});
test('seleção aguardando limite global pode ser cancelada sem disparar depois',async()=>{
 const e=environment(),a=new AbortController(),b=new AbortController(),c=new AbortController();
 const first=e.run({signal:a.signal}).catch(()=>{}),second=e.run({signal:b.signal}).catch(()=>{}),queued=e.run({signal:c.signal});const checked=assert.rejects(queued);
 await flush();assert.equal(e.calls.length,4);c.abort();await checked;a.abort();b.abort();await Promise.all([first,second]);await flush();assert.equal(e.calls.length,4);
});
test('pool deduplica chaves e limita catálogo a nove contas',async()=>{
 const e=environment(),all=[keys[0],keys[0],...keys.slice(1),'extra-10'],running=e.run({keys:all});let done=false;const checked=running.catch(()=>{done=true;});
 for(let i=0;i<12&&!done;i++){await flush();for(const c of e.calls)if(!c.finished){c.finished=true;c.reject(failure(503));}}
 await checked;assert.equal(e.calls.length,9);assert.equal(new Set(e.calls.map(c=>c.pair.keyId)).size,9);
});

function clientEnvironment(){
 const calls=[],logs=[],timers=new Map();let nextTimer=0;
 const settings={api:{apiKeys:keys},agents:{activeAgentId:'narrator'},models:{}};
 const context=vm.createContext({AbortController,structuredClone,console,setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout(id){timers.delete(id);},fetch(url,options){return new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}));},chrome:{tabs:{get:async id=>({id,active:true,windowId:1,url:'https://example.test'}),captureVisibleTab:async()=> 'data:image/jpeg;base64,/9j/2Q=='}}});
 vm.runInContext(readBackground(require.resolve('../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);
 const cache={},overrides={'extension/src/services/diagnosticLogger.ts':{logDiagnostic:async packet=>logs.push(packet)},'extension/src/services/storage/chromeStorageAdapter.ts':{chromeStorage:{getMany:async()=>settings}}};
 function load(id){if(overrides[id])return overrides[id];if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};context.modules[id](m,m.exports,load);return m.exports;}
 const client=load('extension/src/services/geminiDirectClient.ts').geminiDirectClient;
 const reply=(index,{status=200,data,body,headers={}}={})=>calls[index].resolve({ok:status===200,status,headers:{get:name=>headers[name]||'application/json'},text:async()=>body??JSON.stringify(data??{candidates:[{finishReason:'STOP',content:{parts:[{text:'Resultado válido'}]}}]})});
 return{calls,logs,timers,reply,run:signal=>client.inspectVisionContext('/9j/2Q==','Extraia o texto.',{apiKeys:keys},models[0],{signal}),capture:signal=>load('extension/src/background/tabCaptureHandler.ts').captureAndAnalyzeTab(1,undefined,'narrator',undefined,'https://example.test',undefined,signal)};
}
test('cliente envia o mesmo payload a duas chaves e só texto final válido vence',async()=>{
 const e=clientEnvironment(),running=e.run();await flush();assert.equal(e.calls.length,2);
 assert.notEqual(new URL(e.calls[0].url).searchParams.get('key'),new URL(e.calls[1].url).searchParams.get('key'));assert.equal(e.calls[0].options.body,e.calls[1].options.body);
 e.reply(0,{data:{candidates:[{content:{parts:[{thought:true,text:'Pensamento privado'}]}}]}});await flush();assert.equal(e.calls.length,3);
 e.reply(1,{data:{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'Não expor'},{text:'Texto '},{text:'final'}]}}]}});
 assert.equal(await running,'Texto final');assert.equal(e.calls[2].options.signal.aborted,true);assert.ok(!JSON.stringify(e.logs).includes('Pensamento privado'));
});
for(const status of [503,429])test('HTTP '+status+' nunca vence e não cancela sobrevivente',async()=>{
 const e=clientEnvironment(),running=e.run();await flush();e.reply(0,{status,headers:{'retry-after':'120'}});await flush();assert.equal(e.calls.length,3);assert.equal(e.calls[1].options.signal.aborted,false);
 e.reply(1);assert.equal(await running,'Resultado válido');
});
for(const response of [{body:'<html>erro</html>'},{data:{error:{message:'sem resultado'}}},{data:{candidates:[{finishReason:'SAFETY',content:{parts:[{text:'Bloqueada'}]}}]}}])test('resposta malformada/bloqueada não vence a corrida',async()=>{
 const e=clientEnvironment(),running=e.run();await flush();e.reply(0,response);await flush();assert.equal(e.calls.length,3);e.reply(1);assert.equal(await running,'Resultado válido');
});
test('limite global de 30s do Lens aborta todas as contas e impede fallback/narração tardia',async()=>{
 const e=clientEnvironment(),running=e.capture();const checked=assert.rejects(running,/30s/);await flush();assert.equal(e.calls.length,2);
 const deadline=[...e.timers.values()].find(t=>t.ms===30000);assert.ok(deadline);deadline.fn();await checked;
 assert.ok(e.calls.every(c=>c.options.signal.aborted));for(let i=0;i<2;i++)e.reply(i);await flush();assert.equal(e.calls.length,2);
});
