// The listening model's signal front end (js/audio/nn/frontend.js): resampling to 16 kHz, FFT,
// log-frequency features - and parity with the Python training code (tools/nn/frontend.py) via
// the fixture written by tools/nn/export.py (skipped when the fixture is missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resampler, FFT, Frontend, NB, HOP, filterbank } from '../js/audio/nn/frontend.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '../tools/nn/fixtures/parity.json');

function sine(sr, f, sec, amp = 0.5) {
  const x = new Float32Array(Math.round(sr * sec));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr);
  return x;
}

function resample(sr, x, chunk = 512) {
  const r = new Resampler(sr);
  const parts = [];
  for (let i = 0; i < x.length; i += chunk) parts.push(Float32Array.from(r.push(x.subarray(i, i + chunk))));
  const y = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    y.set(p, o);
    o += p.length;
  }
  return { y, r };
}

test('resampler: 48 and 44.1 kHz to 16 kHz keep the passband, in phase, and reject aliases', () => {
  for (const sr of [48000, 44100]) {
    const { y, r } = resample(sr, sine(sr, 1000, 1));
    assert.ok(y.length > 15900 && y.length <= 16000, `${sr}: ${y.length} samples`);
    // output sample j sits at input position j * sr / 16000: same phase as the input sine
    let err = 0;
    for (let j = 1000; j < 1200; j++) err = Math.max(err, Math.abs(y[j] - 0.5 * Math.sin((2 * Math.PI * 1000 * r.inPosOf(j)) / sr)));
    assert.ok(err < 1e-3, `${sr}: phase/amplitude error ${err}`);
    const { y: z } = resample(sr, sine(sr, 11000, 1));
    let e = 0;
    for (let j = 1000; j < z.length - 100; j++) e = Math.max(e, Math.abs(z[j]));
    assert.ok(e < 0.5 * 1e-3, `${sr}: 11 kHz leaks ${e}`);
  }
  // 16 kHz passes straight through
  const x = sine(16000, 440, 0.1);
  assert.equal(new Resampler(16000).push(x), x);
});

test('FFT magnitude: a sinusoid on a bin peaks at its amplitude (x 4/N with a Hann window)', () => {
  const N = 512;
  const fft = new FFT(N);
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = 0.3 * Math.cos((2 * Math.PI * 32 * i) / N) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const m = fft.magnitude(x, new Float64Array(N / 2 + 1), 4 / N);
  assert.ok(Math.abs(m[32] - 0.3) < 1e-6, `peak ${m[32]}`);
  assert.ok(m[40] < 1e-6);
});

test('filterbank: every log bin has weights; bins shift with the tuning', () => {
  for (const W of [2048, 512]) {
    const fb = filterbank(W);
    assert.equal(fb.start.length, NB + 1);
    for (let k = 0; k < NB; k++) assert.ok(fb.start[k + 1] > fb.start[k], `bin ${k} empty`);
  }
  const a = filterbank(2048, 0),
    b = filterbank(2048, -30);
  assert.notDeepEqual(Array.from(a.idx.slice(-20)), Array.from(b.idx.slice(-20)));
});

test('features: a C4 sine lights up the C4 bins; one frame per 10 ms', () => {
  const fe = new Frontend();
  let n = 0,
    last = null;
  fe.push(sine(16000, 261.63, 0.5, 0.1), (f) => {
    n++;
    last = Float32Array.from(f);
  });
  assert.equal(n, (0.5 * 16000) / HOP);
  const k = (60 - 20) * 3;
  const peak = last.subarray(0, NB).reduce((a, v, i) => (v > last[a] ? i : a), 0);
  assert.ok(Math.abs(peak - k) <= 1, `long-window peak at bin ${peak}, want ${k}`);
});

test('features match the Python training front end (tools/nn/fixtures/parity.json)', { skip: !fs.existsSync(FIXTURE) && 'no fixture (python tools/nn/export.py)' }, async () => {
  const { testSignal } = await import('../tools/nn/fixtures/testsignal.mjs');
  const ref = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const fe = new Frontend({ wins: ref.wins || [2048, 512] });
  let t = 0,
    maxd = 0,
    checked = 0;
  fe.push(testSignal(ref.n), (f) => {
    const r = ref.feats[t];
    if (r) {
      checked++;
      for (let i = 0; i < r.length; i++) maxd = Math.max(maxd, Math.abs(r[i] - f[i]));
    }
    t++;
  });
  assert.ok(checked >= 3);
  assert.ok(maxd < 1e-3, `max feature difference ${maxd}`);
});
