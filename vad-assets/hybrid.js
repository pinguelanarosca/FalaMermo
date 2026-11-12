(() => { const module = {exports:{}};
'use strict';

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 512;
const CONTEXT_SAMPLES = 64;
const PREROLL_MS = 800;

class Biquad {
  constructor(type, frequency) {
    const w = 2 * Math.PI * frequency / SAMPLE_RATE;
    const cos = Math.cos(w);
    const a0 = 1 + Math.sin(w) / Math.SQRT2;
    const edge = type === 'highpass' ? 1 + cos : 1 - cos;
    this.b0 = edge / (2 * a0);
    this.b1 = (type === 'highpass' ? -edge : edge) / a0;
    this.a1 = -2 * cos / a0;
    this.a2 = (2 - a0) / a0;
    this.z1 = this.z2 = 0;
  }

  filter(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b0 * x - this.a2 * y;
    return y;
  }
}

// Fraction explained by a single sinusoid. Lag can be a multiple of the
// fundamental period, so also test its integer subdivisions in the pitch band.
function singleToneFraction(samples, lag) {
  let fraction = 0;
  const totalPower = samples.reduce((sum, x) => sum + x * x, 0);
  for (let multiple = 1; multiple * 10 <= lag; multiple++) {
    const angle = 2 * Math.PI * multiple / lag;
    let xc = 0, xs = 0, cc = 0, ss = 0, cs = 0;
    for (let i = 0; i < samples.length; i++) {
      const c = Math.cos(i * angle), s = Math.sin(i * angle);
      xc += samples[i] * c;
      xs += samples[i] * s;
      cc += c * c;
      ss += s * s;
      cs += c * s;
    }
    const determinant = cc * ss - cs * cs;
    const explained = (ss * xc * xc + cc * xs * xs - 2 * cs * xc * xs) / determinant;
    fraction = Math.max(fraction, explained / (totalPower || 1));
  }
  return fraction;
}

class AcousticFeatures {
  constructor() {
    this.highpass = new Biquad('highpass', 120);
    this.lowpass = new Biquad('lowpass', 1500);
  }

  measure(input, count) {
    const decimated = new Float32Array(Math.ceil(count / 4));
    let peak = 0;
    let power = 0;
    let bandPower = 0;
    for (let i = 0; i < count; i++) {
      const sample = input[i];
      const filtered = this.lowpass.filter(this.highpass.filter(sample));
      power += sample * sample;
      bandPower += filtered * filtered;
      peak = Math.max(peak, Math.abs(sample));
      if (i % 4 === 0) decimated[i / 4] = filtered;
    }
    // Normalized autocorrelation over roughly 90–400 Hz. Use a fixed minimum
    // number of overlapping samples so a tiny trailing fragment cannot win.
    let periodicity = 0;
    let lag = 0;
    for (let delay = 10; delay <= 44 && delay + 48 <= decimated.length; delay++) {
      let a = 0, b = 0, ab = 0;
      for (let i = delay; i < decimated.length; i++) {
        const x = decimated[i], y = decimated[i - delay];
        a += x * x;
        b += y * y;
        ab += x * y;
      }
      const correlation = ab / Math.sqrt(a * b || 1);
      if (correlation > periodicity) {
        periodicity = correlation;
        lag = delay;
      }
    }
    return {
      rms: Math.sqrt(power / count),
      bandRms: Math.sqrt(bandPower / count),
      crest: peak / (Math.sqrt(power / count) || 1),
      periodicity,
      lag,
      toneFraction: periodicity >= .65 ? singleToneFraction(decimated, lag) : 0,
    };
  }
}

class HybridDecision {
  constructor() {
    this.frames = [];
  }

  push(probability, acoustic) {
    const { rms, bandRms, crest, periodicity, toneFraction, lag } = acoustic;
    const plausible = rms >= .00035 && bandRms >= .00020 && crest < 10;
    const voiced = plausible && periodicity >= .65 && toneFraction < .92;
    const strongHarmonics = voiced && periodicity >= .92 && toneFraction < .7 && probability >= .02;
    this.frames.push({ probability, plausible, voiced, strongHarmonics, lag, bandRms });
    if (this.frames.length > 3) this.frames.shift();

    // A low neural score can qualify a periodic vocalization if it persists.
    // Unvoiced sounds can still pass when the model has sustained confidence.
    const periodicSupport = this.frames.filter(f => f.voiced && f.probability >= .045).length;
    const neuralSupport = this.frames.filter(f => f.plausible && f.probability >= .48).length;
    // A strongly periodic signal with energy outside one tone and a changing
    // pitch can rescue a quiet onset while Silero is still uncertain.
    const changingPitch = strongHarmonics && this.frames.some(f => f.strongHarmonics && f.lag !== lag);
    const bandLevels = this.frames.map(f => f.bandRms);
    const changingEnvelope = Math.max(...bandLevels) > 1.15 * Math.min(...bandLevels);
    const accepted = plausible && (
      changingPitch ||
      (voiced && probability >= .045 && periodicSupport >= 2 && changingEnvelope) ||
      (probability >= .48 && neuralSupport >= 2) ||
      (probability >= .24 && voiced && periodicity >= .82)
    );
    if (this.labObserve) {
      const mask = accepted ? Number(changingPitch) |
        (Number(voiced && probability >= .045 && periodicSupport >= 2 && changingEnvelope) << 1) |
        (Number(probability >= .48 && neuralSupport >= 2) << 2) |
        (Number(probability >= .24 && voiced && periodicity >= .82) << 3) : 0;
      this.labObserve(mask, +plausible, +voiced, +strongHarmonics, periodicSupport, neuralSupport,
        Math.min(...bandLevels), Math.max(...bandLevels), this.frames.length);
    }
    return accepted;
  }
}

class SileroCapture {
  constructor(ort, session) {
    this.ort = ort;
    this.session = session;
    this.state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
    this.rate = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
    this.input = new Float32Array(FRAME_SAMPLES + CONTEXT_SAMPLES);
    this.pending = 0;
    this.features = new AcousticFeatures();
    this.hybrid = new HybridDecision();
    this.finished = false;
  }

  async push(pcm, final = false) {
    if (this.finished || this.busy || pcm.length % 2) throw Error('PCM inválido ou captura indisponível.');
    this.busy = true;
    const frames = [];
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    try {
      for (let offset = 0; offset < pcm.length; offset += 2) {
        this.input[CONTEXT_SAMPLES + this.pending++] = view.getInt16(offset, true) / 32768;
        if (this.pending === FRAME_SAMPLES) frames.push(await this.infer());
      }
      if (final) {
        if (this.pending) frames.push(await this.infer());
        this.close();
      }
      return frames;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.finished = true;
    this.state.dispose();
    this.rate.dispose();
  }

  async infer() {
    const count = this.pending;
    this.input.fill(0, CONTEXT_SAMPLES + count);
    const tensor = new this.ort.Tensor('float32', this.input, [1, this.input.length]);
    let output;
    try {
      output = await this.session.run({ input: tensor, state: this.state, sr: this.rate });
    } finally {
      tensor.dispose();
    }
    this.state.dispose();
    this.state = output.stateN;
    const probability = output.output.data[0];
    output.output.dispose();
    const acoustic = this.features.measure(this.input.subarray(CONTEXT_SAMPLES), count);
    this.input.copyWithin(0, FRAME_SAMPLES);
    this.pending = 0;
    return { count, probability, ...acoustic, hybrid: this.hybrid.push(probability, acoustic) };
  }
}

module.exports = { Biquad, AcousticFeatures, HybridDecision, SileroCapture, PREROLL_MS };

self.HybridLab = module.exports; })();
