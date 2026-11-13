'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const safeId=value=>{if(!/^[\w:-]{1,140}$/.test(String(value)))throw Error('Identidade de artefato inválida.');return String(value).replaceAll(':','_');};
function replaceOne(text,needle,replacement,file){
    if(text.split(needle).length!==2)throw Error('Ponto de observação mudou: '+file+'; nenhuma captura foi iniciada.');
    return text.replace(needle,replacement);
}
function instrument(file,source){
    const patch=(needle,replacement)=>{source=replaceOne(source,needle,replacement,file);};
    if(file==='content.js'){
        patch('exports.stt = new SttController();','globalThis.FalamermoForensics.controller = exports.stt = new SttController();');
        patch('if(!pcm.length)return;if(globalThis.LiveSttDiagnostics?.observe)',
            'if(!pcm.length)return;globalThis.FalamermoForensics.input(capture,pcm,ctx.sampleRate,input.length,final);if(globalThis.LiveSttDiagnostics?.observe)');
        patch('vad.prepare(opening).then(ready=>{','vad.forensicJobId=capture.jobId;vad.prepare(opening).then(ready=>{');
        patch('        } catch(error){if(/extension context invalidated/i.test(error?.message||String(error))){',
            "        } catch(error){globalThis.FalamermoForensics.emit('capture-start-error',{jobId,error:String(error?.message||error)});if(/extension context invalidated/i.test(error?.message||String(error))){");
        patch('    async handleLiveEvent(payload){\n        const job=',
            "    async handleLiveEvent(payload){\n        globalThis.FalamermoForensics.emit('editor-delivery',globalThis.FalamermoForensics.delivery(payload));\n        const job=");
        patch('editorTrace,confirmedText:payload.confirmedText,','editorTrace,forensic:{jobId:job.jobId,revision:payload.eventSeq},confirmedText:payload.confirmedText,');
        patch('        const first=result.inserted',"        globalThis.FalamermoForensics.emit('editor-result',{jobId:job.jobId,revision:payload.eventSeq,sequence:payload.sequence,text,final,result});\n        const first=result.inserted");
    }
    if(file==='dictation-runtime.js'){
        patch('apply(rawText,{final=false,isCurrent=()=>true,editorTrace}={})','apply(rawText,{final=false,isCurrent=()=>true,editorTrace,forensic}={})');
        patch('try{return await this.perform(rawText,final,isCurrent);}','try{return await this.perform(rawText,final,isCurrent,forensic); }');
    }
    if(file==='stt-realtime.js'){
        patch('  const voiced=decision??rmsVoiced;',"  const voiced=decision??rmsVoiced;globalThis.FalamermoForensics.emit('vad-applied',{jobId:this.jobId,startSample:this.samples,endSample:this.samples+bytes.length/2,voiced,rms,threshold,noise:this.noise,base:analysis?.base,weak:analysis?.weak,vadSequence:analysis?.seq,segmentBefore:this.chunk?.sequence,preRollSamples:this.idle.length/2,overlapSamples:(this.prefix?.length||0)/2});");
        patch('  if(context.length)this.enqueue(block,context);',"  globalThis.FalamermoForensics.emit('distributed-block',{jobId:this.jobId,segmentSequence:block.sequence,startSample:block.startMs*16,contextSamples:context.length/2,sourceOverlapMs:block.sourceOverlapMs,overlapMs:block.overlapMs});if(context.length)this.enqueue(block,context);");
    }
    if(file==='stt-vad-worker.js'){
        patch('        seq, base: matches.length>0, weak,',
            '        seq, base: matches.length>0, weak,\n        forensicFrames: sileroFrames, forensicTenFrames:tenFrames, forensicMatches:matches,');
    }
    if(file==='offscreen.js'){
        patch('    requiresIdle,timeoutMs:requiresIdle?90000:15000,','    forensicSessionId:session.id,requiresIdle,timeoutMs:requiresIdle?90000:15000,');
        patch('function notifyIdle(){',"function notifyIdle(){globalThis.FalamermoForensics.flush();");
    }
    if(file==='live-session-manager.js'){
        patch('   this.lastReceivedEvent={fields:Object.keys(msg)',
            "   if(this.options.mode==='dictation')globalThis.FalamermoForensics.emit('gemini-response',{...globalThis.FalamermoForensics.sessionMeta(this),afterAudioEnd,afterNewSpeech,closed:this.closed,handlerPresent:typeof this.handler==='function',activityCount:this.sttCounters?.activityStarts||0,content:globalThis.FalamermoForensics.content(msg.serverContent),voiceActivity:msg.voiceActivity?.type,error:msg.error?{code:msg.error.code,status:msg.error.status,message:msg.error.message}:undefined});\n   this.lastReceivedEvent={fields:Object.keys(msg)");
    }
    return source;
}
function wavHeader(bytes,rate=16000){
    if(bytes>0xffffffff-36||bytes%2)throw Error('WAV excedeu o limite PCM16/RIFF.');
    const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(bytes+36,4);h.write('WAVEfmt ',8);
    h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);
    h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(bytes,40);return h;
}
class WavWriter{
    constructor(file){this.file=file;this.bytes=0;this.digest=crypto.createHash('sha256');this.stream=fs.createWriteStream(file,{flags:'wx',mode:0o600});
        this.failed=null;this.stream.on('error',e=>{this.failed=e;});this.stream.write(wavHeader(0));}
    append(bytes){if(bytes.length%2)throw Error('PCM16 ímpar.');if(this.failed)throw this.failed;
        this.bytes+=bytes.length;this.digest.update(bytes);this.stream.write(bytes);
        if(this.stream.writableLength>32*1024*1024)throw Error('Disco lento: fila diagnóstica excedeu 32 MB.');}
    async finish(){if(this.finished)return this.result;this.finished=true;
        const ended=once(this.stream,'finish');this.stream.end();await ended;if(this.failed)throw this.failed;
        const fd=await fsp.open(this.file,'r+');try{await fd.write(wavHeader(this.bytes),0,44,0);await fd.sync();}finally{await fd.close();}
        this.result={file:this.file,bytes:this.bytes,samples:this.bytes/2,sampleRate:16000,sha256:this.digest.digest('hex')};return this.result;}
}
const content=object=>object&&Object.fromEntries(['inputTranscription','interimInputTranscription','outputTranscription','turnComplete','generationComplete','interactionStatus','interrupted','waitingForInput'].filter(k=>object[k]!==undefined).map(k=>[k,object[k]]));
class Evidence{
    constructor(directory,secrets=[]){this.directory=directory;this.secrets=secrets;this.wavs=new Map();this.inputs=[];this.packets=[];this.blocks=[];this.native=[];this.network=[];this.requests=new Map();this.responses=[];this.resolutions=[];this.issues=[];this.jobs=new Set();this.dropped=0;this.tapMaxMs=0;this.eventCount=0;
        this.events=fs.createWriteStream(path.join(directory,'events.jsonl'),{flags:'wx',mode:0o600});this.events.on('error',e=>{this.failed=e;});}
    redact(value){return JSON.stringify(value,(_key,v)=>typeof v==='string'?this.secrets.reduce((s,key)=>key?s.split(key).join('[credencial omitida]'):s,v):v);}
    log(event){if(this.failed)throw this.failed;this.events.write(this.redact({...event,eventNumber:++this.eventCount})+'\n');
        if(this.events.writableLength>32*1024*1024)throw Error('Disco lento: fila de eventos excedeu 32 MB.');}
    writer(relative){let w=this.wavs.get(relative);if(!w){w=new WavWriter(path.join(this.directory,relative));this.wavs.set(relative,w);}return w;}
    consume(batch){
        this.dropped=Math.max(this.dropped,batch.dropped||0);this.tapMaxMs=Math.max(this.tapMaxMs,batch.tapMaxMs||0);
        for(const source of batch.events){
            const e={...source};if(e.jobId)this.jobs.add(e.jobId);
            if(e.kind==='native-send'){
                const raw=e.wire,p=JSON.parse(raw);delete e.wire;
                const input=p.realtimeInput;
                e.frameSha256=hash(Buffer.from(raw));
                e.activityStart=!!input?.activityStart;e.activityEnd=!!input?.activityEnd;e.streamEnd=!!input?.audioStreamEnd;
                e.setup=!!p.setup;
                if(input?.audio){
                    e.pcm=input.audio.data;e.sampleRate=Number(input.audio.mimeType?.match(/rate=(\d+)/)?.[1]);
                    e.kind='wire-pcm';e.file='sessions/'+safeId(e.sessionId)+'.wav';
                    const bytes=Buffer.from(e.pcm,'base64'),w=this.writer(e.file);
                    e.sessionStartSample=w.bytes/2;e.sampleCount=bytes.length/2;e.packetSha256=hash(bytes);w.append(bytes);
                }
                this.native.push({...e,pcm:undefined});
            }
            if(e.kind==='input-pcm'){
                const bytes=Buffer.from(e.pcm,'base64');this.writer('input.wav').append(bytes);this.inputs.push({...e,pcm:undefined,sha256:hash(bytes)});
            }
            if(e.kind==='capture-segment-packet'){
                if(e.pcm){const bytes=Buffer.from(e.pcm,'base64');e.file='segments/'+safeId(e.segmentId)+'.wav';this.writer(e.file).append(bytes);e.sha256=hash(bytes);}
                this.packets.push({...e,pcm:undefined});
            }
            if(e.kind==='distributed-block')this.blocks.push(e);
            if(e.kind==='segment-resolution')this.resolutions.push(e);
            if(e.kind==='gemini-response'||e.kind==='transport-response'){
                e.content=content(e.content);this.responses.push(e);
            }
            delete e.pcm;this.log(e);
        }
    }
    networkEvent(method,params,keySlots){
        if(method==='Network.webSocketCreated'){
            const url=new URL(params.url);
            if(url.hostname!=='generativelanguage.googleapis.com')return;
            const slot=keySlots.indexOf(url.searchParams.get('key'))+1;
            this.requests.set(params.requestId,{requestId:params.requestId,keySlot:slot||undefined,host:url.hostname});
            this.log({kind:'network-created',requestId:params.requestId,keySlot:slot||undefined,host:url.hostname});
        }
        if(method==='Network.webSocketFrameSent'&&this.requests.has(params.requestId)){
            const raw=params.response.payloadData;
            let p;try{p=JSON.parse(raw);}catch{return;}
            const input=p.realtimeInput,request=this.requests.get(params.requestId);
            const e={kind:'network-frame',requestId:params.requestId,keySlot:request.keySlot,timestamp:params.timestamp,opcode:params.response.opcode,
                frameSha256:hash(Buffer.from(raw)),audio:!!input?.audio,activityStart:!!input?.activityStart,activityEnd:!!input?.activityEnd,streamEnd:!!input?.audioStreamEnd};
            if(input?.audio){const bytes=Buffer.from(input.audio.data,'base64');e.file='network/'+hash(Buffer.from(String(params.requestId))).slice(0,24)+'.wav';e.sampleCount=bytes.length/2;e.packetSha256=hash(bytes);this.writer(e.file).append(bytes);}
            this.network.push(e);this.log(e);
        }
    }
    async finish(run){
        const wavs=[];for(const [relative,w] of this.wavs)wavs.push({...await w.finish(),file:relative});
        const ended=once(this.events,'finish');this.events.end();await ended;
        const read=relative=>fs.readFileSync(path.join(this.directory,relative)).subarray(44);
        const input=this.wavs.has('input.wav')?read('input.wav'):Buffer.alloc(0);
        let cursor=0;
        for(const p of this.inputs){if(p.startSample!==cursor)this.issues.push('Descontinuidade no áudio de entrada: '+p.startSample+' != '+cursor);cursor+=p.sampleCount;}
        const segmentGroups=new Map();
        for(const p of this.packets){const list=segmentGroups.get(p.segmentId)||[];list.push(p);segmentGroups.set(p.segmentId,list);}
        const segments=[];
        for(const [id,packets] of segmentGroups){
            let segmentOffset=0;const audio=this.wavs.has('segments/'+safeId(id)+'.wav')?read('segments/'+safeId(id)+'.wav'):Buffer.alloc(0);
            const checks=packets.filter(p=>p.sampleCount>0).map(p=>{
                const stored=audio.subarray(segmentOffset,segmentOffset+p.sampleCount*2);segmentOffset+=p.sampleCount*2;
                const exact=p.startSample>=0&&stored.equals(input.subarray(p.startSample*2,p.endSample*2))&&hash(stored)===p.sha256;
                if(!exact)this.issues.push('Amostras do segmento divergem da entrada: '+id+' pacote '+p.packetSequence);
                return {packetSequence:p.packetSequence,startSample:p.startSample,endSample:p.endSample,exact};
            });
            const first=packets[0],last=packets.at(-1),block=this.blocks.find(b=>b.jobId===first.jobId&&b.segmentSequence===first.segmentSequence);
            segments.push({segmentId:id,sequence:first.segmentSequence,file:'segments/'+safeId(id)+'.wav',startSample:first.segmentStartSample,endSample:last.endSample,
                preRollMs:first.preRollMs,sourceOverlapMs:first.overlapMs,contextSamples:block?.contextSamples??null,cutReason:last.cutReason,closed:last.endOnly,packetChecks:checks});
        }
        const nativeGroups=new Map();
        for(const e of this.native){const list=nativeGroups.get(e.sessionId)||[];list.push(e);nativeGroups.set(e.sessionId,list);}
        const sessions=[];
        for(const [id,events] of nativeGroups){
            const frames=events.filter(e=>e.kind==='wire-pcm');if(!frames.length)continue;
            const first=frames[0],segment=segments.find(s=>s.segmentId===first.segmentId),actual=read(first.file);
            const known=segment&&segment.contextSamples!==null;
            const start=known?segment.startSample-segment.contextSamples:null;
            const expected=known?input.subarray(start*2,segment.endSample*2):Buffer.alloc(0);
            const exactPrefix=known&&start>=0&&actual.length<=expected.length&&actual.equals(expected.subarray(0,actual.length));
            if(!exactPrefix)this.issues.push('Áudio efetivamente enviado diverge do intervalo esperado: '+id);
            const signature=frames.map(f=>f.frameSha256).join(':');
            const candidates=[...this.requests.values()].filter(r=>r.keySlot===first.keySlot&&this.network.filter(n=>n.requestId===r.requestId&&n.audio).map(n=>n.frameSha256).join(':')===signature);
            const networkExact=candidates.length>0&&candidates.every(r=>read('network/'+hash(Buffer.from(String(r.requestId))).slice(0,24)+'.wav').equals(actual));
            if(!networkExact)this.issues.push('Sem confirmação independente dos frames Chromium: '+id);
            sessions.push({sessionId:id,segmentId:first.segmentId,keySlot:first.keySlot,modelId:first.modelId,file:first.file,bytes:actual.length,sha256:hash(actual),
                startSample:start,endSample:known?start+actual.length/2:null,expectedEndSample:segment?.endSample,exactInputPrefix:!!exactPrefix,completeSegment:known&&actual.length===expected.length,
                networkExact,networkRequestId:candidates.length===1?candidates[0].requestId:null,networkCandidates:candidates.map(r=>r.requestId),
                association:'session/segment; texto não é alinhado individualmente aos pacotes de áudio',
                responses:this.responses.filter(r=>r.sessionId===id),resolutions:this.resolutions.filter(r=>r.winnerSessionId===id)});
        }
        const signature=e=>[e.keySlot,e.frameSha256].join(':');
        const a=new Map(),b=new Map();
        for(const e of this.native.filter(e=>e.kind==='wire-pcm'))a.set(signature(e),(a.get(signature(e))||0)+1);
        for(const e of this.network.filter(e=>e.audio))b.set(signature(e),(b.get(signature(e))||0)+1);
        const wireMultiplicityExact=JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
        if(!wireMultiplicityExact)this.issues.push('Quantidade/hash dos frames de áudio nativos difere da captura Network.');
        const boundaries=segments.slice(1).map((s,i)=>{
            const previous=segments[i],actualOverlap=Math.max(0,previous.endSample-(s.startSample-(s.contextSamples||0)));
            return {previous:previous.segmentId,next:s.segmentId,sharedSourceSamples:actualOverlap,declaredContextSamples:s.contextSamples,
                declaredSourceOverlapSamples:s.sourceOverlapMs*16,unexpectedOverlap:actualOverlap>((s.contextSamples||0)+s.sourceOverlapMs*16)};
        });
        if(boundaries.some(b=>b.unexpectedOverlap))this.issues.push('Sobreposição de offsets além do contexto declarado.');
        if(this.dropped)this.issues.push('Observador descartou '+this.dropped+' eventos; prova incompleta.');
        const rawResponses=this.responses.filter(r=>r.kind==='gemini-response');
        const summary={schemaVersion:1,...run,source:'FalaMermo real; sem substituição de WebSocket, microfone, VAD ou Gemini',
            acousticFormat:'PCM16 LE mono 16000 Hz, pós-conversor e antes do VAD',inputSamples:input.length/2,inputDurationSeconds:input.length/32000,
            eventCount:this.eventCount,observer:{dropped:this.dropped,maxTapMs:this.tapMaxMs},wavs,segments,sessions,boundaries,
            verification:{status:this.issues.length?'INCOMPLETE':sessions.length&&rawResponses.length?'VERIFIED':'NO_GEMINI_EVIDENCE',
                wireMultiplicityExact,inputPacketContinuity:cursor===input.length/2,realAudioSessions:sessions.length,geminiMessages:rawResponses.length,
                note:'Confirma bytes entregues ao WebSocket nativo e frames emitidos pelo Chromium. Gemini não confirma recebimento de cada pacote nem alinhamento palavra/amostra.',issues:this.issues}};
        fs.writeFileSync(path.join(this.directory,'manifest.json'),this.redact(summary)+'\n',{mode:0o600,flag:'wx'});
        const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const audio=(file,label)=>'<p>'+esc(label)+'</p><audio controls preload="none" src="'+esc(file)+'"></audio>';
        const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src \'self\' file:; style-src \'unsafe-inline\'"><title>Prova acústica STT</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:16px}audio{width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:20px 0}</style><h1>Prova acústica STT</h1><p>Verificação: '+esc(summary.verification.status)+'. Textos associados à sessão/segmento; sem alinhamento por pacote.</p>'+audio('input.wav','Entrada integral, antes do VAD')+sessions.map(s=>'<details><summary>'+esc(s.segmentId+' · '+s.sessionId)+'</summary>'+audio(s.file,'Amostras efetivamente enviadas nesta sessão')+'<pre>'+esc(this.redact(s))+'</pre></details>').join('')+'<details><summary>Manifesto completo</summary><pre>'+esc(this.redact(summary))+'</pre></details>';
        fs.writeFileSync(path.join(this.directory,'index.html'),html,{mode:0o600,flag:'wx'});return summary;
    }
}
module.exports={Evidence,WavWriter,wavHeader,hash,safeId,instrument,replaceOne};
