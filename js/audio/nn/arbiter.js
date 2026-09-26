// Free-play arbiter of the hybrid listener (hybrid-transcriber.js): decides which of the two
// engines' notes are reported when the app does not know what should be played.
//
// Candidates:
//   - a DSP note (js/audio/transcriber.js) when it arrives: report it or drop it (the DSP's
//     long window hears partials of a struck note as notes of their own - its octave, twelfth,
//     double octave - and room noise in the gaps);
//   - a network note (nn-transcriber.js) the DSP has not reported: at every network frame
//     (10 ms), report it now, wait, or - past its deadline - drop it.
// Each decision is a small logistic model over what both engines know at that moment: the
// network's onset probability for the key (now, and its peak since the attack), its "sounding"
// probability, the DSP's confidence and which of its paths decided, whether the other engine
// has the note, the notes reported for the same attack a harmonic interval below / above,
// neighbouring keys, how many notes the attack has, how long since the attack, the register,
// the DSP's onset strength at that attack and how much piano has been heard recently.
// The model (arbiter-model.js) is fitted by tools/nn/arbiter_fit.mjs on recordings of the
// TRAINING pianos only (tools/nn/arbiter_rec.mjs), and replayed there with this same code; the
// benchmark's held-out pianos are not used to fit it (one threshold, octave partners, was set by
// hand: docs/listening-model.md, "Free-play arbiter").

const GHOST_IV = [12, 19, 24, 28, 31];
const L = (p) => {
  const q = p < 1e-4 ? 1e-4 : p > 1 - 1e-4 ? 1 - 1e-4 : p;
  return Math.log(q / (1 - q));
};
const IP = 9; // index of 'partner' in FEATS.nn
const RING = 64; // frames of network output kept (0.64 s)
const TOL = 0.08; // same attack: same key within 80 ms (the benchmark's tolerance)

// Feature names, in the order the models' weights are stored. The model evaluates
// sum(w[i] * (x[i] - mu[i]) / sd[i]) + b.
export const FEATS = {
  dsp: ['conf', 'fast', 'lat', 'restrike', 'nnP', 'nnPf', 'nnEv', 'ghost', 'ghostP', 'oct', 'octX', 'octP', 'upOct', 'nbr', 'chord', 'onset', 'piano', 'quiet', 'lo', 'hi', 'reg'],
  nn: ['p', 'pmax', 'pf', 'age', 'ghost', 'ghostP', 'oct', 'octX', 'octP', 'partner', 'upOct', 'nbr', 'chord', 'onset', 'piano', 'quiet', 'lo', 'hi', 'reg', 'octR', 'upP', 'pfPre'],
};

export class FreeArbiter {
  // emit(midi, t, vel, info, src); model: { dsp: {w, b, mu, sd}, nn: {...}, thr: {...} }
  constructor(emit, model = null, opts = {}) {
    this.emit = emit;
    this.model = model;
    this.collect = opts.collect || null; // (kind, x, cand, now) for fitting
    this.reset();
  }

  reset() {
    this.reported = []; // [{midi, t, src, at}] of the last ~1.5 s
    this.cands = []; // network notes waiting
    this.dropped = []; // [{midi, t}] DSP notes the arbiter dropped
    this.P = Array.from({ length: RING }, () => new Float32Array(88));
    this.Pf = Array.from({ length: RING }, () => new Float32Array(88));
    this.PT = new Float64Array(RING).fill(-1e9);
    this.nf = 0;
    this.onsets = []; // DSP onsets [{t, s}]
    this.dspSeen = []; // times of confident DSP notes (piano being played)
    this.now = 0;
  }

  // ---- inputs --------------------------------------------------------------------------------
  onset(t, s) {
    this.onsets.push({ t, s: s || 0 });
    if (this.onsets.length > 64) this.onsets.shift();
  }

  frame(now, P, Pf) {
    const i = this.nf++ % RING;
    // at the resolution the arbiter was fitted on (tools/nn/arbiter_rec.mjs stores onset
    // probabilities as 16-bit and "sounding" ones as 8-bit values)
    const Pi = this.P[i],
      Fi = this.Pf[i];
    for (let k = 0; k < 88; k++) {
      Pi[k] = Math.round(P[k] * 65535) / 65535;
      Fi[k] = Pf ? Math.round(Pf[k] * 255) / 255 : 0;
    }
    this.PT[i] = now;
    this.now = now;
    this._check(now);
  }

  dsp(midi, t, vel, info, now) {
    this.now = now;
    this._trim(now);
    if (info.confidence >= 0.85) {
      this.dspSeen.push(now);
      if (this.dspSeen.length > 64) this.dspSeen.shift();
    }
    // the network already reported this attack (or a pending network note joins the DSP's)
    if (!info.restrike && this.reported.some((e) => e.midi === midi && e.src === 'nn' && Math.abs(e.t - t) <= TOL)) return;
    const ci = this.cands.findIndex((c) => c.midi === midi && Math.abs(c.t - t) <= TOL);
    const cand = ci >= 0 ? this.cands[ci] : null;
    if (ci >= 0) this.cands.splice(ci, 1);
    const x = this._dspX(midi, t, info, now, cand);
    const M = this.model && this.model.dsp;
    const p = M ? this._eval(M, x) : 1;
    if (this.collect) this.collect('dsp', x, { midi, t, restrike: !!info.restrike, p }, now);
    if (p >= this._thr('dsp', midi)) this._report(midi, t, vel, info, 'dsp', now);
    else this.dropped.push({ midi, t });
    this._check(now);
  }

  nn(midi, t, vel, info, now) {
    this.now = now;
    this._trim(now);
    if (info.restrike || this._has(midi, t) || this.dropped.some((d) => d.midi === midi && Math.abs(d.t - t) <= TOL)) return;
    if (this.cands.some((c) => c.midi === midi && Math.abs(c.t - t) <= TOL)) return;
    const p = info.p ?? 0;
    this.cands.push({ midi, t, vel, info, pmax: p, at: now });
    this._check(now);
  }

  // ---- decisions -----------------------------------------------------------------------------
  _thr(kind, midi, partner = 0) {
    // the octave partner of a note reported for the same attack (the DSP's weakest case: a note
    // hidden in the partials of the note an octave below) has a threshold of its own
    const TO = partner && this.model && this.model.thr && this.model.thr[kind + 'Oct'];
    if (TO != null && TO !== 0) return TO;
    const T = this.model && this.model.thr && this.model.thr[kind];
    if (T == null) return kind === 'dsp' ? 0 : 1.01;
    if (typeof T === 'number') return T;
    return midi < 48 ? T[0] : midi < 72 ? T[1] : T[2];
  }

  _deadline(midi) {
    const D = (this.model && this.model.deadline) || [0.3, 0.25, 0.25];
    return midi < 48 ? D[0] : midi < 72 ? D[1] : D[2];
  }

  _check(now) {
    if (!this.cands.length) return;
    const keep = [];
    const last = this.nf > 0 ? this.P[(this.nf - 1) % RING] : null;
    const M = this.model && this.model.nn;
    const MO = (this.model && this.model.nnOct) || M; // octave partners: a model of their own
    for (const c of this.cands) {
      if (this._has(c.midi, c.t)) continue;
      if (last) c.pmax = Math.max(c.pmax, last[c.midi - 21]);
      const x = this._nnX(c, now);
      const p = M ? this._eval(x[IP] ? MO : M, x) : 0;
      if (this.collect) this.collect('nn', x, { midi: c.midi, t: c.t, p, partner: x[IP] }, now);
      // (optional) the octave partner rule the hybrid had before the arbiter, kept as a floor
      const OR = this.model && this.model.octRule;
      const octRule = OR && x[IP] && c.pmax >= (c.midi < 60 ? OR[0] : OR[1]);
      if (octRule || p >= this._thr('nn', c.midi, x[IP])) this._report(c.midi, c.t, c.vel, { ...c.info, p: c.pmax, confidence: Math.max(c.info.confidence || 0, p) }, 'nn', now);
      // an octave partner may wait longer: whether it keeps sounding tells a played octave from
      // the partials of the lower note
      else if (now - c.t < (x[IP] && this.model && this.model.deadlineOct ? this.model.deadlineOct : this._deadline(c.midi))) keep.push(c);
    }
    this.cands = keep;
  }

  _eval(M, x) {
    // logistic model on standardised features, optionally plus a tanh hidden layer
    const xs = this._xs || (this._xs = new Float64Array(32));
    let z = M.b + (M.b2 || 0);
    for (let i = 0; i < x.length; i++) {
      xs[i] = (x[i] - M.mu[i]) / M.sd[i];
      z += M.w[i] * xs[i];
    }
    if (M.w2)
      for (let j = 0; j < M.w2.length; j++) {
        let h = M.b1[j];
        const Wj = M.W1[j];
        for (let i = 0; i < x.length; i++) h += Wj[i] * xs[i];
        z += M.w2[j] * Math.tanh(h);
      }
    return 1 / (1 + Math.exp(-z));
  }

  // ---- features ------------------------------------------------------------------------------
  // network onset probability peak for a key over frames in [t0, t1]
  _pmax(k, t0, t1, arr = this.P) {
    let m = 0;
    const n = Math.min(this.nf, RING);
    for (let j = 0; j < n; j++) {
      const i = (this.nf - 1 - j) % RING;
      const ft = this.PT[i];
      if (ft < t0) break;
      if (ft <= t1) {
        const v = arr[i][k];
        if (v > m) m = v;
      }
    }
    return m;
  }

  _common(midi, t, now) {
    const k = midi - 21;
    const t1 = Math.min(now, t + 0.15);
    // a struck note a harmonic interval below (reported for this attack, or strong in the network)
    let ghost = 0,
      ghostP = 0;
    for (const iv of GHOST_IV) {
      if (k - iv < 0) break;
      if (this.reported.some((e) => e.midi === midi - iv && Math.abs(e.t - t) <= 0.05)) ghost = 1;
      ghostP = Math.max(ghostP, this._pmax(k - iv, t - 0.03, t1));
    }
    // the octave below reported for this attack: a ghost, or the lower note of a played octave
    const oct = this.reported.some((e) => e.midi === midi - 12 && Math.abs(e.t - t) <= 0.05) ? 1 : 0;
    const octP = k >= 12 ? this._pmax(k - 12, t - 0.03, t1) : 0;
    const upOct = this.reported.some((e) => (e.midi === midi + 12 || e.midi === midi + 19) && Math.abs(e.t - t) <= 0.05) ? 1 : 0;
    let nbr = 0;
    for (const d of [-2, -1, 1, 2]) if (k + d >= 0 && k + d < 88) nbr = Math.max(nbr, this._pmax(k + d, t - 0.03, t1));
    let chord = 0;
    for (const e of this.reported) if (Math.abs(e.t - t) <= 0.05 && e.midi !== midi) chord++;
    for (const c of this.cands) if (Math.abs(c.t - t) <= 0.05 && c.midi !== midi) chord++;
    let onset = 0;
    for (const o of this.onsets) if (Math.abs(o.t - t) <= 0.03) onset = Math.max(onset, o.s);
    let piano = 0;
    for (const s of this.dspSeen) if (s > now - 10) piano++;
    const lastSeen = this.dspSeen.length ? now - this.dspSeen[this.dspSeen.length - 1] : 30;
    return {
      oct,
      octP: L(octP),
      ghost,
      ghostP: L(ghostP),
      upOct,
      nbr: L(nbr),
      chord: Math.min(chord, 6),
      onset: Math.log1p(Math.max(0, onset)),
      piano: Math.log1p(piano),
      quiet: Math.min(lastSeen, 10),
      lo: midi < 48 ? 1 : 0,
      hi: midi >= 84 ? 1 : 0,
      reg: (midi - 64) / 24,
    };
  }

  _dspX(midi, t, info, now, cand) {
    const k = midi - 21;
    const C = this._common(midi, t, now);
    const nnP = this._pmax(k, t - 0.03, Math.min(now, t + 0.15));
    const nnEv = cand ? 1 : this.reported.some((e) => e.midi === midi && e.src === 'nn' && Math.abs(e.t - t) <= 0.3) ? 0.5 : 0;
    const last = this.nf > 0 ? (this.nf - 1) % RING : -1;
    const pf = last >= 0 ? this.Pf[last][k] : 0;
    const x = { conf: L(info.confidence ?? 1), fast: info.path === 'fast' ? 1 : 0, lat: Math.min(now - t, 0.5), restrike: info.restrike ? 1 : 0, nnP: L(nnP), nnPf: L(pf), nnEv, ...C };
    x.octX = x.oct * x.nnP;
    return FEATS.dsp.map((f) => x[f]);
  }

  _nnX(c, now) {
    const k = c.midi - 21;
    const C = this._common(c.midi, c.t, now);
    const last = (this.nf - 1) % RING;
    const p = this.nf > 0 ? this.P[last][k] : c.pmax;
    const pf = this.nf > 0 ? this.Pf[last][k] : 0;
    const partner = this.reported.some((e) => Math.abs(e.t - c.t) <= 0.04 && (e.midi === c.midi - 12 || e.midi === c.midi + 12 || e.midi === c.midi - 24)) ? 1 : 0;
    const x = { p: L(p), pmax: L(c.pmax), pf: L(pf), age: Math.min(now - c.t, 0.5), partner, ...C };
    x.octX = x.oct * x.pmax;
    // octave partners: how sure the network is of this key vs the one an octave below; the
    // octave above; whether this key was already sounding before the attack
    x.octR = x.pmax - x.octP;
    x.upP = k + 12 < 88 ? L(this._pmax(k + 12, c.t - 0.03, Math.min(now, c.t + 0.15))) : -9.2;
    x.pfPre = L(this._pmax(k, c.t - 0.08, c.t - 0.03, this.Pf));
    return FEATS.nn.map((f) => x[f]);
  }

  // ---- bookkeeping ---------------------------------------------------------------------------
  _trim(now) {
    if (this.reported.length > 8 && now - this.reported[0].t > 1.5) this.reported = this.reported.filter((e) => now - e.t < 1.5);
    if (this.dropped.length > 8 && now - this.dropped[0].t > 1.5) this.dropped = this.dropped.filter((e) => now - e.t < 1.5);
    while (this.dspSeen.length && this.dspSeen[0] < now - 10) this.dspSeen.shift();
  }

  _has(midi, t, tol = TOL) {
    return this.reported.some((e) => e.midi === midi && Math.abs(e.t - t) <= tol);
  }

  _report(midi, t, vel, info, src, now) {
    this.reported.push({ midi, t, src, at: now });
    this.emit(midi, t, vel, info, src);
  }
}
