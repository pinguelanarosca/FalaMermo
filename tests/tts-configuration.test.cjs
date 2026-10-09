const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const config=require('../tts-config.js');
const text='Texto inteiro.\nSegundo parágrafo.';
const request={text,voiceName:'Kore',systemInstruction:'Leia com calma.'};
function backgroundConfig(){const context=vm.createContext({});vm.runInContext(require('./load-background.cjs')(require('node:path').join(__dirname,'../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),context);const module={exports:{}};context.modules['shared/utils/ttsConfiguration.ts'](module,module.exports,()=>{});return module.exports;}
test('configuração personalizada mantém o texto integral e as instruções fora da fala no Gemini 3.8',()=>{
 const payload=config.buildPayload({...request,ttsConfig:{languageCode:'pt-BR',audioProfile:'Voz adulta',emotion:'Acolhedora',accent:'Mineiro',pace:'Pausas suaves',directorNotes:'Ênfase nas conclusões',temperature:0,seed:0,maxOutputTokens:8192,topP:.9,topK:30}},'gemini-3.8-flash-tts');
 assert.equal(payload.contents[0].parts.length,1);assert.equal(payload.contents[0].parts[0].text,text);assert.match(payload.contents[0].parts[0].speech_metadata.style,/Mineiro/);assert.match(payload.contents[0].parts[0].speech_metadata.style,/Leia com calma/);assert.equal(payload.generationConfig.speechConfig.languageCode,'pt-BR');assert.equal(payload.generationConfig.temperature,undefined);assert.equal(payload.generationConfig.seed,undefined);
});
test('editor e serviço montam o mesmo pedido, incluindo voz personalizada, formato e amostragem',()=>{
 const custom={...request,ttsConfig:{voiceId:'voice_example',outputFormat:'AUDIO_WAV',sampleRate:16000,bitRate:32000}};
 const payload=config.buildPayload(custom,'gemini-3.8-flash-lite-tts');
 assert.equal(payload.generationConfig.speechConfig.voiceConfig.voice,'voice_example');assert.deepEqual(payload.generationConfig.responseFormat.audio,{mimeType:'AUDIO_WAV',sampleRate:16000});
 assert.equal(JSON.stringify(payload),JSON.stringify(backgroundConfig().buildPayload(custom,'gemini-3.8-flash-lite-tts')));
});
test('diálogo com duas vozes usa um único payload e mantém todas as falas e estilos',()=>{
 const dialogue={...request,text:'Ana: Olá!\nContinuação da Ana.\nBruno: Bom dia.\nAna: Vamos começar.',ttsConfig:{mode:'dialogue',speakers:[{name:'Ana',voice:'Kore',style:'Calma'},{name:'Bruno',voice:'Puck',style:'Animado'}]}};
 const payload=config.buildPayload(dialogue,'gemini-3.8-flash-tts');assert.equal(payload.contents.length,1);assert.equal(payload.contents[0].parts.length,3);assert.equal(payload.contents[0].parts[0].text,'Olá!\nContinuação da Ana.');assert.equal(payload.contents[0].parts[1].speech_metadata.speaker,'Bruno');assert.match(payload.contents[0].parts[1].speech_metadata.style,/Animado/);assert.equal(payload.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.length,2);assert.equal(payload.generationConfig.speechConfig.voiceConfig,undefined);
 const legacy=config.buildPayload(dialogue,'gemini-3.1-flash-tts-preview');assert.match(legacy.contents[0].parts[0].text,/Ana: Olá!/);assert.equal(legacy.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs[0].voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');
});
test('configurações inválidas e diálogo sem identificação são recusados antes da API',()=>{
 for(const ttsConfig of [{outputFormat:'INVALID'},{sampleRate:123},{mode:'dialogue',speakers:[{name:'Ana',voice:'voice_custom'},{name:'Ana',voice:'Kore'}]}])assert.throws(()=>config.buildPayload({...request,ttsConfig},'gemini-3.8-flash-tts'));
 assert.throws(()=>config.buildPayload({...request,ttsConfig:{mode:'dialogue',speakers:[{name:'Ana',voice:'Kore'},{name:'Bruno',voice:'Puck'}]}},'gemini-3.8-flash-tts'),/cada trecho/);
});
test('fallback legado preserva voz e estilo e usa o formato padrão de áudio',()=>{
 const payload=config.buildPayload({...request,ttsConfig:{accent:'Brasileiro',outputFormat:'AUDIO_MP3',sampleRate:16000}},'gemini-3.1-flash-tts-preview');assert.match(payload.contents[0].parts[0].text,/Brasileiro/);assert.ok(payload.contents[0].parts[0].text.endsWith(text));assert.equal(payload.generationConfig.responseFormat,undefined);assert.equal(payload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');
 assert.throws(()=>config.buildPayload({...request,ttsConfig:{voiceId:'voice_demo'}},'gemini-3.1-flash-tts-preview'),/não aceita/);
});
test('PCM na amostragem escolhida vira WAV; áudio comprimido mantém os bytes originais',()=>{
 const bytes=new Uint8Array([0,0,255,127]);const audio=config.prepareAudio(bytes,'audio/l16;rate=16000');assert.equal(new DataView(audio.bytes.buffer).getUint32(24,true),16000);assert.equal(audio.bytes.length,48);assert.equal(audio.mimeType,'audio/wav');
 for(const mime of ['audio/mpeg','audio/ogg']){const compressed=config.prepareAudio(bytes,mime);assert.equal(compressed.bytes,bytes);assert.equal(compressed.mimeType,mime);}
 assert.equal(config.prepareAudio(audio.bytes,'audio/wav').bytes,audio.bytes);
});
test('G.711 μ-law e A-law são decodificados para PCM correto antes de reproduzir',()=>{
 const mu=config.prepareAudio(new Uint8Array([255,127,0,128]),'audio/mulaw',8000);assert.deepEqual(Array.from(new Int16Array(mu.bytes.buffer,44)),[0,0,-32124,32124]);assert.equal(new DataView(mu.bytes.buffer).getUint32(24,true),8000);
 const a=config.prepareAudio(new Uint8Array([213,85,42,170]),'audio/alaw',8000);assert.deepEqual(Array.from(new Int16Array(a.bytes.buffer,44)),[8,-8,-32256,32256]);
});

test('matriz dos quatro modelos bloqueia campos genéricos e controles locais em qualquer payload',()=>{
 const all={temperature:1,topP:.8,topK:40,candidateCount:2,seed:7,maxOutputTokens:2,thinkingConfig:{thinkingBudget:9},systemInstruction:'Indevido',rateMultiplier:1.5,pitchMultiplier:1.4,volume:.2,bitRate:32000};
 for(const [id,caps] of Object.entries(config.TTS_MODEL_CAPABILITIES)){
  const payload=config.buildPayload({...request,...all,ttsConfig:{...all,accent:'Brasileiro',languageCode:'pt-BR',outputFormat:'AUDIO_WAV',sampleRate:16000}},id);
  const serialized=JSON.stringify(payload);
  for(const key of Object.keys(all))assert.ok(!serialized.includes('"'+key+'"'),id+' envia '+key);
  assert.equal(Boolean(payload.generationConfig.responseFormat),caps.audioFormat);
  assert.equal(Boolean(payload.generationConfig.speechConfig.languageCode),caps.languageCode);
  assert.equal(serialized.includes('speech_metadata'),caps.modernVoice);
 }
});
test('persistência mantém ajustes independentes, legado e propriedades desconhecidas sem alteração',()=>{
 const initial={accent:'Original',pace:'Ritmo e pausas existentes',temperature:1,extra:{personal:42}},before=structuredClone(initial);
 const [modern,,legacy]=Object.keys(config.TTS_MODEL_CAPABILITIES);
 let saved=config.saveModelConfig(initial,modern,{accent:'Mineiro',voiceId:'voice_example',instruction:'',voiceName:'Kore',sampleRate:'16000',rateMultiplier:2});
 saved=config.saveModelConfig(saved,legacy,{accent:'Baiano',voiceId:'voice_forbidden',voiceName:'Puck',instruction:'Leia com energia.',sampleRate:'8000'});
 assert.deepEqual(initial,before);assert.equal(saved.accent,'Original');assert.deepEqual(saved.extra,before.extra);
 assert.equal(config.getModelConfig(saved,modern).accent,'Mineiro');assert.equal(config.getModelConfig(saved,modern).voiceId,'voice_example');assert.equal(config.getModelConfig(saved,modern).instruction,'');
 assert.equal(config.getModelConfig(saved,legacy).accent,'Baiano');assert.equal(config.getModelConfig(saved,legacy).voiceId,undefined);assert.equal(config.getModelConfig(saved,legacy).sampleRate,undefined);
 const p=config.buildPayload({...request,ttsConfig:saved},legacy);assert.match(p.contents[0].parts[0].text,/Baiano/);assert.doesNotMatch(JSON.stringify(p),/Mineiro|voice_example|sampleRate|rateMultiplier/);
 assert.deepEqual(config.getModelConfig(saved,Object.keys(config.TTS_MODEL_CAPABILITIES)[1]),before);
});
test('backend exporta o mesmo módulo importado, sem segunda implementação de buildPayload',()=>{
 const path=require('node:path'),source=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
 assert.match(source,/^import '\.\/tts-config\.js';/);assert.doesNotMatch(source,/function buildPayload\(/);
 const ctx=vm.createContext({});vm.runInContext(require('./load-background.cjs')(path.join(__dirname,'../background.js')).replace('__require("extension/src/background/index.ts");','globalThis.modules=__modules;'),ctx);
 const m={exports:{}};ctx.modules['shared/utils/ttsConfiguration.ts'](m,m.exports,()=>{});assert.equal(m.exports,ctx.TtsConfig);
});
test('eventos legados e modernos são adaptados somente quando documentados; texto literal permanece',()=>{
 const modern=config.buildPayload({...request,text:'Primeiro [sigh] <laugh> <short pause> fim. Código: <div>.'},'gemini-3.8-flash-tts');assert.equal(modern.contents[0].parts[0].text,'Primeiro <sigh> <laugh> <short pause> fim. Código: <div>.');
 const legacy=config.buildPayload({...request,text:'Olá <sigh> <laugh>.'},'gemini-3.1-flash-tts-preview');assert.ok(legacy.contents[0].parts[0].text.endsWith('Olá [sigh] [laughing].'));
 assert.throws(()=>config.buildPayload({...request,text:'Olá <cough>.'},'gemini-2.5-flash-preview-tts'),/suporte verificado/);
});
test('MP3, Opus, 48 kHz e modelos desconhecidos são recusados antes da requisição',()=>{
 for(const ttsConfig of [{outputFormat:'AUDIO_MP3'},{outputFormat:'AUDIO_OGG_OPUS'},{sampleRate:48000}])assert.throws(()=>config.buildPayload({...request,ttsConfig},'gemini-3.8-flash-tts'),/não suportad/);
 assert.throws(()=>config.buildPayload(request,'model-unverified'),/capacidades verificadas/);
});

test('amostragem legada ignora opções não enviadas e MIME audio/basic decodifica MuLaw',()=>{
 assert.equal(config.getOutputSampleRate({sampleRate:8000},'gemini-2.5-flash-preview-tts'),24000);
 assert.equal(config.getOutputSampleRate({sampleRate:16000},'gemini-3.8-flash-tts'),16000);
 const bytes=new Uint8Array([255,0,128]);
 assert.deepEqual(config.prepareAudio(bytes,'audio/basic',8000).bytes,config.prepareAudio(bytes,'audio/mulaw',8000).bytes);
});
