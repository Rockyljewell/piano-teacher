// Listening reliability: the audio health supervisor (stalled / suspended / interrupted context,
// dead / muted / silent microphone tracks), recovery, ready(), holds that can never be
// permanent, the worker listener protocol and the troubleshooting recording.
// Node tests use a mocked AudioContext / MediaStreamTrack / AudioWorkletNode and the real
// Listener + Transcriber. Browser tests (headless Chromium with a fake microphone) run the real
// worklet -> worker pipeline and break it on purpose; skipped without Playwright or NO_BROWSER=1.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AudioEngine } from '../js/audio/audio.js';
import { Listener } from '../js/audio/listener.js';
import { encodeWav } from '../js/audio/wav.js';
import { Voice } from '../js/voice.js';
import { renderPiano, toWav } from './synth-piano.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- mocks -----------------------------------------------------------------------------------

class MockTrack {
  constructor(kind = 'noise', { muted = false } = {}) {
    this.kind = kind; // 'noise' | 'zero'
    this.readyState = 'live';
    this.muted = muted;
    this.enabled = true;
    this.label = 'Mock microphone';
    this.ls = {};
  }
  addEventListener(t, f) {
    (this.ls[t] ||= []).push(f);
  }
  fire(t) {
    for (const f of this.ls[t] || []) f();
  }
  stop() {
    this.readyState = 'ended'; // (like browsers: stop() does not fire 'ended')
  }
  getSettings() {
    return { sampleRate: 48000, channelCount: 1 };
  }
}

class MockCtx {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this._t = 0;
    this.ls = {};
    this.frozen = false; // clock stopped while state stays 'running' (the iOS stall)
    this.resumeWorks = true;
    this.calls = { resume: 0, suspend: 0 };
    this.destination = {};
    this.audioWorklet = { addModule: async () => {} };
    this.sources = [];
  }
  get currentTime() {
    return this._t;
  }
  addEventListener(t, f) {
    (this.ls[t] ||= []).push(f);
  }
  setState(s) {
    if (this.state === s) return;
    this.state = s;
    for (const f of this.ls.statechange || []) f();
  }
  resume() {
    this.calls.resume++;
    if (this.resumeWorks) {
      this.frozen = false;
      this.setState('running');
    }
    return Promise.resolve();
  }
  suspend() {
    this.calls.suspend++;
    this.setState('suspended');
    return Promise.resolve();
  }
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  createMediaStreamSource(stream) {
    const s = {
      stream,
      node: null,
      connect(n) {
        this.node = n;
      },
      disconnect() {
        this.node = null;
      },
    };
    this.sources.push(s);
    return s;
  }
}

class MockWorkletNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.port = { onmessage: null, postMessage() {} };
  }
  connect() {}
  disconnect() {}
}

// Plays the audio thread: advances the clock, sends worklet heartbeats and mic chunks.
function driver(a, ctx) {
  let frame = 0;
  let seed = 3;
  const noise = () => {
    const x = new Float32Array(480);
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647;
      x[i] = (seed / 2147483647 - 0.5) * 0.004;
    }
    return x;
  };
  const tick = setInterval(() => {
    if (ctx.state !== 'running' || ctx.frozen) return;
    ctx._t += 0.01;
    frame += 480;
    a._onWorklet({ type: 'hb', frame, chans: 1, sent: frame / 480 });
    for (const s of ctx.sources) {
      const t = s.stream.getAudioTracks()[0];
      if (s.node && t.readyState === 'live' && !t.muted) a._onWorklet({ frame: frame - 480, samples: t.kind === 'zero' ? new Float32Array(480) : noise() });
    }
  }, 10);
  return () => clearInterval(tick);
}

const FAST = { tickMs: 30, stallMs: 150, noDataMs: 250, zeroMs: 300, firstChunkMs: 400, muteGraceMs: 200, muteRestartMs: 200, minRestartMs: 200, maxRestartMs: 1000, liveResetMs: 400, workerStaleMs: 500, hbStaleMs: 300, resumeTimeoutMs: 200 };

function rig({ kinds = [], mutedFirst = 0, deny = false, session = true } = {}) {
  const ctx = new MockCtx();
  const doc = {
    visibilityState: 'visible',
    ls: {},
    addEventListener(t, f) {
      (this.ls[t] ||= []).push(f);
    },
    removeEventListener() {},
    fire(t) {
      for (const f of this.ls[t] || []) f();
    },
  };
  const audioSession = session ? { type: 'auto', state: 'inactive' } : undefined;
  const gumLog = [];
  const getUserMedia = () => {
    gumLog.push({ sessionType: audioSession ? audioSession.type : null });
    if (deny) return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const track = new MockTrack(kinds.shift() || 'noise', { muted: gumLog.length === 1 && mutedFirst > 0 });
    if (track.muted)
      setTimeout(() => {
        track.muted = false;
        track.fire('unmute');
      }, mutedFirst);
    return Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
  };
  const a = new AudioEngine({
    worker: false,
    health: FAST,
    env: { AudioWorkletNode: MockWorkletNode, getUserMedia, document: doc, window: null, navigator: { userAgent: 'node-test', audioSession } },
  });
  a.ctx = ctx;
  const health = [];
  a.on('health', (h) => health.push(h));
  const stop = driver(a, ctx);
  const done = () => {
    stop();
    a.dispose();
  };
  return { a, ctx, doc, gumLog, health, audioSession, done };
}

async function until(fn, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

// ---- supervisor (node, mocked audio) ----------------------------------------------------------

describe('audio health supervisor', () => {
  test('startMic: play-and-record session first, then live; ready() resolves quickly', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      assert.equal(r.gumLog.length, 1);
      assert.equal(r.gumLog[0].sessionType, 'play-and-record', 'audioSession.type set before getUserMedia');
      assert.equal(r.a.mode, 'main', 'worker: false -> main-thread listener');
      await until(() => r.a.health.mic === 'live', 1000, 'live');
      assert.equal(r.a.micOn, true);
      const t0 = Date.now();
      const rd = await r.a.ready({ timeoutMs: 1000 });
      assert.equal(rd.ok, true, JSON.stringify(rd));
      assert.ok(Date.now() - t0 < 200, `ready took ${Date.now() - t0} ms`);
      assert.ok(r.health.at(-1).ok);
    } finally {
      r.done();
    }
  });

  test('a fresh track muted for a moment is not treated as a failure', async () => {
    const r = rig({ mutedFirst: 120 });
    try {
      await r.a.startMic();
      await until(() => r.a.health.mic === 'live', 1500, 'live');
      await sleep(300);
      assert.equal(r.gumLog.length, 1, 'no re-acquire during the mute grace period');
      assert.equal(r.a.restarts, 0);
    } finally {
      r.done();
    }
  });

  test('all-zero samples from a live track (iOS dead track) -> re-acquire -> live', async () => {
    const r = rig({ kinds: ['noise', 'noise'] });
    try {
      await r.a.startMic();
      await until(() => r.a.health.mic === 'live', 1000, 'live');
      r.a.track.kind = 'zero';
      await until(() => r.health.some((h) => h.mic === 'silent'), 1500, 'silent detected');
      await until(() => r.gumLog.length === 2, 1500, 're-acquire');
      await until(() => r.a.health.mic === 'live' && r.a.health.ok, 1500, 'live again');
      assert.equal(r.a.restarts, 1);
      const ev = r.a.events().find((e) => e.type === 'mic-restart');
      assert.equal(ev.reason, 'mic-silent');
      const mics = r.health.map((h) => h.mic);
      assert.ok(mics.indexOf('silent') < mics.lastIndexOf('live'), mics.join(' > '));
      assert.ok(mics.includes('restarting'));
    } finally {
      r.done();
    }
  });

  test('ended track -> re-acquire; micOn reflects reality meanwhile', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.mic === 'live', 1000, 'live');
      const old = r.a.track;
      old.stop();
      assert.equal(r.a.micOn, false, 'micOn is false as soon as the track is dead');
      await until(() => r.a.track && r.a.track !== old && r.a.health.mic === 'live', 2000, 'new track live');
      assert.equal(r.a.micOn, true);
      assert.equal(r.a.events().find((e) => e.type === 'mic-restart').reason, 'mic-ended');
    } finally {
      r.done();
    }
  });

  test('muted for good (another app took the mic) -> re-acquire after the grace period', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.mic === 'live', 1000, 'live');
      r.a.track.muted = true;
      r.a.track.fire('mute');
      await until(() => r.health.some((h) => h.mic === 'muted'), 1000, 'muted');
      await until(() => r.gumLog.length === 2 && r.a.health.mic === 'live', 2000, 're-acquired');
      assert.equal(r.a.events().find((e) => e.type === 'mic-restart').reason, 'mic-muted');
    } finally {
      r.done();
    }
  });

  test('no chunks while the context runs -> no-data -> re-acquire', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.mic === 'live', 1000, 'live');
      r.a.src.node = null; // the source stops feeding the worklet (heartbeat continues)
      await until(() => r.health.some((h) => h.mic === 'no-data'), 1500, 'no-data');
      await until(() => r.gumLog.length === 2 && r.a.health.mic === 'live', 2000, 're-acquired');
      const ev = r.a.events().find((e) => e.type === 'mic-restart');
      assert.equal(ev.reason, 'mic-no-data');
      assert.equal(ev.rebuild, false, 'worklet heartbeat fresh: no node rebuild');
    } finally {
      r.done();
    }
  });

  test('re-acquire is rate limited with backoff and asks for a tap after repeated failures', async () => {
    const r = rig({ kinds: ['noise', 'zero', 'zero', 'zero', 'zero', 'zero'] });
    try {
      await r.a.startMic();
      await until(() => r.a.health.mic === 'live', 1000, 'live');
      r.a.track.kind = 'zero';
      await sleep(1600);
      const n = r.gumLog.length - 1;
      assert.ok(n >= 2 && n <= 4, `${n} re-acquire attempts in 1.6 s (backoff 200, 400, 800 ms)`);
      await until(() => r.a.health.needsGesture, 1500, 'needsGesture');
      assert.equal(r.a.health.ok, false);
      // from a tap: recover() re-acquires right away (no backoff)
      const before = r.gumLog.length;
      r.a.recover({ restartMic: true });
      assert.equal(r.gumLog.length, before + 1, 'getUserMedia called synchronously inside the tap');
    } finally {
      r.done();
    }
  });

  test('suspended context -> resumed automatically', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.ok, 1000, 'ok');
      r.ctx.suspend();
      await until(() => r.health.some((h) => h.context === 'suspended' && !h.ok), 500, 'suspended reported');
      await until(() => r.a.health.ok && r.ctx.state === 'running', 1500, 'resumed');
      assert.ok(r.ctx.calls.resume >= 1);
      assert.equal(r.gumLog.length, 1, 'the mic was fine: not re-acquired');
    } finally {
      r.done();
    }
  });

  test('interrupted context that will not resume -> needsGesture; recover() resumes inside the tap', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.ok, 1000, 'ok');
      r.ctx.resumeWorks = false;
      r.ctx.setState('interrupted');
      await until(() => r.a.health.needsGesture, 3000, 'needsGesture');
      assert.equal(r.a.health.context, 'interrupted');
      assert.equal(r.a.health.reason, 'context-interrupted');
      const rd = await r.a.ready({ timeoutMs: 150 });
      assert.deepEqual([rd.ok, rd.reason], [false, 'context-interrupted']);
      r.ctx.resumeWorks = true;
      const n = r.ctx.calls.resume;
      const p = r.a.recover();
      assert.equal(r.ctx.calls.resume, n + 1, 'resume() called synchronously inside the tap');
      const h = await p;
      assert.equal(h.ok, true, JSON.stringify(h));
      assert.equal(h.needsGesture, false);
    } finally {
      r.done();
    }
  });

  test('stalled clock (state "running", currentTime frozen) -> detected -> suspend/resume', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.ok, 1000, 'ok');
      r.ctx.frozen = true;
      await until(() => r.health.some((h) => h.context === 'stalled' && h.reason === 'clock-stalled'), 1000, 'stall detected');
      await until(() => r.a.health.ok, 2000, 'recovered');
      assert.ok(r.ctx.calls.suspend >= 1, 'suspend/resume cycle used to unstick the clock');
    } finally {
      r.done();
    }
  });

  test('hidden page: no stall alarms, resume when visible again', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.ok, 1000, 'ok');
      r.doc.visibilityState = 'hidden';
      r.doc.fire('visibilitychange');
      r.ctx.resumeWorks = false;
      r.ctx.suspend();
      await sleep(300);
      assert.equal(r.a.health.reason, 'page-hidden');
      assert.equal(r.a.health.needsGesture, false);
      r.ctx.resumeWorks = true;
      r.doc.visibilityState = 'visible';
      r.doc.fire('visibilitychange');
      await until(() => r.a.health.ok, 1500, 'ok after visible');
      assert.ok(r.a.events().some((e) => e.type === 'visibility' && e.visible === true));
    } finally {
      r.done();
    }
  });

  test('startMic() on a dead mic re-acquires it (openSetup / withListening path)', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.ok, 1000, 'ok');
      r.a.track.stop();
      await r.a.startMic();
      assert.equal(r.gumLog.length, 2);
      await until(() => r.a.health.mic === 'live', 1000, 'live');
    } finally {
      r.done();
    }
  });

  test('denied permission: startMic rejects, nothing retries', async () => {
    const r = rig({ deny: true });
    try {
      await assert.rejects(r.a.startMic(), (e) => e.name === 'NotAllowedError');
      await sleep(200);
      assert.equal(r.gumLog.length, 1);
      assert.equal(r.a.micOn, false);
      assert.equal(r.a.micWanted, false);
    } finally {
      r.done();
    }
  });

  test('calibrate() reports failure when only digital silence arrives', async () => {
    const r = rig({ kinds: ['zero'] });
    try {
      await r.a.startMic();
      assert.equal(await r.a.calibrate(150), false, 'no "Room: quiet" for a dead mic');
      r.a.track.kind = 'noise';
      assert.equal(await r.a.calibrate(250), true);
      assert.ok(r.a.noiseRms > 1e-6);
    } finally {
      r.done();
    }
  });

  test('diagnostics(), events() and troubleshootingLog() are JSON-safe and complete', async () => {
    const r = rig();
    try {
      await r.a.startMic();
      await until(() => r.a.health.ok && r.a.st.chunks > 10, 1000, 'chunks');
      const release = r.a.hold('voice');
      const d = r.a.diagnostics();
      release();
      assert.equal(d.context.state, 'running');
      assert.equal(d.mic.state, 'live');
      assert.equal(d.mic.track.label, 'Mock microphone');
      assert.equal(d.listener.mode, 'main');
      assert.ok(d.listener.chunks > 10);
      assert.deepEqual(d.holds.holds.map((h) => h.reason), ['voice']);
      assert.deepEqual(d.audioSession, { type: 'play-and-record', state: 'inactive' });
      const log = JSON.parse(JSON.stringify(r.a.troubleshootingLog({ extra: 1 })));
      assert.equal(log.userAgent, 'node-test');
      assert.equal(log.extra, 1);
      for (const type of ['engine', 'audio-session', 'mic', 'listener', 'health', 'hold', 'release']) assert.ok(log.events.some((e) => e.type === type), type);
    } finally {
      r.done();
    }
  });
});

// ---- holds must never be permanent -----------------------------------------------------------

describe('holds', () => {
  test('the tail ends on the wall clock even when the audio clock is frozen ("Listening paused" forever)', async () => {
    const a = new AudioEngine({ tailMs: 60, worker: false, env: { document: null, window: null, navigator: null } });
    const ctx = new MockCtx();
    a.ctx = ctx; // the clock never advances: ctx._t stays 0
    const states = [];
    a.on('hold', (e) => states.push(e.held));
    const release = a.hold('voice');
    release();
    assert.equal(a.held, true);
    await sleep(160);
    assert.equal(a.held, false, 'tail expired although currentTime never moved');
    assert.equal(states.at(-1), false);
    assert.equal(a.micGated(ctx.currentTime + 1), false);
    a.dispose();
  });

  test('every hold has a maximum lifetime', async () => {
    const a = new AudioEngine({ tailMs: 20, worker: false, env: { document: null, window: null, navigator: null } });
    a.hold('demo', { maxMs: 80 }); // never released
    assert.equal(a.held, true);
    await sleep(160);
    assert.equal(a.held, false);
    const ev = a.events().find((e) => e.type === 'hold-expired');
    assert.equal(ev.reason, 'demo');
    // renew() can extend it while there is a reason to
    let more = 2;
    a.hold('app', { maxMs: 60, renew: () => (more-- > 0 ? 60 : 0) });
    await sleep(140);
    assert.equal(a.held, true, 'renewed');
    await sleep(160);
    assert.equal(a.held, false, 'then expired');
    a.dispose();
  });

  test('voice hold is bounded by voice.maxRemainingMs() even if "speaking" gets stuck', async () => {
    const a = new AudioEngine({ tailMs: 20, worker: false, env: { document: null, window: null, navigator: null } });
    let cb = null;
    let remaining = 150;
    const stuckVoice = { speaking: true, onChange: (f) => ((cb = f), () => (cb = null)), maxRemainingMs: () => remaining };
    a.attachVoice(stuckVoice);
    cb(true); // speaking starts... and speechSynthesis never reports the end
    assert.deepEqual(a.holdReasons, ['voice']);
    remaining = 0;
    await sleep(1650 + 150 + 500); // bound + 1.5 s margin, then the renewal finds nothing left
    assert.equal(a.held, false);
    assert.ok(a.events().some((e) => e.type === 'hold-expired' && e.reason === 'voice'));
    a.dispose();
  });
});

// ---- voice helpers -----------------------------------------------------------------------------

class MockUtt {
  constructor(text) {
    this.text = text;
  }
}

class SlowSynth {
  constructor() {
    this.speaking = false;
    this.pending = false;
    this.cur = null;
    this.cancels = 0;
  }
  getVoices() {
    return [{ name: 'Ava', lang: 'en-US', voiceURI: 'ava', localService: true }];
  }
  addEventListener() {}
  speak(u) {
    this.cur = u;
    setTimeout(() => {
      if (this.cur !== u) return;
      this.speaking = true;
      if (u.onstart) u.onstart();
    }, 3);
  }
  cancel() {
    this.cancels++;
    const u = this.cur;
    this.cur = null;
    setTimeout(() => {
      this.speaking = false; // the engine goes idle a little after cancel()
      if (u && u.onerror) u.onerror({ error: 'interrupted' });
    }, 60);
  }
  resume() {}
}

test('voice.maxRemainingMs() bounds speech; settle() cancels and waits until the engine is idle', async () => {
  const synth = new SlowSynth();
  const v = new Voice({ synth, Utterance: MockUtt, storage: null });
  await v.ready;
  assert.equal(v.maxRemainingMs(), 0);
  const p = v.speak('Hello there. This is a slightly longer sentence to speak.');
  const bound = v.maxRemainingMs();
  assert.ok(bound > 3000 && bound < 20000, `bound ${bound}`);
  await sleep(20);
  assert.equal(synth.speaking, true);
  const t0 = Date.now();
  const s = await v.settle({ gapMs: 30 });
  assert.equal(s.ok, true);
  assert.ok(Date.now() - t0 >= 60, 'waited for the engine to go idle');
  assert.equal(synth.speaking, false);
  assert.equal((await p).reason, 'cancelled');
  assert.equal(v.speaking, false);
  assert.equal(v.maxRemainingMs(), 0);
  assert.deepEqual(await v.settle(), { ok: true, waitedMs: 0 }, 'idle: returns at once');
});

// ---- listener protocol + WAV ---------------------------------------------------------------------

test('Listener: status (levels, zero run, gaps), hard reset epochs, calibration and recording', () => {
  const out = [];
  const L = new Listener(48000, { sensitivity: 1, range: [60, 72], expected: [60] }, (m) => out.push(m));
  const noise = new Float32Array(512).map((_, i) => Math.sin(i) * 0.01);
  let f = 0;
  for (let i = 0; i < 20; i++, f += 512) L.push(noise, f);
  let st = L.status();
  assert.equal(st.chunks, 20);
  assert.ok(st.rms > 0.005 && st.peak > 0.009);
  assert.equal(st.zeroMs, 0);
  for (let i = 0; i < 10; i++, f += 512) L.push(new Float32Array(512), f);
  st = L.status();
  assert.ok(Math.abs(st.zeroMs - (10 * 512 * 1000) / 48000) < 1, `zeroMs ${st.zeroMs}`);
  L.push(noise, f + 48000); // a 1 s jump in the frame index
  assert.equal(L.status().gaps, 1);
  L.command({ type: 'reset', hard: true, epoch: 5 });
  st = L.status();
  assert.deepEqual([st.epoch, st.epochChunks, st.zeroMs], [5, 0, 0]);
  L.command({ type: 'calStart' });
  for (let i = 0; i < 40; i++, f += 512) L.push(noise, f + 48000);
  L.command({ type: 'calFinish', id: 7 });
  const cal = out.find((m) => m.type === 'cal');
  assert.equal(cal.id, 7);
  assert.equal(cal.ok, true);
  assert.ok(cal.noiseRms > 0);
  L.command({ type: 'record', id: 3, seconds: 0.05 });
  for (let i = 0; i < 6; i++, f += 512) L.push(noise, f + 48000);
  const rec = out.find((m) => m.type === 'recording');
  assert.equal(rec.id, 3);
  assert.equal(rec.samples.length, 2400);
  assert.equal(rec.sampleRate, 48000);
});

test('encodeWav writes a valid 16-bit mono WAV', () => {
  const x = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const buf = encodeWav(x, 44100);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 12);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((i) => v.getInt16(42 + i * 2, true)), [0, 16384, -16384, 32767, -32768, 32767]);
});

// ---- browser: the real pipeline, broken on purpose -----------------------------------------------

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(id);
    } catch {
      /* try next */
    }
  }
  return null;
}

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__health_test.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><meta charset="utf-8"><title>health test</title><body></body>');
    }
    const file = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const pw = loadPlaywright();
let skipBrowser = process.env.NO_BROWSER ? 'NO_BROWSER set' : pw ? false : 'Playwright not installed';
let browser = null;
const wavPath = path.join(os.tmpdir(), `maestro-health-${process.pid}.wav`);
if (!skipBrowser) {
  // fake mic: quiet room noise, then middle C and E4 alternating every 0.7 s (the file loops)
  const sr = 48000;
  const notes = [];
  for (let i = 0; i < 24; i++) notes.push({ midi: i % 2 ? 64 : 60, t: 1.5 + i * 0.7, dur: 0.45, vel: 0.6 });
  fs.writeFileSync(wavPath, toWav(renderPiano(notes, { sr, length: 19 }), sr));
  try {
    browser = await pw.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'] });
  } catch (e) {
    skipBrowser = `Chromium not available (${String(e.message).split('\n')[0]})`;
  }
}

describe('browser: worker listener and recovery (fake microphone)', { skip: skipBrowser }, () => {
  let server;
  let page;
  const errors = [];
  before(async () => {
    server = await serve();
    page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('console', (m) => m.text().startsWith('[health]') && console.log('   ', m.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/__health_test.html`);
    await page.evaluate(async () => {
      const { AudioEngine } = await import('/js/audio/audio.js');
      const audio = new AudioEngine({ autoLoadPiano: false });
      window.audio = audio;
      window.notes = [];
      window.hlog = [];
      const t0 = performance.now();
      audio.on('noteon', (e) => window.notes.push(e.midi));
      audio.on('health', (h) => {
        window.hlog.push(h);
        console.log(`[health] +${Math.round(performance.now() - t0)} ms ok=${h.ok} context=${h.context} mic=${h.mic} reason=${h.reason}`);
      });
      await audio.startMic();
      await audio.calibrate(1000);
    });
  });
  after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
    try {
      fs.unlinkSync(wavPath);
    } catch {
      /* ignore */
    }
  });

  const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });

  test('worker mode: notes from the worklet -> worker path, transcription off the main thread', async () => {
    await waitFor(() => window.notes.includes(60) && window.notes.includes(64), null, 12000);
    const r = await page.evaluate(() => ({ mode: audio.mode, health: audio.health, d: audio.diagnostics(), hasPush: typeof audio.tr.push }));
    assert.equal(r.mode, 'worker');
    assert.equal(r.hasPush, 'undefined', 'no transcriber on the main thread');
    assert.equal(r.health.ok, true);
    assert.ok(r.d.listener.chunkRate > 50, `chunks/s ${r.d.listener.chunkRate}`);
    assert.ok(r.d.listener.costMsPerSec > 0, 'the worker reports its processing cost');
    const rd = await page.evaluate(() => audio.ready({ timeoutMs: 1000 }));
    assert.equal(rd.ok, true);
    assert.ok(rd.ms < 300, `ready() ${rd.ms} ms`);
  });

  test('suspended context (ctx.suspend()) -> resumed automatically', async () => {
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      window.hlog = [];
      await audio.ctx.suspend();
      const bad = await audio.ready({ timeoutMs: 50 });
      while (!(audio.health.ok && audio.ctx.state === 'running') && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 25));
      const ms = Math.round(performance.now() - t0);
      const n = window.notes.length;
      const ok = await audio.ready({ timeoutMs: 2000 });
      return { ms, state: audio.ctx.state, log: window.hlog.map((h) => `${h.context}/${h.mic}`), ok, n };
    });
    assert.equal(r.state, 'running');
    assert.ok(r.log.some((x) => x.startsWith('suspended')), r.log.join(' > '));
    assert.ok(r.ms < 3000, `recovered in ${r.ms} ms`);
    assert.equal(r.ok.ok, true);
    const n = r.n;
    await waitFor((n) => window.notes.length > n, n, 8000);
  });

  test('frozen clock while "running" -> stall detected -> suspend/resume recovers it', async () => {
    const r = await page.evaluate(async () => {
      const ctx = audio.ctx;
      const frozen = ctx.currentTime;
      Object.defineProperty(ctx, 'currentTime', { configurable: true, get: () => frozen });
      const realSuspend = ctx.suspend.bind(ctx);
      ctx.suspend = () => {
        delete ctx.currentTime; // what an iOS suspend/resume cycle does to a stuck clock
        delete ctx.suspend;
        return realSuspend();
      };
      window.hlog = [];
      const t0 = performance.now();
      while (!window.hlog.some((h) => h.reason === 'clock-stalled') && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
      const detected = Math.round(performance.now() - t0);
      while (!audio.health.ok && performance.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 25));
      return { detected, ms: Math.round(performance.now() - t0), health: audio.health, events: audio.events().filter((e) => e.type === 'resume').map((e) => e.kind) };
    });
    assert.ok(r.detected < 1200, `stall detected after ${r.detected} ms`);
    assert.equal(r.health.ok, true, JSON.stringify(r.health));
    assert.ok(r.events.includes('stalled'));
    await page.evaluate(() => (window.hlog = []));
  });

  test('track.stop() (ended track) -> re-acquired -> notes are heard again', async () => {
    const r = await page.evaluate(async () => {
      const old = audio.track;
      const t0 = performance.now();
      old.stop();
      const micOnAfterStop = audio.micOn;
      while (!(audio.track && audio.track !== old && audio.health.mic === 'live') && performance.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 25));
      return { micOnAfterStop, ms: Math.round(performance.now() - t0), restarts: audio.restarts, health: audio.health, n: window.notes.length, why: audio.events().filter((e) => e.type === 'mic-restart').map((e) => e.reason) };
    });
    assert.equal(r.micOnAfterStop, false);
    assert.equal(r.health.mic, 'live', JSON.stringify(r.health));
    assert.ok(r.ms < 4000, `recovered in ${r.ms} ms`);
    assert.ok(r.why.includes('mic-ended'), r.why.join(','));
    await waitFor((n) => window.notes.length > n, r.n, 8000);
  });

  test('all-zero input from a "live" track -> silent -> re-acquired', async () => {
    const r = await page.evaluate(async () => {
      const ctx = audio.ctx;
      audio.src.disconnect(); // the track stays "live" but only zeros reach the worklet
      const z = ctx.createConstantSource();
      z.offset.value = 0;
      z.connect(audio.node);
      z.start();
      window.hlog = [];
      const t0 = performance.now();
      const n0 = audio.restarts;
      while (!(audio.restarts > n0 && audio.health.mic === 'live') && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 25));
      z.stop();
      return { ms: Math.round(performance.now() - t0), log: window.hlog.map((h) => h.mic), health: audio.health, why: audio.events().filter((e) => e.type === 'mic-restart').map((e) => e.reason), n: window.notes.length };
    });
    assert.ok(r.log.includes('silent'), r.log.join(' > '));
    assert.equal(r.health.mic, 'live');
    assert.ok(r.why.includes('mic-silent'), r.why.join(','));
    await waitFor((n) => window.notes.length > n, r.n, 8000);
  });

  test('troubleshooting recording: raw mic samples come back from the worker', async () => {
    const r = await page.evaluate(async () => {
      const rec = await audio.recordMic(0.5);
      let pk = 0;
      for (const x of rec.samples) pk = Math.max(pk, Math.abs(x));
      return { n: rec.samples.length, sr: rec.sampleRate, pk, log: audio.troubleshootingLog().events.length };
    });
    assert.equal(r.n, Math.round(r.sr * 0.5));
    assert.ok(r.pk > 0.001, 'real signal');
    assert.ok(r.log > 10);
  });

  test('main-thread fallback (worker: false) still detects notes', async () => {
    const r = await page.evaluate(async () => {
      audio.stopMic();
      const { AudioEngine } = await import('/js/audio/audio.js');
      const b = new AudioEngine({ autoLoadPiano: false, worker: false });
      const got = [];
      b.on('noteon', (e) => got.push(e.midi));
      await b.startMic();
      await b.calibrate(800);
      const t0 = performance.now();
      while (!got.length && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
      const out = { mode: b.mode, got, health: b.health };
      b.dispose();
      return out;
    });
    assert.equal(r.mode, 'main');
    assert.ok(r.got.some((m) => m === 60 || m === 64), JSON.stringify(r.got));
    assert.deepEqual(errors, []);
  });
});
