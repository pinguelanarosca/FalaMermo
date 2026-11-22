const test=require('node:test'),assert=require('node:assert/strict');
const live=require('../live-config.js'),sessions=require('../live-session-manager.js');
test('catálogo do STT e do TTS respeita o fim de elegibilidade dos previews',()=>{
 const tts=['gemini-3.8-live','gemini-3.8-live-extended-thinking','gemini-3.1-flash-live-preview','gemini-2.5-flash-native-audio-preview-12-2025'];
 const cutoff=Date.parse('2026-11-17T00:00:00Z'),stt=['gemini-3.5-transcribe-live'];
 assert.deepEqual(live.LIVE_MODEL_PRIORITY,tts);
 assert.deepEqual(live.eligibleModels('tts',cutoff-1),tts);
 assert.deepEqual(live.eligibleModels('tts',cutoff),tts.slice(0,2));
 assert.deepEqual(live.eligibleModels('stt',cutoff-1),stt);
 assert.deepEqual(live.modelChain('stt'),stt);
 for(const id of [...Object.keys(require('../tts-config.js').TTS_MODEL_CAPABILITIES),'gemini-3.5-live-translate-preview'])
  for(const route of ['tts','stt'])assert.throws(()=>live.assertRouteModel(id,route),{httpStatus:400});
 assert.throws(()=>live.assertRouteModel(stt[0],'tts'),{httpStatus:400});
 assert.throws(()=>live.assertRouteModel(tts[0],'stt'),{httpStatus:400});
});
test('setup por modelo respeita thinking level/budget no catálogo Live',()=>{
 assert.equal(live.buildLiveSessionConfig({modelId:'gemini-3.8-live'}).setup.realtimeInputConfig,undefined);
 assert.deepEqual(live.buildLiveSessionConfig({modelId:'gemini-3.8-live-extended-thinking'}).setup.generationConfig.thinkingConfig,{thinkingLevel:'LOW'});
 assert.throws(()=>live.buildLiveSessionConfig({modelId:'gemini-3.8-live-extended-thinking',jsonMode:'complete',advancedJson:{setup:{model:'models/gemini-3.8-live-extended-thinking',generationConfig:{responseModalities:['AUDIO']}}}}),/obrigatório/);
 const three=live.buildLiveSessionConfig({modelId:'gemini-3.1-flash-live-preview',thinkingLevel:'minimal',voiceName:'Kore'}).setup;
 assert.deepEqual(three.generationConfig.thinkingConfig,{thinkingLevel:'MINIMAL'});
 const two=live.buildLiveSessionConfig({modelId:'gemini-2.5-flash-native-audio-preview-12-2025',thinkingBudget:0,thinkingLevel:'high'}).setup;
 assert.deepEqual(two.generationConfig.thinkingConfig,{thinkingBudget:0});
 assert.throws(()=>live.buildLiveSessionConfig({modelId:'gemini-3.8-live',jsonMode:'override',advancedJson:{setup:{generationConfig:{thinkingConfig:{thinkingBudget:0}}}}}),/thinkingConfig/);
 assert.throws(()=>live.buildLiveSessionConfig({modelId:'gemini-3.1-flash-live-preview',jsonMode:'override',advancedJson:{setup:{model:'models/gemini-3.8-flash-tts'}}}),/corresponder/);
});
test('migração TTS conserva seleção antiga e perfis sem sobrescrever escolha Live explícita',()=>{
 const raw={models:{ttsModelId:'gemini-3.8-flash-tts'},agents:{customAgents:[{modelPreferences:{ttsModelId:'gemini-2.5-flash-preview-tts'},live:{preferredModel:'gemini-3.8-flash-lite-tts',fallbackModels:['gemini-3.8-flash-tts'],advancedJson:'legado'},ttsConfig:{modelSettings:{original:{emotion:'calmo'}}}}]}};
 const before=structuredClone(raw),out=live.migrateStorage(raw),agent=out.agents.customAgents[0];assert.deepEqual(raw,before);assert.equal(out.models.legacyTtsModelId,raw.models.ttsModelId);assert.equal(agent.live.preferredModel,'gemini-3.8-live');assert.equal(agent.live.legacyPreferredModel,'gemini-3.8-flash-lite-tts');assert.equal(agent.live.legacyModelPreference,'gemini-2.5-flash-preview-tts');assert.deepEqual(agent.ttsConfig,before.agents.customAgents[0].ttsConfig);assert.deepEqual(agent.live.fallbackModels,['gemini-3.8-flash-tts']);assert.equal(agent.live.advancedJson,'legado');assert.deepEqual(live.migrateStorage(out),out);
 assert.equal(live.migrateAgent({live:{preferredModel:'gemini-3.8-live-extended-thinking'}}).live.preferredModel,'gemini-3.8-live-extended-thinking');assert.equal(live.migrateAgent({}, {ttsModelId:'gemini-3.8-live-extended-thinking'}).live.preferredModel,'gemini-3.8-live-extended-thinking');
});
test('matriz Live central separa narração, transcrição e tradução',()=>{assert.equal(live.caps('gemini-3.8-live').supportsNarration,true);assert.equal(live.caps('gemini-3.5-transcribe-live').supportsNarration,false);assert.equal(live.caps('gemini-3.5-transcribe-live').supportsSTT,true);assert.equal(live.caps('gemini-3.5-live-translate-preview').supportsTranslation,true);});
test('builders validam JSON proibido e separam setup de turno',()=>{assert.throws(()=>live.buildLiveSessionConfig({modelId:'gemini-3.8-live',advancedJson:{setup:{generationConfig:{languageCode:'pt-BR'}}},jsonMode:'override'}),/languageCode/);const config=live.buildLiveSessionConfig({modelId:'gemini-3.8-live',voiceName:'Kore',systemInstruction:'Leia.',outputTranscription:true});assert.equal(config.setup.model,'models/gemini-3.8-live');assert.equal(config.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');assert.deepEqual(live.buildLiveTurnMessage('Olá').clientContent.turns[0].parts,[{text:'Olá'}]);});
test('split semântico preserva texto e não corta palavras',()=>{const text=('Primeiro parágrafo com várias palavras. Segunda frase longa para dividir com segurança. ').repeat(4)+'\n\nTerceiro parágrafo final.';const blocks=live.splitLiveNarrationBlocks(text,120);assert.ok(blocks.length>1);assert.equal(blocks.join(' ').replace(/\s+/g,' '),text.replace(/\s+/g,' '));for(const block of blocks)assert.ok(block.length>0);});
test('migração preserva agentes e campos antigos e adiciona Live',()=>{const original={agents:{activeAgentId:'x',customAgents:[{metadata:{id:'x'},voice:{preferredVoice:'Puck'},prompt:'não apagar',modelPreferences:{ttsModelId:'old',sttModelId:'old'}}]},api:{apiKeys:['a','b']},audio:{volume:.7}};const out=live.migrateStorage(original);assert.equal(out.agents.activeAgentId,'x');assert.equal(out.agents.customAgents[0].prompt,'não apagar');assert.equal(out.agents.customAgents[0].live.preferredModel,'gemini-3.8-live');assert.deepEqual(out.api.apiKeys,['a','b']);assert.equal(out.audio.volume,.7);assert.equal(out.audio.legacyUnaryAudio,false);});
test('classificação Live não penalizável é distinta',()=>{assert.equal(sessions.classifyLiveError(Object.assign(new Error('cancelado'),{cancelled:true})),'CANCELLED');assert.equal(sessions.classifyLiveError(new Error('Extension context invalidated')),'INVALIDATED_CONTEXT');assert.equal(sessions.classifyLiveError(new Error('400 INVALID_ARGUMENT')),'REQUEST');assert.equal(sessions.classifyLiveError(new Error('503 unavailable')),'TRANSIENT');});
test('fallback esgota chaves do mesmo modelo antes de trocar modelo',()=>{const models=['gemini-3.8-live','gemini-3.8-live-extended-thinking'],keys=['a','b','c'];assert.deepEqual(live.buildFallbackAttempts(models,keys,1).map(x=>[x.modelId,x.keyIndex]),[['gemini-3.8-live',1],['gemini-3.8-live',2],['gemini-3.8-live',0],['gemini-3.8-live-extended-thinking',1],['gemini-3.8-live-extended-thinking',2],['gemini-3.8-live-extended-thinking',0]]);assert.deepEqual(live.buildFallbackAttempts(models,keys,1,new Set(['gemini-3.8-live:2'])).slice(0,2).map(x=>x.keyIndex),[1,0]);});
test('painel, override e JSON completo produzem o setup validado',()=>{const options={modelId:'gemini-3.8-live',voiceName:'Kore',systemInstruction:'Leia.'};const panel=live.buildLiveSessionConfig(options);const override=live.buildLiveSessionConfig({...options,jsonMode:'override',advancedJson:{setup:{outputAudioTranscription:{}}}});assert.deepEqual(override.setup.generationConfig,panel.setup.generationConfig);assert.deepEqual(override.setup.outputAudioTranscription,{});const complete=live.buildLiveSessionConfig({...options,jsonMode:'complete',advancedJson:JSON.stringify(override)});assert.deepEqual(complete,override);assert.throws(()=>live.buildLiveSessionConfig({...options,jsonMode:'complete',advancedJson:{setup:{model:'models/gemini-3.8-live',generationConfig:{responseModalities:['TEXT']}}}}),/responseModalities/);});
test('campos unary e metadados não vazam pelos objetos aninhados de TTS',()=>{for(const override of [{generationConfig:{speechConfig:{languageCode:'pt-BR'}}},{generationConfig:{speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore',pitch:1}}}}},{systemInstruction:{parts:[{text:'Leia',speech_metadata:{style:'x'}}]}}]){assert.throws(()=>live.buildLiveSessionConfig({modelId:'gemini-3.8-live',jsonMode:'override',advancedJson:{setup:override}}),error=>error.httpStatus===400&&/Campo Live não suportado/.test(error.message));}assert.doesNotThrow(()=>live.buildLiveSessionConfig({modelId:'gemini-3.8-live',jsonMode:'panel',advancedJson:'{'}));});
test('STT envia TEXT, VERBATIM, português brasileiro e VAD manual',()=>{
 const model=live.DEFAULTS.sttModelId;
 const setup=live.buildLiveSttSessionConfig({mode:'dictation',sttRecognition:{customVocabulary:['termo']},vad:{disabled:false}}).setup;
 assert.deepEqual(setup,{model:'models/'+model,generationConfig:{responseModalities:['TEXT']},
  inputAudioTranscription:{languageCodes:['pt-BR'],mode:'VERBATIM',customVocabulary:['termo']},
  realtimeInputConfig:{automaticActivityDetection:{disabled:true}},sessionResumption:{}});
});
test('STT não recebe voz, instruções, áudio de saída, thinking ou preferências antigas',()=>{
 const sttRecognition={instructions:'Preserve siglas.',language:'auto',customVocabulary:[' Kubernetes ','Kubernetes','Banco de Dados','']};
 const setup=live.buildLiveSttSessionConfig({sttRecognition,voiceName:'Puck',outputTranscription:true,systemInstruction:'Instrução TTS privada',thinkingLevel:'low',jsonMode:'complete',advancedJson:'{'}).setup;
 assert.deepEqual(setup.generationConfig,{responseModalities:['TEXT']});
 assert.deepEqual(setup.inputAudioTranscription,{languageCodes:[],mode:'VERBATIM',customVocabulary:['Kubernetes','Banco de Dados']});
 for(const field of ['systemInstruction','outputAudioTranscription'])assert.equal(setup[field],undefined);
 assert.throws(()=>live.buildLiveSttSessionConfig({modelId:'gemini-3.5-transcribe'}),/não elegível/);
 assert.equal(live.buildLiveSessionConfig({modelId:live.DEFAULTS.ttsModelId,voiceName:'Kore',sttRecognition}).setup.inputAudioTranscription,undefined);
 assert.throws(()=>live.buildLiveSessionConfig({modelId:live.DEFAULTS.ttsModelId,mode:'narration',jsonMode:'override',advancedJson:{setup:{inputAudioTranscription:{languageCodes:['pt-BR']}}}}),/Campo Live não suportado/);
});
test('o builder rejeita SMART, sourceText, áudio de saída e VAD automático no STT',()=>{
 const modelId=live.DEFAULTS.sttModelId;
 for(const setup of [{inputAudioTranscription:{mode:'SMART'}},{inputAudioTranscription:{sourceText:'texto anterior'}},
  {outputAudioTranscription:{}},{realtimeInputConfig:{automaticActivityDetection:{disabled:false}}}, {generationConfig:{thinkingConfig:{thinkingLevel:'LOW'}}}]){
  assert.throws(()=>live.buildLiveSessionConfig({modelId,jsonMode:'override',advancedJson:{setup}}),{httpStatus:400});
 }
});
test('migração conserva as preferências STT antigas sem colocá-las em operação',()=>{
 const raw={models:{sttModelId:live.DEFAULTS.ttsModelId},agents:{customAgents:[{live:{stt:{preferredModel:'gemini-3.8-live-extended-thinking',customVocabulary:['preservado'],smartTranscription:true,transform:false}}}]}};
 const result=live.migrateStorage(raw),stt=result.agents.customAgents[0].live.stt;
 assert.equal(stt.preferredModel,live.DEFAULTS.sttModelId);
 assert.equal(stt.legacyPreferredModel,'gemini-3.8-live-extended-thinking');
 assert.deepEqual(stt.customVocabulary,['preservado']);assert.equal(stt.smartTranscription,true);
 assert.equal(result.models.legacySttModelId,live.DEFAULTS.ttsModelId);
});
test('catálogo STT contém somente o Transcribe Live',()=>{
 assert.deepEqual(live.LIVE_STT_MODELS,[live.DEFAULTS.sttModelId]);
 assert.equal(live.caps(live.DEFAULTS.sttModelId).sttProtocol,'transcribe');
});
test('migração global/agente preserva legado e é idempotente sem alterar TTS e Lens',()=>{
 const raw={models:{sttModelId:'gemini-3.5-transcribe-live',visionModelId:'preservado'},agents:{customAgents:[{modelPreferences:{sttModelId:'gemini-3.5-transcribe'},live:{preferredModel:'gemini-3.8-live-extended-thinking',advancedJson:'JSON preservado',stt:{preferredModel:'gemini-3.5-transcribe-live',fallbackModels:['gemini-3.5-transcribe-live','gemini-3.8-live'],customVocabulary:['termo'],smartTranscription:false,transform:true}}}]}},before=structuredClone(raw),out=live.migrateStorage(raw);
 assert.deepEqual(raw,before);assert.equal(out.models.sttModelId,live.DEFAULTS.sttModelId);assert.equal(out.models.legacySttModelId,undefined);assert.equal(out.models.visionModelId,'preservado');const agent=out.agents.customAgents[0];assert.equal(agent.live.stt.preferredModel,live.DEFAULTS.sttModelId);assert.equal(agent.live.stt.legacyPreferredModel,undefined);assert.equal(agent.modelPreferences.sttModelId,'gemini-3.5-transcribe');assert.deepEqual(agent.live.stt.fallbackModels,before.agents.customAgents[0].live.stt.fallbackModels);assert.equal(agent.live.advancedJson,'JSON preservado');assert.equal(agent.live.stt.transform,true);assert.deepEqual(live.migrateStorage(out),out);
 assert.equal(agent.live.stt.legacyModelPreference,'gemini-3.5-transcribe');
});

test('erros Live distinguem chave, pedido e conectividade',()=>{
 for(const [fields,expected] of [
  [{httpStatus:400},'REQUEST'],[{httpStatus:401},'AUTH'],[{httpStatus:403},'AUTH'],[{httpStatus:429},'QUOTA'],
  [{closeCode:1007,closeReason:'Response modality is not supported'},'REQUEST'],
  [{closeCode:1008,closeReason:'Permission denied on the service.'},'AUTH'],
  [{closeCode:1008,closeReason:'Invalid model configuration'},'REQUEST'],[{closeCode:1006},'TRANSIENT'],
  [{message:'Timeout aguardando setupComplete'},'TRANSIENT'],[{message:'Falha de rede no WebSocket Live'},'NETWORK']
 ])assert.equal(sessions.classifyLiveError(Object.assign(Error('Falha Live'),fields)),expected);
});
