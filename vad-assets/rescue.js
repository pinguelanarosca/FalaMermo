(() => { const module = {exports:{}};

class Buffer extends Uint8Array {
  static alloc(n) { return new Buffer(n); }
  static concat(parts) {
    const out = new Buffer(parts.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }
  readInt16LE(at) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(at, true); }
  writeInt16LE(value, at) { new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(at, value, true); }
}
'use strict';
const { AcousticFeatures, Biquad } = self.HybridLab;

class VoiceBand {
  constructor(highHz, gain) {
    this.filters = [new Biquad('highpass', 100), new Biquad('lowpass', highHz), new Biquad('lowpass', highHz)];
    this.gain = gain;
  }

  push(pcm) {
    const filtered = Buffer.alloc(pcm.length);
    for (let i = 0; i < pcm.length; i += 2) {
      let x = pcm.readInt16LE(i) / 32768;
      for (const filter of this.filters) x = filter.filter(x);
      filtered.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * this.gain * 32768))), i);
    }
    return filtered;
  }
}

// Only supplements the raw detector. It uses both model inputs and requires
// periodic support across frames before opening a low-confidence block.
class FilteredRescue {
  constructor(highHz, gain) {
    this.band = new VoiceBand(highHz, gain);
    this.support = 0;
  }

  push(raw, filtered) {
    const evidence = filtered.probability >= .12 && raw.probability >= .015 &&
      raw.crest < 10 && filtered.periodicity >= .65 && filtered.toneFraction < .9;
    this.support = evidence ? this.support + 1 : 0;
    return this.support >= 2;
  }
}

class BandPeriodicityRescue {
  constructor() {
    this.band = new VoiceBand(900, 1);
    this.acoustic = new AcousticFeatures();
    this.pending = Buffer.alloc(0);
    this.history = [];
  }

  push(packet, rawFrames) {
    const filtered = Buffer.concat([this.pending, this.band.push(packet)]);
    let at = 0;
    const decisions = rawFrames.map(raw => {
      const samples = Float32Array.from({ length: raw.count }, (_, i) => filtered.readInt16LE(at + 2*i) / 32768);
      at += raw.count * 2;
      const f = this.acoustic.measure(samples, raw.count);
      this.history.push({ ...f, rawProbability: raw.probability, rawCrest: raw.crest });
      if (this.history.length > 4) this.history.shift();
      const tail = this.history.slice(-3);
      const levels = this.history.map(f => f.bandRms);
      const lags = tail.map(f => f.lag);
      const rescue = tail.length === 3 && tail.every(f => f.periodicity >= .55 && f.toneFraction < .9 && f.rawCrest < 10) &&
        tail.some(f => f.periodicity >= .65) && Math.max(...lags) - Math.min(...lags) <= 2 &&
        Math.max(...levels) > 1.35 * Math.min(...levels) &&
        this.history.some(f => f.rawProbability >= .075);
      if (this.labObserve) {
        this.labObserve(
          tail.filter(frame => frame.periodicity >= .55 && frame.toneFraction < .9 && frame.rawCrest < 10).length,
          Math.max(...tail.map(frame => frame.periodicity)), Math.max(...lags) - Math.min(...lags),
          Math.min(...levels), Math.max(...levels),
          Math.max(...this.history.map(frame => frame.rawProbability)), this.history.length);
      }
      return { rescue, ...f };
    });
    this.pending = filtered.subarray(at);
    return decisions;
  }
}

module.exports = { VoiceBand, FilteredRescue, BandPeriodicityRescue };

self.RescueLab = { ...module.exports, PcmView: Buffer }; })();
