// Hybrid listener: the DSP transcriber (js/audio/transcriber.js) as the primary engine, with the
// learned transcriber (nn-transcriber.js) filling the DSP's known gaps. Same interface as the
// DSP transcriber.
//
//   - In lessons (setExpected / setRange in use) every DSP note is reported as the DSP reports
//     it, unless the network already reported that key for the same attack (+-80 ms); the
//     network only adds due notes the DSP missed (p >= expP), reported at the network's latency.
//   - In free play a fitted arbiter (arbiter.js) decides: a DSP note is reported or dropped
//     when it arrives (the DSP's long window hears the partials of a struck note - its octave,
//     twelfth - as notes, and the network knows better); a network note the DSP has not
//     reported is reported as soon as the evidence is enough (often long before the DSP would
//     have: fast passages, the bass, the upper note of an octave), or dropped after a deadline.
//   - Onsets and note-offs come from the DSP.
// Costs both engines' CPU. Until the network's weights are in (fetched when this module loads) the
// hybrid is exactly the DSP engine; the network joins by itself once they arrive. dropNN() (the
// listener calls it when the device is too slow) returns to the DSP alone for good.
import { Transcriber as NNTranscriber, getWeights, ready } from './nn-transcriber.js';
import { Transcriber as DspTranscriber } from '../transcriber.js';
import { FreeArbiter } from './arbiter.js';
import { ARBITER_MODEL } from './arbiter-model.js';

const ENV = typeof process !== 'undefined' && process.env ? process.env : {};
const num = (v, d) => (v != null && v !== '' ? Number(v) : d);

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.expP = opts.expP ?? num(ENV.HYBRID_EXP, 0.5); // lessons: a due note the DSP missed
    this.lesson = false; // setExpected / setRange seen: the app knows what should be played
    this.stats = { emitted: 0, rejected: 0, restrikes: 0, nnAdded: 0, nnDropped: 0, dspDropped: 0 };
    // free play: the arbiter; its list of reported notes (the last ~1.5 s) serves lessons too
    this.arb = new FreeArbiter((midi, t, vel, info, src) => this._freeNote(midi, t, vel, info, src), opts.arbiter || ARBITER_MODEL);
    this.at = 0; // end of the chunk being analysed (s)
    this.nnFrame = -1;
    this.opts = opts;
    this.set = { expected: null, range: null, lohi: null, strictness: null, noisyRoom: null, a4: null, sensitivity: null };
    this.nnOff = opts.engine === 'dsp';
    this.dsp = new DspTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => this._dspNote(midi, t, vel, info),
      onOnset: (t, s) => {
        this.arb.onset(t, s);
        if (opts.onOnset) opts.onOnset(t, s);
      },
    });
    this.nn = null;
    if (!this.nnOff) {
      if (getWeights()) this._makeNN();
      else
        ready.then((w) => {
          if (w && !this.nn && !this.nnOff) this._makeNN();
        });
    }
  }

  _makeNN() {
    const o = this.opts;
    this.nn = new NNTranscriber(this.sr, {
      ...o,
      weights: getWeights(),
      // octave partners are exactly what the network is here for: no partial ("ghost")
      // suppression inside it; the octave rule above decides
      // (and a low firing threshold: the rules here decide, on the probability's peak)
      decoder: { ghostP: 0, thrReg: null, thr: 0.3, confirm: 1, ...(o.nnDecoder || {}) },
      onNoteOn: (midi, t, vel, info) => this._nnNote(midi, t, vel, info),
      onNoteOff: () => {},
      onOnset: () => {},
    });
    // settings made before the network joined
    const st = this.set;
    if (st.strictness != null) this.nn.setStrictness(st.strictness);
    if (st.noisyRoom != null) this.nn.setNoisyRoom(st.noisyRoom);
    if (st.a4 != null) this.nn.setTuning(st.a4);
    if (st.sensitivity != null) this.nn.sensitivity = st.sensitivity;
    if (st.lohi) this.nn.setRange(st.lohi[0], st.lohi[1]);
    if (st.expected) this.nn.setExpected(st.expected, st.range);
  }

  // Back to the DSP engine alone (for good): the device can't afford both.
  dropNN() {
    this.nnOff = true;
    this.nn = null;
    this.arb.cands = [];
  }

  get reported() {
    return this.arb.reported;
  }

  _has(midi, t, tol = 0.08) {
    return this.arb._has(midi, t, tol);
  }

  _report(midi, t, vel, info, src) {
    this.arb.reported.push({ midi, t, src, at: this.at });
    this.onNoteOn(midi, t, vel, info);
  }

  _freeNote(midi, t, vel, info, src) {
    if (src === 'nn') this.stats.nnAdded++;
    this.onNoteOn(midi, t, vel, info);
  }

  _dspNote(midi, t, vel, info = {}) {
    this.arb._trim(this.at);
    if (!this.lesson && this.nn && this.nn.engine === 'nn') {
      const before = this.arb.dropped.length;
      this.arb.dsp(midi, t, vel, info, this.at);
      if (this.arb.dropped.length > before) this.stats.dspDropped++;
      return;
    }
    if (!info.restrike && this.reported.some((e) => e.midi === midi && e.src === 'nn' && Math.abs(e.t - t) <= 0.08)) return;
    this._report(midi, t, vel, info, 'dsp');
  }

  _nnNote(midi, t, vel, info = {}) {
    if (!this.lesson) return this.arb.nn(midi, t, vel, info, this.at);
    if (info.restrike || this._has(midi, t)) return;
    // lessons: the DSP is excellent; the network only adds due notes it is fairly sure of
    if (info.expected && (info.p ?? 0) >= this.expP) {
      this.stats.nnAdded++;
      return this._report(midi, t, vel, info, 'nn');
    }
    this.stats.nnDropped++;
  }

  get pos() {
    return this.dsp.pos;
  }
  set pos(v) {
    this.dsp.pos = v;
    if (this.nn) this.nn.pos = v;
  }
  get engine() {
    return this.nn && this.nn.engine === 'nn' ? 'hybrid' : 'dsp';
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
    this.set.sensitivity = v;
    this.dsp.sensitivity = v;
    if (this.nn) this.nn.sensitivity = v;
  }

  push(samples, frame0) {
    this.at = (frame0 + samples.length) / this.sr;
    this.dsp.push(samples, frame0);
    const nn = this.nn;
    if (nn && nn.engine === 'nn') {
      nn.push(samples, frame0);
      // every new network frame: the arbiter watches the probabilities
      if (nn.frame !== this.nnFrame && nn.frame >= nn.dec.warm) {
        this.nnFrame = nn.frame;
        this.arb.frame(this.at, nn.lastP, nn.lastPf);
      }
    }
    const s = this.dsp.stats;
    this.stats.emitted = s.emitted + this.stats.nnAdded;
    this.stats.restrikes = s.restrikes;
    this.stats.rejected = s.rejected;
  }

  setExpected(midis, range) {
    this.set.expected = midis;
    this.set.range = range;
    // a lesson: notes are due, or the piece's range is set (the app sends [] in free play)
    this.lesson = !!(midis && midis.length) || !!range || !!this.set.lohi;
    if (this.lesson) this.arb.cands = [];
    this.dsp.setExpected(midis, range);
    if (this.nn) this.nn.setExpected(midis, range);
  }
  setRange(lo, hi) {
    this.set.lohi = lo != null ? [lo, hi] : null;
    this.lesson = lo != null || !!(this.set.expected && this.set.expected.length);
    if (this.lesson) this.arb.cands = [];
    this.dsp.setRange(lo, hi);
    if (this.nn) this.nn.setRange(lo, hi);
  }
  setStrictness(v) {
    this.set.strictness = v;
    this.dsp.setStrictness(v);
    if (this.nn) this.nn.setStrictness(v);
  }
  setNoisyRoom(on) {
    this.set.noisyRoom = on;
    this.dsp.setNoisyRoom(on);
    if (this.nn) this.nn.setNoisyRoom(on);
  }
  setTuning(a4) {
    this.set.a4 = a4;
    this.dsp.setTuning(a4);
    if (this.nn) this.nn.setTuning(a4);
  }
  startCalibration() {
    this.dsp.startCalibration();
    if (this.nn) this.nn.startCalibration();
  }
  finishCalibration() {
    if (this.nn) this.nn.finishCalibration();
    return this.dsp.finishCalibration();
  }
  reset() {
    this.dsp.reset();
    if (this.nn) this.nn.reset();
    this.arb.reset();
    this.nnFrame = -1;
  }
}
