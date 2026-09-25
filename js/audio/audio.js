// Audio I/O: microphone capture -> Transcriber, Web MIDI, on-screen keys, a sampled grand piano
// (Salamander, with an oscillator fallback) for demos and touch keys, UI sound effects and the
// metronome. Everything is timed on the AudioContext clock.
//
// Mic gating: anything the app itself plays through the speaker (coach voice, demo playback,
// full-range sound effects, touch-key notes) would otherwise be heard by the microphone and
// graded as notes. hold()/holdFor() suppress mic note/onset events (reference counted); on the
// last release the transcriber is reset and a short tail is ignored while the speaker decays.
import { Transcriber } from './transcriber.js';
import { Sfx, createReverb, micSafeFilter } from './sfx.js';

const DEFAULT_TAIL_MS = 250;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AudioEngine {
  // opts: { tailMs (default 250), pianoBaseUrl, autoLoadPiano (default true) }
  constructor(opts = {}) {
    this.ctx = null;
    this.listeners = { noteon: [], noteoff: [], onset: [], hold: [], piano: [] };
    this.heard = new Map(); // midi -> {source, t}
    this.level = 0;
    this.micOn = false;
    this.midiOn = false;
    this.sensitivity = 1;
    this.strictness = undefined; // forwarded to the Transcriber when set
    this.noisyRoom = undefined;
    this.tailMs = opts.tailMs ?? DEFAULT_TAIL_MS;
    this.touchHold = true; // gate the mic while on-screen-key notes sound
    this.midiSuppressesMic = true; // a MIDI keyboard in use: ignore the mic for a few seconds
    this.pianoBaseUrl = opts.pianoBaseUrl;
    this.autoLoadPiano = opts.autoLoadPiano ?? true;
    this._lastT = 0;
    this._lastP = 0;
    this._holds = new Map(); // id -> {reason, tail}
    this._holdSeq = 0;
    this._gateFrom = 0;
    this._tailUntil = -Infinity;
    this._gates = []; // past gated intervals [{from, to}] on the audio clock
    this._micSounding = new Set(); // mic notes whose noteon was emitted
    this._touch = new Map(); // midi -> {v, release}
    this._touchOffAt = new Map();
    this._lastMidiAt = -Infinity;
    this._mutedRelease = null;
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  _emit(type, ev) {
    const ls = this.listeners[type];
    if (ls) for (const fn of ls) fn(ev);
  }

  async ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.synth = new Synth(this.ctx, this.master, { baseUrl: this.pianoBaseUrl });
      this.sfx = new Sfx(this.ctx, this.master, { synth: this.synth });
      if (this.autoLoadPiano) this.loadPiano();
    }
    // (resume() can stay pending on iOS outside a user gesture: never block the caller forever)
    if (this.ctx.state !== 'running') await Promise.race([this.ctx.resume().catch(() => {}), sleep(1500)]);
    return this.ctx;
  }

  // Try to resume after an iOS interruption (phone call, Siri, speech). Harmless if running.
  resume() {
    if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume().catch(() => {});
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
    if (!this.ctx) return performance.now() / 1000;
    const t = this.ctx.currentTime;
    const p = performance.now();
    if (t !== this._lastT) {
      this._lastT = t;
      this._lastP = p;
    }
    return t + Math.min(0.03, (p - this._lastP) / 1000);
  }

  // ---- mic gating --------------------------------------------------------------------------

  // Suppress mic notes until the returned function is called (idempotent). opts.tailMs: how
  // long to keep ignoring the mic after release (speaker decay + room), default this.tailMs.
  hold(reason = 'app', opts = {}) {
    const id = ++this._holdSeq;
    const wasHeld = this._holds.size > 0;
    const lat = this.ctx ? (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0) : 0;
    this._holds.set(id, { reason, tail: (opts.tailMs ?? this.tailMs) / 1000 + Math.min(0.2, lat) });
    if (!wasHeld && !(this.now() < this._tailUntil)) this._gateFrom = this.now();
    if (!wasHeld) this._emitHold();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this._release(id);
    };
  }

  // Hold for `ms` milliseconds. Returns a function that releases early.
  holdFor(ms, reason = 'app', opts = {}) {
    const release = this.hold(reason, opts);
    const tm = setTimeout(release, Math.max(0, ms));
    return () => {
      clearTimeout(tm);
      release();
    };
  }

  _release(id) {
    const h = this._holds.get(id);
    if (!h) return;
    this._holds.delete(id);
    const now = this.now();
    this._tailUntil = Math.max(this._tailUntil, now + h.tail);
    if (this._holds.size) return;
    this._resetTranscriber();
    clearTimeout(this._tailTimer);
    this._tailTimer = setTimeout(() => this._tailEnd(), Math.max(0, (this._tailUntil - now) * 1000) + 15);
    this._emitHold();
  }

  _tailEnd() {
    if (this._holds.size) return;
    if (this.now() < this._tailUntil) {
      this._tailTimer = setTimeout(() => this._tailEnd(), (this._tailUntil - this.now()) * 1000 + 15);
      return;
    }
    this._gates.push({ from: this._gateFrom, to: this._tailUntil });
    const cut = this.now() - 10;
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
    return this._holds.size > 0 || this.now() < this._tailUntil;
  }

  get holdReasons() {
    return [...new Set([...this._holds.values()].map((h) => h.reason))];
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
    const now = this.now();
    if (now < this._tailUntil) return true;
    if (t >= this._gateFrom && t <= this._tailUntil) return true;
    for (const g of this._gates) if (t >= g.from && t <= g.to) return true;
    if (this.midiSuppressesMic && now - this._lastMidiAt < 6) return true;
    return false;
  }

  // Link a voice (js/voice.js) so the mic is held while it speaks.
  attachVoice(voice) {
    if (this._voiceOff) this._voiceOff();
    let rel = null;
    const off = voice.onChange((speaking) => {
      if (speaking && !rel) rel = this.hold('voice', { tailMs: Math.max(this.tailMs, 400) });
      else if (!speaking && rel) {
        rel();
        rel = null;
        this.resume();
      }
    });
    this._voiceOff = () => {
      off();
      if (rel) rel();
      rel = null;
    };
    return this._voiceOff;
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
    const release = gate ? this.hold('demo') : null;
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

  async startMic() {
    await this.ensureContext();
    if (this.micOn) return true;
    // Raw signal: the browser's echo cancellation / noise suppression / AGC are tuned for speech
    // and would eat sustained piano tones (and switch iOS into voice-processing mode).
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream = stream;
    const ctx = this.ctx;
    const src = ctx.createMediaStreamSource(stream);
    this.tr = new Transcriber(ctx.sampleRate, this._transcriberOptions());
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    const feed = (samples, frame) => {
      let s = 0;
      for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
      const rms = Math.sqrt(s / samples.length);
      this.level = Math.max(rms, this.level * 0.9);
      this.tr.push(samples, frame);
    };
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url).href);
      const node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e) => feed(e.data.samples, e.data.frame);
      src.connect(node);
      node.connect(sink);
      this.node = node;
    } else {
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        feed(data, Math.round(e.playbackTime * ctx.sampleRate));
      };
      src.connect(sp);
      sp.connect(sink);
      this.node = sp;
    }
    this.micOn = true;
    return true;
  }

  // Transcriber callbacks: gate mic events while the app's own sound plays, pass detection
  // confidence through (info = {confidence, restrike} from the Transcriber, if provided).
  _transcriberOptions() {
    const o = {
      sensitivity: this.sensitivity,
      onNoteOn: (midi, t, vel, info) => {
        if (this.micGated(t)) return;
        this._micSounding.add(midi);
        this.heard.set(midi, { source: 'mic', t });
        const confidence = typeof info?.confidence === 'number' ? info.confidence : 1;
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
    if (!this.tr) return;
    if (range !== undefined) this.tr.setExpected(midis, range);
    else this.tr.setExpected(midis);
  }

  setRange(lo, hi) {
    if (this.tr && typeof this.tr.setRange === 'function') this.tr.setRange(lo, hi);
  }

  // Measure the room's noise floor. Resolves after `ms`.
  calibrate(ms = 1800) {
    if (!this.tr) return Promise.resolve(false);
    this.tr.startCalibration();
    return new Promise((res) => setTimeout(() => res(this.tr.finishCalibration()), ms));
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
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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
