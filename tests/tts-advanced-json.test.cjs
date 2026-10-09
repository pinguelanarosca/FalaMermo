const assert=require('node:assert/strict'),test=require('node:test');
const tts=require('../tts-config.js');
const models=Object.keys(tts.TTS_MODEL_CAPABILITIES);
const modern=models.slice(0,2),legacy=models.slice(2);
const text='Narração inteira com "aspas", \\ barras, ação 😀.\n$& $` ${globalThis} {{TEXT}}';
const template=id=>JSON.parse(tts.getAdvancedTemplate(id));
const profile=json=>({advancedJson:typeof json==='string'?json:JSON.stringify(json),advancedJsonEnabled:true,voiceName:'Puck',instruction:'Visual preservado',sampleRate:8000});
const build=(id,json)=>tts.buildPayload({text,voiceName:'Puck',systemInstruction:'Não substituir o JSON',ttsConfig:profile(json)},id);

for(const [index,id] of models.entries()){
 test('JSON oficial e payload final preservam schema e texto integral: '+id,()=>{
  const initial=template(id),before=structuredClone(initial),cfg=profile(initial);
  const valid=tts.validateAdvancedJson(cfg.advancedJson,id);
  assert.deepEqual(valid,initial);
  const payload=tts.buildPayload({text,ttsConfig:cfg},id);
  const expected=structuredClone(initial);expected.contents[0].parts[0].text=(index<2?'':'Read naturally and expressively: ')+text;
  assert.deepEqual(payload,expected);assert.deepEqual(initial,before);
  assert.equal(cfg.advancedJson,JSON.stringify(before));assert.equal(payload.contents.length,1);
  if(index<2){assert.equal(payload.generationConfig.speechConfig.voiceConfig.voice,'Kore');assert.equal(tts.getOutputSampleRate(cfg,id),24000);}
  else{assert.equal(payload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');assert.ok(!JSON.stringify(payload).includes('speech_metadata'));assert.equal(payload.generationConfig.responseFormat,undefined);}
 });
}
test('JSON malformado, JS, objetos/arrays e propriedades desconhecidas não são executados',()=>{
 globalThis.__advancedExecuted=false;
 for(const value of ['{','undefined','(()=>{globalThis.__advancedExecuted=true})()','null','[]','1',{}])assert.throws(()=>tts.validateAdvancedJson(value,models[0]));
 assert.equal(globalThis.__advancedExecuted,false);delete globalThis.__advancedExecuted;
 for(const key of ['apiKey','apiKeys','endpoint','headers','retry','fallback','tools','systemInstruction','live','stt','lens','__proto__']){
  const json=template(models[0]);Object.defineProperty(json,key,{value:'indevido',enumerable:true});
  assert.throws(()=>build(models[0],json),error=>error.message.startsWith(key+': campo não suportado'));
 }
});
test('incompatibilidade mostra caminho exato, inclusive controles locais e enums',()=>{
 for(const id of models)for(const key of ['temperature','topP','topK','candidateCount','rateMultiplier','pitchMultiplier','volume','thinkingConfig','seed','bitRate']){
  const json=template(id);json.generationConfig[key]=1;
  assert.throws(()=>build(id,json),error=>error.message.startsWith('generationConfig.'+key+': campo não suportado')&&error.message.includes(id));
 }
 const bad=template(modern[0]);bad.contents[0].parts[0].speech_metadata.unknown='x';
 assert.throws(()=>build(modern[0],bad),/contents\[0\]\.parts\[0\]\.speech_metadata\.unknown: campo não suportado/);
 for(const value of [['AUDIO','TEXT'],['TEXT'],[],null]){const json=template(modern[0]);json.generationConfig.responseModalities=value;assert.throws(()=>build(modern[0],json),/generationConfig.responseModalities/);}
});
test('{{TEXT}} só existe no template; substituição literal não injeta JSON nem modifica a configuração',()=>{
 for(const id of models){
  const json=template(id);assert.ok(build(id,json).contents[0].parts[0].text.endsWith(text));
  json.contents[0].parts[0].text='Texto fixo sem placeholder';assert.throws(()=>build(id,json),/use \{\{TEXT\}\}/);
  json.contents[0].parts[0].text='{{TEXT}} {{TEXT}}';assert.throws(()=>build(id,json),/exatamente uma vez/);
 }
 const json=template(modern[0]);json.contents[0].parts[0].speech_metadata.style='{{TEXT}}';
 assert.throws(()=>build(modern[0],json),/contents\[0\]\.parts\[0\]\.speech_metadata.style/);
});
test('catálogo e IDs voice_ / voicekey_ nos 3.8, sem aceitar IDs em legados',()=>{
 for(const id of modern)for(const voice of ['Kore','Puck','voice_example','voicekey_example']){
  const json=template(id);json.generationConfig.speechConfig.voiceConfig.voice=voice;
  assert.equal(build(id,json).generationConfig.speechConfig.voiceConfig.voice,voice);
 }
 for(const id of legacy)for(const voice of ['voice_example','voicekey_example']){
  const json=template(id);json.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName=voice;
  assert.throws(()=>build(id,json),/generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName/);
 }
 for(const voice of ['voice_','voicekey_','Inventada','voice_ espaços']){const json=template(modern[0]);json.generationConfig.speechConfig.voiceConfig.voice=voice;assert.throws(()=>build(modern[0],json),/valor não suportado/);}
});
test('formatos, sample rates e idiomas são validados pelas capacidades',()=>{
 for(const id of modern){
  const caps=tts.getCapabilities(id);
  for(const mimeType of caps.audioFormats)for(const sampleRate of caps.sampleRates){
   const json=template(id);json.generationConfig.responseFormat.audio={mimeType,sampleRate};json.generationConfig.speechConfig.languageCode='pt-BR';
   assert.deepEqual(build(id,json).generationConfig.responseFormat.audio,{mimeType,sampleRate});assert.equal(tts.getOutputSampleRate(profile(json),id),sampleRate);
  }
  for(const value of [48000,'16000',null]){const json=template(id);json.generationConfig.responseFormat.audio.sampleRate=value;assert.throws(()=>build(id,json),/generationConfig.responseFormat.audio.sampleRate/);}
  for(const value of ['AUDIO_MP3','AUDIO_OGG_OPUS']){const json=template(id);json.generationConfig.responseFormat.audio.mimeType=value;assert.throws(()=>build(id,json),/generationConfig.responseFormat.audio.mimeType/);}
  const json=template(id);json.generationConfig.speechConfig.languageCode='invalid';assert.throws(()=>build(id,json),/generationConfig.speechConfig.languageCode/);
 }
});
test('legados recusam campos exclusivos do schema moderno, sem converter o JSON',()=>{
 for(const id of legacy){
  for(const key of ['responseFormat']){const json=template(id);json.generationConfig[key]={audio:{mimeType:'AUDIO_WAV'}};assert.throws(()=>build(id,json),/generationConfig.responseFormat: campo não suportado/);}
  const metadata=template(id);metadata.contents[0].parts[0].speech_metadata={style:'Narrar'};assert.throws(()=>build(id,metadata),/contents\[0\].parts\[0\].speech_metadata: campo não suportado/);
  const voice=template(id);voice.generationConfig.speechConfig.voiceConfig={voice:'Kore'};assert.throws(()=>build(id,voice),/generationConfig.speechConfig.voiceConfig.voice: campo não suportado/);
 }
});
test('duas vozes permanecem em uma narração, com nomes únicos e vozes de catálogo',()=>{
 for(const id of models){
  const json=template(id);delete json.generationConfig.speechConfig.voiceConfig;
  const narrators=[{speaker:'Ana',voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}},{speaker:'Bruno',voiceConfig:{prebuiltVoiceConfig:{voiceName:'Puck'}}}];
  json.generationConfig.speechConfig.multiSpeakerVoiceConfig={speakerVoiceConfigs:narrators};
  if(tts.getCapabilities(id).modernVoice)json.contents[0].parts[0].speech_metadata.speaker='Ana';
  const result=build(id,json);assert.equal(result.contents.length,1);assert.equal(result.generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs.length,2);
  narrators[1].speaker='Ana';assert.throws(()=>build(id,json),/nomes dos narradores/);narrators[1].speaker='Bruno';
  narrators[0].voiceConfig.prebuiltVoiceConfig.voiceName='voice_example';assert.throws(()=>build(id,json),/voiceName/);narrators[0].voiceConfig.prebuiltVoiceConfig.voiceName='Kore';
  json.generationConfig.speechConfig.voiceConfig=template(id).generationConfig.speechConfig.voiceConfig;assert.throws(()=>build(id,json),/exatamente um/);
 }
});
test('perfis independentes preservam JSON, estados visuais, dados antigos e rascunhos desativados',()=>{
 const initial={accent:'Original',unknownPersonalSetting:{keep:42}},before=structuredClone(initial);let saved=initial;
 for(const [index,id] of models.entries())saved=tts.saveModelConfig(saved,id,{...profile(template(id)),emotion:'Tom '+index,voiceName:'Puck'});
 const snapshot=structuredClone(saved);
 for(const [index,id] of models.entries()){
  const cfg=tts.getModelConfig(saved,id);assert.equal(cfg.emotion,'Tom '+index);assert.equal(cfg.advancedJsonEnabled,true);assert.equal(cfg.advancedJson,JSON.stringify(template(id)));
  saved=tts.saveModelConfig(saved,id,{...cfg,advancedJsonEnabled:false});
  assert.equal(tts.getModelConfig(saved,id).advancedJson,cfg.advancedJson);
  const visual=tts.buildPayload({text:'Texto visual',voiceName:'Puck',ttsConfig:saved},id);assert.ok(JSON.stringify(visual).includes('Tom '+index));
 }
 assert.deepEqual(initial,before);assert.deepEqual(saved.unknownPersonalSetting,before.unknownPersonalSetting);
 for(const id of models)assert.equal(tts.getModelConfig(saved,id).advancedJson,tts.getModelConfig(snapshot,id).advancedJson);
 saved=tts.saveModelConfig(saved,modern[0],{...tts.getModelConfig(saved,modern[0]),advancedJson:'{ rascunho inválido',advancedJsonEnabled:false});
 assert.ok(tts.buildPayload({text:'Texto visual',ttsConfig:saved},modern[0]));assert.match(tts.getModelConfig(saved,modern[0]).advancedJson,/rascunho/);
});
test('schema central informa todos os caminhos, enums e templates sem mutabilidade',()=>{
 for(const id of models){const caps=tts.getCapabilities(id),adv=caps.advancedJson;assert.ok(Object.isFrozen(adv.schema));assert.equal(adv.schemaKind,caps.modernVoice?'modern':'legacy');assert.ok(adv.allowedPaths.includes('contents[].parts[].text'));assert.deepEqual(adv.enumValues['generationConfig.responseModalities[]'],['AUDIO']);assert.ok(adv.forbiddenFields.includes('apiKey'));assert.ok(caps.persistFields.includes('advancedJson'));assert.ok(caps.persistFields.includes('advancedJsonEnabled'));assert.deepEqual(tts.validateAdvancedJson(tts.getAdvancedTemplate(id),id),adv.template);}
});
