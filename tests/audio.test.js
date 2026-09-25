// Sound and voice: sampled piano, UI sound effects (mic-safe band), coach voice, mic gating.
// The node-only tests always run. The browser tests (headless Chromium via Playwright) are
// skipped when Playwright or its Chromium is not installed (e.g. in CI) or NO_BROWSER=1.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AudioEngine, PIANO_SAMPLES, demoNotes } from '../js/audio/audio.js';
import { SFX_NAMES, MIC_SAFE_SFX, SFX_INFO, SFX_ALIASES, resolveSfx } from '../js/audio/sfx.js';
import { Voice, rateVoice, splitText } from '../js/voice.js';
import { FFT } from '../js/audio/fft.js';
import { Transcriber } from '../js/audio/transcriber.js';
import { generate } from '../js/music/generator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- piano sample set ----------------------------------------------------------------------

test('piano samples: A0..C8 every minor third, files present, < 3 MB', () => {
  assert.equal(PIANO_SAMPLES.length, 30);
  assert.equal(PIANO_SAMPLES[0].name, 'A0');
  assert.equal(PIANO_SAMPLES[0].midi, 21);
  assert.equal(PIANO_SAMPLES.at(-1).name, 'C8');
  assert.equal(PIANO_SAMPLES.at(-1).midi, 108);
  let total = 0;
  for (const s of PIANO_SAMPLES) {
    const f = path.join(ROOT, 'assets/piano', s.name + '.mp3');
    assert.ok(fs.existsSync(f), `missing ${f}`);
    total += fs.statSync(f).size;
  }
  assert.ok(total < 3e6, `samples total ${total} bytes`);
  assert.ok(fs.readFileSync(path.join(ROOT, 'assets/piano/README.md'), 'utf8').includes('CC BY 3.0'));
});

// ---- demo flattening -----------------------------------------------------------------------

test('demoNotes: ties are held, rests skipped, melody over bass, downbeat accents', () => {
  const piece = {
    bpm: 60,
    beatsPer: 4,
    events: [
      { id: 1, staff: 'treble', hand: 'R', beat: 0, dur: 1, midis: [64] },
      { id: 2, staff: 'treble', hand: 'R', beat: 1, dur: 1, midis: [], rest: true },
      { id: 3, staff: 'treble', hand: 'R', beat: 2, dur: 2, midis: [67], tieNext: 4 },
      { id: 4, staff: 'treble', hand: 'R', beat: 4, dur: 1, midis: [67], tiedFrom: 3 },
      { id: 5, staff: 'bass', hand: 'L', beat: 0, dur: 4, midis: [48, 55] },
    ],
  };
  const ns = demoNotes(piece, { startAt: 10 });
  assert.equal(ns.length, 4);
  const by = Object.fromEntries(ns.map((n) => [n.midi, n]));
  assert.equal(by[64].time, 10);
  assert.ok(Math.abs(by[67].time - 12) < 1e-9);
  assert.ok(Math.abs(by[67].dur - 3 * 0.95) < 1e-9, 'tie extends 2 + 1 beats');
  assert.ok(Math.abs(by[48].dur - 4 * 0.95) < 1e-9);
  assert.ok(by[64].vel > by[67].vel, 'downbeat accent');
  assert.ok(by[64].vel > by[48].vel, 'melody over bass');
  const shifted = demoNotes(piece, { timeOfBeat: (b) => 5 + b * 0.5 });
  assert.equal(shifted.find((n) => n.midi === 64).time, 5);
});

test('demoNotes matches the gradable notes of generated pieces', () => {
  for (const lvl of [1, 6, 12, 20, 30]) {
    const piece = generate(lvl, { seed: 11 });
    const ns = demoNotes(piece, { startAt: 0 });
    assert.equal(ns.length, piece.notes.length, `level ${lvl}`);
    for (const n of ns) assert.ok(n.dur > 0 && n.vel > 0 && n.vel <= 1 && Number.isFinite(n.time));
  }
});

// ---- mic gating (no AudioContext needed) ---------------------------------------------------

describe('AudioEngine mic gating', () => {
  test('noteon carries confidence (Transcriber info or 1); holds drop mic events', async () => {
    const a = new AudioEngine({ tailMs: 40 });
    const on = [];
    const onsets = [];
    const offs = [];
    a.on('noteon', (e) => on.push(e));
    a.on('onset', (e) => onsets.push(e));
    a.on('noteoff', (e) => offs.push(e));
    let resets = 0;
    a.tr = { reset: () => resets++ };
    const o = a._transcriberOptions();

    o.onNoteOn(60, a.now(), 0.5, { confidence: 0.83, restrike: true });
    o.onNoteOn(62, a.now(), 0.5); // older Transcriber: no info argument
    assert.deepEqual(
      on.map((e) => [e.midi, e.source, e.confidence, e.restrike]),
      [
        [60, 'mic', 0.83, true],
        [62, 'mic', 1, false],
      ],
    );

    const release = a.hold('voice');
    const tHeld = a.now();
    assert.equal(a.held, true);
    assert.deepEqual(a.holdReasons, ['voice']);
    o.onNoteOn(64, a.now(), 0.5, { confidence: 0.9 });
    o.onOnset(a.now(), 3);
    o.onNoteOff(64, a.now()); // its noteon was dropped: no noteoff either
    assert.equal(on.length, 2);
    assert.equal(onsets.length, 0);
    assert.equal(offs.length, 0);

    release();
    release(); // idempotent
    assert.ok(resets >= 1, 'transcriber reset on release');
    assert.equal(a.held, true, 'tail still gated');
    o.onNoteOn(65, a.now(), 0.5);
    assert.equal(on.length, 2);

    await sleep(90);
    assert.equal(a.held, false);
    assert.ok(resets >= 2, 'transcriber reset again after the tail');
    o.onNoteOn(67, a.now(), 0.5);
    assert.equal(on.length, 3);
    o.onNoteOn(69, tHeld, 0.5); // late detection back-dated into the held interval
    assert.equal(on.length, 3);
    o.onOnset(a.now(), 2);
    assert.equal(onsets.length, 1);
  });

  test('reference counting, holdFor, legacy muted, hold events', async () => {
    const a = new AudioEngine({ tailMs: 30 });
    const states = [];
    a.on('hold', (e) => states.push(e.held));
    const r1 = a.hold('a');
    const r2 = a.hold('b');
    r1();
    assert.equal(a.held, true);
    assert.deepEqual(a.holdReasons, ['b']);
    r2();
    await sleep(70);
    assert.equal(a.held, false);
    assert.equal(states.at(-1), false);

    a.muted = true;
    assert.equal(a.muted, true);
    assert.equal(a.held, true);
    assert.deepEqual(a.holdReasons, ['muted']);
    a.muted = false;
    assert.equal(a.muted, false);
    await sleep(60);
    assert.equal(a.held, false);

    a.holdFor(30, 'sfx');
    assert.equal(a.held, true);
    await sleep(100);
    assert.equal(a.held, false);
    const early = a.holdFor(5000, 'demo');
    early();
    await sleep(60);
    assert.equal(a.held, false);
  });

  test('attachVoice holds the mic while speaking', async () => {
    const a = new AudioEngine({ tailMs: 20 });
    let cb = null;
    const fakeVoice = { onChange: (f) => ((cb = f), () => (cb = null)) };
    const detach = a.attachVoice(fakeVoice);
    cb(true);
    assert.deepEqual(a.holdReasons, ['voice']);
    cb(false);
    assert.equal(a.held, true); // voice tail (>= 400 ms)
    await sleep(470);
    assert.equal(a.held, false);
    detach();
    assert.equal(cb, null);
  });

  test('MIDI notes pass with confidence 1 and suppress the mic for a moment', () => {
    const a = new AudioEngine();
    const on = [];
    a.on('noteon', (e) => on.push(e));
    const o = a._transcriberOptions();
    a.noteOn(60, a.now(), 0.5, 'midi');
    assert.deepEqual([on[0].source, on[0].confidence], ['midi', 1]);
    o.onNoteOn(60, a.now(), 0.5, { confidence: 1 }); // the digital piano's speaker, heard by the mic
    assert.equal(on.length, 1);
    a.midiSuppressesMic = false;
    o.onNoteOn(62, a.now(), 0.5, { confidence: 1 });
    assert.equal(on.length, 2);
  });

  test('strictness / noisy-room options are forwarded', () => {
    const a = new AudioEngine();
    a.setStrictness(0.7);
    a.setNoisyRoom(true);
    const o = a._transcriberOptions();
    assert.equal(o.strictness, 0.7);
    assert.equal(o.noisyRoom, true);
    const calls = [];
    a.tr = { setStrictness: (v) => calls.push(['s', v]), setNoisyRoom: (v) => calls.push(['n', v]) };
    a.setStrictness(2);
    a.setNoisyRoom(false);
    assert.deepEqual(calls, [
      ['s', 1],
      ['n', false],
    ]);
  });
});

// ---- sound-effect catalogue ----------------------------------------------------------------

test('sfx catalogue has UI, celebration and mic-safe sounds', () => {
  for (const n of ['tap', 'toggle', 'whoosh', 'success', 'bloop', 'error', 'star1', 'star2', 'star3', 'streak', 'levelup', 'complete', 'countdown', 'countdown-go', 'harder', 'easier']) {
    assert.ok(SFX_NAMES.includes(n), n);
    assert.equal(SFX_INFO[n].safe, false, n);
  }
  assert.deepEqual(MIC_SAFE_SFX, ['hit', 'perfect', 'combo', 'miss', 'wrong', 'count', 'count-go']);
  for (const [alias, name] of Object.entries(SFX_ALIASES)) assert.ok(SFX_INFO[name], `${alias} -> ${name}`);
  assert.equal(resolveSfx('countin'), 'count', 'count-in runs while the mic listens');
  assert.equal(resolveSfx('hitPerfect'), 'perfect');
  assert.equal(resolveSfx('tryAgain'), 'retry');
  assert.equal(resolveSfx('nope'), null);
});

// ---- voice (mock speechSynthesis) ----------------------------------------------------------

class MockUtt {
  constructor(text) {
    this.text = text;
  }
}

class MockSynth {
  constructor({ voices = [], behavior = 'normal', voicesAfter = 0 } = {}) {
    this.list = voices;
    this.behavior = behavior;
    this.spoken = [];
    this.speaking = false;
    this.pending = false;
    this.paused = false;
    this.ls = {};
    this.ready = voicesAfter === 0;
    if (voicesAfter)
      setTimeout(() => {
        this.ready = true;
        for (const f of this.ls.voiceschanged || []) f();
      }, voicesAfter);
  }
  getVoices() {
    return this.ready ? this.list : [];
  }
  addEventListener(t, f) {
    (this.ls[t] ||= []).push(f);
  }
  speak(u) {
    this.spoken.push(u.text);
    this.cur = u;
    if (this.behavior === 'silent') return;
    setTimeout(() => {
      if (this.cur !== u) return;
      this.speaking = true;
      if (u.onstart) u.onstart();
      if (this.behavior === 'no-end') return;
      setTimeout(() => {
        if (this.cur !== u) return;
        this.speaking = false;
        this.cur = null;
        if (u.onend) u.onend();
      }, 15);
    }, 3);
  }
  cancel() {
    const u = this.cur;
    this.cur = null;
    this.speaking = false;
    if (u && u.onerror) setTimeout(() => u.onerror({ error: 'interrupted' }), 1);
  }
  resume() {}
}

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

const VOICES = [
  { name: 'Albert', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.Albert', localService: true },
  { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true, default: true },
  { name: 'Ava (Premium)', lang: 'en-US', voiceURI: 'com.apple.voice.premium.en-US.Ava', localService: true },
  { name: 'Daniel (Enhanced)', lang: 'en-GB', voiceURI: 'com.apple.voice.enhanced.en-GB.Daniel', localService: true },
  { name: 'Zarvox', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.Zarvox', localService: true },
  { name: 'Anna', lang: 'de-DE', voiceURI: 'com.apple.voice.compact.de-DE.Anna', localService: true },
  { name: 'Flo (English (US))', lang: 'en-US', voiceURI: 'com.apple.eloquence.en-US.Flo', localService: true },
];

describe('voice', () => {
  test('unsupported environment degrades gracefully', async () => {
    const v = new Voice({ synth: null, Utterance: null, storage: memStore() });
    assert.equal(v.supported, false);
    assert.deepEqual(await v.speak('Hello'), { ok: false, reason: 'unsupported' });
    assert.equal(v.unlock(), false);
    assert.deepEqual(v.list(), []);
    assert.equal(v.current, null);
    v.cancel();
    assert.equal(await v.ready, false);
  });

  test('picks the best natural English voice, never a novelty voice', async () => {
    const v = new Voice({ synth: new MockSynth({ voices: VOICES }), Utterance: MockUtt, storage: memStore() });
    await v.ready;
    assert.equal(v.current.name, 'Ava (Premium)');
    assert.equal(v.current.quality, 'premium');
    const l = v.list();
    assert.equal(l.length, 6, 'English only');
    assert.equal(l[0].name, 'Ava (Premium)');
    assert.ok(l[0].selected);
    for (const n of ['Albert', 'Zarvox', 'Flo (English (US))']) assert.ok(l.find((x) => x.name === n).novelty, n);
    assert.equal(v.list({ all: true }).length, 7);
    assert.ok(rateVoice(VOICES[3]).score > rateVoice(VOICES[1]).score, 'enhanced beats compact');
    // only novelty voices: use the browser default instead
    const n = new Voice({ synth: new MockSynth({ voices: [VOICES[0], VOICES[4]] }), Utterance: MockUtt, storage: memStore() });
    await n.ready;
    assert.equal(n.current, null);
  });

  test('voices that load late (voiceschanged)', async () => {
    const v = new Voice({ synth: new MockSynth({ voices: VOICES, voicesAfter: 40 }), Utterance: MockUtt, storage: memStore() });
    assert.equal(v.current, null);
    let seen = null;
    v.onVoicesChanged((l) => (seen = l));
    assert.equal(await v.ready, true);
    assert.equal(v.current.name, 'Ava (Premium)');
    assert.ok(seen && seen.length === 6);
  });

  test('speak resolves when finished and reports speaking changes', async () => {
    const synth = new MockSynth({ voices: VOICES });
    const v = new Voice({ synth, Utterance: MockUtt, storage: memStore() });
    const changes = [];
    v.onChange((s) => changes.push(s));
    const p = v.speak('Nice work. Now try both hands!');
    assert.equal(v.speaking, true);
    assert.deepEqual(await p, { ok: true });
    assert.deepEqual(changes, [true, false]);
    assert.equal(v.speaking, false);
    assert.deepEqual(synth.spoken, ['Nice work. Now try both hands!']);
    // long texts are spoken sentence group by sentence group
    const long = 'You played that very evenly. '.repeat(9).trim();
    assert.deepEqual(await v.speak(long), { ok: true });
    assert.ok(synth.spoken.length >= 3);
    assert.deepEqual(changes, [true, false, true, false]);
  });

  test('never hangs: missing onend / onstart time out', async () => {
    const v1 = new Voice({ synth: new MockSynth({ voices: VOICES, behavior: 'no-end' }), Utterance: MockUtt, storage: memStore(), timeScale: 0.05 });
    const t0 = Date.now();
    assert.deepEqual(await v1.speak('Hi.'), { ok: true, reason: 'timeout' });
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(v1.speaking, false);
    const v2 = new Voice({ synth: new MockSynth({ voices: VOICES, behavior: 'silent' }), Utterance: MockUtt, storage: memStore(), timeScale: 0.05 });
    assert.deepEqual(await v2.speak('Hi.'), { ok: false, reason: 'no-start' });
    assert.equal(v2.speaking, false);
  });

  test('interrupt cancels the current line; interrupt:false queues', async () => {
    const synth = new MockSynth({ voices: VOICES });
    const v = new Voice({ synth, Utterance: MockUtt, storage: memStore() });
    await v.ready;
    const changes = [];
    v.onChange((s) => changes.push(s));
    const a = v.speak('First line.');
    await sleep(5);
    const b = v.speak('Second line.');
    assert.equal((await a).reason, 'cancelled');
    assert.deepEqual(await b, { ok: true });
    assert.deepEqual(changes, [true, false], 'one continuous speaking period');
    synth.spoken.length = 0;
    const c = v.speak('One.');
    const d = v.speak('Two.', { interrupt: false });
    assert.deepEqual([await c, await d], [{ ok: true }, { ok: true }]);
    assert.deepEqual(synth.spoken, ['One.', 'Two.']);
  });

  test('enabled / voice / rate persist in localStorage "maestro.voice"', async () => {
    const store = memStore();
    const synth = new MockSynth({ voices: VOICES });
    const v = new Voice({ synth, Utterance: MockUtt, storage: store });
    await v.ready;
    assert.equal(v.enabled, true);
    v.setEnabled(false);
    v.setVoice('com.apple.voice.enhanced.en-GB.Daniel');
    v.setRate(0.9);
    assert.deepEqual(await v.speak('Hello'), { ok: false, reason: 'disabled' });
    assert.equal(synth.spoken.length, 0);
    const saved = JSON.parse(store.map.get('maestro.voice'));
    assert.deepEqual(saved, { enabled: false, uri: 'com.apple.voice.enhanced.en-GB.Daniel', rate: 0.9, pitch: 1 });
    const w = new Voice({ synth, Utterance: MockUtt, storage: store });
    await w.ready;
    assert.equal(w.enabled, false);
    assert.equal(w.current.name, 'Daniel (Enhanced)');
    assert.equal(new Voice({ synth, Utterance: MockUtt, storage: memStore({ 'maestro.voice': '0' }) }).enabled, false);
    w.enabled = true;
    assert.equal(JSON.parse(store.map.get('maestro.voice')).enabled, true);
  });

  test('unlock speaks a silent utterance once', () => {
    const synth = new MockSynth({ voices: VOICES });
    const v = new Voice({ synth, Utterance: MockUtt, storage: memStore() });
    assert.equal(v.unlock(), true);
    assert.equal(v.unlock(), true);
    assert.deepEqual(synth.spoken, [' ']);
  });

  test('splitText keeps utterances short', () => {
    const long = 'This is a sentence that goes on, and on, and on '.repeat(8) + 'until it ends.';
    const parts = splitText('Short one. ' + long + ' Last!');
    assert.ok(parts.length >= 3);
    for (const p of parts) assert.ok(p.length <= 181, p.length);
    assert.equal(parts[0], 'Short one.');
    assert.equal(parts.at(-1).endsWith('Last!'), true);
  });
});

// ---- browser (headless Chromium) -----------------------------------------------------------

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
    if (url.pathname === '/__audio_test.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><meta charset="utf-8"><title>audio test</title><body></body>');
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

const f32 = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0));

// Fraction of energy (dB) below `hz` over the whole signal.
function energyBelow(x, sr, hz) {
  const N = 4096;
  const fft = new FFT(N);
  const mag = new Float64Array(N / 2 + 1);
  const frame = new Float64Array(N);
  const kc = Math.floor(hz / (sr / N));
  let lo = 0;
  let tot = 0;
  for (let s = 0; s + N <= x.length; s += N / 4) {
    for (let i = 0; i < N; i++) frame[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft.magnitude(frame, mag);
    for (let k = 1; k <= N / 2; k++) {
      const e = mag[k] * mag[k];
      tot += e;
      if (k <= kc) lo += e;
    }
  }
  return 10 * Math.log10(lo / tot + 1e-30);
}

// Run the real transcriber over `x` + quiet room noise; return notes and onsets.
function transcribeWithNoise(x, sr, noise = 0.0025) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const y = new Float32Array(x.length);
  let lp = 0;
  for (let i = 0; i < y.length; i++) {
    lp += 0.3 * (rnd() - lp);
    y[i] = x[i] + lp * noise;
  }
  const notes = [];
  const onsets = [];
  const tr = new Transcriber(sr, { onNoteOn: (m, t) => notes.push({ midi: m, t }), onOnset: (t) => onsets.push(t) });
  tr.startCalibration();
  let cal = false;
  for (let i = 0; i + 128 <= y.length; i += 128) {
    if (!cal && i / sr > 0.4) {
      tr.finishCalibration();
      cal = true;
    }
    tr.push(y.subarray(i, i + 128), i);
  }
  return { notes, onsets };
}

// Autocorrelation pitch near an expected frequency (cents error), for mid-range notes.
function pitchCents(x, sr, f0) {
  const lagLo = Math.floor(sr / (f0 * 1.3));
  const lagHi = Math.ceil(sr / (f0 / 1.3));
  const n = Math.min(x.length - lagHi - 1, Math.round(sr * 0.08));
  let best = -Infinity;
  let bl = 0;
  const r = [];
  for (let L = lagLo - 1; L <= lagHi + 1; L++) {
    let s = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      s += x[i] * x[i + L];
      e1 += x[i] * x[i];
      e2 += x[i + L] * x[i + L];
    }
    r[L] = s / Math.sqrt(e1 * e2 + 1e-20);
    if (L >= lagLo && L <= lagHi && r[L] > best) {
      best = r[L];
      bl = L;
    }
  }
  const a = r[bl - 1];
  const b = r[bl];
  const c = r[bl + 1];
  const lag = bl + (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return 1200 * Math.log2(sr / lag / f0);
}

const pw = loadPlaywright();
let browser = null;
let server = null;
let page = null;
let pageErrors = [];
let skipBrowser = process.env.NO_BROWSER ? 'NO_BROWSER set' : pw ? false : 'Playwright not installed';
if (!skipBrowser) {
  try {
    browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  } catch (e) {
    skipBrowser = `Chromium not available (${String(e.message).split('\n')[0]})`;
  }
}

describe('browser: sampled piano, sfx and voice', { skip: skipBrowser }, () => {
  let base;
  before(async () => {
    server = await serve();
    base = `http://127.0.0.1:${server.address().port}`;
    page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
    await page.goto(`${base}/__audio_test.html`);
  });
  after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  test('all piano samples decode; notes, touch keys and demos play', async () => {
    const r = await page.evaluate(async () => {
      const { AudioEngine } = await import('/js/audio/audio.js');
      const { generate } = await import('/js/music/generator.js');
      const audio = new AudioEngine({ tailMs: 60 });
      window.audio = audio;
      let progress = null;
      audio.on('piano', (p) => (progress = p));
      await audio.ensureContext();
      const ok = await audio.loadPiano();
      const s = audio.synth;
      for (const m of [21, 45, 60, 61, 88, 108]) s.note(m, audio.ctx.currentTime + 0.02, 0.2, 0.7);
      await new Promise((res) => setTimeout(res, 60));
      const voices = s.activeVoices;
      // polyphony limit
      for (let i = 0; i < 60; i++) s.note(40 + i, audio.ctx.currentTime + 0.02, 0.6, 0.5);
      await new Promise((res) => setTimeout(res, 200)); // stolen voices fade out in ~0.1 s
      const capped = s.activeVoices;
      s.stopAll();
      // touch key: sounds and holds the mic until released (+ tail)
      audio.noteOn(64, audio.now(), 0.7, 'touch');
      const touchHeld = audio.holdReasons.includes('touch');
      await new Promise((res) => setTimeout(res, 50));
      audio.noteOff(64, audio.now(), 'touch');
      await new Promise((res) => setTimeout(res, 1100));
      const touchAfter = audio.held;
      // demo of a generated piece at a fast tempo
      const piece = generate(3, { seed: 5, measures: 2 });
      piece.bpm = 300;
      const h = audio.playDemo(piece);
      await new Promise((res) => setTimeout(res, 150));
      const demoHeld = audio.holdReasons.includes('demo');
      const demoVoices = s.voices.length;
      await h.done;
      await new Promise((res) => setTimeout(res, 120));
      const h2 = audio.playDemo(piece);
      await new Promise((res) => setTimeout(res, 50));
      h2.stop();
      await h2.done;
      return { ok, loaded: s.loaded, failed: s.failed, progress, voices, capped, max: s.maxVoices, touchHeld, touchAfter, demoHeld, demoVoices, heldAfterDemo: audio.held, ready: audio.pianoReady };
    });
    assert.equal(r.ok, true);
    assert.equal(r.loaded, 30);
    assert.equal(r.failed, 0);
    assert.equal(r.ready, true);
    assert.deepEqual(r.progress, { loaded: 30, failed: 0, total: 30, ready: true });
    assert.equal(r.voices, 6);
    assert.ok(r.capped <= r.max, `polyphony ${r.capped} > ${r.max}`);
    assert.equal(r.touchHeld, true);
    assert.equal(r.touchAfter, false);
    assert.equal(r.demoHeld, true);
    assert.ok(r.demoVoices > 0);
    assert.deepEqual(pageErrors, []);
  });

  test('missing samples: oscillator fallback, then a retry loads them', async () => {
    const r = await page.evaluate(async () => {
      const { Synth } = await import('/js/audio/audio.js');
      const ctx = new OfflineAudioContext(1, 48000, 48000);
      const s = new Synth(ctx, ctx.destination, { baseUrl: '/nowhere/' });
      const first = await s.load();
      const v = s.note(60, 0.1, 0.3, 0.7);
      const d = (await ctx.startRendering()).getChannelData(0);
      let pk = 0;
      for (const x of d) pk = Math.max(pk, Math.abs(x));
      s.baseUrl = '/assets/piano/';
      const second = await s.load();
      return { first, failed: s.failed, osc: !!v.osc, pk, second, loaded: s.loaded };
    });
    assert.equal(r.first, false);
    assert.equal(r.osc, true);
    assert.ok(r.pk > 0.05, 'fallback is audible');
    assert.equal(r.second, true);
    assert.equal(r.loaded, 30);
    assert.equal(r.failed, 0);
    pageErrors = pageErrors.filter((e) => !/404|Failed to load resource/.test(e));
  });

  test('sampled piano: correct pitch when shifted, attack on time', async () => {
    const sr = 48000;
    const notes = [48, 50, 57, 59, 60, 61, 66, 71, 76, 83].map((m, i) => ({ midi: m, t: 0.3 + i * 0.9 }));
    const out = await page.evaluate(
      async ({ notes, sr }) => {
        const { Synth } = await import('/js/audio/audio.js');
        const ctx = new OfflineAudioContext(1, Math.round(sr * (notes.at(-1).t + 1)), sr);
        const s = new Synth(ctx, ctx.destination, { reverb: 0 });
        await s.load();
        for (const n of notes) s.note(n.midi, n.t, 0.3, 0.8);
        const d = (await ctx.startRendering()).getChannelData(0);
        const bytes = new Uint8Array(d.buffer);
        let str = '';
        for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(str);
      },
      { notes, sr },
    );
    const x = f32(out);
    for (const n of notes) {
      // the hammer attack (level passes 10% of the peak) lands on the scheduled time
      const i0 = Math.round(n.t * sr);
      const pre = Math.round(0.01 * sr);
      const seg = x.subarray(i0 - pre, i0 + Math.round(0.4 * sr));
      let pk = 0;
      for (const v of seg) pk = Math.max(pk, Math.abs(v));
      let a = 0;
      while (a < seg.length && Math.abs(seg[a]) < pk * 0.1) a++;
      const ms = ((a - pre) / sr) * 1000;
      assert.ok(ms > -2 && ms < 3, `midi ${n.midi}: attack ${ms.toFixed(1)} ms from the scheduled time`);
      const cents = pitchCents(x.subarray(i0 + Math.round(0.08 * sr)), sr, 440 * Math.pow(2, (n.midi - 69) / 12));
      assert.ok(Math.abs(cents) < 25, `midi ${n.midi}: ${cents.toFixed(1)} cents`);
    }
  });

  test('every sfx plays; playSfx holds the mic only for full-range sounds', async () => {
    const r = await page.evaluate(async () => {
      const { SFX_NAMES } = await import('/js/audio/sfx.js');
      const audio = window.audio;
      const out = {};
      for (const n of SFX_NAMES) {
        const before = audio._holds.size;
        const d = audio.playSfx(n, { level: 3 });
        out[n] = { d, held: audio._holds.size === before + 1 && audio.holdReasons.includes('sfx') };
      }
      out.unknown = audio.playSfx('nope');
      // the UI's calling convention: new Sfx(ctx, destination, synth) and alias names
      const { Sfx } = await import('/js/audio/sfx.js');
      const e = new Sfx(audio.ctx, audio.ctx.destination, audio.synth);
      out.positionalSynth = e.synth === audio.synth;
      out.aliases = ['select', 'countin', 'hitPerfect', 'tryAgain'].map((n) => [e.play(n) > 0, e.isMicSafe(n)]);
      audio.sfx.setVolume(0.3);
      return out;
    });
    for (const n of SFX_NAMES) {
      assert.ok(r[n].d > 0, `${n} duration`);
      assert.equal(r[n].held, !MIC_SAFE_SFX.includes(n), `${n} hold`);
    }
    assert.equal(r.unknown, 0);
    assert.equal(r.positionalSynth, true);
    assert.deepEqual(r.aliases, [
      [true, false],
      [true, true],
      [true, true],
      [true, false],
    ]);
    assert.deepEqual(pageErrors, []);
  });

  test('mic-safe sfx stay above the analysed band and create no notes or onsets', async () => {
    const LOUD = ['bloop', 'star1', 'star2', 'star3', 'harder', 'easier', 'countdown-go'];
    const quiet = transcribeWithNoise(new Float32Array(48000 * 2), 48000, 0.0002);
    for (const sr of [48000, 44100]) {
      const renders = await page.evaluate(
        async ({ sr, names }) => {
          const { Sfx } = await import('/js/audio/sfx.js');
          const out = {};
          for (const n of names) {
            const ctx = new OfflineAudioContext(1, Math.round(sr * 2), sr);
            new Sfx(ctx, ctx.destination, { volume: 1 }).play(n, { when: 0.6, level: 8 });
            const d = (await ctx.startRendering()).getChannelData(0);
            const bytes = new Uint8Array(d.buffer);
            let s = '';
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            out[n] = btoa(s);
          }
          return out;
        },
        { sr, names: [...MIC_SAFE_SFX, ...LOUD] },
      );
      const baseline = transcribeWithNoise(new Float32Array(sr * 2), sr);
      for (const n of MIC_SAFE_SFX) {
        const x = f32(renders[n]);
        const below8 = energyBelow(x, sr, 8000);
        const below95 = energyBelow(x, sr, 9500);
        assert.ok(below8 < -65, `${n} @${sr}: ${below8.toFixed(1)} dB below 8 kHz`);
        assert.ok(below95 < -40, `${n} @${sr}: ${below95.toFixed(1)} dB below 9.5 kHz`);
        for (const noise of sr === 48000 ? [0.0025, 0.0002] : [0.0025]) {
          const r = transcribeWithNoise(x, sr, noise);
          const b = noise === 0.0025 ? baseline : quiet;
          assert.deepEqual(r.notes, [], `${n} @${sr}: false notes ${JSON.stringify(r.notes)}`);
          assert.ok(r.onsets.length <= b.onsets.length, `${n} @${sr}: onsets ${r.onsets.length} > baseline ${b.onsets.length}`);
        }
      }
      // sanity: full-range sounds really are audible to the transcriber (hence the mic hold)
      const loud = LOUD.filter((n) => transcribeWithNoise(f32(renders[n]), sr).notes.length > 0);
      assert.ok(loud.length >= 3, `full-range sounds detected: ${loud}`);
    }
  });

  test('metronome ticks are inaudible to the transcriber (no onsets on the beat)', async () => {
    const sr = 48000;
    const b64 = await page.evaluate(async (sr) => {
      const { Synth } = await import('/js/audio/audio.js');
      const ctx = new OfflineAudioContext(1, sr * 4, sr);
      const s = new Synth(ctx, ctx.destination);
      for (let i = 0; i < 6; i++) s.tick(1.0 + i * 0.45, i % 3 === 0);
      const d = (await ctx.startRendering()).getChannelData(0);
      const bytes = new Uint8Array(d.buffer);
      let str = '';
      for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(str);
    }, sr);
    const x = f32(b64);
    let pk = 0;
    for (const v of x) pk = Math.max(pk, Math.abs(v));
    assert.ok(pk > 0.1, 'tick is audible');
    assert.ok(energyBelow(x, sr, 8000) < -55, `tick energy below 8 kHz ${energyBelow(x, sr, 8000).toFixed(1)} dB`);
    const base = transcribeWithNoise(new Float32Array(x.length), sr);
    for (const gain of [1, 4]) {
      const r = transcribeWithNoise(
        x.map((v) => v * gain),
        sr,
      );
      assert.deepEqual(r.notes, []);
      assert.ok(r.onsets.length <= base.onsets.length, `ticks x${gain}: ${r.onsets.length} onsets > baseline ${base.onsets.length}`);
    }
  });

  test('voice degrades gracefully without voices / without speechSynthesis', async () => {
    const r = await page.evaluate(async () => {
      const { Voice } = await import('/js/voice.js');
      const v = new Voice();
      const t0 = performance.now();
      const changes = [];
      v.onChange((s) => changes.push(s));
      v.unlock();
      const res = await v.speak('Hello, this is Maestro.');
      const ms = performance.now() - t0;
      const none = new Voice({ synth: null });
      const r2 = await none.speak('Hi');
      return { supported: v.supported, list: Array.isArray(v.list()), res, ms, speaking: v.speaking, changes, none: none.supported, r2 };
    });
    assert.equal(r.supported, true);
    assert.equal(r.list, true);
    assert.equal(typeof r.res.ok, 'boolean');
    assert.ok(r.ms < 8000, `speak took ${r.ms} ms`);
    assert.equal(r.speaking, false);
    assert.deepEqual(r.changes, [true, false]);
    assert.equal(r.none, false);
    assert.deepEqual(r.r2, { ok: false, reason: 'unsupported' });
  });
});
