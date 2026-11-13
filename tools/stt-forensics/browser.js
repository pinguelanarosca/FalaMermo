/* Observadores exclusivos da cópia diagnóstica. Nunca substituem áudio ou respostas. */
(() => {
    'use strict';
    const queue=[];
    let queuedBytes=0, serial=0, dropped=0, tapMaxMs=0;
    const clock=()=>({wallMs:Date.now(),monotonicMs:performance.timeOrigin+performance.now()});
    const sockets=new WeakMap();
    const sessionMeta=s=>({jobId:s.options.jobId,segmentSequence:s.options.blockId,
        segmentId:s.options.jobId+':'+s.options.blockId,sessionId:s.id,keySlot:s.options.keyIndex,
        modelId:s.options.modelId});
    const encode=bytes=>{
        let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
        return btoa(raw);
    };
    function emit(kind,data={},pcm){
        const at=performance.now();
        const size=pcm?.byteLength||0;
        if(queuedBytes+size>16*1024*1024||queue.length>=20000){dropped++;return;}
        queue.push({kind,...clock(),order:++serial,...data,...(pcm?{bytes:pcm.slice()}:{} )});
        queuedBytes+=size;
        tapMaxMs=Math.max(tapMaxMs,performance.now()-at);
    }
    function flush(){
        if(typeof globalThis.__falamermoForensicSink!=='function')return false;
        // Serialização fora dos callbacks de captura/WebSocket; lotes limitados.
        while(queue.length){
            const batch=queue.splice(0,64);
            for(const e of batch){if(e.bytes){queuedBytes-=e.bytes.length;e.pcm=encode(e.bytes);delete e.bytes;}}
            globalThis.__falamermoForensicSink(JSON.stringify({events:batch,dropped,tapMaxMs}));
        }
        return true;
    }
    const F=globalThis.FalamermoForensics={emit,flush,sockets,sessionMeta,
        content:object=>object&&Object.fromEntries(['inputTranscription','interimInputTranscription','outputTranscription','turnComplete','generationComplete','interactionStatus','interrupted','waitingForInput'].filter(k=>object[k]!==undefined).map(k=>[k,object[k]])),
        input(capture,pcm,sourceRate,sourceFrames,final){
            emit('input-pcm',{jobId:capture.jobId,startSample:(capture.metrics.capturedBytes||0)/2,
                sampleCount:pcm.length/2,sampleRate:16000,sourceRate,sourceFrames,final},pcm);
        },
        delivery(payload){
            return Object.fromEntries(['jobId','generation','event','eventSeq','sequence','resultSequence','editorDelivery',
                'confirmedText','partialText','text','incomplete','textBoundaries','publishedAt','dispatchedAt'].filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]));
        }
    };
    setInterval(flush,250);
    addEventListener?.('pagehide',flush);

    const Pipeline=globalThis.SttRealtime?.CapturePipeline;
    if(Pipeline){
        const original=Pipeline.prototype.emit;
        Pipeline.prototype.emit=function(pcm,endOnly=false,cutReason){
            const c=this.chunk;
            emit('capture-segment-packet',{jobId:this.jobId,segmentSequence:c.sequence,segmentId:c.chunkId,
                startSample:this.samples-pcm.length/2,endSample:this.samples,sampleCount:pcm.length/2,
                segmentStartSample:c.startMs*16,preRollMs:this.config.preRollMs,overlapMs:c.overlapMs,
                endOnly,cutReason,packetSequence:this.packetSequence+1},pcm.length?pcm:undefined);
            return original.apply(this,arguments);
        };
        const finish=Pipeline.prototype.finish;
        Pipeline.prototype.finish=function(){const r=finish.apply(this,arguments);emit('capture-finished',{
            jobId:this.jobId,totalSamples:this.samples,segments:this.sequence,skippedSilenceBytes:this.skippedSilenceBytes});flush();return r;};
    }
    const Vad=globalThis.SttVadLocal?.CaptureVad;
    if(Vad){
        const accept=Vad.prototype.accept;
        Vad.prototype.accept=function(item,result){
            const previous=this.metrics.classified;
            const r=accept.apply(this,arguments);
            emit('silero-result',{jobId:this.forensicJobId,sequence:item.seq,startSample:item.captureStartMs*16,
                endSample:item.captureEndMs*16,accepted:this.metrics.classified>previous,
                mode:this.mode,fallback:this.metrics.fallback,ok:result?.ok,base:result?.base,weak:result?.weak,
                frames:result?.forensicFrames,tenFrames:result?.forensicTenFrames,matches:result?.forensicMatches,evidence:result?.evidence,timing:result?.timing});
            return r;
        };
        const fallback=Vad.prototype.fallback;
        Vad.prototype.fallback=function(reason){const before=this.mode,r=fallback.apply(this,arguments);
            if(before!==this.mode)emit('vad-fallback',{jobId:this.forensicJobId,reason,details:this.metrics.fallbackAt});return r;};
    }
    const Distributed=globalThis.SttRealtime?.DistributedDictation;
    if(Distributed){
        const receive=Distributed.prototype.receive;
        Distributed.prototype.receive=function(block,lane,content,afterAudioEnd,afterNewSpeech){
            const discard=lane.done?'lane-done':!lane.session?'session-not-ready':!lane.sentNewSpeech?'no-new-speech':afterNewSpeech===false?'queued-before-new-speech':null;
            emit('transport-response',{jobId:this.jobId,segmentSequence:block.sequence,sessionId:lane.session?.forensicSessionId,
                copy:lane.copy,discarded:!!discard,discardReason:discard,blockSettled:!!block.settled,laneEnded:!!lane.ended,
                afterAudioEnd,afterNewSpeech,content:F.content(content)});
            return receive.apply(this,arguments);
        };
        const complete=Distributed.prototype.complete;
        Distributed.prototype.complete=function(block,winner){
            emit('segment-resolution',{jobId:this.jobId,segmentSequence:block.sequence,alreadySettled:!!block.settled,
                winnerSessionId:winner?.session?.forensicSessionId,winnerCopy:winner?.copy,text:winner?.text,
                inputFinished:winner?.inputFinished,turnEnded:winner?.turnEnded});return complete.apply(this,arguments);
        };
    }
    const Session=globalThis.LiveSessions?.LiveSession;
    if(Session){
        for(const name of ['sendProtocol','sendAudio','endAudio']){
            const original=Session.prototype[name];
            Session.prototype[name]=function(){
                if(this.options.mode==='dictation')sockets.set(this.socket,sessionMeta(this));
                return original.apply(this,arguments);
            };
        }
        const send=WebSocket.prototype.send;
        WebSocket.prototype.send=function(wire){
            const result=send.apply(this,arguments),meta=sockets.get(this);
            // A string foi aceita pelo WebSocket nativo. Parse somente no timer.
            if(meta)emit('native-send',{...meta,wire});
            return result;
        };
        const close=Session.prototype.close;
        Session.prototype.close=function(){if(this.options.mode==='dictation'){emit('session-close',{
            ...sessionMeta(this),alreadyClosed:this.closed,activityStarts:this.sttCounters?.activityStarts});flush();}
            return close.apply(this,arguments);};
    }
    const Insertion=globalThis.DictationRuntime?.Insertion;
    if(Insertion){
        const perform=Insertion.prototype.perform;
        Insertion.prototype.perform=async function(text,final,isCurrent,forensic){
            const before=this.editorSnapshot();
            const result=await perform.apply(this,arguments);
            emit('editor-write',{jobId:forensic?.jobId,revision:forensic?.revision,inputText:text,
                normalizedText:this.currentText,final,before,after:this.editorSnapshot(),
                fieldText:typeof this.target.element.value==='string'?this.target.element.value:this.target.element.innerText,
                result});return result;
        };
    }
    emit('observer-ready',{pipeline:!!Pipeline,vad:!!Vad,liveSession:!!Session,editor:!!Insertion});
})();
