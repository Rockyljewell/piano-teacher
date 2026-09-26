// The hybrid listener's free-play arbiter (js/audio/nn/arbiter.js): decides which DSP notes and
// which network notes are reported in free play. Fitted by tools/nn/arbiter_fit.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreeArbiter, FEATS } from '../js/audio/nn/arbiter.js';
import { ARBITER_MODEL } from '../js/audio/nn/arbiter-model.js';

test('the shipped model matches the feature lists', () => {
  const M = ARBITER_MODEL;
  for (const [kind, feats] of [['dsp', FEATS.dsp], ['nn', FEATS.nn], ['nnOct', FEATS.nn]]) {
    if (!M[kind]) continue;
    assert.equal(M[kind].w.length, feats.length, kind);
    assert.equal(M[kind].mu.length, feats.length, kind);
    assert.equal(M[kind].sd.length, feats.length, kind);
    if (M[kind].W1) for (const row of M[kind].W1) assert.equal(row.length, feats.length, kind);
  }
  for (const kind of ['dsp', 'nn']) assert.ok(Array.isArray(M.thr[kind]) && M.thr[kind].length === 3, kind);
});

// A short scene: frames every 10 ms with the network's probabilities; `notes` sets p (onset) and
// pf (sounding) for keys over a time span.
function scene(arb, t0, t1, notes) {
  for (let now = t0; now <= t1 + 1e-9; now += 0.01) {
    const P = new Float32Array(88).fill(0.001),
      Pf = new Float32Array(88).fill(0.01);
    for (const n of notes) {
      if (now >= n.t && now < n.t + 0.06) P[n.midi - 21] = n.p;
      if (now >= n.t) Pf[n.midi - 21] = n.pf ?? 0.95;
    }
    arb.frame(now, P, Pf);
  }
}

test('without a model: DSP notes pass, network notes are never added', () => {
  const out = [];
  const arb = new FreeArbiter((midi, t, vel, info, src) => out.push({ midi, src }), null);
  arb.nn(60, 1.0, 0.5, { p: 0.999 }, 1.02);
  scene(arb, 1.02, 1.4, [{ midi: 60, t: 1.0, p: 0.999 }]);
  arb.dsp(64, 1.5, 0.5, { confidence: 0.9 }, 1.6);
  assert.deepEqual(out, [{ midi: 64, src: 'dsp' }]);
});

function played(arb) {
  // some piano first: confident DSP notes, with the network agreeing
  for (let i = 0; i < 8; i++) {
    const t = 0.5 + i * 0.4,
      m = 60 + (i % 5);
    scene(arb, t - 0.02, t + 0.08, [{ midi: m, t, p: 0.99 }]);
    arb.dsp(m, t, 0.5, { confidence: 0.97, path: 'long' }, t + 0.09);
    scene(arb, t + 0.09, t + 0.3, [{ midi: m, t, p: 0.99 }]);
  }
  return 4;
}

test('a very sure network note is reported without waiting for the DSP', () => {
  const out = [];
  const arb = new FreeArbiter((midi, t, vel, info, src) => out.push({ midi, t, src, at: arb.now }), ARBITER_MODEL);
  const t = played(arb);
  out.length = 0;
  arb.onset(t, 20);
  scene(arb, t - 0.02, t + 0.02, []);
  arb.nn(67, t, 0.5, { p: 0.95 }, t + 0.03);
  scene(arb, t + 0.03, t + 0.2, [{ midi: 67, t: t + 0.0, p: 0.999 }]);
  const e = out.find((x) => x.midi === 67);
  assert.ok(e && e.src === 'nn', JSON.stringify(out));
  assert.ok(e.at - t <= 0.08, `reported ${Math.round((e.at - t) * 1000)} ms after the attack`);
});

test('a DSP note the network does not hear, a twelfth above a struck note, is dropped', () => {
  const out = [];
  const arb = new FreeArbiter((midi, t, vel, info, src) => out.push({ midi, src }), ARBITER_MODEL);
  const t = played(arb);
  out.length = 0;
  scene(arb, t - 0.02, t + 0.06, [{ midi: 48, t, p: 0.999 }]);
  arb.dsp(48, t, 0.5, { confidence: 0.98, path: 'long' }, t + 0.07);
  scene(arb, t + 0.07, t + 0.14, [{ midi: 48, t, p: 0.999 }]);
  arb.dsp(67, t, 0.5, { confidence: 0.6, path: 'long' }, t + 0.15);
  assert.ok(out.some((x) => x.midi === 48), JSON.stringify(out));
  assert.ok(!out.some((x) => x.midi === 67), JSON.stringify(out));
});
