// The deterministic test signal of tools/nn/export.py (test_signal), for the parity tests
// (tests/nn-frontend.test.js, tests/nn-model.test.js): C3, then an E4 + G4 chord, with decaying
// partials and a little Park-Miller noise, at 16 kHz.
export function testSignal(n) {
  const x = new Float64Array(n);
  const noise = new Float64Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    noise[i] = (seed / 2147483647) * 2 - 1;
  }
  for (const [midi, t0, amp] of [
    [48, 0.2, 0.2],
    [64, 0.7, 0.12],
    [67, 0.7, 0.12],
  ]) {
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < n; i++) {
      const t = i / 16000;
      if (t < t0) continue;
      const tt = t - t0;
      for (let h = 1; h <= 8; h++) x[i] += (amp / h) * Math.exp(-tt * (1.5 + h)) * Math.sin(2 * Math.PI * f0 * h * tt);
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] + 0.002 * noise[i];
  return out;
}
