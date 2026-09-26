// Input features of the listening model (mirror of tools/nn/frontend.py; parity is tested in
// tests/nn-frontend.test.js).
//
// 16 kHz mono, one frame every 10 ms (160 samples); frame t sees the audio up to sample
// 160 (t + 1): the analysis windows END at the newest sample (causal). Two periodic-Hann STFTs:
// long 2048 samples (128 ms, resolves low notes) and short 512 samples (32 ms, sharp attacks).
// Magnitudes (x 4 / N: a sinusoid of amplitude A peaks at ~A) are mapped to 296 log-frequency
// bins, 3 per semitone, centred on MIDI 20, 20 1/3, ... 118 1/3 - triangles 1/3 semitone wide
// where the FFT is fine enough, linear interpolation where it is not - then ln(1 + m / 3e-5).
//
// Resampler: any input rate -> 16 kHz with a windowed-sinc low-pass (cut-off 7.2 kHz).

export const SR = 16000;
export const HOP = 160;
export const WINS = [2048, 512];
export const NB = 296;
export const MIDI0 = 20;
export const BPS = 3;
export const EPS = 3e-5;

// ---- FFT ----------------------------------------------------------------------------------------
// Real-input FFT of size n through one complex radix-2 FFT of size n / 2.
export class FFT {
  constructor(n) {
    this.n = n;
    const m = (this.m = n >> 1);
    let lg = 0;
    while (1 << lg < m) lg++;
    if (1 << lg !== m || m < 2) throw new Error('FFT size must be a power of two >= 4');
    this.rev = new Uint32Array(m);
    for (let i = 0; i < m; i++) {
      let r = 0;
      for (let b = 0; b < lg; b++) if (i & (1 << b)) r |= 1 << (lg - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(m / 2);
    this.sin = new Float64Array(m / 2);
    for (let i = 0; i < m / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / m);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / m);
    }
    // split twiddles e^{-2 pi i k / n}
    this.wc = new Float64Array(m + 1);
    this.ws = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.wc[k] = Math.cos((2 * Math.PI * k) / n);
      this.ws[k] = -Math.sin((2 * Math.PI * k) / n);
    }
    this.re = new Float64Array(m);
    this.im = new Float64Array(m);
  }

  // Magnitude spectrum (bins 0..n/2) of a real frame, times `scale`.
  magnitude(frame, out, scale = 1) {
    const m = this.m,
      re = this.re,
      im = this.im,
      rev = this.rev;
    for (let i = 0; i < m; i++) {
      const r = rev[i];
      re[r] = frame[2 * i];
      im[r] = frame[2 * i + 1];
    }
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1,
        step = m / size;
      for (let i = 0; i < m; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j,
            b = a + half;
          const c = this.cos[k],
            s = this.sin[k];
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const wc = this.wc,
      ws = this.ws;
    for (let k = 0; k <= m; k++) {
      const k1 = k === m ? 0 : k,
        k2 = k === 0 ? 0 : m - k;
      const zr = re[k1],
        zi = im[k1],
        cr = re[k2],
        ci = -im[k2];
      const er = 0.5 * (zr + cr),
        ei = 0.5 * (zi + ci);
      // odd part: (Z - conj Z') / 2i
      const orr = 0.5 * (zi - ci),
        oi = -0.5 * (zr - cr);
      const xr = er + wc[k] * orr - ws[k] * oi;
      const xi = ei + wc[k] * oi + ws[k] * orr;
      out[k] = Math.sqrt(xr * xr + xi * xi) * scale;
    }
    return out;
  }
}

export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// Sparse log-frequency filterbank for an N-point FFT: { idx: Int32Array, w: Float32Array,
// start: Int32Array(NB + 1) } (CSR by output bin). `cents` shifts every bin (piano tuning).
export function filterbank(W, cents = 0) {
  const nf = W / 2 + 1;
  const idx = [],
    ws = [],
    start = [0];
  const tmp = new Float64Array(nf);
  for (let k = 0; k < NB; k++) {
    const fk = 440 * Math.pow(2, (MIDI0 + k / BPS - 69 + cents / 100) / 12);
    let sum = 0;
    for (let j = 0; j < nf; j++) {
      const fj = (j * SR) / W;
      const d = j === 0 ? Infinity : Math.abs(12 * Math.log2(fj / fk)) * BPS;
      tmp[j] = d < 1 ? 1 - d : 0;
      sum += tmp[j];
    }
    if (sum >= 1) {
      for (let j = 0; j < nf; j++)
        if (tmp[j] > 0) {
          idx.push(j);
          ws.push(tmp[j] / sum);
        }
    } else {
      const p = fk / (SR / W);
      const j0 = Math.floor(p);
      idx.push(j0);
      ws.push(1 - (p - j0));
      if (j0 + 1 < nf) {
        idx.push(j0 + 1);
        ws.push(p - j0);
      }
    }
    start.push(idx.length);
  }
  return { idx: Int32Array.from(idx), w: Float32Array.from(ws), start: Int32Array.from(start) };
}

// ---- resampler -----------------------------------------------------------------------------------
// Streaming windowed-sinc resampler to 16 kHz. Output sample j sits at input position
// j * ratio (+ the input position of the first sample); it is produced once the input reaches
// that position + the kernel half-width (0.5 ms at 48 kHz).
export class Resampler {
  constructor(srIn, { cutoff = 7200, halfZeros = 12 } = {}) {
    this.srIn = srIn;
    this.ratio = srIn / SR;
    this.pass = srIn === SR;
    const fc = Math.min(cutoff, 0.45 * SR) / srIn; // cycles per input sample
    this.fc = fc;
    // half-width in input samples: `halfZeros` zero crossings of the sinc
    this.hw = Math.ceil(halfZeros / (2 * fc));
    this.OS = 256; // table points per input sample
    const n = this.hw * this.OS + 2;
    this.table = new Float32Array(n);
    const beta = 8.6;
    const i0 = (x) => {
      let s = 1,
        t = 1;
      for (let k = 1; k < 30; k++) {
        t *= (x / (2 * k)) * (x / (2 * k));
        s += t;
      }
      return s;
    };
    const ib = i0(beta);
    for (let i = 0; i < n; i++) {
      const x = i / this.OS; // input samples from the centre
      const u = x / this.hw;
      const win = u >= 1 ? 0 : i0(beta * Math.sqrt(1 - u * u)) / ib;
      const s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      this.table[i] = s * win;
    }
    // integer ratio (48 kHz): fixed taps
    this.intRatio = Math.abs(this.ratio - Math.round(this.ratio)) < 1e-9 ? Math.round(this.ratio) : 0;
    if (this.intRatio) {
      this.taps = new Float32Array(2 * this.hw + 1);
      for (let k = -this.hw; k <= this.hw; k++) this.taps[k + this.hw] = this.table[Math.abs(k) * this.OS];
    }
    this.buf = new Float32Array(1 << 15);
    this.mask = this.buf.length - 1;
    this.reset(0);
  }

  reset(inPos) {
    this.inStart = inPos; // input index of the first sample
    this.inN = 0; // input samples received
    this.outN = 0; // output samples produced
    this.buf.fill(0);
  }

  // Input position (absolute input sample index, fractional) of output sample j.
  inPosOf(j) {
    return this.inStart + j * this.ratio;
  }

  // Push input samples; returns the new 16 kHz samples (a view valid until the next call).
  push(x) {
    if (this.pass) return x;
    const buf = this.buf,
      mask = this.mask;
    for (let i = 0; i < x.length; i++) buf[(this.inN + i) & mask] = x[i];
    this.inN += x.length;
    const hw = this.hw;
    const avail = this.inN - 1 - hw; // latest centre position with a full kernel
    let nOut = 0;
    const maxOut = Math.max(0, Math.floor(avail / this.ratio) + 1 - this.outN);
    if (!this.out || this.out.length < maxOut) this.out = new Float32Array(Math.max(maxOut, 4096));
    const out = this.out;
    if (this.intRatio) {
      const R = this.intRatio,
        taps = this.taps;
      for (let j = this.outN; j * R <= avail; j++) {
        const c = j * R;
        let s = 0;
        for (let k = -hw; k <= hw; k++) {
          const p = c + k;
          if (p >= 0) s += taps[k + hw] * buf[p & mask];
        }
        out[nOut++] = s;
      }
    } else {
      const OS = this.OS,
        table = this.table;
      for (let j = this.outN; j * this.ratio <= avail; j++) {
        const c = j * this.ratio;
        const c0 = Math.floor(c);
        let s = 0;
        for (let p = c0 - hw + 1; p <= c0 + hw; p++) {
          if (p < 0) continue;
          const x = Math.abs(p - c) * OS;
          const i = Math.floor(x);
          if (i >= table.length - 1) continue;
          const f = x - i;
          s += (table[i] + (table[i + 1] - table[i]) * f) * buf[p & mask];
        }
        out[nOut++] = s;
      }
    }
    this.outN += nOut;
    return out.subarray(0, nOut);
  }
}

// ---- features -----------------------------------------------------------------------------------
export class Frontend {
  constructor({ cents = 0 } = {}) {
    this.ffts = WINS.map((W) => new FFT(W));
    this.wins = WINS.map((W) => hann(W));
    this.frames = WINS.map((W) => new Float32Array(W));
    this.mags = WINS.map((W) => new Float64Array(W / 2 + 1));
    this.setTuning(cents);
    this.ring = new Float32Array(4096);
    this.rmask = this.ring.length - 1;
    this.n = 0; // 16 kHz samples received
    this.nextEnd = HOP; // end sample of the next frame
    this.out = new Float32Array(2 * NB);
  }

  setTuning(cents) {
    this.cents = cents;
    this.fbs = WINS.map((W) => filterbank(W, cents));
  }

  reset() {
    this.ring.fill(0);
    this.n = 0;
    this.nextEnd = HOP;
  }

  // Push 16 kHz samples; calls onFrame(features Float32Array(2 * NB), endSample) for every frame.
  push(x, onFrame) {
    for (let i = 0; i < x.length; i++) {
      this.ring[this.n & this.rmask] = x[i];
      this.n++;
      if (this.n === this.nextEnd) {
        this.compute(this.n);
        onFrame(this.out, this.n);
        this.nextEnd += HOP;
      }
    }
  }

  compute(end) {
    const out = this.out;
    for (let w = 0; w < WINS.length; w++) {
      const W = WINS[w],
        fr = this.frames[w],
        win = this.wins[w],
        ring = this.ring,
        m = this.rmask;
      for (let i = 0; i < W; i++) {
        const p = end - W + i;
        fr[i] = p >= 0 ? ring[p & m] * win[i] : 0;
      }
      const mag = this.ffts[w].magnitude(fr, this.mags[w], 4 / W);
      const { idx, w: ws, start } = this.fbs[w];
      const o = w * NB;
      for (let k = 0; k < NB; k++) {
        let s = 0;
        for (let q = start[k]; q < start[k + 1]; q++) s += ws[q] * mag[idx[q]];
        out[o + k] = Math.log1p(s / EPS);
      }
    }
    return out;
  }
}
