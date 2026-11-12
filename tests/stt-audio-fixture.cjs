'use strict';
// Sinal alternado na faixa de voz para fixtures que exercitam o VAD real.
const waveform=(i,rate)=>.8*Math.sin(2*Math.PI*180*i/rate)+.2*Math.sin(2*Math.PI*720*i/rate);
exports.voiceFrame=(amplitude=.1)=>Float32Array.from({length:4800},(_,i)=>amplitude*waveform(i,48000));
exports.voicePcm=(ms=100,peak=5000)=>new Uint8Array(Int16Array.from({length:ms*16},(_,i)=>Math.round(peak*waveform(i,16000))).buffer);
