// Learned real-time piano transcriber: a drop-in replacement for js/audio/transcriber.js (same
// constructor, push(), callbacks, setters and getters), built on a small causal neural network
// (tools/nn/, docs/listening-model.md).
//
//   mic samples (any rate) -> 16 kHz -> every 10 ms: log-frequency spectra (128 ms + 32 ms
//   windows) -> network -> per key: "struck within the last 40 ms" probability, "sounding"
//   probability, and which 10 ms frame the attack was in
//   -> decoder: a key fires the first time its onset probability crosses its threshold (lower
//   for notes the lesson expects, higher far outside the piece and in noisy-room mode), the time
//   is back-dated to the attack (network frame, refined to ~2 ms on the signal's high-band
//   energy within +-20 ms); confidence is the calibrated probability; note-off when "sounding"
//   stays low.
//
// Weights (assets/models/piano-nn.bin, ~30 KB) load asynchronously in the browser (`ready`);
// in Node they are read synchronously at import. Until they arrive (or if they cannot be
// loaded) an instance delegates to the DSP transcriber and switches over by itself once the
// weights are there.
import { Resampler, Frontend, SR as NSR, HOP, NB, MIDI0, BPS } from './frontend.js';
import { Model, parseWeights } from './model.js';
import { Transcriber as DspTranscriber } from '../transcriber.js';

export const MIDI_MIN = 21;
export const MIDI_MAX = 108;
export const WEIGHTS_URL = new URL('../../../assets/models/piano-nn.bin', import.meta.url);

let WEIGHTS = null;
let loadError = null;
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';

// Install weights: a weights-file buffer, an already parsed file, or null (none).
export function setWeights(buf) {
  WEIGHTS = buf ? (buf.header ? buf : parseWeights(buf)) : null;
  return WEIGHTS;
}
export const getWeights = () => WEIGHTS;
export const weightsLoaded = () => !!WEIGHTS;
export const weightsError = () => loadError;

export async function loadWeights(url = WEIGHTS_URL) {
  try {
    if (isNode && String(url).startsWith('file:')) {
      const fs = await import('node:fs');
      return setWeights(fs.readFileSync(url));
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return setWeights(await r.arrayBuffer());
  } catch (e) {
    loadError = e;
    return null;
  }
}

// Node (tests, benchmark): load now, before anyone constructs a Transcriber. Browser/worker:
// start fetching; `ready` resolves when the weights are in (or failed: null).
// NN_WEIGHTS=/path/to/file.bin (Node only) loads another weights file (training experiments).
export const ready = isNode ? Promise.resolve(await loadWeights(process.env.NN_WEIGHTS ? (await import('node:url')).pathToFileURL((await import('node:path')).resolve(process.env.NN_WEIGHTS)) : WEIGHTS_URL)) : loadWeights();

// intervals (semitones) at which a struck note's partials can pass for another note
const GHOST_IV = [12, 19, 24, 28, 31, 36];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// registers for per-register thresholds: A0-B1, C2-B2, C3-B3, C4-B4, C5-B5, C6-C8
export const REGISTERS = [21, 36, 48, 60, 72, 84, 109];
export const regOf = (midi) => {
  let r = 0;
  while (r < REGISTERS.length - 2 && midi >= REGISTERS[r + 1]) r++;
  return r;
};
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Decoder defaults (overridden by the weights file's "decoder" section, fitted in tools/nn/).
const DEC = {
  thr: 0.5, // unexpected note, strictness 0.5
  thrStrict: 0.25, // added at strictness 1 (scaled linearly from 0.5)
  thrExp: 0.28, // expected note (lesson hint)
  thrOut: 0.15, // extra for unexpected notes > 5 semitones outside the piece
  rearm: 0.5, // re-armed once below thr * rearm
  refractory: 5, // frames between two strikes of one key
  offThr: 0.25,
  offFrames: 3,
  warm: 30, // frames after a (re)start before anything is reported
  calib: [[0, 0], [0.3, 0.3], [0.5, 0.55], [0.7, 0.75], [0.9, 0.92], [1, 1]], // p -> P(real note)
  expectedBonus: 1, // logit added to the confidence of expected notes (as the DSP does)
  refine: 0.02, // s: attack refinement window (+-)
  confirm: 1, // frames an unexpected note must stay above its threshold before it is reported
  ghostP: 0, // unexpected notes at a partial of a note struck together need p >= ghostP (0: off)
  minGap: 0.07, // s: two reports of one key need attacks at least this far apart
  gateRise: 0, // unexpected notes need a high-band energy jump of this ratio within +-20 ms (0: off)
};

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.opts = opts;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.onNoteOff = opts.onNoteOff || (() => {});
    this.onOnset = opts.onOnset || (() => {});
    this.sensitivity = opts.sensitivity ?? 1;
    this._baseStrictness = clamp(opts.strictness ?? 0.5, 0, 1);
    this.noisyRoom = !!opts.noisyRoom;
    this.strictness = this.noisyRoom ? Math.max(this._baseStrictness, 0.85) : this._baseStrictness;
    this.a4 = opts.a4 || 440;
    this.tuningCents = 1200 * Math.log2(this.a4 / 440);
    this.expected = new Set();
    this.range = null;
    this.stats = { emitted: 0, rejected: 0, restrikes: 0 };
    this.pos = -1;
    this.noiseRms = 0;
    this.engine = 'nn';
    this._dsp = null;
    const w = opts.weights ? (opts.weights.header ? opts.weights : parseWeights(opts.weights)) : WEIGHTS;
    if (w) this._init(w);
    else {
      // weights not here yet: the DSP engine listens meanwhile
      this.engine = 'dsp';
      this._dsp = new DspTranscriber(sampleRate, opts);
      if (!isNode)
        ready.then((x) => {
          if (x && this._dsp) this._pendingWeights = x;
        });
    }
  }

  _init(w) {
    this.weights = w;
    this.dec = { ...DEC, ...(w.header.decoder || {}), ...(this.opts.decoder || {}) };
    this.model = new Model(w);
    this.KO = this.model.KO;
    const cfg = w.header.cfg;
    // onset window per key (frames): longer below C3 if the model was trained so
    this.Kk = Uint8Array.from({ length: 88 }, (_, k) => (cfg.k_bass && k + MIDI_MIN < 48 ? cfg.k_bass : cfg.k_onset));
    this.K = cfg.k_onset;
    this.fe = new Frontend({ cents: this.tuningCents, wins: w.header.frontend.wins });
    this.rs = new Resampler(this.sr);
    this.armed = new Uint8Array(88).fill(1);
    this.lastFire = new Int32Array(88).fill(-1000);
    this.lastT = new Float64Array(88).fill(-1e9); // attack time of the last report per key
    this.on = new Uint8Array(88);
    this.offCount = new Uint8Array(88);
    this.above = new Uint8Array(88); // consecutive frames above the threshold
    this.frame = 0; // frames since the (re)start
    this.n16 = 0;
    // fine high-band energy envelope (2 ms blocks) for attack refinement
    this.blk = 32;
    this.env = new Float32Array(256);
    this.envN = 0;
    this.envAcc = 0;
    this.envCnt = 0;
    this.prevS = 0;
    // noise / level tracking (10 ms frame RMS at 16 kHz)
    this.frameAcc = 0;
    this.frameRms = 0;
    this.floorWin = [];
    this.floorMin = Infinity;
    this.floorCnt = 0;
    this.floor = 0;
    this.levels = [];
    this.pianoLevelBase = null;
    this.pianoLevelT = 0;
    this.calibrating = null;
    this.lastOnsetT = -1;
    this.autoTune = this.opts.autoTune ?? true;
    this.tunePending = []; // [{midi, frame}] notes to measure once the long window sees them
    this.tuneSamples = [];
  }

  // ---- settings (same as the DSP transcriber) ----------------------------------------------------
  setTuning(a4) {
    this.a4 = a4;
    this.tuningCents = 1200 * Math.log2(a4 / 440);
    if (this.fe) this.fe.setTuning(this.tuningCents);
    if (this._dsp) this._dsp.setTuning(a4);
  }

  setStrictness(v) {
    this._baseStrictness = clamp(Number(v) || 0, 0, 1);
    this.strictness = this.noisyRoom ? Math.max(this._baseStrictness, 0.85) : this._baseStrictness;
    if (this._dsp) this._dsp.setStrictness(v);
  }

  setNoisyRoom(on) {
    this.noisyRoom = !!on;
    this.setStrictness(this._baseStrictness);
    if (this._dsp) this._dsp.setNoisyRoom(on);
  }

  setExpected(midis, range) {
    this.expected = new Set(midis);
    if (range !== undefined) this.range = range;
    if (this._dsp) this._dsp.setExpected(midis, range);
  }

  setRange(lo, hi) {
    this.range = lo == null ? null : [lo, hi];
    if (this._dsp) this._dsp.setRange(lo, hi);
  }

  startCalibration() {
    this.calibrating = { rms: [] };
    if (this._dsp) this._dsp.startCalibration();
  }

  finishCalibration() {
    const c = this.calibrating;
    this.calibrating = null;
    if (this._dsp) {
      const ok = this._dsp.finishCalibration();
      this.noiseRms = this._dsp.noiseRms;
      return ok;
    }
    if (!c || c.rms.length < 3) return false;
    const s = [...c.rms].sort((a, b) => a - b);
    this.noiseRms = s[Math.floor(s.length * 0.9)];
    if (!this.floor) this.floor = s[s.length >> 1];
    return true;
  }

  get noiseLevel() {
    if (this._dsp) return this._dsp.noiseLevel;
    return 20 * Math.log10(this.floor + 1e-10);
  }

  get pianoLevel() {
    if (this._dsp) return this._dsp.pianoLevel;
    if (this.pianoLevelBase == null) return null;
    return this.pianoLevelBase - 0.3 * Math.max(0, this.pos / this.sr - this.pianoLevelT);
  }

  reset() {
    if (this._dsp) return this._dsp.reset();
    const t = this.pos / this.sr;
    for (let k = 0; k < 88; k++)
      if (this.on[k]) {
        this.on[k] = 0;
        this.onNoteOff(k + MIDI_MIN, t);
      }
    this.armed.fill(1);
    this.offCount.fill(0);
  }

  // ---- audio in ----------------------------------------------------------------------------------
  push(samples, frame0) {
    if (this._dsp) {
      this._dsp.pos = this.pos;
      this._dsp.push(samples, frame0);
      this.pos = this._dsp.pos;
      if (this._pendingWeights) this._switchToNN();
      return;
    }
    if (this.pos < 0 || Math.abs(frame0 - this.pos) > this.sr) this._restart(frame0);
    this.pos = frame0 + samples.length;
    const y = this.rs.push(samples);
    // fine envelope and frame RMS, sample by sample at 16 kHz
    for (let i = 0; i < y.length; i++) {
      const s = y[i];
      const d = s - this.prevS;
      this.prevS = s;
      this.envAcc += d * d;
      if (++this.envCnt === this.blk) {
        this.env[this.envN & 255] = this.envAcc / this.blk;
        this.envN++;
        this.envAcc = 0;
        this.envCnt = 0;
      }
      this.frameAcc += s * s;
      this.n16++;
      if (this.n16 % HOP === 0) {
        this.frameRms = Math.sqrt(this.frameAcc / HOP);
        this.frameAcc = 0;
        this._trackNoise(this.frameRms);
      }
    }
    this.fe.push(y, this._onFrame || (this._onFrame = (f, end) => this._frame(f, end)));
  }

  _switchToNN() {
    const dsp = this._dsp;
    const w = this._pendingWeights;
    this._pendingWeights = null;
    // end the DSP's notes; the network starts from the next chunk (it needs ~0.3 s of audio)
    dsp.reset();
    this._dsp = null;
    this.engine = 'nn';
    this.noiseRms = dsp.noiseRms;
    this._init(w);
    this.pos = -1;
  }

  _restart(frame0) {
    this.rs.reset(frame0);
    this.fe.reset();
    this.fe.setTuning(this.tuningCents);
    this.model.reset();
    this.frame = 0;
    this.n16 = 0;
    this.envN = 0;
    this.envAcc = 0;
    this.envCnt = 0;
    this.prevS = 0;
    this.frameAcc = 0;
    this.armed.fill(1);
    this.lastFire.fill(-1000);
    this.lastT.fill(-1e9);
    this.offCount.fill(0);
  }

  _trackNoise(rms) {
    if (this.calibrating) this.calibrating.rms.push(rms);
    // minimum statistics over ~2.5 s (5 x 0.5 s), bias-corrected
    if (rms < this.floorMin) this.floorMin = rms;
    if (++this.floorCnt >= 50) {
      this.floorWin.push(this.floorMin);
      if (this.floorWin.length > 5) this.floorWin.shift();
      this.floorMin = Infinity;
      this.floorCnt = 0;
      this.floor = Math.min(...this.floorWin) * 1.5;
    }
  }

  // time (input clock, s) of 16 kHz sample j
  _time(j) {
    return this.rs.inPosOf(j) / this.sr;
  }

  _threshold(midi, expected) {
    const D = this.dec;
    const r = regOf(midi);
    let th = expected ? (D.thrExpReg ? D.thrExpReg[r] : D.thrExp) + 0.2 * D.thrStrict * (this.strictness - 0.5) : (D.thrReg ? D.thrReg[r] : D.thr) + D.thrStrict * 2 * (this.strictness - 0.5);
    if (!expected && this.range && (midi < this.range[0] - 5 || midi > this.range[1] + 5)) th += D.thrOut;
    th /= Math.sqrt(this.sensitivity || 1);
    return clamp(th, 0.05, 0.97);
  }

  _calib(p) {
    const c = this.dec.calib;
    for (let i = 1; i < c.length; i++)
      if (p <= c[i][0]) {
        const [x0, y0] = c[i - 1],
          [x1, y1] = c[i];
        return y0 + ((y1 - y0) * (p - x0)) / Math.max(1e-9, x1 - x0);
      }
    return c[c.length - 1][1];
  }

  // Attack refinement: the 2 ms block with the steepest high-band energy rise within +-20 ms of
  // the network's estimate (16 kHz sample index), not after `end`.
  _refine(est, end) {
    const blk = this.blk;
    const w = Math.round((this.dec.refine * NSR) / blk);
    const b0 = Math.floor(est / blk);
    const last = Math.min(this.envN - 1, Math.floor(end / blk) - 1);
    let best = -1,
      bestR = 0;
    for (let b = Math.max(b0 - w, this.envN - 250, 3); b <= Math.min(b0 + w, last); b++) {
      const prev = (this.env[(b - 1) & 255] + this.env[(b - 2) & 255] + this.env[(b - 3) & 255]) / 3 + 1e-12;
      const r = this.env[b & 255] / prev;
      if (r > bestR) {
        bestR = r;
        best = b;
      }
    }
    this._rise = bestR; // how clearly the high band jumped: a struck string's hammer does
    return best >= 0 && bestR > 2.5 ? best * blk : est;
  }

  // Follow the piano's overall tuning (old pianos are often flat; the network was trained for
  // +-30 cents): ~110 ms after a confident mid-range note, find its low partials in the long
  // window, and once 8 notes agree, re-centre the log-frequency bins on the piano.
  _measureTuning() {
    const mag = this.fe.mags[0]; // long-window magnitudes of the frame just computed
    const binHz = NSR / 2048;
    for (const q of this.tunePending) {
      if (q.frame !== this.frame) continue;
      const f0 = 440 * Math.pow(2, (q.midi - 69 + this.tuningCents / 100) / 12);
      let best = null;
      for (let h = 1; h <= 3; h++) {
        const fh = h * f0;
        if (fh < 180 || fh > 2500) continue;
        const c = fh / binHz;
        const lo = Math.max(2, Math.floor(c * 0.97)),
          hi = Math.min(mag.length - 3, Math.ceil(c * 1.03));
        let k = lo;
        for (let j = lo; j <= hi; j++) if (mag[j] > mag[k]) k = j;
        if (k === lo || k === hi || mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
        const a = Math.log(mag[k - 1] + 1e-12),
          b = Math.log(mag[k] + 1e-12),
          g = Math.log(mag[k + 1] + 1e-12);
        const den = a - 2 * b + g;
        const off = den < 0 ? clamp((0.5 * (a - g)) / den, -0.5, 0.5) : 0;
        const cents = 1200 * Math.log2(((k + off) * binHz) / fh);
        if (!best || mag[k] > best.m) best = { m: mag[k], cents };
      }
      if (best && Math.abs(best.cents) < 60) this.tuneSamples.push(best.cents);
    }
    this.tunePending = this.tunePending.filter((q) => q.frame > this.frame);
    if (this.tuneSamples.length >= 8) {
      const s = [...this.tuneSamples].sort((x, y) => x - y);
      this.tuneSamples = [];
      const med = s[s.length >> 1],
        spread = s[6] - s[1];
      if (Math.abs(med) > 10 && spread < 20) {
        this.tuningCents = clamp(this.tuningCents + 0.8 * med, -80, 80);
        this.fe.setTuning(this.tuningCents);
      }
    }
  }

  _ghost(k, t) {
    for (const iv of GHOST_IV) {
      const j = k - iv;
      if (j >= 0 && Math.abs(this.lastT[j] - t) <= 0.035) return true;
    }
    return false;
  }

  _frame(f, end) {
    const out = this.model.step(f);
    this.frame++;
    if (this.tunePending.length) this._measureTuning();
    if (this.frame < this.dec.warm) return;
    const KO = this.KO,
      D = this.dec;
    const tNow = this._time(end);
    for (let k = 0; k < 88; k++) {
      const midi = k + MIDI_MIN;
      const K = this.Kk[k];
      const p = sigmoid(out[k * KO]);
      const pf = sigmoid(out[k * KO + 1]);
      const expected = this.expected.has(midi);
      const th = this._threshold(midi, expected);
      if (!this.armed[k] && p < th * D.rearm) this.armed[k] = 1;
      this.above[k] = p >= th ? Math.min(255, this.above[k] + 1) : 0;
      if (this.armed[k] && this.above[k] >= (expected ? 1 : D.confirm) && this.frame - this.lastFire[k] >= D.refractory) {
        // which of the last K frames the attack was in
        let a = 0,
          am = -Infinity;
        for (let j = 0; j < K; j++)
          if (out[k * KO + 2 + j] > am) {
            am = out[k * KO + 2 + j];
            a = j;
          }
        const est = end - a * HOP - HOP / 2;
        const s = this._refine(est, end);
        if (!expected && D.gateRise > 0 && this._rise < D.gateRise) {
          // no attack in the signal around the network's estimate: not a newly struck string
          this.armed[k] = 0;
          this.lastFire[k] = this.frame;
          this.stats.rejected++;
          continue;
        }
        const t = this._time(s);
        if (!expected && p < D.ghostP && this._ghost(k, t)) {
          // a partial of a note struck at the same moment an octave / twelfth / ... below
          this.armed[k] = 0;
          this.lastFire[k] = this.frame;
          this.stats.rejected++;
          continue;
        }
        if (t - this.lastT[k] < D.minGap) {
          // the same attack again (the probability dipped and rose inside its window)
          this.armed[k] = 0;
          this.lastFire[k] = this.frame;
          continue;
        }
        this.lastT[k] = t;
        let conf = this._calib(p);
        if (expected) conf = sigmoid(Math.log(conf / Math.max(1e-6, 1 - conf)) + D.expectedBonus);
        const restrike = !!this.on[k];
        this.armed[k] = 0;
        this.lastFire[k] = this.frame;
        this.on[k] = 1;
        this.offCount[k] = 0;
        if (restrike) this.stats.restrikes++;
        else this.stats.emitted++;
        if (t - this.lastOnsetT > 0.03) {
          this.lastOnsetT = t;
          this.onOnset(t, p);
        }
        const level = 20 * Math.log10(this.frameRms + 1e-10);
        if (conf >= 0.75) {
          this.levels.push(level);
          if (this.levels.length > 12) this.levels.shift();
          const sorted = [...this.levels].sort((x, y) => x - y);
          this.pianoLevelBase = sorted[Math.floor(sorted.length * 0.75)];
          this.pianoLevelT = tNow;
        }
        const vel = clamp((level + 60) / 45, 0.05, 1);
        if (this.autoTune && conf >= 0.8 && midi >= 45 && midi <= 84 && this.tunePending.length < 16) this.tunePending.push({ midi, frame: this.frame + 11 });
        this.onNoteOn(midi, t, vel, { confidence: conf, restrike, p, expected });
      } else if (this.armed[k] && p >= th * 0.6 && p < th && this.frame - this.lastFire[k] >= D.refractory) {
        // a near miss (counted once per attack window)
        if (!this._near) this._near = new Int32Array(88).fill(-1000);
        if (this.frame - this._near[k] > K) this.stats.rejected++;
        this._near[k] = this.frame;
      }
      if (this.on[k]) {
        if (pf < D.offThr && this.frame - this.lastFire[k] > K) {
          if (++this.offCount[k] >= D.offFrames) {
            this.on[k] = 0;
            this.offCount[k] = 0;
            this.onNoteOff(midi, tNow - (D.offFrames * HOP) / NSR);
          }
        } else this.offCount[k] = 0;
      }
    }
  }
}

// Bin of a key's fundamental in the log-frequency spectrum (for tools and tests).
export const keyBin = (midi) => Math.round((midi - MIDI0) * BPS);
export { NB };
