// Hybrid listener: the learned transcriber (fast, polyphonic) with the DSP transcriber running
// alongside as a second opinion. Same interface as js/audio/transcriber.js.
//
//   - every network note is reported at once, exactly as nn-transcriber.js reports it;
//   - a note the DSP engine is confident about (or that the lesson expects) and that the network
//     did not report within 80 ms of the same attack is reported late ("rescue"), with the DSP's
//     timing and confidence;
//   - onsets and note-offs come from the network.
// Costs both engines' CPU (see docs/listening-model.md for the measured trade-off).
import { Transcriber as NNTranscriber } from './nn-transcriber.js';
import { Transcriber as DspTranscriber } from '../transcriber.js';

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.rescueConf = opts.rescueConf ?? 0.7; // DSP confidence needed to add a note the network missed
    this.recent = []; // [{midi, t}] network notes of the last ~1 s
    this.stats = { emitted: 0, rejected: 0, restrikes: 0, rescued: 0 };
    this.nn = new NNTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => {
        this.recent.push({ midi, t });
        this.onNoteOn(midi, t, vel, info);
      },
    });
    this.dsp = new DspTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => this._dspNote(midi, t, vel, info),
      onNoteOff: () => {},
      onOnset: () => {},
    });
    this.expected = new Set();
  }

  _dspNote(midi, t, vel, info = {}) {
    const now = this.nn.pos / this.sr;
    this.recent = this.recent.filter((e) => now - e.t < 1.5);
    if (info.restrike) return;
    if (this.recent.some((e) => e.midi === midi && Math.abs(e.t - t) <= 0.08)) return;
    const conf = info.confidence ?? 1;
    if (conf < this.rescueConf && !this.expected.has(midi)) return;
    this.recent.push({ midi, t });
    this.stats.rescued++;
    this.onNoteOn(midi, t, vel, { confidence: conf * 0.95, restrike: false, rescued: true });
  }

  get pos() {
    return this.nn.pos;
  }
  set pos(v) {
    this.nn.pos = v;
    this.dsp.pos = v;
  }
  get engine() {
    return this.nn.engine === 'nn' ? 'hybrid' : 'dsp';
  }
  get noiseLevel() {
    return this.dsp.noiseLevel;
  }
  get pianoLevel() {
    return this.nn.pianoLevel ?? this.dsp.pianoLevel;
  }
  get tuningCents() {
    return this.dsp.tuningCents;
  }
  get noiseRms() {
    return this.dsp.noiseRms;
  }
  get strictness() {
    return this.nn.strictness;
  }
  get sensitivity() {
    return this.nn.sensitivity;
  }
  set sensitivity(v) {
    this.nn.sensitivity = v;
    this.dsp.sensitivity = v;
  }

  push(samples, frame0) {
    this.nn.push(samples, frame0);
    if (this.nn.engine === 'nn') this.dsp.push(samples, frame0);
    const s = this.nn.stats;
    this.stats.emitted = s.emitted + this.stats.rescued;
    this.stats.restrikes = s.restrikes;
    this.stats.rejected = s.rejected;
  }

  setExpected(midis, range) {
    this.expected = new Set(midis);
    this.nn.setExpected(midis, range);
    this.dsp.setExpected(midis, range);
  }
  setRange(lo, hi) {
    this.nn.setRange(lo, hi);
    this.dsp.setRange(lo, hi);
  }
  setStrictness(v) {
    this.nn.setStrictness(v);
    this.dsp.setStrictness(v);
  }
  setNoisyRoom(on) {
    this.nn.setNoisyRoom(on);
    this.dsp.setNoisyRoom(on);
  }
  setTuning(a4) {
    this.nn.setTuning(a4);
    this.dsp.setTuning(a4);
  }
  startCalibration() {
    this.nn.startCalibration();
    this.dsp.startCalibration();
  }
  finishCalibration() {
    this.nn.finishCalibration();
    return this.dsp.finishCalibration();
  }
  reset() {
    this.nn.reset();
    this.dsp.reset();
    this.recent = [];
  }
}
