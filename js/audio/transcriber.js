// Real-time polyphonic piano transcription, hardened against room noise.
//
// Pipeline (all in the audio clock domain, times are in seconds of AudioContext time):
//  1. Onset detector: 1024-sample frames, 256 hop, log-compressed spectral flux with adaptive
//     threshold. Gives precise attack times (~5 ms resolution) for rhythm grading.
//  2. Noise floor: per-bin minimum statistics over ~2.5 s (frozen under sounding notes), so fans,
//     hum and traffic are tracked continuously - start-up calibration is only the first guess.
//  3. Pitch analysis: 8192-sample Hann window (zero padded x2) every `hop` samples.
//     Noise-floor subtraction -> spectral whitening -> harmonic salience for all 88 keys using a
//     piano model (string inharmonicity, stretch tuning, register-dependent spectral envelope)
//     -> iterative "pick the strongest note, cancel its partials using spectral smoothness"
//     (after Klapuri 2006) to find every sounding note.
//  4. Note hypotheses: a candidate note must be explained by an attack and is then watched for a
//     few frames. Evidence that it is a piano string and not the room is combined into a
//     confidence (0..1): partials are sharp stable sinusoids (voices glide and wobble), at the
//     piano's pitch, rising together at the attack and then only decaying (voices and pads
//     swell, claps/taps/footsteps vanish within tens of ms), loud enough relative to the noise
//     floor and to how loud the piano has been played. Clearly piano-like notes are reported at
//     once; doubtful ones only after ~0.2 s of evidence, or never. Expected notes (setExpected)
//     need less evidence than unexpected ones.
//  5. Note tracking: notes switch off with hysteresis; each new note is back-dated to its attack.
//     Re-struck notes are found by checking which sounding notes gained harmonic (not broadband)
//     energy right after an attack and kept it.
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

// Typical stretch tuning of an aurally tuned piano (Railsback curve), in cents re. equal
// temperament: the bass is tuned flat and the treble sharp.
export function stretchCents(midi) {
  if (midi < 48) return -(48 - midi) * 0.8;
  if (midi > 60) return ((midi - 60) / 48) ** 2 * 40;
  return 0;
}

// Expected relative amplitude of partial h of a piano note: roughly h^-0.5 below ~2 kHz and
// falling 12 dB/octave above (treble notes are almost pure sines); bass fundamentals are weak.
function partialWeight(h, f0) {
  const f = h * f0;
  let w = Math.pow(h, -0.5) / (1 + (f / 2200) ** 2);
  if (h === 1 && f0 < 110) w *= Math.max(0.15, (f0 - 20) / 90);
  return w;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Confidence model: a tiny MLP (tanh hidden layer) over the candidate features computed in
// _confidence(), fitted offline on real piano samples (Salamander grand) and the additive synth,
// clean and mixed with room noise, vs. noise-only recordings/simulations (tests/noise-fit.js).
export const CONF_MODEL = {
  keys: ['sal', 'tonal', 'tonalHi', 'dev', 'drift', 'driftMax', 'rise', 'riseMed', 'harm', 'swell', 'sustain', 'slope', 'span', 'attackFrac', 'peakAge', 'snr', 'rel', 'age', 'nsig', 'vib', 'rough'],
  W1: [
    [0.139, 0.353, 0.195, -1.731, -1.247, 0.071, -0.249, 0.222, -0.989, 0.106, -0.464, -0.729, 0.692, 0.409, -0.082, 0.01, 0.925, -0.019, -0.321, 0.252, -0.515],
    [-0.364, 0.116, -0.743, 0.117, -0.104, 0.39, 0.602, 0.289, -0.197, 0.183, 0.417, 0.622, 1.694, 0.43, 0.462, -0.199, -0.108, -0.596, -0.215, 0.128, -0.232],
    [-0.894, -0.018, 0.327, -0.06, 0.133, 0.159, 0.118, 0.385, -0.541, -1.197, 0.01, 0.085, -0.067, 0.96, 0.239, -0.038, 1.675, -0.027, 0.777, 0.15, -0.345],
    [0.037, -0.617, 1.187, 0.022, 0.021, 0.109, -0.213, -0.145, -0.322, -0.157, 0.159, 0.232, 0.217, 0.186, -0.147, 0.068, 0.371, -0.348, 1.845, 0.198, -0.4],
    [-0.344, 0.2, 0.276, 0.148, -0.449, -0.124, -0.184, 0.3, -0.627, 0.066, 0.748, -0.502, -0.301, 0.04, -0.147, 0.284, 0.36, -0.226, -1.96, -0.086, 0.096],
    [-1.718, 0.306, -0.775, 0.395, -0.098, 0.215, 0.152, -0.196, -0.808, 0.658, 0.38, 0.122, 0.79, -0.574, 0.4, -0.205, 0.754, 0.662, 1.531, 0.006, 0.066],
    [-0.123, -0.843, -1.785, 0.559, -0.062, 0.072, -0.169, -0.059, -0.51, -0.244, -0.475, 0.037, 0.929, 0.093, 0.311, 0.132, -0.047, 0.723, -0.949, 0.121, 0.046],
    [0.966, 1.41, -0.876, 0.546, 0.674, 0.071, -0.731, 0.084, 0.395, -0.489, 0.615, -0.063, -0.653, -0.523, 0.296, 0.121, -0.061, -0.308, -0.86, 0.549, 1.954],
    [-0.667, 0.761, -0.079, 0.275, 0.156, -0.287, 1.034, 0.568, 0.91, 0.732, 1.115, 0.11, 0.257, -0.297, 0.042, 0.025, 0.195, -0.484, 0.52, 0.142, -0.573],
    [0.887, 0.317, -0.354, -0.031, -0.009, 0.084, 0.187, 0.097, -0.184, 0.451, -2.61, -0.94, -1.489, -0.025, 0.175, -0.065, 0.149, -0.571, -0.549, 0.103, -0.193],
    [0.695, -0.876, -0.284, -0.133, -0.165, 0.305, 0.104, 0.188, -0.14, 0.781, -1.058, -0.086, 0.551, -0.343, 0.053, -0.004, 2.22, 0.083, -0.16, -0.394, -0.082],
    [0.928, 0.407, -0.106, 1.361, 0.93, 0.018, -0.9, -0.067, -0.079, -0.145, -0.473, -0.283, 0.109, -0.675, 0.182, -0.055, -0.128, -0.73, -0.426, 0.219, 1.74],
  ],
  b1: [-0.266, -0.709, -1.186, 0.549, 2.229, 0.692, -1.158, 0.33, 0.741, -0.934, 0.539, -0.465],
  w2: [1.613, -1.71, 2.284, -3.579, -3.109, -2.322, -2.137, 2.29, 1.704, -2.304, 2.092, -1.755],
  b2: -3.256,
  expected: 1, // logit bonus for notes the score says are due
};

// Model output (logit). Either linear ({bias, <feature>: weight}) or a one-hidden-layer MLP
// ({keys, W1, b1, w2, b2}, tanh units).
function evalModel(M, x) {
  if (M.W1) {
    const K = M.keys;
    let z = M.b2;
    for (let j = 0; j < M.b1.length; j++) {
      const w = M.W1[j];
      let a = M.b1[j];
      for (let i = 0; i < K.length; i++) a += w[i] * (x[K[i]] || 0);
      z += M.w2[j] * Math.tanh(a);
    }
    return z;
  }
  let z = M.bias;
  for (const k in x) z += (M[k] || 0) * x[k];
  return z;
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
    // 0 = trust everything that looks like a note, 1 = only clear piano notes (noisy rooms).
    this._baseStrictness = clamp(opts.strictness ?? 0.5, 0, 1);
    this.noisyRoom = !!opts.noisyRoom;
    this.strictness = this.noisyRoom ? Math.max(this._baseStrictness, 0.85) : this._baseStrictness;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.onNoteOff = opts.onNoteOff || (() => {});
    this.onOnset = opts.onOnset || (() => {});
    this.onCandidate = opts.onCandidate || null; // debug / analysis hook
    this.collect = !!opts.collect; // analysis: report every evaluation, decide only at the end
    this.model = opts.model || CONF_MODEL;

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
    this.magScale = 4 / this.win; // magnitude -> sinusoid amplitude
    this.noise = new Float64Array(this.nBins); // calibrated noise magnitude spectrum
    this.hasNoise = false;

    // adaptive noise floor (minimum statistics)
    const hopSec = this.hop / this.sr;
    this.floorSub = Math.max(4, Math.round(0.5 / hopSec)); // frames per sub-window
    this.floorSubs = 5; // sub-windows (-> ~2.5 s)
    this.floorCur = new Float64Array(this.maxBin + 1).fill(Infinity);
    this.floorSm = new Float64Array(this.maxBin + 1);
    this.floorRing = [];
    this.floorFrames = 0;
    this.floor = new Float64Array(this.nBins); // estimated mean noise magnitude
    this.floorWarm = false;
    this.busy = new Int32Array(this.maxBin + 1).fill(-1000);
    this.busyHold = Math.round(0.5 / hopSec); // frames a bin stays excluded after a note
    this.nEff = new Float64Array(this.nBins); // noise used for subtraction
    this.frameNo = 0;

    this.onsetFFT = new FFT(this.onsetWin);
    this.onsetWindow = hann(this.onsetWin);
    this.onsetFrame = new Float32Array(this.onsetWin);
    this.onsetMag = new Float64Array(this.onsetWin / 2 + 1);
    this.prevLog = new Float64Array(this.onsetWin / 2 + 1);
    this.curLog = new Float64Array(this.onsetWin / 2 + 1);
    this.onsetMaxBin = Math.floor((8000 / this.sr) * this.onsetWin);
    this.fluxHist = [];
    this.fluxPrev = [0, 0]; // [flux(t-1), flux(t-2)] for peak picking
    this.fluxPrevTime = 0;
    this.lastOnsetTime = -1;
    this.onsets = []; // recent attack times
    this.weakPeaks = []; // recent sub-threshold flux peaks
    this.onsetFloor = opts.onsetFloor ?? 0.05; // absolute minimum flux of an attack
    this.noiseFlux = 0;
    this.onsetNoise = new Float64Array(this.onsetWin / 2 + 1).fill(1e-3);
    this.onsetFloorMin = new Float64Array(this.onsetWin / 2 + 1).fill(Infinity);
    this.onsetFloorN = 0;

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

    this.active = new Map(); // midi -> {on, missing, sal, lastStrike, conf}
    this.energyHist = []; // [{t, e: Float64Array(128), o: Float64Array(128)}]
    this.pendingRestrike = [];
    this.pending = new Map(); // midi -> note hypothesis
    this.rejected = new Map(); // midi -> attack time already rejected
    this.emittedAt = new Map(); // midi -> attack time of the last emitted note-on
    this.expected = new Set();
    this.range = null;
    this.calibrating = null;
    this.frameRms = 0;
    this.noiseRms = 0;
    this.lastSalience = new Float64Array(128);
    this.lastDetected = [];
    this.pianoLevelBase = null; // dBFS of recent confident notes
    this.pianoLevelT = 0;
    this.levels = [];
    this.stats = { emitted: 0, rejected: 0, restrikes: 0 };
    this._tmp = { amp: new Float64Array(40), bin: new Int32Array(40) };
  }

  setTuning(a4) {
    this.a4 = a4;
    this._buildCandidates();
  }

  setStrictness(v) {
    this._baseStrictness = clamp(Number(v) || 0, 0, 1);
    this.strictness = this.noisyRoom ? Math.max(this._baseStrictness, 0.85) : this._baseStrictness;
  }

  // "Noisy room" mode: at least strictness 0.85 while on.
  setNoisyRoom(on) {
    this.noisyRoom = !!on;
    this.setStrictness(this._baseStrictness);
  }

  // Expected notes (score-informed prior): they need less evidence. Optional `range` [lo, hi]
  // (MIDI) of the piece: unexpected notes far outside it need more evidence.
  setExpected(midis, range) {
    this.expected = new Set(midis);
    if (range !== undefined) this.range = range;
  }

  setRange(lo, hi) {
    this.range = lo == null ? null : [lo, hi];
  }

  // How loud the piano has recently been played (dBFS of a note's partials), or null. Slowly
  // forgets during pauses (0.3 dB/s).
  get pianoLevel() {
    if (this.pianoLevelBase == null) return null;
    return this.pianoLevelBase - 0.3 * Math.max(0, this.pos / this.sr - this.pianoLevelT);
  }

  // Approximate level (dBFS RMS) of the room noise between 60 Hz and 5 kHz, from the tracked
  // noise floor - e.g. for a "your room is noisy" hint.
  get noiseLevel() {
    const n = this.floorWarm ? this.floor : this.nEff;
    let s = 0;
    const k0 = Math.ceil(60 / this.binHz),
      k1 = Math.floor(5000 / this.binHz);
    for (let k = k0; k <= k1; k++) s += n[k] * n[k];
    // Parseval with a Hann window (sum w^2 = 0.375 N) over a 2x zero-padded half spectrum
    return 10 * Math.log10((2 * s) / (0.375 * this.win * this.win) + 1e-20);
  }

  // Follow the piano's overall tuning (old pianos are often flat) by measuring where the
  // partials of clearly sinusoidal (string-like) mid-range note hypotheses actually are -
  // confirmed or not, so a piano that is far out of tune can still be learnt.
  _trackTuning(p) {
    const r = p.raw;
    if (!r || p.midi < 40 || p.midi > 90 || p.feats.length < 3 || r.tonal < 24 || Math.abs(r.dev) > 45) return;
    this.tuneSamples.push(r.dev);
    // first estimate quickly (an old upright can be a quarter tone flat), then refine slowly
    if (this.tuneSamples.length >= (this.tuneUpdates ? 12 : 4)) {
      const sorted = [...this.tuneSamples].sort((x, y) => x - y);
      const med = sorted[sorted.length >> 1];
      const spread = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
      this.tuneSamples = [];
      if (!this.tuneUpdates && spread > 15) return; // inconsistent (noise?): wait for more
      this.tuneUpdates = (this.tuneUpdates || 0) + 1;
      if (Math.abs(med) > 4) {
        this.tuningCents = Math.max(-60, Math.min(60, this.tuningCents + med * 0.8));
        this._buildCandidates();
      }
    }
  }

  _buildBands() {
    // Log-spaced bands (1/3 octave) for whitening; per-bin triangular interpolation weights.
    const centers = [];
    for (let f = 40; f < 10000; f *= Math.pow(2, 1 / 3)) centers.push(f);
    this.bandCenters = centers.map((f) => f / this.binHz);
    this.bandSigma = new Float64Array(centers.length);
  }

  _buildCandidates() {
    this.cands = [];
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      // Pianos are usually stretch-tuned but by how much varies: expect each note anywhere
      // between equal temperament and the typical stretch (plus the tracked overall tuning).
      const st = stretchCents(m);
      const ratio = Math.pow(2, (this.tuningCents + st) / 1200);
      const f0 = this.a4 * ratio * Math.pow(2, (m - 69) / 12);
      const etRatio = Math.pow(2, -st / 1200); // stretched -> unstretched
      const B = inharmonicity(m);
      const partials = [];
      let eSum = 0;
      for (let h = 1; h <= 30; h++) {
        const f = h * f0 * Math.sqrt(1 + B * h * h);
        if (f > 9000) break;
        const c = f / this.binHz;
        const cLo = Math.min(c, c * etRatio),
          cHi = Math.max(c, c * etRatio);
        // Search +-1/4 semitone around the expected partial (at least +-1 bin), widened for the
        // uncertainty of the string stiffness (uprights are much more inharmonic than grands).
        const stretch = B * h * h;
        const tol = 0.0145 + (m < 30 || m > 96 ? 0.004 : 0);
        const lo = Math.max(1, Math.min(Math.round(c) - 1, Math.floor(cLo * (1 - tol - Math.min(0.008, 0.15 * stretch)))));
        const hi = Math.min(this.maxBin, Math.max(Math.round(c) + 1, Math.ceil(cHi * (1 + tol + Math.min(0.015, 0.35 * stretch)))));
        if (lo >= hi) break;
        const e = partialWeight(h, f0);
        if (h <= 8) eSum += e;
        partials.push({ h, lo, hi, f, fET: f * etRatio, g: (f0 + ALPHA) / (h * f0 + BETA), e });
      }
      // short-window partial bins (for the energy envelope) - partials between 120 Hz and 6 kHz
      const sp = [];
      const spLo = [];
      const spHi = [];
      const so = [];
      const sph = [];
      for (const p of partials) {
        if (p.f < 120) continue;
        if (p.f > 6000 || sp.length >= 8) break;
        sph.push(p.h);
        sp.push(Math.round(p.f / this.shortBinHz));
        spLo.push(Math.round(Math.min(p.f, p.fET) / this.shortBinHz) - 1);
        spHi.push(Math.round(Math.max(p.f, p.fET) / this.shortBinHz) + 1);
        so.push(Math.round((p.f + (p.h === 1 ? 0.5 : 0.5) * f0) / this.shortBinHz)); // between partials
      }
      if (!sp.length) {
        // very high notes: fundamental only
        const p = partials[0];
        sp.push(Math.round(p.f / this.shortBinHz));
        spLo.push(Math.round(Math.min(p.f, p.fET) / this.shortBinHz) - 1);
        spHi.push(Math.round(Math.max(p.f, p.fET) / this.shortBinHz) + 1);
        so.push(Math.round((p.f * 1.25) / this.shortBinHz));
        sph.push(1);
      }
      const spacing = f0 / this.binHz;
      this.cands.push({
        midi: m,
        f0,
        partials,
        eSum,
        sp,
        spLo,
        spHi,
        so,
        sph,
        flank1: Math.max(5, Math.min(8, Math.floor(spacing * 0.3))),
        flank2: Math.max(7, Math.min(14, Math.floor(spacing * 0.48))),
      });
    }
  }

  // Per-note energy (partials and the gaps between them) from a short (~43 ms) window.
  _shortEnergy(end) {
    const mask = this.ringSize - 1;
    const n = this.shortWin;
    for (let i = 0; i < n; i++) this.shortFrame[i] = this.ring[(end - n + i) & mask] * this.shortWindow[i];
    const mag = this.shortFFT.magnitude(this.shortFrame, this.shortMag);
    const e = new Float64Array(128);
    const o = new Float64Array(128);
    const pp = new Float32Array(128 * 8); // per-partial energies
    const maxK = mag.length - 2;
    for (const c of this.cands) {
      let sum = 0,
        off = 0;
      const base = c.midi * 8;
      for (let i = 0; i < c.sp.length; i++) {
        const hi = c.spHi[i];
        if (hi >= maxK) break;
        let m = 0;
        for (let k = Math.max(1, c.spLo[i]); k <= hi; k++) if (mag[k] > m) m = mag[k];
        sum += m * m;
        pp[base + i] = m * m;
        const q = c.so[i];
        if (q < maxK) off += mag[q] * mag[q];
      }
      e[c.midi] = sum;
      o[c.midi] = off;
    }
    return { e, o, pp };
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
    // Slowly adapting floor: minimum over ~2 s blocks (x3 like the calibration).
    const fm = this.onsetFloorMin;
    for (let k = 0; k < mag.length; k++) if (mag[k] < fm[k]) fm[k] = mag[k];
    if (++this.onsetFloorN >= Math.round((2 * this.sr) / this.onsetHop)) {
      for (let k = 0; k < mag.length; k++) {
        const est = Math.max(1e-6, fm[k] * 6);
        nm[k] = this.hasNoise ? Math.max(Math.min(nm[k], est * 2), est) : est;
        fm[k] = Infinity;
      }
      this.onsetFloorN = 0;
    }
    // Log spectral flux of what stands above the (x3) noise floor - noise fluctuations below it
    // contribute nothing - against a frequency max-filtered previous frame (SuperFlux), which
    // also ignores vibrato and slow glides.
    const cur = this.curLog;
    const prev = this.prevLog;
    const K = this.onsetMaxBin;
    for (let k = 1; k <= K + 1; k++) {
      const v = mag[k] - nm[k];
      cur[k] = v > 0 ? Math.log1p(v / nm[k]) : 0;
    }
    for (let k = 2; k <= K; k++) {
      const ref = Math.max(prev[k - 1], prev[k], prev[k + 1]);
      const d = cur[k] - ref;
      if (d > 0) flux += d;
    }
    this.prevLog = cur;
    this.curLog = prev;
    flux /= K;
    const t = (start + n / 2) / this.sr;

    if (this.calibrating) this.calibrating.flux.push(flux);

    // Peak picking on previous value: prev > both neighbours and above adaptive threshold.
    const [p1, p2] = this.fluxPrev;
    const hist = this.fluxHist;
    let mean = 0;
    for (const v of hist) mean += v;
    mean = hist.length ? mean / hist.length : 0;
    const sens = Math.sqrt(this.sensitivity);
    const thresh = Math.max(mean * 1.5 + 0.04, 0.07) / sens;
    if (p1 > p2 && p1 >= flux && p1 <= thresh && p1 > Math.max(mean * 1.15, 0.025)) {
      // Too weak for an attack on its own (noise can hide a soft note's hammer, bass hammers are
      // soft), but kept: a note whose partials jump right after it may claim it (see _attackFor).
      const medium = p1 > Math.max(mean * 1.5 + 0.02, this.onsetFloor) / sens;
      const w = { t: this.fluxPrevTime, strength: p1, thresh, weak: true, medium };
      this.weakPeaks.push(w);
      if (this.weakPeaks.length > 48) this.weakPeaks.shift();
      // re-striking a ringing string adds little new flux: let medium peaks be checked too
      if (medium && w.t - this.lastOnsetTime > 0.045) this.pendingRestrike.push(w);
    }
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

  // --- noise floor ---------------------------------------------------------------------------
  _updateFloor(mag) {
    const cur = this.floorCur;
    const busy = this.busy;
    const fno = this.frameNo;
    const K = this.maxBin;
    const S = this.floorSm;
    // 7-bin frequency smoothing + recursive time smoothing lowers the variance of the estimate
    let run = 0;
    for (let k = 0; k < 7; k++) run += mag[k];
    for (let k = 4; k < K - 3; k++) {
      run += mag[k + 3] - mag[k - 4];
      S[k] = 0.7 * S[k] + 0.3 * (run / 7);
      if (busy[k] >= fno - this.busyHold) continue; // under a (recently) sounding note: not noise
      if (S[k] < cur[k]) cur[k] = S[k];
    }
    if (++this.floorFrames < this.floorSub) return;
    this.floorFrames = 0;
    const prev = this.floorRing.length ? this.floorRing[this.floorRing.length - 1] : null;
    const snap = Float64Array.from(cur);
    // bins that stayed busy for the whole sub-window keep their previous estimate
    if (prev) for (let k = 4; k < K - 3; k++) if (snap[k] === Infinity) snap[k] = prev[k];
    this.floorRing.push(snap);
    if (this.floorRing.length > this.floorSubs) this.floorRing.shift();
    cur.fill(Infinity);
    // minimum over the ring, bias-corrected to the mean magnitude of stationary noise
    const BIAS = 1.8;
    const fl = this.floor;
    for (let k = 4; k < K - 3; k++) {
      let m = Infinity;
      for (const r of this.floorRing) if (r[k] < m) m = r[k];
      fl[k] = m === Infinity ? 0 : m * BIAS;
    }
    for (let k = 0; k < 4; k++) fl[k] = fl[4];
    for (let k = K - 3; k <= K; k++) fl[k] = fl[K - 4];
    if (this.floorRing.length >= 3) this.floorWarm = true;
  }

  _markBusy() {
    // Bins under the partials of sounding notes are excluded from noise-floor learning.
    const fno = this.frameNo;
    const busy = this.busy;
    for (const midi of [...this.active.keys(), ...this.pending.keys()]) {
      const c = this.cands[midi - MIDI_MIN];
      const P = c.partials;
      for (let i = 0; i < P.length && i < 16; i++) {
        const lo = Math.max(0, P[i].lo - 3),
          hi = Math.min(this.maxBin, P[i].hi + 3);
        for (let k = lo; k <= hi; k++) busy[k] = fno;
      }
    }
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
    this.frameNo++;
    const t = end / this.sr;
    const mag = this.fft.magnitude(this.frame, this.mag);

    if (this.calibrating) {
      const c = this.calibrating;
      for (let k = 0; k < this.nBins; k++) c.sum[k] += mag[k];
      c.n++;
      c.rms.push(rms);
    }
    this._markBusy();
    this._updateFloor(mag);

    // 1) noise subtraction (adaptive floor once warm; start-up calibration before that)
    const Y = this.Y;
    const maxBin = this.maxBin;
    const nE = this.nEff;
    if (this.floorWarm) {
      // The calibrated spectrum may contain talking etc.: never trust it above the tracked floor
      // by more than 6 dB.
      for (let k = 0; k <= maxBin; k++) nE[k] = this.hasNoise ? Math.max(this.floor[k], Math.min(this.noise[k], 2 * this.floor[k])) : this.floor[k];
    } else if (this.hasNoise) nE.set(this.noise);
    else nE.fill(0);
    let rawMax = 0;
    for (let k = 0; k <= maxBin; k++) {
      const v = mag[k] - 2 * nE[k];
      Y[k] = v > 0 ? v : 0;
      if (k > 3 && Y[k] > rawMax) rawMax = Y[k];
    }
    for (let k = 0; k < 3; k++) Y[k] = 0;
    // Nothing stands out of the noise by more than a -72 dBFS sinusoid: silence.
    const silent = rawMax * this.magScale < 2.5e-4 / this.sensitivity;

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
      if (Y[k] === 0) continue; // most bins are below the noise floor
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

    // Per-note energy from a short (~43 ms) window: attack/decay envelopes and re-strikes.
    const se = this._shortEnergy(end);
    this.energyHist.push({ t, e: se.e, o: se.o, pp: se.pp });
    if (this.energyHist.length > 48) this.energyHist.shift();

    const detected = silent || this.calibrating ? [] : this._iterativeDetect(Y);
    this.lastDetected = detected;
    this._track(detected, t, mag);
  }

  _salience(c, S, out) {
    let s = 0,
      support = 0;
    const P = c.partials;
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
      if (i < 8 && m > 0.05) support += p.e;
    }
    // Penalise candidates whose (expected-to-be-strong) low partials are missing: sub-octave /
    // "virtual pitch" candidates that live off other notes' partials.
    const sup = support / c.eSum;
    return s * sup * Math.sqrt(sup);
  }

  _iterativeDetect(Y) {
    const R = this.R;
    R.set(Y);
    const found = [];
    const sal = this.lastSalience;
    sal.fill(0);
    const baseT = 0.44 / this.sensitivity;
    const refT = 0.5 / this.sensitivity; // reference for the confidence model's salience feature
    let first = 0;
    const tmp = this._tmp;
    const taken = new Uint8Array(128);
    for (let iter = 0; iter < 10; iter++) {
      let best = null,
        bestScore = 0,
        bestSal = 0,
        bestThr = 0;
      for (const c of this.cands) {
        if (taken[c.midi]) continue;
        const s = this._salience(c, R, null);
        if (iter === 0) sal[c.midi] = s;
        let thr = baseT;
        if (this.expected.has(c.midi)) thr *= 0.7;
        if (this.active.has(c.midi)) thr *= 0.75;
        else if (this.pending.has(c.midi)) thr *= 0.85; // continuity while a note is being judged
        const score = s / thr;
        if (score > bestScore) {
          bestScore = score;
          best = c;
          bestSal = s;
          bestThr = thr;
        }
      }
      if (!best || bestScore < 1) break;
      if (iter === 0) first = bestSal;
      taken[best.midi] = 1;
      if (iter > 0 && bestSal < first * (this.expected.has(best.midi) ? 0.1 : 0.25)) {
        // Too weak relative to the loudest note to be trusted - but keep scanning for expected
        // notes, which only need to clear a lower bar.
        if (![...this.expected].some((m) => !taken[m])) break;
        found.push({ midi: best.midi, salience: bestSal, ratio: bestSal / refT, weak: true });
      } else found.push({ midi: best.midi, salience: bestSal, ratio: bestSal / refT });
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

  // --- candidate evidence --------------------------------------------------------------------
  // Look at a candidate's partials in the raw spectrum: how sinusoidal (peaky) they are, where
  // exactly they are, how far above the noise floor, and how loud.
  _inspect(c, mag) {
    const P = c.partials;
    const nE = this.nEff;
    const f1 = c.flank1,
      f2 = c.flank2;
    let wT = 0,
      tonal = 0,
      wH = 0,
      tonalHi = 0,
      wD = 0,
      dev = 0,
      sig = 0,
      nz = 0,
      nsig = 0,
      mMax = 0;
    const maxI = Math.min(P.length, 10);
    // strongest partials (index, magnitude, precise cents) for frame-to-frame pitch tracking
    let s1 = -1,
      s1m = 0,
      s1c = 0,
      s2 = -1,
      s2m = 0,
      s2c = 0;
    for (let i = 0; i < maxI; i++) {
      const p = P[i];
      let k = p.lo;
      for (let j = p.lo + 1; j <= p.hi; j++) if (mag[j] > mag[k]) k = j;
      if (mag[k] > mMax) mMax = mag[k];
    }
    for (let i = 0; i < maxI; i++) {
      const p = P[i];
      let k = p.lo;
      for (let j = p.lo + 1; j <= p.hi; j++) if (mag[j] > mag[k]) k = j;
      const m = mag[k];
      const nf = nE[k] + 1e-12;
      sig += m * m;
      nz += nf * nf;
      if (m < 3 * nf || m < mMax * 0.03 || k <= 1 || k >= this.maxBin) continue;
      const isPeak = m >= mag[k - 1] && m >= mag[k + 1];
      let fs = 0,
        fn = 0;
      for (let d = f1; d <= f2; d++) {
        if (k - d > 0) {
          fs += mag[k - d];
          fn++;
        }
        if (k + d <= this.maxBin) {
          fs += mag[k + d];
          fn++;
        }
      }
      const flank = fs / Math.max(1, fn) + 1e-12;
      const tdb = isPeak ? clamp(20 * Math.log10(m / flank), 0, 40) : 0;
      const w = m * m;
      wT += w;
      tonal += w * tdb;
      if (p.h >= 3) {
        wH += Math.sqrt(w);
        tonalHi += Math.sqrt(w) * tdb;
      }
      nsig++;
      if (!isPeak) continue;
      const a = Math.log(mag[k - 1] + 1e-12),
        bb = Math.log(m + 1e-12),
        g = Math.log(mag[k + 1] + 1e-12);
      const den = a - 2 * bb + g;
      const off = den < 0 ? clamp((0.5 * (a - g)) / den, -0.5, 0.5) : 0;
      // deviation from the band between the unstretched and the stretched pitch
      const fm = (k + off) * this.binHz;
      const c1 = 1200 * Math.log2(fm / p.f),
        c2 = 1200 * Math.log2(fm / p.fET);
      const ce = c1 * c2 <= 0 ? 0 : Math.abs(c1) < Math.abs(c2) ? c1 : c2;
      if (p.h <= 4) {
        const wd = w / p.h;
        wD += wd;
        dev += wd * ce;
      }
      if (m > s1m) {
        s2 = s1;
        s2m = s1m;
        s2c = s1c;
        s1 = i;
        s1m = m;
        s1c = ce;
      } else if (m > s2m) {
        s2 = i;
        s2m = m;
        s2c = ce;
      }
    }
    // Pitch of the strongest partial above 250 Hz in the short (43 ms) window: vibrato and glides
    // average out in the long window but show up here.
    let sIdx = -1,
      sM = 0;
    for (let i = 0; i < maxI; i++) {
      const p = P[i];
      if (p.f < 250 || p.f > 5000) continue;
      const k = Math.round(p.f / this.binHz);
      const m = Math.max(mag[k - 1], mag[k], mag[k + 1]);
      if (m > sM) {
        sM = m;
        sIdx = i;
      }
    }
    let sc = null;
    if (sIdx >= 0 && c.f0 >= 5 * this.shortBinHz && sM > 3 * nE[Math.round(P[sIdx].f / this.binHz)]) {
      const S = this.shortMag;
      const ps = P[sIdx];
      const j0 = Math.max(1, Math.round(Math.min(ps.f, ps.fET) / this.shortBinHz) - 2),
        j1 = Math.min(S.length - 2, Math.round(Math.max(ps.f, ps.fET) / this.shortBinHz) + 2);
      let k = j0;
      for (let j = j0; j <= j1; j++) if (S[j] > S[k]) k = j;
      if (k > 0 && k < S.length - 1 && S[k] >= S[k - 1] && S[k] >= S[k + 1]) {
        const a = Math.log(S[k - 1] + 1e-12),
          bb = Math.log(S[k] + 1e-12),
          g = Math.log(S[k + 1] + 1e-12);
        const den = a - 2 * bb + g;
        const off = den < 0 ? clamp((0.5 * (a - g)) / den, -0.5, 0.5) : 0;
        sc = 1200 * Math.log2(((k + off) * this.shortBinHz) / P[sIdx].f);
      }
    }
    const level = 10 * Math.log10((sig * this.magScale * this.magScale) / 2 + 1e-20);
    return {
      sIdx,
      sc,
      tonal: wT > 0 ? tonal / wT : 0,
      tonalHi: wH > 0 ? tonalHi / wH : -1,
      dev: wD > 0 ? dev / wD : 0,
      hasDev: wD > 0,
      snr: 10 * Math.log10(sig / (nz + 1e-20)),
      level,
      nsig,
      pk: [s1, s1c, s2, s2c],
    };
  }

  // Attack/decay envelope of a note's partials around attack time `at` (short-window energies).
  _envelope(midi, at, now) {
    let bH = null,
      pH = null,
      peak = 0,
      last = 0,
      lastT = at,
      swell = 0;
    const H = this.energyHist;
    for (const h of H) if (h.t <= at - 0.002) bH = h;
    for (const h of H) {
      const dt = h.t - at;
      if (dt <= 0.004 || h.t > now + 1e-6) continue;
      const v = h.e[midi];
      if (dt <= 0.1 && v > peak) {
        peak = v;
        pH = h;
      }
      last = v;
      lastT = h.t;
    }
    const peakT = pH ? pH.t : at;
    let first = -1;
    for (const h of H)
      if (h.t >= at + 0.045 && h.t <= now + 1e-6) {
        first = h.e[midi];
        break;
      }
    // decay slope (dB/s) from the peak on, least squares
    let n = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (const h of H) {
      if (h.t < peakT + 0.02 || h.t > now + 1e-6) continue;
      if (h.t >= peakT + 0.04) swell = Math.max(swell, h.e[midi]);
      const x = h.t - peakT,
        y = 10 * Math.log10(h.e[midi] + 1e-20);
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const slope = n >= 3 ? (n * sxy - sx * sy) / (n * sxx - sx * sx + 1e-12) : 0;
    let rough = 0;
    if (n >= 4) {
      const icpt = (sy - slope * sx) / n;
      let ss = 0;
      for (const h of H) {
        if (h.t < peakT + 0.02 || h.t > now + 1e-6) continue;
        const r = 10 * Math.log10(h.e[midi] + 1e-20) - (icpt + slope * (h.t - peakT));
        ss += r * r;
      }
      rough = Math.sqrt(ss / n);
    }
    const b = bH ? bH.e[midi] : 0;
    const gain = peak - b;
    // Median rise over the note's significant partials: a new string raises all of them, while a
    // ghost living off another note's partial (or a narrow-band noise) raises only one or two.
    let riseMed = 1;
    if (pH) {
      const np = this.cands[midi - MIDI_MIN].sp.length;
      const base = midi * 8;
      let mx = 0;
      for (let i = 0; i < np; i++) mx = Math.max(mx, pH.pp[base + i]);
      const r = [];
      for (let i = 0; i < np; i++) {
        const a = pH.pp[base + i];
        if (a < mx * 0.03) continue;
        const bb = bH ? bH.pp[base + i] : 0;
        r.push((a + 1e-12) / (bb + 1e-12 + a * 1e-3));
      }
      r.sort((x, y) => x - y);
      if (r.length) riseMed = r.length >= 3 ? r[(r.length - 1) >> 1] : r[0];
    }
    return {
      rise: (peak + 1e-12) / (b + 1e-12 + peak * 1e-3),
      riseMed,
      // energy still present (above what was there before the attack) relative to the peak
      sustain: gain > 0 ? clamp((last - b) / gain, 0, 1.5) : 0,
      sustainAge: lastT - at,
      peakAge: peakT - at,
      // how much of the peak energy is there right after the attack (strings: all of it;
      // bowed/sung/pad sounds: they are still growing)
      attackFrac: first >= 0 && peak > 0 ? (first - b) / (peak - b + 1e-12) : 1,
      slope,
      rough,
      slopeSpan: n >= 3 ? now - peakT : 0,
      swell: peak > 0 && swell > 0 ? swell / peak : 0,
      harm: pH ? (Math.max(0, peak - b) + 1e-12) / (Math.max(0, pH.o[midi] - (bH ? bH.o[midi] : 0)) + 1e-12 + Math.max(0, peak - b) * 0.01) : 1,
    };
  }

  // Combine evidence into a confidence (0..1) that this is a real piano note.
  _confidence(p, env, expected) {
    const M = this.model;
    const F = p.feats;
    const nf = F.length;
    const at = p.attack.t;
    let sal = 0,
      snr = 0,
      nsig = 0,
      level = -200;
    for (const f of F) {
      nsig = Math.max(nsig, f.nsig);
      sal = Math.max(sal, f.ratio);
      snr = Math.max(snr, f.snr);
      level = Math.max(level, f.level);
    }
    // Pitch and peakiness from frames that see enough of the note (the first ones are smeared
    // by the attack): the last three.
    const L = F.slice(-3);
    let tonal = 0,
      tonalHi = 0,
      nHi = 0;
    for (const f of L) {
      tonal += f.tonal;
      if (f.tonalHi >= 0) {
        tonalHi += f.tonalHi;
        nHi++;
      }
    }
    tonal /= L.length;
    tonalHi = nHi ? tonalHi / nHi : tonal;
    const devs = [];
    for (const f of F) if (f.hasDev && (f.t - at >= 0.075 || nf <= 2)) devs.push(f.dev);
    const dev = devs.length ? devs.reduce((a, v) => a + v, 0) / devs.length : 0;
    // Frame-to-frame movement (cents) of the strongest partials once the attack has passed:
    // a piano string holds its pitch, voices and instruments with vibrato don't.
    const moves = [];
    for (let i = 1; i < nf; i++) {
      const a = F[i - 1],
        b = F[i];
      if (b.t - at < 0.07) continue;
      let d = -1;
      if (a.pk[0] >= 0 && a.pk[0] === b.pk[0]) d = Math.abs(b.pk[1] - a.pk[1]);
      else if (a.pk[0] >= 0 && a.pk[0] === b.pk[2]) d = Math.abs(b.pk[3] - a.pk[1]);
      else if (a.pk[2] >= 0 && a.pk[2] === b.pk[0]) d = Math.abs(b.pk[1] - a.pk[3]);
      else d = 30; // the strongest partials changed: not a steady note
      moves.push(d);
    }
    moves.sort((u, v) => u - v);
    const drift = moves.length ? moves[moves.length >> 1] : 0;
    const driftMax = moves.length ? moves[moves.length - 1] : 0;
    // Short-window pitch wobble of the strongest partial (same partial throughout) once the
    // attack has passed: range in cents.
    let vib = 0,
      nv = 0,
      vlo = Infinity,
      vhi = -Infinity;
    const vIdx = F[nf - 1].sIdx;
    for (const f of F) {
      if (f.t - at < 0.06 || f.sc == null || f.sIdx !== vIdx) continue;
      nv++;
      vlo = Math.min(vlo, f.sc);
      vhi = Math.max(vhi, f.sc);
    }
    if (nv >= 3) vib = vhi - vlo;
    const raw = { sal, tonal, tonalHi, dev, drift, driftMax, snr, level, vib, nv, ...env };
    const x = {
      sal: clamp(Math.log2(sal), -1, 2.5),
      tonal: clamp((tonal - 20) / 10, -2, 2),
      tonalHi: clamp((tonalHi - 18) / 10, -2, 2),
      dev: clamp((Math.abs(dev) - 12) / 10, 0, 2.5),
      drift: moves.length ? clamp((drift - 2) / 4, 0, 3) : 0,
      driftMax: moves.length ? clamp((driftMax - 6) / 10, 0, 2.5) : 0,
      rise: clamp(Math.log10(env.rise) - 2, -2, 1),
      riseMed: clamp(Math.log10(env.riseMed) - 1.5, -1.5, 1.5),
      harm: clamp(Math.log10(env.harm) - 0.5, -1, 1),
      swell: env.swell > 0 ? clamp(env.swell - 1.15, 0, 2) : 0,
      sustain: env.sustainAge >= 0.06 ? clamp(env.sustain, 0, 1) - 0.35 : 0,
      slope: env.slopeSpan >= 0.06 ? clamp(env.slope / 30, -2, 2) : 0,
      span: clamp(env.slopeSpan / 0.2, 0, 1.5),
      attackFrac: clamp(env.attackFrac, -0.5, 1.2) - 0.8,
      peakAge: clamp((env.peakAge - 0.045) / 0.03, -1, 2),
      snr: clamp((snr - 25) / 10, -2, 2),
      rel: this.pianoLevel != null ? clamp((level - this.pianoLevel + 12) / 10, -3, 0) : 0,
      nsig: clamp(nsig / 4, 0, 2),
      vib: nv >= 3 ? clamp((vib - 8) / 15, -0.5, 3) : 0,
      rough: env.slopeSpan >= 0.08 ? clamp((env.rough - 0.8) / 1.5, -0.5, 3) : 0,
      age: clamp((nf - 2) / 4, 0, 1),
    };
    let z = evalModel(M, x);
    if (expected) z += M.expected ?? 1;
    const out = 1 / (1 + Math.exp(-z));
    p.x = x;
    p.raw = raw;
    p.level = level;
    return out;
  }

  _thresholds(expected, midi) {
    const s = this.strictness;
    const sens = Math.sqrt(this.sensitivity);
    let emit = expected ? 0.12 + 0.3 * s : 0.3 + 0.4 * s;
    // far outside the current piece: need more evidence
    if (!expected && this.range && (midi < this.range[0] - 5 || midi > this.range[1] + 5)) emit += 0.15;
    emit /= sens;
    const fast = Math.max(emit, expected ? 0.55 + 0.2 * s : 0.92 + 0.06 * s);
    return { emit, fast };
  }

  _emit(midi, t, conf, sal, level, restrike = false) {
    if (!restrike) {
      this.active.set(midi, { on: t, missing: 0, sal, lastStrike: t, conf, fresh: true });
      this.emittedAt.set(midi, t);
      this.stats.emitted++;
    } else this.stats.restrikes++;
    // Remember how loud the piano is being played: upper quartile of the last confident notes.
    if (conf >= 0.75 && level > -120) {
      const L = this.levels;
      L.push(level);
      if (L.length > 12) L.shift();
      const sorted = [...L].sort((a, b) => a - b);
      this.pianoLevelBase = sorted[Math.floor(sorted.length * 0.75)];
      this.pianoLevelT = this.pos / this.sr;
    }
    this.onNoteOn(midi, t, Math.min(1, sal / 3), { confidence: conf, restrike });
  }

  _track(detected, t, mag) {
    const on = new Set(detected.map((d) => d.midi));
    const halfWin = this.win / 2 / this.sr;

    // Resolve re-strike checks whose attack is far enough in the past.
    const settle = 0.13;
    const ready = this.pendingRestrike.filter((o) => t - o.t >= settle);
    this.pendingRestrike = this.pendingRestrike.filter((o) => t - o.t < settle);

    for (const d of detected) {
      const st = this.active.get(d.midi);
      if (st) {
        st.missing = 0;
        st.sal = d.salience;
        continue;
      }
      // Every new piano note starts with a hammer strike; without a recent attack this is a
      // ghost (e.g. from a decaying note's tail, or a steady sound in the room).
      const attack = this._attackFor(d.midi, t);
      if (!attack) {
        this.pending.delete(d.midi);
        continue;
      }
      // already decided for this attack (a note that dropped out for a moment is not new)
      if (this.rejected.get(d.midi) === attack.t || this.emittedAt.get(d.midi) === attack.t) continue;
      let p = this.pending.get(d.midi);
      if (!p || p.attack !== attack) {
        p = { midi: d.midi, attack, feats: [], miss: 0 };
        this.pending.set(d.midi, p);
      }
      p.miss = 0;
      // Frames whose window ends right after an attack see a smeared spectrum.
      if (t - attack.t < 0.045 || (t - this.lastOnsetTime < 0.035 && this.lastOnsetTime > attack.t)) continue;
      const c = this.cands[d.midi - MIDI_MIN];
      const f = this._inspect(c, mag);
      f.ratio = d.ratio;
      f.t = t;
      p.feats.push(f);
      p.sal = Math.max(p.sal || 0, d.salience);
      this._decide(p, t);
    }
    for (const [m, p] of this.pending) {
      if (on.has(m)) continue;
      if (++p.miss >= 2) {
        if (p.feats.length >= 2) this._decide(p, t, true);
        this.pending.delete(m);
      }
    }

    this._restrikes(ready, on);

    for (const [midi, st] of [...this.active]) {
      if (on.has(midi)) continue;
      st.missing++;
      if (st.missing >= 3) {
        this.active.delete(midi);
        this.onNoteOff(midi, t - halfWin);
      }
    }
  }

  // Decide about a note hypothesis: emit now, keep watching, or reject.
  _decide(p, t, final = false) {
    const nf = p.feats.length;
    if (nf < 2) return;
    const expected = this.expected.has(p.midi);
    const age = t - p.attack.t;
    const env = this._envelope(p.midi, p.attack.t, t);
    let conf = this._confidence(p, env, expected);
    // Strings above F6 have no dampers: they ring for seconds. A "note" up there that is gone
    // 0.12 s after its attack was a tap, a click or a spoon on a plate.
    if (!expected && p.midi >= 89 && env.sustainAge >= 0.12 && env.sustain < 0.0007) conf = Math.min(conf, 0.2);
    const { emit, fast } = this._thresholds(expected, p.midi);
    // Expected notes are decided quickly; an unexpected note that isn't obviously a piano string
    // is watched for up to 0.3 s so that its decay (or lack of it) can be seen.
    const minAge = expected ? 0.06 : 0.1;
    const maxAge = expected ? 0.2 : 0.3;
    // Final score: the latest evidence, softened by the best seen once the attack had passed (a
    // short note that is already damped when the watch ends still counts; early optimism that
    // later evidence - vibrato, swelling - contradicts does not).
    if (age >= 0.1 && conf > (p.best || 0)) p.best = conf;
    const score = Math.max(conf, (conf + (p.best || 0)) / 2);
    let decision = null;
    if (age >= minAge && conf >= fast && !this.collect) decision = 'emit';
    else if (final || age >= maxAge || nf >= (expected ? 9 : 14)) decision = score >= emit ? 'emit' : 'reject';
    if (this.collect && this.onCandidate) this.onCandidate({ midi: p.midi, t, attackT: p.attack.t, age, nf, conf, decision: decision || 'observe', expected, x: { ...p.x }, raw: { ...p.raw } });
    if (!decision) return;
    if (this.onCandidate && !this.collect) this.onCandidate({ midi: p.midi, t, attackT: p.attack.t, age, conf, decision, expected, x: p.x, env, feats: p.feats });
    this.pending.delete(p.midi);
    if (this.autoTune) this._trackTuning(p);
    if (decision === 'emit') {
      conf = Math.max(conf, score);
      const a = p.attack;
      if (a.weak && !a.reported) {
        // a rescued soft attack becomes a real onset (rhythm drills) once its note is confirmed
        a.reported = true;
        this.onOnset(a.t, a.strength);
      }
      this._emit(p.midi, a.t, conf, p.sal, p.level);
    }
    else {
      this.rejected.set(p.midi, p.attack.t);
      this.stats.rejected++;
    }
  }

  // Re-strikes. For every attack, once things have settled:
  //  - sounding notes whose partials (not the gaps between them) gained energy and kept it are
  //    re-struck;
  //  - an attack that started no new note ("orphan") must have re-struck something that is
  //    sounding: pick the note that gained the most harmonic energy (expected notes first).
  _restrikes(ready, on) {
    for (const o of ready) {
      const ot = o.t;
      const beforeH = this._histAt(ot - 0.002);
      if (!beforeH) continue;
      const peakE = new Float64Array(128),
        peakO = new Float64Array(128),
        lateE = new Float64Array(128);
      let nLate = 0;
      for (const h of this.energyHist) {
        if (h.t >= ot + 0.035 && h.t <= ot + 0.08)
          for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
            if (h.e[m] > peakE[m]) {
              peakE[m] = h.e[m];
              peakO[m] = h.o[m];
            }
          }
        if (h.t >= ot + 0.085 && h.t <= ot + 0.13) {
          nLate++;
          for (let m = MIDI_MIN; m <= MIDI_MAX; m++) lateE[m] += h.e[m];
        }
      }
      if (!nLate) continue;
      // notes that started (or are being judged as new) at this very attack
      const fresh = [...this.active].filter(([, st]) => Math.abs(st.on - ot) < 0.001).map(([m]) => m);
      for (const p of this.pending.values()) if (p.attack === o && (p.best || 0) >= 0.3) fresh.push(p.midi);
      const cands = [];
      for (const [midi, st] of this.active) {
        if (!on.has(midi) || fresh.includes(midi)) continue;
        if (ot - st.lastStrike < 0.1) continue;
        // A note that just started at this attack a (twelfth, octave...) below explains energy
        // gains at all of this note's partials (a new note above only explains some of them -
        // see _hiddenAbove below).
        if (fresh.some((f) => Math.abs(f - midi) <= 2 || [12, 19, 24, 28, 31, 36].includes(midi - f))) continue;
        const b = beforeH.e[midi] + 1e-12;
        const ratio = peakE[midi] / b;
        const lateRatio = lateE[midi] / nLate / b;
        // harmonic: the energy the attack added went into the partials, not into the gaps between
        // them (a clap or a cough adds about as much to both)
        const dP = Math.max(0, peakE[midi] - beforeH.e[midi]);
        const dO = Math.max(0, peakO[midi] - beforeH.o[midi]);
        const harm = (dP + 1e-12) / (dO + 1e-12 + 1e-3 * b);
        cands.push({ midi, st, ratio, lateRatio, harm });
      }
      const sens = Math.sqrt(this.sensitivity);
      const hmin = 1.5 + 2 * this.strictness;
      const ok = (c, need) => c.ratio > need / sens && c.lateRatio > (need * 0.6) / sens && c.harm > hmin;
      let hits = cands.filter((c) => ok(c, this.expected.has(c.midi) ? 1.6 : 2.5));
      if (!hits.length && !fresh.length && cands.length && o.strength > o.thresh * 1.3) {
        // An attack that started nothing new re-struck something that is sounding.
        const exp = cands.filter((c) => this.expected.has(c.midi) && c.lateRatio > 0.7 / sens && c.harm > hmin * 0.5);
        if (exp.length) hits = exp;
        else {
          // Only trust an unambiguous, clearly harmonic choice (with the pedal down many notes
          // ring at once; a knock on the lid must not re-strike a held note).
          const sorted = cands.filter((c) => c.lateRatio > 1.1 / sens && c.harm > hmin).sort((a, b) => b.lateRatio - a.lateRatio);
          if (sorted.length && (sorted.length === 1 || sorted[0].lateRatio > sorted[1].lateRatio * 1.5)) hits = [sorted[0]];
        }
      }
      // Which partials rose? All of them: the note was struck again. Only the even ones: the
      // octave above was struck (a new note hiding in this one's spectrum); only every third:
      // the twelfth above.
      const hidden = [];
      hits = hits.filter((c) => {
        // the octave below is being judged as a new note at this very attack: its partials
        // explain the gain here
        const low = this.pending.get(c.midi - 12);
        if (low && low.attack === o) return false;
        const up = this._hiddenAbove(c.midi, ot);
        if (!up) return true;
        if (!this.active.has(up) && !hidden.includes(up)) hidden.push(up);
        return false;
      });
      for (const m of hidden) {
        this.pending.delete(m);
        const conf = this.expected.has(m) ? 0.9 : 0.75;
        this._emit(m, ot, conf, 1, -200);
      }
      if (hits.length && o.weak && !o.reported) {
        o.reported = true;
        this.onOnset(ot, o.strength);
      }
      for (const c of hits) {
        c.st.lastStrike = ot;
        // no more certain than the note itself was
        const conf = Math.min(c.st.conf + 0.05, clamp(0.45 + 0.2 * Math.log2(Math.max(c.ratio, c.lateRatio) / 1.3) + 0.1 * Math.log2(c.harm / 4), 0.2, 0.97));
        if (conf < this._thresholds(this.expected.has(c.midi), c.midi).emit) continue;
        this._emit(c.midi, ot, conf, c.st.sal, -200, true);
      }
    }
  }

  // After an attack at `ot`, did only a harmonic subset of a sounding note's partials gain energy?
  // Returns the MIDI note of the implied new note (octave or twelfth above), or 0.
  _hiddenAbove(midi, ot) {
    const c = this.cands[midi - MIDI_MIN];
    const bH = this._histAt(ot - 0.002);
    if (!bH || c.sph.length < 4) return 0;
    const base = midi * 8;
    const pk = new Float64Array(8);
    for (const h of this.energyHist) if (h.t >= ot + 0.035 && h.t <= ot + 0.09) for (let i = 0; i < c.sph.length; i++) pk[i] = Math.max(pk[i], h.pp[base + i]);
    const gain = (sel) => {
      let a = 0,
        b = 0;
      for (let i = 0; i < c.sph.length; i++)
        if (sel(c.sph[i])) {
          a += pk[i];
          b += bH.pp[base + i];
        }
      return b > 0 ? a / b : 1;
    };
    const even = gain((h) => h % 2 === 0),
      odd = gain((h) => h % 2 === 1);
    if (even >= 3 && odd < 1.6 && even > 3 * odd && midi + 12 <= MIDI_MAX) return midi + 12;
    const m3 = gain((h) => h % 3 === 0),
      n3 = gain((h) => h % 3 !== 0);
    if (m3 >= 3 && n3 < 1.6 && m3 > 3 * n3 && midi + 19 <= MIDI_MAX) return midi + 19;
    return 0;
  }

  _histAt(time) {
    // Latest short-window energy frame ending at or before `time`.
    let best = null;
    for (const h of this.energyHist) if (h.t <= time) best = h;
    return best;
  }

  _energyAt(time) {
    const h = this._histAt(time);
    return h && h.e;
  }

  // The attack that started `midi`: normally the most recent one inside the analysis window;
  // an older one if the note's partials rose much more at that one (so a cough or a click right
  // after a piano note doesn't steal its attack), or - for a note that only became detectable
  // late - an older one after which its energy clearly grew. Failing that, a sub-threshold flux
  // peak after which this note's partials jumped (a soft note under noise).
  _attackFor(midi, t) {
    const span = this.win / this.sr + 0.02;
    let best = null,
      bestR = 0;
    for (let i = this.onsets.length - 1; i >= 0; i--) {
      const o = this.onsets[i];
      if (o.t > t - 0.005) continue;
      if (o.t < t - 0.4) break;
      const r = this._riseAfter(midi, o.t, t);
      if (o.t < t - span && r < 2) continue;
      if (!best || r > bestR * 2) {
        best = o;
        bestR = r;
      }
    }
    if (best) return best;
    // deep bass notes take longer to emerge from under the previous one
    const wspan = midi < 40 ? 0.45 : span;
    for (let i = this.weakPeaks.length - 1; i >= 0; i--) {
      const o = this.weakPeaks[i];
      if (o.t > t - 0.03) continue;
      if (o.t < t - wspan) break;
      const r = this._riseAfter(midi, o.t, t);
      if (r >= (o.medium ? 2.5 : 8) && r > bestR * 2) {
        best = o;
        bestR = r;
      }
    }
    return best;
  }

  _riseAfter(midi, at, t) {
    const bh = this._histAt(at - 0.002);
    const before = bh ? bh.e[midi] : 0;
    let after = 0;
    const until = Math.min(t, at + 0.09);
    for (const h of this.energyHist) if (h.t >= at + 0.025 && h.t <= until && h.e[midi] > after) after = h.e[midi];
    return (after + 1e-12) / (before + 1e-12);
  }

  reset() {
    for (const [midi] of this.active) this.onNoteOff(midi, this.pos / this.sr);
    this.active.clear();
    this.pending.clear();
    this.rejected.clear();
    this.emittedAt.clear();
    this.pendingRestrike = [];
    this.onsets = [];
    this.weakPeaks = [];
  }
}
