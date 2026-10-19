const DEFAULT_AGENTS=[{"metadata":{"id":"narrator","name":"Narrador Fluido","description":"Leitura expressiva, humana e fluida com pontuação natural e ritmo dinâmico.","category":"productivity","icon":"Volume2","color":"#3b82f6","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Puck","pitchMultiplier":1,"rateMultiplier":1,"volume":1},"instructions":{"ttsSystemInstruction":"Você é um narrador profissional e dinâmico. Leia o texto de forma expressiva, clara e envolvente. Ignore metadados da página, URLs, numeração de rodapé ou botões de navegação. Respeite pausas e respirações humanas.","sttFormattingInstruction":"Transcreva a fala capturada com máxima fidelidade. Insira pontuação gramaticalmente correta, elimine vícios de linguagem e hesitações (como \"hã\", \"é\", \"tipo\") e formate parágrafos coerentes.","lensInspectionInstruction":"Descreva o conteúdo visual principal da página ou elemento focado em uma narração concisa e informativa."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"translator","name":"Tradutor Simultâneo","description":"Traduz instantaneamente o texto para o idioma de destino e o narra com pronúncia nativa.","category":"translation","icon":"Languages","color":"#10b981","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Charon","pitchMultiplier":1,"rateMultiplier":0.95,"volume":1},"instructions":{"ttsSystemInstruction":"Você é um tradutor simultâneo profissional. Detecte o idioma de origem do texto. Se o texto for em língua estrangeira, traduza-o para o português com fluência e precisão idiomática e leia diretamente a tradução. Se for em português, traduza e leia em inglês com pronúncia límpida.","sttFormattingInstruction":"Transcreva o áudio traduzindo o conteúdo falado diretamente para o idioma de destino selecionado, mantendo fidelidade semântica e vocabulário técnico apropriado.","lensInspectionInstruction":"Extraia e traduza todos os textos visíveis na área capturada da tela."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"summarizer","name":"Resumidor Executivo","description":"Sintetiza artigos e páginas longas em tópicos verbais densos e objetivos.","category":"productivity","icon":"Sparkles","color":"#8b5cf6","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Fenrir","pitchMultiplier":1,"rateMultiplier":1.05,"volume":1},"instructions":{"ttsSystemInstruction":"Você é um analista executivo. Em vez de ler todo o texto prolixo, produza uma síntese dos pontos centrais em 3 a 5 pontos-chave e leia essa síntese com tom confiante, conciso e profissional.","sttFormattingInstruction":"Transcreva o áudio capturado e formate como uma lista ordenada de tópicos executivos e planos de ação.","lensInspectionInstruction":"Sintetize os dados de gráficos, tabelas ou formulários da tela em um resumo auditivo de alto nível."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"editor","name":"Revisor Gramatical & Ditado","description":"Ideal para ditar respostas, emails e artigos; corrige gramática e eleva o estilo.","category":"editorial","icon":"FileText","color":"#f59e0b","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Kore","pitchMultiplier":1,"rateMultiplier":1,"volume":1},"instructions":{"ttsSystemInstruction":"Analise a redação do texto fornecido. Leia o texto corrigindo sutilmente eventuais deslizes gramaticais ou inadequações de concordância para que a audição soe culta e agradável.","sttFormattingInstruction":"Você é um copidesque e redator sênior. Ao ditar, transforme a fala espontânea em um texto escrito perfeito, polido, com vocabulário refinado e estrutura de frases impecável, pronto para envio profissional.","lensInspectionInstruction":"Inspecione a redação do documento ou página visível e aponte sugestões de revisão gramatical."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"explainer","name":"Professor Didático","description":"Explica conceitos complexos de forma simples e didática com analogias claras.","category":"productivity","icon":"GraduationCap","color":"#06b6d4","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Aoede","pitchMultiplier":1,"rateMultiplier":0.95,"volume":1},"instructions":{"ttsSystemInstruction":"Você é um educador didático usando o método Feynman. Explique o texto selecionado de forma compreensível para qualquer público, decompondo jargões técnicos em analogias do cotidiano.","sttFormattingInstruction":"Transcreva a explicação falada estruturando-a com títulos conceituais, tópicos numerados e conclusões claras.","lensInspectionInstruction":"Explique visualmente o diagrama, infográfico ou conceito apresentado na tela capturada."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"developer","name":"Assistente de Código & Dev","description":"Leitura técnica de código-fonte, erros e sintaxe; transcrição com termos de programação.","category":"productivity","icon":"Code","color":"#14b8a6","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Fenrir","pitchMultiplier":1,"rateMultiplier":1.05,"volume":1},"instructions":{"ttsSystemInstruction":"Você é um engenheiro de software sênior. Ao ler código ou stacktraces, verbalize a lógica, parâmetros e estruturas de controle de forma inteligível sem soletrar caracteres desnecessários.","sttFormattingInstruction":"Transcreva o áudio preservando convenções de programação (camelCase, snake_case), palavras-chave de linguagem e blocos de código com indentação correta.","lensInspectionInstruction":"Analise o código, erro no console ou interface de desenvolvimento na tela e proponha a solução técnica."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"podcast","name":"Estilo Podcast","description":"Tom conversacional, dinâmico e envolvente como um apresentador de podcast.","category":"productivity","icon":"Mic","color":"#f43f5e","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Puck","pitchMultiplier":1,"rateMultiplier":1.05,"volume":1},"instructions":{"ttsSystemInstruction":"Você é o apresentador de um podcast popular. Transforme o texto em uma narrativa engajante, com entonação vibrante, humor sutil e ritmo estimulante que prenda a atenção do ouvinte.","sttFormattingInstruction":"Transcreva a fala mantendo a autenticidade e entusiasmo da conversa, estruturando diálogos dinâmicos.","lensInspectionInstruction":"Comente os elementos visuais da página como se estivesse apresentando uma transmissão ao vivo com seus ouvintes."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-tts","sttModelId":"gemini-3.5-flash-lite"}},{"metadata":{"id":"accessibility","name":"Leitor de Acessibilidade","description":"Audiodescrição detalhada e leitura com contexto estrutural (tabelas, títulos e links).","category":"accessibility","icon":"Eye","color":"#ec4899","isBuiltIn":true,"version":1},"voice":{"preferredVoice":"Aoede","pitchMultiplier":1,"rateMultiplier":0.9,"volume":1},"instructions":{"ttsSystemInstruction":"Você é um especialista em acessibilidade e audiodescrição. Leia o texto indicando claramente hierarquias de títulos, legendas de imagens e contexto para usuários com deficiência visual.","sttFormattingInstruction":"Transcreva a voz preservando pontuação fonética e marcações semânticas com precisão absoluta.","lensInspectionInstruction":"Realize audiodescrição minuciosa dos elementos visuais, layout, botões e imagens da tela ativa."},"modelPreferences":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite"}}];
const DEFAULTS={"api":{"apiKey":"","apiKeys":[],"timeoutMs":30000},"agents":{"activeAgentId":"narrator","customAgents":[],"favoriteAgentIds":["narrator","translator","summarizer"]},"audio":{"sampleRate":24000,"preferredVoice":"Puck","autoPlay":true,"volume":1,"pitchMultiplier":1,"rateMultiplier":1},"models":{"ttsModelId":"gemini-3.8-flash-lite-tts","sttModelId":"gemini-3.5-flash-lite","visionModelId":"gemini-3.5-flash-lite","generalModelId":"gemini-3.5-flash-lite","discoveredModels":[]},"ui":{"hudPosition":{"x":24,"y":24},"theme":"system","autoInject":true,"shortcuts":{"toggleHud":"Alt+Shift+H","readSelection":"Ctrl+B","startDictation":"Ctrl+Shift+Space","togglePause":"Pause","lensSelection":"Ctrl+Shift+L"}},"history":{"enabled":true,"maxEntries":50,"recentItems":[]},"logs":{"enabled":true,"maxEntries":100,"items":[]}};
const KNOWN_MODELS={"gemini-3.8-flash-lite-tts":{"id":"gemini-3.8-flash-lite-tts","displayName":"Gemini 3.8 Flash-Lite TTS","description":"Modelo de áudio de alta eficiência e ultrabaixa latência para leitura e TTS padrão.","category":"tts","tier":"lite","inputModalities":{"text":true,"image":false,"audio":false,"video":false},"outputModalities":{"text":false,"audio":true,"image":false},"tasks":{"general":{"supported":false},"vision":{"supported":false},"stt":{"supported":false},"tts":{"supported":true,"method":"generateContent"},"live":{"supported":false}},"capabilities":{"mapsGrounding":false},"apiMethods":["generateContent"],"streaming":false,"deprecated":false,"availability":"ga","recommendedMaxTokens":4096},"gemini-3.8-flash-tts":{"id":"gemini-3.8-flash-tts","displayName":"Gemini 3.8 Flash TTS","description":"Modelo flagship de síntese vocal com suporte a entonações expressivas e diálogos.","category":"tts","tier":"flash","inputModalities":{"text":true,"image":false,"audio":false,"video":false},"outputModalities":{"text":false,"audio":true,"image":false},"tasks":{"general":{"supported":false},"vision":{"supported":false},"stt":{"supported":false},"tts":{"supported":true,"method":"generateContent"},"live":{"supported":false}},"capabilities":{"mapsGrounding":false},"apiMethods":["generateContent"],"streaming":false,"deprecated":false,"availability":"ga","recommendedMaxTokens":8192},"gemini-3.1-flash-tts-preview":{"id":"gemini-3.1-flash-tts-preview","displayName":"Gemini 3.1 Flash TTS","description":"Modelo TTS balanceado para leitura natural em preview.","category":"tts","tier":"preview","inputModalities":{"text":true,"image":false,"audio":false,"video":false},"outputModalities":{"text":false,"audio":true,"image":false},"tasks":{"general":{"supported":false},"vision":{"supported":false},"stt":{"supported":false},"tts":{"supported":true,"method":"generateContent"},"live":{"supported":false}},"capabilities":{"mapsGrounding":false},"apiMethods":["generateContent"],"streaming":false,"deprecated":false,"availability":"preview","recommendedMaxTokens":4096},"gemini-2.5-flash-preview-tts":{"id":"gemini-2.5-flash-preview-tts","displayName":"Gemini 2.5 Flash TTS","description":"Modelo de síntese vocal com compatibilidade para endpoints 2.5.","category":"tts","tier":"preview","inputModalities":{"text":true,"image":false,"audio":false,"video":false},"outputModalities":{"text":false,"audio":true,"image":false},"tasks":{"general":{"supported":false},"vision":{"supported":false},"stt":{"supported":false},"tts":{"supported":true,"method":"generateContent"},"live":{"supported":false}},"capabilities":{"mapsGrounding":false},"apiMethods":["generateContent"],"streaming":false,"deprecated":false,"availability":"preview","recommendedMaxTokens":4096},"gemini-3.5-flash-lite":{"id":"gemini-3.5-flash-lite","displayName":"Gemini 3.5 Flash-Lite","description":"Modelo Flash-Lite intermediário para transcrição STT Unary via generateContent, visão multimodal e tarefas gerais.","category":"general_multimodal","tier":"lite","inputModalities":{"text":true,"image":true,"audio":true,"video":true},"outputModalities":{"text":true,"audio":false,"image":false},"tasks":{"general":{"supported":true},"vision":{"supported":true,"method":"generateContent"},"stt":{"supported":true,"method":"generateContent"},"tts":{"supported":false},"live":{"supported":false}},"capabilities":{"mapsGrounding":true},"apiMethods":["generateContent","generateContentStream"],"streaming":true,"deprecated":false,"availability":"ga","recommendedMaxTokens":8192},"gemini-3.1-flash-lite":{"id":"gemini-3.1-flash-lite","displayName":"Gemini 3.1 Flash-Lite","description":"Modelo leve de ultrabaixa latência para autenticação, testes de conectividade, STT Unary e visão.","category":"general_multimodal","tier":"lite","inputModalities":{"text":true,"image":true,"audio":true,"video":true},"outputModalities":{"text":true,"audio":false,"image":false},"tasks":{"general":{"supported":true},"vision":{"supported":true,"method":"generateContent"},"stt":{"supported":true,"method":"generateContent"},"tts":{"supported":false},"live":{"supported":false}},"capabilities":{"mapsGrounding":true},"apiMethods":["generateContent","generateContentStream"],"streaming":true,"deprecated":false,"availability":"ga","recommendedMaxTokens":8192}};
const CHAINS={"tts":["gemini-3.8-flash-lite-tts","gemini-3.8-flash-tts","gemini-3.1-flash-tts-preview","gemini-2.5-flash-preview-tts"],"stt":["gemini-3.5-flash-lite","gemini-3.1-flash-lite"],"stt_unary":["gemini-3.5-flash-lite","gemini-3.1-flash-lite"],"vision":["gemini-3.5-flash-lite","gemini-3.1-flash-lite"],"general":["gemini-3.5-flash-lite","gemini-3.1-flash-lite"],"auth_test":["gemini-3.1-flash-lite","gemini-3.5-flash-lite"]};
const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];
const clone=(v)=>structuredClone(v);
const COLORS=['#3b82f6','#10b981','#8b5cf6','#f59e0b','#06b6d4','#14b8a6','#f43f5e','#ec4899'];
let state=null,currentAgent=null,selectedAgentId='narrator',isCustom=false,mediaRecorder=null,chunks=[],activeAudioCtx=null,activeAudioSource=null,recordingShortcut=null;

function deepMerge(base,value){if(Array.isArray(base))return Array.isArray(value)?value:clone(base);if(base&&typeof base==='object'){const out={...base};if(value&&typeof value==='object'&&!Array.isArray(value))for(const [k,v] of Object.entries(value))out[k]=k in base?deepMerge(base[k],v):v;return out}return value===undefined?base:value}
function parseApiKeys(value){
  const entries=Array.isArray(value)?value:typeof value==='string'?value.split(';'):[];
  return [...new Set(entries.filter(key=>typeof key==='string').map(key=>key.trim()).filter(Boolean))];
}
function getTtsApiKeys(settings){
  const keys=parseApiKeys(settings.apiKeys);
  return keys.length?keys:parseApiKeys(settings.apiKey);
}
function redactApiKeys(value,keys){
  let safe=String(value);
  for(const key of [...keys].sort((a,b)=>b.length-a.length)){
    safe=safe.split(key).join('[chave ocultada]');
    safe=safe.split(encodeURIComponent(key)).join('[chave ocultada]');
  }
  return safe;
}
function normalizeState(raw){const out=deepMerge(DEFAULTS,raw||{});out.api.apiKeys=parseApiKeys(out.api.apiKeys);if(!Array.isArray(out.agents.customAgents))out.agents.customAgents=[];if(!Array.isArray(out.history.recentItems))out.history.recentItems=[];if(!Array.isArray(out.logs.items))out.logs.items=[];if(!out.ui.shortcuts||typeof out.ui.shortcuts!=='object')out.ui.shortcuts=clone(DEFAULTS.ui.shortcuts);return out}
async function loadState(){state=normalizeState(await chrome.storage.local.get(null));return state}
async function saveNs(ns,partial){if(ns==='models'&&typeof state.models.ttsModelId==='string'&&state.models.ttsModelId&&!LiveConfig.eligibleModels('tts').includes(state.models.ttsModelId))state.models.legacyTtsModelId??=state.models.ttsModelId;if(ns==='models'&&typeof state.models.sttModelId==='string'&&state.models.sttModelId&&!LiveConfig.LIVE_STT_MODELS.includes(state.models.sttModelId))state.models.legacySttModelId??=state.models.sttModelId;state[ns]=deepMerge(state[ns],partial);await chrome.storage.local.set({[ns]:state[ns]})}
function notice(msg,kind='ok'){const n=$('#notice');n.textContent=msg;n.classList.remove('hidden');n.style.background=kind==='bad'?'#7f1d1d':'#0f766e';clearTimeout(notice.t);notice.t=setTimeout(()=>n.classList.add('hidden'),2800)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function modelName(id){return globalThis.LiveConfig?.LIVE_MODEL_CAPABILITIES?.[id]?.displayName||KNOWN_MODELS[id]?.displayName||id}
function allAgents(){return [...DEFAULT_AGENTS,...state.agents.customAgents]}
function getAgent(id){return allAgents().find(a=>a.metadata.id===id)||DEFAULT_AGENTS[0]}
function fmtDate(ts){try{return new Date(ts).toLocaleString('pt-BR')}catch{return String(ts)}}
function clamp(n,min,max,fallback){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}

const TTS_FIELDS={audioProfile:'ttsAudioProfile',scene:'ttsScene',delivery:'ttsDelivery',emotion:'ttsEmotion',accent:'ttsAccent',pace:'ttsPace',pauses:'ttsPauses',articulation:'ttsArticulation',pronunciation:'ttsPronunciation',prosody:'ttsProsody',intensity:'ttsIntensity',directorNotes:'ttsDirectorNotes',voiceId:'ttsVoiceId',languageCode:'ttsLanguage',mode:'ttsMode',outputFormat:'ttsOutputFormat',sampleRate:'ttsSampleRate'};
let editorMode=null,ttsEditingModelId=null,ttsPreviewAbort=null,activePreviewGain=null,executingTtsPrepared=null;
const preparedTtsRequests=new Map();
function selectedTtsModel(){return LiveConfig.migrateAgent(currentAgent,state.models).live.preferredModel;}
function legacyTtsProfileModel(){const id=currentAgent.modelPreferences?.ttsModelId,old=currentAgent.live?.legacyModelPreference;return Object.hasOwn(TtsConfig.TTS_MODEL_CAPABILITIES,id)?id:Object.hasOwn(TtsConfig.TTS_MODEL_CAPABILITIES,old)?old:Object.keys(TtsConfig.TTS_MODEL_CAPABILITIES)[0];}
function initVoiceControls(){
  for(const id of ['voice','speaker1Voice','speaker2Voice']){const select=$('#'+id);select.innerHTML='';for(const name of TtsConfig.VOICES)select.add(new Option(name,name));}
  for(const [key,id] of Object.entries(TTS_FIELDS)){const field=$('#'+id).closest('.field');if(field)field.dataset.ttsField=key;}
  const tabs=$('#ttsModelTabs');
  for(const id of LiveConfig.eligibleModels('tts')){const caps={name:LiveConfig.caps(id).displayName};
    const button=document.createElement('button');button.type='button';button.textContent=caps.name;button.dataset.ttsModel=id;button.onclick=()=>switchTtsModel(id);tabs.append(button);
  }
}
function populateTtsChoices(modelId){
  const caps=TtsConfig.getCapabilities(modelId);
  for(const [id,values] of [['ttsLanguage',caps.languageCodes],['ttsOutputFormat',caps.audioFormats],['ttsSampleRate',caps.sampleRates]]){
    const select=$('#'+id);select.innerHTML='';select.add(new Option(id==='ttsLanguage'?'Automático':'Padrão do modelo',''));
    for(const value of values)select.add(new Option(id==='ttsOutputFormat'?String(value).replace('AUDIO_','').replace('MULAW','MuLaw').replace('ALAW','ALaw'):String(value),String(value)));
  }
}
function bindTtsFields(modelId=legacyTtsProfileModel()){
  ttsEditingModelId=modelId;
  const config=TtsConfig.getModelConfig(currentAgent.ttsConfig,modelId);populateTtsChoices(modelId);
  for(const [key,id] of Object.entries(TTS_FIELDS))$('#'+id).value=key==='mode'?((config.mode==='multi'||config.mode==='dialogue')?'multi':config.mode||'single'):(config[key]??'');
  const voice=currentAgent.live?.voiceName||currentAgent.voice.preferredVoice||config.voiceName||'Puck';
  if(![...$('#voice').options].some(o=>o.value===voice))$('#voice').add(new Option(voice,voice));
  $('#voice').value=voice;$('#ttsInstruction').value=config.instruction??currentAgent.instructions.ttsSystemInstruction??'';
  for(let i=1;i<=2;i++){const narrator=config.speakers?.[i-1]||{};$('#speaker'+i+'Name').value=narrator.name||(i===1?'Ana':'Bruno');$('#speaker'+i+'Voice').value=narrator.voice||(i===1?'Kore':'Puck');$('#speaker'+i+'Style').value=narrator.style||'';}
  $('#ttsAdvancedJson').value=config.advancedJson??TtsConfig.getAdvancedTemplate(modelId);
  $('#ttsAdvancedEnabled').checked=config.advancedJsonEnabled===true;
  updateTtsVisibility();updateTtsDiagnostics();
}
function pullTtsFields(){
  const modelId=ttsEditingModelId||selectedTtsModel(),values={};
  for(const [key,id] of Object.entries(TTS_FIELDS))values[key]=$('#'+id).value.trim();
  values.voiceName=$('#voice').value;values.instruction=$('#ttsInstruction').value;
  values.speakers=[1,2].map(i=>({name:$('#speaker'+i+'Name').value.trim(),voice:$('#speaker'+i+'Voice').value,style:$('#speaker'+i+'Style').value.trim()}));
  values.advancedJson=$('#ttsAdvancedJson').value;
  values.advancedJsonEnabled=$('#ttsAdvancedEnabled').checked;
  currentAgent.ttsConfig=TtsConfig.saveModelConfig(currentAgent.ttsConfig,modelId,values);
  currentAgent.live.voiceName=values.voiceName;$('#liveVoice').value=values.voiceName;
  updateTtsVisibility();updateTtsDiagnostics();
}
function switchTtsModel(modelId){
  LiveConfig.assertRouteModel(modelId,'tts');
  pullAgentFromFields();currentAgent.live=LiveConfig.migrateAgent(currentAgent,state.models).live;
  currentAgent.live.preferredModel=modelId;$('#agentTtsModel').value=modelId;
  renderLiveEditor();
}
function updateTtsVisibility(){
  const caps=TtsConfig.getCapabilities(ttsEditingModelId||selectedTtsModel()),multi=$('#ttsMode').value==='multi';
  $$('[data-tts-cap]').forEach(el=>el.classList.toggle('hidden',!caps[el.dataset.ttsCap]));
  $$('[data-tts-field]').forEach(el=>el.classList.toggle('hidden',!caps.persistFields.includes(el.dataset.ttsField)));
  $('#narratorsSettings').classList.toggle('hidden',!multi);
  $('#voice').disabled=multi||(caps.customVoiceId&&Boolean($('#ttsVoiceId').value.trim()));$('#ttsVoiceId').disabled=multi;
  $$('[data-tts-model]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ttsModel===(ttsEditingModelId||selectedTtsModel()))));
  $('#ttsVoiceNote').textContent=caps.customVoiceId?'IDs personalizados substituem a voz de catálogo. Duas vozes usam somente o catálogo.':'Vozes de catálogo e detecção automática de idioma. Ajuste o sotaque na direção da narração.';
  $('#ttsOutputNote').textContent=caps.audioFormat?'Saída nativa da API. PCM e G.711 são preparados localmente para reprodução.':'Saída padrão do modelo: PCM 24.000 Hz, preparado localmente como WAV.';
}
function currentTtsRequest(){return {text:$('#ttsTestText').value.trim(),voiceName:currentAgent.voice.preferredVoice||'Puck',systemInstruction:currentAgent.instructions.ttsSystemInstruction||'',ttsConfig:clone(currentAgent.ttsConfig||{})};}
function prepareTtsRequest(request,modelId,trace){
  const key=JSON.stringify({modelId,request});
  if(!preparedTtsRequests.has(key)){
    const payload=TtsConfig.buildPayload(request,modelId,trace);
    preparedTtsRequests.set(key,{modelId,payload,body:JSON.stringify(payload)});
    if(preparedTtsRequests.size>8)preparedTtsRequests.delete(preparedTtsRequests.keys().next().value);
  }
  if(trace&&!trace.events.some(event=>event.stage==='BUILD_PAYLOAD_START'&&event.modelId===modelId)){trace.mark('BUILD_PAYLOAD_START',{modelId,cacheHit:true});trace.mark('BUILD_PAYLOAD_END',{modelId,cacheHit:true});}
  return preparedTtsRequests.get(key);
}
function showPreparedTts(prepared){
  $('#ttsPayloadModel').textContent=prepared.modelId+' · generateContent';
  $('#ttsPayload').textContent=JSON.stringify(prepared.payload,null,2);
}
function validateTtsJson(){
  const modelId=ttsEditingModelId||selectedTtsModel(),status=$('#ttsJsonStatus');
  try{const payload=TtsConfig.validateAdvancedJson($('#ttsAdvancedJson').value,modelId);status.dataset.valid='true';status.textContent='JSON válido · '+modelId;return payload;}
  catch(error){status.dataset.valid='false';status.textContent='JSON inválido · '+error.message;return null;}
}
function highlightTtsJson(){
  const field=$('#ttsAdvancedJson'),view=$('#ttsJsonHighlight'),text=field.value,fragment=document.createDocumentFragment();
  // Coloração apenas visual: tokens viram textContent, sem HTML nem execução de código.
  const tokens=/"(?:[^"\\]|\\[\s\S])*"(\s*:)?|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
  let start=0;
  for(const match of text.matchAll(tokens)){
    fragment.append(document.createTextNode(text.slice(start,match.index)));
    const span=document.createElement('span');span.textContent=match[0];
    span.className=match[0][0]==='"'?(match[1]?'json-key':'json-string'):/^(true|false|null)$/.test(match[0])?'json-literal':'json-number';
    fragment.append(span);start=match.index+match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(start)+'\n'));view.replaceChildren(fragment);
  view.scrollTop=field.scrollTop;view.scrollLeft=field.scrollLeft;
}
function setupTtsJson(){
  $('#ttsAdvancedJson').addEventListener('input',pullAgentFromFields);
  $('#ttsAdvancedEnabled').addEventListener('change',pullAgentFromFields);
  $('#ttsAdvancedJson').addEventListener('scroll',()=>{const field=$('#ttsAdvancedJson'),view=$('#ttsJsonHighlight');view.scrollTop=field.scrollTop;view.scrollLeft=field.scrollLeft;});
  $('#ttsJsonValidate').onclick=validateTtsJson;
  $('#ttsJsonExample').onclick=()=>{$('#ttsAdvancedJson').value=TtsConfig.getAdvancedTemplate(ttsEditingModelId||selectedTtsModel());pullAgentFromFields();};
  $('#ttsJsonReset').onclick=()=>{$('#ttsAdvancedJson').value=TtsConfig.getAdvancedTemplate(ttsEditingModelId||selectedTtsModel());$('#ttsAdvancedEnabled').checked=false;pullAgentFromFields();};
  $('#ttsJsonFormat').onclick=()=>{try{$('#ttsAdvancedJson').value=JSON.stringify(JSON.parse($('#ttsAdvancedJson').value),null,2);pullAgentFromFields();}catch{validateTtsJson();}};
  $('#ttsJsonApply').onclick=()=>{if(!validateTtsJson())return;$('#ttsAdvancedEnabled').checked=true;pullAgentFromFields();$('#ttsJsonStatus').textContent+=' · aplicado; salve o agente para persistir.';};
}
function updateTtsDiagnostics(){
  const profile=ttsEditingModelId||legacyTtsProfileModel(),config=TtsConfig.getModelConfig(currentAgent.ttsConfig,profile),modelId=selectedTtsModel(),caps=LiveConfig.caps(modelId);
  $('#ttsStylePreview').textContent=TtsConfig.buildStyle($('#ttsInstruction').value,config)||'Sem direção adicional.';
  highlightTtsJson();validateTtsJson();
  $('#ttsJsonModeNote').textContent='JSON convencional preservado como legado; não executado. Use o editor Live.';
  const box=$('#ttsCompatibility');box.replaceChildren();
  const items=[caps.displayName,'WebSocket Live','PCM Int16 LE · 24 kHz','Voz de catálogo','Transcrição de saída',...(caps.supportedThinkingLevels.length?['Thinking: '+caps.supportedThinkingLevels.join(', ')]:[]),...(caps.requiresInteractionIdle?['Finalização: interactionStatus IDLE']:[]),...(caps.shutdownDate?['Descontinuação: '+caps.shutdownDate]:[])];
  for(const label of items){const pill=document.createElement('span');pill.className='pill';pill.textContent=label;box.append(pill);}
  const events=$('#ttsEvents');events.replaceChildren();
  for(const event of TtsConfig.getCapabilities(profile).narrationEvents){const button=document.createElement('button');button.type='button';button.textContent=event.token;button.title='Inserir no texto de teste Live';button.onmousedown=e=>e.preventDefault();button.onclick=()=>{const field=$('#liveTestText');field.setRangeText(event.token,field.selectionStart,field.selectionEnd,'end');field.focus();updateLivePreview();};events.append(button);}
  updateLivePreview();
}
function renderAgentDashboard(){
  const agent=getAgent(state.agents.activeAgentId),live=LiveConfig.migrateAgent(agent,state.models).live,config=agent.ttsConfig||{};
  const info={tts:{model:live.preferredModel,instruction:agent.instructions.ttsSystemInstruction,detail:live.voiceName+' · WebSocket Live'},stt:{model:LiveConfig.migrateAgent(agent,state.models).live.stt.preferredModel,instruction:agent.instructions.sttFormattingInstruction,detail:'Ditado com as instruções da persona'},lens:{model:agent.modelPreferences.visionModelId||state.models.visionModelId,instruction:agent.instructions.lensInspectionInstruction,detail:'Interpretação da região selecionada'}};
  $$('[data-open-mode]').forEach(card=>{const item=info[card.dataset.openMode];card.querySelector('[data-card-agent]').textContent=agent.metadata.name;card.querySelector('[data-card-description]').textContent=agent.metadata.description||'Persona personalizada';card.querySelector('[data-card-model]').textContent=modelName(item.model);card.querySelector('[data-card-detail]').textContent=item.detail;card.querySelector('[data-card-instruction]').textContent=item.instruction||'Sem instrução adicional';});
}
function openAgentEditor(mode){
  editorMode=mode;$('#agentDashboard').classList.add('hidden');$('#agentEditor').classList.remove('hidden');
  $('#editorTitle').textContent='Personalizar '+({tts:'TTS',stt:'STT',lens:'Lens'}[mode]);
  $$('[data-editor-mode]').forEach(section=>section.classList.toggle('hidden',section.dataset.editorMode!==mode));
  $$('[data-switch-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.switchMode===mode)));
  $('#agentStatus').textContent='';
}
function setupAgentNavigation(){
  $$('[data-open-mode]').forEach(button=>button.onclick=()=>openAgentEditor(button.dataset.openMode));
  $$('[data-switch-mode]').forEach(button=>button.onclick=()=>openAgentEditor(button.dataset.switchMode));
  $('#agentTtsModel').onchange=()=>switchTtsModel($('#agentTtsModel').value);
  $('#ttsTestText').addEventListener('input',updateTtsDiagnostics);
  $('#ttsInstruction').addEventListener('input',pullAgentFromFields);
  $('#backToAgents').onclick=()=>{pullAgentFromFields();editorMode=null;$('#agentEditor').classList.add('hidden');$('#agentDashboard').classList.remove('hidden');renderAgentDashboard();};
  [...Object.values(TTS_FIELDS),...['speaker1Name','speaker1Voice','speaker1Style','speaker2Name','speaker2Voice','speaker2Style']].forEach(id=>$('#'+id).addEventListener('input',pullAgentFromFields));
  setupTtsJson();
}
function validateAgentDraft(){LiveConfig.buildLiveSessionConfig(LiveConfig.buildAgentLiveOptions(currentAgent,state.audio,state.models));}
function agentAction(action){return async()=>{try{pullAgentFromFields();validateAgentDraft();await action();$('#agentStatus').textContent='';renderAgentDashboard();}catch(error){$('#agentStatus').textContent='❌ '+(error.message||String(error));}}}

function initTabs(){$$('.tab').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===b.dataset.tab))})}
function fillSelect(el,ids,selected){el.innerHTML='';ids.forEach(id=>el.add(new Option(modelName(id),id)));if(selected&&!ids.includes(selected))el.add(new Option(selected+' (personalizado)',selected));el.value=selected||ids[0]}
function initModelSelects(){const tts=LiveConfig.eligibleModels('tts'),stt=[...LiveConfig.LIVE_STT_MODELS],vision=[...CHAINS.vision],general=[...CHAINS.general];fillSelect($('#globalTts'),LiveConfig.LIVE_TTS_MODELS,LiveConfig.LIVE_TTS_MODELS.includes(state.models.ttsModelId)?state.models.ttsModelId:LiveConfig.DEFAULTS.ttsModelId);fillSelect($('#globalStt'),LiveConfig.LIVE_STT_MODELS,LiveConfig.LIVE_STT_MODELS.includes(state.models.sttModelId)?state.models.sttModelId:LiveConfig.DEFAULTS.sttModelId);fillSelect($('#globalVision'),vision,state.models.visionModelId);fillSelect($('#globalGeneral'),general,state.models.generalModelId);fillSelect($('#agentTtsModel'),tts,LiveConfig.migrateAgent(currentAgent,state.models).live.preferredModel);fillSelect($('#agentSttModel'),stt,LiveConfig.migrateAgent(currentAgent,state.models).live.stt.preferredModel);fillSelect($('#agentVisionModel'),vision,currentAgent.modelPreferences.visionModelId||state.models.visionModelId);fillSelect($('#agentGeneralModel'),general,currentAgent.modelPreferences.generalModelId||state.models.generalModelId)}
function renderAgentSelect(){const sel=$('#agentSelect');sel.innerHTML='';const built=document.createElement('optgroup');built.label='Agentes de fábrica';DEFAULT_AGENTS.forEach(a=>built.append(new Option(a.metadata.name+' — '+a.voice.preferredVoice,a.metadata.id)));sel.append(built);if(state.agents.customAgents.length){const custom=document.createElement('optgroup');custom.label='Agentes personalizados';state.agents.customAgents.forEach(a=>custom.append(new Option('★ '+a.metadata.name+' — '+a.voice.preferredVoice,a.metadata.id)));sel.append(custom)}sel.value=selectedAgentId}
function bindCurrentAgentToFields(){$('#agentName').value=currentAgent.metadata.name||'';$('#agentCategory').value=currentAgent.metadata.category||'custom';$('#agentIcon').value=currentAgent.metadata.icon||'Bot';$('#agentColor').value=/^#[0-9a-f]{6}$/i.test(currentAgent.metadata.color||'')?currentAgent.metadata.color:'#3b82f6';$('#agentDescription').value=currentAgent.metadata.description||'';$('#ttsInstruction').value=currentAgent.instructions.ttsSystemInstruction||'';$('#sttInstruction').value=currentAgent.instructions.sttFormattingInstruction||'';$('#lensInstruction').value=currentAgent.instructions.lensInspectionInstruction||'';$('#voice').value=currentAgent.voice.preferredVoice||'Puck';$('#ambience').value=currentAgent.voice.ambience||'none';$('#rate').value=currentAgent.voice.rateMultiplier??1;$('#pitch').value=currentAgent.voice.pitchMultiplier??1;$('#volume').value=currentAgent.voice.volume??1;$('#bass').value=currentAgent.voice.bass??0;$('#mid').value=currentAgent.voice.mid??0;$('#treble').value=currentAgent.voice.treble??0;$('#ambienceIntensity').value=currentAgent.voice.ambienceIntensity??30;bindTtsFields();updateRangeLabels();initModelSelects();renderLiveEditor();renderColors();renderAgentDashboard();$('#agentAvatar').textContent=(currentAgent.metadata.name||'AG').slice(0,2).toUpperCase();$('#agentAvatar').style.background=currentAgent.metadata.color||'#3b82f6';$('#agentKind').textContent=isCustom?'Personalizado':'De fábrica';$('#saveAgent').classList.toggle('hidden',!isCustom);$('#deleteAgent').classList.toggle('hidden',!isCustom);$('#agentSaveHint').textContent=isCustom?'Este agente é personalizado e pode ser salvo.':'Agente de fábrica protegido.'}
function pullAgentFromFields(){currentAgent.live=LiveConfig.migrateAgent(currentAgent,state.models).live;currentAgent.metadata.name=$('#agentName').value.trim()||'Agente sem nome';currentAgent.metadata.category=$('#agentCategory').value;currentAgent.metadata.icon=$('#agentIcon').value.trim()||'Bot';currentAgent.metadata.color=$('#agentColor').value;currentAgent.metadata.description=$('#agentDescription').value.trim();currentAgent.instructions.ttsSystemInstruction=$('#ttsInstruction').value;currentAgent.instructions.sttFormattingInstruction=$('#sttInstruction').value;currentAgent.instructions.lensInspectionInstruction=$('#lensInstruction').value;currentAgent.voice.preferredVoice=$('#voice').value;currentAgent.voice.ambience=$('#ambience').value;currentAgent.voice.rateMultiplier=clamp($('#rate').value,.5,2,1);currentAgent.voice.pitchMultiplier=clamp($('#pitch').value,.5,2,1);currentAgent.voice.volume=clamp($('#volume').value,0,1,1);currentAgent.voice.bass=clamp($('#bass').value,-10,10,0);currentAgent.voice.mid=clamp($('#mid').value,-10,10,0);currentAgent.voice.treble=clamp($('#treble').value,-10,10,0);currentAgent.voice.ambienceIntensity=clamp($('#ambienceIntensity').value,0,100,30);currentAgent.live.preferredModel=$('#liveModel').value||$('#agentTtsModel').value||currentAgent.live.preferredModel;currentAgent.live.stt.preferredModel=$('#liveSttModel').value||$('#agentSttModel').value||currentAgent.live.stt.preferredModel;currentAgent.modelPreferences.visionModelId=$('#agentVisionModel').value;currentAgent.modelPreferences.generalModelId=$('#agentGeneralModel').value;pullTtsFields();$('#agentAvatar').textContent=currentAgent.metadata.name.slice(0,2).toUpperCase();$('#agentAvatar').style.background=currentAgent.metadata.color;updateRangeLabels();renderColors()}
function selectAgent(id){selectedAgentId=id;currentAgent=clone(getAgent(id));isCustom=!currentAgent.metadata.isBuiltIn;state.agents.activeAgentId=id;chrome.storage.local.set({agents:state.agents});renderAgentSelect();bindCurrentAgentToFields()}
function updateRangeLabels(){if(activeAudioSource){activeAudioSource.playbackRate.value=Number($('#rate').value)||1;if(activeAudioSource.detune)activeAudioSource.detune.value=1200*Math.log2(Number($('#pitch').value)||1);}if(activePreviewGain)activePreviewGain.gain.value=Number($('#volume').value);$('#rateValue').textContent=Number($('#rate').value||1).toFixed(2)+'x';$('#pitchValue').textContent=Number($('#pitch').value||1).toFixed(2)+'x';$('#volumeValue').textContent=Math.round(Number($('#volume').value||0)*100)+'%';$('#bassValue').textContent=(Number($('#bass').value)>0?'+':'')+$('#bass').value+' dB';$('#midValue').textContent=(Number($('#mid').value)>0?'+':'')+$('#mid').value+' dB';$('#trebleValue').textContent=(Number($('#treble').value)>0?'+':'')+$('#treble').value+' dB';$('#ambienceValue').textContent=$('#ambienceIntensity').value+'%'}
function renderColors(){const box=$('#colorPresets');box.innerHTML='';COLORS.forEach(c=>{const b=document.createElement('button');b.className='color-dot'+(currentAgent.metadata.color===c?' selected':'');b.style.background=c;b.title=c;b.onclick=()=>{$('#agentColor').value=c;pullAgentFromFields()};box.append(b)})}
function setupAgentBindings(){$('#agentSelect').onchange=e=>selectAgent(e.target.value);['agentName','agentCategory','agentIcon','agentColor','agentDescription','ttsInstruction','sttInstruction','lensInstruction','voice','ambience','rate','pitch','volume','bass','mid','treble','ambienceIntensity','agentSttModel','agentVisionModel','agentGeneralModel'].forEach(id=>$('#'+id).addEventListener(['rate','pitch','volume','bass','mid','treble','ambienceIntensity'].includes(id)?'input':'change',pullAgentFromFields));$('#createAgent').onclick=agentAction(async()=>{const n=clone(currentAgent);n.metadata={...n.metadata,id:'custom-'+Date.now(),name:n.metadata.isBuiltIn?n.metadata.name+' (Custom)':n.metadata.name,isBuiltIn:false,version:n.metadata.version||1};state.agents.customAgents=[...state.agents.customAgents,n];state.agents.activeAgentId=n.metadata.id;await chrome.storage.local.set({agents:state.agents});selectedAgentId=n.metadata.id;currentAgent=clone(n);isCustom=true;renderAgentSelect();bindCurrentAgentToFields();notice('Novo agente criado e ativado.');$('#storageBadge').textContent='Storage OK • '+state.agents.customAgents.length+' custom'});$('#saveAgent').onclick=agentAction(async()=>{if(!isCustom)return;state.agents.customAgents=state.agents.customAgents.map(a=>a.metadata.id===currentAgent.metadata.id?clone(currentAgent):a);await chrome.storage.local.set({agents:state.agents});renderAgentSelect();notice('Agente salvo com todas as instruções.')});$('#deleteAgent').onclick=async()=>{if(!isCustom||!confirm('Excluir este agente personalizado?'))return;state.agents.customAgents=state.agents.customAgents.filter(a=>a.metadata.id!==currentAgent.metadata.id);state.agents.activeAgentId='narrator';await chrome.storage.local.set({agents:state.agents});selectedAgentId='narrator';currentAgent=clone(getAgent('narrator'));isCustom=false;renderAgentSelect();bindCurrentAgentToFields();notice('Agente personalizado excluído.')}}

async function appendHistory(type,text,status='success',errorDetails){const item={id:'hist-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),timestamp:Date.now(),type,agentId:selectedAgentId,previewText:status==='error'?'❌ [ERRO] '+text:text,status,errorDetails};state.history.recentItems=[item,...state.history.recentItems].slice(0,state.history.maxEntries||50);await chrome.storage.local.set({history:state.history});renderHistory()}
function b64ToBytes(b64){const clean=b64.replace(/^data:[^,]+,/,'').replace(/\s/g,'');if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(clean);const bin=atob(clean);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
function pcmToWav(pcm,sampleRate=24000){const out=new Uint8Array(44+pcm.length),v=new DataView(out.buffer),w=(o,s)=>{for(let i=0;i<s.length;i++)out[o+i]=s.charCodeAt(i)};w(0,'RIFF');v.setUint32(4,36+pcm.length,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,pcm.length,true);out.set(pcm,44);return out}
async function readResponse(res,label){const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{throw new Error(label+' retornou resposta não-JSON ('+(res.headers.get('content-type')||'sem content-type')+'): '+text.slice(0,240))}if(!res.ok){const msg=data?.error?.message||data?.message||text.slice(0,400)||res.statusText;throw new Error('HTTP '+res.status+': '+msg)}return data}
function orderChain(preferred,chain){const arr=[...chain];if(preferred){if(arr.includes(preferred))return [preferred,...arr.filter(x=>x!==preferred)];return [preferred,...arr]}return arr}
async function synthesizeCurrent(){
  pullAgentFromFields();
  const text=$('#ttsTestText').value.trim(),keys=getTtsApiKeys(state.api);
  if(!keys.length)throw new Error('Configure sua chave Gemini primeiro.');
  if(keys.length>9)throw new Error('Informe no máximo 9 chaves para o fallback TTS.');
  if(!text)throw new Error('Digite um texto para testar.');
  return startLiveTtsPreview(text);
}
async function refreshTtsRanking(){
  try{
    const response=await chrome.runtime.sendMessage({type:'TTS_RANKING_GET',payload:{preferredModel:selectedTtsModel()}});
    if(!response?.success)throw new Error(response?.error||'Ranking indisponível.');
    const labels={'HEALTHY':'OK','UNKNOWN':'Sem histórico','TRANSIENT':'Transitório','QUOTA':'QUOTA','MODEL':'Modelo/permissão','AUTH':'Credencial'};
    $('#ttsRankingRows').innerHTML=(response.ranking||[]).map((pair,index)=>{const remaining=Math.max(0,pair.cooldownUntil-Date.now());return '<tr><td>'+(index+1)+'</td><td>'+esc(modelName(pair.model))+'</td><td>key#'+pair.keyIndex+'</td><td>'+esc(labels[pair.healthState]||pair.healthState)+(pair.lastHttpStatus&&pair.healthState!=='HEALTHY'?' ('+pair.lastHttpStatus+')':'')+'</td><td>'+(pair.latencyEma==null?'—':(pair.latencyEma/1000).toFixed(2)+' s')+'</td><td>'+(pair.lastUsedAt?esc(new Date(pair.lastUsedAt).toLocaleString()):'—')+'</td><td>'+(remaining?Math.ceil(remaining/1000)+' s':'—')+'</td></tr>';}).join('');
    $('#ttsRankingStatus').textContent=(response.ranking||[]).length+' pares; prioridade fixa entre modelos, aprendizado apenas entre chaves.';
  }catch(error){$('#ttsRankingStatus').textContent=error.message;}
}
function setupTtsRanking(){
  $('#ttsRankingRefresh').onclick=()=>refreshTtsRanking();
  $('#ttsRankingReset').onclick=async()=>{const response=await chrome.runtime.sendMessage({type:'TTS_RANKING_RESET'});if(!response?.success){$('#ttsRankingStatus').textContent=response?.error||'Falha ao resetar.';return;}await refreshTtsRanking();$('#ttsRankingStatus').textContent='Aprendizado TTS resetado. Chaves e configurações preservadas.';};
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes[TtsAdaptive.STORAGE_KEY]||changes.api))void refreshTtsRanking();});
  void refreshTtsRanking();
}
async function readTtsResponse(response,modelId,trace,controller){
  let limit;
  const terminal=response.status===400||response.status===422;
  try{
    const raw=terminal?await Promise.race([response.text(),new Promise((_,reject)=>{limit=setTimeout(()=>{const error=new Error('HTTP '+response.status+': payload inválido; body de erro não concluído em 250 ms.');error.httpStatus=response.status;controller.abort(error);reject(error);},250);})]):await response.text();
    trace.mark('HTTP_BODY_END');trace.mark('PARSE_START');
    let data;try{data=JSON.parse(raw.replace(/^\uFEFF/,''));}catch(error){if(response.ok)throw new Error('Resposta TTS não-JSON ('+response.status+').');}
    trace.mark('PARSE_END');
    if(!response.ok||data?.error){const error=new Error('HTTP '+response.status+': '+(data?.error?.message||raw.slice(0,400)));error.httpStatus=response.status;error.retryAfter=response.headers.get('retry-after')||data?.error?.details?.find(detail=>detail.retryDelay)?.retryDelay;error.ttsFatal=data?.error?.status==='INVALID_ARGUMENT';throw error;}
    return data;
  }finally{clearTimeout(limit);}
}
let lastTtsTrace=null;
function renderTtsTiming(trace){
  if(!trace?.enabled)return;
  lastTtsTrace=trace.snapshot();
  const rows=TtsConfig.traceRows(lastTtsTrace).map(row=>row.stage.padEnd(28)+(row.durationMs===null?'N/A':row.durationMs.toFixed(2)+' ms'));
  const attempts=lastTtsTrace.events.filter(event=>event.stage==='ATTEMPT_END').map(event=>'Tentativa '+event.attempt+' · '+event.modelId+' · chave '+event.keyIndex+' · '+event.durationMs.toFixed(2)+' ms · HTTP '+(event.httpStatus??'—')+' · '+(event.error||event.reason)+' · backoff '+event.delayMs+' ms · timeout '+event.timeoutMs+' ms');
  $('#ttsTimingReport').textContent=rows.concat([''],attempts).join('\n');
}
async function saveTtsTiming(trace){
  if(!trace?.enabled)return;renderTtsTiming(trace);
  try{await chrome.runtime.sendMessage({type:'TTS_DEBUG_STORE',payload:trace.snapshot()});}catch{}
}

function createImpulse(ctx,ambience,intensity){if(ambience==='none'||intensity<=0)return null;const secs={studio:.35,room:.75,warm:1.1,hall:1.8}[ambience]||.6,len=Math.floor(ctx.sampleRate*secs),buf=ctx.createBuffer(2,len,ctx.sampleRate);for(let c=0;c<2;c++){const d=buf.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,ambience==='hall'?2:3)}return buf}
async function playWithAgent(bytes,trace){if(activeAudioSource){try{activeAudioSource.stop()}catch{}}if(activeAudioCtx){try{await activeAudioCtx.close()}catch{}}const ctx=new AudioContext();activeAudioCtx=ctx;trace?.mark("AUDIO_LOAD_START");const resumed=ctx.resume();const arr=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),buffer=await ctx.decodeAudioData(arr),src=ctx.createBufferSource();await resumed;trace?.mark("AUDIO_LOAD_END");activeAudioSource=src;src.buffer=buffer;src.playbackRate.value=currentAgent.voice.rateMultiplier||1;if(src.detune)src.detune.value=1200*Math.log2(currentAgent.voice.pitchMultiplier||1);const bass=ctx.createBiquadFilter();bass.type='lowshelf';bass.frequency.value=250;bass.gain.value=currentAgent.voice.bass||0;const mid=ctx.createBiquadFilter();mid.type='peaking';mid.frequency.value=1200;mid.Q.value=.8;mid.gain.value=currentAgent.voice.mid||0;const treble=ctx.createBiquadFilter();treble.type='highshelf';treble.frequency.value=3500;treble.gain.value=currentAgent.voice.treble||0;const gain=ctx.createGain();activePreviewGain=gain;gain.gain.value=currentAgent.voice.volume??1;src.connect(bass);bass.connect(mid);mid.connect(treble);const intensity=(currentAgent.voice.ambienceIntensity??30)/100,impulse=createImpulse(ctx,currentAgent.voice.ambience||'none',intensity);if(impulse){const dry=ctx.createGain(),wet=ctx.createGain(),conv=ctx.createConvolver();dry.gain.value=1-Math.min(.75,intensity*.7);wet.gain.value=Math.min(.75,intensity*.75);conv.buffer=impulse;treble.connect(dry);treble.connect(conv);conv.connect(wet);dry.connect(gain);wet.connect(gain)}else treble.connect(gain);gain.connect(ctx.destination);src.onended=()=>{$('#ttsStatus').textContent='Concluído.'};trace?.mark('PLAY_CALLED',{reason:'AudioBufferSourceNode.start; esta rota não usa audio.play nem Blob'});const scheduledAt=ctx.currentTime;src.start();if(trace?.enabled){const audible=async()=>{if(activeAudioSource!==src||ctx.state==='closed')return;const stamp=ctx.getOutputTimestamp?.();if(ctx.state==='running'&&(stamp?stamp.contextTime>=scheduledAt&&stamp.contextTime>0:ctx.currentTime>scheduledAt)){trace.mark('AUDIO_STARTED',{reason:'relógio de saída WebAudio ativo; não é medição de som físico'});renderTtsTiming(trace);void saveTtsTiming(trace);return;}requestAnimationFrame(audible);};requestAnimationFrame(audible);}}
function setupTtsTest(){
  $('#testTts').onclick=async()=>{try{await synthesizeCurrent();$('#ttsStatus').textContent='Gerando via Gemini Live.';}catch(error){$('#ttsStatus').textContent='❌ '+error.message;}};
  $('#ttsDiagnosticTest').onclick=()=>$('#liveTest').click();
  $('#ttsDebugEnabled').checked=state.ttsDebugEnabled===true;
  if(state.logs?.ttsTraces?.[0])renderTtsTiming({enabled:true,snapshot:()=>state.logs.ttsTraces[0]});
  $('#ttsDebugEnabled').onchange=async()=>{state.ttsDebugEnabled=$('#ttsDebugEnabled').checked;await chrome.storage.local.set({ttsDebugEnabled:state.ttsDebugEnabled});};
  $('#stopTts').onclick=()=>$('#liveStop').click();
}

function setupSttTest(){$('#recordStt').onclick=toggleLiveSttTest;$('#copySttDiagnostics').onclick=copySttDiagnostics;$('#clearStt').onclick=()=>{$('#sttResult').textContent='O texto transcrito aparecerá aqui.';$('#sttStatus').textContent=''}}
async function copySttDiagnostics(){
 const button=$('#copySttDiagnostics'),status=$('#sttDiagnosticsStatus');if(button.disabled)return;button.disabled=true;status.textContent='Consultando diagnóstico STT…';
 try{
  const diagnostics=LiveSttDiagnostics.clean(await LiveSttDiagnostics.get());
  if(!diagnostics.jobs.length){status.textContent='Nenhum diagnóstico STT nesta sessão. Faça um ditado após recarregar a extensão.';return;}
  if(!navigator.clipboard?.writeText)throw Error('Clipboard indisponível');
  await navigator.clipboard.writeText(JSON.stringify(diagnostics,null,2));
  const job=diagnostics.jobs[0],capture=job.capture||{},transport=job.transport||{},result=job.result||{};
  const yesNo=value=>value===undefined?'não registrado':value?'sim':'não';
  status.textContent='Diagnóstico STT copiado. Último ditado: microfone aberto '+yesNo(capture.microphoneOpened)+'; sinal no PCM '+yesNo(capture.pcmSamples===undefined?undefined:capture.pcmSignalSamples>0)+'; PCM enviado '+yesNo(transport.sentBytes===undefined?undefined:transport.sentBytes>0)+'; Gemini pronto '+yesNo(transport.setupComplete)+'; transcrição '+yesNo(transport.inputEvents===undefined?undefined:transport.inputEvents>0)+'; captura liberada '+yesNo(capture.released)+'; resultado '+(result.outcome||transport.outcome||'não registrado')+'. Sinal de áudio não comprova fala.';
 }catch{status.textContent='Não foi possível copiar o diagnóstico STT. Mantenha as opções abertas e focadas e tente novamente. Se persistir, recarregue a extensão e reabra as opções.';}
 finally{button.disabled=false;}
}

function shortcutLabel(id){return {toggleHud:'Mostrar/ocultar HUD',readSelection:'Ler seleção (TTS)',startDictation:'Iniciar/parar ditado (STT)',togglePause:'Play/Pause',lensSelection:'Seleção Gemini Lens'}[id]||id}
function renderShortcuts(){const box=$('#shortcutList');box.innerHTML='';for(const [id,v] of Object.entries(state.ui.shortcuts)){const row=document.createElement('div');row.className='shortcut';row.innerHTML='<div><strong>'+esc(shortcutLabel(id))+'</strong><div class="muted">Clique em Gravar e pressione a combinação desejada.</div></div><div class="row"><input data-shortcut-input="'+esc(id)+'" value="'+esc(v||'')+'" style="flex:1"><button class="btn" data-record-shortcut="'+esc(id)+'">Gravar</button></div>';box.append(row)}box.querySelectorAll('[data-shortcut-input]').forEach(i=>i.onchange=async()=>{state.ui.shortcuts[i.dataset.shortcutInput]=i.value.trim();await chrome.storage.local.set({ui:state.ui});notice('Atalho salvo.')});box.querySelectorAll('[data-record-shortcut]').forEach(b=>b.onclick=()=>{recordingShortcut=b.dataset.recordShortcut;b.textContent='Pressione…'})}
function shortcutFromEvent(e){const key=e.key;if(['Control','Alt','Shift','Meta'].includes(key))return null;const parts=[];if(e.ctrlKey)parts.push('Ctrl');if(e.altKey)parts.push('Alt');if(e.shiftKey)parts.push('Shift');if(e.metaKey)parts.push('Meta');parts.push(key===' '?'Space':key.length===1?key.toUpperCase():key);return parts.join('+')}
window.addEventListener('keydown',async e=>{if(!recordingShortcut)return;if(e.key==='Escape'){recordingShortcut=null;renderShortcuts();return}const s=shortcutFromEvent(e);if(!s)return;e.preventDefault();e.stopPropagation();state.ui.shortcuts[recordingShortcut]=s;await chrome.storage.local.set({ui:state.ui});recordingShortcut=null;renderShortcuts();notice('Atalho atualizado: '+s)},true)
async function loadGlobalCommands(){const box=$('#globalCommands');box.innerHTML='';try{const cmds=await chrome.commands.getAll();cmds.forEach(c=>{const d=document.createElement('div');d.className='list-item';d.innerHTML='<strong>'+esc(c.description||c.name||'Comando')+'</strong><div class="muted">'+esc(c.shortcut||'Não definido')+'</div>';box.append(d)})}catch{box.innerHTML='<div class="muted">Não foi possível consultar chrome.commands.</div>'}}
function renderHistory(){const box=$('#historyList'),items=state.history.recentItems||[];box.innerHTML=items.length?'':'<div class="muted">Nenhuma atividade registrada.</div>';items.forEach(i=>{const d=document.createElement('div');d.className='list-item';d.innerHTML='<div class="log-meta"><span>'+esc(String(i.type||'').toUpperCase())+'</span><span>'+esc(fmtDate(i.timestamp))+'</span><span>'+esc(i.agentId||'')+'</span></div><div>'+esc(i.previewText||'')+'</div>'+(i.incomplete?'<div class="muted">Resultado incompleto</div>':'')+(i.errorDetails?'<div class="bad" style="margin-top:6px">'+esc(i.errorDetails)+'</div>':'');const text=i.text||i.previewText||'';if(text){const copy=document.createElement('button'),status=document.createElement('span');copy.className='btn ghost';copy.textContent='Copiar texto';copy.type='button';status.setAttribute('role','status');copy.onclick=async()=>{try{if(!navigator.clipboard?.writeText)throw Error('Clipboard indisponível');await navigator.clipboard.writeText(text);status.textContent=' Texto copiado.';}catch{status.textContent=' Não foi possível copiar. Selecione o texto manualmente.';}};d.append(copy,status);}if(i.jobId&&['stt','tts'].includes(i.type)){const reopen=document.createElement('button');reopen.className='btn ghost';reopen.textContent='Reabrir tarefa';reopen.onclick=async()=>{try{const result=await chrome.runtime.sendMessage({type:'HUD_GLOBAL_REOPEN',payload:{jobId:i.jobId}});if(!result?.success)throw Error(result?.error||'Resultado indisponível.');globalHudPanel?.update(result.state);await chrome.runtime.sendMessage({type:'HUD_GLOBAL_COMMAND',payload:{jobId:i.jobId,action:'maximize'}});}catch(error){notice(error.message||'Não foi possível reabrir.');}};d.append(reopen);}box.append(d)})}
function renderLogs(){const box=$('#logsList'),lvl=$('#logLevel').value,src=$('#logSource').value;let items=state.logs.items||[];if(lvl!=='all')items=items.filter(x=>x.level===lvl);if(src!=='all')items=items.filter(x=>x.source===src);box.innerHTML=items.length?'':'<div class="muted">Nenhum log com estes filtros.</div>';items.forEach(i=>{const d=document.createElement('div');d.className='list-item';d.innerHTML='<div class="log-meta"><span>'+esc(i.level||'')+'</span><span>'+esc(i.source||'')+'</span><span>'+esc(i.operation||'')+'</span><span>'+esc(fmtDate(i.timestamp))+'</span>'+(i.modelId?'<span class="code">'+esc(i.modelId)+'</span>':'')+(i.httpStatus?'<span>HTTP '+esc(i.httpStatus)+'</span>':'')+'</div><div>'+esc(i.message||'')+'</div>'+(i.errorDetails?'<details><summary class="muted">Detalhes</summary><pre style="white-space:pre-wrap">'+esc(i.errorDetails)+'</pre></details>':'');box.append(d)})}
async function saveApiSettings(){
  const apiKeys=parseApiKeys($('#apiKeys').value);
  if(apiKeys.length>9)throw new Error('Informe no máximo 9 chaves para o fallback TTS.');
  const apiKey=$('#apiKey').value.trim()||apiKeys[0]||'';
  await saveNs('api',{apiKey,apiKeys});
  $('#apiKey').value=apiKey;
  $('#apiKeys').value=apiKeys.length?apiKeys.join(';')+';':'';
}
function setupApi(){
  $('#apiKey').value=state.api.apiKey||'';
  const keys=parseApiKeys(state.api.apiKeys);
  $('#apiKeys').value=keys.length?keys.join(';')+';':'';
  $('#apiKeysFile').onchange=async()=>{
    const input=$('#apiKeysFile'),file=input.files?.[0];
    if(!file)return;
    try{
      const imported=parseApiKeys(await file.text());
      if(imported.length>9)throw new Error('Informe no máximo 9 chaves para o fallback TTS.');
      $('#apiKeys').value=imported.length?imported.join(';')+';':'';
      $('#apiStatus').textContent=imported.length+' chave(s) importada(s). Clique em Salvar chaves.';
    }catch(e){$('#apiStatus').textContent='❌ '+(e?.message||String(e))}
    finally{input.value=''}
  };
  $('#saveApi').onclick=async()=>{
    try{
      await saveApiSettings();
      const count=getTtsApiKeys(state.api).length;
      $('#apiStatus').textContent=count?count+' chave(s) para TTS, em ordem.':'Nenhuma chave configurada.';
      notice('Chaves salvas.');
    }catch(e){$('#apiStatus').textContent='❌ '+(e?.message||String(e))}
  };
  $('#testApi').onclick=async()=>{
    try{
      await saveApiSettings();
      $('#apiStatus').textContent='Testando chave principal…';
      const r=await chrome.runtime.sendMessage({type:'TEST_API_KEY',payload:{apiKey:state.api.apiKey}});
      $('#apiStatus').textContent=r?.success?'✅ Chave principal válida.':'❌ '+redactApiKeys(r?.error||'Chave recusada.',[...getTtsApiKeys(state.api),state.api.apiKey].filter(Boolean));
    }catch(e){$('#apiStatus').textContent='❌ '+redactApiKeys(e?.message||String(e),[...getTtsApiKeys(state.api),state.api.apiKey].filter(Boolean))}
  };
  $('#discoverModels').onclick=async()=>{$('#apiStatus').textContent='Consultando modelos…';try{const r=await chrome.runtime.sendMessage({type:'DISCOVER_MODELS'});if(r?.success){state.models.discoveredModels=Array.isArray(r.data)?r.data:[];$('#apiStatus').textContent='✅ '+state.models.discoveredModels.length+' modelos descobertos.'}else $('#apiStatus').textContent='❌ '+(r?.error||'Falha.')}catch(e){$('#apiStatus').textContent='❌ '+(e?.message||String(e))}};
  $('#saveGlobals').onclick=async()=>{await saveNs('models',{ttsModelId:$('#globalTts').value,sttModelId:$('#globalStt').value,visionModelId:$('#globalVision').value,generalModelId:$('#globalGeneral').value});notice('Modelos globais salvos.')};
  $('#openAiStudio').onclick=()=>chrome.tabs.create({url:'https://aistudio.google.com/app/apikey'});
}
function setupHistory(){renderHistory();renderLogs();$('#historyLimit').value=state.history.maxEntries||50;$('#historyRetention').value=state.history.retentionDays||365;$('#saveHistoryRetention').onclick=async()=>{const maxEntries=Math.max(1,Math.min(5000,Math.floor(Number($('#historyLimit').value)||50))),retentionDays=Math.max(1,Math.min(3650,Math.floor(Number($('#historyRetention').value)||365)));if((maxEntries<(state.history.maxEntries||50)||retentionDays<(state.history.retentionDays||365))&&!confirm('Reduzir os limites permite expirar resultados antigos nas próximas gravações. Deseja continuar?'))return;try{const latest=(await chrome.storage.local.get('history')).history||{};await chrome.storage.local.set({history:{...latest,maxEntries,retentionDays}});state.history={...latest,maxEntries,retentionDays};notice('Retenção salva. Resultados fora dos limites expiram ao gravar novos resultados.');}catch{notice('Não foi possível salvar a retenção.');}};$('#clearHistory').onclick=async()=>{if(!confirm('Limpar todo o histórico e os resultados concluídos do HUD, inclusive cópias de trabalho? Tarefas ativas e rascunhos não narrados serão preservados.'))return;try{const result=await chrome.runtime.sendMessage({type:'HUD_HISTORY_CLEAR'});if(!result?.success)throw Error(result?.error||'Limpeza não confirmada.');state.history=result.history;renderHistory();}catch{notice('Não foi possível limpar o histórico. Tente novamente.');}};$('#clearLogs').onclick=async()=>{if(confirm('Limpar todos os logs técnicos?')){state.logs.items=[];await chrome.storage.local.set({logs:state.logs});renderLogs()}};$('#logLevel').onchange=renderLogs;$('#logSource').onchange=renderLogs}
function setupShortcuts(){renderShortcuts();loadGlobalCommands();$('#resetShortcuts').onclick=async()=>{state.ui.shortcuts=clone(DEFAULTS.ui.shortcuts);await chrome.storage.local.set({ui:state.ui});renderShortcuts();notice('Atalhos restaurados.')};$('#openChromeShortcuts').onclick=()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'})}
function setupMisc(){$('#openChatGPT').onclick=()=>chrome.tabs.create({url:'https://chatgpt.com/'});chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.history){state.history=deepMerge(DEFAULTS.history,changes.history.newValue);renderHistory()}if(changes.logs){state.logs=deepMerge(DEFAULTS.logs,changes.logs.newValue);renderLogs()}if(changes.agents?.newValue){state.agents=deepMerge(DEFAULTS.agents,changes.agents.newValue);renderAgentSelect();renderAgentDashboard()}})}
let livePreview=null,liveMic=null,liveSttJobId=null,liveSttCommitted='',globalHudPanel=null;
const completedSttPreviews=new Map();
const pendingSttPreviews=new Map();
function rememberSttPreview(jobId){completedSttPreviews.set(jobId,{status:'completed',inserted:false,reason:'OPTIONS_PREVIEW',microphoneReleased:true});while(completedSttPreviews.size>32)completedSttPreviews.delete(completedSttPreviews.keys().next().value);void chrome.runtime.sendMessage({type:'HUD_INSERTION_RESULT',payload:{jobId,inserted:false,reason:'OPTIONS_PREVIEW'}}).catch(error=>console.error('[STT preview result]',error?.name||'Error'));}
async function saveDictationInsertion(value){const mode=value==='realtime'?'realtime':'final',current=(await chrome.storage.local.get('ui')).ui||{};await chrome.storage.local.set({ui:{...current,dictationInsertion:mode}});state.ui={...current,dictationInsertion:mode};return mode;}
async function startLiveTtsPreview(text){
 const options=LiveConfig.buildAgentLiveOptions(currentAgent,state.audio,state.models);
 LiveConfig.assertRouteModel(options.modelId,'tts');
 const setup=LiveConfig.buildLiveSessionConfig(options),turn=LiveConfig.buildLiveTurnMessage(text,options);
 $('#liveSetupPreview').textContent=JSON.stringify(setup,null,2);$('#liveTurnPreview').textContent=JSON.stringify(turn,null,2);
 $('#ttsPayloadModel').textContent=setup.setup.model+' · WebSocket Live';$('#ttsPayload').textContent=JSON.stringify({setup,turn},null,2);
 const playerId='options-live-'+crypto.randomUUID(),requestId=playerId+':1';livePreview={playerId,requestId};$('#liveTestStatus').textContent='Conectando…';
 const response=await chrome.runtime.sendMessage({type:'TTS_REQUEST',payload:{text,agentId:currentAgent.metadata.id,previewAgent:clone(currentAgent),playback:{playerId,requestId,volume:currentAgent.voice.volume??1,playbackRate:currentAgent.voice.rateMultiplier??1}}});
 if(!response?.success)throw new Error(response?.error||'Falha no Live.');return response;
}
function liveDraft(){currentAgent.live=LiveConfig.migrateAgent(currentAgent,state.models).live;return currentAgent.live;}
function renderLiveEditor(){
 const live=liveDraft(),model=LiveConfig.LIVE_TTS_MODELS.includes(live.preferredModel)?live.preferredModel:LiveConfig.DEFAULTS.ttsModelId;
 $('#liveModel').innerHTML='';for(const id of LiveConfig.LIVE_TTS_MODELS)$('#liveModel').add(new Option(LiveConfig.caps(id).displayName,id));$('#liveModel').value=model;
 $('#liveVoice').innerHTML='';for(const voice of LiveConfig.VOICES)$('#liveVoice').add(new Option(voice,voice));$('#liveVoice').value=live.voiceName||currentAgent.voice.preferredVoice||'Kore';
 $('#liveChunkSize').value=live.chunkSize||LiveConfig.DEFAULTS.chunkSize;$('#liveParallelism').value=live.parallelism||LiveConfig.DEFAULTS.maxParallelLiveSessions;
 $('#liveOutputTranscription').checked=live.outputTranscription===true;$('#liveJsonMode').value=live.jsonMode||'panel';
 $('#liveJson').value=typeof live.advancedJson==='string'?live.advancedJson:live.advancedJson?JSON.stringify(live.advancedJson,null,2):'';
 const thinking=$('#liveThinking');thinking.innerHTML='<option value="">Padrão</option>';for(const level of LiveConfig.caps(model).supportedThinkingLevels)thinking.add(new Option(level,level));thinking.value=live.thinkingLevel||'';
 $('#liveThinkingField').classList.toggle('hidden',!LiveConfig.caps(model).supportedThinkingLevels.length);
 $('#liveTranscriptionField').classList.toggle('hidden',!LiveConfig.caps(model).supportsOutputTranscription);
 const stt=live.stt||{};$('#liveSttModel').innerHTML='';for(const id of LiveConfig.LIVE_STT_MODELS)$('#liveSttModel').add(new Option(LiveConfig.caps(id).displayName,id));$('#liveSttModel').value=stt.preferredModel||LiveConfig.DEFAULTS.sttModelId;$('#liveSttVocabulary').value=(stt.customVocabulary||[]).join('\n');$('#liveSttSmart').checked=stt.smartTranscription!==false;$('#liveSttTransform').checked=stt.transform===true||(stt.transform!==false&&currentAgent.metadata.id!=='narrator'&&Boolean(currentAgent.instructions.sttFormattingInstruction?.trim()));
 updateLiveSttCapabilities();updateLivePreview();
}
function updateLiveSttCapabilities(){const supportsVocabulary=LiveConfig.caps($('#liveSttModel').value).supportsCustomVocabulary;$('#liveSttVocabulary').disabled=!supportsVocabulary;$('#liveSttSmart').disabled=true;$('#liveSttVocabulary').title='Configuração legada preservada; não enviada aos modelos Live gerais.';$('#liveSttSmart').title='Configuração legada preservada; não enviada aos modelos Live gerais.';}
function syncLiveFields(){
 const live=liveDraft(),model=$('#liveModel').value,c=LiveConfig.caps(model);
 live.preferredModel=model;$('#agentTtsModel').value=model;live.voiceName=$('#liveVoice').value;currentAgent.voice.preferredVoice=live.voiceName;$('#voice').value=live.voiceName;live.chunkSize=clamp($('#liveChunkSize').value,120,10000,900);live.parallelism=clamp($('#liveParallelism').value,1,9,3);
 live.outputTranscription=$('#liveOutputTranscription').checked&&c.supportsOutputTranscription;
 live.thinkingLevel=c.supportedThinkingLevels.includes($('#liveThinking').value)?$('#liveThinking').value:null;
 live.jsonMode=$('#liveJsonMode').value;live.advancedJson=$('#liveJson').value.trim()||null;
 $('#liveThinkingField').classList.toggle('hidden',!c.supportedThinkingLevels.length);
 $('#liveTranscriptionField').classList.toggle('hidden',!c.supportsOutputTranscription);
 if(!c.supportedThinkingLevels.length)$('#liveThinking').value='';
 updateLivePreview();
}
function buildLivePreview(){
 const options=LiveConfig.buildAgentLiveOptions(currentAgent,state.audio,state.models);
 const setup=LiveConfig.buildLiveSessionConfig(options),turn=LiveConfig.buildLiveTurnMessage($('#liveTestText').value,options);
 return{setup,turn};
}
function updateLivePreview(){try{const {setup,turn}=buildLivePreview();$('#liveSetupPreview').textContent=JSON.stringify(setup,null,2);$('#liveTurnPreview').textContent=JSON.stringify(turn,null,2);$('#liveJsonStatus').textContent='Setup Live válido. '+(currentAgent.live?.jsonMode==='complete'?'JSON Completo define voz e instruções; campos do painel não substituem esse JSON. ':'')+'O contrato de narração literal é aplicado também ao JSON.';$('#ttsPayloadModel').textContent=setup.setup.model+' · WebSocket Live';$('#ttsPayload').textContent=JSON.stringify({setup,turn},null,2);}catch(error){$('#liveJsonStatus').textContent='❌ '+error.message;$('#liveSetupPreview').textContent='Configuração inválida: '+error.message;$('#liveTurnPreview').textContent='';}}
function setupLiveOptions(){
 $('#dictationInsertion').value=state.ui.dictationInsertion==='realtime'?'realtime':'final';$('#dictationInsertion').onchange=async()=>{try{await saveDictationInsertion($('#dictationInsertion').value);$('#dictationInsertionStatus').textContent='Preferência salva para os próximos ditados.';}catch(error){$('#dictationInsertionStatus').textContent='Não foi possível salvar a preferência.';console.error('[STT preference]',error?.name||'Error');}};
 if(globalThis.GlobalHud)globalHudPanel=GlobalHud.mount($('#globalHudPanel'),{send:message=>chrome.runtime.sendMessage(message),panel:true,surface:'options'});
 const previousBind=bindCurrentAgentToFields;bindCurrentAgentToFields=()=>{previousBind();renderLiveEditor();};
 renderLiveEditor();
 for(const id of ['liveModel','liveVoice','liveChunkSize','liveParallelism','liveThinking','liveOutputTranscription','liveJsonMode','liveJson'])$('#'+id).addEventListener('input',syncLiveFields);
 $('#liveModel').addEventListener('change',()=>{const c=LiveConfig.caps($('#liveModel').value),select=$('#liveThinking');select.innerHTML='<option value="">Padrão</option>';for(const level of c.supportedThinkingLevels)select.add(new Option(level,level));syncLiveFields();});
 $('#liveTestText').addEventListener('input',updateLivePreview);
 $('#ttsInstruction').addEventListener('input',()=>queueMicrotask(updateLivePreview));
 for(const id of Object.values(TTS_FIELDS))$('#'+id)?.addEventListener('input',()=>queueMicrotask(updateLivePreview));
 $('#liveJsonExample').onclick=()=>{const live=liveDraft(),options=LiveConfig.buildAgentLiveOptions(currentAgent,state.audio,state.models);$('#liveJson').value=JSON.stringify(LiveConfig.buildLiveSessionConfig({...options,jsonMode:'panel',advancedJson:null}),null,2);$('#liveJsonMode').value='complete';syncLiveFields();};
 $('#liveJsonFormat').onclick=()=>{try{$('#liveJson').value=JSON.stringify(JSON.parse($('#liveJson').value),null,2);syncLiveFields();}catch(error){$('#liveJsonStatus').textContent='❌ '+error.message;}};
 $('#liveJsonValidate').onclick=updateLivePreview;
 $('#liveTest').onclick=async()=>{try{pullAgentFromFields();syncLiveFields();await startLiveTtsPreview($('#liveTestText').value);}catch(error){$('#liveTestStatus').textContent='❌ '+error.message;}};
 $('#liveStop').onclick=async()=>{if(livePreview){await chrome.runtime.sendMessage({type:'TTS_PLAYBACK_COMMAND',payload:{operation:'STOP',playerId:livePreview.playerId,requestId:livePreview.requestId}}).catch(()=>{});livePreview=null;}$('#liveTestStatus').textContent='Parado.';};
 for(const id of ['liveSttModel','liveSttVocabulary','liveSttSmart','liveSttTransform'])$('#'+id).addEventListener('input',()=>{const stt=liveDraft().stt;stt.preferredModel=$('#liveSttModel').value;$('#agentSttModel').value=stt.preferredModel;stt.customVocabulary=$('#liveSttVocabulary').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,1000);stt.smartTranscription=$('#liveSttSmart').checked;stt.transform=$('#liveSttTransform').checked;updateLiveSttCapabilities();});
 $('#recordStt').onclick=toggleLiveSttTest;
 window.addEventListener('pagehide',()=>{if(liveMic)void toggleLiveSttTest().catch(error=>console.error('[STT pagehide]',error?.name||'Error'));});
 chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{if(message.type!=='STT_GLOBAL_STOP'||liveMic?.jobId!==message.payload?.jobId)return false;void toggleLiveSttTest().then(()=>sendResponse({success:true}),()=>sendResponse({success:false}));return true;});
 chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{if(message.type!=='STT_GLOBAL_STATUS')return false;const jobId=message.payload?.jobId,remembered=completedSttPreviews.get(jobId),pending=pendingSttPreviews.get(jobId);if(!remembered&&!pending)return false;sendResponse({success:true,found:true,...(remembered||{status:pending.released?'waiting':'recording',microphoneReleased:pending.released===true})});return false;});
 $('#clearStt').onclick=()=>{$('#sttResult').textContent='O texto transcrito aparecerá aqui.';$('#sttStatus').textContent='';};
 chrome.runtime.onMessage.addListener(message=>{if(message.type==='HUD_GLOBAL_STATE'){globalHudPanel?.update(message.state||message.payload?.state);return false;}if(message.type!=='LIVE_OPTIONS_EVENT')return false;const p=message.payload;if(pendingSttPreviews.has(p.jobId)&&['stt-final','stt-error','stt-cancelled'].includes(p.event)){const owned=pendingSttPreviews.get(p.jobId);owned.audioQueue?.close();void releaseLiveSttTest(owned);if(p.event==='stt-final')rememberSttPreview(p.jobId);pendingSttPreviews.delete(p.jobId);}if(livePreview&&p.playerId===livePreview.playerId&&p.requestId===livePreview.requestId){if(p.event==='status')$('#liveTestStatus').textContent=p.status+' · '+(p.modelId||'')+' '+(p.keyLabel||'');if(p.event==='setup-complete'){$('#liveTestStatus').textContent='Sessão pronta · '+Math.round(p.setupCompleteMs)+' ms';if(p.actualSetup)$('#liveSetupPreview').textContent=JSON.stringify(p.actualSetup,null,2);}if(p.event==='first-pcm')$('#liveTestStatus').textContent='Primeiro PCM recebido';if(p.event==='first-playback')$('#liveTestStatus').textContent='Reproduzindo PCM';if(p.event==='ranking'&&p.result!=='SUCCESS')$('#liveTestStatus').textContent='Fallback: '+p.result+' · '+p.modelId+' key#'+p.keyIndex;if(p.event==='ended')$('#liveTestStatus').textContent='Concluído';if(p.event==='error')$('#liveTestStatus').textContent='❌ '+p.error;}if(p.jobId===liveSttJobId){if(p.event==='stt-connect-attempt')$('#sttStatus').textContent='Conectando · '+p.modelId+' '+p.keyLabel;if(p.event==='stt-connect-error')$('#sttStatus').textContent='Tentando próxima chave · '+p.keyLabel;if(p.event==='setup-complete')$('#sttStatus').textContent='Sessão STT pronta · '+Math.round(p.setupCompleteMs)+' ms';if(p.event==='stt-audio-sent')$('#sttStatus').textContent='PCM do microfone enviado · '+p.bytes+' bytes';if(p.event==='stt-partial')$('#sttResult').textContent=typeof p.confirmedText==='string'?[p.confirmedText,p.partialText].filter(Boolean).join(' '):[liveSttCommitted,p.text].filter(Boolean).join(' ');if(p.event==='stt-segment'){liveSttCommitted=typeof p.confirmedText==='string'?p.confirmedText:[liveSttCommitted,p.text].filter(Boolean).join(' ');$('#sttResult').textContent=liveSttCommitted;}if(p.event==='stt-status')$('#sttStatus').textContent=p.status;if(p.event==='stt-transform-attempt')$('#sttStatus').textContent='Transformando · '+p.modelId+' '+p.keyLabel;if(p.event==='stt-final'){liveMic?.audioQueue?.close();$('#sttResult').textContent=p.text;$('#sttStatus').textContent='Concluído via Live';void releaseLiveSttTest();liveSttJobId=null;}if(p.event==='stt-cancelled'){liveMic?.audioQueue?.close();void releaseLiveSttTest();liveSttJobId=null;$('#sttStatus').textContent='Parado · cancelado';}if(p.event==='stt-error'){liveMic?.audioQueue?.close();$('#sttStatus').textContent='❌ '+p.error;void releaseLiveSttTest();liveSttJobId=null;}}return false;});
}
function resampleLiveTest(input,sourceRate,state){const ratio=sourceRate/16000,values=[];for(let position=state.cursor;position<input.length;position+=ratio){const a=Math.floor(position),b=Math.min(input.length-1,a+1),fraction=position-a;values.push(a<0?state.previous*(1-(position+1))+input[0]*(position+1):input[a]*(1-fraction)+input[b]*fraction);state.cursor=position+ratio;}state.cursor-=input.length;state.previous=input[input.length-1]||0;const pcm=new Int16Array(values.length);values.forEach((sample,index)=>{const v=Math.max(-1,Math.min(1,sample));pcm[index]=v<0?v*32768:v*32767;});return new Uint8Array(pcm.buffer);}
async function releaseLiveSttTest(mic=liveMic){
 if(!mic)return;
 mic.closed=true;mic.chunker?.cancel();mic.stream?.getTracks().forEach(track=>track.stop());
 if(mic.releasing)return mic.releasing;
 mic.node?.disconnect();mic.source?.disconnect();mic.mute?.disconnect();
 if(mic.node)mic.node.port.onmessage=null;
 if(liveMic===mic){liveMic=null;$('#recordStt').textContent='Iniciar gravação';}
 mic.released=true;mic.releasing=Promise.resolve().then(()=>mic.context?.close()).catch(error=>console.error('[STT cleanup]',error)).then(()=>globalThis.LiveSttDiagnostics?.capture(mic,'capture-released',{flushAcknowledged:mic.flushAcknowledged===true}));return mic.releasing;
}
async function toggleLiveSttTest(){
 if(liveMic){
  const mic=liveMic;if(mic.stopping)return;
  if(mic.starting){pendingSttPreviews.delete(mic.jobId);liveSttJobId=null;await releaseLiveSttTest(mic);void chrome.runtime.sendMessage({type:'STT_LIVE_CANCEL',payload:{jobId:mic.jobId,playerId:mic.jobId}}).catch(()=>{});$('#sttStatus').textContent='Parado.';return;}
  mic.stopping=true;$('#sttStatus').textContent='Finalizando envio…';
  try{
  globalThis.LiveSttDiagnostics?.capture(mic,'capture-stopping');
  const flushed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{mic.metrics.flushTimeouts=(mic.metrics.flushTimeouts||0)+1;reject(Object.assign(Error('O AudioWorklet não confirmou o flush do PCM. Resultado pode estar incompleto.'),{code:'FLUSH_TIMEOUT'}));},1000);mic.flushed=()=>{clearTimeout(timer);resolve();};mic.node.port.postMessage({type:'flush'});});
  mic.stream.getTracks().forEach(track=>track.stop());await flushed;mic.chunker?.finish();await releaseLiveSttTest(mic);globalThis.LiveSttDiagnostics?.capture(mic,'queue-draining');await mic.audioQueue.drain();
  if(!pendingSttPreviews.has(mic.jobId))return;
  globalThis.LiveSttDiagnostics?.capture(mic,'capture-released',{flushAcknowledged:mic.flushAcknowledged===true});
  if(mic.metrics&&!mic.metrics.capturedBytes){pendingSttPreviews.delete(mic.jobId);if(liveSttJobId===mic.jobId){liveSttJobId=null;$('#sttStatus').textContent='Nenhum PCM capturado: verifique o microfone e AudioContext.';}void globalThis.LiveSttDiagnostics?.emit({jobId:mic.jobId,scope:'result',stage:'error',outcome:'NO_CAPTURE'});void chrome.runtime.sendMessage({type:'STT_LIVE_CANCEL',payload:{jobId:mic.jobId,playerId:mic.jobId}}).catch(error=>console.error('[STT cancel]',error?.name||'Error'));return;}
  if(liveSttJobId===mic.jobId)$('#sttStatus').textContent='Aguardando Gemini…';
  const response=await chrome.runtime.sendMessage({type:'STT_LIVE_STOP',payload:{jobId:mic.jobId,playerId:mic.jobId}});if(!response?.success)throw new Error(response?.error||'Falha ao finalizar STT.');}
  catch(error){if(error.code==='FLUSH_TIMEOUT')globalThis.LiveSttDiagnostics?.capture(mic,'flush-timeout',{outcome:'FLUSH_TIMEOUT'});pendingSttPreviews.delete(mic.jobId);if(liveSttJobId===mic.jobId){liveSttJobId=null;$('#sttStatus').textContent='❌ '+error.message;}await releaseLiveSttTest(mic);mic.audioQueue?.close();void chrome.runtime.sendMessage({type:'STT_LIVE_CANCEL',payload:{jobId:mic.jobId,playerId:mic.jobId}}).catch(failure=>console.error('[STT cancel]',failure?.name||'Error'));}
  return;
 }
 const jobId='options-stt-'+crypto.randomUUID(),mic={jobId,starting:true,pending:Promise.resolve()};liveMic=mic;liveSttJobId=jobId;liveSttCommitted='';pendingSttPreviews.set(jobId,mic);
 globalThis.LiveSttDiagnostics?.capture(mic,'starting');$('#sttStatus').textContent='Conectando ditado… Aguarde “Gravando” antes de falar.';
 const current=()=>liveMic===mic&&liveSttJobId===jobId&&!mic.closed;
 try{
  pullAgentFromFields();const stt=liveDraft().stt;stt.preferredModel=$('#liveSttModel').value;stt.customVocabulary=$('#liveSttVocabulary').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,1000);stt.smartTranscription=$('#liveSttSmart').checked;stt.transform=$('#liveSttTransform').checked;
  mic.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1}});if(!current()){mic.stream.getTracks().forEach(track=>track.stop());return;}
  globalThis.LiveSttDiagnostics?.capture(mic,'microphone-open');
  const realtime=state.ui?.dictationInsertion==='realtime';
  const started=await chrome.runtime.sendMessage({type:'STT_LIVE_START',payload:{jobId,playerId:jobId,agentId:currentAgent.metadata.id,previewAgent:clone(currentAgent),realtime}});
  if(!current()){void chrome.runtime.sendMessage({type:'STT_LIVE_CANCEL',payload:{jobId,playerId:jobId}}).catch(()=>{});return;}
  if(!started?.success)throw new Error(started?.error||'Falha no STT Live.');
  const context=new AudioContext({latencyHint:'interactive'});mic.context=context;await context.audioWorklet.addModule(chrome.runtime.getURL('mic-capture-worklet.js'));if(!current())return;
  const source=context.createMediaStreamSource(mic.stream),node=new AudioWorkletNode(context,'gemini-mic-capture',{channelCount:1,channelCountMode:'explicit',outputChannelCount:[1]}),mute=context.createGain(),resampler={cursor:0,previous:0};mic.source=source;mic.node=node;mic.mute=mute;mute.gain.value=0;source.connect(node).connect(mute).connect(context.destination);
  globalThis.LiveSttDiagnostics?.capture(mic,'worklet-ready');
  mic.audioQueue=new globalThis.DictationRuntime.AudioQueue({metrics:mic.metrics||(mic.metrics={}),send:payload=>chrome.runtime.sendMessage({type:'STT_LIVE_AUDIO',payload}),onFailure:async error=>{if(!pendingSttPreviews.has(jobId))return;globalThis.LiveSttDiagnostics?.capture(mic,error.code==='ACK_TIMEOUT'?'ack-timeout':'error',{outcome:error.code==='ACK_TIMEOUT'?'ACK_TIMEOUT':'CONNECTION'});void chrome.runtime.sendMessage({type:'HUD_CAPTURE_STATE',payload:{jobId,status:'error'}}).catch(failure=>console.error('[STT capture state]',failure?.name||'Error'));if(liveSttJobId===jobId)liveSttJobId=null;await releaseLiveSttTest(mic);pendingSttPreviews.delete(jobId);mic.audioQueue.close();try{await chrome.runtime.sendMessage({type:'STT_LIVE_CANCEL',payload:{jobId,playerId:jobId}});}catch(failure){console.error('[STT cancel]',failure?.name||'Error');}if(!liveMic)$('#sttStatus').textContent=error.code==='ACK_TIMEOUT'?'❌ O envio de PCM ficou sem confirmação por 10 segundos. Consulte o diagnóstico STT.':'❌ '+error.message;},onProgress:()=>{if(!mic.lastDiagnosticAt||Date.now()-mic.lastDiagnosticAt>=1000){mic.lastDiagnosticAt=Date.now();globalThis.LiveSttDiagnostics?.capture(mic,'capture-progress');}}});
  mic.chunker=realtime?new globalThis.SttRealtime.CapturePipeline({jobId,realtime:true,submitAudioChunk:packet=>{if(!current())return;let raw='';for(let i=0;i<packet.pcm.length;i+=0x8000)raw+=String.fromCharCode(...packet.pcm.subarray(i,i+0x8000));mic.audioQueue.push({jobId,playerId:jobId,sampleRate:16000,...(packet.endOnly?{endOnly:true}:{audioBase64:btoa(raw)}),chunk:packet.chunk},packet.pcm.byteLength);},onDiagnostic:packet=>globalThis.LiveSttDiagnostics?.capture(mic,packet.stage,packet)}):null;
  node.port.onmessage=event=>{
   if(event.data?.type==='flushed'){mic.flushAcknowledged=true;mic.flushed?.();return;}if(!current())return;
   const input=new Float32Array(event.data),bytes=resampleLiveTest(input,context.sampleRate,resampler);if(!bytes.length)return;if(globalThis.LiveSttDiagnostics?.observe)globalThis.LiveSttDiagnostics.observe(mic,input,bytes);else{const m=mic.metrics;m.capturedBytes=(m.capturedBytes||0)+bytes.byteLength;m.captureChunks=(m.captureChunks||0)+1;m.capturedFrames=(m.capturedFrames||0)+input.length;}let raw='';if(!mic.chunker)for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const audioBase64=mic.chunker?undefined:btoa(raw);
   if(mic.chunker)mic.chunker.push(bytes);else mic.audioQueue.push({jobId,playerId:jobId,audioBase64,sampleRate:16000},bytes.byteLength);mic.pending=mic.audioQueue.tail;
  };
  await context.resume();if(!current())return;if(context.state!=='running')throw Error('AudioContext do microfone não está running: '+context.state);globalThis.LiveSttDiagnostics?.capture(mic,'capture-running');mic.starting=false;$('#recordStt').textContent='⏹ Parar e transcrever';$('#sttStatus').textContent='Gravando via Live…';$('#sttResult').textContent='';
 }catch(error){pendingSttPreviews.delete(jobId);await releaseLiveSttTest(mic);if(liveSttJobId===jobId){liveSttJobId=null;void chrome.runtime.sendMessage({type:'STT_LIVE_CANCEL',payload:{jobId,playerId:jobId}}).catch(()=>{});$('#sttStatus').textContent='❌ '+(error.message||String(error));}}
}
async function main(){initTabs();initVoiceControls();await loadState();selectedAgentId=state.agents.activeAgentId||'narrator';currentAgent=clone(getAgent(selectedAgentId));isCustom=!currentAgent.metadata.isBuiltIn;renderAgentSelect();bindCurrentAgentToFields();setupAgentBindings();setupAgentNavigation();setupApi();setupTtsTest();setupTtsRanking();setupSttTest();setupShortcuts();setupHistory();setupMisc();setupLiveOptions();$('#storageBadge').textContent='Storage OK • '+state.agents.customAgents.length+' custom'}
main().catch(e=>{console.error(e);$('#storageBadge').textContent='Erro: '+(e?.message||String(e));$('#storageBadge').classList.add('bad')});
