// The listener: the Transcriber plus the input meters, the "is anything arriving?" bookkeeping,
// the troubleshooting recorder and a compact status report. It speaks a small message protocol
// so the same code runs in the listener Web Worker (js/audio/listener-worker.js, the normal
// path) and on the main thread (fallback when Workers/AudioWorklet are unavailable).
//
// In:  push(samples, frame)            mic samples, `frame` = AudioContext frame of samples[0]
//      command({type, ...})            setExpected / setRange / setStrictness / setNoisyRoom /
//                                      setSensitivity / reset {hard, epoch} / calStart /
//                                      calFinish {id} / record {id, seconds} / recordStop {id}
// Out: emit({type: 'noteon', midi, t, vel, confidence, restrike}) | {type: 'noteoff', midi, t}
//      | {type: 'onset', t, strength} | {type: 'status', ...} (~20 Hz while audio flows, 4 Hz
//      otherwise) | {type: 'cal', id, ok, noiseRms, noiseLevel}
//      | {type: 'recording', id, samples, sampleRate, startFrame} | {type: 'error', message}
import { Transcriber } from './transcriber.js';

export const ZERO_LEVEL = 1e-7; // |sample| below this counts as digital silence

const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const finite = (x) => (typeof x === 'number' && Number.isFinite(x) && x > -150 ? x : null);

export class Listener {
  // config: { sensitivity, strictness, noisyRoom, range: [lo, hi] | null, expected: [midi] }
  constructor(sampleRate, config = {}, emit = () => {}) {
    this.sr = sampleRate;
    this.emit = emit;
    const o = {
      sensitivity: config.sensitivity ?? 1,
      onNoteOn: (midi, t, vel, info) => this.emit({ type: 'noteon', midi, t, vel, confidence: typeof info?.confidence === 'number' ? info.confidence : 1, restrike: !!info?.restrike }),
      onNoteOff: (midi, t) => this.emit({ type: 'noteoff', midi, t }),
      onOnset: (t, strength) => this.emit({ type: 'onset', t, strength }),
    };
    if (config.strictness != null) o.strictness = config.strictness;
    if (config.noisyRoom != null) o.noisyRoom = config.noisyRoom;
    this.tr = new Transcriber(sampleRate, o);
    if (config.range) this.tr.setRange(config.range[0], config.range[1]);
    if (config.expected && config.expected.length) this.tr.setExpected(config.expected);
    this.epoch = 0; // bumped by hard resets (new microphone track)
    this.m = { chunks: 0, epochChunks: 0, winRms: 0, winPeak: 0, zeroFrames: 0, nextFrame: -1, lastChunkAt: 0, gaps: 0, errors: 0 };
    this.win = { t0: perfNow(), chunks: 0, cost: 0, max: 0 };
    this.rates = { chunkRate: 0, costMsPerSec: 0, costMax: 0 };
    this.rec = null;
    this._timer = null;
    this._lastPost = 0;
    this._lastChunks = -1;
  }

  // Send status reports: every `ms` while chunks arrive, every 250 ms otherwise.
  startStatus(ms = 50) {
    this.stopStatus();
    this._timer = setInterval(() => {
      const now = perfNow();
      if (this.m.chunks !== this._lastChunks || now - this._lastPost >= 250) {
        this._lastChunks = this.m.chunks;
        this._lastPost = now;
        this.emit(this.status());
      }
    }, ms);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  stopStatus() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  push(samples, frame) {
    const t0 = perfNow();
    const m = this.m;
    const n = samples.length;
    if (!n) return;
    let s = 0;
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const v = samples[i];
      s += v * v;
      const a = v < 0 ? -v : v;
      if (a > pk) pk = a;
    }
    const rms = Math.sqrt(s / n);
    if (rms > m.winRms) m.winRms = rms;
    if (pk > m.winPeak) m.winPeak = pk;
    m.zeroFrames = pk < ZERO_LEVEL ? m.zeroFrames + n : 0;
    // A jump in the frame index (source reconnected, audio thread hiccup): realign the
    // transcriber instead of analysing stale ring-buffer contents.
    if (m.nextFrame >= 0 && Math.abs(frame - m.nextFrame) > this.sr * 0.1) {
      this._realign();
      m.gaps++;
    }
    m.nextFrame = frame + n;
    m.chunks++;
    m.epochChunks++;
    m.lastChunkAt = t0;
    try {
      this.tr.push(samples, frame);
    } catch (e) {
      m.errors++;
      if (m.errors <= 5) this.emit({ type: 'error', message: String((e && e.message) || e) });
    }
    if (this.rec) this._record(samples, frame);
    const dt = perfNow() - t0;
    const w = this.win;
    w.chunks++;
    w.cost += dt;
    if (dt > w.max) w.max = dt;
  }

  _realign() {
    this.tr.reset();
    this.tr.pos = -1; // Transcriber.push() restarts its alignment on the next chunk
  }

  command(msg) {
    const tr = this.tr;
    switch (msg && msg.type) {
      case 'reset':
        if (msg.hard) {
          this._realign();
          this.m.nextFrame = -1;
          this.m.zeroFrames = 0;
          this.m.epochChunks = 0;
          this.m.winRms = 0;
          this.m.winPeak = 0;
          if (msg.epoch != null) this.epoch = msg.epoch;
        } else tr.reset();
        break;
      case 'setExpected':
        tr.setExpected(msg.midis || [], msg.range);
        break;
      case 'setRange':
        tr.setRange(msg.lo, msg.hi);
        break;
      case 'setStrictness':
        tr.setStrictness(msg.v);
        break;
      case 'setNoisyRoom':
        tr.setNoisyRoom(msg.on);
        break;
      case 'setSensitivity':
        tr.sensitivity = msg.v;
        break;
      case 'calStart':
        tr.startCalibration();
        break;
      case 'calFinish': {
        const ok = tr.finishCalibration();
        this.emit({ type: 'cal', id: msg.id, ok, noiseRms: tr.noiseRms, noiseLevel: finite(tr.noiseLevel) });
        break;
      }
      case 'record':
        if (this.rec) this._finishRecording();
        this.rec = { id: msg.id, buf: new Float32Array(Math.max(1, Math.round(this.sr * (msg.seconds || 15)))), n: 0, startFrame: null };
        break;
      case 'recordStop':
        if (this.rec && (msg.id == null || msg.id === this.rec.id)) this._finishRecording();
        break;
      case 'status':
        this.emit(this.status());
        break;
      default:
    }
  }

  _record(samples, frame) {
    const r = this.rec;
    if (r.startFrame == null) r.startFrame = frame;
    const k = Math.min(samples.length, r.buf.length - r.n);
    r.buf.set(k === samples.length ? samples : samples.subarray(0, k), r.n);
    r.n += k;
    if (r.n >= r.buf.length) this._finishRecording();
  }

  _finishRecording() {
    const r = this.rec;
    this.rec = null;
    const samples = r.n === r.buf.length ? r.buf : r.buf.slice(0, r.n);
    this.emit({ type: 'recording', id: r.id, samples, sampleRate: this.sr, startFrame: r.startFrame }, [samples.buffer]);
  }

  status() {
    const now = perfNow();
    const m = this.m;
    const w = this.win;
    const span = now - w.t0;
    if (span >= 1000) {
      this.rates = { chunkRate: (w.chunks * 1000) / span, costMsPerSec: (w.cost * 1000) / span, costMax: w.max };
      this.win = { t0: now, chunks: 0, cost: 0, max: 0 };
    }
    const tr = this.tr;
    const st = {
      type: 'status',
      epoch: this.epoch,
      rms: m.winRms,
      peak: m.winPeak,
      chunks: m.chunks,
      epochChunks: m.epochChunks,
      lastChunkAgo: m.lastChunkAt ? now - m.lastChunkAt : -1,
      zeroMs: (m.zeroFrames / this.sr) * 1000,
      frame: m.nextFrame,
      gaps: m.gaps,
      errors: m.errors,
      chunkRate: this.rates.chunkRate,
      costMsPerSec: this.rates.costMsPerSec,
      costMax: this.rates.costMax,
      noiseLevel: finite(tr.noiseLevel),
      pianoLevel: finite(tr.pianoLevel),
      tuningCents: tr.tuningCents,
      noiseRms: tr.noiseRms,
      stats: { ...tr.stats },
      recording: this.rec ? this.rec.n / this.sr : null,
    };
    m.winRms = 0;
    m.winPeak = 0;
    return st;
  }
}
