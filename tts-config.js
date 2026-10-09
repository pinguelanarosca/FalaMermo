// Fonte única de capacidades, persistência e payload da narração TTS.
// Documentação específica: ai.google.dev/gemini-api/docs/generate-content/speech-generation
// Tags legadas: docs.cloud.google.com/text-to-speech/docs/gemini-tts
(function(root, factory) {
    const config = factory();
    if (typeof module === 'object' && module.exports) module.exports = config;
    else root.TtsConfig = config;
})(globalThis, function() {
    const VOICES = ['Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'];

    const STYLE_FIELDS = { audioProfile:'Perfil vocal', scene:'Contexto da narração', delivery:'Estilo de interpretação', emotion:'Emoção e tom', accent:'Sotaque', pace:'Ritmo', pauses:'Pausas', articulation:'Articulação', pronunciation:'Pronúncia', prosody:'Entonação', intensity:'Intensidade', directorNotes:'Direção adicional' };
    const LANGUAGE_CODES = ['pt-BR','en-US','en-GB','en-AU','en-IN','es-ES','es-US','fr-FR','fr-CA','de-DE','it-IT','ja-JP','ko-KR','cmn-CN','ar-XA','hi-IN','id-ID','tr-TR','vi-VN','bn-IN','gu-IN','kn-IN','ml-IN','mr-IN','ta-IN','te-IN','nl-NL','pl-PL','ru-RU','th-TH'];
    const FORBIDDEN = ['temperature','topP','topK','candidateCount','systemInstruction','thinkingConfig','seed','maxOutputTokens','bitRate'];
    const MODERN_EVENTS = ['short pause','long pause','breath','heavy breath','sigh','laugh','chuckle','cough','cry','gasp','groan','whispering','yawn'].map(name=>({name,token:`<${name}>`}));
    // Subconjunto documentado com alta confiabilidade; não extrapola o schema genérico.
    const LEGACY_EVENTS = [{name:'sigh',token:'[sigh]'},{name:'laugh',token:'[laughing]'},{name:'hesitation',token:'[uhm]'}];
    const BASE = { multiSpeaker:2, style:true, directionFields:Object.keys(STYLE_FIELDS), generationFields:[], forbiddenFields:FORBIDDEN, defaultSampleRate:24000, documentation:'https://ai.google.dev/gemini-api/docs/generate-content/speech-generation' };
    const MODERN = { ...BASE, modernVoice:true, languageCode:true, languageCodes:LANGUAGE_CODES, customVoiceId:true, voiceDesign:true, voiceReplication:true, audioFormat:true, audioFormats:['AUDIO_WAV','AUDIO_L16','AUDIO_MULAW','AUDIO_ALAW'], sampleRate:true, sampleRates:[24000,16000,8000], defaultFormat:'AUDIO_WAV', stylePlacement:'speech_metadata', narrationEvents:MODERN_EVENTS };
    const LEGACY = { ...BASE, documentation:'https://docs.cloud.google.com/text-to-speech/docs/gemini-tts', modernVoice:false, languageCode:false, languageCodes:[], customVoiceId:false, voiceDesign:false, voiceReplication:false, audioFormat:false, audioFormats:[], sampleRate:false, sampleRates:[], defaultFormat:'AUDIO_L16', stylePlacement:'prompt', narrationEvents:LEGACY_EVENTS };
    const TEXT_PLACEHOLDER='{{TEXT}}';
    const traceRegistry=new Map();
    function performanceStamp(){const p=globalThis.performance;return p&&typeof p.now==='function'?{now:p.now(),timeOrigin:p.timeOrigin||0}:{now:Date.now(),timeOrigin:0};}
    function redactTtsSecrets(value,keys=[]){let text=String(value);for(const key of keys.filter(Boolean))text=text.split(key).join('[chave ocultada]').split(encodeURIComponent(key)).join('[chave ocultada]');return text.replace(/AIza[\w-]+/g,'[chave ocultada]');}
    function createTrace({enabled=false,id,origin,context='tts',secrets=[]}={}){
        const existing=id&&traceRegistry.get(id);
        if(enabled&&existing?.context===context)return existing;
        const first=performanceStamp();
        const trace={enabled:Boolean(enabled),id:id||'tts-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),origin:Number.isFinite(origin)?origin:first.timeOrigin+first.now,context,events:[]};
        let currentAttempt=null;
        const safe=value=>redactTtsSecrets(value,secrets);
        trace.mark=(stage,details={},stamp=performanceStamp())=>{
            if(!trace.enabled)return;
            const at=stamp.timeOrigin+stamp.now;
            const event={stage,context:trace.context,performanceNow:stamp.now,at,elapsedMs:at-trace.origin};
            if(stage==='ATTEMPT_START')currentAttempt={modelId:details.modelId,keyIndex:details.keyIndex,attempt:details.attempt};
            if(currentAttempt)Object.assign(event,currentAttempt);
            for(const key of ['modelId','keyIndex','attempt','httpStatus','durationMs','reason','error','delayMs','timeoutMs','bytes','cacheHit','startedAt','timeoutReason','textLength','resultClass'])if(details[key]!==undefined)event[key]=typeof details[key]==='string'?safe(details[key]):details[key];
            trace.events.push(event);
            if(stage==='ATTEMPT_END')currentAttempt=null;
            if(trace.events.length>300)trace.events.shift();
            globalThis.console?.debug?.('[TTS timing]',trace.id,event);
        };
        trace.packet=()=>({enabled:trace.enabled,id:trace.id,origin:trace.origin});
        trace.snapshot=()=>({id:trace.id,origin:trace.origin,context:trace.context,events:trace.events.map(event=>({...event}))});
        trace.merge=packet=>{if(trace.enabled&&packet?.id===trace.id&&Array.isArray(packet.events)){const seen=new Set(trace.events.map(event=>JSON.stringify(event)));for(const event of packet.events){const key=JSON.stringify(event);if(!seen.has(key)){trace.events.push(event);seen.add(key);}}trace.events.sort((a,b)=>a.at-b.at);}};
        if(trace.enabled){traceRegistry.set(trace.id,trace);if(traceRegistry.size>12)traceRegistry.delete(traceRegistry.keys().next().value);}
        return trace;
    }
    function getTrace(id){return traceRegistry.get(id);}
    function traceRows(trace){
        const events=trace.events||[],find=stage=>events.find(event=>event.stage===stage);
        const duration=(start,end)=>{const starts=events.filter(event=>event.stage===start);let total=0,count=0;for(const first of starts){const last=events.find(event=>event.stage===end&&event.at>=first.at&&(first.attempt===undefined||event.attempt===first.attempt));if(last){total+=Math.max(0,last.at-first.at);count++;}}return count?total:null;};
        const rows=[['UI → background','MESSAGE_SENT','BACKGROUND_RECEIVED'],['buildPayload','BUILD_PAYLOAD_START','BUILD_PAYLOAD_END'],['fetch até headers','FETCH_START','HTTP_HEADERS'],['download áudio','HTTP_HEADERS','HTTP_BODY_END'],['parse','PARSE_START','PARSE_END'],['extração/preparo áudio','AUDIO_EXTRACT_START','AUDIO_EXTRACT_END'],['Blob','BLOB_START','BLOB_END'],['decode/carregamento','AUDIO_LOAD_START','AUDIO_LOAD_END'],['player até início','PLAY_CALLED','AUDIO_STARTED']].map(([stage,start,end])=>({stage,durationMs:duration(start,end)}));
        const last=events.find(event=>event.stage==='AUDIO_STARTED')||events.at(-1);
        rows.push({stage:'TOTAL',durationMs:last?Math.max(0,last.at-trace.origin):null});return rows;
    }
    // Schema positivo do corpo TTS: propriedades não listadas são incompatíveis.
    const object=(properties,required=Object.keys(properties),extra={})=>({type:'object',properties,required,...extra});
    const array=(items,minItems=1,maxItems)=>({type:'array',items,minItems,...(maxItems?{maxItems}:{})});
    const string=(extra={})=>({type:'string',minLength:1,...extra});
    const prebuilt=()=>object({prebuiltVoiceConfig:object({voiceName:string({enum:VOICES})})});
    function advancedCapabilities(base) {
        const voiceConfig=base.modernVoice?object({voice:string({enum:VOICES,prefixes:['voice_','voicekey_']})}):prebuilt();
        const metadata=object({style:string(),speaker:string()},[],{minProperties:1});
        const part=object({text:string({textPlaceholder:true}),...(base.stylePlacement==='speech_metadata'?{speech_metadata:metadata}:{})},['text']);
        const speech=object({voiceConfig,multiSpeakerVoiceConfig:object({speakerVoiceConfigs:array(object({speaker:string({pattern:'^[^:\\r\\n]+$'}),voiceConfig:prebuilt()}),base.multiSpeaker,base.multiSpeaker)}),...(base.languageCode?{languageCode:string({enum:base.languageCodes})}:{})},[],{exactlyOne:['voiceConfig','multiSpeakerVoiceConfig']});
        const generation=object({responseModalities:array(string({enum:['AUDIO']}),1,1),speechConfig:speech,...(base.audioFormat?{responseFormat:object({audio:object({mimeType:string({enum:base.audioFormats}),sampleRate:{type:'number',enum:base.sampleRates}},[],{minProperties:1})})}:{})},['responseModalities','speechConfig']);
        const schema=object({contents:array(object({role:string({enum:['user']}),parts:array(part)},['parts']),1,1),generationConfig:generation});
        const template={contents:[{...(base.modernVoice?{role:'user'}:{}),parts:[{text:base.modernVoice?TEXT_PLACEHOLDER:'Read naturally and expressively: '+TEXT_PLACEHOLDER,...(base.modernVoice?{speech_metadata:{style:'natural, clear and expressive narration'}}:{})}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:base.modernVoice?{voice:'Kore'}:{prebuiltVoiceConfig:{voiceName:'Kore'}}},...(base.audioFormat?{responseFormat:{audio:{mimeType:base.defaultFormat,sampleRate:base.defaultSampleRate}}}:{})}};
        const allowedPaths=[],enumValues={};
        function paths(rule,path='') {
            if(path)allowedPaths.push(path);
            if(rule.enum)enumValues[path]=rule.enum;
            if(rule.properties)for(const [key,child] of Object.entries(rule.properties))paths(child,path?path+'.'+key:key);
            if(rule.items)paths(rule.items,path+'[]');
        }
        paths(schema);
        return {schemaKind:base.modernVoice?'modern':'legacy',schema,allowedPaths,enumValues,forbiddenFields:[...FORBIDDEN,'apiKey','apiKeys','endpoint','headers','retry','rateMultiplier','pitchMultiplier','volume'],template};
    }
    function capabilities(name, base) {
        return { name, ...base, advancedJson:advancedCapabilities(base), persistFields:[...base.directionFields,'voiceName','instruction','mode','speakers','advancedJson','advancedJsonEnabled',...(base.languageCode?['languageCode']:[]),...(base.customVoiceId?['voiceId']:[]),...(base.audioFormat?['outputFormat']:[]),...(base.sampleRate?['sampleRate']:[])] };
    }
    const TTS_MODEL_CAPABILITIES = {
        'gemini-3.8-flash-tts':capabilities('Gemini 3.8 Flash TTS',MODERN),
        'gemini-3.8-flash-lite-tts':capabilities('Gemini 3.8 Flash-Lite TTS',MODERN),
        'gemini-3.1-flash-tts-preview':capabilities('Gemini 3.1 Flash TTS',LEGACY),
        'gemini-2.5-flash-preview-tts':capabilities('Gemini 2.5 Flash TTS',LEGACY)
    };
    function freeze(value) { if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
    freeze(TTS_MODEL_CAPABILITIES);
    function getCapabilities(modelId) {
        const caps=TTS_MODEL_CAPABILITIES[modelId];
        if(!caps)throw new Error('Modelo TTS sem capacidades verificadas: '+modelId);
        return caps;
    }
    function getModelConfig(config={},modelId) {
        getCapabilities(modelId);
        config=config||{};
        if(Object.prototype.hasOwnProperty.call(config.modelSettings||{},modelId))return config.modelSettings[modelId];
        const {modelSettings,...legacy}=config;
        return legacy;
    }
    function getOutputSampleRate(config,modelId) {
        const caps=getCapabilities(modelId),profile=getModelConfig(config,modelId);
        const value=Number(profile.advancedJsonEnabled?validateAdvancedJson(profile.advancedJson,modelId).generationConfig.responseFormat?.audio.sampleRate:profile.sampleRate);
        return caps.sampleRate&&caps.sampleRates.includes(value)?value:caps.defaultSampleRate;
    }
    function getAdvancedTemplate(modelId) { return JSON.stringify(getCapabilities(modelId).advancedJson.template,null,2); }
    function validateAdvancedJson(json,modelId) {
        const caps=getCapabilities(modelId);
        const fail=(path,message)=>{throw new Error(`${path||'$'}: ${message} (${modelId}).`);};
        if(typeof json!=='string')fail('$','informe uma configuração JSON');
        let payload;
        try { payload=JSON.parse(json); } catch(error) { fail('$','JSON malformado: '+error.message); }
        function visit(value,rule,path='') {
            const type=Array.isArray(value)?'array':value===null?'null':typeof value;
            if(type!==rule.type)fail(path,'esperado '+rule.type);
            if(rule.type==='object') {
                for(const key of Object.keys(value))if(!Object.hasOwn(rule.properties,key))fail(path?path+'.'+key:key,'campo não suportado');
                for(const key of rule.required)if(!Object.hasOwn(value,key))fail(path?path+'.'+key:key,'campo obrigatório');
                if(rule.minProperties&&Object.keys(value).length<rule.minProperties)fail(path,'informe pelo menos um campo');
                if(rule.exactlyOne&&rule.exactlyOne.filter(key=>Object.hasOwn(value,key)).length!==1)fail(path,'use exatamente um de '+rule.exactlyOne.join(', '));
                for(const [key,child] of Object.entries(value))visit(child,rule.properties[key],path?path+'.'+key:key);
            } else if(rule.type==='array') {
                if(value.length<rule.minItems||rule.maxItems&&value.length>rule.maxItems)fail(path,'quantidade de itens incompatível');
                value.forEach((item,index)=>visit(item,rule.items,path+'['+index+']'));
            } else {
                if(rule.minLength&&!value.trim())fail(path,'valor vazio');
                if(rule.type==='string'&&value.includes(TEXT_PLACEHOLDER)&&!rule.textPlaceholder)fail(path,'{{TEXT}} é permitido somente em contents[].parts[].text');
                if(rule.enum&&!rule.enum.includes(value)&&!(rule.prefixes||[]).some(prefix=>value.startsWith(prefix)&&value.length>prefix.length&&!/\s/.test(value)))fail(path,'valor não suportado; use '+rule.enum.join(', ')+(rule.prefixes?' ou '+rule.prefixes.join('… / ')+'…':''));
                if(rule.pattern&&(!new RegExp(rule.pattern).test(value)||value!==value.trim()))fail(path,'nome de narrador inválido');
            }
        }
        visit(payload,caps.advancedJson.schema);
        const parts=payload.contents[0].parts;
        const placeholders=parts.reduce((count,part)=>count+part.text.split(TEXT_PLACEHOLDER).length-1,0);
        if(placeholders!==1)fail('contents[0].parts','use {{TEXT}} exatamente uma vez no campo text; o texto narrado é inserido somente durante a requisição');
        const narrators=payload.generationConfig.speechConfig.multiSpeakerVoiceConfig?.speakerVoiceConfigs;
        if(narrators) {
            const names=narrators.map(item=>item.speaker);
            if(new Set(names).size!==names.length)fail('generationConfig.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs','os nomes dos narradores devem ser diferentes');
            if(caps.stylePlacement==='speech_metadata')parts.forEach((part,index)=>{
                if(!names.includes(part.speech_metadata?.speaker))fail(`contents[0].parts[${index}].speech_metadata.speaker`,'identifique um dos narradores configurados');
            });
        } else parts.forEach((part,index)=>{
            if(part.speech_metadata?.speaker!==undefined)fail(`contents[0].parts[${index}].speech_metadata.speaker`,'configure múltiplas vozes para identificar um narrador');
        });
        return payload;
    }
    function saveModelConfig(config={},modelId,values={}) {
        config=config||{};
        const caps=getCapabilities(modelId), previous=config.modelSettings?.[modelId]||{};
        const next={...previous};
        for(const key of caps.persistFields) {
            if(values[key]==null || values[key]===''&&key!=='instruction')delete next[key];
            else next[key]=structuredClone(values[key]);
        }
        return {...config,modelSettings:{...config.modelSettings,[modelId]:next}};
    }
    function buildStyle(instruction, config={}) {
        return [config.instruction??instruction,...Object.entries(STYLE_FIELDS).map(([key,label])=>config[key]?.trim()?`${label}: ${config[key].trim()}`:'')].filter(Boolean).join('\n');
    }
    function narrationSegments(text,speakers) {
        const segments=[];
        for(const line of text.split(/\r?\n/)) {
            const speaker=speakers.find(item=>line.startsWith(item.name+':'));
            if(speaker)segments.push({speaker,text:line.slice(speaker.name.length+1).trimStart()});
            else if(segments.length)segments[segments.length-1].text+='\n'+line;
            else if(line.trim())throw new Error('Na narração com duas vozes, identifique cada trecho com Nome: texto.');
        }
        if(!segments.length||segments.some(s=>!s.text.trim()))throw new Error('Informe o texto de cada narrador.');
        return segments;
    }
    function adaptEvents(text,caps) {
        // Só transforma tokens conhecidos; preserva texto literal, código e marcação não vocal.
        const known=[...MODERN_EVENTS,...LEGACY_EVENTS];
        return text.replace(/<[^<>\r\n]+>|\[[^\[\]\r\n]+\]/g,token=>{
            const event=known.find(e=>e.token===token);
            if(!event)return token;
            const target=caps.narrationEvents.find(e=>e.name===event.name);
            if(!target)throw new Error(`O modelo ${caps.name} não tem suporte verificado para ${token}.`);
            return target.token;
        });
    }
    function buildPayload(request,modelId,trace) {
        trace?.mark('BUILD_PAYLOAD_START',{modelId});
        try{return assemblePayload(request,modelId);}finally{trace?.mark('BUILD_PAYLOAD_END',{modelId});}
    }
    function assemblePayload(request,modelId) {
        const caps=getCapabilities(modelId), config=getModelConfig(request.ttsConfig||{},modelId);
        if(typeof request.text!=='string'||!request.text.trim())throw new Error('Informe o texto da narração.');
        if(config.advancedJsonEnabled) {
            const payload=validateAdvancedJson(config.advancedJson,modelId);
            // Substituição em strings já parseadas evita injeção e mantém aspas, quebras e $ literalmente.
            for(const part of payload.contents[0].parts)part.text=part.text.split(TEXT_PLACEHOLDER).join(request.text);
            return payload;
        }
        const text=adaptEvents(request.text,caps), style=buildStyle(request.systemInstruction,config);
        const voice=config.voiceId?.trim()||config.voiceName||request.voiceName||'Puck';
        const speechConfig={}, prebuilt=name=>({prebuiltVoiceConfig:{voiceName:name}});
        let parts;
        // Compatibilidade com configurações salvas antes do editor de narradores.
        if(config.mode==='multi'||config.mode==='dialogue') {
            const speakers=config.speakers||[];
            if(speakers.length!==caps.multiSpeaker||speakers.some(s=>!s.name?.trim()||s.name!==s.name.trim()||/[:\r\n]/.test(s.name)||!VOICES.includes(s.voice))||speakers[0].name===speakers[1].name)
                throw new Error('Configure dois narradores com nomes diferentes e vozes de catálogo.');
            const segments=narrationSegments(text,speakers);
            speechConfig.multiSpeakerVoiceConfig={speakerVoiceConfigs:speakers.map(s=>({speaker:s.name,voiceConfig:prebuilt(s.voice)}))};
            parts=caps.stylePlacement==='speech_metadata'?segments.map(s=>({text:s.text,speech_metadata:{speaker:s.speaker.name,...([style,s.speaker.style].filter(Boolean).length?{style:[style,s.speaker.style].filter(Boolean).join('\n')}:{})}})):[{text:[style,...speakers.map(s=>s.style?`${s.name}: ${s.style}`:''),text].filter(Boolean).join('\n\n')}];
        } else {
            if(!caps.customVoiceId&&/^(voice_|voicekey_)/.test(voice))throw new Error('Este modelo não aceita IDs de voz personalizada; use Gemini 3.8 TTS.');
            speechConfig.voiceConfig=caps.modernVoice?{voice}:prebuilt(voice);
            parts=caps.stylePlacement==='speech_metadata'?[{text,...(style?{speech_metadata:{style}}:{})}]:[{text:style?`${style}\n\n${text}`:text}];
        }
        if(caps.languageCode&&config.languageCode?.trim()) {
            if(!caps.languageCodes.includes(config.languageCode.trim()))throw new Error('Código de idioma não suportado.');
            speechConfig.languageCode=config.languageCode.trim();
        }
        // Lista positiva: nenhum controle local nem campo de geração genérico pode escapar.
        const generationConfig={responseModalities:['AUDIO'],speechConfig};
        if(caps.audioFormat&&(config.outputFormat||config.sampleRate)) {
            const audio={};
            if(config.outputFormat) {
                if(!caps.audioFormats.includes(config.outputFormat))throw new Error('Formato de áudio não suportado por este modelo.');
                audio.mimeType=config.outputFormat;
            }
            if(config.sampleRate) {
                if(!caps.sampleRates.includes(Number(config.sampleRate)))throw new Error('Taxa de amostragem não suportada por este modelo.');
                audio.sampleRate=Number(config.sampleRate);
            }
            generationConfig.responseFormat={audio};
        }
        return {contents:[{role:'user',parts}],generationConfig};
    }
    // Converte somente PCM/G.711 em WAV; mantém WAV, MP3 e Opus intactos.
    function prepareAudio(bytes, mimeType = '', fallbackRate = 24000) {
        const mime = mimeType.split(';')[0].toLowerCase();
        const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1]) || fallbackRate;
        if (bytes[0]===82 && bytes[1]===73 && bytes[2]===70 && bytes[3]===70) return { bytes, mimeType: 'audio/wav', sampleRate: rate };
        if (/mp3|mpeg|ogg|opus/.test(mime)) return { bytes, mimeType: /ogg|opus/.test(mime) ? 'audio/ogg' : 'audio/mpeg', sampleRate: rate };
        if (/mulaw|alaw/.test(mime)||mime==='audio/basic') {
            const pcm = new Uint8Array(bytes.length * 2), view = new DataView(pcm.buffer);
            for (let i=0;i<bytes.length;i++) {
                let value;
                if (mime.includes('mulaw')||mime==='audio/basic') { const u=(~bytes[i])&255; let v=(((u&15)<<3)+132)<<((u&112)>>4); value=(u&128)?132-v:v-132; }
                else { const a=bytes[i]^85, seg=(a&112)>>4; let v=(a&15)<<4; v+=seg===0?8:264; if(seg>1)v<<=seg-1; value=(a&128)?v:-v; }
                view.setInt16(i*2,value,true);
            }
            bytes = pcm;
        }
        const out = new Uint8Array(44+bytes.length), view = new DataView(out.buffer);
        const write=(offset,text)=>{for(let i=0;i<text.length;i++)out[offset+i]=text.charCodeAt(i);};
        write(0,'RIFF');view.setUint32(4,36+bytes.length,true);write(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,bytes.length,true);out.set(bytes,44);
        return { bytes: out, mimeType: 'audio/wav', sampleRate: rate };
    }
    return { VOICES, STYLE_FIELDS, TTS_MODEL_CAPABILITIES, TEXT_PLACEHOLDER, performanceStamp, redactTtsSecrets, createTrace, getTrace, traceRows, getCapabilities, getModelConfig, getOutputSampleRate, getAdvancedTemplate, validateAdvancedJson, saveModelConfig, buildStyle, buildPayload, prepareAudio };
});
