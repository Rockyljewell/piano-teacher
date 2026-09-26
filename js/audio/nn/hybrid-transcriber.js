// Hybrid listener: the DSP transcriber (js/audio/transcriber.js) as the primary engine, with the
// learned transcriber (nn-transcriber.js) filling the DSP's known gaps. Same interface as the
// DSP transcriber.
//
//   - Every DSP note is reported as the DSP reports it (lessons, noise rejection unchanged),
//     unless the network already reported that key for the same attack (+-80 ms).
//   - In lessons (setExpected / setRange in use) the network only adds due notes the DSP
//     missed (p >= expP), reported at the network's latency.
//   - In free play, a network note the DSP does not have is added when
//       * the network is very sure (p >= trustP, calibrated precision >= ~90 %), reported at the
//         network's latency - fast passages, free-play notes the DSP only confirms late; or
//       * it is the octave (or double octave) partner of a note already reported for the same
//         attack (+-40 ms) and p >= octP - the DSP's weakest case: a note hidden in the partials
//         of the note an octave below.
//     Other network notes wait up to `wait` for such evidence, then are dropped.
//   - Onsets and note-offs come from the DSP.
// Costs both engines' CPU. Until the network's weights are in (fetched when this module loads) the
// hybrid is exactly the DSP engine; the network joins by itself once they arrive. dropNN() (the
// listener calls it when the device is too slow) returns to the DSP alone for good.
import { Transcriber as NNTranscriber, getWeights, ready } from './nn-transcriber.js';
import { Transcriber as DspTranscriber } from '../transcriber.js';

const ENV = typeof process !== 'undefined' && process.env ? process.env : {};
const num = (v, d) => (v != null && v !== '' ? Number(v) : d);

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.trustP = opts.trustP ?? num(ENV.HYBRID_TRUST, 0.995);
    this.octP = opts.octP ?? num(ENV.HYBRID_OCT, 0.5);
    this.wait = opts.wait ?? num(ENV.HYBRID_WAIT, 0.25); // s a network note may wait for evidence (the DSP needs ~150 ms in free play)
    this.expP = opts.expP ?? num(ENV.HYBRID_EXP, 0.5); // lessons: a due note the DSP missed
    this.lesson = false; // setExpected / setRange seen: the app knows what should be played
    this.reported = []; // [{midi, t, src}] of the last ~1.5 s
    this.held = []; // network notes waiting for an octave partner
    this.stats = { emitted: 0, rejected: 0, restrikes: 0, nnAdded: 0, nnDropped: 0 };
    this.opts = opts;
    this.set = { expected: null, range: null, lohi: null, strictness: null, noisyRoom: null, a4: null, sensitivity: null };
    this.nnOff = opts.engine === 'dsp';
    this.dsp = new DspTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => this._dspNote(midi, t, vel, info),
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
    this.held = [];
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
    if (this.lesson) {
      // lessons: the DSP is excellent; the network only adds due notes it is fairly sure of
      if (info.expected && p >= this.expP) {
        this.stats.nnAdded++;
        return this._report(midi, t, vel, info, 'nn');
      }
      this.stats.nnDropped++;
      return;
    }
    // free play: watch the note's probability for up to `wait`; keep it if it gets very sure,
    // or if it is the octave partner of a DSP note
    this.held.push({ midi, t, vel, info, pmax: p, until: this._now() + this.wait });
    this._checkHeld();
  }

  _partner(midi, t) {
    // any note already reported for the same attack (by the DSP, or by the network when sure)
    return this.reported.some((e) => Math.abs(e.t - t) <= 0.04 && (e.midi === midi - 12 || e.midi === midi + 12 || e.midi === midi - 24));
  }

  _checkHeld() {
    if (!this.held.length) return;
    const now = this._now();
    const keep = [];
    const lp = this.nn && this.nn.lastP;
    for (const h of this.held) {
      if (this._has(h.midi, h.t)) continue; // the DSP heard it itself
      if (lp) h.pmax = Math.max(h.pmax, lp[h.midi - 21] || 0);
      if (h.pmax >= this.trustP || (h.pmax >= this.octP && this._partner(h.midi, h.t))) {
        this.stats.nnAdded++;
        this._report(h.midi, h.t, h.vel, { ...h.info, p: h.pmax }, 'nn');
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
    this.dsp.push(samples, frame0);
    if (this.nn && this.nn.engine === 'nn') this.nn.push(samples, frame0);
    this._checkHeld();
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
    this.dsp.setExpected(midis, range);
    if (this.nn) this.nn.setExpected(midis, range);
  }
  setRange(lo, hi) {
    this.set.lohi = lo != null ? [lo, hi] : null;
    this.lesson = lo != null || !!(this.set.expected && this.set.expected.length);
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
    this.reported = [];
    this.held = [];
  }
}
