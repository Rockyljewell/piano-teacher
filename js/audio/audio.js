// Audio I/O: microphone capture -> Transcriber, Web MIDI, on-screen keys, and a small synth
// for demos and the metronome. Everything is timed on the AudioContext clock.
import { Transcriber } from './transcriber.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.listeners = { noteon: [], noteoff: [], onset: [] };
    this.heard = new Map(); // midi -> {source, t}
    this.level = 0;
    this.muted = false;
    this.micOn = false;
    this.midiOn = false;
    this.sensitivity = 1;
    this._lastT = 0;
    this._lastP = 0;
  }

  on(type, fn) {
    this.listeners[type].push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  _emit(type, ev) {
    for (const fn of this.listeners[type]) fn(ev);
  }

  async ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.synth = new Synth(this.ctx);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
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

  async startMic() {
    await this.ensureContext();
    if (this.micOn) return true;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream = stream;
    const ctx = this.ctx;
    const src = ctx.createMediaStreamSource(stream);
    this.tr = new Transcriber(ctx.sampleRate, {
      sensitivity: this.sensitivity,
      onNoteOn: (midi, t, vel) => {
        if (this.muted) return;
        this.heard.set(midi, { source: 'mic', t });
        this._emit('noteon', { midi, time: t, vel, source: 'mic' });
      },
      onNoteOff: (midi, t) => {
        if (this.heard.get(midi)?.source === 'mic') this.heard.delete(midi);
        this._emit('noteoff', { midi, time: t, source: 'mic' });
      },
      onOnset: (t, strength) => {
        if (!this.muted) this._emit('onset', { time: t, strength, source: 'mic' });
      },
    });
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

  setSensitivity(v) {
    this.sensitivity = v;
    if (this.tr) this.tr.sensitivity = v;
  }

  setExpected(midis) {
    if (this.tr) this.tr.setExpected(midis);
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

  // Notes from MIDI or the on-screen keyboard.
  noteOn(midi, t = this.now(), vel = 0.7, source = 'touch') {
    this.heard.set(midi, { source, t });
    if (source === 'touch' && this.synth) this.synth.note(midi, this.ctx.currentTime, 0.6, vel * 0.8);
    if (this.muted && source === 'mic') return;
    this._emit('noteon', { midi, time: t, vel, source });
    this._emit('onset', { time: t, strength: 1, source });
  }

  noteOff(midi, t = this.now(), source = 'touch') {
    if (this.heard.get(midi)?.source === source) this.heard.delete(midi);
    this._emit('noteoff', { midi, time: t, source });
  }
}

// A small additive "piano-ish" synth plus a hi-hat style metronome tick. The tick lives
// above 9 kHz so the listener (which ignores that range) doesn't hear it as a note.
export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    this.out.connect(comp);
    comp.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.05);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.voices = [];
  }

  note(midi, when, dur, vel = 0.7) {
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(12000, f * 8), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 400), when + 1.2);
    g.connect(lp);
    lp.connect(this.out);
    const amp = 0.18 * vel;
    const decay = Math.max(0.6, 3.5 * Math.pow(2, -(midi - 48) / 18));
    const end = when + dur;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.006);
    g.gain.setTargetAtTime(amp * 0.35, when + 0.006, decay * 0.25);
    g.gain.setTargetAtTime(0, end, 0.08);
    const oscs = [
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
      o.stop(end + 0.6);
      return o;
    });
    const v = { oscs, g, end };
    this.voices.push(v);
    oscs[0].onended = () => (this.voices = this.voices.filter((x) => x !== v));
  }

  tick(when, accent = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 11000;
    hp.Q.value = 0.8;
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 11000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.9 : 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
    src.connect(hp);
    hp.connect(hp2);
    hp2.connect(g);
    g.connect(this.out);
    src.start(when);
    src.stop(when + 0.05);
  }

  stopAll() {
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0, t, 0.03);
      for (const o of v.oscs) {
        try {
          o.stop(t + 0.2);
        } catch {
          /* already stopped */
        }
      }
    }
    this.voices = [];
  }
}
