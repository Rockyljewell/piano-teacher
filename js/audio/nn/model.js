// Streaming inference of the listening model (tools/nn/model.py), one 10 ms frame at a time.
// Pure JS on Float32Arrays: no dependencies. Batch-norm is folded into the weights by
// tools/nn/export.py; the causal convolutions keep the few past frames they need.
//
// Weights file (assets/models/piano-nn.bin): "PNN1", u32 header length, JSON header
// { cfg, frontend, tensors: { name: { shape, dtype: 'f16' | 'f32', offset } }, decoder }, then the
// tensor data (little endian, 4-byte aligned).

export function f16ToF32(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i];
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    out[i] = e === 0 ? s * f * 5.960464477539063e-8 : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return out;
}

export function parseWeights(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'PNN1') throw new Error('not a listening-model file');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hlen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  const base = 8 + hlen + ((4 - ((8 + hlen) % 4)) % 4);
  const T = {};
  for (const [name, t] of Object.entries(header.tensors)) {
    const n = t.shape.reduce((a, b) => a * b, 1);
    const off = u8.byteOffset + base + t.offset;
    if (t.dtype === 'f16') {
      const raw = new Uint16Array(u8.buffer.slice(off, off + 2 * n));
      T[name] = f16ToF32(raw);
    } else T[name] = new Float32Array(u8.buffer.slice(off, off + 4 * n));
  }
  return { header, T };
}

// out[p*O + o] = b[o] + sum_i W[o*I + i] * X[p*I + i]   (optionally ReLU); 4x4 register blocks.
export function matmul(X, P, I, W, O, b, out, relu = false) {
  const P4 = P - (P % 4),
    O4 = O - (O % 4);
  for (let p = 0; p < P4; p += 4) {
    const x0 = p * I,
      x1 = x0 + I,
      x2 = x1 + I,
      x3 = x2 + I;
    const q0 = p * O,
      q1 = q0 + O,
      q2 = q1 + O,
      q3 = q2 + O;
    for (let o = 0; o < O4; o += 4) {
      let a0 = b[o],
        a1 = a0,
        a2 = a0,
        a3 = a0;
      let c0 = b[o + 1],
        c1 = c0,
        c2 = c0,
        c3 = c0;
      let d0 = b[o + 2],
        d1 = d0,
        d2 = d0,
        d3 = d0;
      let e0 = b[o + 3],
        e1 = e0,
        e2 = e0,
        e3 = e0;
      const w0 = o * I,
        w1 = w0 + I,
        w2 = w1 + I,
        w3 = w2 + I;
      for (let i = 0; i < I; i++) {
        const u = W[w0 + i],
          v = W[w1 + i],
          r = W[w2 + i],
          s = W[w3 + i];
        const y0 = X[x0 + i],
          y1 = X[x1 + i],
          y2 = X[x2 + i],
          y3 = X[x3 + i];
        a0 += u * y0;
        a1 += u * y1;
        a2 += u * y2;
        a3 += u * y3;
        c0 += v * y0;
        c1 += v * y1;
        c2 += v * y2;
        c3 += v * y3;
        d0 += r * y0;
        d1 += r * y1;
        d2 += r * y2;
        d3 += r * y3;
        e0 += s * y0;
        e1 += s * y1;
        e2 += s * y2;
        e3 += s * y3;
      }
      if (relu) {
        out[q0 + o] = a0 > 0 ? a0 : 0;
        out[q1 + o] = a1 > 0 ? a1 : 0;
        out[q2 + o] = a2 > 0 ? a2 : 0;
        out[q3 + o] = a3 > 0 ? a3 : 0;
        out[q0 + o + 1] = c0 > 0 ? c0 : 0;
        out[q1 + o + 1] = c1 > 0 ? c1 : 0;
        out[q2 + o + 1] = c2 > 0 ? c2 : 0;
        out[q3 + o + 1] = c3 > 0 ? c3 : 0;
        out[q0 + o + 2] = d0 > 0 ? d0 : 0;
        out[q1 + o + 2] = d1 > 0 ? d1 : 0;
        out[q2 + o + 2] = d2 > 0 ? d2 : 0;
        out[q3 + o + 2] = d3 > 0 ? d3 : 0;
        out[q0 + o + 3] = e0 > 0 ? e0 : 0;
        out[q1 + o + 3] = e1 > 0 ? e1 : 0;
        out[q2 + o + 3] = e2 > 0 ? e2 : 0;
        out[q3 + o + 3] = e3 > 0 ? e3 : 0;
      } else {
        out[q0 + o] = a0;
        out[q1 + o] = a1;
        out[q2 + o] = a2;
        out[q3 + o] = a3;
        out[q0 + o + 1] = c0;
        out[q1 + o + 1] = c1;
        out[q2 + o + 1] = c2;
        out[q3 + o + 1] = c3;
        out[q0 + o + 2] = d0;
        out[q1 + o + 2] = d1;
        out[q2 + o + 2] = d2;
        out[q3 + o + 2] = d3;
        out[q0 + o + 3] = e0;
        out[q1 + o + 3] = e1;
        out[q2 + o + 3] = e2;
        out[q3 + o + 3] = e3;
      }
    }
  }
  // remainders (generic)
  for (let p = 0; p < P; p++)
    for (let o = p < P4 ? O4 : 0; o < O; o++) {
      let a = b[o];
      const w = o * I,
        x = p * I;
      for (let i = 0; i < I; i++) a += W[w + i] * X[x + i];
      out[p * O + o] = relu && a < 0 ? 0 : a;
    }
  return out;
}

export class Model {
  constructor(weights) {
    const { header, T } = weights;
    const c = header.cfg;
    this.cfg = c;
    this.T = T;
    const C1 = (this.C1 = c.c1);
    const C2 = (this.C2 = c.c2);
    const NK = (this.NK = 88);
    const NP = (this.NP = 264);
    this.NB = header.frontend.nb;
    this.H = c.shifts.length;
    this.diff = c.diff || 0; // extra input: short-window rise over `diff` frames
    this.nspec = header.frontend.wins.length; // spectra, longest window first
    this.NF = this.nspec + (this.diff ? 1 : 0); // feature maps: spectra (, rise of the shortest)
    this.CIN = this.NF * this.H;
    this.KO = 2 + Math.max(c.k_onset, c.k_bass || 0);
    // per-tap weight vectors (contiguous over channels) for the depthwise convolutions
    this.bTap = Array.from({ length: 9 }, (_, q) => Float32Array.from({ length: C1 }, (_, ch) => T.b_w[ch * 9 + q]));
    // key layer: reorder the input columns from (channel, position) to (position, channel) so
    // the B output [264][C1] can be read directly as [88][3 * C1]
    this.kW = new Float32Array(C2 * 3 * C1);
    for (let o = 0; o < C2; o++) for (let ch = 0; ch < C1; ch++) for (let j = 0; j < 3; j++) this.kW[o * 3 * C1 + j * C1 + ch] = T.k_w[o * 3 * C1 + ch * 3 + j];
    const xoff = [0, ...c.xoff];
    this.blocks = c.blocks.map((b, i) => {
      const kind = b[0] === 't' ? 't' : 'x';
      const d = kind === 't' ? Number(b.slice(1)) : 0;
      const p = `blk${i}_`;
      const dw = T[p + 'dw'];
      const nt = kind === 't' ? 3 : xoff.length;
      const taps = Array.from({ length: nt }, (_, q) => Float32Array.from({ length: C2 }, (_, ch) => dw[ch * nt + q]));
      return {
        kind,
        d,
        taps,
        off: kind === 'x' ? xoff : null,
        pw_w: T[p + 'pw_w'],
        pw_b: T[p + 'pw_b'],
        g_w: T[p + 'g_w'],
        g_b: T[p + 'g_b'],
        s: T[p + 's'],
        t: T[p + 't'],
        hist: kind === 't' ? Array.from({ length: 2 * d + 1 }, () => new Float32Array(NK * C2)) : null,
        h: 0,
      };
    });
    this.xn = new Float32Array((this.nspec + 1) * this.NB);
    this.sHist = Array.from({ length: Math.max(1, this.diff) }, () => new Float32Array(this.NB)); // normalised short spectra, t-1 .. t-diff
    this.sIdx = 0;
    this.S = new Float32Array(NP * this.CIN);
    this.A = [0, 1, 2].map(() => new Float32Array(NP * C1)); // ring: A at t, t-1, t-2
    this.aIdx = 0;
    this.Bo = new Float32Array(NP * C1);
    this.X = new Float32Array(NK * C2);
    this.Y = new Float32Array(NK * C2);
    this.Z = new Float32Array(NK * C2);
    this.g = new Float32Array(2 * C2);
    this.gb = new Float32Array(C2);
    this.out = new Float32Array(NK * this.KO);
    this.frames = 0;
    // stacking index: for position p and harmonic h, the log bin (or -1)
    this.sidx = new Int32Array(NP * this.H);
    for (let p = 0; p < NP; p++)
      for (let h = 0; h < this.H; h++) {
        const b = c.pos0 + p + c.shifts[h];
        this.sidx[p * this.H + h] = b >= 0 && b < this.NB ? b : -1;
      }
  }

  reset() {
    for (const h of this.sHist) h.fill(0);
    for (const a of this.A) a.fill(0);
    for (const b of this.blocks) if (b.hist) for (const h of b.hist) h.fill(0);
    this.frames = 0;
  }

  // One frame of features (Float32Array(nspec * NB)) -> logits [88 keys][2 + K] (onset, frame, age...).
  step(f) {
    const T = this.T,
      NB = this.NB,
      NP = this.NP,
      NK = this.NK,
      C1 = this.C1,
      C2 = this.C2,
      H = this.H,
      CIN = this.CIN;
    const xn = this.xn;
    const ns = this.nspec;
    for (let w = 0; w < ns; w++) {
      const mu = T.mu[w],
        isd = 1 / T.sd[w];
      for (let k = 0; k < NB; k++) xn[w * NB + k] = (f[w * NB + k] - mu) * isd;
    }
    if (this.diff) {
      // rise of the shortest window's spectrum since `diff` frames ago (zeros before the start)
      const old = this.sHist[this.sIdx];
      for (let k = 0; k < NB; k++) {
        const v = xn[(ns - 1) * NB + k];
        xn[ns * NB + k] = v - old[k];
        old[k] = v;
      }
      this.sIdx = (this.sIdx + 1) % this.diff;
    }
    // harmonic stack [P][NF*H]
    const S = this.S,
      sidx = this.sidx,
      NF = this.NF;
    for (let p = 0; p < NP; p++) {
      const o = p * CIN;
      for (let h = 0; h < H; h++) {
        const b = sidx[p * H + h];
        if (b < 0) for (let c = 0; c < NF; c++) S[o + c * H + h] = 0;
        else for (let c = 0; c < NF; c++) S[o + c * H + h] = xn[c * NB + b];
      }
    }
    // A: 1x1 conv + BN + ReLU
    this.aIdx = (this.aIdx + 1) % 3;
    const A0 = this.A[this.aIdx],
      A1 = this.A[(this.aIdx + 2) % 3],
      A2 = this.A[(this.aIdx + 1) % 3]; // t, t-1, t-2
    matmul(S, NP, CIN, T.a_w, C1, T.a_b, A0, true);
    // B: depthwise 3 (time) x 3 (freq), causal; residual; BN; ReLU
    const Bo = this.Bo;
    Bo.set(A0);
    const Ar = [A2, A1, A0]; // kernel time index 0 -> t-2
    for (let i = 0; i < 3; i++) {
      const Ai = Ar[i],
        w0 = this.bTap[i * 3],
        w1 = this.bTap[i * 3 + 1],
        w2 = this.bTap[i * 3 + 2];
      for (let c = 0; c < C1; c++) Bo[c] += w1[c] * Ai[c] + w2[c] * Ai[C1 + c];
      for (let p = 1; p < NP - 1; p++) {
        const q = p * C1;
        for (let c = 0; c < C1; c++) Bo[q + c] += w0[c] * Ai[q - C1 + c] + w1[c] * Ai[q + c] + w2[c] * Ai[q + C1 + c];
      }
      const q = (NP - 1) * C1;
      for (let c = 0; c < C1; c++) Bo[q + c] += w0[c] * Ai[q - C1 + c] + w1[c] * Ai[q + c];
    }
    const sB = T.b_s,
      tB = T.b_t;
    for (let p = 0; p < NP; p++) {
      const q = p * C1;
      for (let c = 0; c < C1; c++) {
        const v = sB[c] * Bo[q + c] + tB[c];
        Bo[q + c] = v > 0 ? v : 0;
      }
    }
    // keys: the 3 positions x C1 of each key -> C2 (+ per-key bias), ReLU
    let X = this.X;
    matmul(Bo, NK, C1 * 3, this.kW, C2, T.k_b, X, false);
    const emb = T.kemb;
    for (let k = 0; k < NK; k++)
      for (let o = 0; o < C2; o++) {
        const v = X[k * C2 + o] + emb[o * NK + k];
        X[k * C2 + o] = v > 0 ? v : 0;
      }
    // residual blocks
    for (const bl of this.blocks) {
      const Y = this.Y;
      if (bl.kind === 't') {
        // history ring of the block input
        bl.h = (bl.h + 1) % bl.hist.length;
        const cur = bl.hist[bl.h];
        cur.set(X);
        const L = bl.hist.length,
          d = bl.d;
        const xm1 = bl.hist[(bl.h - d + L) % L],
          xm2 = bl.hist[(bl.h - 2 * d + L) % L];
        const [w0, w1, w2] = bl.taps;
        for (let k = 0; k < NK; k++) {
          const q = k * C2;
          for (let c = 0; c < C2; c++) Y[q + c] = w0[c] * xm2[q + c] + w1[c] * xm1[q + c] + w2[c] * cur[q + c];
        }
      } else {
        // depthwise across keys at fixed offsets (octaves, twelfths, neighbours)
        const off = bl.off,
          taps = bl.taps;
        const w = taps[0];
        for (let k = 0; k < NK; k++) {
          const q = k * C2;
          for (let c = 0; c < C2; c++) Y[q + c] = w[c] * X[q + c];
        }
        for (let j = 1; j < off.length; j++) {
          const o = off[j],
            wj = taps[j];
          const k0 = Math.max(0, -o),
            k1 = Math.min(NK, NK - o);
          for (let k = k0; k < k1; k++) {
            const q = k * C2,
              r = (k + o) * C2;
            for (let c = 0; c < C2; c++) Y[q + c] += wj[c] * X[r + c];
          }
        }
      }
      const Z = this.Z;
      matmul(Y, NK, C2, bl.pw_w, C2, bl.pw_b, Z, false);
      if (bl.kind === 'x') {
        // global context: mean and max over keys -> linear -> added to every key
        const g = this.g;
        for (let c = 0; c < C2; c++) {
          g[c] = 0;
          g[C2 + c] = -Infinity;
        }
        for (let k = 0; k < NK; k++) {
          const q = k * C2;
          for (let c = 0; c < C2; c++) {
            const v = X[q + c];
            g[c] += v;
            if (v > g[C2 + c]) g[C2 + c] = v;
          }
        }
        for (let c = 0; c < C2; c++) g[c] /= NK;
        matmul(g, 1, 2 * C2, bl.g_w, C2, bl.g_b, this.gb, false);
        const gb = this.gb;
        for (let k = 0; k < NK; k++) {
          const q = k * C2;
          for (let c = 0; c < C2; c++) Z[q + c] += gb[c];
        }
      }
      const s = bl.s,
        t = bl.t;
      const Xn = this.Y; // reuse
      for (let k = 0; k < NK; k++) {
        const q = k * C2;
        for (let c = 0; c < C2; c++) {
          const v = s[c] * (X[q + c] + Z[q + c]) + t[c];
          Xn[q + c] = v > 0 ? v : 0;
        }
      }
      // swap buffers
      this.Y = X;
      this.X = Xn;
      X = Xn;
    }
    matmul(X, NK, C2, T.head_w, this.KO, T.head_b, this.out, false);
    this.frames++;
    return this.out;
  }
}
