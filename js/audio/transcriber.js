// Real-time polyphonic piano transcription, hardened against room noise.
//
// Two paths run on the audio clock (all times are seconds of AudioContext time):
//
// Fast path (_look*): decides at the attack.
//  1. Onset detector: 1024-sample frames, 256 hop, log-compressed spectral flux with an adaptive
//     threshold (~5 ms resolution); softer "medium" flux peaks are examined too.
//  2. At every attack, a ladder of short Hann windows that start at the attack (21, 32, 43, 64,
//     85 ms at 48 kHz) is compared with the same window just before it: the power spectrum
//     difference holds only what the attack added, so notes that were already ringing (legato,
//     pedal, repeated chords, the lower note of an octave) cancel out. Each window resolves notes
//     down to some register: treble after ~21 ms, the bass later, the bottom octave not at all.
//     A lower note the window cannot resolve yet ("blocker") makes it wait for a longer one.
//  3. Candidates - notes found in the difference spectrum (iterative detection with
//     cancellation), expected notes, sounding notes - get evidence features: harmonic salience
//     and its contrast with the neighbouring keys, energy rise at the partials but not between
//     them, unique partials vs. partials explained by other notes, octave/twelfth excess,
//     tonality, pitch against this piano's tuning, level vs. the piano's recent level...
//     LOOK_MODEL (two small MLPs, fitted by tests/look-fit.js on the Salamander grand and the
//     synth only) gives the probability that the key was struck at this attack. Expected notes
//     fire at p >= ~0.93; unexpected ones only in free play, only once the piano's level is
//     known (never on noise alone), after two windows, at p >= ~0.88. Everything else is left
//     to the long-window path.
//
// Long-window path (as before; it also decides the bass, soft and doubtful notes):
//  4. Noise floor: per-bin minimum statistics over ~2.5 s (frozen under sounding notes), so fans,
//     hum and traffic are tracked continuously - start-up calibration is only the first guess.
//  5. Pitch analysis: 8192-sample Hann window (zero padded x2) every `hop` samples.
//     Noise-floor subtraction -> spectral whitening -> harmonic salience for all 88 keys using a
//     piano model (string inharmonicity, stretch tuning, register-dependent spectral envelope)
//     -> iterative "pick the strongest note, cancel its partials using spectral smoothness"
//     (after Klapuri 2006) to find every sounding note.
//  6. Note hypotheses: a candidate note must be explained by an attack and is then watched for a
//     few frames. Evidence that it is a piano string and not the room is combined into a
//     confidence (0..1, CONF_MODEL). Clearly piano-like notes are reported at once; doubtful
//     ones only after ~0.2 s of evidence, or never. During a piece, an unexpected note that the
//     fast path examined at the same attack and found unlikely is a ghost of the notes that are
//     due (octave, twelfth, neighbour) and is dropped.
//  7. Note tracking: notes switch off with hysteresis; each new note is back-dated to its attack.
//     Re-struck notes are found by checking which sounding notes gained harmonic (not broadband)
//     energy right after an attack and kept it.
import { FFT, hann } from './fft.js';

export const ENGINE = { name: 'maestro-dsp', version: '3.0' };

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

// Fast-path model (see _lookDecide): probability that a look candidate's key was struck at
// this attack. Fitted by tests/look-fit.js on the Salamander grand and the synth piano only.
export let LOOK_MODEL = {"exp":{"keys":["look","found","sc","rank","relSal","rise","riseLow","harm","snr","rel","relKnown","sub","uniqN","uniqFrac","under","excess","share","active","prev","ampRatio","onset","f0","nsig","tonal","flat","dev","ddev","ctr1","ctr2","expNbr","resid","residSc","blk","weak"],"W1":[[-1.046,0.086,1.813,-0.449,-0.19,0.602,0.291,-0.59,0.304,-0.635,-0.536,1.155,0.244,-1.109,1.274,0.078,-0.302,-0.411,0.686,0.542,1,-0.108,-0.59,-0.882,-0.947,-0.125,-0.286,0.415,-0.269,-1.266,-0.305,-0.084,-0.184,1.077],[-0.466,-0.456,1.22,-0.963,-0.471,1.182,1.555,-0.327,-0.227,1.006,-0.423,-1.483,0.783,-0.571,-0.016,0.291,-0.431,0.167,-0.58,1.184,-0.027,1.127,0.338,-0.763,0.498,-0.174,0.071,0.129,-0.158,-1.922,0.358,0.051,0.551,-0.146],[2.58,0.794,-0.454,-0.571,0.103,-0.139,0.077,0.006,0.021,0.581,-0.359,-0.148,-0.282,0.154,-0.418,-0.128,1.188,0.301,1.34,-0.01,-0.36,-0.277,0.648,0.135,-1.614,0.282,1.103,0.397,0.054,0.604,-0.491,0.276,0.557,-1.373],[0.325,-0.134,0.45,0.304,-0.1,-0.129,-0.702,0.232,0.002,0.418,0.687,-0.192,-0.201,0.515,-0.091,1.274,2.091,0.076,0.547,-0.766,-0.038,-1.053,0.196,-0.57,-0.437,0.727,1.744,0.436,-0.199,1.195,-0.415,0.458,1.434,-1.486],[-1.883,0.102,0.749,0.684,1.93,-0.745,0.419,-0.146,-0.641,-0.307,0.604,-0.099,0.682,0.023,-0.664,-0.227,-0.174,-2.068,0.589,0.484,-0.029,-1.096,-0.55,1.067,-0.492,-0.226,-0.05,0.073,0.034,0.926,0.259,-0.454,-0.394,0.618],[-0.429,-0.199,0.739,0.974,0.114,-0.54,1.011,-0.066,-0.131,0.649,1.071,-0.059,-0.095,0.832,-3.536,-0.758,0.053,0.527,0.265,1.442,-1.653,-0.298,0.155,0.101,-0.703,-0.071,0.128,0.079,0.059,-0.727,0.175,-0.075,0.114,-0.122],[-1.26,-0.676,-0.634,0.713,1.467,-0.727,0.434,-0.315,-0.487,-0.266,-0.592,0.94,0.659,1.221,-0.934,-0.073,-0.048,1.094,0.769,1.919,-0.185,0.855,-0.338,-0.887,-1.27,0.033,0.106,-0.084,0.041,0.26,0.511,-0.055,-1.239,0.271],[-0.725,-0.545,1.327,-0.527,-0.23,0.559,0.606,-0.222,-0.614,0.029,-0.68,0.154,-0.601,0.935,1.465,-0.912,1.498,-1.493,0.117,1.346,0.221,-0.394,1.325,-0.122,-0.182,0.212,0.294,-0.078,0.493,0.259,-0.593,0.064,0.849,-0.309],[-1.149,-0.242,-1.058,-0.72,-1.113,0.419,-0.067,0.74,0.418,0.315,-0.149,0.016,0.405,-1.139,-0.951,1.218,-1.041,1.256,1.142,-0.538,0.243,0.565,-0.213,-0.438,-1.534,-0.034,0.099,-0.191,0.062,1.263,-1.192,0.023,0.093,0.369],[2.363,-0.898,0.292,-0.029,-0.655,0.041,0.543,0.411,0.046,-0.115,-0.941,-0.103,0.362,-2.913,-1.353,-0.767,-0.158,0.27,-1.688,0.323,-0.658,-0.315,0.756,-0.527,0.33,-0.022,0.087,0.048,-0.073,1.89,-0.044,-0.002,0.386,-1.007]],"b1":[-0.358,-0.938,0.203,0.294,1.186,0.573,0.419,-0.677,-0.584,-0.753],"w2":[0.955,1.175,-2.109,1.646,-1.74,2.044,-1.532,1.19,1.735,-1.787],"b2":0.395},"free":{"keys":["look","found","sc","rank","relSal","rise","riseLow","harm","snr","rel","relKnown","sub","uniqN","uniqFrac","under","excess","share","active","prev","ampRatio","onset","f0","nsig","tonal","flat","dev","ddev","ctr1","ctr2","expNbr","resid","residSc","blk","weak"],"W1":[[0.174,-0.488,1.338,-0.32,-2.588,0.048,1.209,0.551,0.259,0.36,1.046,1.173,-0.223,-0.129,1.274,0.854,0.714,-0.559,0.401,-0.131,-0.396,-0.713,-0.711,0.845,0.232,0.155,0.246,0.134,0.258,-0.426,1.228,0.936,0.441,-0.513],[-0.523,0.845,0.074,0.036,0.079,0.869,0.52,1.361,-1.367,1.127,-2.62,-0.085,-0.362,1.13,-0.185,0.435,1.831,1.242,0.118,-0.538,0.45,0.598,0.617,-0.575,0.865,-0.341,-0.12,0.381,0.252,-0.369,-0.403,0.296,0.912,-1.17],[2.324,1.977,1.473,-0.851,0.956,0.746,1.213,-0.397,-0.793,-0.649,0.512,-1.253,1.944,-1.312,-0.292,0.281,0.721,-0.614,-0.76,-0.473,0.639,0.621,0.549,-0.022,-1.152,-0.985,-0.421,-0.342,0.18,2.529,-0.163,-0.166,-0.344,-0.897],[0.521,-1.116,0.596,0.731,-0.569,1.039,-0.341,1.19,1.699,-0.584,-2.102,0.372,-1.138,0.604,-1.084,0.148,1.523,0.273,-0.216,0.147,-0.218,-0.557,-0.324,-0.723,2.27,-0.163,0.116,0.573,0.132,-0.648,-0.898,0.197,0.38,-0.44],[-0.446,-0.927,-2.152,0.107,-0.11,0.172,0.743,1.525,-0.355,-0.755,-1.322,0.846,-0.161,0.943,-1.17,-0.225,0.482,-1.472,0.802,-0.412,-0.58,0.423,1.177,-0.939,-0.624,0.679,-0.307,0.856,-0.366,0.532,-0.245,-1.237,-0.429,-0.231],[-0.995,0.79,0.575,0.833,-2.203,-0.504,0.035,0.537,0.298,-0.266,-0.865,0.4,1.092,-2.201,-0.75,0.494,0.379,1.119,-1.404,0.477,0.012,-1.096,-0.212,-0.332,-0.724,0.069,0.263,1.026,-0.404,-1.068,0.101,-0.874,-0.038,0.309],[-2.759,-0.279,0.869,0.511,1.848,-0.377,-0.061,0.576,0.031,-0.427,0.327,1.467,0.42,-2.025,-0.206,-0.5,-1.7,-0.17,0.47,-0.398,-0.118,0.047,-0.188,0.112,-0.253,0.467,-0.269,0.005,0.219,0.547,0.472,-0.522,-2.059,1.754],[-0.476,0.181,0.991,-0.094,-0.173,0.747,0.812,-0.196,0.793,-0.2,1.47,-0.002,0.706,0.15,0.926,-0.135,1.629,0,0.679,-0.17,-1.241,-0.954,0.765,-1.202,0.251,-0.331,-0.04,0.262,-0.046,-0.282,1.505,1.149,-1.558,-0.337],[0.754,-0.105,0.507,-0.741,-1.72,1.25,-0.277,0.013,0.424,0.106,-0.449,-0.21,-0.618,1.904,-1.631,-0.504,0.174,1.353,0.864,-0.243,1.285,2.19,0.991,0.031,0.027,-0.258,-0.326,-1.355,-0.286,-1.343,-0.788,0.69,1.335,0.842],[1.117,0.254,0.331,0.014,-0.338,1.569,-0.241,0.548,-0.131,-0.262,0.201,0.253,-0.401,-1.375,0.03,0.576,1.91,1.512,-0.594,-0.701,0.728,0.237,-0.782,-0.593,3.571,-0.089,0.306,-0.468,-1.55,1.928,-0.112,0.517,0.519,1.314]],"b1":[-1.199,-0.287,0.803,-1.057,-0.433,1.177,1.215,-0.721,-0.67,-1.189],"w2":[1.352,1.061,-1.806,0.706,-0.734,1.721,-1.236,1.152,0.855,-1.965],"b2":0.2}};

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
    // Fast path: every attack is examined right away with short windows that start at the
    // attack (see _look). `fast: false` leaves only the long-window path.
    this.fast = opts.fast ?? true;
    this.opts = opts;
    this._lookInit();
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
    this.pianoSeen = []; // times of notes that prove the piano is being played (_pianoKnown)
    this.pianoAll = [];
    this.pianoOpen = false;
    this.fastAt = new Map(); // midi -> attack time of the last note the fast path emitted
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
    if (this.expected.size) this.lessonT = Math.max(0, this.pos) / this.sr;
    if (range !== undefined) this.range = range;
  }

  // A piece is being played: the app gave its range, or notes were due in the last 3 s.
  _inLesson() {
    return !!this.range || (this.lessonT != null && this.pos / this.sr - this.lessonT < 3);
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
    if (this.lookF) for (const F of this.lookF) this.lookCands[F] = this._lookTable(this.sr / F, F / 2 - 2);
  }

  // Candidate partials for the fast path's short windows (zero padded to an F-point FFT).
  _lookTable(binHz, maxBin) {
    const out = [];
    const fmax = Math.min(6000, maxBin * binHz);
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      const st = stretchCents(m);
      const f0 = this.a4 * Math.pow(2, (this.tuningCents + st) / 1200) * Math.pow(2, (m - 69) / 12);
      const etRatio = Math.pow(2, -st / 1200);
      const B = inharmonicity(m);
      const partials = [];
      let eSum = 0;
      for (let h = 1; h <= 16; h++) {
        const f = h * f0 * Math.sqrt(1 + B * h * h);
        if (f > fmax) break;
        const c = f / binHz;
        const cLo = Math.min(c, c * etRatio),
          cHi = Math.max(c, c * etRatio);
        const stretch = B * h * h;
        const tol = 0.0145 + (m < 30 || m > 96 ? 0.004 : 0);
        const lo = Math.max(1, Math.min(Math.round(c) - 1, Math.floor(cLo * (1 - tol - Math.min(0.008, 0.15 * stretch)))));
        const hi = Math.min(maxBin, Math.max(Math.round(c) + 1, Math.ceil(cHi * (1 + tol + Math.min(0.015, 0.35 * stretch)))));
        if (lo >= hi) break;
        const e = partialWeight(h, f0);
        if (h <= 8) eSum += e;
        // between this partial and the next: where a string puts no energy
        const q = Math.round((f + 0.5 * f0) / binHz);
        partials.push({ h, lo, hi, f, g: (f0 + ALPHA) / (h * f0 + BETA), e, q: q < maxBin ? q : -1 });
      }
      out.push({ midi: m, f0, partials, eSum: eSum || 1 });
    }
    return out;
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
    if (this.looks.length) this._runLooks();
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
      if (medium && w.t - this.lastOnsetTime > 0.045) {
        this.pendingRestrike.push(w);
        // a soft note (after a loud one, or a bass note's soft hammer) may start here
        if (this.fast && !this.calibrating) this._lookStart(w);
      }
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
        if (this.fast && !this.calibrating) this._lookStart(o);
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

  // The piano has been heard for sure: several notes that the long-window path was confident
  // about, or that were due in the lesson. (Fast-path guesses never count, or one
  // false note in a noisy room could open the door to the next.)
  _pianoKnown() {
    const now = this.pos / this.sr;
    const S = this.pianoSeen;
    while (S.length && S[0] < now - 20) S.shift();
    const A = this.pianoAll;
    while (A.length && A[0] < now - 20) A.shift();
    if (this.pianoLevel == null) return (this.pianoOpen = false);
    // opens on >= 6 notes the long window was sure of (or that were due) within 15 s, stays
    // open while notes keep coming (>= 3 in 20 s, fast ones included)
    if (this.pianoOpen) this.pianoOpen = A.length >= 3;
    else this.pianoOpen = S.filter((v) => v >= now - 15).length >= 6;
    return this.pianoOpen;
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
    if (conf >= 0.8) {
      const now = this.pos / this.sr;
      if (conf >= 0.85 && (this.emitPath !== 'fast' || this.expected.has(midi))) this.pianoSeen.push(now);
      this.pianoAll.push(now);
      if (this.pianoSeen.length > 32) this.pianoSeen.shift();
      if (this.pianoAll.length > 32) this.pianoAll.shift();
    }
    if (this.emitPath === 'fast' && !restrike) this.fastAt.set(midi, t);
    if (!restrike) {
      this.active.set(midi, { on: t, missing: 0, sal, lastStrike: t, conf, fresh: true });
      this.emittedAt.set(midi, t);
      this.pending.delete(midi);
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
      // the fast path reported this key moments ago: the long window lost it for a few frames,
      // a later (noise) attack did not strike it again
      const fa = this.fastAt.get(d.midi);
      if (fa != null && attack.t > fa && attack.t - fa < 0.1 && !this.expected.has(d.midi)) continue;
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
    // During a piece, an unexpected note the fast path examined at this attack - in a register
    // its windows resolve - and found unlikely is a ghost of the notes that are due (their
    // octaves, twelfths, neighbours), not a wrong key.
    if (decision === 'emit' && !expected && this._inLesson() && this._lookVeto(p.midi, p.attack)) decision = 'reject';
    // In free play only a clear "no" from the fast path counts (it may miss soft notes).
    else if (decision === 'emit' && !expected && !this._inLesson() && this.vetoFree && this._lookVeto(p.midi, p.attack, this.vetoFree)) decision = 'reject';
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

  _lookVeto(midi, attack, pmin = this.vetoP) {
    const lk = attack && attack.look;
    if (!lk || !lk.fminDone || this.cands[midi - MIDI_MIN].f0 < lk.fminDone) return false;
    const r = lk.notes.get(midi);
    if (pmin < 0) return !r || !r.n; // never found in what the attack added
    return !r || (r.pmax || 0) < pmin;
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
        // Likewise a new note above whose partials are all partials of this one (octave,
        // twelfth, double octave, ...): it raised every 2nd / 3rd / 4th... partial of this note.
        if (fresh.some((f) => Math.abs(f - midi) <= 2 || [12, 19, 24, 28, 31, 36].includes(Math.abs(midi - f)))) continue;
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
      // during a piece, only the notes that are due are struck again (a sounding bass note
      // whose high partial a new note shares is not)
      if (this._inLesson()) hits = hits.filter((c) => this.expected.has(c.midi));
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
        if (this._inLesson() && !this.expected.has(m)) continue;
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

  // --- fast path: decide at the attack --------------------------------------------------------
  // Every attack is examined with a ladder of short windows that start at the attack (21, 32,
  // 43, 64, 85 ms at 48 kHz). The power spectrum after the attack minus the one just before it
  // holds only what the attack added, so notes that were already ringing (legato, pedal,
  // repeated chords) cancel out. Each window resolves notes down to some register (partials
  // must be about two main-lobe widths apart): treble notes can be decided ~21 ms after the
  // attack, the bass later; the bottom octave is left to the long window.
  // At every look the candidates are: the notes found in the difference spectrum (iterative
  // detection with cancellation, as the long window does), the expected notes and the sounding
  // notes (struck again?) this window resolves. A small fitted model (LOOK_MODEL,
  // tests/look-fit.js) turns their evidence into a probability that the key was struck at this
  // attack; clear cases are emitted at once, the rest go on to the long-window path as before.
  _lookInit() {
    const k = this.sr > 60000 ? 2 : 1;
    this.lookSizes = [1024, 1536, 2048, 3072, 4096].map((L) => L * k);
    this.lookF = [4096 * k, 8192 * k];
    this.lookMargin = 1.6; // resolvable: f0 >= margin * two main-lobe half-widths
    this.lookModel = this.opts.lookModel || LOOK_MODEL;
    this.vetoP = 0.3; // see _lookVeto
    this.freeNeed = this.opts.freeNeed ?? 0.8;
    this.restrikeNeed = this.opts.restrikeNeed ?? 0.85; // + 0.2 * strictness: a sounding note struck again // + 0.15 * strictness: an unexpected note in free play
    this.vetoFree = this.opts.vetoFree ?? 0;
    this.lookCollect = this.opts.lookCollect || null; // fitting: every look candidate's features
    this.lookFFT = {};
    this.lookCands = {};
    this.lookWin = {};
    this.lookBands = {};
    for (const F of this.lookF) {
      this.lookFFT[F] = new FFT(F);
      const bh = this.sr / F;
      const centers = [];
      for (let f = 40; f < 7000; f *= Math.pow(2, 1 / 3)) centers.push(f / bh);
      this.lookBands[F] = centers;
    }
    for (const L of this.lookSizes) this.lookWin[L] = hann(L);
    const nb = this.lookF[1] / 2 + 1;
    this.lookFrame = new Float32Array(this.lookSizes[this.lookSizes.length - 1]);
    this.lookA = new Float64Array(nb);
    this.lookB = new Float64Array(nb);
    this.lookY = new Float64Array(nb);
    this.lookD = new Float64Array(nb);
    this.lookR = new Float64Array(nb);
    this.lookNP = new Float64Array(nb);
    this.lookSig = new Float64Array(64);
    this.looks = [];
  }

  _lookStart(o) {
    const s0 = Math.round(o.t * this.sr) - Math.round(0.002 * this.sr);
    // an attack ends the examination windows of the previous ones (a weak peak does not)
    if (!o.weak) for (const l of this.looks) if (l.end > s0) l.end = s0;
    const l = { o, s0, k: 0, end: Infinity, notes: new Map(), done: new Set(), fminDone: 0, emitted: [] };
    o.look = l;
    this.looks.push(l);
  }

  _runLooks() {
    const n = this.lookSizes.length;
    for (const l of this.looks) {
      while (l.k < n) {
        const L = this.lookSizes[l.k];
        if (l.s0 + L > this.pos) break;
        if (l.s0 + L > l.end + 0.004 * this.sr) {
          l.k = n;
          break;
        }
        this._look(l, L, l.k);
        l.k++;
      }
    }
    this.looks = this.looks.filter((l) => l.k < n);
  }

  _look(l, L, li) {
    const F = L <= this.lookSizes[2] ? this.lookF[0] : this.lookF[1];
    const fft = this.lookFFT[F];
    const nb = F / 2;
    const binHz = this.sr / F;
    const w = this.lookWin[L];
    const mask = this.ringSize - 1;
    const fr = this.lookFrame.subarray(0, L);
    const s0 = l.s0;
    for (let i = 0; i < L; i++) fr[i] = this.ring[(s0 + i) & mask] * w[i];
    const A = fft.magnitude(fr, this.lookA); // after the attack
    for (let i = 0; i < L; i++) fr[i] = this.ring[(s0 - L + i) & mask] * w[i];
    const B = fft.magnitude(fr, this.lookB); // just before it
    const maxK = Math.min(nb - 1, Math.floor(6500 / binHz));
    // noise power per bin for this window, from the tracked long-window floor
    const NP = this.lookNP;
    const nE = this.floorWarm || this.hasNoise ? this.nEff : null;
    const scale = (1.27 * L) / this.win;
    const r = binHz / this.binHz;
    for (let k = 0; k <= maxK; k++) {
      const v = nE ? nE[Math.min(this.maxBin, Math.round(k * r))] : 0;
      NP[k] = v * v * scale + 1e-14;
    }
    // what the attack added (power), above the noise's fluctuations; magnitude-like
    const D = this.lookD;
    const Y = this.lookY;
    let raw = 0;
    for (let k = 0; k <= maxK; k++) {
      const d = k < 3 ? 0 : A[k] * A[k] - B[k] * B[k] - 3 * NP[k];
      D[k] = d > 0 ? Math.sqrt(d) : 0;
      Y[k] = D[k];
      if (D[k] > raw) raw = D[k];
    }
    if (raw * (4 / L) < 2.5e-4 / this.sensitivity) {
      l.fminDone = (this.lookMargin * 2 * this.sr) / L;
      return; // nothing new stands out
    }
    // spectral flatness of what was added (dB): ~0 for a broadband burst (clap, knock),
    // strongly negative for strings
    let lg = 0,
      ar = 0,
      nf = 0;
    for (let k = Math.ceil(100 / binHz); k <= Math.min(maxK, Math.floor(5000 / binHz)); k++) {
      const v = D[k] * D[k] + 1e-3 * raw * raw;
      lg += Math.log(v);
      ar += v;
      nf++;
    }
    const flat = nf ? 10 * Math.log10(Math.exp(lg / nf) / (ar / nf)) : 0;
    this._whitenLook(Y, F, maxK);
    const cands = this.lookCands[F];
    const fmin = (this.lookMargin * 2 * this.sr) / L;
    const all = this._lookDetect(Y, cands, fmin, F, L, maxK);
    const found = all.filter((f) => !f.blocker);
    // an unresolved bass note dominates what was added: decide nothing at this window
    let best = 0,
      bestBlk = 0;
    for (const f of all) {
      if (f.blocker) bestBlk = Math.max(bestBlk, f.score);
      else best = Math.max(best, f.score);
    }
    const defer = bestBlk >= 0.7 * best && bestBlk >= 1;
    // candidates: found, plus expected and sounding notes this window resolves
    const byMidi = new Map(found.map((f) => [f.midi, f]));
    const extra = (m) => {
      if (byMidi.has(m) || l.done.has(m) || m < MIDI_MIN || m > MIDI_MAX) return;
      const c = cands[m - MIDI_MIN];
      if (c.f0 < fmin || !c.partials.length) return;
      const f = { midi: m, salience: 0, ratio: 0, score: 0, rank: 9, found: false };
      found.push(f);
      byMidi.set(m, f);
    };
    for (const m of this.expected) extra(m);
    for (const m of this.active.keys()) extra(m);
    const salY = new Float64Array(130).fill(-1);
    const x = { l, L, li, F, A, B, NP, D, Y, maxK, fmin, binHz, cands, found, byMidi, flat, salY, defer, blk: bestBlk / (best + 1e-9) };
    this._lookRelate(x);
    l.fminDone = fmin;
    // new notes first: a sounding note is not "struck again" by a new note whose partials it shares
    for (const f of found) if (!this.active.has(f.midi)) this._lookDecide(f, x);
    for (const f of found) if (this.active.has(f.midi)) this._lookDecide(f, x);
  }

  _whitenLook(Y, F, maxK) {
    const C = this.lookBands[F];
    const nb = C.length;
    const sig = this.lookSig;
    let maxSig = 0;
    for (let b = 0; b < nb; b++) {
      const c = C[b];
      const lo = b > 0 ? C[b - 1] : c / 1.26;
      const hi = b < nb - 1 ? C[b + 1] : c * 1.26;
      let s = 0,
        w = 0;
      for (let k = Math.max(1, Math.floor(lo)); k <= Math.min(maxK, Math.ceil(hi)); k++) {
        const tri = k < c ? (k - lo) / (c - lo) : (hi - k) / (hi - c);
        if (tri <= 0) continue;
        s += tri * Y[k] * Y[k];
        w += tri;
      }
      sig[b] = w > 0 ? Math.sqrt(s / w) : 0;
      if (sig[b] > maxSig) maxSig = sig[b];
    }
    const floor = maxSig * 0.01 + 1e-12;
    let b = 0;
    for (let k = 0; k <= maxK; k++) {
      while (b < nb - 2 && C[b + 1] < k) b++;
      if (Y[k] === 0) continue;
      const c0 = C[b],
        c1 = C[b + 1];
      let s;
      if (k <= c0) s = sig[b];
      else if (k >= c1) s = sig[b + 1];
      else s = sig[b] + ((sig[b + 1] - sig[b]) * (k - c0)) / (c1 - c0);
      Y[k] *= Math.pow(Math.max(s, floor), -0.67);
    }
    let ymax = 0;
    for (let k = 3; k <= maxK; k++) if (Y[k] > ymax) ymax = Y[k];
    if (ymax > 0) for (let k = 0; k <= maxK; k++) Y[k] /= ymax;
  }

  // Iterative "strongest note, cancel its partials" (as _iterativeDetect) over the notes this
  // window resolves.
  _lookDetect(Y, cands, fmin, F, L, maxK) {
    // Notes down to fmin / 2.5 take part as "blockers": this window cannot resolve them (their
    // partials merge), but a bass note sounding there must explain its own partials before a
    // higher note may claim them. Blockers are never decided at this window.
    const fblk = Math.max(26, fmin / 2.5);
    const R = this.lookR;
    for (let k = 0; k <= maxK; k++) R[k] = Y[k];
    const found = [];
    const baseT = 0.44 / this.sensitivity;
    const refT = 0.5 / this.sensitivity;
    const tmp = this._tmp;
    const taken = new Uint8Array(128);
    const half = Math.ceil((2 * F) / L); // main-lobe half width in bins
    let first = 0;
    for (let iter = 0; iter < 8; iter++) {
      let best = null,
        bestScore = 0,
        bestSal = 0;
      for (const c of cands) {
        if (c.f0 < fblk || taken[c.midi] || !c.partials.length) continue;
        const s = this._salience(c, R, null);
        let thr = baseT;
        if (this.expected.has(c.midi) && c.f0 >= fmin) thr *= 0.7;
        const score = s / thr;
        if (score > bestScore) {
          bestScore = score;
          best = c;
          bestSal = s;
        }
      }
      if (!best || bestScore < 0.7) break;
      if (iter === 0) first = bestSal;
      taken[best.midi] = 1;
      found.push({ midi: best.midi, salience: bestSal, ratio: bestSal / refT, score: bestScore, rank: iter, relSal: first > 0 ? bestSal / first : 1, found: true, blocker: best.f0 < fmin });
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
        for (let k = Math.max(0, k0 - half); k <= Math.min(maxK, k0 + half); k++) R[k] *= keep;
      }
    }
    return found;
  }

  // Amplitudes (difference spectrum) of a note's first partials; 0 where out of range.
  _lookAmps(c, D, maxK) {
    const out = new Float64Array(13);
    const P = c.partials;
    for (let i = 0; i < P.length && P[i].h <= 12; i++) {
      const p = P[i];
      if (p.hi > maxK) break;
      let m = 0;
      for (let k = p.lo; k <= p.hi; k++) if (D[k] > m) m = D[k];
      out[p.h] = m;
    }
    return out;
  }

  // Relations between the candidates of one look:
  //  - unique support: energy at partials that no other found note explains (a ghost made of
  //    other notes' partials has none);
  //  - a note whose partials are all partials of a lower found note (octave, twelfth, double
  //    octave above) is only there if those partials stand out of the lower note's envelope.
  _lookRelate(x) {
    const { D, maxK, cands, found, byMidi, L } = x;
    const tolHz = this.sr / L;
    for (const f of found) f.amps = this._lookAmps(cands[f.midi - MIDI_MIN], D, maxK);
    let gmax = 0;
    for (let k = 3; k <= maxK; k++) if (D[k] > gmax) gmax = D[k];
    const real = found.filter((g) => g.found);
    for (const f of found) {
      const c = cands[f.midi - MIDI_MIN];
      f.under = 0;
      f.excess = 1;
      for (const [iv, k] of [
        [12, 2],
        [19, 3],
        [24, 4],
      ]) {
        const low = byMidi.get(f.midi - iv);
        if (low && low.found) {
          f.under = iv;
          f.excess = this._excess(low.amps, k);
          break;
        }
      }
      let nu = 0,
        np = 0,
        mx = 0;
      for (let h = 1; h <= 8; h++) mx = Math.max(mx, f.amps[h]);
      for (const p of c.partials) {
        if (p.h > 8 || p.hi > maxK || p.f < 60) continue;
        let shared = false;
        for (const g of real) {
          if (g === f || g.midi === f.midi) continue;
          const gc = cands[g.midi - MIDI_MIN];
          for (const q of gc.partials) {
            if (q.f > p.f + tolHz) break;
            if (Math.abs(q.f - p.f) <= tolHz) {
              shared = true;
              break;
            }
          }
          if (shared) break;
        }
        if (shared) continue;
        nu++;
        const a = f.amps[p.h];
        if (a >= 0.2 * mx && a >= 0.03 * gmax) np++;
      }
      f.uniq = nu;
      f.uniqPresent = np;
      f.share = mx / (gmax + 1e-12); // strength of the note's strongest partial in what was added
    }
  }

  // How much the partials that are multiples of k stand out of the envelope of the others:
  // geometric mean of a[h] / sqrt(a[h-1] a[h+1]) over h = k, 2k, ... (1 = no sign of a note
  // above). 1 when it cannot be told.
  _excess(a, k) {
    let s = 0,
      n = 0;
    for (let h = k; h <= 12; h += k) {
      const lo = a[h - 1],
        hi = h + 1 <= 12 ? a[h + 1] : 0;
      const env = hi > 0 && lo > 0 ? Math.sqrt(lo * hi) : lo > 0 ? lo : 0;
      if (!(env > 0)) continue;
      s += Math.log(Math.max(0.05, Math.min(20, a[h] / env)));
      n++;
    }
    return n ? Math.exp(s / n) : 1;
  }

  // Evidence that a candidate is a string that was just struck: its partials rose at the attack
  // (and the gaps between them did not), how far above the noise, how loud.
  _lookEvidence(c, A, B, NP, L, F) {
    const P = c.partials;
    const rises = [];
    let sig = 0,
      nz = 0,
      dP = 0,
      dO = 0,
      mx = 0,
      nsig = 0;
    const n = Math.min(P.length, 10);
    const pk = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const p = P[i];
      let k = p.lo;
      for (let j = p.lo + 1; j <= p.hi; j++) if (A[j] > A[k]) k = j;
      pk[i] = k;
      if (p.f >= 60 && A[k] * A[k] > mx) mx = A[k] * A[k];
    }
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (p.f < 60) continue;
      const k = pk[i];
      const a = A[k] * A[k];
      const b = B[k] * B[k];
      const nn = NP[k];
      sig += a;
      nz += nn;
      if (a < 4 * nn || a < mx * 0.02) continue;
      nsig++;
      rises.push((a + 1e-14) / (b + 1e-14 + a * 1e-3));
      dP += Math.max(0, a - b);
      if (p.q > 0) dO += Math.max(0, A[p.q] * A[p.q] - B[p.q] * B[p.q]);
    }
    rises.sort((u, v) => u - v);
    const amp = (4 / L) * Math.sqrt(sig);
    // tonality (peak over flanks just outside the main lobe) and pitch (cents from where this
    // piano puts the partial) of the strongest partials
    const lobe = Math.round((2 * F) / L); // main-lobe half width in bins
    const top = F / 2;
    let wT = 0,
      tsum = 0,
      wD = 0,
      dsum = 0;
    const binHz = this.sr / F;
    for (let i = 0; i < n && i < 6; i++) {
      const p = P[i];
      if (p.f < 60) continue;
      const k = pk[i];
      const a = A[k];
      if (a * a < 4 * NP[k] || a * a < mx * 0.02 || k < 2 || k + 1 >= top) continue;
      let fs = 0,
        fn = 0;
      for (let d = Math.round(lobe * 1.25); d <= Math.round(lobe * 2); d++) {
        if (k - d > 0) {
          fs += A[k - d];
          fn++;
        }
        if (k + d < top) {
          fs += A[k + d];
          fn++;
        }
      }
      const w = a * a;
      const isPk = a >= A[k - 1] && a >= A[k + 1];
      tsum += w * (isPk ? clamp(20 * Math.log10(a / (fs / Math.max(1, fn) + 1e-12)), 0, 40) : 0);
      wT += w;
      if (!isPk || i > 3) continue;
      const lA = Math.log(A[k - 1] + 1e-12),
        lB = Math.log(a + 1e-12),
        lC = Math.log(A[k + 1] + 1e-12);
      const den = lA - 2 * lB + lC;
      const off = den < 0 ? clamp((0.5 * (lA - lC)) / den, -0.5, 0.5) : 0;
      const fm = (k + off) * binHz;
      const et = p.f * Math.pow(2, -stretchCents(c.midi) / 1200);
      const c1 = 1200 * Math.log2(fm / p.f),
        c2 = 1200 * Math.log2(fm / et);
      const ce = c1 * c2 <= 0 ? 0 : Math.abs(c1) < Math.abs(c2) ? c1 : c2;
      wD += w;
      dsum += w * ce;
    }
    return {
      tonal: wT > 0 ? tsum / wT : 0,
      dev: wD > 0 ? dsum / wD : 0,
      hasDev: wD > 0,
      riseMed: rises.length ? rises[(rises.length - 1) >> 1] : 1,
      riseLow: rises.length ? rises[Math.floor((rises.length - 1) / 4)] : 1,
      harm: (dP + 1e-14) / (dO + 1e-14 + dP * 0.01),
      snr: 10 * Math.log10((sig + 1e-20) / (nz + 1e-20)),
      level: 10 * Math.log10((amp * amp) / 2 + 1e-20),
      amp,
      nsig,
    };
  }

  // New energy at the half / third of f0 that a lower note this window cannot resolve yet
  // would put there: the candidate may be that note's partial, not a note.
  _lookSub(c, Y, binHz, maxK, fmin) {
    let own = 0;
    for (let i = 0; i < c.partials.length && i < 4; i++) {
      const p = c.partials[i];
      let m = 0;
      for (let k = p.lo; k <= p.hi; k++) if (Y[k] > m) m = Y[k];
      own = Math.max(own, m);
    }
    let worst = 0;
    for (const d of [2, 3]) {
      const fl = c.f0 / d;
      if (fl >= fmin || fl < 25) continue;
      let e = 0;
      let n = 0;
      for (let j = 1; j < 3 * d; j++) {
        if (j % d === 0) continue;
        const k0 = Math.round((fl * j) / binHz);
        if (k0 >= maxK) break;
        let m = 0;
        for (let k = Math.max(1, k0 - 1); k <= Math.min(maxK, k0 + 1); k++) if (Y[k] > m) m = Y[k];
        e += m;
        n++;
      }
      if (n) worst = Math.max(worst, e / n / (own + 1e-9));
    }
    return worst;
  }

  // Harmonic salience of a key in this look's (whitened) difference spectrum, cached.
  _lookSal(x, m) {
    if (m < MIDI_MIN || m > MIDI_MAX) return 0;
    if (x.salY[m] < 0) {
      const c = x.cands[m - MIDI_MIN];
      x.salY[m] = c.partials.length ? this._salience(c, x.Y, null) : 0;
    }
    return x.salY[m];
  }

  // Features of a look candidate for LOOK_MODEL (all roughly in -3..3).
  _lookFeatures(f, x, ev, rec, sub, exp, act) {
    const m = f.midi;
    const s0 = this._lookSal(x, m) + 1e-6;
    const n1 = Math.max(this._lookSal(x, m - 1), this._lookSal(x, m + 1)) + 1e-6;
    const n2 = Math.max(this._lookSal(x, m - 2), this._lookSal(x, m + 2)) + 1e-6;
    let expNbr = 0;
    for (const e of this.expected) if (e !== m && Math.abs(e - m) <= 2) expNbr = 1;
    const c = x.cands[m - MIDI_MIN];
    const sr = c.partials.length ? this._salience(c, this.lookR, null) : 0;
    const thr = (0.44 / this.sensitivity) * (this.expected.has(m) ? 0.7 : 1);
    const rel = this.pianoLevel != null ? ev.level - this.pianoLevel : null;
    const o = x.l.o;
    return {
      look: x.li / 4,
      found: f.found ? 1 : 0,
      sc: f.found ? clamp(Math.log2(f.score), -1, 3) : -1.5,
      rank: f.found ? clamp(f.rank / 3, 0, 2) : 2.5,
      relSal: f.found ? clamp(f.relSal, 0, 1) : 0,
      rise: clamp(Math.log10(ev.riseMed), -1, 3),
      riseLow: clamp(Math.log10(ev.riseLow), -1, 3),
      harm: clamp(Math.log10(ev.harm), -1, 2),
      snr: clamp((ev.snr - 20) / 10, -3, 3),
      rel: rel == null ? 0 : clamp(rel / 10, -4, 1),
      relKnown: rel == null ? 0 : 1,
      sub: clamp(sub, 0, 2),
      uniqN: clamp(f.uniq / 4, 0, 2),
      uniqFrac: f.uniq ? f.uniqPresent / f.uniq : 0.5,
      under: f.under ? 1 : 0,
      excess: f.under ? clamp(Math.log2(f.excess), -2, 3) : 0,
      share: clamp(Math.log10(f.share + 1e-6), -3, 0),
      exp: exp ? 1 : 0,
      active: act ? 1 : 0,
      prev: rec.n > 1 ? 1 : 0,
      ampRatio: rec.n > 1 && rec.prevAmp > 0 ? clamp(Math.log2(rec.amp / rec.prevAmp), -3, 3) : 0,
      onset: clamp(Math.log2(o.strength / (o.thresh || 0.07)), -2, 4),
      f0: clamp(Math.log2(this.lookCands[x.F][f.midi - MIDI_MIN].f0 / 262), -3, 3),
      nsig: clamp(ev.nsig / 5, 0, 2),
      tonal: clamp(ev.tonal / 10, 0, 4),
      flat: clamp(x.flat / 10, -4, 0),
      dev: ev.hasDev ? clamp(Math.abs(ev.dev) / 10, 0, 4) : 1,
      ddev: ev.hasDev && rec.hasDev ? clamp(Math.abs(ev.dev - rec.dev) / 10, 0, 4) : 0,
      ctr1: clamp(Math.log2(s0 / n1), -3, 3),
      ctr2: clamp(Math.log2(s0 / n2), -3, 3),
      expNbr,
      resid: f.found ? 0 : clamp(Math.log2((sr + 1e-6) / s0), -4, 1),
      residSc: f.found ? 0 : clamp(Math.log2(sr / thr + 1e-3), -4, 2),
      blk: clamp(x.blk, 0, 2),
      weak: o.weak ? 1 : 0,
    };
  }

  _lookDecide(f, x) {
    const { l, L, F, A, B, NP, Y, maxK, fmin, cands } = x;
    const m = f.midi;
    if (l.done.has(m)) return;
    const c = cands[m - MIDI_MIN];
    const ev = this._lookEvidence(c, A, B, NP, L, F);
    let rec = l.notes.get(m);
    if (!rec) l.notes.set(m, (rec = { n: 0, amp: 0, prevAmp: 0 }));
    if (f.found) rec.n++;
    rec.prevAmp = rec.amp;
    rec.amp = ev.amp;
    const exp = this.expected.has(m);
    const st = this.active.get(m);
    const sub = this._lookSub(c, Y, this.sr / F, maxK, fmin);
    const feats = this._lookFeatures(f, x, ev, rec, sub, exp, !!st);
    if (ev.hasDev) {
      rec.hasDev = true;
      rec.dev = ev.dev;
    }
    const M = this.lookModel;
    const p = 1 / (1 + Math.exp(-evalModel(exp ? M.exp || M : M.free || M, feats)));
    rec.pmax = Math.max(rec.pmax || 0, p);
    if (this.lookCollect) this.lookCollect({ look: x.li, midi: m, attackT: l.o.t, exp, active: !!st, found: f.found, n: rec.n, x: feats, p, defer: x.defer, range: this._inLesson() });
    if (this.onCandidate && this.debugLook) this.onCandidate({ look: L, midi: m, attackT: l.o.t, exp, active: !!st, f, ev, sub, x: feats, p, defer: x.defer });
    if (x.defer) return;
    const sens = Math.sqrt(this.sensitivity);
    const s = this.strictness;
    if (st) {
      // sounding already: struck again?
      if (l.o.t - st.lastStrike < 0.08) return;
      if (!exp && (this._inLesson() || !this._pianoKnown())) return; // a wrong / unknown key struck again can wait
      let need = (exp ? this.restrikeNeed + 0.2 * s : this.restrikeNeed + 0.05 + 0.1 * s) / sens;
      // a note just struck above whose partials are all partials of this one (octave, twelfth,
      // double octave...) or right next to it raises this one's partials too
      if (l.emitted.some((n) => Math.abs(n - m) <= 2 || [12, 19, 24, 28, 31, 34, 36].includes(n - m))) need = Math.max(need, 0.97);
      if (p < need) return;
      l.done.add(m);
      st.lastStrike = l.o.t;
      st.missing = 0;
      this.stats.fastRestrikes = (this.stats.fastRestrikes || 0) + 1;
      this.emitPath = 'fast';
      this._emit(m, l.o.t, Math.min(0.97, Math.max(st.conf, p)), st.sal, ev.level - 3, true);
      this.emitPath = null;
      return;
    }
    if (this.emittedAt.get(m) === l.o.t) {
      l.done.add(m);
      return;
    }
    let need;
    if (exp) need = this.expNeed ?? 0.85 + 0.15 * s;
    else {
      // an unexpected note is only trusted this early when the listener knows how loud the
      // piano is (never on noise alone) and the note was seen in two windows (not a click)
      if (!this._pianoKnown() || rec.n < 2) return;
      // during a piece (lesson hints), a wrong note can wait for the long window: it must not
      // be a ghost of the notes that are due
      if (this._inLesson()) return;
      need = this.freeNeed + 0.15 * s;
      if (this.range && (m < this.range[0] - 5 || m > this.range[1] + 5)) need = Math.min(0.99, need + 0.05);
    }
    if (p < need / sens) return;
    l.done.add(m);
    this.stats.fast = (this.stats.fast || 0) + 1;
    l.emitted.push(m);
    if (l.o.weak && !l.o.reported) {
      l.o.reported = true;
      this.onOnset(l.o.t, l.o.strength);
    }
    this.emitPath = 'fast';
    this._emit(m, l.o.t, exp ? Math.max(0.6, p) : p, f.salience || 1, ev.level - 3);
    this.emitPath = null;
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
    this.looks = [];
  }
}
