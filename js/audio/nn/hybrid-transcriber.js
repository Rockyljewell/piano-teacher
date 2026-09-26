// Hybrid listener: the DSP transcriber (js/audio/transcriber.js) as the primary engine, with the
// learned transcriber (nn-transcriber.js) filling the DSP's known gaps. Same interface as the
// DSP transcriber.
//
//   - Every DSP note is reported as the DSP reports it (lessons, noise rejection unchanged),
//     unless the network already reported that key for the same attack (+-80 ms).
//   - A network note the DSP does not have is added when
//       * the network is very sure (p >= trustP, calibrated precision >= ~90 %), reported at the
//         network's latency - fast passages, free-play notes the DSP only confirms late; or
//       * it is the octave (or double octave) partner of a note the DSP reported for the same
//         attack (+-40 ms) and p >= octP - the DSP's weakest case: a note hidden in the partials
//         of the note an octave below.
//     Other network notes wait up to `wait` for such evidence, then are dropped.
//   - Onsets and note-offs come from the DSP.
// Costs both engines' CPU.
import { Transcriber as NNTranscriber } from './nn-transcriber.js';
import { Transcriber as DspTranscriber } from '../transcriber.js';

const ENV = typeof process !== 'undefined' && process.env ? process.env : {};
const num = (v, d) => (v != null && v !== '' ? Number(v) : d);

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.trustP = opts.trustP ?? num(ENV.HYBRID_TRUST, 0.97);
    this.octP = opts.octP ?? num(ENV.HYBRID_OCT, 0.5);
    this.wait = opts.wait ?? num(ENV.HYBRID_WAIT, 0.06);
    this.reported = []; // [{midi, t, src}] of the last ~1.5 s
    this.held = []; // network notes waiting for an octave partner
    this.stats = { emitted: 0, rejected: 0, restrikes: 0, nnAdded: 0, nnDropped: 0 };
    this.dsp = new DspTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => this._dspNote(midi, t, vel, info),
    });
    this.nn = new NNTranscriber(sampleRate, {
      ...opts,
      // octave partners are exactly what the network is here for: no partial ("ghost")
      // suppression inside it; the octave rule above decides
      decoder: { ghostP: 0, ...(opts.nnDecoder || {}) },
      onNoteOn: (midi, t, vel, info) => this._nnNote(midi, t, vel, info),
      onNoteOff: () => {},
      onOnset: () => {},
    });
  }

  _now() {
    return this.dsp.pos / this.sr;
  }

  _has(midi, t, tol = 0.08) {
    return this.reported.some((e) => e.midi === midi && Math.abs(e.t - t) <= tol);
  }

  _report(midi, t, vel, info, src) {
    this.reported.push({ midi, t, src });
    this.onNoteOn(midi, t, vel, info);
  }

  _dspNote(midi, t, vel, info = {}) {
    const now = this._now();
    this.reported = this.reported.filter((e) => now - e.t < 1.5);
    if (!info.restrike && this.reported.some((e) => e.midi === midi && e.src === 'nn' && Math.abs(e.t - t) <= 0.08)) return;
    this._report(midi, t, vel, info, 'dsp');
    this._checkHeld();
  }

  _nnNote(midi, t, vel, info = {}) {
    if (info.restrike || this._has(midi, t)) return;
    const p = info.p ?? 0;
    if (p >= this.trustP) {
      this.stats.nnAdded++;
      return this._report(midi, t, vel, info, 'nn');
    }
    if (p >= this.octP) this.held.push({ midi, t, vel, info, until: this._now() + this.wait });
    else this.stats.nnDropped++;
    this._checkHeld();
  }

  _partner(midi, t) {
    return this.reported.some((e) => e.src === 'dsp' && Math.abs(e.t - t) <= 0.04 && (e.midi === midi - 12 || e.midi === midi + 12 || e.midi === midi - 24));
  }

  _checkHeld() {
    if (!this.held.length) return;
    const now = this._now();
    const keep = [];
    for (const h of this.held) {
      if (this._has(h.midi, h.t)) continue; // the DSP heard it itself
      if (this._partner(h.midi, h.t)) {
        this.stats.nnAdded++;
        this._report(h.midi, h.t, h.vel, h.info, 'nn');
      } else if (now < h.until) keep.push(h);
      else this.stats.nnDropped++;
    }
    this.held = keep;
  }

  get pos() {
    return this.dsp.pos;
  }
  set pos(v) {
    this.dsp.pos = v;
    this.nn.pos = v;
  }
  get engine() {
    return this.nn.engine === 'nn' ? 'hybrid' : 'dsp';
  }
  get noiseLevel() {
    return this.dsp.noiseLevel;
  }
  get pianoLevel() {
    return this.dsp.pianoLevel;
  }
  get tuningCents() {
    return this.dsp.tuningCents;
  }
  get noiseRms() {
    return this.dsp.noiseRms;
  }
  get strictness() {
    return this.dsp.strictness;
  }
  get sensitivity() {
    return this.dsp.sensitivity;
  }
  set sensitivity(v) {
    this.dsp.sensitivity = v;
    this.nn.sensitivity = v;
  }

  push(samples, frame0) {
    this.dsp.push(samples, frame0);
    if (this.nn.engine === 'nn') this.nn.push(samples, frame0);
    this._checkHeld();
    const s = this.dsp.stats;
    this.stats.emitted = s.emitted + this.stats.nnAdded;
    this.stats.restrikes = s.restrikes;
    this.stats.rejected = s.rejected;
  }

  setExpected(midis, range) {
    this.dsp.setExpected(midis, range);
    this.nn.setExpected(midis, range);
  }
  setRange(lo, hi) {
    this.dsp.setRange(lo, hi);
    this.nn.setRange(lo, hi);
  }
  setStrictness(v) {
    this.dsp.setStrictness(v);
    this.nn.setStrictness(v);
  }
  setNoisyRoom(on) {
    this.dsp.setNoisyRoom(on);
    this.nn.setNoisyRoom(on);
  }
  setTuning(a4) {
    this.dsp.setTuning(a4);
    this.nn.setTuning(a4);
  }
  startCalibration() {
    this.dsp.startCalibration();
    this.nn.startCalibration();
  }
  finishCalibration() {
    this.nn.finishCalibration();
    return this.dsp.finishCalibration();
  }
  reset() {
    this.dsp.reset();
    this.nn.reset();
    this.reported = [];
    this.held = [];
  }
}
