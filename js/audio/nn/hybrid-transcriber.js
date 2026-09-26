// Hybrid listener: the learned transcriber (fast, polyphonic) gated by the DSP transcriber
// running alongside. Same interface as js/audio/transcriber.js.
//
//   - Expected notes (setExpected: the lesson says they are due) that the network hears are
//     reported at once, at the network's latency.
//   - Unexpected notes must also be confirmed by the DSP engine's evidence: an attack in its
//     spectral flux (above its calibrated noise floor) within +-40 ms, and harmonic evidence for
//     that key (the key is among the notes its iterative harmonic analysis finds, or it is
//     already judging / sounding that key). The note waits up to `gateWait` for it (the DSP
//     analyses every ~21 ms), then is reported - or dropped.
//   - Rescue: a note the DSP engine reports confidently that the network did not hear (+-80 ms)
//     is reported late, with the DSP's timing and confidence.
//   - Onsets and note-offs come from the network.
// The gate reads a few fields of the DSP transcriber (onsets, weakPeaks, lastDetected, pending,
// active); if they are missing (a future DSP version), unexpected notes pass ungated.
import { Transcriber as NNTranscriber } from './nn-transcriber.js';
import { Transcriber as DspTranscriber } from '../transcriber.js';

const ENV = typeof process !== 'undefined' && process.env ? process.env : {};

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.gate = opts.gate ?? (ENV.HYBRID_GATE != null ? ENV.HYBRID_GATE !== '0' : true);
    this.rescue = opts.rescue ?? (ENV.HYBRID_RESCUE != null ? ENV.HYBRID_RESCUE !== '0' : true);
    this.rescueConf = opts.rescueConf ?? 0.7; // DSP confidence needed to add a note the network missed
    this.gateWait = opts.gateWait ?? (ENV.HYBRID_WAIT != null ? Number(ENV.HYBRID_WAIT) : 0.06); // s an unexpected note may wait for the DSP's evidence
    // evidence the DSP must show for an unexpected note: 'detect' (an attack in its flux and the
    // key among its harmonic detections), 'pending' (it is judging or has reported that key, for
    // an attack within 40 ms), 'emit' (it reported the key within 80 ms)
    this.gateMode = opts.gateMode ?? ENV.HYBRID_MODE ?? 'pending';
    this.trustP = opts.trustP ?? (ENV.HYBRID_TRUST != null ? Number(ENV.HYBRID_TRUST) : 0.97); // network probability that needs no second opinion
    this.dspNotes = []; // [{midi, t}] notes the DSP reported
    this.recent = []; // [{midi, t}] reported notes of the last ~1.5 s
    this.held = []; // unexpected network notes waiting for evidence
    this.stats = { emitted: 0, rejected: 0, restrikes: 0, rescued: 0, gated: 0 };
    this.expected = new Set();
    this.nn = new NNTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => this._nnNote(midi, t, vel, info),
    });
    this.dsp = new DspTranscriber(sampleRate, {
      ...opts,
      onNoteOn: (midi, t, vel, info) => this._dspNote(midi, t, vel, info),
      onNoteOff: () => {},
      onOnset: () => {},
    });
  }

  _report(midi, t, vel, info) {
    this.recent.push({ midi, t });
    this.onNoteOn(midi, t, vel, info);
  }

  _nnNote(midi, t, vel, info = {}) {
    if (!this.gate || info.expected || this.nn.engine !== 'nn' || !this.dsp.lastDetected || (info.p ?? 0) >= this.trustP) return this._report(midi, t, vel, info);
    this.held.push({ midi, t, vel, info, until: this.nn.pos / this.sr + this.gateWait });
    this._checkHeld();
  }

  // DSP evidence for `midi` attacked at `t`?
  _evidence(midi, t) {
    const d = this.dsp;
    const near = (o) => Math.abs(o.t - t) <= 0.04;
    if (this.dspNotes.some((e) => e.midi === midi && Math.abs(e.t - t) <= 0.08)) return true;
    if (this.gateMode === 'emit') return false;
    if (this.gateMode === 'pending') {
      const p = d.pending && d.pending.get(midi);
      if (p && p.attack && near(p.attack)) return true;
      const a = d.active && d.active.get(midi);
      return !!(a && Math.abs(a.on - t) <= 0.04);
    }
    const flux = (d.onsets || []).some(near) || (d.weakPeaks || []).some((o) => o.medium && near(o));
    if (!flux) return false;
    return (d.lastDetected || []).some((x) => x.midi === midi) || (d.pending && d.pending.has(midi)) || (d.active && d.active.has(midi));
  }

  _checkHeld() {
    if (!this.held.length) return;
    const now = this.nn.pos / this.sr;
    const keep = [];
    for (const h of this.held) {
      if (this._evidence(h.midi, h.t)) this._report(h.midi, h.t, h.vel, h.info);
      else if (now < h.until) keep.push(h);
      else this.stats.gated++;
    }
    this.held = keep;
  }

  _dspNote(midi, t, vel, info = {}) {
    const now = this.nn.pos / this.sr;
    this.dspNotes = this.dspNotes.filter((e) => now - e.t < 1.5);
    this.dspNotes.push({ midi, t });
    this._checkHeld();
    if (!this.rescue) return;
    this.recent = this.recent.filter((e) => now - e.t < 1.5);
    if (info.restrike) return;
    if (this.recent.some((e) => e.midi === midi && Math.abs(e.t - t) <= 0.08)) return;
    if (this.held.some((e) => e.midi === midi && Math.abs(e.t - t) <= 0.08)) return;
    const conf = info.confidence ?? 1;
    if (conf < this.rescueConf && !this.expected.has(midi)) return;
    this.stats.rescued++;
    this._report(midi, t, vel, { confidence: conf * 0.95, restrike: false, rescued: true });
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
    // DSP first: its evidence for this chunk is then available when the network's notes arrive
    if (this.nn.engine === 'nn') this.dsp.push(samples, frame0);
    this.nn.push(samples, frame0);
    this._checkHeld();
    const s = this.nn.stats;
    this.stats.emitted = s.emitted + this.stats.rescued - this.stats.gated;
    this.stats.restrikes = s.restrikes;
    this.stats.rejected = s.rejected + this.stats.gated;
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
    this.held = [];
  }
}
