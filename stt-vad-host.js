(() => {
    'use strict';
    let worker;
    let serial = 0;
    let idleTimer;
    const pending = new Map();
    const jobs = new Map();

    function dispose() {
        clearTimeout(idleTimer);
        worker?.terminate();
        worker = null;
        for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.resolve({ ok: false, code:'VAD_WORKER_DISPOSED' });
        }
        pending.clear();
        jobs.clear();
    }

    function idle() {
        clearTimeout(idleTimer);
        if (!jobs.size && !pending.size) idleTimer = setTimeout(dispose, 15000);
    }

    function request(message, transfer = []) {
        if (!worker) {
            worker = new Worker('stt-vad-worker.js');
            worker.onerror = dispose;
            worker.onmessageerror = dispose;
            worker.onmessage = ({ data }) => {
                const item = pending.get(data.request);
                if (!item) return;
                pending.delete(data.request);
                clearTimeout(item.timer);
                item.resolve(data);
            };
        }
        const id = ++serial;
        return new Promise(resolve => {
            pending.set(id, { resolve, timer: setTimeout(dispose, 4000) });
            try { worker.postMessage({ ...message, postedAt:performance.timeOrigin+performance.now(), request: id }, transfer); }
            catch { dispose(); }
        });
    }

    async function handle({ operation, id, seq, pcm, final, rollback, warm = true, clientSentAt, backgroundAt, origin, packets }) {
        const hostAt=performance.timeOrigin+performance.now();
        clearTimeout(idleTimer);
        if (operation === 'dispose') { dispose(); return {ok:true}; }
        if (operation === 'prepare') {
            const result = await request({ operation, warm });
            idle();
            return result;
        }
        if (operation === 'open') {
            if (jobs.size) dispose();
            const job={seq:0,origin};
            jobs.set(id,job);
            const result = await request({ operation, id, warm });
            if (!result.ok && jobs.get(id)===job) dispose();
            idle();
            return result;
        }
        if(operation==='preserve'){
            const recovery=globalThis.SttRealtime.recovery,jobId='vad-'+id+'-'+Date.now();
            await recovery.start(jobId,{realtime:true});
            try{let sequence=0;for(const packet of packets||[]){const pcm=Uint8Array.from(atob(packet.pcm),c=>c.charCodeAt(0));await recovery.append(jobId,{pcm,chunk:{packetSequence:++sequence,sequence:1,startMs:packet.captureStartMs,endMs:packet.captureEndMs,overlapMs:0}});}await recovery.update(jobId,{state:'incomplete'});return{ok:true};}
            catch(error){await recovery.update(jobId,{state:'interrupted'});throw error;}
        }
        if (operation === 'close') {
            if (!jobs.has(id)) return { ok: true };
            if (rollback) {
                dispose();
                return { ok: true };
            }
            jobs.delete(id);
            const result = await request({ operation, id });
            idle();
            return result;
        }
        if (!jobs.has(id)) return {ok:false,code:'VAD_CAPTURE_MISSING'};
        if (operation !== 'analyze') return {ok:false,code:'VAD_OPERATION'};
        if (jobs.get(id).seq + 1 !== seq) return {ok:false,code:'VAD_SEQUENCE'};
        if (typeof pcm !== 'string' || !pcm.length || pcm.length > 12800)
            return {ok:false,code:'VAD_PCM'};
        const bytes = Uint8Array.from(atob(pcm), value => value.charCodeAt(0));
        if (!bytes.length || bytes.byteLength % 2) return {ok:false,code:'VAD_PCM'};
        jobs.get(id).seq=seq;
        idle();
        const result=await request({ operation, id, seq, bytes: bytes.buffer, final }, [bytes.buffer]);
        return {...result,timing:{...result.timing,
            route:backgroundAt===undefined?'direct-offscreen':'background',
            toBackgroundMs:Number.isFinite(backgroundAt-clientSentAt)?backgroundAt-clientSentAt:undefined,
            toHostMs:hostAt-(backgroundAt??clientSentAt),
            hostMs:performance.timeOrigin+performance.now()-hostAt,
            hostFinishedAt:performance.timeOrigin+performance.now()}};
    }

    chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if(message?.type==='STT_LOCAL_VAD'&&message.target==='offscreen'){
            const payload=message.payload;
            const owner=jobs.get(payload?.jobId)?.origin;
            if(sender.id!==chrome.runtime.id||!sender.tab){
                reply({ok:false,code:'VAD_ORIGIN'});
                return false;
            }
            if(!owner){
                reply({ok:false,code:'VAD_CAPTURE_MISSING'});
                return false;
            }
            if(owner.tabId!==sender.tab.id||owner.documentId!==sender.documentId||
                owner.frameId!==sender.frameId||owner.generation!==payload.generation){
                reply({ok:false,code:'VAD_ORIGIN'});
                return false;
            }
            if(!['analyze','close','preserve'].includes(payload.operation)){
                reply({ok:false,code:'VAD_OPERATION'});
                return false;
            }
            handle({...payload,id:payload.jobId}).then(reply,()=>reply({ok:false,code:'VAD_HOST_ERROR'}));
            return true;
        }
        if (message?.type !== 'STT_VAD_OFFSCREEN' || sender.tab ||
            sender.id !== chrome.runtime.id) return false;
        // O service worker pode omitir sender.url. Contextos com URL precisam ser o background.
        if (sender.url && sender.url !== chrome.runtime.getURL('background.js')) return false;
        handle(message.payload).then(reply, () => { dispose(); reply({ ok: false, code:'VAD_HOST_ERROR' }); });
        return true;
    });

    // O offscreen também recebe o comando global. O listener original continua responsável pelo ACK.
    chrome.runtime.onMessage.addListener((message,sender) => {
        if (message?.type !== 'TTS_OFFSCREEN_COMMAND' || message.target !== 'offscreen' ||
            sender.id !== chrome.runtime.id || sender.tab) return false;
        const payload=message.payload;
        if (payload?.operation === 'STOP_ALL_OPERATIONS') dispose();
        else if (['STT_LIVE_CANCEL','STT_LIVE_STOP','STT_ORIGIN_LOST'].includes(payload?.operation) &&
            jobs.has(payload.jobId)) {
            void handle({operation:'close',id:payload.jobId}).catch(dispose);
        }
        return false;
    });
})();
