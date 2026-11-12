(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SttVadLocal = api;
})(globalThis, function () {
    'use strict';

    // A fila pertence à captura. Um ACK local só pode classificar a cabeça da fila.
    class CaptureVad {
        constructor({ analyze, consume, onFallback, onFailure, deadlineMs = 75,
            maxPackets = 3, maxBytes = 9600, now = () => performance.now() }) {
            Object.assign(this, { analyze, consume, onFallback, onFailure, deadlineMs, maxPackets, maxBytes, now });
            this.mode = 'hybrid';
            this.ready = false;
            this.queue = [];
            this.bytes = 0;
            this.seq = 0;
            this.samples = 0;
            this.inFlight = null;
            this.metrics = { peakPackets: 0, peakBytes: 0, classified: 0, localMs: [] };
        }

        prepare(promise) {
            const at=this.now();
            this.preparation=Promise.resolve(promise).then(result => {
                if (this.mode !== 'hybrid') return;
                if (result?.ok !== true) {
                    this.metrics.responseValidation={
                        ok:false,
                        code:/^VAD_[A-Z_]{1,40}$/.test(result?.code||'')?result.code:null,
                    };
                    return this.fallback('prepare');
                }
                this.metrics.prepare = result.timing;
                this.metrics.prepareMs = this.now()-at;
                this.ready = true;
                return true;
            }, () => this.fallback('prepare'));
            return this.preparation;
        }

        push(pcm, final = false) {
            if (this.mode === 'closed') return;
            const captureStartMs=this.samples/16;
            this.samples+=pcm.byteLength/2;
            if (this.mode === 'rms') return this.apply(pcm);
            const packets = this.queue.reduce((n, item) => n + Number(Boolean(item.pcm)), 0);
            if (!this.ready || packets >= this.maxPackets || this.bytes + pcm.byteLength > this.maxBytes) {
                this.fallback(this.ready ? 'backpressure' : 'not-ready');
                if (this.mode === 'rms') this.apply(pcm);
                return;
            }
            this.queue.push({ pcm, final, at: this.now(), seq: ++this.seq, captureStartMs,captureEndMs:this.samples/16 });
            this.bytes += pcm.byteLength;
            this.metrics.peakPackets = Math.max(this.metrics.peakPackets, packets + 1);
            this.metrics.peakBytes = Math.max(this.metrics.peakBytes, this.bytes);
            this.pump();
        }

        barrier(action) {
            if (this.mode === 'closed') return Promise.reject(Error('Captura encerrada.'));
            return new Promise((resolve, reject) => {
                this.queue.push({ action, resolve, reject });
                this.pump();
            });
        }

        apply(pcm, decision) {
            try { this.consume(pcm, decision); }
            catch (error) { this.cancel(); this.onFailure(error); }
        }

        pump() {
            if (this.running || this.inFlight || this.mode === 'closed') return;
            this.running = true;
            try {
                while (this.queue.length && this.mode !== 'closed') {
                    const item = this.queue[0];
                    if (item.action) {
                        this.queue.shift();
                        try { item.resolve(item.action()); }
                        catch (error) { item.reject(error); }
                        continue;
                    }
                    if (this.mode === 'rms') {
                        this.queue.shift();
                        this.bytes -= item.pcm.byteLength;
                        this.apply(item.pcm);
                        continue;
                    }
                    const remaining = this.deadlineMs - (this.now() - item.at);
                    if (remaining <= 0) {
                        this.fallback('deadline');
                        continue;
                    }
                    this.inFlight = item;
                    this.timer = setTimeout(() => this.fallback('deadline'), remaining);
                    Promise.resolve().then(() => {
                        if (this.inFlight === item) {item.dispatchedAt=this.now();return this.analyze(item);}
                    }).then(result => this.accept(item, result), () => {
                        if (this.inFlight === item) {this.metrics.analysisFailure='communication';this.fallback('analysis');}
                    });
                    break;
                }
            } finally {
                this.running = false;
            }
        }

        accept(item, result) {
            if (this.inFlight !== item) {
                if(this.metrics.fallbackAt?.sequence===item.seq&&result?.timing){
                    this.metrics.lateResponse={localMs:this.now()-item.at,...result.timing};
                }
                return;
            }
            this.metrics.lastResponse={sequence:item.seq,...result?.timing,
                queueWaitMs:item.dispatchedAt-item.at,
                returnMs:Number.isFinite(result?.timing?.hostFinishedAt)?
                    performance.timeOrigin+performance.now()-result.timing.hostFinishedAt:undefined};
            const elapsed = this.now() - item.at;
            if (elapsed >= this.deadlineMs) return this.fallback('deadline');
            if (result?.ok !== true || result.seq !== item.seq ||
                typeof result.base !== 'boolean' || typeof result.weak !== 'boolean') {
                this.metrics.analysisFailure='invalid-response';
                this.metrics.responseValidation={
                    received:result!==null&&typeof result==='object',
                    ok:result?.ok===true,
                    sequence:Number.isSafeInteger(result?.seq)?result.seq:null,
                    baseType:typeof result?.base,weakType:typeof result?.weak,
                    code:/^VAD_[A-Z_]{1,40}$/.test(result?.code||'')?result.code:null,
                };
                return this.fallback('analysis');
            }
            clearTimeout(this.timer);
            this.inFlight = null;
            this.queue.shift();
            this.bytes -= item.pcm.byteLength;
            const times = this.metrics.localMs;
            if (!this.metrics.classified) this.metrics.first = { localMs: elapsed, ...result.timing, scores: result.scores };
            this.metrics.classified++;
            if (times.length === 300) times.shift();
            times.push(elapsed);
            this.apply(item.pcm, result);
            this.pump();
        }

        fallback(reason) {
            if (this.mode !== 'hybrid') return;
            this.mode = 'rms';
            this.metrics.fallback = reason;
            this.metrics.fallbackAt = {
                sequence: this.inFlight?.seq ?? this.seq + 1,
                pendingBytes: this.bytes,
                elapsedMs: this.inFlight ? this.now() - this.inFlight.at : 0,
                wallAt:Date.now(),captureMs:this.inFlight?.captureStartMs??this.samples/16,
                captureEndMs:this.inFlight?.captureEndMs??this.samples/16,
                deadlineMs:this.deadlineMs,
                stage:this.metrics.analysisFailure==='invalid-response'?'response-validation':
                    this.inFlight?'awaiting-analysis':'queue',
                lastResponse:this.metrics.lastResponse||null,
                analysisFailure:this.metrics.analysisFailure||null,
                responseValidation:this.metrics.responseValidation||null,
            };
            this.inFlight = null;
            clearTimeout(this.timer);
            this.onFallback(reason);
            this.pump();
        }

        cancel() {
            this.mode = 'closed';
            this.inFlight = null;
            clearTimeout(this.timer);
            for (const item of this.queue.splice(0)) item.reject?.(Error('Captura encerrada.'));
            this.bytes = 0;
        }
    }
    return { CaptureVad, SETTING: 'sttVadDetector' };
});
