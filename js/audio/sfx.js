// Synthesized UI sound effects (Web Audio only, no files) with one cohesive character: soft
// glass/celesta tones, warm bells and airy noise, all in C major, with a small shared room.
//
// Two classes of sounds:
//  * MIC-SAFE ("in play") sounds live entirely above ~10.5 kHz: sine glints at 11-13.5 kHz
//    with smooth (raised-cosine) envelopes and band-passed noise at 12-15 kHz, forced through a
//    16th-order Butterworth high-pass at 10.5 kHz (>= 60 dB down below 8 kHz). The transcriber only analyses 0-9.5 kHz (onsets < 8 kHz),
//    so these can play while the microphone listens without creating false notes. They are
//    short and never overlap closely-spaced tones (which could intermodulate in a small speaker).
//  * FULL-RANGE sounds (menus, results, level-up, placement cues, ...) would be heard as notes.
//    Only play them while listening is muted, or through AudioEngine.playSfx(), which holds
//    the mic for the sound's duration automatically.
//
// Usage: const sfx = new Sfx(ctx, destination, { synth }); const secs = sfx.play('perfect');

export const SFX_INFO = {
  // full range (mic must be muted/held)
  tap: { safe: false, desc: 'UI tap / button click' },
  toggle: { safe: false, desc: 'switch toggled (opts.on = false plays the "off" direction)' },
  whoosh: { safe: false, desc: 'screen transition (opts.reverse for going back)' },
  success: { safe: false, desc: 'success chime (correct answer, exercise passed)' },
  bloop: { safe: false, desc: 'wrong-note bloop (full range, for quizzes/touch answers)' },
  error: { safe: false, desc: 'error / not possible' },
  star1: { safe: false, desc: 'first result star pops in' },
  star2: { safe: false, desc: 'second result star (higher)' },
  star3: { safe: false, desc: 'third result star (highest, with sparkle)' },
  streak: { safe: false, desc: 'streak / combo celebration on the results screen' },
  levelup: { safe: false, desc: 'level-up fanfare (uses the piano samples when loaded)' },
  complete: { safe: false, desc: 'lesson-complete jingle (uses the piano samples when loaded)' },
  countdown: { safe: false, desc: 'count-in beep 3-2-1 (full range)' },
  'countdown-go': { safe: false, desc: 'count-in "go" beep (full range)' },
  harder: { safe: false, desc: 'placement: next test is harder (rising fourth)' },
  easier: { safe: false, desc: 'placement: next test is easier (gentle falling third)' },
  retry: { safe: false, desc: 'gentle, encouraging "try again" (soft rising fourth)' },
  // mic-safe (energy only above ~10.5 kHz), OK while listening
  hit: { safe: true, desc: 'correct note (subtle glint)' },
  perfect: { safe: true, desc: 'perfect hit sparkle' },
  combo: { safe: true, desc: 'combo / streak up during play (opts.level 1..8 raises it)' },
  miss: { safe: true, desc: 'gentle miss (airy falling swish)' },
  wrong: { safe: true, desc: 'wrong note during play (falling double glint)' },
  count: { safe: true, desc: 'count-in beep while listening' },
  'count-go': { safe: true, desc: 'count-in "go" while listening' },
};
export const SFX_NAMES = Object.keys(SFX_INFO);
export const MIC_SAFE_SFX = SFX_NAMES.filter((n) => SFX_INFO[n].safe);
// Alternative names accepted by play() / isMicSafe().
export const SFX_ALIASES = {
  select: 'tap',
  click: 'tap',
  transition: 'whoosh',
  correct: 'success',
  levelUp: 'levelup',
  lessonComplete: 'complete',
  tryAgain: 'retry',
  'try-again': 'retry',
  countin: 'count',
  'count-in': 'count',
  go: 'count-go',
  hitPerfect: 'perfect',
  perfectHit: 'perfect',
  sparkle: 'perfect',
  wrongNote: 'wrong',
};
export const resolveSfx = (name) => (SFX_INFO[name] ? name : SFX_ALIASES[name] || null);

// Lower edge of the mic-safe band (Hz) and the highest frequency the transcriber analyses.
export const SAFE_BAND_HZ = 10500;

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// A small synthetic room: stereo decaying noise that darkens over time. Shared by the piano.
// decay = envelope time constant (s): RT60 ~ 6.9 * decay.
export function createReverb(ctx, { seconds = 1.5, decay = 0.2, predelay = 0.012 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * predelay);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      // one-pole low-pass whose cutoff falls with time (high frequencies die first)
      const a = clamp(0.75 * Math.exp(-t / (decay * 1.2)) + 0.08, 0.05, 0.9);
      lp += a * (Math.random() * 2 - 1 - lp);
      const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.006));
      d[i] = lp * env;
    }
  }
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = buf;
  return conv;
}

// Butterworth 8th-order high-pass as four biquad sections (Q values of the 8th-order prototype).
// Web Audio's highpass/lowpass Q is a resonance in dB, so linear Q is converted: 20*log10(q).
export function highpassChain(ctx, fc) {
  const qs = [0.5098, 0.6013, 0.9, 2.5629];
  const nodes = qs.map((q) => {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = fc;
    f.Q.value = 20 * Math.log10(q);
    return f;
  });
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
  return { input: nodes[0], output: nodes[nodes.length - 1] };
}

// 16th-order high-pass at SAFE_BAND_HZ (two 8th-order Butterworth chains: noise-based sounds
// have broad skirts). Anything played through it is inaudible to the transcriber (0-9.5 kHz).
export function micSafeFilter(ctx) {
  const a = highpassChain(ctx, SAFE_BAND_HZ);
  const b = highpassChain(ctx, SAFE_BAND_HZ);
  a.output.connect(b.input);
  return { input: a.input, output: b.output };
}

// Raised-cosine attack, exponential decay, cosine taper to exactly zero: a smooth envelope
// keeps a high sine's spectrum narrow (no clicks that would leak below the safe band).
function glintCurve(n, attack, dur, tau) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur;
    let v = t < attack ? Math.pow(Math.sin((Math.PI / 2) * (t / attack)), 2) : Math.exp(-(t - attack) / tau);
    const taper = 0.25 * dur;
    if (t > dur - taper) v *= Math.pow(Math.cos((Math.PI / 2) * ((t - (dur - taper)) / taper)), 2);
    c[i] = v;
  }
  c[n - 1] = 0;
  return c;
}

export class Sfx {
  // destination: AudioNode to play into (e.g. AudioEngine.master). opts.synth: a Synth whose
  // piano samples the musical jingles can use (a Synth may also be passed directly as the third
  // argument). opts.volume: 0..1 (default 0.8).
  constructor(ctx, destination = ctx.destination, opts = {}) {
    if (opts && typeof opts.note === 'function') opts = { synth: opts };
    opts = opts || {};
    this.ctx = ctx;
    this.synth = opts.synth || null;
    this.volume = opts.volume ?? 0.8;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);

    // Full-range bus (dry + a little room, created lazily).
    this.full = ctx.createGain();
    this.full.connect(this.out);
    this.rev = null;

    // Mic-safe bus: sources -> (optional shimmer echo) -> 16th-order HP @ 10.5 kHz -> out.
    const hp = micSafeFilter(ctx);
    this.safe = ctx.createGain();
    this.safe.connect(hp.input);
    this.safeEcho = ctx.createGain();
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.07;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.safeEcho.connect(hp.input);
    this.safeEcho.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(hp.input);
    this.safeGain = ctx.createGain();
    this.safeGain.gain.value = 1.6; // high frequencies sound quieter; balance with the rest
    hp.output.connect(this.safeGain);
    this.safeGain.connect(this.out);

    const n = Math.floor(ctx.sampleRate * 1.0);
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.names = SFX_NAMES;
  }

  isMicSafe(name) {
    return !!SFX_INFO[resolveSfx(name)]?.safe;
  }

  // Is this a known sound name (or alias)?
  has(name) {
    return !!resolveSfx(name);
  }

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  // Play a sound. opts: { when (AudioContext time, default now), volume (0..1 multiplier),
  // level (combo), on (toggle), reverse (whoosh) }. Returns the sound's duration in seconds
  // (from `when` until silent), or 0 for an unknown name.
  play(name, opts = {}) {
    const fn = SOUNDS[resolveSfx(name)];
    if (!fn) return 0;
    opts = opts || {};
    const t = Math.max(opts.when ?? 0, this.ctx.currentTime + 0.004);
    this._v = clamp(opts.volume ?? 1, 0, 1.5);
    try {
      return fn.call(this, t, opts) || 0;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('sfx', name, e);
      return 0;
    }
  }

  // ---- building blocks -------------------------------------------------------------------

  _room() {
    if (!this.rev) {
      this.rev = createReverb(this.ctx, { seconds: 1.2, decay: 0.18 });
      const send = this.ctx.createGain();
      send.gain.value = 0.28;
      this.revIn = this.ctx.createGain();
      this.revIn.connect(this.rev);
      this.rev.connect(send);
      send.connect(this.out);
    }
    return this.revIn;
  }

  _dest(o) {
    if (o.dest) return o.dest;
    if (o.wet) {
      // dry + room
      const g = this.ctx.createGain();
      g.connect(this.full);
      g.connect(this._room());
      return g;
    }
    return this.full;
  }

  // Sine/triangle voice with a fast attack and exponential decay. Returns the end time.
  _tone(freq, t, o = {}) {
    const ctx = this.ctx;
    if (freq >= ctx.sampleRate * 0.45) return t;
    const a = o.a ?? 0.003;
    const tau = o.tau ?? 0.15;
    const hold = o.hold ?? 0;
    const peak = (o.gain ?? 0.15) * this._v;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, t + (o.glideTime ?? 0.08));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.setTargetAtTime(0, t + a + hold, tau);
    let node = g;
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      lp.Q.value = 0.5;
      g.connect(lp);
      node = lp;
    }
    node.connect(this._pan(o.pan, this._dest(o)));
    osc.connect(g);
    const end = t + a + hold + tau * 7;
    osc.start(t);
    osc.stop(end);
    return end;
  }

  _pan(p, dest) {
    if (!p || !this.ctx.createStereoPanner) return dest;
    const sp = this.ctx.createStereoPanner();
    sp.pan.value = clamp(p, -1, 1);
    sp.connect(dest);
    return sp;
  }

  // Celesta/glass bar: inharmonic partials of a free bar (1, 2.756, 5.404).
  _glass(freq, t, o = {}) {
    const gain = o.gain ?? 0.08;
    const tau = o.tau ?? 0.25;
    let end = this._tone(freq, t, { ...o, gain, tau, a: 0.0015 });
    end = Math.max(end, this._tone(freq * 2.756, t, { ...o, gain: gain * 0.22, tau: tau * 0.4, a: 0.001 }));
    this._tone(freq * 5.404, t, { ...o, gain: gain * 0.07, tau: tau * 0.2, a: 0.001 });
    return end;
  }

  // FM bell: carrier + decaying modulator (bright strike, pure tail).
  _bell(freq, t, o = {}) {
    const ctx = this.ctx;
    const tau = o.tau ?? 0.4;
    const peak = (o.gain ?? 0.1) * this._v;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * (o.ratio ?? 3.5);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * (o.index ?? 2.2), t);
    mg.gain.setTargetAtTime(0, t, tau * 0.35);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, tau);
    car.connect(g);
    g.connect(this._pan(o.pan, this._dest(o)));
    const end = t + tau * 7;
    car.start(t);
    mod.start(t);
    car.stop(end);
    mod.stop(end);
    return end;
  }

  // Warm keyboard-ish voice (fallback when the piano samples are not loaded).
  _warm(freq, t, o = {}) {
    const tau = o.tau ?? 0.5;
    const gain = o.gain ?? 0.1;
    const end = this._tone(freq, t, { ...o, type: 'triangle', gain, tau, a: 0.004, lowpass: o.lowpass ?? Math.min(9000, freq * 6) });
    this._tone(freq * 2, t, { ...o, gain: gain * 0.25, tau: tau * 0.5, a: 0.003 });
    return end;
  }

  // Piano note via the Synth when its samples are ready, else the warm voice.
  _piano(midi, t, dur, vel, o = {}) {
    const s = this.synth;
    if (s && s.hasSampleNear && s.hasSampleNear(midi)) {
      s.note(midi, t, dur, clamp(vel * this._v * (this.volume / 0.8), 0.05, 1));
      return t + dur + 0.6;
    }
    return this._warm(hz(midi), t, { gain: 0.09 * vel, tau: Math.max(0.25, dur * 0.6), wet: true, ...o });
  }

  _noise(t, o = {}) {
    const ctx = this.ctx;
    const dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.sweep) for (const [ft, fv] of o.sweep) f.frequency.exponentialRampToValueAtTime(fv, t + ft);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const peak = (o.gain ?? 0.1) * this._v;
    g.gain.value = 0;
    if (o.curve) {
      // (no other automation events: a curve may not overlap them)
      g.gain.setValueCurveAtTime(Float32Array.from(o.curve, (v) => v * peak), t, dur);
    } else {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + (o.a ?? 0.001));
      g.gain.setTargetAtTime(0, t + (o.a ?? 0.001), o.tau ?? dur / 5);
    }
    src.connect(f);
    f.connect(g);
    g.connect(this._pan(o.pan, this._dest(o)));
    const off = Math.random() * 0.5;
    src.start(t, off);
    src.stop(t + dur + 0.02);
    return t + dur;
  }

  // Mic-safe glint: a high sine with a raised-cosine envelope into the safe bus.
  _glint(freq, t, o = {}) {
    const ctx = this.ctx;
    const dur = o.dur ?? 0.05;
    const f0 = Math.max(freq, SAFE_BAND_HZ + 700);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(Math.min(f0, ctx.sampleRate * 0.42), t);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(clamp(o.glideTo, SAFE_BAND_HZ + 600, ctx.sampleRate * 0.42), t + dur * 0.8);
    const g = ctx.createGain();
    g.gain.value = 0;
    const peak = (o.gain ?? 0.12) * this._v;
    const curve = glintCurve(48, Math.min(0.004, dur * 0.25), dur, o.tau ?? dur * 0.3);
    for (let i = 0; i < curve.length; i++) curve[i] *= peak;
    g.gain.setValueCurveAtTime(curve, t, dur);
    osc.connect(g);
    g.connect(o.echo ? this.safeEcho : this.safe);
    osc.start(t);
    osc.stop(t + dur + 0.01);
    return t + dur;
  }

  // Mic-safe air: noise band-passed inside 11-16 kHz, optional sweep.
  _air(t, o = {}) {
    const dur = o.dur ?? 0.2;
    const from = Math.max(SAFE_BAND_HZ + 1300, o.from ?? 14000);
    const to = Math.max(SAFE_BAND_HZ + 1300, o.to ?? from);
    return this._noise(t, {
      dur,
      type: 'bandpass',
      freq: Math.min(from, this.ctx.sampleRate * 0.42),
      sweep: [[dur, Math.min(to, this.ctx.sampleRate * 0.42)]],
      q: o.q ?? 2.5,
      gain: o.gain ?? 0.05,
      curve: Array.from(glintCurve(32, dur * 0.3, dur, dur * 0.35)),
      dest: o.echo ? this.safeEcho : this.safe,
    });
  }
}

// Each returns its duration in seconds. `this` is the Sfx instance, t the start time.
const C5 = 72;
const SOUNDS = {
  // ---- full range: UI ----
  tap(t) {
    this._noise(t, { freq: 3200, q: 1.3, a: 0.0006, tau: 0.004, gain: 0.2, dur: 0.03 });
    this._tone(1760, t, { a: 0.001, tau: 0.012, gain: 0.05 });
    return 0.06;
  },
  toggle(t, o) {
    const [f1, f2] = o.on === false ? [1760, 1318.5] : [1318.5, 1760];
    this._noise(t, { freq: 2800, q: 1.5, tau: 0.003, gain: 0.12, dur: 0.02 });
    this._glass(f1, t, { gain: 0.06, tau: 0.03 });
    this._glass(f2, t + 0.06, { gain: 0.07, tau: 0.05 });
    return 0.3;
  },
  whoosh(t, o) {
    const dur = 0.42;
    const sweep = o.reverse
      ? [
          [0.2, 2600],
          [dur, 320],
        ]
      : [
          [0.22, 2800],
          [dur, 700],
        ];
    this._noise(t, {
      dur,
      type: 'bandpass',
      freq: o.reverse ? 900 : 300,
      sweep,
      q: 0.9,
      gain: 0.16,
      curve: Array.from(glintCurve(32, 0.2, dur, 0.09)),
      pan: o.reverse ? 0.2 : -0.2,
    });
    return dur + 0.05;
  },
  success(t) {
    this._bell(hz(84), t, { gain: 0.09, tau: 0.3, wet: true, pan: -0.1 });
    this._bell(hz(91), t + 0.09, { gain: 0.08, tau: 0.45, wet: true, pan: 0.1 });
    this._glass(hz(96), t + 0.09, { gain: 0.025, tau: 0.3, wet: true });
    return 1.3;
  },
  bloop(t) {
    this._tone(392, t, { glideTo: 185, glideTime: 0.16, a: 0.004, tau: 0.06, gain: 0.2 });
    this._tone(784, t, { glideTo: 370, glideTime: 0.16, a: 0.004, tau: 0.04, gain: 0.03 });
    return 0.4;
  },
  error(t) {
    this._tone(220, t, { type: 'triangle', a: 0.004, hold: 0.05, tau: 0.02, gain: 0.13, lowpass: 1400 });
    this._tone(207.65, t + 0.12, { type: 'triangle', a: 0.004, hold: 0.07, tau: 0.03, gain: 0.13, lowpass: 1400 });
    return 0.45;
  },
  star1(t) {
    return star.call(this, t, 1);
  },
  star2(t) {
    return star.call(this, t, 2);
  },
  star3(t) {
    return star.call(this, t, 3);
  },
  streak(t) {
    [84, 88, 91, 96].forEach((m, i) => this._glass(hz(m), t + i * 0.05, { gain: 0.06, tau: 0.2, wet: true, pan: -0.3 + i * 0.2 }));
    this._bell(hz(96), t + 0.2, { gain: 0.05, tau: 0.35, wet: true });
    return 1.3;
  },
  levelup(t) {
    // arpeggio C4 E4 G4 C5, then a full C major chord with a sparkle cascade on top
    [60, 64, 67, 72].forEach((m, i) => this._piano(m, t + i * 0.085, 0.3, 0.55 + i * 0.05));
    const tc = t + 0.4;
    [48, 60, 67, 72, 76].forEach((m) => this._piano(m, tc, 1.3, 0.7));
    [96, 100, 103, 108, 103, 108].forEach((m, i) => this._glass(hz(m), tc + 0.05 + i * 0.06, { gain: 0.03, tau: 0.25, wet: true, pan: i % 2 ? 0.35 : -0.35 }));
    this._bell(hz(91), tc, { gain: 0.035, tau: 0.6, wet: true });
    return 2.6;
  },
  complete(t) {
    // "sol-do-mi-re ... do" cadence
    const b = 0.13;
    this._piano(67, t, 0.2, 0.55);
    this._piano(C5, t + b, 0.2, 0.6);
    this._piano(76, t + 2 * b, 0.28, 0.65);
    this._piano(74, t + 3.4 * b, 0.14, 0.55);
    const te = t + 4.4 * b;
    [48, 55, 64, 67, 72].forEach((m) => this._piano(m, te, 1.1, 0.68));
    this._glass(hz(96), te, { gain: 0.03, tau: 0.35, wet: true });
    return 2.2;
  },
  countdown(t) {
    this._bell(hz(81), t, { gain: 0.09, tau: 0.08, index: 1.2, ratio: 2 });
    return 0.5;
  },
  'countdown-go'(t) {
    this._bell(hz(93), t, { gain: 0.09, tau: 0.22, index: 1.4, ratio: 2, wet: true });
    this._bell(hz(81), t, { gain: 0.05, tau: 0.22, index: 1.0, ratio: 2 });
    return 1.0;
  },
  harder(t) {
    this._glass(hz(79), t, { gain: 0.07, tau: 0.16, wet: true, pan: -0.15 });
    this._glass(hz(84), t + 0.11, { gain: 0.08, tau: 0.3, wet: true, pan: 0.15 });
    this._noise(t + 0.02, { dur: 0.16, freq: 1800, sweep: [[0.16, 6000]], q: 1.2, gain: 0.025, curve: Array.from(glintCurve(24, 0.06, 0.16, 0.05)) });
    return 1.0;
  },
  easier(t) {
    this._warm(hz(76), t, { gain: 0.07, tau: 0.18, lowpass: 2600, wet: true });
    this._warm(hz(72), t + 0.14, { gain: 0.07, tau: 0.35, lowpass: 2200, wet: true });
    return 1.1;
  },
  retry(t) {
    this._warm(hz(67), t, { gain: 0.06, tau: 0.14, lowpass: 2400, wet: true });
    this._warm(hz(72), t + 0.13, { gain: 0.065, tau: 0.3, lowpass: 2600, wet: true });
    this._glass(hz(84), t + 0.13, { gain: 0.015, tau: 0.2, wet: true });
    return 1.0;
  },

  // ---- mic-safe: in play ----
  hit(t) {
    this._glint(12000, t, { dur: 0.045, gain: 0.1 });
    return 0.06;
  },
  perfect(t) {
    this._glint(11800, t, { dur: 0.04, gain: 0.1, echo: true });
    this._glint(12600, t + 0.035, { dur: 0.04, gain: 0.11, echo: true });
    this._glint(13400, t + 0.07, { dur: 0.06, gain: 0.12, echo: true });
    this._air(t, { dur: 0.16, from: 15500, to: 13000, q: 4, gain: 0.025 });
    return 0.45;
  },
  combo(t, o) {
    const lvl = clamp(Math.round(o.level ?? 1), 1, 8);
    const f = 11400 + 200 * lvl;
    this._glint(f, t, { dur: 0.06, glideTo: f * 1.1, gain: 0.1 });
    this._glint(f * 1.12, t + 0.065, { dur: 0.06, gain: 0.11, echo: true });
    return 0.35;
  },
  miss(t) {
    this._air(t, { dur: 0.22, from: 15000, to: 12000, q: 4, gain: 0.06 });
    return 0.25;
  },
  wrong(t) {
    this._glint(12800, t, { dur: 0.08, glideTo: 11400, gain: 0.1 });
    this._glint(12200, t + 0.1, { dur: 0.09, glideTo: 11200, gain: 0.08 });
    return 0.22;
  },
  count(t) {
    this._glint(12000, t, { dur: 0.05, gain: 0.15 });
    return 0.06;
  },
  'count-go'(t) {
    this._glint(13200, t, { dur: 0.09, gain: 0.17, echo: true });
    return 0.35;
  },
};

// Star pop: a plucked note with an upward flick and a noise "pop", brighter for higher stars.
function star(t, n) {
  const f = hz([76, 79, 84][n - 1]);
  this._noise(t, { freq: 1500 + n * 300, q: 0.8, tau: 0.006, gain: 0.12, dur: 0.04 });
  this._tone(f * 0.75, t, { glideTo: f, glideTime: 0.03, a: 0.002, tau: 0.09, gain: 0.14, wet: true });
  this._glass(f * 2, t + 0.03, { gain: 0.04, tau: 0.18, wet: true });
  for (let k = 0; k < n; k++) this._glass(f * 2 * [1.26, 1.5, 2][k], t + 0.08 + k * 0.05, { gain: 0.03, tau: 0.14, wet: true, pan: k % 2 ? 0.3 : -0.3 });
  return 1.0;
}
