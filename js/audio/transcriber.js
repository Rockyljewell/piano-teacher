// Real-time polyphonic piano transcription.
//
// Pipeline (all in the audio clock domain, times are in seconds of AudioContext time):
//  1. Onset detector: 1024-sample frames, 256 hop, log-compressed spectral flux with adaptive
//     threshold. Gives precise attack times (~5 ms resolution) for rhythm grading.
//  2. Pitch analysis: 8192-sample Hann window (zero padded x2) every `hop` samples.
//     Noise-floor subtraction -> spectral whitening -> harmonic salience for all 88 piano keys
//     (with piano string inharmonicity) -> iterative "pick the strongest note, cancel its
//     partials using spectral smoothness" (after Klapuri 2006) to find every sounding note.
//  3. Note tracking: notes switch on/off with hysteresis; each new note is back-dated to the
//     attack found by the onset detector. Re-struck notes are found by checking which sounding
//     notes gained energy right after a detected attack.
import { FFT, hann } from './fft.js';

export const MIDI_MIN = 21; // A0
export const MIDI_MAX = 108; // C8

const ALPHA = 52;
const BETA = 320;

function inharmonicity(midi) {
  // Rough model of the inharmonicity coefficient B for a grand piano.
  if (midi >= 40) return Math.pow(10, -3.9 + 0.028 * (midi - 40));
  return Math.pow(10, -3.9 - 0.01 * (midi - 40));
}

export class Transcriber {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.win = sampleRate > 60000 ? 16384 : 8192;
    this.nfft = this.win * 2;
    this.hop = opts.hop || (sampleRate > 60000 ? 2048 : 1024);
    this.onsetWin = sampleRate > 60000 ? 2048 : 1024;
    this.onsetHop = this.onsetWin / 4;
    this.a4 = opts.a4 || 440;
    this.sensitivity = opts.sensitivity ?? 1; // >1 = more sensitive
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.onNoteOff = opts.onNoteOff || (() => {});
    this.onOnset = opts.onOnset || (() => {});

    this.ringSize = 1 << 16;
    this.ring = new Float32Array(this.ringSize);
    this.pos = -1; // absolute frame index of next sample to write
    this.nextAnalysisEnd = 0;
    this.nextOnsetStart = 0;

    this.fft = new FFT(this.nfft);
    this.window = hann(this.win);
    this.frame = new Float32Array(this.win);
    this.nBins = this.nfft / 2 + 1;
    this.binHz = this.sr / this.nfft;
    this.maxBin = Math.min(this.nBins - 1, Math.floor(9500 / this.binHz));
    this.mag = new Float64Array(this.nBins);
    this.Y = new Float64Array(this.nBins);
    this.R = new Float64Array(this.nBins);
    this.noise = new Float64Array(this.nBins); // calibrated noise magnitude spectrum
    this.hasNoise = false;

    this.onsetFFT = new FFT(this.onsetWin);
    this.onsetWindow = hann(this.onsetWin);
    this.onsetFrame = new Float32Array(this.onsetWin);
    this.onsetMag = new Float64Array(this.onsetWin / 2 + 1);
    this.prevLog = new Float64Array(this.onsetWin / 2 + 1);
    this.onsetMaxBin = Math.floor((8000 / this.sr) * this.onsetWin);
    this.fluxHist = [];
    this.fluxPrev = [0, 0]; // [flux(t-1), flux(t-2)] for peak picking
    this.fluxPrevTime = 0;
    this.lastOnsetTime = -1;
    this.onsets = []; // recent attack times
    this.noiseFlux = 0;
    this.onsetNoise = new Float64Array(this.onsetWin / 2 + 1).fill(1e-3);

    this.shortWin = sampleRate > 60000 ? 4096 : 2048;
    this.shortFFT = new FFT(this.shortWin * 2);
    this.shortWindow = hann(this.shortWin);
    this.shortFrame = new Float32Array(this.shortWin);
    this.shortMag = new Float64Array(this.shortWin + 1);
    this.shortBinHz = this.sr / (this.shortWin * 2);

    this.tuningCents = 0;
    this.tuneSamples = [];
    this.autoTune = opts.autoTune ?? true;
    this._buildBands();
    this._buildCandidates();

    this.active = new Map(); // midi -> {on, missing, peak, energy}
    this.energyHist = []; // [{t, e: Float64Array(128)}]
    this.pendingRestrike = [];
    this.expected = new Set();
    this.calibrating = null;
    this.frameRms = 0;
    this.noiseRms = 0;
    this.lastSalience = new Float64Array(128);
    this.lastDetected = [];
  }

  setTuning(a4) {
    this.a4 = a4;
    this._buildCandidates();
  }

  // Follow the piano's overall tuning (old pianos are often flat) by measuring where the
  // fundamentals of clearly detected mid-range notes actually are.
  _trackTuning(detected, mag) {
    for (const d of detected) {
      if (d.midi < 48 || d.midi > 84 || d.salience < 1) continue;
      const c = this.cands[d.midi - MIDI_MIN];
      const p = c.partials[0];
      let k = p.lo;
      for (let i = p.lo - 2; i <= p.hi + 2; i++) if (mag[i] > mag[k]) k = i;
      const a = mag[k - 1],
        b = mag[k],
        g = mag[k + 1];
      const den = a - 2 * b + g;
      const off = den !== 0 ? (0.5 * (a - g)) / den : 0;
      const f = (k + off) * this.binHz;
      const cents = 1200 * Math.log2(f / c.f0);
      if (Math.abs(cents) < 45) this.tuneSamples.push(cents);
    }
    if (this.tuneSamples.length >= 24) {
      const sorted = [...this.tuneSamples].sort((x, y) => x - y);
      const med = sorted[sorted.length >> 1];
      this.tuneSamples = [];
      if (Math.abs(med) > 4) {
        this.tuningCents = Math.max(-50, Math.min(50, this.tuningCents + med * 0.8));
        this._buildCandidates();
      }
    }
  }

  setExpected(midis) {
    this.expected = new Set(midis);
  }

  _buildBands() {
    // Log-spaced bands (1/3 octave) for whitening; per-bin triangular interpolation weights.
    const centers = [];
    for (let f = 40; f < 10000; f *= Math.pow(2, 1 / 3)) centers.push(f);
    this.bandCenters = centers.map((f) => f / this.binHz);
    this.bandSigma = new Float64Array(centers.length);
    this.noiseBandSigma = new Float64Array(centers.length);
    this.binGain = new Float64Array(this.nBins);
  }

  _buildCandidates() {
    const ratio = Math.pow(2, this.tuningCents / 1200);
    this.cands = [];
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      const f0 = this.a4 * ratio * Math.pow(2, (m - 69) / 12);
      const B = inharmonicity(m);
      const partials = [];
      for (let h = 1; h <= 30; h++) {
        const f = h * f0 * Math.sqrt(1 + B * h * h);
        if (f > 9000) break;
        const c = f / this.binHz;
        // Search +-1/4 semitone around the expected partial (at least +-1 bin), widened for the
        // uncertainty of the string stiffness (uprights are much more inharmonic than grands).
        const stretch = B * h * h;
        const lo = Math.max(1, Math.min(Math.round(c) - 1, Math.floor(c * (1 - 0.0145 - Math.min(0.008, 0.15 * stretch)))));
        const hi = Math.min(this.maxBin, Math.max(Math.round(c) + 1, Math.ceil(c * (1 + 0.0145 + Math.min(0.015, 0.35 * stretch)))));
        if (lo >= hi) break;
        partials.push({ h, lo, hi, g: (f0 + ALPHA) / (h * f0 + BETA) });
      }
      this.cands.push({ midi: m, f0, partials });
    }
  }

  _shortEnergy(end) {
    const mask = this.ringSize - 1;
    const n = this.shortWin;
    for (let i = 0; i < n; i++) this.shortFrame[i] = this.ring[(end - n + i) & mask] * this.shortWindow[i];
    const mag = this.shortFFT.magnitude(this.shortFrame, this.shortMag);
    const e = new Float64Array(128);
    const maxK = mag.length - 2;
    for (const c of this.cands) {
      let sum = 0,
        cnt = 0;
      for (const p of c.partials) {
        const f = ((p.lo + p.hi) / 2) * this.binHz;
        if (f < 120) continue;
        if (f > 6000 || cnt >= 8) break;
        const k = Math.round(f / this.shortBinHz);
        if (k >= maxK) break;
        const m = Math.max(mag[k - 1], mag[k], mag[k + 1]);
        sum += m * m;
        cnt++;
      }
      e[c.midi] = sum;
    }
    return e;
  }

  // --- calibration ---------------------------------------------------------------------------
  startCalibration() {
    this.calibrating = { n: 0, sum: new Float64Array(this.nBins), flux: [], rms: [] };
  }

  finishCalibration() {
    const c = this.calibrating;
    this.calibrating = null;
    if (!c || c.n < 3) return false;
    for (let k = 0; k < this.nBins; k++) this.noise[k] = c.sum[k] / c.n;
    this.hasNoise = true;
    if (c.onsetN) for (let k = 0; k < this.onsetNoise.length; k++) this.onsetNoise[k] = Math.max(1e-6, (3 * c.onsetSum[k]) / c.onsetN);
    c.flux.sort((a, b) => a - b);
    this.noiseFlux = c.flux.length ? c.flux[Math.floor(c.flux.length * 0.95)] : 0;
    c.rms.sort((a, b) => a - b);
    this.noiseRms = c.rms.length ? c.rms[Math.floor(c.rms.length * 0.9)] : 0;
    return true;
  }

  // --- input ---------------------------------------------------------------------------------
  push(samples, frame0) {
    if (this.pos < 0 || Math.abs(frame0 - this.pos) > this.ringSize / 2) {
      // (Re)start alignment.
      this.pos = frame0;
      this.nextAnalysisEnd = frame0 + this.win;
      this.nextOnsetStart = frame0;
    } else if (frame0 !== this.pos) {
      this.pos = frame0; // small gap or overlap: trust the source timestamp
    }
    const mask = this.ringSize - 1;
    for (let i = 0; i < samples.length; i++) this.ring[(this.pos + i) & mask] = samples[i];
    this.pos += samples.length;

    while (this.nextOnsetStart + this.onsetWin <= this.pos) {
      this._onsetFrame(this.nextOnsetStart);
      this.nextOnsetStart += this.onsetHop;
    }
    while (this.nextAnalysisEnd <= this.pos) {
      if (this.pos - this.nextAnalysisEnd > this.hop * 8) {
        // We fell behind (tab was in background etc.) - skip ahead.
        this.nextAnalysisEnd = this.pos - (this.pos % this.hop);
      }
      this._analyze(this.nextAnalysisEnd);
      this.nextAnalysisEnd += this.hop;
    }
  }

  // --- onset detection -----------------------------------------------------------------------
  _onsetFrame(start) {
    const mask = this.ringSize - 1;
    const n = this.onsetWin;
    for (let i = 0; i < n; i++) this.onsetFrame[i] = this.ring[(start + i) & mask] * this.onsetWindow[i];
    const mag = this.onsetFFT.magnitude(this.onsetFrame, this.onsetMag);
    let flux = 0;
    const nm = this.onsetNoise;
    if (this.calibrating) {
      const c = this.calibrating;
      if (!c.onsetSum) c.onsetSum = new Float64Array(mag.length);
      for (let k = 0; k < mag.length; k++) c.onsetSum[k] += mag[k];
      c.onsetN = (c.onsetN || 0) + 1;
    }
    for (let k = 2; k <= this.onsetMaxBin; k++) {
      // Bins at or below the room-noise level contribute ~nothing.
      const l = Math.log1p(mag[k] / nm[k]);
      const d = l - this.prevLog[k];
      if (d > 0) flux += d;
      this.prevLog[k] = l;
    }
    flux /= this.onsetMaxBin;
    const t = (start + n / 2) / this.sr;

    if (this.calibrating) this.calibrating.flux.push(flux);

    // Peak picking on previous value: prev > both neighbours and above adaptive threshold.
    const [p1, p2] = this.fluxPrev;
    const hist = this.fluxHist;
    let mean = 0;
    for (const v of hist) mean += v;
    mean = hist.length ? mean / hist.length : 0;
    const thresh = Math.max(mean * 1.5 + 0.04, 0.1) / Math.sqrt(this.sensitivity);
    if (p1 > p2 && p1 >= flux && p1 > thresh) {
      const ot = this.fluxPrevTime;
      if (ot - this.lastOnsetTime > 0.045) {
        this.lastOnsetTime = ot;
        const o = { t: ot, strength: p1, thresh };
        this.onsets.push(o);
        if (this.onsets.length > 32) this.onsets.shift();
        this.pendingRestrike.push(o);
        this.onOnset(ot, p1);
      }
    }
    this.fluxPrev = [flux, p1];
    this.fluxPrevTime = t;
    hist.push(flux);
    if (hist.length > 24) hist.shift();
  }

  // --- pitch analysis ------------------------------------------------------------------------
  _analyze(end) {
    const mask = this.ringSize - 1;
    const n = this.win;
    const start = end - n;
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const s = this.ring[(start + i) & mask];
      rms += s * s;
      this.frame[i] = s * this.window[i];
    }
    rms = Math.sqrt(rms / n);
    this.frameRms = rms;
    const t = end / this.sr;
    const mag = this.fft.magnitude(this.frame, this.mag);

    if (this.calibrating) {
      const c = this.calibrating;
      for (let k = 0; k < this.nBins; k++) c.sum[k] += mag[k];
      c.n++;
      c.rms.push(rms);
    }

    // 1) noise subtraction
    const Y = this.Y;
    const maxBin = this.maxBin;
    const nf = this.hasNoise ? 2.0 : 0;
    for (let k = 0; k <= maxBin; k++) {
      const v = mag[k] - nf * this.noise[k];
      Y[k] = v > 0 ? v : 0;
    }
    for (let k = 0; k < 3; k++) Y[k] = 0;

    // 2) spectral whitening: divide by band energy^(1-nu)
    const nb = this.bandCenters.length;
    const sig = this.bandSigma;
    let maxSig = 0;
    for (let b = 0; b < nb; b++) {
      const c = this.bandCenters[b];
      const lo = b > 0 ? this.bandCenters[b - 1] : c / 1.26;
      const hi = b < nb - 1 ? this.bandCenters[b + 1] : c * 1.26;
      let s = 0,
        w = 0;
      for (let k = Math.max(1, Math.floor(lo)); k <= Math.min(maxBin, Math.ceil(hi)); k++) {
        const tri = k < c ? (k - lo) / (c - lo) : (hi - k) / (hi - c);
        if (tri <= 0) continue;
        s += tri * Y[k] * Y[k];
        w += tri;
      }
      sig[b] = w > 0 ? Math.sqrt(s / w) : 0;
      if (sig[b] > maxSig) maxSig = sig[b];
    }
    const floor = maxSig * 0.01 + 1e-9;
    const nu = 0.33;
    let b = 0;
    for (let k = 0; k <= maxBin; k++) {
      while (b < nb - 2 && this.bandCenters[b + 1] < k) b++;
      const c0 = this.bandCenters[b],
        c1 = this.bandCenters[b + 1];
      let s;
      if (k <= c0) s = sig[b];
      else if (k >= c1) s = sig[b + 1];
      else s = sig[b] + ((sig[b + 1] - sig[b]) * (k - c0)) / (c1 - c0);
      Y[k] *= Math.pow(Math.max(s, floor), nu - 1);
    }
    // Normalise so the strongest whitened partial is 1: thresholds become independent of mic gain.
    let ymax = 0;
    for (let k = 3; k <= maxBin; k++) if (Y[k] > ymax) ymax = Y[k];
    if (ymax > 0) for (let k = 0; k <= maxBin; k++) Y[k] /= ymax;

    // Loudness gate: whitening makes everything "loud", so gate on raw level.
    const gate = this.hasNoise ? Math.max(this.noiseRms * 1.6, 1e-4) : 2e-4;
    const silent = rms < gate / this.sensitivity;

    // Per-note energy from a short (~43 ms) window, used to spot re-struck notes.
    const energy = this._shortEnergy(end);
    this.energyHist.push({ t, e: energy });
    if (this.energyHist.length > 40) this.energyHist.shift();

    const detected = silent || this.calibrating ? [] : this._iterativeDetect(Y);
    this.lastDetected = detected;
    if (this.autoTune) this._trackTuning(detected, mag);
    this._track(detected, t, energy);
  }

  _salience(c, S, out) {
    let s = 0,
      support = 0;
    const P = c.partials;
    const K = Math.min(P.length, 8);
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      let m = 0,
        mk = p.lo;
      for (let k = p.lo; k <= p.hi; k++)
        if (S[k] > m) {
          m = S[k];
          mk = k;
        }
      if (out) {
        out.amp[i] = m;
        out.bin[i] = mk;
      }
      s += p.g * m;
      if (i < K && m > 0.05) support++;
    }
    // Penalise candidates whose low partials are mostly missing (sub-octave / "virtual pitch"
    // candidates that live off other notes' partials).
    const sup = K > 0 ? support / K : 0;
    return s * sup * sup;
  }

  _iterativeDetect(Y) {
    const R = this.R;
    R.set(Y);
    const found = [];
    const sal = this.lastSalience;
    sal.fill(0);
    const baseT = 0.55 / this.sensitivity;
    let first = 0;
    const tmp = { amp: new Float64Array(32), bin: new Int32Array(32) };
    for (let iter = 0; iter < 10; iter++) {
      let best = null,
        bestScore = 0,
        bestSal = 0;
      for (const c of this.cands) {
        if (found.some((f) => f.midi === c.midi)) continue;
        const s = this._salience(c, R, null);
        if (iter === 0) sal[c.midi] = s;
        let thr = baseT;
        if (this.expected.has(c.midi)) thr *= 0.7;
        if (this.active.has(c.midi)) thr *= 0.75;
        const score = s / thr;
        if (score > bestScore) {
          bestScore = score;
          best = c;
          bestSal = s;
        }
      }
      if (!best || bestScore < 1) break;
      if (iter === 0) first = bestSal;
      if (iter > 0 && bestSal < first * (this.expected.has(best.midi) ? 0.1 : 0.25)) {
        // Too weak relative to the loudest note to be trusted - but keep scanning for expected
        // notes, which only need to clear a lower bar.
        if (![...this.expected].some((m) => !found.some((f) => f.midi === m))) break;
        found.push({ midi: best.midi, salience: bestSal, weak: true });
      } else found.push({ midi: best.midi, salience: bestSal });
      // Cancel partials of the detected note, keeping energy that its smooth spectral envelope
      // cannot explain (it may belong to another note sharing that partial).
      this._salience(best, R, tmp);
      const np = best.partials.length;
      for (let i = 0; i < np; i++) {
        const a = tmp.amp[i];
        if (a <= 0) continue;
        let sm = 0,
          cnt = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(np - 1, i + 2); j++) {
          sm += tmp.amp[j];
          cnt++;
        }
        sm /= cnt;
        const keep = a > sm * 1.15 ? 1 - (sm * 1.15) / a : 0;
        const k0 = tmp.bin[i];
        for (let k = Math.max(0, k0 - 4); k <= Math.min(this.maxBin, k0 + 4); k++) R[k] *= keep;
      }
    }
    return this._prune(found.filter((f) => !f.weak || this.expected.has(f.midi)));
  }

  // Remove typical ghost detections: semitone neighbours of loud bass notes (whose partials are
  // hard to tell apart) and weak notes one octave above a detected note.
  _prune(found) {
    return found.filter((f) => {
      if (this.expected.has(f.midi) || this.active.has(f.midi)) return true;
      for (const g of found) {
        if (g === f) continue;
        const d = f.midi - g.midi;
        if (f.midi < 50 && Math.abs(d) <= 2 && f.salience < g.salience * 0.9) return false;
        if (d === 12 && f.salience < g.salience * 0.5) return false;
      }
      return true;
    });
  }

  _track(detected, t, energy) {
    const on = new Set(detected.map((d) => d.midi));
    const halfWin = this.win / 2 / this.sr;

    // Resolve re-strike checks whose attack is far enough in the past.
    const settle = 0.13;
    const ready = this.pendingRestrike.filter((o) => t - o.t >= settle);
    this.pendingRestrike = this.pendingRestrike.filter((o) => t - o.t < settle);

    // Frames whose window ends shortly after an attack see a smeared, noisy spectrum: only let
    // them sustain notes, never start new ones.
    const inTransient = t - this.lastOnsetTime < 0.07;
    for (const d of detected) {
      const st = this.active.get(d.midi);
      if (!st) {
        if (inTransient) continue;
        // Every new piano note starts with a hammer strike; without a recent attack this is a
        // ghost (e.g. from a decaying note's tail).
        const attack = this._attackFor(d.midi, t);
        if (!attack) continue;
        const pend = this._pending || (this._pending = new Map());
        const p = pend.get(d.midi) || { n: 0 };
        p.n++;
        p.sal = Math.max(p.sal || 0, d.salience);
        pend.set(d.midi, p);
        if (p.n >= 2) {
          pend.delete(d.midi);
          const onsetT = attack.t;
          this.active.set(d.midi, { on: onsetT, missing: 0, sal: d.salience, lastStrike: onsetT });
          this.onNoteOn(d.midi, onsetT, Math.min(1, d.salience / 3));
        }
      } else {
        st.missing = 0;
        st.sal = d.salience;
      }
    }
    if (this._pending) for (const m of [...this._pending.keys()]) if (!on.has(m)) this._pending.delete(m);

    // Re-strikes. For every attack, once things have settled:
    //  - sounding notes whose short-window energy jumped are re-struck;
    //  - an attack that started no new note ("orphan") must have re-struck something that is
    //    sounding: pick the note(s) that gained the most energy (expected notes first).
    for (const o of ready) {
      const ot = o.t;
      const before = this._energyAt(ot - 0.002);
      if (!before) continue;
      const after = new Float64Array(128);
      for (const h of this.energyHist)
        if (h.t >= ot + 0.04 && h.t <= ot + 0.1) for (let m = MIDI_MIN; m <= MIDI_MAX; m++) after[m] = Math.max(after[m], h.e[m]);
      const fresh = [...this.active].filter(([, st]) => Math.abs(st.on - ot) < 0.001).map(([m]) => m);
      const cands = [];
      for (const [midi, st] of this.active) {
        if (!on.has(midi) || fresh.includes(midi)) continue;
        if (ot - st.lastStrike < 0.1) continue;
        // Notes that just started at this attack explain energy gains at their own partials.
        if (fresh.some((f) => Math.abs(f - midi) <= 2 || [12, 19, 24, 28, 31, 36].includes(f - midi))) continue;
        cands.push({ midi, st, ratio: after[midi] / (before[midi] + 1e-12) });
      }
      let hits = cands.filter((c) => c.ratio > (this.expected.has(c.midi) ? 1.6 : 2.5) / Math.sqrt(this.sensitivity));
      if (!hits.length && !fresh.length && cands.length && o.strength > o.thresh * 1.3) {
        const exp = cands.filter((c) => this.expected.has(c.midi) && c.ratio > 0.5);
        if (exp.length) hits = exp;
        else {
          // Only trust an unambiguous choice (with the pedal down many notes ring at once).
          const sorted = [...cands].sort((a, b) => b.ratio - a.ratio);
          if (sorted[0].ratio > 0.2 && (sorted.length === 1 || sorted[0].ratio > sorted[1].ratio * 1.5)) hits = [sorted[0]];
        }
      }
      for (const c of hits) {
        c.st.lastStrike = ot;
        this.onNoteOn(c.midi, ot, Math.min(1, c.st.sal / 3));
      }
    }

    for (const [midi, st] of [...this.active]) {
      if (on.has(midi)) continue;
      st.missing++;
      if (st.missing >= 3) {
        this.active.delete(midi);
        this.onNoteOff(midi, t - halfWin);
      }
    }
  }

  _energyAt(time) {
    // Latest short-window energy frame ending at or before `time`.
    let best = null;
    for (const h of this.energyHist) if (h.t <= time) best = h;
    return best && best.e;
  }

  // The attack that started `midi`: the most recent one inside the analysis window, or - for a
  // note that only became detectable late - an older one after which its energy clearly grew.
  _attackFor(midi, t) {
    const span = this.win / this.sr + 0.02;
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const o = this.onsets[i];
      if (o.t > t - 0.005) continue;
      if (o.t >= t - span) return o;
      if (o.t < t - 0.4) return null;
      const before = this._energyAt(o.t - 0.002);
      let after = 0;
      for (const h of this.energyHist) if (h.t >= o.t + 0.03 && h.t <= o.t + 0.1) after = Math.max(after, h.e[midi]);
      return before && after > 2 * before[midi] ? o : null;
    }
    return null;
  }


  reset() {
    for (const [midi] of this.active) this.onNoteOff(midi, this.pos / this.sr);
    this.active.clear();
    this.pendingRestrike = [];
    this.onsets = [];
  }
}
