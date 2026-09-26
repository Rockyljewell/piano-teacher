// Audio I/O: microphone capture -> listener (Transcriber in a Web Worker), Web MIDI, on-screen
// keys, a sampled grand piano (Salamander, with an oscillator fallback) for demos and touch
// keys, UI sound effects and the metronome. Everything is timed on the AudioContext clock.
//
// Listening: the capture AudioWorklet sends mic samples straight to the listener Web Worker
// through a MessagePort (js/audio/listener-worker.js), so transcription costs no main-thread
// time. Without Worker/AudioWorklet support the same Listener runs on the main thread.
//
// Mic gating: anything the app itself plays through the speaker (coach voice, demo playback,
// full-range sound effects, touch-key notes) would otherwise be heard by the microphone and
// graded as notes. hold()/holdFor() suppress mic note/onset events (reference counted); on the
// last release the transcriber is reset and a short tail is ignored while the speaker decays.
// Holds and tails expire on the wall clock (performance.now), never on the audio clock alone,
// and every hold has a maximum lifetime, so a frozen AudioContext cannot pause listening forever.
//
// Health: a supervisor watches the AudioContext (state, "interrupted", a clock that stopped
// advancing), the microphone track (ended / muted), whether mic chunks still arrive and whether
// they are all zeros (iOS's dead-but-live track). It resumes the context with backoff and
// re-acquires the microphone when needed. audio.on('health', ev) reports changes; audio.ready()
// waits until listening really works; audio.recover() fixes things from a tap (user gesture).
import { Sfx, createReverb, micSafeFilter } from './sfx.js';

const DEFAULT_TAIL_MS = 250;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const unref = (t) => {
  if (t && typeof t.unref === 'function') t.unref();
  return t;
};
const race = (p, ms) => Promise.race([p, sleep(ms)]);

// Health-supervisor timing (ms). Tests pass smaller values through opts.health.
export const HEALTH_DEFAULTS = {
  tickMs: 250, // supervisor check interval
  stallMs: 400, // ctx.currentTime not advancing this long while "running" and visible = stalled
  noDataMs: 800, // no mic chunks this long while the context runs = the mic delivers nothing
  zeroMs: 1500, // all-zero samples this long = iOS dead-but-live track
  firstChunkMs: 1500, // a fresh track may take this long to deliver its first chunk
  muteGraceMs: 1500, // a fresh track may be muted this long
  muteRestartMs: 1500, // then re-acquire after this much more muted time
  minRestartMs: 2000, // re-acquire backoff: 2 s, 4 s, 8 s ... max 30 s
  maxRestartMs: 30000,
  liveResetMs: 10000, // the mic counts as recovered after this long live
  workerStaleMs: 2000, // no message from the listener worker this long = restart it
  hbStaleMs: 1500, // no heartbeat from the capture worklet this long = rebuild it
  resumeTimeoutMs: 1500, // ctx.resume() can stay pending on iOS: stop waiting after this
};

// Longest a hold of each kind lasts if nobody releases it (holds must never be permanent).
const HOLD_MAX_MS = { voice: 20000, demo: 120000, sfx: 10000, touch: 8000, muted: 120000 };
const HOLD_MAX_DEFAULT = 30000;
const HOLD_MAX_TOTAL = 180000; // even with renewals

// Raw signal: the browser's echo cancellation / noise suppression / AGC are tuned for speech and
// would eat sustained piano tones (and switch iOS into voice-processing mode).
const MIC_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };

const MIC_BAD = new Set(['ended', 'muted', 'no-data', 'silent', 'error']);

// Transcriber-shaped handle on the listener (worker or main-thread Listener): the engine and
// older code call reset/setExpected/... on `audio.tr` exactly as on a Transcriber. Values the
// listener reports (noise floor, piano level, tuning) are cached from its status messages.
class ListenerClient {
  constructor(send) {
    this._send = send;
    this._sens = 1;
    this._seq = 0;
    this._cal = new Map();
    this._rec = new Map();
    this._expKey = '';
    this.noiseRms = 0;
    this.noiseLevel = null;
    this.pianoLevel = null;
    this.tuningCents = 0;
    this.stats = null;
  }

  reset(opts) {
    this._send({ type: 'reset', hard: !!(opts && opts.hard), epoch: opts ? opts.epoch : undefined });
  }

  setExpected(midis, range) {
    const list = [...(midis || [])];
    const key = `${list.join(',')}|${range === undefined ? '-' : JSON.stringify(range)}`;
    if (key === this._expKey) return; // play.js sets this every frame: only send changes
    this._expKey = key;
    this._send(range === undefined ? { type: 'setExpected', midis: list } : { type: 'setExpected', midis: list, range });
  }

  setRange(lo, hi) {
    this._expKey = '';
    this._send({ type: 'setRange', lo, hi });
  }

  setStrictness(v) {
    this._send({ type: 'setStrictness', v });
  }

  setNoisyRoom(on) {
    this._send({ type: 'setNoisyRoom', on });
  }

  get sensitivity() {
    return this._sens;
  }

  set sensitivity(v) {
    this._sens = v;
    this._send({ type: 'setSensitivity', v });
  }

  startCalibration() {
    this._send({ type: 'calStart' });
  }

  // Resolves to true/false (false also when the listener does not answer).
  finishCalibration(timeoutMs = 1500) {
    const id = ++this._seq;
    return new Promise((resolve) => {
      const to = setTimeout(() => {
        this._cal.delete(id);
        resolve(false);
      }, timeoutMs);
      this._cal.set(id, (m) => {
        clearTimeout(to);
        resolve(!!m.ok);
      });
      this._send({ type: 'calFinish', id });
    });
  }

  // Raw mic samples for `seconds`: {samples, sampleRate, startFrame} or null.
  record(seconds) {
    const id = ++this._seq;
    return new Promise((resolve) => {
      const soft = setTimeout(() => this._send({ type: 'recordStop', id }), seconds * 1000 + 2500);
      const hard = setTimeout(() => {
        this._rec.delete(id);
        resolve(null);
      }, seconds * 1000 + 5000);
      this._rec.set(id, (m) => {
        clearTimeout(soft);
        clearTimeout(hard);
        resolve({ samples: m.samples, sampleRate: m.sampleRate, startFrame: m.startFrame });
      });
      this._send({ type: 'record', id, seconds });
    });
  }

  stopRecording() {
    this._send({ type: 'recordStop' });
  }

  _onMessage(m) {
    if (m.type === 'status') {
      this.noiseLevel = m.noiseLevel;
      this.pianoLevel = m.pianoLevel;
      this.tuningCents = m.tuningCents;
      this.noiseRms = m.noiseRms;
      this.stats = m.stats;
    } else if (m.type === 'cal') {
      this.noiseRms = m.noiseRms;
      this.noiseLevel = m.noiseLevel;
      const f = this._cal.get(m.id);
      this._cal.delete(m.id);
      if (f) f(m);
    } else if (m.type === 'recording') {
      const f = this._rec.get(m.id);
      this._rec.delete(m.id);
      if (f) f(m);
    }
  }
}

export class AudioEngine {
  // opts: { tailMs (default 250), pianoBaseUrl, autoLoadPiano (default true),
  //         worker (default true: transcribe in a Web Worker), health (supervisor timing, see
  //         HEALTH_DEFAULTS), env (tests: AudioContext, getUserMedia, AudioWorkletNode, Worker,
  //         MessageChannel, document, navigator, window) }
  constructor(opts = {}) {
    this.ctx = null;
    this.listeners = { noteon: [], noteoff: [], onset: [], hold: [], piano: [], health: [] };
    this.heard = new Map(); // midi -> {source, t}
    this._level = 0; // recent input RMS (see get level)
    this._lvlPeak = 0;
    this._lvlAt = -Infinity;
    this.midiOn = false;
    this.sensitivity = 1;
    this.strictness = undefined; // forwarded to the Transcriber when set
    this.noisyRoom = undefined;
    this.tailMs = opts.tailMs ?? DEFAULT_TAIL_MS;
    this.touchHold = true; // gate the mic while on-screen-key notes sound
    this.midiSuppressesMic = true; // a MIDI keyboard in use: ignore the mic for a few seconds
    this.pianoBaseUrl = opts.pianoBaseUrl;
    this.autoLoadPiano = opts.autoLoadPiano ?? true;
    this.env = opts.env || {};
    this.hc = { ...HEALTH_DEFAULTS, ...(opts.health || {}) };
    this.useWorker = opts.worker ?? true;
    // mic gating
    this._holds = new Map(); // id -> {reason, tail, since, maxMs, renew, timer}
    this._holdSeq = 0;
    this._gateFrom = 0;
    this._tailUntil = -Infinity; // audio clock: end of the latest gated interval
    this._tailWall = -Infinity; // performance.now(): when the tail really ends
    this._gates = []; // past gated intervals [{from, to}] on the audio clock
    this._micSounding = new Set(); // mic notes whose noteon was emitted
    this._touch = new Map(); // midi -> {v, release}
    this._touchOffAt = new Map();
    this._lastMidiAt = -Infinity;
    this._mutedRelease = null;
    // listening pipeline
    this.tr = null; // ListenerClient (or anything Transcriber-shaped, e.g. in tests)
    this.mode = null; // 'worker' | 'relay' | 'main' | 'main-sp'
    this.stream = null;
    this.track = null;
    this.src = null;
    this.node = null;
    this.sink = null;
    this.worker = null;
    this._local = null; // main-thread Listener (fallback)
    this._micWanted = false;
    this._micStarting = null;
    this._micDenied = false;
    this._micError = null;
    this._reacq = null;
    this._epoch = 0;
    this._micSince = 0;
    this._gotChunk = false;
    this._trackEnded = false;
    this.st = { chunks: 0, epochChunks: 0, chunkRate: 0, lastChunkWall: 0, zeroMs: 0, costMsPerSec: 0, costMax: 0, rms: 0, peak: 0, gaps: 0, errors: 0, stats: null, recording: null };
    this._hb = { wall: 0, frame: 0, chans: 0, sent: 0 };
    this._workerAlive = 0;
    this._workerNextAt = 0;
    this._workerRestarts = 0;
    // health
    const w = perfNow();
    this._clk = { t: 0, wall: w, runSince: w };
    this._visibleSince = w;
    this._wasVisible = this._isVisible();
    this._resumeFails = 0;
    this._resumeNextAt = 0;
    this._resuming = null;
    this._reacqFails = 0;
    this._reacqNextAt = 0;
    this._liveSince = 0;
    this._mutedSince = 0;
    this._health = { ok: true, context: 'none', mic: 'off', reason: null, needsGesture: false, since: Math.round(w) };
    this._events = []; // ring buffer of health/listening events since app start
    this._eventCap = 1000;
    this.recentNotes = []; // last mic notes (incl. gated ones) for diagnostics
    this._statusHist = [];
    this.restarts = 0;
    this._log('engine', { worker: this.useWorker });
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  _emit(type, ev) {
    const ls = this.listeners[type];
    if (!ls) return;
    for (const fn of ls) {
      try {
        fn(ev);
      } catch (e) {
        // report it, but a broken listener must not stop audio handling
        setTimeout(() => {
          throw e;
        });
      }
    }
  }

  async ensureContext() {
    if (!this.ctx) {
      const AC = this.env.AudioContext || window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.synth = new Synth(this.ctx, this.master, { baseUrl: this.pianoBaseUrl });
      this.sfx = new Sfx(this.ctx, this.master, { synth: this.synth });
      this._log('context', { event: 'created', state: this.ctx.state, sampleRate: this.ctx.sampleRate });
      if (this.autoLoadPiano) this.loadPiano();
    }
    this._watch();
    // (resume() can stay pending on iOS outside a user gesture: never block the caller forever)
    if (this.ctx.state !== 'running') await race(this._tryResume(this.ctx.state, { force: true }), this.hc.resumeTimeoutMs);
    return this.ctx;
  }

  // Try to resume after an iOS interruption (phone call, Siri, speech). Harmless if running.
  // Calls ctx.resume() synchronously, so it works from a tap handler.
  resume() {
    if (this.ctx && this.ctx.state !== 'running') return this._tryResume(this.ctx.state, { force: true }).then(() => {});
    return Promise.resolve();
  }

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(clamp(v, 0, 1.5), this.ctx.currentTime, 0.02);
  }

  // Lazy-load the piano samples (called automatically by ensureContext). Resolves to true when
  // at least some samples decoded. Progress: audio.on('piano', ({loaded, total, ready}) => ...).
  loadPiano() {
    if (!this.synth) return Promise.resolve(false);
    return this.synth.load({ onProgress: (p) => this._emit('piano', p) });
  }

  get pianoReady() {
    return !!this.synth?.samplesReady;
  }

  // Smooth audio-clock time (ctx.currentTime advances in render-quantum steps).
  now() {
    if (!this.ctx) return perfNow() / 1000;
    const p = perfNow();
    this._sampleClock(p);
    return this._clk.t + Math.min(0.03, (p - this._clk.wall) / 1000);
  }

  _sampleClock(w) {
    const ctx = this.ctx;
    if (ctx.state !== this._clk.state) {
      this._clk.state = ctx.state;
      this._clk.stateSince = w; // a context that just started running has not stalled yet
    }
    const ct = ctx.currentTime;
    if (ct !== this._clk.t) {
      if (w - this._clk.wall > 250) this._clk.runSince = w; // it was stopped: started again now
      this._clk.t = ct;
      this._clk.wall = w;
    }
  }

  // ---- mic gating --------------------------------------------------------------------------

  // Suppress mic notes until the returned function is called (idempotent).
  // opts.tailMs: how long to keep ignoring the mic after release (speaker decay + room), default
  // this.tailMs. opts.maxMs: the hold ends by itself after this long (default per reason).
  // opts.renew(): called at maxMs; returning N > 0 extends the hold by N ms.
  hold(reason = 'app', opts = {}) {
    opts = opts || {};
    const id = ++this._holdSeq;
    const wasHeld = this._holds.size > 0;
    const lat = this.ctx ? (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) : 0;
    const maxMs = Math.max(50, opts.maxMs ?? HOLD_MAX_MS[reason] ?? HOLD_MAX_DEFAULT);
    const h = { reason, tail: (opts.tailMs ?? this.tailMs) / 1000 + Math.min(0.2, lat), since: perfNow(), maxMs, renew: opts.renew || null, timer: null };
    h.timer = unref(setTimeout(() => this._expire(id), maxMs));
    this._holds.set(id, h);
    if (!wasHeld && !(perfNow() < this._tailWall)) this._gateFrom = this.now();
    if (!wasHeld) this._emitHold();
    this._log('hold', { reason });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this._release(id);
    };
  }

  // Hold for `ms` milliseconds. Returns a function that releases early.
  holdFor(ms, reason = 'app', opts = {}) {
    opts = opts || {};
    const release = this.hold(reason, { ...opts, maxMs: opts.maxMs ?? Math.max(0, ms) + 2000 });
    const tm = setTimeout(release, Math.max(0, ms));
    return () => {
      clearTimeout(tm);
      release();
    };
  }

  _expire(id) {
    const h = this._holds.get(id);
    if (!h) return;
    let extra = 0;
    try {
      extra = h.renew ? Number(h.renew()) || 0 : 0;
    } catch {
      extra = 0;
    }
    if (extra > 0 && perfNow() - h.since < HOLD_MAX_TOTAL) {
      h.timer = unref(setTimeout(() => this._expire(id), Math.min(extra, 60000)));
      return;
    }
    this._log('hold-expired', { reason: h.reason, ms: Math.round(perfNow() - h.since) });
    this._release(id);
  }

  _release(id) {
    const h = this._holds.get(id);
    if (!h) return;
    clearTimeout(h.timer);
    this._holds.delete(id);
    const now = this.now();
    const wall = perfNow();
    this._tailUntil = Math.max(this._tailUntil, now + h.tail);
    this._tailWall = Math.max(this._tailWall, wall + h.tail * 1000);
    this._log('release', { reason: h.reason, ms: Math.round(wall - h.since) });
    if (this._holds.size) return;
    this._resetTranscriber();
    clearTimeout(this._tailTimer);
    this._tailTimer = setTimeout(() => this._tailEnd(), Math.max(0, this._tailWall - wall) + 15);
    this._emitHold();
  }

  // The tail ends on the wall clock: a frozen audio clock cannot keep the mic paused.
  _tailEnd() {
    if (this._holds.size) return;
    const wall = perfNow();
    if (wall < this._tailWall) {
      this._tailTimer = setTimeout(() => this._tailEnd(), this._tailWall - wall + 15);
      return;
    }
    const now = this.now();
    // if the audio clock stalled meanwhile, don't gate beyond "now" on it either
    if (this._tailUntil > now) this._tailUntil = Math.max(now, this._gateFrom);
    this._gates.push({ from: this._gateFrom, to: this._tailUntil });
    const cut = now - 10;
    this._gates = this._gates.filter((g) => g.to > cut);
    // Notes the transcriber picked up from our own sound during the tail: forget them.
    this._resetTranscriber();
    this._emitHold();
  }

  _resetTranscriber() {
    if (this.tr && typeof this.tr.reset === 'function') this.tr.reset();
  }

  _emitHold() {
    this._emit('hold', { held: this.held, reasons: this.holdReasons });
  }

  // True while any hold is active or its tail has not passed.
  get held() {
    return this._holds.size > 0 || perfNow() < this._tailWall;
  }

  get holdReasons() {
    return [...new Set([...this._holds.values()].map((h) => h.reason))];
  }

  // Active holds for diagnostics: {held, holds: [{reason, ms, maxMs}], tailMs}.
  holdInfo() {
    const w = perfNow();
    return {
      held: this.held,
      holds: [...this._holds.values()].map((h) => ({ reason: h.reason, ms: Math.round(w - h.since), maxMs: Math.round(h.maxMs) })),
      tailMs: Math.max(0, Math.round(this._tailWall - w)),
    };
  }

  // Legacy boolean: `audio.muted = true` takes a hold, `false` releases it.
  get muted() {
    return !!this._mutedRelease;
  }

  set muted(v) {
    if (v && !this._mutedRelease) this._mutedRelease = this.hold('muted');
    else if (!v && this._mutedRelease) {
      this._mutedRelease();
      this._mutedRelease = null;
    }
  }

  // Should a mic event at audio time `t` (possibly back-dated to its attack) be dropped?
  micGated(t = this.now()) {
    if (this._holds.size) return true;
    if (perfNow() < this._tailWall) return true;
    const now = this.now();
    if (t >= this._gateFrom && t <= this._tailUntil) return true;
    for (const g of this._gates) if (t >= g.from && t <= g.to) return true;
    if (this.midiSuppressesMic && now - this._lastMidiAt < 6) return true;
    return false;
  }

  // Link a voice (js/voice.js) so the mic is held while it speaks. The hold lasts at most as
  // long as the voice can possibly still be speaking (voice.maxRemainingMs()) and, when speech
  // ends or is cancelled, the audio context and the mic are checked (iOS shares the session).
  attachVoice(voice) {
    if (this._voiceOff) this._voiceOff();
    let rel = null;
    const bound = () => (typeof voice.maxRemainingMs === 'function' ? Number(voice.maxRemainingMs()) || 0 : 0);
    const off = voice.onChange((speaking) => {
      this._log('voice', { speaking: !!speaking });
      if (speaking && !rel) {
        rel = this.hold('voice', {
          tailMs: Math.max(this.tailMs, 400),
          maxMs: (bound() || HOLD_MAX_MS.voice) + 1500,
          renew: () => (voice.speaking && bound() > 0 ? bound() + 500 : 0),
        });
      } else if (!speaking && rel) {
        rel();
        rel = null;
        this._afterSpeech();
      }
    });
    this._voiceOff = () => {
      off();
      if (rel) rel();
      rel = null;
    };
    return this._voiceOff;
  }

  _afterSpeech() {
    if (!this.ctx) return;
    this.resume();
    this._check('voice-end');
    unref(setTimeout(() => this._check('voice-end'), 350));
  }

  // Play a sound effect; full-range sounds hold the mic for their duration. Returns seconds.
  playSfx(name, opts = {}) {
    if (!this.sfx) return 0;
    opts = opts || {};
    const dur = this.sfx.play(name, opts);
    if (dur > 0 && !this.sfx.isMicSafe(name)) {
      const lead = Math.max(0, (opts.when ?? this.ctx.currentTime) - this.ctx.currentTime);
      this.holdFor((lead + dur) * 1000, 'sfx');
    }
    return dur;
  }

  // Play notes through the piano with a lookahead scheduler, holding the mic until the sound has
  // decayed. notes: [{midi, time, dur, vel}] with `time` in seconds relative to `at` (default: now
  // + 0.1 s; pass at: 0 for absolute AudioContext times). Returns {start, end, done, stop()}.
  playNotes(notes, { at, gate = true, lookahead = 1.0 } = {}) {
    const ctx = this.ctx;
    const synth = this.synth;
    if (!ctx || !synth) return { start: 0, end: 0, done: Promise.resolve(), stop() {} };
    const start = at ?? ctx.currentTime + 0.1;
    const list = notes
      .filter((n) => n && n.midi >= 21 && n.midi <= 108)
      .map((n) => ({ midi: n.midi, t: start + (n.time || 0), dur: Math.max(0.03, n.dur || 0.3), vel: n.vel ?? 0.7 }))
      .sort((a, b) => a.t - b.t);
    let end = start;
    for (const n of list) end = Math.max(end, n.t + n.dur + synth.releaseTime(n.midi));
    // (the end timer below runs on the wall clock; maxMs is a second safety net)
    const release = gate ? this.hold('demo', { maxMs: Math.max(0, end - ctx.currentTime) * 1000 + 2000 }) : null;
    const voices = [];
    let i = 0;
    let stopped = false;
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    const pump = () => {
      if (stopped) return;
      const horizon = ctx.currentTime + lookahead;
      while (i < list.length && list[i].t < horizon) {
        const n = list[i++];
        if (n.t + n.dur < ctx.currentTime) continue; // fell behind (tab asleep)
        voices.push(synth.note(n.midi, Math.max(n.t, ctx.currentTime), n.dur, n.vel));
      }
      if (i >= list.length) clearInterval(timer);
    };
    const timer = setInterval(pump, 100);
    const finish = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(endTimer);
      if (release) release();
      resolveDone();
    };
    const endTimer = setTimeout(finish, Math.max(0, end - ctx.currentTime) * 1000 + 30);
    pump();
    return {
      start,
      end,
      done,
      stop: () => {
        if (stopped) return;
        const t = ctx.currentTime;
        for (const v of voices) synth.stop(v, t, { fast: true });
        finish();
      },
    };
  }

  // Play a generated piece (js/music/generator.js) as a demo. opts.timeOfBeat(beat) -> time on the
  // audio.now() clock (e.g. a Session's timeOfBeat, so the playhead and sound agree); otherwise
  // opts.startAt (AudioContext time, default now + 0.15 s) and opts.bpm (default piece.bpm).
  playDemo(piece, opts = {}) {
    if (!this.ctx) return this.playNotes([]);
    const toCtx = this.ctx.currentTime - this.now();
    const notes = demoNotes(piece, {
      ...opts,
      timeOfBeat: opts.timeOfBeat ? (b) => opts.timeOfBeat(b) + toCtx : undefined,
      startAt: opts.startAt ?? this.ctx.currentTime + 0.15,
    });
    return this.playNotes(notes, { at: 0, gate: opts.gate ?? true });
  }

  // ---- microphone --------------------------------------------------------------------------

  // Recent input level (RMS, 0..1). The UI decays it every frame (audio.level *= 0.9); the
  // listener reports ~20x per second, so each report is held for 60 ms to avoid a sawtooth.
  get level() {
    return perfNow() - this._lvlAt < 60 ? Math.max(this._level, this._lvlPeak) : this._level;
  }

  set level(v) {
    this._level = v;
  }

  // True while the microphone really delivers audio (or a fresh track is still starting up).
  get micOn() {
    if (!this._micWanted || !this.ctx) return false;
    const w = perfNow();
    this._sampleClock(w);
    const st = this._micStatus(w, this._effectiveContext(w));
    return st === 'live' || st === 'starting' || st === 'paused';
  }

  set micOn(v) {
    this._micWanted = !!v; // legacy
  }

  // The app asked for the microphone (startMic) and has not stopped it.
  get micWanted() {
    return this._micWanted;
  }

  // Open the microphone and start listening (idempotent). A mic that was started before but has
  // died (ended / muted / silent) is re-acquired. Rejects if access is denied.
  async startMic() {
    await this.ensureContext();
    this._micWanted = true;
    if (this._micStarting) return this._micStarting;
    if (this.tr && this.node && this.stream) {
      if (!this._micNeedsRestart()) return true;
      const ok = await this._reacquire('startMic', { force: true });
      if (!ok && this._micDenied) {
        this._micWanted = false;
        throw this._lastMicErr;
      }
      return true;
    }
    this._micStarting = (async () => {
      try {
        if (!this.node || !this.tr) await this._buildPipeline();
        await this._acquire('start');
        this._log('mic', { event: 'on', mode: this.mode });
        return true;
      } catch (e) {
        this._micFailed(e);
        this._micWanted = false;
        throw e;
      } finally {
        this._micStarting = null;
        this._check('startMic');
      }
    })();
    return this._micStarting;
  }

  // Stop listening and release the microphone.
  stopMic() {
    this._micWanted = false;
    this._stopTracks();
    this._log('mic', { event: 'stopped' });
    this._check('stopMic');
  }

  // Capture node + listener. Preferred: AudioWorklet -> MessagePort -> listener Worker.
  // Fallbacks: worklet -> main thread -> Worker ('relay'), worklet -> main-thread Listener
  // ('main'), ScriptProcessor -> main-thread Listener ('main-sp').
  async _buildPipeline() {
    const ctx = this.ctx;
    if (!this.sink) {
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(ctx.destination);
    }
    const cfg = this._listenerConfig();
    const WNode = this._global('AudioWorkletNode');
    if (ctx.audioWorklet && WNode) {
      if (!this._workletLoaded) {
        await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url).href);
        this._workletLoaded = true;
      }
      this._makeNode(WNode);
      let mode = 'main';
      if (this.useWorker && this._global('Worker') && (await this._startWorker(cfg))) mode = (await this._wirePort()) ? 'worker' : 'relay';
      if (mode === 'main') await this._startLocal(cfg);
      this._setMode(mode);
    } else {
      await this._startLocal(cfg);
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (e) => {
        this._hb.wall = perfNow();
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        if (this._local) this._local.push(data, Math.round(e.playbackTime * ctx.sampleRate));
      };
      sp.connect(this.sink);
      this.node = sp;
      this._setMode('main-sp');
    }
    this.tr = new ListenerClient((m, transfer) => this._send(m, transfer));
    this._syncListener(); // settings changed while the listener was starting
  }

  _makeNode(WNode) {
    const node = new WNode(this.ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, processorOptions: { chunk: 256 } });
    node.port.onmessage = (e) => this._onWorklet(e.data);
    node.onprocessorerror = () => {
      this._nodeBroken = true;
      this._log('worklet', { event: 'processorerror' });
      this._check('processorerror');
    };
    node.connect(this.sink);
    this.node = node;
    this._nodeBroken = false;
    this._hb.wall = 0;
  }

  _startWorker(cfg) {
    const W = this._global('Worker');
    return new Promise((resolve) => {
      let w;
      try {
        w = new W(new URL('./listener-worker.js', import.meta.url).href, { type: 'module', name: 'maestro-listener' });
      } catch (e) {
        this._log('worker', { event: 'unavailable', message: String((e && e.message) || e) });
        resolve(false);
        return;
      }
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        if (!ok) {
          try {
            w.terminate();
          } catch {
            /* ignore */
          }
        }
        resolve(ok);
      };
      const to = setTimeout(() => {
        this._log('worker', { event: 'timeout' });
        done(false);
      }, 4000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m && m.type === 'ready' && !settled) {
          this.worker = w;
          this._workerAlive = perfNow();
          w.onmessage = (ev) => this._onListenerMsg(ev.data);
          this._log('worker', { event: 'ready' });
          done(true);
        }
      };
      w.onerror = (e) => {
        const message = String((e && e.message) || 'error');
        if (e && e.preventDefault) e.preventDefault();
        this._log('worker', { event: 'error', message });
        if (!settled) done(false);
        else if (this.worker === w) this._restartWorker('error');
      };
      w.postMessage({ type: 'init', sampleRate: this.ctx.sampleRate, config: cfg });
    });
  }

  // Give the worklet a direct line to the worker. Resolves false if the worklet did not confirm.
  async _wirePort() {
    const MC = this._global('MessageChannel');
    if (!MC || !this.worker || !this.node || !this.node.port) return false;
    const ch = new MC();
    const confirmed = new Promise((r) => {
      this._portOk = () => r(true);
      setTimeout(() => r(false), 1500);
    });
    try {
      this.worker.postMessage({ type: 'port', port: ch.port2 }, [ch.port2]);
      this.node.port.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
    } catch (e) {
      this._log('worker', { event: 'port-failed', message: String((e && e.message) || e) });
      this._portOk = null;
      return false;
    }
    const ok = await confirmed;
    this._portOk = null;
    if (!ok) {
      try {
        this.node.port.postMessage({ type: 'unport' });
      } catch {
        /* ignore */
      }
    }
    return ok;
  }

  async _startLocal(cfg) {
    const { Listener } = await import('./listener.js');
    if (this._local) this._local.stopStatus();
    this._local = new Listener(this.ctx.sampleRate, cfg, (m) => this._onListenerMsg(m));
    this._local.startStatus(50);
    this._workerAlive = perfNow();
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this._log('listener', { mode });
  }

  _listenerConfig() {
    return {
      sensitivity: this.sensitivity,
      strictness: this.strictness ?? null,
      noisyRoom: this.noisyRoom ?? null,
      range: this._range || null,
      expected: this._expected || [],
      epoch: this._epoch,
    };
  }

  // Re-send the current settings (after a listener (re)start).
  _syncListener() {
    const tr = this.tr;
    if (!tr) return;
    tr._expKey = '';
    tr.sensitivity = this.sensitivity;
    if (this.strictness !== undefined) tr.setStrictness(this.strictness);
    if (this.noisyRoom !== undefined) tr.setNoisyRoom(this.noisyRoom);
    if (this._range) tr.setRange(this._range[0], this._range[1]);
    else tr.setRange(null);
    tr.setExpected(this._expected || []);
  }

  _send(m, transfer) {
    if (this.worker) {
      try {
        this.worker.postMessage(m, transfer || []);
      } catch (e) {
        this._log('worker', { event: 'post-failed', message: String((e && e.message) || e) });
      }
    } else if (this._local) this._local.command(m);
  }

  _onWorklet(d) {
    if (!d) return;
    if (d.type === 'hb') {
      this._hb = { wall: perfNow(), frame: d.frame, chans: d.chans, sent: d.sent };
      return;
    }
    if (d.type === 'port-ok') {
      if (this._portOk) this._portOk();
      return;
    }
    if (!d.samples) return;
    if (this.mode === 'relay' && this.worker) {
      try {
        this.worker.postMessage({ type: 'chunk', frame: d.frame, samples: d.samples }, [d.samples.buffer]);
      } catch {
        /* ignore */
      }
    } else if (this._local) this._local.push(d.samples, d.frame);
  }

  _onListenerMsg(m) {
    if (!m) return;
    this._workerAlive = perfNow();
    const cb = this._cb || (this._cb = this._transcriberOptions());
    switch (m.type) {
      case 'noteon':
        cb.onNoteOn(m.midi, m.t, m.vel, { confidence: m.confidence, restrike: m.restrike });
        break;
      case 'noteoff':
        cb.onNoteOff(m.midi, m.t);
        break;
      case 'onset':
        cb.onOnset(m.t, m.strength);
        break;
      case 'status':
        this._onStatus(m);
        break;
      case 'error':
        this._log('listener-error', { message: m.message });
        break;
      default:
        if (this.tr && typeof this.tr._onMessage === 'function') this.tr._onMessage(m);
    }
  }

  _onStatus(s) {
    const w = perfNow();
    const st = this.st;
    const current = s.epoch === this._epoch;
    if (current && s.epochChunks > 0) {
      if (s.lastChunkAgo >= 0) st.lastChunkWall = Math.max(st.lastChunkWall, w - s.lastChunkAgo);
      this._gotChunk = true;
    }
    st.chunks = s.chunks;
    st.epochChunks = current ? s.epochChunks : 0;
    st.chunkRate = s.chunkRate;
    st.costMsPerSec = s.costMsPerSec;
    st.costMax = s.costMax;
    st.gaps = s.gaps;
    st.errors = s.errors;
    st.stats = s.stats;
    st.recording = s.recording;
    st.zeroMs = current ? s.zeroMs : 0;
    st.rms = s.rms;
    st.peak = s.peak;
    this._lvlPeak = s.rms;
    this._lvlAt = w;
    if (s.rms > this._level) this._level = s.rms;
    if (this.tr && typeof this.tr._onMessage === 'function') this.tr._onMessage(s);
    const h = this._statusHist;
    if (!h.length || w - h[h.length - 1].t >= 1000) {
      const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x)) : null);
      h.push({ t: Math.round(w), rmsDb: db(s.rms), peakDb: db(s.peak), chunkRate: Math.round(s.chunkRate), costMs: Math.round(s.costMsPerSec), zeroMs: Math.round(s.zeroMs), noiseDb: s.noiseLevel == null ? null : Math.round(s.noiseLevel), held: this.held });
      if (h.length > 240) h.shift();
    }
  }

  // Open (or re-open) the microphone and connect it to the capture node. Everything up to the
  // getUserMedia() call is synchronous, so this works inside a tap handler (iOS user gesture).
  _acquire(why) {
    this._setAudioSession();
    this._stopTracks();
    const gum = this._gum();
    if (!gum) return Promise.reject(Object.assign(new Error('getUserMedia is not available'), { name: 'NotSupportedError' }));
    let p;
    try {
      p = Promise.resolve(gum(MIC_CONSTRAINTS));
    } catch (e) {
      p = Promise.reject(e);
    }
    return (async () => {
      const stream = await p;
      if (!this._micWanted) {
        for (const t of stream.getTracks()) t.stop();
        return false;
      }
      const tracks = stream.getAudioTracks ? stream.getAudioTracks() : stream.getTracks();
      const track = tracks[0] || null;
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(this.node);
      this.stream = stream;
      this.track = track;
      this.src = src;
      this._micDenied = false;
      this._micError = null;
      this._trackEnded = false;
      this._attachTrack(track);
      const w = perfNow();
      this._micSince = w;
      this._mutedSince = track && track.muted ? w : 0;
      this._epoch++;
      this._gotChunk = false;
      this.st.zeroMs = 0;
      this.st.lastChunkWall = 0;
      if (this.tr) this.tr.reset({ hard: true, epoch: this._epoch });
      let settings = null;
      try {
        settings = track && track.getSettings ? track.getSettings() : null;
      } catch {
        /* ignore */
      }
      this._log('mic', { event: 'acquired', why, label: track ? track.label : null, muted: !!(track && track.muted), settings });
      // a fresh track can be muted / silent for a few hundred ms: wait for the first chunk
      await this._waitFor(() => this._gotChunk, this.hc.firstChunkMs);
      return true;
    })();
  }

  _gum() {
    if (this.env.getUserMedia) return this.env.getUserMedia;
    const nav = this._nav();
    const md = nav && nav.mediaDevices;
    return md && md.getUserMedia ? (c) => md.getUserMedia(c) : null;
  }

  // iOS 17+: say explicitly that we play and record, once, before the first getUserMedia (so
  // WebKit does not flip the audio session category behind our back).
  _setAudioSession() {
    if (this._sessionSet) return;
    this._sessionSet = true;
    const nav = this._nav();
    const as = nav && nav.audioSession;
    if (!as) return;
    try {
      if (as.type !== 'play-and-record') as.type = 'play-and-record';
      this._log('audio-session', { sessionType: as.type, state: as.state });
    } catch (e) {
      this._log('audio-session', { error: String((e && e.message) || e) });
    }
    try {
      if (as.addEventListener)
        as.addEventListener('statechange', () => {
          this._log('audio-session', { state: as.state, sessionType: as.type });
          this._check('audio-session');
        });
    } catch {
      /* ignore */
    }
  }

  _attachTrack(track) {
    if (!track) return;
    const on = (type) => () => {
      if (this.track !== track) return;
      if (type === 'mute') this._mutedSince = perfNow();
      if (type === 'unmute') this._mutedSince = 0;
      if (type === 'ended') this._trackEnded = true;
      this._log('track', { event: type, muted: !!track.muted, state: track.readyState });
      this._check(`track-${type}`);
    };
    for (const type of ['ended', 'mute', 'unmute']) {
      if (track.addEventListener) track.addEventListener(type, on(type));
      else track[`on${type}`] = on(type);
    }
  }

  _stopTracks() {
    if (this.src) {
      try {
        this.src.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    }
    this.stream = null;
    this.track = null;
    this.src = null;
  }

  _micFailed(e) {
    const name = (e && e.name) || 'Error';
    this._micError = name;
    this._lastMicErr = e;
    if (name === 'NotAllowedError' || name === 'SecurityError') this._micDenied = true;
    this._log('mic-error', { name, message: String((e && e.message) || e) });
  }

  // Re-acquire the microphone (rate limited with backoff unless `force`, e.g. from a tap).
  // rebuild: also replace the capture worklet node. Resolves true if a new track was opened.
  _reacquire(reason, { force = false, rebuild = false } = {}) {
    if (this._reacq) return this._reacq;
    if (!this._micWanted || !this.tr || !this.node) return Promise.resolve(false);
    const w = perfNow();
    if (!force && w < this._reacqNextAt) return Promise.resolve(false);
    this.restarts++;
    const attempt = ++this._reacqFails;
    this._reacqNextAt = w + Math.min(this.hc.maxRestartMs, this.hc.minRestartMs * 2 ** (attempt - 1));
    this._log('mic-restart', { reason, attempt, rebuild, force });
    let acq;
    try {
      acq = this._acquire(reason);
    } catch (e) {
      acq = Promise.reject(e);
    }
    acq.catch(() => {});
    this._reacq = (async () => {
      try {
        if (rebuild) await this._rebuildNode();
        return !!(await acq);
      } catch (e) {
        this._micFailed(e);
        return false;
      } finally {
        this._reacq = null;
        this._check('restarted');
      }
    })();
    this._check('restarting');
    return this._reacq;
  }

  async _rebuildNode() {
    const WNode = this._global('AudioWorkletNode');
    if (!WNode || !this.node || this.mode === 'main-sp') return;
    const old = this.node;
    try {
      old.port.onmessage = null;
      old.disconnect();
    } catch {
      /* ignore */
    }
    this._makeNode(WNode);
    if (this.mode === 'worker' && !(await this._wirePort())) this._setMode('relay');
    if (this.src) {
      try {
        this.src.connect(this.node);
      } catch {
        /* ignore */
      }
    }
    this._log('worklet', { event: 'rebuilt' });
  }

  async _restartWorker(why) {
    if (this._workerRestarting || !this.node) return;
    const w = perfNow();
    if (w < this._workerNextAt) return;
    this._workerNextAt = w + 5000;
    this._workerRestarting = true;
    this._log('worker', { event: 'restart', why });
    try {
      if (this.worker) {
        try {
          this.worker.terminate();
        } catch {
          /* ignore */
        }
        this.worker = null;
      }
      this._epoch++;
      const cfg = this._listenerConfig();
      if (++this._workerRestarts <= 3 && (await this._startWorker(cfg))) {
        this._setMode((await this._wirePort()) ? 'worker' : 'relay');
      } else {
        try {
          this.node.port.postMessage({ type: 'unport' });
        } catch {
          /* ignore */
        }
        await this._startLocal(cfg);
        this._setMode('main');
      }
      this._gotChunk = false;
      this._micSince = perfNow();
      this._syncListener();
    } finally {
      this._workerRestarting = false;
    }
  }

  // Transcriber callbacks: gate mic events while the app's own sound plays, pass detection
  // confidence through (info = {confidence, restrike} from the Transcriber, if provided).
  _transcriberOptions() {
    const o = {
      sensitivity: this.sensitivity,
      onNoteOn: (midi, t, vel, info) => {
        const gated = this.micGated(t);
        const confidence = typeof info?.confidence === 'number' ? info.confidence : 1;
        this._noteSeen(midi, t, confidence, gated);
        if (gated) return;
        this._micSounding.add(midi);
        this.heard.set(midi, { source: 'mic', t });
        this._emit('noteon', { midi, time: t, vel, source: 'mic', confidence, restrike: !!info?.restrike });
      },
      onNoteOff: (midi, t) => {
        if (!this._micSounding.delete(midi)) return;
        if (this.heard.get(midi)?.source === 'mic') this.heard.delete(midi);
        this._emit('noteoff', { midi, time: t, source: 'mic' });
      },
      onOnset: (t, strength) => {
        if (this.micGated(t)) return;
        this._emit('onset', { time: t, strength, source: 'mic' });
      },
    };
    if (this.strictness !== undefined) o.strictness = this.strictness;
    if (this.noisyRoom !== undefined) o.noisyRoom = this.noisyRoom;
    return o;
  }

  _noteSeen(midi, t, confidence, gated) {
    const n = this.recentNotes;
    n.push({ midi, t: Math.round(t * 1000) / 1000, confidence: Math.round(confidence * 100) / 100, gated, at: Math.round(perfNow()), delayMs: Math.round((this.now() - t) * 1000) });
    if (n.length > 200) n.shift();
  }

  setSensitivity(v) {
    this.sensitivity = v;
    if (this.tr) this.tr.sensitivity = v;
  }

  // 0 = accept anything note-like, 1 = only clear piano notes. Forwarded when supported.
  setStrictness(v) {
    this.strictness = clamp(Number(v) || 0, 0, 1);
    if (!this.tr) return;
    if (typeof this.tr.setStrictness === 'function') this.tr.setStrictness(this.strictness);
    else this.tr.strictness = this.strictness;
  }

  setNoisyRoom(on) {
    this.noisyRoom = !!on;
    if (!this.tr) return;
    if (typeof this.tr.setNoisyRoom === 'function') this.tr.setNoisyRoom(this.noisyRoom);
    else if ('noisyRoom' in this.tr) this.tr.noisyRoom = this.noisyRoom;
    else if (this.strictness === undefined) this.setStrictness(this.noisyRoom ? 0.85 : 0.5);
  }

  setExpected(midis, range) {
    this._expected = midis ? [...midis] : [];
    if (range !== undefined) this._range = range;
    if (!this.tr) return;
    if (range !== undefined) this.tr.setExpected(midis, range);
    else this.tr.setExpected(midis);
  }

  setRange(lo, hi) {
    this._range = lo == null ? null : [lo, hi];
    if (this.tr && typeof this.tr.setRange === 'function') this.tr.setRange(lo, hi);
  }

  // Measure the room's noise floor. Resolves after `ms` to true, or false when nothing usable
  // arrived from the microphone (no chunks, or digital silence).
  calibrate(ms = 1800) {
    if (!this.tr) return Promise.resolve(false);
    this.tr.startCalibration();
    this._log('calibrate', { ms });
    return sleep(ms)
      .then(() => this.tr.finishCalibration())
      .then((ok) => {
        const res = !!ok && this.noiseRms > 1e-6;
        this._log('calibrated', { ok: res, noiseRms: this.noiseRms, noiseDb: this.noiseLevel });
        return res;
      });
  }

  get tuningCents() {
    return this.tr ? this.tr.tuningCents : 0;
  }

  // dBFS of the room noise / recent piano playing (null when unknown), for UI hints.
  get noiseLevel() {
    return this.tr && 'noiseLevel' in this.tr ? this.tr.noiseLevel : null;
  }

  get pianoLevel() {
    return this.tr && 'pianoLevel' in this.tr ? this.tr.pianoLevel : null;
  }

  // RMS of the room noise measured by the last calibrate() (0 when unknown).
  get noiseRms() {
    return (this.tr && this.tr.noiseRms) || 0;
  }

  // ---- health supervisor -------------------------------------------------------------------

  // {ok, context, mic, reason, needsGesture, since}. context: 'none' | 'running' | 'suspended' |
  // 'interrupted' | 'stalled' | 'closed'. mic: 'off' | 'starting' | 'live' | 'paused' (context
  // not running) | 'restarting' | 'muted' | 'ended' | 'no-data' | 'silent' | 'error' | 'denied'.
  // reason: null when ok, else e.g. 'context-interrupted', 'clock-stalled', 'mic-silent',
  // 'page-hidden'. needsGesture: automatic recovery keeps failing; call recover() from a tap.
  get health() {
    return { ...this._health };
  }

  // Resolves {ok, reason, needsGesture, ms} once the audio clock is running and, if the mic is
  // on, fresh mic chunks are arriving (or after timeoutMs). Starts recovery while it waits.
  async ready({ timeoutMs = 2500 } = {}) {
    const t0 = perfNow();
    const ctx = this.ctx;
    if (!ctx) return { ok: false, reason: 'no-context', needsGesture: true, ms: 0 };
    this._watch();
    const clk0 = ctx.currentTime;
    if (ctx.state !== 'running') this._tryResume(ctx.state, { force: true });
    let r;
    for (;;) {
      r = this._readyNow(clk0);
      if (r.ok || perfNow() - t0 >= timeoutMs) break;
      await sleep(25);
    }
    const ms = Math.round(perfNow() - t0);
    if (!r.ok) this._check('ready');
    const out = r.ok ? { ok: true, reason: null, needsGesture: false, ms } : { ok: false, reason: r.reason, needsGesture: !!this._health.needsGesture, ms };
    if (!r.ok || ms > 400) this._log('ready', out);
    return out;
  }

  _readyNow(clk0) {
    const ctx = this.ctx;
    const w = perfNow();
    this._sampleClock(w);
    if (!this._isVisible()) return { ok: false, reason: 'page-hidden' };
    if (ctx.state !== 'running') return { ok: false, reason: `context-${ctx.state}` };
    if (ctx.currentTime === clk0) return { ok: false, reason: 'clock-stalled' }; // not seen it move yet
    if (!this._micWanted) return { ok: true };
    const mic = this._micStatus(w, 'running');
    if (mic !== 'live') return { ok: false, reason: `mic-${mic}` };
    if (w - this.st.lastChunkWall > 350) return { ok: false, reason: 'mic-no-data' };
    return { ok: true };
  }

  // Fix listening from a tap (user gesture): resume the context and, if the mic is dead (or
  // opts.restartMic), re-acquire it. Resolves to the health state.
  recover(opts = {}) {
    const ctx = this.ctx;
    this._log('recover', { context: ctx ? ctx.state : 'none', mic: this._health.mic, restartMic: !!opts.restartMic });
    // Synchronous part first: iOS only honours resume() / getUserMedia() inside the gesture.
    let resumed = Promise.resolve();
    if (ctx && ctx.state !== 'running') {
      try {
        resumed = Promise.resolve(ctx.resume()).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    const stalled = this._health.context === 'stalled';
    let mic = Promise.resolve(true);
    if (this._micWanted && this.tr && this.node) {
      this._micDenied = false;
      if (opts.restartMic || this._micNeedsRestart()) mic = this._reacquire('recover', { force: true, rebuild: this._nodeBroken });
    }
    this._resumeFails = 0;
    this._resumeNextAt = 0;
    return (async () => {
      await race(resumed, this.hc.resumeTimeoutMs);
      if (stalled && ctx) await this._tryResume('stalled', { force: true });
      await mic;
      if (ctx) await this.ready({ timeoutMs: 2000 });
      this._check('recover');
      return this.health;
    })();
  }

  _micNeedsRestart() {
    const t = this.track;
    if (!t || t.readyState === 'ended' || this._trackEnded || t.muted) return true;
    if (!this.ctx) return false;
    const w = perfNow();
    this._sampleClock(w);
    return MIC_BAD.has(this._micStatus(w, this._effectiveContext(w)));
  }

  _effectiveContext(w) {
    const ctx = this.ctx;
    if (!ctx) return 'none';
    const s = ctx.state;
    if (s === 'running' && this._isVisible() && w - Math.max(this._clk.wall, this._clk.stateSince || 0, this._visibleSince) > this.hc.stallMs) return 'stalled';
    return s;
  }

  _micStatus(w, context) {
    if (!this._micWanted) return this._micDenied ? 'denied' : 'off';
    if (this._micDenied) return 'denied';
    if (this._micStarting && !this.stream) return 'starting';
    if (this._reacq) return 'restarting';
    const t = this.track;
    if (!t) return this._micError ? 'error' : 'ended';
    if (t.readyState === 'ended' || this._trackEnded) return 'ended';
    const grace = w - this._micSince < this.hc.muteGraceMs;
    if (t.muted) return grace ? 'starting' : 'muted';
    if (context !== 'running') return 'paused';
    const ref = Math.max(this.st.lastChunkWall, this._micSince, this._clk.runSince, this._visibleSince);
    if (!this._gotChunk) return w - ref > this.hc.firstChunkMs ? 'no-data' : 'starting';
    if (w - ref > this.hc.noDataMs) return 'no-data';
    if (this.st.zeroMs >= this.hc.zeroMs) return 'silent';
    return 'live';
  }

  _watch() {
    if (this._watching || !this.ctx) return;
    this._watching = true;
    const ctx = this.ctx;
    const w = perfNow();
    this._clk = { t: ctx.currentTime, wall: w, runSince: w, state: ctx.state, stateSince: w };
    this._onCtxState = () => {
      this._log('context', { state: ctx.state });
      this._check('statechange');
    };
    if (ctx.addEventListener) ctx.addEventListener('statechange', this._onCtxState);
    else ctx.onstatechange = this._onCtxState;
    this._tick = unref(setInterval(() => this._check('tick'), this.hc.tickMs));
    this._onVis = () => this._onVisibility();
    const doc = this._doc();
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', this._onVis);
    const win = this._win();
    if (win && win.addEventListener) {
      win.addEventListener('pageshow', this._onVis);
      win.addEventListener('focus', this._onVis);
    }
  }

  _onVisibility() {
    const vis = this._isVisible();
    if (vis === this._wasVisible) return;
    this._wasVisible = vis;
    this._log('visibility', { visible: vis, context: this.ctx ? this.ctx.state : 'none' });
    if (vis) {
      this._visibleSince = perfNow();
      this._resumeFails = 0;
      this._resumeNextAt = 0;
      if (this.ctx && this.ctx.state !== 'running') this._tryResume(this.ctx.state, { force: true });
      unref(setTimeout(() => this._check('visible'), 300));
    }
    this._check('visibility');
  }

  // One supervisor step: measure, act (resume / re-acquire), report.
  _check(why) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = perfNow();
    this._sampleClock(w);
    const visible = this._isVisible();
    const context = this._effectiveContext(w);
    const mic = this._micStatus(w, context);
    if (mic === 'live') {
      if (!this._liveSince) this._liveSince = w;
      if (w - this._liveSince > this.hc.liveResetMs) this._reacqFails = 0;
    } else this._liveSince = 0;
    let reason = null;
    if (context !== 'running') reason = context === 'stalled' ? 'clock-stalled' : `context-${context}`;
    else if (mic !== 'live' && mic !== 'off' && mic !== 'starting') reason = `mic-${mic}`;
    if (reason && !visible) reason = 'page-hidden'; // expected while hidden; re-checked when visible
    const needsGesture =
      visible && reason !== null && ((context !== 'running' && context !== 'closed' && this._resumeFails >= 2) || (context === 'running' && this._micWanted && !this._micDenied && !this._reacq && this._reacqFails >= 2));
    // report what we found first, then act (actions report their own progress)
    this._setHealth({ ok: reason === null, context, mic, reason, needsGesture }, why);
    if (visible) {
      if (context === 'suspended' || context === 'interrupted' || context === 'stalled') this._tryResume(context);
      else if (context === 'running') this._micActions(mic, w);
    }
  }

  _micActions(mic, w) {
    if (!this._micWanted || this._micDenied || this._reacq || this._micStarting || this._workerRestarting) return;
    // Not while Pip talks (the mic is ignored then anyway, and iOS may be reshuffling the audio
    // session for speech): _afterSpeech() re-checks as soon as the voice stops.
    for (const h of this._holds.values()) if (h.reason === 'voice') return;
    const t = this.track;
    if (t && t.muted) {
      if (!this._mutedSince) this._mutedSince = w;
    } else this._mutedSince = 0;
    if ((this.mode === 'worker' || this.mode === 'relay') && this._workerAlive && w - this._workerAlive > this.hc.workerStaleMs) {
      this._restartWorker('worker-silent');
      return;
    }
    let reason = null;
    let rebuild = false;
    if (mic === 'ended' || mic === 'error') reason = `mic-${mic}`;
    else if (mic === 'muted' && w - Math.max(this._mutedSince, this._micSince + this.hc.muteGraceMs) > this.hc.muteRestartMs) reason = 'mic-muted';
    else if (mic === 'silent') reason = 'mic-silent';
    else if (mic === 'no-data') {
      reason = 'mic-no-data';
      const hbRef = Math.max(this._hb.wall, this._micSince);
      if (this.mode !== 'main-sp' && (this._nodeBroken || w - hbRef > this.hc.hbStaleMs)) rebuild = true;
    }
    if (reason) this._reacquire(reason, { rebuild });
  }

  _tryResume(kind, { force = false } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return Promise.resolve(false);
    if (this._resuming) return this._resuming;
    if (!force && perfNow() < this._resumeNextAt) return Promise.resolve(false);
    const attempt = this._resumeFails + 1;
    this._log('resume', { kind, state: ctx.state, attempt });
    const call = (fn) => {
      try {
        return Promise.resolve(fn()).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    };
    const T = this.hc.resumeTimeoutMs;
    const clk = ctx.currentTime;
    // Claim the slot before touching the context: suspend()/resume() can fire 'statechange'
    // synchronously, which runs _check() and would otherwise re-enter here.
    let start;
    const gate = new Promise((r) => (start = r));
    this._resuming = gate;
    const p = kind === 'stalled' ? race(call(() => ctx.suspend()), T).then(() => race(call(() => ctx.resume()), T)) : race(call(() => ctx.resume()), T);
    start();
    this._resuming = gate
      .then(() => p)
      .then(() => sleep(kind === 'stalled' ? 120 : 0))
      .then(() => {
        this._resuming = null;
        const ok = ctx.state === 'running' && (kind !== 'stalled' || ctx.currentTime !== clk);
        if (ok) {
          this._resumeFails = 0;
          this._resumeNextAt = 0;
          const w = perfNow();
          this._clk.runSince = w;
        } else {
          this._resumeFails = attempt;
          this._resumeNextAt = perfNow() + Math.min(5000, 250 * 2 ** attempt);
        }
        this._log('resumed', { ok, state: ctx.state });
        this._check('resumed');
        return ok;
      });
    return this._resuming;
  }

  _setHealth(h, why) {
    const p = this._health;
    if (p.ok === h.ok && p.context === h.context && p.mic === h.mic && p.reason === h.reason && p.needsGesture === h.needsGesture) return;
    this._health = { ...h, since: Math.round(perfNow()) };
    this._log('health', { ...h, why });
    this._emit('health', { ...this._health });
  }

  async _waitFor(cond, ms) {
    const t0 = perfNow();
    while (!cond() && perfNow() - t0 < ms) await sleep(20);
    return cond();
  }

  _isVisible() {
    const d = this._doc();
    return !d || d.visibilityState !== 'hidden';
  }

  _doc() {
    if ('document' in this.env) return this.env.document;
    return typeof document !== 'undefined' ? document : null;
  }

  _win() {
    if ('window' in this.env) return this.env.window;
    return typeof window !== 'undefined' ? window : null;
  }

  _nav() {
    if ('navigator' in this.env) return this.env.navigator;
    return typeof navigator !== 'undefined' ? navigator : null;
  }

  _global(name) {
    if (name in this.env) return this.env[name];
    return typeof globalThis !== 'undefined' ? globalThis[name] : undefined;
  }

  // Stop timers, the mic and the listener (tests).
  dispose() {
    clearInterval(this._tick);
    this._tick = null;
    const doc = this._doc();
    if (doc && doc.removeEventListener && this._onVis) doc.removeEventListener('visibilitychange', this._onVis);
    const win = this._win();
    if (win && win.removeEventListener && this._onVis) {
      win.removeEventListener('pageshow', this._onVis);
      win.removeEventListener('focus', this._onVis);
    }
    this._watching = false;
    this._micWanted = false;
    this._stopTracks();
    if (this.worker) this.worker.terminate();
    this.worker = null;
    if (this._local) this._local.stopStatus();
    for (const h of this._holds.values()) clearTimeout(h.timer);
    clearTimeout(this._tailTimer);
  }

  // ---- diagnostics ---------------------------------------------------------------------------

  _log(type, data) {
    const e = { t: Math.round(perfNow()), ...(data || {}), type };
    this._events.push(e);
    if (this._events.length > this._eventCap) this._events.splice(0, this._events.length - this._eventCap);
  }

  // Add an app event to the troubleshooting log (e.g. 'count-in', {ready: ...}).
  logEvent(type, data) {
    this._log(String(type), data && typeof data === 'object' ? data : { value: data });
  }

  // Health / listening events since app start (oldest first, max 1000).
  events() {
    return this._events.slice();
  }

  // A snapshot of everything the Listening check shows.
  diagnostics() {
    const ctx = this.ctx;
    const w = perfNow();
    const t = this.track;
    let settings = null;
    try {
      settings = t && t.getSettings ? t.getSettings() : null;
    } catch {
      /* ignore */
    }
    const nav = this._nav();
    const as = nav && nav.audioSession;
    const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : null);
    const st = this.st;
    if (ctx) this._sampleClock(w);
    return {
      at: Math.round(w),
      health: { ...this._health },
      visible: this._isVisible(),
      context: ctx
        ? { state: ctx.state, effective: this._effectiveContext(w), sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency ?? null, outputLatency: ctx.outputLatency ?? null, currentTime: Math.round(ctx.currentTime * 1000) / 1000, clockAgeMs: Math.round(w - this._clk.wall) }
        : null,
      audioSession: as ? { type: as.type ?? null, state: as.state ?? null } : null,
      mic: {
        wanted: this._micWanted,
        on: this.micOn,
        state: ctx ? this._micStatus(w, this._effectiveContext(w)) : this._micWanted ? 'starting' : 'off',
        track: t ? { label: t.label, readyState: t.readyState, muted: !!t.muted, enabled: t.enabled !== false, settings } : null,
        sinceMs: this._micSince ? Math.round(w - this._micSince) : null,
        restarts: this.restarts,
        error: this._micError,
      },
      listener: {
        mode: this.mode,
        chunks: st.chunks,
        chunkRate: Math.round(st.chunkRate * 10) / 10,
        lastChunkMs: st.lastChunkWall ? Math.round(w - st.lastChunkWall) : null,
        zeroMs: Math.round(st.zeroMs),
        costMsPerSec: Math.round(st.costMsPerSec * 10) / 10,
        costMax: Math.round(st.costMax * 10) / 10,
        load: st.costMsPerSec / 1000,
        gaps: st.gaps,
        errors: st.errors,
        stats: st.stats,
        aliveMs: this._workerAlive ? Math.round(w - this._workerAlive) : null,
        heartbeat: this._hb.wall ? { ageMs: Math.round(w - this._hb.wall), chans: this._hb.chans, sent: this._hb.sent } : null,
        recording: st.recording,
      },
      levels: { inputDb: db(st.rms), peakDb: db(st.peak), noiseDb: this.noiseLevel, noiseRmsDb: db(this.noiseRms), pianoDb: this.pianoLevel, tuningCents: this.tuningCents },
      holds: this.holdInfo(),
      settings: { sensitivity: this.sensitivity, strictness: this.strictness ?? null, noisyRoom: this.noisyRoom ?? null, range: this._range || null, tailMs: this.tailMs },
    };
  }

  // Record `seconds` of the raw microphone signal: {samples, sampleRate, startFrame} or null.
  async recordMic(seconds = 15) {
    if (!this.tr || typeof this.tr.record !== 'function') return null;
    this._log('record', { seconds });
    const r = await this.tr.record(seconds);
    this._log('recorded', { seconds: r ? Math.round((r.samples.length / r.sampleRate) * 10) / 10 : 0 });
    return r;
  }

  // Everything for a troubleshooting report (JSON-safe).
  troubleshootingLog(extra = {}) {
    const nav = this._nav();
    return {
      app: 'Maestro',
      kind: 'listening-troubleshooting',
      createdAt: new Date().toISOString(),
      uptimeMs: Math.round(perfNow()),
      userAgent: nav ? nav.userAgent : null,
      platform: nav ? nav.platform ?? null : null,
      diagnostics: this.diagnostics(),
      events: this.events(),
      notes: this.recentNotes.slice(),
      statusHistory: this._statusHist.slice(),
      ...extra,
    };
  }

  // ---- MIDI and on-screen keys -------------------------------------------------------------

  async startMidi() {
    if (!navigator.requestMIDIAccess || this.midiOn) return this.midiOn;
    try {
      const access = await navigator.requestMIDIAccess();
      const hook = (input) => {
        input.onmidimessage = (msg) => {
          const [st, d1, d2] = msg.data;
          const cmd = st & 0xf0;
          const lag = Math.max(0, (performance.now() - msg.timeStamp) / 1000);
          const t = this.now() - lag;
          if (cmd === 0x90 && d2 > 0) this.noteOn(d1, t, d2 / 127, 'midi');
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.noteOff(d1, t, 'midi');
        };
      };
      access.inputs.forEach(hook);
      access.onstatechange = () => access.inputs.forEach(hook);
      this.midiOn = access.inputs.size > 0;
      this.midiAccess = access;
    } catch {
      this.midiOn = false;
    }
    return this.midiOn;
  }

  // Notes from MIDI or the on-screen keyboard. Touch notes sound until noteOff (max 4 s).
  noteOn(midi, t = this.now(), vel = 0.7, source = 'touch') {
    this.heard.set(midi, { source, t });
    if (source === 'midi') this._lastMidiAt = this.now();
    if (source === 'touch' && this.synth) {
      this._touchRelease(midi);
      const ct = this.ctx.currentTime;
      const offAt = this._touchOffAt.get(midi);
      const quick = offAt != null && this.now() - offAt < 0.25; // key already released
      this._touchOffAt.delete(midi);
      const v = this.synth.start(midi, ct, clamp(vel * 0.9, 0.05, 1), { maxDur: quick ? 0.35 : 4 });
      const tail = this.tailMs + this.synth.releaseTime(midi) * 1000;
      const release = this.touchHold ? this.holdFor((quick ? 0.35 : 4) * 1000, 'touch', { tailMs: tail }) : null;
      this._touch.set(midi, { v, release });
      if (quick) this._touchRelease(midi, ct + 0.35);
    }
    if (source === 'mic') {
      if (this.micGated(t)) return;
      this._micSounding.add(midi);
    }
    this._emit('noteon', { midi, time: t, vel, source, confidence: 1 });
    this._emit('onset', { time: t, strength: 1, source });
  }

  noteOff(midi, t = this.now(), source = 'touch') {
    if (source === 'touch') {
      if (this._touch.has(midi)) this._touchRelease(midi);
      else this._touchOffAt.set(midi, this.now());
    }
    if (source === 'mic' && !this._micSounding.delete(midi)) return;
    if (this.heard.get(midi)?.source === source) this.heard.delete(midi);
    this._emit('noteoff', { midi, time: t, source });
  }

  _touchRelease(midi, when) {
    const tv = this._touch.get(midi);
    if (!tv) return;
    this._touch.delete(midi);
    this.synth.stop(tv.v, when ?? this.ctx.currentTime);
    if (tv.release) {
      const delay = when ? Math.max(0, when - this.ctx.currentTime) * 1000 : 0;
      if (delay) setTimeout(tv.release, delay);
      else tv.release();
    }
  }
}

// Flatten a piece into [{midi, time, dur, vel}] (absolute seconds). Tied notes are held through
// their ties; the melody (right hand) sings slightly over the left hand, downbeats are accented.
export function demoNotes(piece, { timeOfBeat, startAt = 0, bpm, vel = 0.66 } = {}) {
  const spb = 60 / (bpm || piece.bpm || 80);
  const at = timeOfBeat || ((b) => startAt + b * spb);
  const beatsPer = piece.beatsPer || 4;
  const out = [];
  const events = piece.events || [];
  if (!events.length && piece.notes) {
    for (const n of piece.notes) out.push({ midi: n.midi, time: at(n.beat), dur: Math.max(0.05, (at(n.beat + n.dur) - at(n.beat)) * 0.95), vel });
    return out;
  }
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const e of events) {
    if (e.rest || e.tiedFrom != null || !e.midis || !e.midis.length) continue;
    let beats = e.dur;
    let cur = e;
    const seen = new Set([e.id]);
    while (cur.tieNext != null && byId.has(cur.tieNext) && !seen.has(cur.tieNext)) {
      cur = byId.get(cur.tieNext);
      seen.add(cur.id);
      beats += cur.dur;
    }
    const t0 = at(e.beat);
    const t1 = at(e.beat + beats);
    const down = Math.abs(e.beat / beatsPer - Math.round(e.beat / beatsPer)) < 1e-6;
    const v = clamp(vel + (down ? 0.08 : 0) + (e.hand === 'L' || e.staff === 'bass' ? -0.1 : 0), 0.1, 1);
    for (const m of e.midis) out.push({ midi: m, time: t0, dur: Math.max(0.05, (t1 - t0) * 0.95), vel: v });
  }
  return out;
}

// ---- piano -------------------------------------------------------------------------------

// Salamander Grand Piano (Yamaha C5) by Alexander Holm, CC-BY 3.0, as distributed by Tone.js:
// one sample every minor third from A0 to C8.
const PC_NAME = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };
export const PIANO_SAMPLES = [];
for (let m = 21; m <= 108; m += 3) PIANO_SAMPLES.push({ midi: m, name: `${PC_NAME[m % 12]}${Math.floor(m / 12) - 1}` });

// Max decoded length per register (s): keeps decoded memory ~22 MB instead of ~160 MB.
const sampleCap = (midi) => (midi < 48 ? 5 : midi < 72 ? 4 : 3);

// Piano: Salamander samples (pitch-shifted to the nearest sample) with an additive oscillator
// fallback while they load, plus a hi-hat style metronome tick. The tick is filtered to above
// 10.5 kHz so the listener (which analyses 0-9.5 kHz) never hears it as a note or onset.
export class Synth {
  // opts: { baseUrl (folder with <Name>.mp3), maxVoices (default 40), volume, reverb (0..1) }
  constructor(ctx, destination = ctx.destination, opts = {}) {
    this.ctx = ctx;
    this.baseUrl = opts.baseUrl || new URL('../../assets/piano/', import.meta.url).href;
    this.maxVoices = opts.maxVoices || 40;
    this.maxShift = 7; // semitones a sample may be stretched while others are still loading
    // Timing compensation so the audible attack lands exactly on the scheduled time: the
    // compressor's fixed look-ahead (6 ms in Chromium and WebKit) and the 3 ms of each sample
    // kept before its hammer attack.
    this.compDelay = 0.006;
    this.preRoll = 0.003;
    this.samples = new Map(); // midi -> {midi, buffer}
    this.sampleMidis = [];
    this.samplesReady = false;
    this.loaded = 0;
    this.failed = 0;
    this.voices = [];

    // voices -> input -> [dry, room] -> out -> gentle limiter -> destination
    this.input = ctx.createGain();
    this.out = ctx.createGain();
    this.out.gain.value = opts.volume ?? 1;
    const comp = (this.limiter = ctx.createDynamicsCompressor());
    comp.threshold.value = -8;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.input.connect(this.out);
    this.wet = ctx.createGain();
    this.wet.gain.value = opts.reverb ?? 0.16;
    try {
      this.reverb = createReverb(ctx, { seconds: 1.5, decay: 0.2 }); // RT60 ~1.4 s
      this.input.connect(this.reverb);
      this.reverb.connect(this.wet);
      this.wet.connect(this.out);
    } catch {
      this.reverb = null;
    }
    this.out.connect(comp);
    comp.connect(destination);

    // metronome: dry, through the mic-safe 16th-order high-pass (10.5 kHz), so the ticks never
    // register as onsets or notes (a 4th-order filter let one onset through per tick)
    this.tickOut = ctx.createGain();
    this.tickOut.gain.value = 0.5;
    const safe = micSafeFilter(ctx);
    this.tickIn = safe.input;
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 1.6; // make up for the steeper filter
    safe.output.connect(this.tickGain);
    this.tickGain.connect(this.tickOut);
    this.tickOut.connect(destination);
    const len = Math.floor(ctx.sampleRate * 0.05);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    // Seeded noise: every session gets the same tick, the one the tests prove the listener
    // ignores (random noise occasionally leaked enough below the high-pass to look like an attack).
    const d = this.noise.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
  }

  setVolume(v) {
    this.out.gain.setTargetAtTime(clamp(v, 0, 1.5), this.ctx.currentTime, 0.02);
  }

  setTickVolume(v) {
    this.tickOut.gain.setTargetAtTime(clamp(v, 0, 1.5), this.ctx.currentTime, 0.02);
  }

  setReverb(v) {
    this.wet.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.05);
  }

  // Fetch + decode the samples (4 at a time, middle register first). Each sample is usable as
  // soon as it decodes. Resolves to true if any sample loaded (never rejects). Safe to call
  // repeatedly; after failures (e.g. offline) a later call retries only the missing samples.
  load({ onProgress } = {}) {
    if (this._loading) return this._loading;
    const queue = PIANO_SAMPLES.filter((s) => !this.samples.has(s.midi)).sort((a, b) => Math.abs(a.midi - 64) - Math.abs(b.midi - 64));
    const total = PIANO_SAMPLES.length;
    this.failed = 0;
    const report = () => {
      try {
        if (onProgress) onProgress({ loaded: this.loaded, failed: this.failed, total, ready: this.samplesReady });
      } catch {
        /* a listener error must not stop loading */
      }
    };
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        try {
          const res = await fetch(this.baseUrl + s.name + '.mp3');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = await this._decode(await res.arrayBuffer());
          this._addSample(s.midi, this._prepare(raw, s.midi));
          this.loaded = this.samples.size;
        } catch (e) {
          this.failed++;
          if (this.failed === 1 && typeof console !== 'undefined') console.warn('piano samples:', (e && e.message) || e);
        }
        report();
      }
    };
    this._loading = Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      this.samplesReady = this.samples.size > 0;
      if (this.samplesReady) this.maxShift = 12;
      report();
      if (this.failed) this._loading = null; // allow a retry later
      return this.samplesReady;
    });
    return this._loading;
  }

  _decode(ab) {
    return new Promise((resolve, reject) => {
      // callback form: works in every Safari; also swallow the promise form's rejection
      const p = this.ctx.decodeAudioData(ab, resolve, (e) => reject(e || new Error('decode failed')));
      if (p && p.catch) p.catch(() => {});
    });
  }

  // Mono downmix, start at the attack (MP3 encoder delay differs between browsers), cap length.
  _prepare(buf, midi) {
    const sr = buf.sampleRate;
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const n = buf.length;
    // The hammer attack is where the (mono) level jumps past 10% of its peak; 5-10 ms of quiet
    // key noise / MP3 pre-echo come before it. Start 3 ms earlier so note times are exact.
    const scan = Math.min(n, sr);
    let peak = 0;
    for (let i = 0; i < scan; i++) peak = Math.max(peak, Math.abs(L[i] + R[i]));
    const thr = peak * 0.1;
    let on = 0;
    while (on < scan && Math.abs(L[on] + R[on]) < thr) on++;
    on = Math.max(0, on - Math.round(sr * 0.003));
    const len = Math.min(n - on, Math.round(sr * sampleCap(midi)));
    const out = this.ctx.createBuffer(1, Math.max(1, len), sr);
    const d = out.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (L[on + i] + R[on + i]) * 0.5;
    const fin = Math.min(len, Math.round(sr * 0.001)); // 1 ms fade-in: no click at the cut
    for (let i = 0; i < fin; i++) d[i] *= i / fin;
    if (len < n - on) {
      // truncated: fade the last 0.8 s out smoothly
      const f = Math.min(len, Math.round(sr * 0.8));
      for (let k = 0; k < f; k++) d[len - f + k] *= Math.pow(Math.cos((Math.PI / 2) * (k / f)), 2);
    }
    return out;
  }

  _addSample(midi, buffer) {
    this.samples.set(midi, { midi, buffer });
    this.sampleMidis = [...this.samples.keys()].sort((a, b) => a - b);
  }

  _nearest(midi) {
    let best = null;
    let bd = Infinity;
    for (const m of this.sampleMidis) {
      const d = Math.abs(m - midi) + (m < midi ? 0.01 : 0); // tie: prefer shifting down
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best != null && Math.abs(best - midi) <= this.maxShift ? this.samples.get(best) : null;
  }

  hasSampleNear(midi, maxShift = 3) {
    const s = this._nearest(midi);
    return !!s && Math.abs(s.midi - midi) <= maxShift;
  }

  // Damper release time constant (s): bass strings ring longer; above ~F6 there are no dampers.
  releaseTau(midi) {
    if (midi >= 89) return 0.3;
    const x = clamp((midi - 36) / 48, 0, 1);
    return 0.16 - 0.08 * x;
  }

  // Seconds from key release until the note is inaudible (~ -45 dB), incl. a little room.
  releaseTime(midi) {
    return this.releaseTau(midi) * 5 + 0.15;
  }

  // Start a note; returns a voice handle for stop(). opts.maxDur: auto-release after this long.
  start(midi, when = this.ctx.currentTime, vel = 0.7, opts = {}) {
    const ctx = this.ctx;
    when = Math.max(when, ctx.currentTime);
    vel = clamp(vel, 0.02, 1);
    // re-striking a key damps its previous sound
    for (const v of this.voices) if (v.midi === midi && v.when < when - 0.001 && (v.releaseAt == null || v.releaseAt > when)) this._release(v, when, 0.05);
    this._steal(when);
    const s = this._nearest(midi);
    const t0 = Math.max(ctx.currentTime, when - this.compDelay - (s ? this.preRoll : 0));
    const v = s ? this._sampleVoice(s, midi, t0, vel) : this._oscVoice(midi, t0, vel);
    this.voices.push(v);
    if (opts.maxDur) this._release(v, when + opts.maxDur, this.releaseTau(midi));
    return v;
  }

  // Release a voice at `when` (damper). opts.fast: quick fade (voice stealing / stop).
  stop(v, when = this.ctx.currentTime, opts = {}) {
    if (!v) return;
    const t = Math.max(when, v.when);
    if (opts.fast && v.when > this.ctx.currentTime) return this._cancel(v);
    this._release(v, t, opts.fast ? 0.02 : this.releaseTau(v.midi));
  }

  // Classic one-shot: a note of `dur` seconds (release starts at when + dur). Returns the voice.
  note(midi, when, dur, vel = 0.7) {
    const v = this.start(midi, when, vel);
    const end = Math.max(when, this.ctx.currentTime) + Math.max(0.02, dur) - this.compDelay;
    this._release(v, Math.max(v.when + 0.02, end), this.releaseTau(midi));
    return v;
  }

  chord(midis, when, dur, vel = 0.7, spread = 0) {
    return midis.map((m, i) => this.note(m, when + i * spread, dur, vel));
  }

  _sampleVoice(s, midi, when, vel) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    const rate = Math.pow(2, (midi - s.midi) / 12);
    src.playbackRate.value = rate;
    // velocity: loudness curve (~30 dB range) and a darker tone for soft notes
    const amp = 2.1 * Math.pow(vel, 1.7);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(amp, when);
    let head = g;
    if (vel < 0.75) {
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(20000 * Math.pow(vel / 0.75, 3), f0 * 3 + 500, 20000);
      lp.Q.value = 0.4;
      src.connect(lp);
      lp.connect(g);
    } else src.connect(g);
    let tail = head;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp((midi - 64) / 44, -1, 1) * 0.35;
      head.connect(p);
      tail = p;
    }
    tail.connect(this.input);
    src.start(when);
    const v = { midi, when, g, srcs: [src], amp, endAt: when + s.buffer.duration / rate, releaseAt: null };
    src.onended = () => this._drop(v);
    return v;
  }

  _oscVoice(midi, when, vel) {
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(12000, f * 8), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 400), when + 1.2);
    g.connect(lp);
    lp.connect(this.input);
    const amp = 0.3 * vel;
    const decay = Math.max(0.6, 3.5 * Math.pow(2, -(midi - 48) / 18));
    g.gain.value = 0;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.006);
    g.gain.setTargetAtTime(amp * 0.35, when + 0.006, decay * 0.25);
    const srcs = [
      [1, 'triangle', 1],
      [2, 'sine', 0.35],
      [3, 'sine', 0.12],
    ].map(([mult, type, lvl]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult * (1 + 0.0004 * mult * mult);
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og);
      og.connect(g);
      o.start(when);
      return o;
    });
    const v = { midi, when, g, srcs, amp, endAt: Infinity, releaseAt: null, osc: true };
    srcs[0].onended = () => this._drop(v);
    return v;
  }

  _release(v, t, tau) {
    if (v.releaseAt != null && v.releaseAt <= t) return;
    v.releaseAt = t;
    v.g.gain.setTargetAtTime(0, t, tau);
    const end = t + tau * 7;
    v.endAt = Math.min(v.endAt, end);
    for (const s of v.srcs) {
      try {
        s.stop(end);
      } catch {
        /* older WebKit: stop() already scheduled (gain is already fading) */
      }
    }
  }

  // A voice that has not started yet: make sure it never sounds.
  _cancel(v) {
    const now = this.ctx.currentTime;
    v.releaseAt = now;
    v.endAt = now;
    try {
      v.g.gain.cancelScheduledValues(0);
      v.g.gain.setValueAtTime(0, now);
    } catch {
      /* ignore */
    }
    for (const s of v.srcs) {
      try {
        s.stop(now);
      } catch {
        /* ignore */
      }
    }
  }

  _drop(v) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  // Polyphony limit: when more than maxVoices keys would be sounding (not yet released) at
  // `when`, the oldest are faded out quickly.
  _steal(when) {
    const live = this.voices.filter((v) => v.when <= when + 0.001 && v.endAt > when && !(v.releaseAt != null && v.releaseAt <= when));
    if (live.length < this.maxVoices) return;
    live.sort((a, b) => a.when - b.when);
    for (let k = 0; k <= live.length - this.maxVoices; k++) this._release(live[k], when, 0.015);
  }

  // Voices sounding now and not yet released.
  get activeVoices() {
    const t = this.ctx.currentTime;
    return this.voices.filter((v) => v.when <= t && v.endAt > t && !(v.releaseAt != null && v.releaseAt <= t)).length;
  }

  // Metronome tick (hi-hat-like noise, all energy above 10.5 kHz: safe while listening).
  tick(when, accent = false) {
    const ctx = this.ctx;
    when = Math.max(when, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.9 : 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
    src.connect(g);
    g.connect(this.tickIn);
    src.start(when);
    src.stop(when + 0.05);
  }

  stopAll() {
    const t = this.ctx.currentTime;
    for (const v of [...this.voices]) {
      if (v.when > t) this._cancel(v);
      else this._release(v, t, 0.03);
    }
  }
}
