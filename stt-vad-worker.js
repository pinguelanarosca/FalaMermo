'use strict';
importScripts('vad-assets/ort.wasm.min.js', 'vad-assets/hybrid.js', 'vad-assets/rescue.js');

const { SileroCapture } = self.HybridLab;
const { BandPeriodicityRescue, PcmView } = self.RescueLab;
const captures = new Map();
let session;
let warmed = false;
let chain = Promise.resolve();

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('vad-assets/', self.location.href).href;

async function prepare(warm) {
    const start = performance.now();
    let loadMs = 0;
    let warmMs = 0;
    if (!session) {
        session = await ort.InferenceSession.create(new URL('vad-assets/model.onnx', self.location.href).href,
            { executionProviders: ['wasm'] });
        loadMs = performance.now() - start;
    }
    if (warm && !warmed) {
        const at = performance.now();
        const disposable = new SileroCapture(ort, session);
        const pcm = PcmView.alloc(3200);
        const frames = await disposable.push(pcm, true);
        new BandPeriodicityRescue().push(pcm, frames);
        warmMs = performance.now() - at;
        warmed = true;
    }
    return { loadMs, warmMs, workerMs: performance.now() - start };
}

async function handle({ operation, id, seq, bytes, final, warm, postedAt }) {
    if (operation === 'prepare') return { timing: await prepare(warm) };
    if (operation === 'open') {
        const timing = await prepare(warm);
        if (captures.has(id)) throw Error('Captura VAD já aberta.');
        // Estado recorrente e filtros só são instanciados quando chegar PCM real.
        captures.set(id, { seq: 0 });
        return { timing };
    }
    const capture = captures.get(id);
    if (operation === 'close') {
        if (capture?.silero && !capture.silero.finished) capture.silero.close();
        captures.delete(id);
        return {};
    }
    if (!capture || operation !== 'analyze' || seq !== capture.seq + 1) throw Error('Sequência VAD inválida.');
    const at = performance.now();
    const pcm = new PcmView(bytes);
    capture.onnxMs = 0;
    capture.silero ??= new SileroCapture(ort, {
        async run(feeds) {
            const started = performance.now();
            try { return await session.run(feeds); }
            finally { capture.onnxMs += performance.now() - started; }
        },
    });
    capture.rescue ??= new BandPeriodicityRescue();
    const stateMs = performance.now() - at;
    capture.seq = seq;
    const frames = await capture.silero.push(pcm, final);
    const inferred = performance.now();
    const weak = capture.rescue.push(pcm, frames).some(frame => frame.rescue);
    const finished = performance.now();
    return {
        seq, base: frames.some(frame => frame.hybrid), weak,
        timing: {
            workerMs: finished - at, sileroMs: inferred - at, stateMs,
            onnxMs: capture.onnxMs,
            acousticMs: Math.max(0, inferred - at - stateMs - capture.onnxMs),
            rescueMs: finished - inferred,
            workerQueueMs: Math.max(0, performance.timeOrigin + at - postedAt),
            workerFinishedAt: performance.timeOrigin + finished,
        },
        scores: seq === 1 ? frames.map(frame => frame.probability) : undefined,
    };
}

self.onmessage = ({ data }) => {
    chain = chain.then(async () => {
        try { postMessage({ request: data.request, ok: true, ...await handle(data) }); }
        catch { postMessage({
            request: data.request, ok: false, code:'VAD_WORKER_ERROR',
            stage:['prepare','open','analyze','close'].includes(data.operation)?data.operation:'unknown',
            seq:Number.isSafeInteger(data.seq)?data.seq:undefined,
        }); }
    });
};
