const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm'),fs=require('node:fs');
function runtime(now=0,timeOrigin=1000){const logs=[],clock={now:()=>now,timeOrigin};const ctx=vm.createContext({performance:clock,console:{debug(...args){logs.push(args)}},Date,Math});vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../tts-config.js'),'utf8'),ctx);return {api:ctx.TtsConfig,logs,set:value=>{now=value}};}
test('traces usam performance.now e timeOrigin, com duração correta entre contextos',()=>{
 const ui=runtime(10),bg=runtime(14);const trace=ui.api.createTrace({enabled:true,context:'options'});trace.mark('MESSAGE_SENT');
 const server=bg.api.createTrace({...trace.packet(),context:'background'});server.mark('BACKGROUND_RECEIVED');trace.merge(server.snapshot());
 assert.equal(trace.events[0].performanceNow,10);assert.equal(trace.events[0].at,1010);assert.equal(trace.events[1].elapsedMs,4);assert.equal(ui.api.traceRows(trace.snapshot())[0].durationMs,4);
});
test('debug desativado não emite logs nem armazena trace',()=>{const {api,logs}=runtime();const trace=api.createTrace({enabled:false});trace.mark('FETCH_START');assert.equal(trace.events.length,0);assert.equal(logs.length,0);assert.equal(api.getTrace(trace.id),undefined);});
test('credenciais são removidas dos erros e campos não autorizados não entram no trace',()=>{
 const {api,logs}=runtime(),trace=api.createTrace({enabled:true,secrets:['private key']});trace.mark('ATTEMPT_END',{error:'private key / private%20key / AIzaSecretKey',apiKey:'private key',attempt:1,keyIndex:2});
 const encoded=JSON.stringify(trace.snapshot())+JSON.stringify(logs);assert.ok(!encoded.includes('private key'));assert.ok(!encoded.includes('private%20key'));assert.ok(!encoded.includes('AIzaSecretKey'));assert.ok(!encoded.includes('apiKey'));assert.ok(encoded.includes('chave ocultada'));
});
test('metadados da tentativa acompanham headers/body e merges não duplicam eventos',()=>{
 const env=runtime(),trace=env.api.createTrace({enabled:true});trace.mark('ATTEMPT_START',{modelId:'m',keyIndex:2,attempt:1});env.set(5);trace.mark('HTTP_HEADERS',{httpStatus:200});env.set(12);trace.mark('HTTP_BODY_END');
 assert.equal(trace.events[2].attempt,1);const packet=trace.snapshot();trace.merge(packet);assert.equal(trace.events.length,3);assert.equal(env.api.traceRows(packet).find(row=>row.stage==='download áudio').durationMs,7);
});
test('payload é medido pelo único construtor e jamais inclui trace no corpo da API',()=>{
 const env=runtime(),trace=env.api.createTrace({enabled:true});const payload=env.api.buildPayload({text:'Olá mundo',ttsConfig:{}},'gemini-3.8-flash-tts',trace);assert.equal(trace.events[0].stage,'BUILD_PAYLOAD_START');assert.equal(trace.events[1].stage,'BUILD_PAYLOAD_END');assert.ok(!JSON.stringify(payload).includes('trace'));assert.equal(payload.contents[0].parts[0].text,'Olá mundo');
});
test('diagnóstico usa a classificação compartilhada do ranking adaptativo',()=>{
 const api=require('../tts-adaptive.js');for(const httpStatus of [400,422])assert.equal(api.classify({httpStatus}).type,'REQUEST');assert.equal(api.classify({message:'INVALID_ARGUMENT'}).type,'REQUEST');assert.equal(api.classify({httpStatus:401}).type,'AUTH');assert.equal(api.classify({httpStatus:429}).type,'QUOTA');assert.equal(api.classify({httpStatus:503}).type,'TRANSIENT');assert.equal(api.classify({httpStatus:404}).type,'MODEL');
});
