// The listening model's JS inference (js/audio/nn/model.js) against the PyTorch model it was
// exported from: tools/nn/export.py writes assets/models/piano-nn.bin and, with it,
// tools/nn/fixtures/parity.json (the network's outputs on a deterministic signal).
// Skipped when either file is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Frontend } from '../js/audio/nn/frontend.js';
import { Model, parseWeights, f16ToF32, matmul } from '../js/audio/nn/model.js';
import { testSignal } from '../tools/nn/fixtures/testsignal.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS = path.join(here, '../assets/models/piano-nn.bin');
const FIXTURE = path.join(here, '../tools/nn/fixtures/parity.json');
const have = fs.existsSync(WEIGHTS) && fs.existsSync(FIXTURE);

test('float16 decoding', () => {
  const u = new Uint16Array([0x3c00, 0xc000, 0x3555, 0x0001, 0x7bff, 0x0000]);
  const f = f16ToF32(u);
  assert.equal(f[0], 1);
  assert.equal(f[1], -2);
  assert.ok(Math.abs(f[2] - 0.33325195) < 1e-7);
  assert.ok(Math.abs(f[3] - 5.96e-8) < 1e-9);
  assert.equal(f[4], 65504);
  assert.equal(f[5], 0);
});

test('blocked matmul equals the naive one (all shapes, with remainders)', () => {
  for (const [P, I, O] of [
    [8, 5, 8],
    [7, 3, 6],
    [1, 48, 24],
    [88, 24, 6],
  ]) {
    const X = Float32Array.from({ length: P * I }, (_, i) => Math.sin(i * 1.3));
    const W = Float32Array.from({ length: O * I }, (_, i) => Math.cos(i * 0.7));
    const b = Float32Array.from({ length: O }, (_, i) => i * 0.1 - 0.2);
    for (const relu of [false, true]) {
      const out = matmul(X, P, I, W, O, b, new Float32Array(P * O), relu);
      for (let p = 0; p < P; p++)
        for (let o = 0; o < O; o++) {
          let a = b[o];
          for (let i = 0; i < I; i++) a += W[o * I + i] * X[p * I + i];
          if (relu) a = Math.max(0, a);
          assert.ok(Math.abs(out[p * O + o] - a) < 1e-4);
        }
    }
  }
});

test('JS inference matches PyTorch (shipped weights)', { skip: !have && 'no weights / fixture (python tools/nn/export.py)' }, () => {
  const w = parseWeights(fs.readFileSync(WEIGHTS));
  const ref = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const fe = new Frontend();
  const m = new Model(w);
  let t = 0,
    maxd = 0,
    checked = 0;
  fe.push(testSignal(ref.n), (f) => {
    const o = m.step(f);
    const r = ref.logits[t];
    if (r) {
      checked++;
      assert.equal(r.length, o.length);
      for (let i = 0; i < r.length; i++) maxd = Math.max(maxd, Math.abs(r[i] - o[i]));
    }
    t++;
  });
  assert.ok(checked >= 5);
  assert.ok(maxd < 0.02, `max logit difference ${maxd}`);
});

test('weights file is compact', { skip: !fs.existsSync(WEIGHTS) && 'no weights' }, () => {
  assert.ok(fs.statSync(WEIGHTS).size < 2 * 1024 * 1024);
});
