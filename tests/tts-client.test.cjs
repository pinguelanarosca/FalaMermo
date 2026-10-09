const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm');
function environment(){
 const calls=[],logs=[],source=require('./load-background.cjs')(require.resolve('../background.js')),context=vm.createContext({AbortController,structuredClone,setTimeout,clearTimeout,performance,fetch(...args){calls.push(args);throw Error('HTTP não autorizado');}});
 vm.runInContext(source.replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);
 const cache={};function load(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};context.modules[id](m,m.exports,load);return m.exports;}
 const client=load('extension/src/services/geminiDirectClient.ts').geminiDirectClient;return{client,calls,logs};
}
test('serviço TTS convencional bloqueado antes de fetch, fallback e credenciais',async()=>{
 const config=require('../tts-config.js');
 for(const modelId of [...Object.keys(config.TTS_MODEL_CAPABILITIES),'unverified-model','gemini-3.8-live']){
  const e=environment(),key='private-test-key';await assert.rejects(e.client.synthesizeSpeech({modelId,text:'Teste.',diagnostic:{singleAttempt:true,keyIndex:2},ttsConfig:{advancedJsonEnabled:true,advancedJson:config.getAdvancedTemplate('gemini-3.8-flash-tts')}},{apiKeys:[key,'fake-2']}),error=>/Live WebSocket/.test(error.message)&&!error.message.includes(key));assert.equal(e.calls.length,0);assert.equal(e.logs.length,0);
 }
});
test('STT unary bloqueado mesmo com configurações e instruções antigas',async()=>{
 const e=environment();await assert.rejects(e.client.transcribeAudio({modelId:'gemini-3.5-transcribe',audioBase64:'AAAA',formattingInstruction:'Legado'},'private-test-key'),/Live WebSocket/);assert.equal(e.calls.length,0);
});
test('cancelamento/REQUEST/contexto invalidado permanecem distinguíveis no transporte Live',()=>{
 const classify=require('../live-session-manager.js').classifyLiveError;
 assert.equal(classify({cancelled:true}),'CANCELLED');assert.equal(classify(Error('Extension context invalidated')),'INVALIDATED_CONTEXT');
 for(const httpStatus of [400,422])assert.equal(classify({httpStatus}),'REQUEST');
 for(const [httpStatus,kind] of [[401,'AUTH'],[403,'AUTH'],[429,'QUOTA'],[503,'TRANSIENT'],[404,'MODEL']])assert.equal(classify({httpStatus}),kind);
});
// Quota/AUTH/TRANSIENT, nove chaves antes do modelo, PCM/playback, JSON e pool
// são exercitados pelo transporte Live em live-homologation e live-session-protocol.
